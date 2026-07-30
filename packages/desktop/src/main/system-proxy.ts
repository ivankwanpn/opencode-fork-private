const targets = [
  { key: "HTTP_PROXY", url: "http://opencode.ai" },
  { key: "HTTPS_PROXY", url: "https://opencode.ai" },
] as const

type Environment = Record<string, string | undefined>

export type Variable = (typeof targets)[number]["key"]

export type SystemProxyState = {
  readonly http: string | null
  readonly https: string | null
}

type Update = {
  readonly key: Variable
  readonly proxy: string | undefined
  readonly changed: boolean
}

export async function applySystemProxy(
  env: Environment,
  resolveProxy: (url: string) => Promise<string>,
  timeoutMs = 5_000,
) {
  const result = await syncSystemProxy(env, systemProxyVariables(env), resolveProxy, timeoutMs)
  return { configured: result.configured, failed: result.failed }
}

export function systemProxyVariables(env: Environment) {
  return targets.filter((target) => !hasExplicitProxy(env, target.key)).map((target) => target.key)
}

export async function syncSystemProxy(
  env: Environment,
  variables: readonly Variable[],
  resolveProxy: (url: string) => Promise<string>,
  timeoutMs = 5_000,
) {
  const pending = targets.filter((target) => variables.includes(target.key))
  const resolved = await Promise.allSettled(
    pending.map(async (target) => ({
      key: target.key,
      value: await resolveSystemProxy(resolveProxy, target.url, timeoutMs),
    })),
  )

  const updates = resolved
    .map((result): Update | undefined => {
      if (result.status === "rejected") return
      const lowercase = result.value.key.toLowerCase()
      const proxy = systemProxyURL(result.value.value)
      const changed = env[result.value.key] !== proxy || env[lowercase] !== proxy
      if (proxy === undefined) {
        delete env[result.value.key]
        delete env[lowercase]
        return { key: result.value.key, proxy, changed }
      }
      env[result.value.key] = proxy
      env[lowercase] = proxy
      return { key: result.value.key, proxy, changed }
    })
    .filter((update): update is Update => update !== undefined)
  const failed = resolved.flatMap((result, index) => (result.status === "rejected" ? [pending[index].key] : []))

  return {
    configured: updates.flatMap((update) => (update.proxy === undefined ? [] : [update.key])),
    cleared: updates.flatMap((update) => (update.proxy === undefined ? [update.key] : [])),
    changed: updates.flatMap((update) => (update.changed ? [update.key] : [])),
    failed,
  }
}

export function proxyState(env: Environment): SystemProxyState {
  return {
    http: env.HTTP_PROXY ?? env.http_proxy ?? null,
    https: env.HTTPS_PROXY ?? env.https_proxy ?? null,
  }
}

function resolveSystemProxy(resolveProxy: (url: string) => Promise<string>, url: string, timeoutMs: number) {
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("System proxy resolution timed out")), timeoutMs)
    void Promise.resolve()
      .then(() => resolveProxy(url))
      .then(
        (value) => {
          clearTimeout(timer)
          resolve(value)
        },
        (error) => {
          clearTimeout(timer)
          reject(error)
        },
      )
  })
}

export function systemProxyURL(value: string) {
  const selected = value
    .split(";")
    .map(proxyDirective)
    .find((directive) => directive !== undefined)
  if (!selected || selected.type === "direct") return
  return selected.url
}

function proxyDirective(value: string) {
  const directive = value.trim()
  if (!directive) return
  const separator = directive.indexOf(" ")
  const type = (separator === -1 ? directive : directive.slice(0, separator)).toUpperCase()
  if (type === "DIRECT") return { type: "direct" as const }
  if (separator === -1) return

  const scheme = proxyScheme(type)
  if (!scheme) return
  const address = directive.slice(separator + 1).trim()
  const url = address.includes("://") ? address : `${scheme}://${address}`
  if (!URL.canParse(url)) return
  return { type: "proxy" as const, url }
}

function proxyScheme(type: string) {
  if (type === "PROXY" || type === "HTTP") return "http"
  if (type === "HTTPS") return "https"
  if (type === "SOCKS4") return "socks4"
  if (type === "SOCKS" || type === "SOCKS5") return "socks5"
}

function hasExplicitProxy(env: Environment, key: (typeof targets)[number]["key"]) {
  return [key, key.toLowerCase(), "ALL_PROXY", "all_proxy"].some((name) => Boolean(env[name]?.trim()))
}
