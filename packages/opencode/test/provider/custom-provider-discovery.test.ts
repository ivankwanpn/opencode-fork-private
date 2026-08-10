import { afterEach, describe, expect, test } from "bun:test"
import { CustomProvider } from "@opencode-ai/schema/custom-provider"
import { Effect } from "effect"
import { discover } from "@/provider/custom-provider/discovery"

const servers: Bun.Server<undefined>[] = []
type Fetch = NonNullable<NonNullable<Parameters<typeof discover>[1]>["fetch"]>

afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true)
})

function serve(fetch: (request: Request) => Response | Promise<Response>) {
  const server = Bun.serve({ port: 0, fetch })
  servers.push(server)
  return server
}

function input(
  server: Bun.Server<undefined>,
  patch: Partial<CustomProvider.DiscoverInput> = {},
): CustomProvider.DiscoverInput {
  return {
    protocol: "openai-compatible",
    baseURL: `http://127.0.0.1:${server.port}/v1`,
    apiKey: "test-key",
    headers: [],
    ...patch,
  }
}

async function run(input: CustomProvider.DiscoverInput, timeoutMs = 90) {
  return Effect.runPromise(discover(input, { timeoutMs }))
}

async function fail(input: CustomProvider.DiscoverInput, options: Parameters<typeof discover>[1] = { timeoutMs: 90 }) {
  const error = await Effect.runPromise(Effect.flip(discover(input, options)))
  if (error._tag === "CustomProviderValidationError") throw error
  return error
}

describe("custom provider discovery", () => {
  test("sends OpenAI authentication and normalizes input before the request", async () => {
    const requests: { authorization: string | null; custom: string | null; pathname: string }[] = []
    const server = serve((request) => {
      requests.push({
        authorization: request.headers.get("authorization"),
        custom: request.headers.get("x-custom"),
        pathname: new URL(request.url).pathname,
      })
      return Response.json({ data: [{ id: "model-a" }] })
    })

    const result = await run({
      ...input(server),
      protocol: " openai-compatible ",
      baseURL: ` http://127.0.0.1:${server.port}/v1/ `,
      apiKey: " test-key ",
      headers: [{ name: " X-Custom ", value: " enabled " }],
    } as unknown as CustomProvider.DiscoverInput)

    expect(requests).toEqual([{ authorization: "Bearer test-key", custom: "enabled", pathname: "/v1/models" }])
    expect(result).toEqual({
      endpoint: `http://127.0.0.1:${server.port}/v1/models`,
      models: [{ id: "model-a" }],
    })
  })

  test("lets a user authorization header replace the OpenAI default case-insensitively", async () => {
    const values: (string | null)[] = []
    const server = serve((request) => {
      values.push(request.headers.get("authorization"))
      return Response.json({ data: [] })
    })

    await run(input(server, { headers: [{ name: "authorization", value: "Custom credential" }] }))

    expect(values).toEqual(["Custom credential"])
  })

  test("sends Anthropic defaults and lets user headers replace them case-insensitively", async () => {
    const values: { key: string | null; version: string | null }[] = []
    const server = serve((request) => {
      values.push({
        key: request.headers.get("x-api-key"),
        version: request.headers.get("anthropic-version"),
      })
      return Response.json({ data: [] })
    })

    await run(input(server, { protocol: "anthropic-messages" }))
    await run(
      input(server, {
        protocol: "anthropic-messages",
        headers: [
          { name: "X-API-Key", value: "custom-key" },
          { name: "Anthropic-Version", value: "custom-version" },
        ],
      }),
    )

    expect(values).toEqual([
      { key: "test-key", version: "2023-06-01" },
      { key: "custom-key", version: "custom-version" },
    ])
  })

  test("uses Claude Code discovery headers for Coding Agent endpoints and lets user headers replace them", async () => {
    const values: {
      authorization: string | null
      key: string | null
      version: string | null
      userAgent: string | null
      pathname: string
    }[] = []
    const server = serve((request) => {
      values.push({
        authorization: request.headers.get("authorization"),
        key: request.headers.get("x-api-key"),
        version: request.headers.get("anthropic-version"),
        userAgent: request.headers.get("user-agent"),
        pathname: new URL(request.url).pathname,
      })
      return Response.json({ data: [{ id: "ark-code-latest" }] })
    })
    const baseURL = `http://127.0.0.1:${server.port}/api/coding`

    await run(input(server, { protocol: "anthropic-messages", baseURL }))
    await run(
      input(server, {
        protocol: "anthropic-messages",
        baseURL,
        headers: [
          { name: "Authorization", value: "Custom credential" },
          { name: "User-Agent", value: "custom-agent/1.0" },
        ],
      }),
    )

    expect(values).toEqual([
      {
        authorization: "Bearer test-key",
        key: null,
        version: null,
        userAgent: "claude-cli/2.1.161 (external, cli)",
        pathname: "/api/coding/v1/models",
      },
      {
        authorization: "Custom credential",
        key: null,
        version: null,
        userAgent: "custom-agent/1.0",
        pathname: "/api/coding/v1/models",
      },
    ])
  })

  test("falls back after candidate misses but accepts the first valid empty catalog", async () => {
    const paths: string[] = []
    const server = serve((request) => {
      const path = new URL(request.url).pathname
      paths.push(path)
      if (path === "/paas/v4/models") return new Response(null, { status: 404 })
      if (path === "/paas/v4/v1/models") return Response.json({ data: [] })
      return Response.json({ data: [{ id: "must-not-be-requested" }] })
    })

    const result = await run(input(server, { baseURL: `http://127.0.0.1:${server.port}/paas/v4` }))

    expect(paths).toEqual(["/paas/v4/models", "/paas/v4/v1/models"])
    expect(result).toEqual({
      endpoint: `http://127.0.0.1:${server.port}/paas/v4/v1/models`,
      models: [],
    })
  })

  test("treats 405 as a candidate miss", async () => {
    const paths: string[] = []
    const server = serve((request) => {
      const path = new URL(request.url).pathname
      paths.push(path)
      if (path === "/paas/v4/models") return new Response(null, { status: 405 })
      return Response.json({ models: ["model-a"] })
    })

    const result = await run(input(server, { baseURL: `http://127.0.0.1:${server.port}/paas/v4` }))

    expect(paths).toEqual(["/paas/v4/models", "/paas/v4/v1/models"])
    expect(result.models).toEqual([{ id: "model-a" }])
  })

  test("follows up to three same-origin redirects", async () => {
    const paths: string[] = []
    const server = serve((request) => {
      const path = new URL(request.url).pathname
      paths.push(path)
      if (path === "/v1/models") return new Response(null, { status: 302, headers: { location: "/one" } })
      if (path === "/one") return new Response(null, { status: 307, headers: { location: "/two" } })
      if (path === "/two") return new Response(null, { status: 308, headers: { location: "/three" } })
      return Response.json({ data: [{ id: "model-a" }] })
    })

    const result = await run(input(server))

    expect(paths).toEqual(["/v1/models", "/one", "/two", "/three"])
    expect(result.endpoint).toBe(`http://127.0.0.1:${server.port}/three`)
  })

  test("rejects a fourth redirect without requesting its target", async () => {
    const paths: string[] = []
    const server = serve((request) => {
      const path = new URL(request.url).pathname
      paths.push(path)
      const redirects: Record<string, string> = {
        "/v1/models": "/one",
        "/one": "/two",
        "/two": "/three",
        "/three": "/four",
      }
      return new Response(null, { status: 302, headers: { location: redirects[path] } })
    })

    const error = await fail(input(server))

    expect(error.kind).toBe("redirect")
    expect(paths).toEqual(["/v1/models", "/one", "/two", "/three"])
  })

  test("rejects a cross-origin redirect without contacting the target", async () => {
    let targetRequests = 0
    const target = serve(() => {
      targetRequests++
      return Response.json({ data: [{ id: "target-model" }] })
    })
    const source = serve(
      () =>
        new Response(null, {
          status: 302,
          headers: { location: `http://127.0.0.1:${target.port}/models` },
        }),
    )

    const error = await fail(input(source))

    expect(error.kind).toBe("redirect")
    expect(targetRequests).toBe(0)
  })

  test("uses one timeout signal for the entire candidate sequence", async () => {
    const signals: AbortSignal[] = []
    const fetch: Fetch = async (_request, init) => {
      signals.push(init?.signal as AbortSignal)
      if (signals.length === 1) return new Response(null, { status: 404 })
      return new Promise((_resolve, reject) => {
        const abort = () => reject(init?.signal?.reason ?? new DOMException("Aborted", "AbortError"))
        if (init?.signal?.aborted) return abort()
        init?.signal?.addEventListener("abort", abort, { once: true })
      })
    }
    // Bun unrefs AbortSignal.timeout(); this handle keeps the injected-fetch test alive but is never awaited.
    const keepAlive = setInterval(() => {}, 1_000)

    const error = await fail(
      {
        protocol: "openai-compatible",
        baseURL: "http://127.0.0.1:1/paas/v4",
        headers: [],
      },
      { fetch, timeoutMs: 20 },
    ).finally(() => clearInterval(keepAlive))

    expect(error.kind).toBe("timeout")
    expect(signals).toHaveLength(2)
    expect(signals[0]).toBe(signals[1])
    expect(signals[0]?.aborted).toBe(true)
  })

  test("preserves timeout classification while reading a response body", async () => {
    const fetch: Fetch = async (_request, init) =>
      new Response(
        new ReadableStream({
          start(controller) {
            const abort = () => controller.error(init?.signal?.reason ?? new DOMException("Aborted", "AbortError"))
            if (init?.signal?.aborted) return abort()
            init?.signal?.addEventListener("abort", abort, { once: true })
          },
        }),
      )
    // Bun unrefs AbortSignal.timeout(); this handle keeps the injected-fetch test alive but is never awaited.
    const keepAlive = setInterval(() => {}, 1_000)

    const error = await fail(
      {
        protocol: "openai-compatible",
        baseURL: "http://127.0.0.1:1/v1",
        headers: [],
      },
      { fetch, timeoutMs: 20 },
    ).finally(() => clearInterval(keepAlive))

    expect(error.kind).toBe("timeout")
  })

  test("enforces the deadline when an injected fetch resolves late and ignores its signal", async () => {
    const fetch: Fetch = async () =>
      new Promise((resolve) => {
        setTimeout(() => resolve(new Response(null, { status: 404 })), 60)
      })

    const error = await fail(
      {
        protocol: "openai-compatible",
        baseURL: "http://127.0.0.1:1/v1",
        headers: [],
      },
      { fetch, timeoutMs: 10 },
    )

    expect(error.kind).toBe("timeout")
  })

  test("times out and cancels a non-settling response body that ignores the signal", async () => {
    let cancellations = 0
    const controls: { error?: () => void } = {}
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controls.error = () => controller.error(new Error("test cleanup"))
        },
        cancel() {
          cancellations++
        },
      }),
    )
    const fetch: Fetch = async () => response
    const discovery = fail(
      {
        protocol: "openai-compatible",
        baseURL: "http://127.0.0.1:1/v1",
        headers: [],
      },
      { fetch, timeoutMs: 10 },
    )
    const bounded = new Promise<CustomProvider.DiscoveryError | undefined>((resolve) => {
      const guard = setTimeout(() => {
        controls.error?.()
        resolve(undefined)
      }, 80)
      discovery.then((error) => {
        clearTimeout(guard)
        resolve(error)
      })
    })

    const error = await bounded

    expect(error?.kind).toBe("timeout")
    expect(cancellations).toBe(1)
    expect(response.body?.locked).toBe(false)
  })

  test("releases the response body after decoding JSON split inside a four-byte UTF-8 character", async () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ data: [{ id: "model-😀" }] }))
    const split = bytes.indexOf(0xf0) + 2
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(bytes.slice(0, split))
          controller.enqueue(bytes.slice(split))
          controller.close()
        },
      }),
    )
    const fetch: Fetch = async () => response

    const result = await Effect.runPromise(
      discover(
        {
          protocol: "openai-compatible",
          baseURL: "http://127.0.0.1:1/v1",
          headers: [],
        },
        { fetch, timeoutMs: 90 },
      ),
    )

    expect(result.models).toEqual([{ id: "model-😀" }])
    expect(response.body?.locked).toBe(false)
  })

  test("releases the response body after malformed JSON is classified as shape", async () => {
    const response = new Response("{malformed")
    const fetch: Fetch = async () => response

    const error = await fail(
      {
        protocol: "openai-compatible",
        baseURL: "http://127.0.0.1:1/v1",
        headers: [],
      },
      { fetch, timeoutMs: 90 },
    )

    expect(error.kind).toBe("shape")
    expect(response.body?.locked).toBe(false)
  })

  test("classifies pre-locked response bodies as redacted shape errors", async () => {
    const response = Response.json({ data: [] })
    const reader = response.body!.getReader()
    const fetch: Fetch = async () => response

    const error = await fail(
      {
        protocol: "openai-compatible",
        baseURL: "http://127.0.0.1:1/v1?query-secret#fragment-secret",
        headers: [],
      },
      { fetch, timeoutMs: 90 },
    ).finally(() => reader.releaseLock())
    const publicValue = JSON.stringify(error)

    expect(error).toMatchObject({
      kind: "shape",
      endpoint: "http://127.0.0.1:1/v1",
      status: 200,
    })
    expect(publicValue).not.toContain("locked")
    expect(publicValue).not.toContain("query-secret")
    expect(publicValue).not.toContain("fragment-secret")
  })

  test("preserves an earlier substantive status failure over a trailing candidate miss", async () => {
    const server = serve((request) =>
      new URL(request.url).pathname === "/paas/v4/models"
        ? new Response(null, { status: 500 })
        : new Response(null, { status: 404 }),
    )

    const error = await fail(input(server, { baseURL: `http://127.0.0.1:${server.port}/paas/v4` }))

    expect(error).toMatchObject({ kind: "status", status: 500 })
  })

  test("resolves environment credentials from only the injected environment", async () => {
    const keys: (string | null)[] = []
    const server = serve((request) => {
      keys.push(request.headers.get("authorization"))
      return Response.json({ data: [] })
    })

    await Effect.runPromise(
      discover(input(server, { apiKey: "{env:MODEL_KEY}" }), {
        env: { MODEL_KEY: "injected-key" },
        timeoutMs: 90,
      }),
    )

    expect(keys).toEqual(["Bearer injected-key"])
  })

  test("reports a missing environment credential before making a network request", async () => {
    let requests = 0
    const fetch: Fetch = async () => {
      requests++
      return Response.json({ data: [] })
    }

    const error = await fail(
      {
        protocol: "openai-compatible",
        baseURL: "https://example.com/v1",
        apiKey: "{env:MODEL_KEY}",
        headers: [],
      },
      { env: {}, fetch, timeoutMs: 90 },
    )

    expect(error.kind).toBe("environment")
    expect(requests).toBe(0)
    expect(JSON.stringify(error)).not.toContain("MODEL_KEY")
  })

  test("returns a redacted shape error for an invalid response", async () => {
    const bodySecret = "body-secret"
    const server = serve(() => new Response(bodySecret, { headers: { "x-secret": "header-secret" } }))
    const error = await fail({
      ...input(server),
      baseURL: `http://127.0.0.1:${server.port}/v1?api_key=query-secret#fragment-secret`,
      apiKey: "test-key",
      headers: [{ name: "X-Secret", value: "request-header-secret" }],
    })
    const publicValue = JSON.stringify(error)

    expect(error).toMatchObject({
      kind: "shape",
      endpoint: `http://127.0.0.1:${server.port}/v1`,
      status: 200,
    })
    for (const secret of [
      bodySecret,
      "header-secret",
      "request-header-secret",
      "test-key",
      "query-secret",
      "fragment-secret",
    ]) {
      expect(publicValue).not.toContain(secret)
    }
  })

  test("normalizes, deduplicates, and sorts discovered models", async () => {
    const server = serve(() =>
      Response.json({
        data: [
          { id: " z ", context_window: 0 },
          { id: "a", display_name: " Model A ", reasoning: true, context_window: 10, max_output: 5 },
          { id: "z", display_name: "Last duplicate" },
        ],
      }),
    )

    const result = await run(input(server))

    expect(result.models).toEqual([
      { id: "a", name: "Model A", reasoning: true, context: 10, output: 5 },
      { id: "z", name: "Last duplicate" },
    ])
  })
})
