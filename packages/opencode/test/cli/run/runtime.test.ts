import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { OpenCode } from "@opencode-ai/client"
import { OpencodeClient } from "@opencode-ai/sdk/v2"
import { runInteractiveMode } from "@/cli/cmd/run/runtime"
import type { FooterApi, RunProvider } from "@/cli/cmd/run/types"

type SessionMessage = NonNullable<Awaited<ReturnType<OpencodeClient["session"]["messages"]>>["data"]>[number]

const provider: RunProvider = {
  id: "openai",
  name: "OpenAI",
  source: "api",
  env: [],
  options: {},
  models: {
    "gpt-5": {
      id: "gpt-5",
      providerID: "openai",
      api: {
        id: "openai",
        url: "https://openai.test",
        npm: "@ai-sdk/openai",
      },
      name: "Little Frank",
      capabilities: {
        temperature: true,
        reasoning: true,
        attachment: true,
        toolcall: true,
        input: {
          text: true,
          audio: false,
          image: false,
          video: false,
          pdf: false,
        },
        output: {
          text: true,
          audio: false,
          image: false,
          video: false,
          pdf: false,
        },
        interleaved: false,
      },
      cost: {
        input: 0,
        output: 0,
        cache: {
          read: 0,
          write: 0,
        },
      },
      limit: {
        context: 128000,
        output: 8192,
      },
      status: "active",
      options: {},
      headers: {},
      release_date: "2026-01-01",
    },
  },
}

const transportProviders: RunProvider[][] = []

function defer<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function ok<T>(data: T) {
  return Promise.resolve({
    data,
    error: undefined,
    request: new Request("https://opencode.test"),
    response: new Response(),
  })
}

function nativeSessionClient(requests: string[] = []) {
  return OpenCode.make({
    baseUrl: "https://opencode.test",
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init)
      requests.push(new URL(request.url).pathname)
      return Response.json({ data: { id: "ses-1", title: "Session" } })
    }) as unknown as typeof globalThis.fetch,
  })
}

function footer(): FooterApi {
  let closed = false
  const closes = new Set<() => void>()

  const notify = () => {
    for (const fn of closes) fn()
  }

  return {
    get isClosed() {
      return closed
    },
    onPrompt: () => () => {},
    onQueuedRemove: () => () => {},
    onClose(fn) {
      if (closed) {
        fn()
        return () => {}
      }

      closes.add(fn)
      return () => {
        closes.delete(fn)
      }
    },
    event() {},
    append() {},
    idle() {
      return Promise.resolve()
    },
    close() {
      if (closed) {
        return
      }

      closed = true
      notify()
    },
    destroy() {
      if (closed) {
        return
      }

      closed = true
      notify()
    },
  }
}

afterEach(() => {
  mock.restore()
  transportProviders.length = 0
})

describe("run interactive runtime", () => {
  test("waits for provider metadata before eager replay transport bootstrap", async () => {
    const providersStarted = defer<void>()
    const providers = defer<void>()
    const nativeRequests: string[] = []

    const sdk = new OpencodeClient()
    spyOn(sdk.config, "providers").mockImplementation(async () => {
      providersStarted.resolve()
      await providers.promise
      return ok({ providers: [provider], default: {} })
    })
    spyOn(sdk.session, "messages").mockImplementation(() =>
      ok([
        {
          info: {
            id: "msg-user-1",
            sessionID: "ses-1",
            role: "user",
            time: {
              created: 1,
            },
            agent: "build",
            model: {
              providerID: "openai",
              modelID: "gpt-5",
              variant: undefined,
            },
          },
          parts: [
            {
              id: "part-user-1",
              sessionID: "ses-1",
              messageID: "msg-user-1",
              type: "text",
              text: "hello",
            },
          ],
        } satisfies SessionMessage,
      ]),
    )
    spyOn(sdk.session, "get").mockRejectedValue(new Error("not needed"))
    spyOn(sdk.app, "agents").mockImplementation(() => ok([]))
    spyOn(sdk.experimental.resource, "list").mockImplementation(() => ok({}))
    spyOn(sdk.command, "list").mockImplementation(() => ok([]))

    const task = runInteractiveMode(
      {
        sdk,
        native: nativeSessionClient(nativeRequests),
        directory: "/tmp",
        sessionID: "ses-1",
        sessionTitle: "Session",
        resume: true,
        replay: true,
        replayLimit: 100,
        agent: "build",
        model: {
          providerID: "openai",
          modelID: "gpt-5",
        },
        variant: undefined,
        files: [],
        thinking: true,
        backgroundSubagents: false,
      },
      {
        createRuntimeLifecycle: async () => ({
          footer: footer(),
          onResize: () => () => {},
          refreshTheme: () => {},
          resetForReplay: () => Promise.resolve(),
          close: () => Promise.resolve(),
        }),
        streamTransport: Promise.resolve({
          createSessionTransport: async (input: { providers?: () => RunProvider[]; footer: FooterApi }) => {
            transportProviders.push(input.providers?.() ?? [])
            setTimeout(() => {
              input.footer.close()
            }, 0)
            return {
              runPromptTurn: async () => {},
              selectSubagent: () => {},
              replayOnResize: async () => false,
              close: async () => {},
            }
          },
          formatUnknownError: (error: unknown) => (error instanceof Error ? error.message : String(error)),
        }),
      },
    )

    await providersStarted.promise

    expect(transportProviders).toEqual([])

    providers.resolve()

    await task

    expect(transportProviders).toEqual([[provider]])
    expect(nativeRequests).toEqual(["/api/session/ses-1"])
  })

  test("uses the native client for file discovery and interactive replies", async () => {
    const sdk = new OpencodeClient()
    spyOn(sdk.config, "providers").mockImplementation(() => ok({ providers: [provider], default: {} }))
    spyOn(sdk.app, "agents").mockImplementation(() => ok([]))
    spyOn(sdk.experimental.resource, "list").mockImplementation(() => ok({}))
    spyOn(sdk.command, "list").mockImplementation(() => ok([]))

    const requests: Array<{ method: string; pathname: string; body?: unknown }> = []
    const native = OpenCode.make({
      baseUrl: "https://opencode.test",
      fetch: (async (input, init) => {
        const request = new Request(input, init)
        requests.push({
          method: request.method,
          pathname: new URL(request.url).pathname,
          body: request.body ? await request.clone().json() : undefined,
        })

        if (new URL(request.url).pathname === "/api/fs/find") {
          return Response.json({
            location: {
              directory: "/tmp",
              project: { id: "project-1", directory: "/tmp" },
            },
            data: [{ path: "src/index.ts", type: "file" }],
          })
        }

        if (new URL(request.url).pathname === "/api/session/ses-1/background") return Response.json(true)
        return new Response(null, { status: 204 })
      }) as typeof globalThis.fetch,
    })

    let files: string[] = []
    await runInteractiveMode(
      {
        sdk,
        native,
        directory: "/tmp",
        sessionID: "ses-1",
        sessionTitle: "Session",
        resume: false,
        agent: "build",
        model: {
          providerID: "openai",
          modelID: "gpt-5",
        },
        variant: undefined,
        files: [],
        thinking: true,
        backgroundSubagents: false,
      },
      {
        createRuntimeLifecycle: async (input) => {
          files = await input.findFiles("src")
          await input.onPermissionReply({ requestID: "permission-1", reply: "once" })
          await input.onQuestionReply({ requestID: "question-1", answers: [["yes"]] })
          input.onBackground?.()
          const surface = footer()
          return {
            footer: surface,
            onResize: () => () => {},
            refreshTheme: () => {},
            resetForReplay: () => Promise.resolve(),
            close: () => Promise.resolve(),
          }
        },
        streamTransport: Promise.resolve({
          createSessionTransport: async (input) => {
            setTimeout(() => {
              input.footer.close()
            }, 0)
            return {
              runPromptTurn: async () => {},
              selectSubagent: () => {},
              replayOnResize: async () => false,
              close: async () => {},
            }
          },
          formatUnknownError: (error: unknown) => (error instanceof Error ? error.message : String(error)),
        }),
      },
    )

    expect(files).toEqual(["src/index.ts"])
    expect(requests).toEqual([
      { method: "GET", pathname: "/api/fs/find", body: undefined },
      {
        method: "POST",
        pathname: "/api/session/ses-1/permission/permission-1/reply",
        body: { reply: "once" },
      },
      {
        method: "POST",
        pathname: "/api/session/ses-1/question/question-1/reply",
        body: { answers: [["yes"]] },
      },
      {
        method: "POST",
        pathname: "/api/session/ses-1/background",
        body: undefined,
      },
    ])
  })
})
