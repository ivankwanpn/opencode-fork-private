import { describe, expect } from "bun:test"
import { Database as SqliteDatabase } from "bun:sqlite"
import { Effect } from "effect"
import path from "node:path"
import { cliIt } from "../../lib/cli-process"
import { testProviderConfig } from "../../lib/test-provider"
import { createGeneratedLifecycleClient, type LifecycleContext } from "../../server/v2-lifecycle-contract"

const publicEventTypes = new Set([
  "session.next.prompt.admitted",
  "session.next.prompted",
  "session.next.turn.started",
  "session.next.step.started",
  "session.next.text.started",
  "session.next.text.ended",
  "session.next.tool.input.started",
  "session.next.tool.input.ended",
  "session.next.tool.called",
  "session.next.tool.success",
  "session.next.tool.failed",
  "session.next.step.ended",
  "session.next.turn.ended",
  "session.next.input.terminalized",
])

describe("opencode Classic/Kernel recorded shadow", () => {
  cliIt.live(
    "matches the text-turn request, transcript, event order, and terminal outcome",
    ({ home, llm, opencode }) =>
      Effect.gen(function* () {
        const databaseName = "opencode-kernel-shadow.db"
        const server = yield* opencode.serve({
          env: {
            OPENCODE_DB: databaseName,
            OPENCODE_PURE: "0",
            OPENCODE_DISABLE_DEFAULT_PLUGINS: "1",
            OPENCODE_CONFIG_CONTENT: JSON.stringify(testProviderConfig(llm.url)),
          },
        })
        const client = createGeneratedLifecycleClient({ baseUrl: server.url, directory: home })
        const classicID = `ses_shadow_classic_${crypto.randomUUID().replaceAll("-", "")}`
        const kernelID = `ses_shadow_kernel_${crypto.randomUUID().replaceAll("-", "")}`
        yield* llm.text("recorded shadow response")
        yield* llm.text("recorded shadow response")

        for (const [sessionID, engine] of [
          [classicID, "classic"],
          [kernelID, "kernel"],
        ] as const) {
          yield* Effect.promise(() =>
            client.create({
              id: sessionID,
              directory: home,
              engine,
              model: { providerID: "test", id: "test-model" },
            }),
          )
          yield* Effect.promise(() =>
            client.prompt({
              sessionID,
              id: `msg_shadow_${engine}_${crypto.randomUUID().replaceAll("-", "")}`,
              text: "recorded shadow prompt",
              resume: true,
            }),
          )
          yield* Effect.promise(() => waitForIdle(client.active, sessionID))
        }

        const inputs = (yield* llm.inputs).filter(
          (input) => !JSON.stringify(input).includes("Generate a title for this conversation"),
        )
        expect(inputs).toHaveLength(2)
        expect(normalizeProviderRequest(inputs[1])).toEqual(normalizeProviderRequest(inputs[0]))

        const classicContext = normalizeContext(yield* Effect.promise(() => client.context(classicID)))
        const kernelContext = normalizeContext(yield* Effect.promise(() => client.context(kernelID)))
        expect(kernelContext).toEqual(classicContext)
        expect(kernelContext).toEqual([
          { type: "user", text: "recorded shadow prompt" },
          { type: "assistant", content: [{ type: "text", text: "recorded shadow response" }] },
        ])

        const database = new SqliteDatabase(path.join(home, ".local", "share", "opencode", databaseName))
        try {
          const classic = readShadowDatabase(database, classicID)
          const kernel = readShadowDatabase(database, kernelID)
          expect(kernel.events).toEqual(classic.events)
          expect(kernel.tools).toEqual(classic.tools)
          expect(kernel.terminal).toEqual(classic.terminal)
          expect(kernel.terminal.terminal_outcome).toBe("completed")
        } finally {
          database.close()
        }
      }),
    60_000,
  )

  cliIt.live(
    "matches recorded tool requests, result order, transcript, and terminal outcome",
    ({ home, llm, opencode }) =>
      Effect.gen(function* () {
        const databaseName = "opencode-kernel-tool-shadow.db"
        yield* Effect.promise(() => Bun.write(path.join(home, "shadow.txt"), "durable shadow fixture\n"))
        const server = yield* opencode.serve({
          env: {
            OPENCODE_DB: databaseName,
            OPENCODE_PURE: "0",
            OPENCODE_DISABLE_DEFAULT_PLUGINS: "1",
            OPENCODE_CONFIG_CONTENT: JSON.stringify(testProviderConfig(llm.url)),
          },
        })
        const client = createGeneratedLifecycleClient({ baseUrl: server.url, directory: home })
        const classicID = `ses_tool_shadow_classic_${crypto.randomUUID().replaceAll("-", "")}`
        const kernelID = `ses_tool_shadow_kernel_${crypto.randomUUID().replaceAll("-", "")}`
        yield* llm.tool("read", { path: "shadow.txt" })
        yield* llm.text("recorded tool shadow response")
        yield* llm.tool("read", { path: "shadow.txt" })
        yield* llm.text("recorded tool shadow response")

        for (const [sessionID, engine] of [
          [classicID, "classic"],
          [kernelID, "kernel"],
        ] as const) {
          yield* Effect.promise(() =>
            client.create({
              id: sessionID,
              directory: home,
              engine,
              model: { providerID: "test", id: "test-model" },
            }),
          )
          yield* Effect.promise(() =>
            client.prompt({
              sessionID,
              id: `msg_tool_shadow_${engine}_${crypto.randomUUID().replaceAll("-", "")}`,
              text: "read the recorded shadow fixture",
              resume: true,
            }),
          )
          yield* Effect.promise(() => waitForIdle(client.active, sessionID))
        }

        const inputs = (yield* llm.inputs).filter(
          (input) => !JSON.stringify(input).includes("Generate a title for this conversation"),
        )
        expect(inputs).toHaveLength(4)
        expect(normalizeProviderRequest(inputs[2])).toEqual(normalizeProviderRequest(inputs[0]))
        expect(normalizeProviderRequest(inputs[3])).toEqual(normalizeProviderRequest(inputs[1]))

        const classicContext = normalizeContext(yield* Effect.promise(() => client.context(classicID)))
        const kernelContext = normalizeContext(yield* Effect.promise(() => client.context(kernelID)))
        expect(kernelContext).toEqual(classicContext)
        expect(
          kernelContext.flatMap((message) =>
            "content" in message && Array.isArray(message.content)
              ? message.content.flatMap((content) => {
                  if (!content || typeof content !== "object" || !("type" in content)) return []
                  if (content.type === "text" && "text" in content) return [`text:${String(content.text)}`]
                  if (content.type === "tool" && "state" in content && content.state && typeof content.state === "object")
                    return [
                      `tool:${"name" in content ? String(content.name) : "unknown"}:${
                        "status" in content.state ? String(content.state.status) : "unknown"
                      }`,
                    ]
                  return []
                })
              : [],
          ),
        ).toEqual(["tool:read:completed", "text:recorded tool shadow response"])

        const database = new SqliteDatabase(path.join(home, ".local", "share", "opencode", databaseName))
        try {
          const classic = readShadowDatabase(database, classicID)
          const kernel = readShadowDatabase(database, kernelID)
          expect(kernel.events).toEqual(classic.events)
          expect(kernel.tools).toEqual(classic.tools)
          expect(kernel.tools).toEqual(["session.next.tool.called", "session.next.tool.success"])
          expect(kernel.terminal).toEqual(classic.terminal)
          expect(kernel.terminal.terminal_outcome).toBe("completed")
        } finally {
          database.close()
        }
      }),
    60_000,
  )

  cliIt.live(
    "keeps median first-live-delta latency within ten percent of Classic",
    ({ home, llm, opencode }) =>
      Effect.gen(function* () {
        const server = yield* opencode.serve({
          extraArgs: ["--print-logs"],
          env: {
            OPENCODE_DB: "opencode-kernel-latency-shadow.db",
            OPENCODE_PURE: "0",
            OPENCODE_DISABLE_DEFAULT_PLUGINS: "1",
            OPENCODE_CONFIG_CONTENT: JSON.stringify(testProviderConfig(llm.url)),
          },
        })
        const client = createGeneratedLifecycleClient({ baseUrl: server.url, directory: home })
        const warmID = `ses_latency_warm_${crypto.randomUUID().replaceAll("-", "")}`
        yield* llm.text("latency location warm-up")
        yield* Effect.promise(() =>
          client.create({
            id: warmID,
            directory: home,
            engine: "classic",
            model: { providerID: "test", id: "test-model" },
          }),
        )
        yield* Effect.promise(() =>
          client.prompt({
            sessionID: warmID,
            id: `msg_latency_warm_${crypto.randomUUID().replaceAll("-", "")}`,
            text: "warm the latency location without an SSE subscriber",
            resume: true,
          }),
        )
        yield* Effect.promise(() => waitForIdle(client.active, warmID))
        const measure = Effect.fn("KernelShadow.measureFirstDelta")(function* (
          engine: "classic" | "kernel",
          index: number,
        ) {
          const sessionID = `ses_latency_${engine}_${index}_${crypto.randomUUID().replaceAll("-", "")}`
          const prompt = `first live delta ${engine} ${index} ${crypto.randomUUID()}`
          yield* Effect.promise(() =>
            client.create({
              id: sessionID,
              directory: home,
              engine,
              model: { providerID: "test", id: "test-model" },
            }),
          )
          const eventConnection = new AbortController()
          const delta = waitForTextDelta(
            yield* Effect.promise(() => client.liveEvents(eventConnection.signal)),
            sessionID,
          )
          const providerGate = Promise.withResolvers<void>()
          yield* llm.hold(`latency response ${engine} ${index}`, providerGate.promise)
          const startedAt = performance.now()
          return yield* Effect.gen(function* () {
            yield* Effect.promise(() =>
              client.prompt({
                sessionID,
                id: `msg_latency_${engine}_${index}_${crypto.randomUUID().replaceAll("-", "")}`,
                text: prompt,
                resume: true,
              }),
            )
            yield* waitForProviderPrompt(llm.inputs, prompt).pipe(
              Effect.timeoutOrElse({
                duration: "10 seconds",
                orElse: () => Effect.die(`Provider did not receive ${prompt}`),
              }),
            )
            yield* Effect.sleep("250 millis")
            providerGate.resolve()
            const observedAt = yield* Effect.promise(() => delta)
            yield* Effect.promise(() => waitForIdle(client.active, sessionID))
            return observedAt - startedAt
          }).pipe(
            Effect.ensuring(
              Effect.sync(() => {
                providerGate.resolve()
                eventConnection.abort()
              }),
            ),
          )
        })

        yield* measure("classic", -1).pipe(
          Effect.catchCause((cause) =>
            Effect.sync(() => console.error(`first-live-delta server stderr:\n${server.stderr()}`)).pipe(
              Effect.andThen(Effect.failCause(cause)),
            ),
          ),
        )
        yield* measure("kernel", -1)
        const pairs = yield* Effect.forEach(
          Array.from({ length: 6 }, (_, index) => index),
          (index) => Effect.all([measure("classic", index), measure("kernel", index)]),
        )
        const classic = pairs.map(([value]) => value)
        const kernel = pairs.map(([, value]) => value)
        const classicMedian = median(classic)
        const kernelMedian = median(kernel)
        console.log(
          `Classic/Kernel first live delta shadow ${JSON.stringify({
            classicMs: classic,
            kernelMs: kernel,
            classicMedianMs: classicMedian,
            kernelMedianMs: kernelMedian,
            regression: kernelMedian / classicMedian - 1,
          })}`,
        )
        expect(kernelMedian).toBeLessThanOrEqual(classicMedian * 1.1)
      }),
    90_000,
  )
})

async function waitForIdle(active: () => Promise<Record<string, unknown>>, sessionID: string) {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    if (!(sessionID in (await active()))) return
    await Bun.sleep(10)
  }
  throw new Error(`Session ${sessionID} did not become idle`)
}

async function waitForTextDelta(
  events: AsyncIterable<{ readonly type: string; readonly data?: { readonly sessionID?: string } }>,
  sessionID: string,
) {
  const seen: string[] = []
  const deadline = Bun.sleep(20_000).then(() => {
    throw new Error(`Timed out waiting for first live text delta; observed ${seen.join(", ") || "no events"}`)
  })
  const observed = (async () => {
    for await (const event of events) {
      if (seen.length < 50) seen.push(`${event.type}:${event.data?.sessionID ?? "global"}`)
      if (event.type === "session.next.text.delta" && event.data?.sessionID === sessionID) return performance.now()
    }
    throw new Error(`Session event stream closed before first live text delta; observed ${seen.join(", ")}`)
  })()
  return await Promise.race([observed, deadline])
}

function waitForProviderPrompt(inputs: Effect.Effect<Record<string, unknown>[]>, prompt: string): Effect.Effect<void> {
  return inputs.pipe(
    Effect.flatMap((requests) =>
      requests.some((request) => JSON.stringify(request).includes(prompt))
        ? Effect.void
        : Effect.sleep("5 millis").pipe(Effect.andThen(Effect.suspend(() => waitForProviderPrompt(inputs, prompt)))),
    ),
  )
}

function median(values: ReadonlyArray<number>) {
  const sorted = values.toSorted((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[middle]
  return (sorted[middle - 1] + sorted[middle]) / 2
}

function normalizeProviderRequest(input: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(input).filter(([key]) => !["prompt_cache_key", "user"].includes(key)),
  )
}

function readShadowDatabase(database: SqliteDatabase, sessionID: string) {
  const types = (
    database.query("SELECT type FROM event WHERE aggregate_id = ? ORDER BY seq ASC").all(sessionID) as Array<{
      type: string
    }>
  )
    .map((event) => event.type.replace(/\.\d+$/, ""))
    .filter((type) => publicEventTypes.has(type))
  const toolTypes = new Set([
    "session.next.tool.called",
    "session.next.tool.success",
    "session.next.tool.failed",
  ])
  return {
    events: types.filter((type) => !toolTypes.has(type)),
    tools: types.filter((type) => toolTypes.has(type)),
    terminal: database
      .query("SELECT terminal_outcome FROM session_input WHERE session_id = ?")
      .get(sessionID) as { terminal_outcome: string | null },
  }
}

function normalizeContext(context: LifecycleContext) {
  return context
    .filter((item) => item.type === "user" || item.type === "assistant")
    .map((item) => ({
      type: item.type,
      ...(item.text === undefined ? {} : { text: item.text }),
      ...(item.content === undefined
        ? {}
        : {
            content: item.content.map((content) => {
              if (!content || typeof content !== "object") return content
              return Object.fromEntries(
                Object.entries(content).filter(([key]) => !["id", "time", "providerMetadata"].includes(key)),
              )
            }),
          }),
    }))
}
