import { describe, expect, test } from "bun:test"
import { applySystemProxy, proxyState, syncSystemProxy, systemProxyURL, systemProxyVariables } from "./system-proxy"

describe("system proxy", () => {
  test("converts Electron proxy directives to proxy URLs", () => {
    expect(systemProxyURL("DIRECT")).toBeUndefined()
    expect(systemProxyURL("PROXY 127.0.0.1:7890; DIRECT")).toBe("http://127.0.0.1:7890")
    expect(systemProxyURL("HTTPS proxy.example.com:8443; DIRECT")).toBe("https://proxy.example.com:8443")
    expect(systemProxyURL("SOCKS5 localhost:1080; DIRECT")).toBe("socks5://localhost:1080")
    expect(systemProxyURL("SOCKS proxy.example.com:1080")).toBe("socks5://proxy.example.com:1080")
  })

  test("loads missing HTTP and HTTPS proxy variables from the system resolver", async () => {
    const env: Record<string, string | undefined> = {}
    const urls: string[] = []

    const result = await applySystemProxy(env, async (url) => {
      urls.push(url)
      return url.startsWith("https:")
        ? "PROXY secure-proxy.example.com:8443; DIRECT"
        : "PROXY proxy.example.com:8080; DIRECT"
    })

    expect(urls).toEqual(["http://opencode.ai", "https://opencode.ai"])
    expect(env).toEqual({
      HTTP_PROXY: "http://proxy.example.com:8080",
      http_proxy: "http://proxy.example.com:8080",
      HTTPS_PROXY: "http://secure-proxy.example.com:8443",
      https_proxy: "http://secure-proxy.example.com:8443",
    })
    expect(result).toEqual({ configured: ["HTTP_PROXY", "HTTPS_PROXY"], failed: [] })
  })

  test("refreshes managed proxies and clears them when the system returns to direct", async () => {
    const env: Record<string, string | undefined> = {}
    const variables = systemProxyVariables(env)
    const configured = await syncSystemProxy(env, variables, async (url) =>
      url.startsWith("https:") ? "PROXY secure-proxy.example.com:8443; DIRECT" : "PROXY proxy.example.com:8080; DIRECT",
    )

    expect(configured).toEqual({
      configured: ["HTTP_PROXY", "HTTPS_PROXY"],
      cleared: [],
      changed: ["HTTP_PROXY", "HTTPS_PROXY"],
      failed: [],
    })
    expect(proxyState(env)).toEqual({
      http: "http://proxy.example.com:8080",
      https: "http://secure-proxy.example.com:8443",
    })

    const unchanged = await syncSystemProxy(env, variables, async (url) =>
      url.startsWith("https:") ? "PROXY secure-proxy.example.com:8443; DIRECT" : "PROXY proxy.example.com:8080; DIRECT",
    )
    expect(unchanged.changed).toEqual([])

    const cleared = await syncSystemProxy(env, variables, async () => "DIRECT")

    expect(cleared).toEqual({
      configured: [],
      cleared: ["HTTP_PROXY", "HTTPS_PROXY"],
      changed: ["HTTP_PROXY", "HTTPS_PROXY"],
      failed: [],
    })
    expect(env).toEqual({})
    expect(proxyState(env)).toEqual({ http: null, https: null })
  })

  test("only marks proxy variables without explicit environment overrides as system managed", () => {
    expect(systemProxyVariables({})).toEqual(["HTTP_PROXY", "HTTPS_PROXY"])
    expect(systemProxyVariables({ http_proxy: "http://manual.example.com:9000" })).toEqual(["HTTPS_PROXY"])
    expect(systemProxyVariables({ ALL_PROXY: "socks5://manual.example.com:1080" })).toEqual([])
  })

  test("keeps explicit proxy variables and only resolves missing protocols", async () => {
    const env: Record<string, string | undefined> = {
      http_proxy: "http://manual.example.com:9000",
    }
    const urls: string[] = []

    const result = await applySystemProxy(env, async (url) => {
      urls.push(url)
      return "PROXY system.example.com:8080"
    })

    expect(urls).toEqual(["https://opencode.ai"])
    expect(env).toEqual({
      http_proxy: "http://manual.example.com:9000",
      HTTPS_PROXY: "http://system.example.com:8080",
      https_proxy: "http://system.example.com:8080",
    })
    expect(result).toEqual({ configured: ["HTTPS_PROXY"], failed: [] })
  })

  test("does not override an explicit all-protocol proxy", async () => {
    const env: Record<string, string | undefined> = {
      ALL_PROXY: "socks5://manual.example.com:1080",
    }
    let calls = 0

    const result = await applySystemProxy(env, async () => {
      calls += 1
      return "PROXY system.example.com:8080"
    })

    expect(calls).toBe(0)
    expect(env).toEqual({ ALL_PROXY: "socks5://manual.example.com:1080" })
    expect(result).toEqual({ configured: [], failed: [] })
  })

  test("keeps startup usable when one system resolution fails", async () => {
    const env: Record<string, string | undefined> = {}

    const result = await applySystemProxy(env, async (url) => {
      if (url.startsWith("https:")) throw new Error("resolver unavailable")
      return "PROXY proxy.example.com:8080"
    })

    expect(env).toEqual({
      HTTP_PROXY: "http://proxy.example.com:8080",
      http_proxy: "http://proxy.example.com:8080",
    })
    expect(result).toEqual({ configured: ["HTTP_PROXY"], failed: ["HTTPS_PROXY"] })
  })

  test("does not block startup when system proxy resolution stalls", async () => {
    const env: Record<string, string | undefined> = {}

    const result = await applySystemProxy(
      env,
      () => new Promise((resolve) => setTimeout(() => resolve("PROXY late.example.com:8080"), 20)),
      1,
    )

    expect(env).toEqual({})
    expect(result).toEqual({ configured: [], failed: ["HTTP_PROXY", "HTTPS_PROXY"] })
  })
})
