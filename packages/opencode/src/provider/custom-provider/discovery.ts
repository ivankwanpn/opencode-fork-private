import { CustomProvider } from "@opencode-ai/schema/custom-provider"
import { Effect } from "effect"
import {
  buildDiscoveryHeaders,
  buildModelsURLCandidates,
  normalizeDiscoverInput,
  normalizeModelCatalog,
  parseCredential,
  redactURL,
} from "@/provider/custom-provider/domain"

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
const CANDIDATE_MISS_STATUSES = new Set([404, 405])
type Fetch = (request: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export function discover(
  input: CustomProvider.DiscoverInput,
  options?: {
    readonly fetch?: Fetch
    readonly env?: Readonly<Record<string, string | undefined>>
    readonly timeoutMs?: number
  },
): Effect.Effect<CustomProvider.DiscoverResult, CustomProvider.ValidationError | CustomProvider.DiscoveryError> {
  return Effect.gen(function* () {
    const normalized = yield* normalizeDiscoverInput(input)
    const credential = parseCredential(normalized.apiKey)
    const key = credential.env ? (options?.env ?? process.env)[credential.env] : credential.key
    if (credential.env && !key) {
      return yield* new CustomProvider.DiscoveryError({
        kind: "environment",
        message: "Environment credential is unavailable",
      })
    }

    const timeout = AbortSignal.timeout(options?.timeoutMs ?? 15_000)
    const deadline = deadlineFor(timeout)
    const fetch = options?.fetch ?? globalThis.fetch
    const headers = buildDiscoveryHeaders(normalized, key)
    const failures: CustomProvider.DiscoveryError[] = []
    const misses: CustomProvider.DiscoveryError[] = []

    const result = yield* Effect.tryPromise({
      try: async () => {
        for (const candidate of buildModelsURLCandidates(normalized.baseURL)) {
          let current = new URL(candidate)
          let redirects = 0

          while (true) {
            const fetched = await againstTimeout(
              fetch(current, {
                headers,
                redirect: "manual",
                signal: timeout,
              }),
              timeout,
              deadline,
            )
            if (fetched.type === "timeout" || timeout.aborted) {
              throw failure(current, "timeout", "Model discovery timed out")
            }
            if (fetched.type === "failure") {
              const error = failure(current, "network", "Model discovery request failed")
              failures.push(error)
              break
            }

            const response = fetched.value
            if (REDIRECT_STATUSES.has(response.status)) {
              const location = response.headers.get("location")
              if (!location || !URL.canParse(location, current)) {
                failures.push(failure(current, "redirect", "Model discovery redirect was rejected", response.status))
                break
              }
              const next = new URL(location, current)
              if (next.origin !== current.origin || redirects >= 3) {
                failures.push(failure(current, "redirect", "Model discovery redirect was rejected", response.status))
                break
              }
              current = next
              redirects++
              continue
            }

            if (CANDIDATE_MISS_STATUSES.has(response.status)) {
              misses.push(
                failure(current, "status", "Model discovery endpoint returned an unsuccessful status", response.status),
              )
              break
            }
            if (!response.ok) {
              failures.push(
                failure(current, "status", "Model discovery endpoint returned an unsuccessful status", response.status),
              )
              break
            }

            const parsed = await readJSON(response, timeout, deadline)
            if (parsed.type === "timeout" || timeout.aborted) {
              throw failure(current, "timeout", "Model discovery timed out", response.status)
            }
            if (parsed.type === "failure" || !isCatalog(parsed.value)) {
              failures.push(
                failure(current, "shape", "Model discovery endpoint returned an invalid catalog", response.status),
              )
              break
            }
            return {
              endpoint: redactURL(current),
              models: normalizeModelCatalog(parsed.value),
            }
          }
        }

        throw (
          failures.at(-1) ??
          misses.at(-1) ??
          new CustomProvider.DiscoveryError({
            kind: "network",
            message: "Model discovery request failed",
          })
        )
      },
      catch: (cause) =>
        cause instanceof CustomProvider.DiscoveryError
          ? cause
          : new CustomProvider.DiscoveryError({
              kind: timeout.aborted ? "timeout" : "network",
              message: timeout.aborted ? "Model discovery timed out" : "Model discovery request failed",
            }),
    })

    return result
  })
}

type Settled<T> = { type: "value"; value: T } | { type: "failure" } | { type: "timeout" }

function deadlineFor(timeout: AbortSignal): Promise<{ type: "timeout" }> {
  if (timeout.aborted) return Promise.resolve({ type: "timeout" })
  return new Promise((resolve) => {
    timeout.addEventListener("abort", () => resolve({ type: "timeout" }), { once: true })
  })
}

function againstTimeout<T>(
  promise: Promise<T>,
  timeout: AbortSignal,
  deadline: Promise<{ type: "timeout" }>,
  cancel?: () => void | Promise<unknown>,
): Promise<Settled<T>> {
  let settled = false
  const operation = promise.then<Settled<T>, Settled<T>>(
    (value) => {
      settled = true
      return timeout.aborted ? { type: "timeout" } : { type: "value", value }
    },
    () => {
      settled = true
      return timeout.aborted ? { type: "timeout" } : { type: "failure" }
    },
  )
  const expired = deadline.then<Settled<T>>((result) => {
    if (!settled && cancel) void Promise.resolve(cancel()).catch(() => undefined)
    return result
  })
  return Promise.race([operation, expired])
}

async function readJSON(
  response: Response,
  timeout: AbortSignal,
  deadline: Promise<{ type: "timeout" }>,
): Promise<Settled<unknown>> {
  if (!response.body) {
    return againstTimeout(
      Promise.resolve().then(() => JSON.parse("") as unknown),
      timeout,
      deadline,
    )
  }

  const acquired = await Promise.resolve()
    .then(() => ({ reader: response.body!.getReader() }))
    .then(
      (value) => value,
      () => ({}),
    )
  if (!("reader" in acquired)) return { type: "failure" }
  const reader = acquired.reader
  const read = async (): Promise<unknown> => {
    const decoder = new TextDecoder()
    let text = ""
    while (true) {
      const result = await reader.read()
      if (result.done) break
      text += decoder.decode(result.value, { stream: true })
    }
    text += decoder.decode()
    return JSON.parse(text) as unknown
  }
  const result = await againstTimeout(read(), timeout, deadline, () => reader.cancel())
  reader.releaseLock()
  return result
}

function failure(current: URL, kind: CustomProvider.DiscoveryError["kind"], message: string, status?: number) {
  return new CustomProvider.DiscoveryError({
    endpoint: redactURL(current),
    ...(status === undefined ? {} : { status }),
    kind,
    message,
  })
}

function isCatalog(value: unknown) {
  if (Array.isArray(value)) return true
  if (!isRecord(value)) return false
  const wrapped = value.data ?? value.models ?? value.items
  if (wrapped === undefined) return true
  return Array.isArray(wrapped) || isRecord(wrapped)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export * as CustomProviderDiscovery from "./discovery"
