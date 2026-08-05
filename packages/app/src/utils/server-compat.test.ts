import { describe, expect, test } from "bun:test"
import type { ServerApi } from "./server"
import {
  createExternalCompatibleApi,
  createV2OnlyApi,
  resolveCompatibleApiForProtocol,
  resolveCompatibleGeneration,
} from "./server-compat"

function currentApi(
  calls: string[],
  onPrompt?: (input: Parameters<ServerApi["session"]["prompt"]>[0]) => void,
) {
  const current = {
    session: {
      create: async () => undefined,
      prompt: async (input: Parameters<ServerApi["session"]["prompt"]>[0]) => {
        onPrompt?.(input)
        return undefined
      },
      inputList: async () => {
        calls.push("inputList")
        return []
      },
      inputGet: async () => {
        calls.push("inputGet")
        return "current"
      },
      inputPromote: async () => {
        calls.push("inputPromote")
        return "current"
      },
      inputCancel: async () => {
        calls.push("inputCancel")
      },
      todo: async () => {
        calls.push("todo")
        return []
      },
      revert: {
        stage: async () => undefined,
        clear: async () => undefined,
        commit: async () => {
          calls.push("revert.commit")
        },
      },
    },
    message: {
      list: async () => {
        calls.push("message.list")
        return { data: [], cursor: {} }
      },
    },
    project: {},
    worktree: {},
    location: {},
    path: {},
    vcs: {},
    file: {},
    config: {},
    mcp: {
      resource: {},
      authenticate: async () => {
        calls.push("mcp.authenticate")
        return { location: {}, data: { status: "connected" } }
      },
    },
    integration: {
      connect: {},
      oauth: {
        cancel: async () => {
          calls.push("integration.oauth.cancel")
        },
      },
    },
    credential: {},
    pty: {},
    lsp: {
      status: async () => ({ location: {}, data: [] }),
    },
    plugins: {
      list: async () => {
        calls.push("plugins.list")
        return { marketplaces: [], plugins: [] }
      },
    },
    permission: { request: {} },
    question: { request: {} },
  }
  return current as unknown as ServerApi
}

describe("server compatibility API", () => {
  test("blocks all current API calls when a sidecar loses its V2 protocol", async () => {
    const calls: string[] = []
    const api = createV2OnlyApi({
      protocol: Promise.resolve("v1"),
      current: currentApi(calls),
    })

    await expect(api.session.inputList({ sessionID: "ses_1", delivery: "queue" })).rejects.toThrow(
      "V2 server protocol unavailable",
    )
    expect(calls).toEqual([])
  })

  test("allows the current API while a sidecar has the V2 protocol", async () => {
    const calls: string[] = []
    const api = createV2OnlyApi({
      protocol: Promise.resolve("v2"),
      current: currentApi(calls),
    })

    await expect(api.session.inputList({ sessionID: "ses_1", delivery: "queue" })).resolves.toEqual([])
    expect(calls).toEqual(["inputList"])
  })

  test("does not leak V2 session input methods into V1 connections", async () => {
    const calls: string[] = []
    const api = createExternalCompatibleApi({
      protocol: Promise.resolve("v1"),
      current: currentApi(calls),
      legacy: () => {
        throw new Error("legacy client should not be used")
      },
    })

    await expect(api.session.inputList({ sessionID: "ses_1", delivery: "queue" })).rejects.toThrow(
      "Durable session follow-up inputs is unavailable on a V1 server",
    )
    await expect(api.session.inputGet({ sessionID: "ses_1", inputID: "msg_1" })).rejects.toThrow(
      "Durable session follow-up inputs is unavailable on a V1 server",
    )
    await expect(api.session.revert.commit({ sessionID: "ses_1" })).rejects.toThrow(
      "V2 session revert commit is unavailable on a V1 server",
    )
    await expect(api.plugins.list()).rejects.toThrow("Plugin management is unavailable on a V1 server")
    expect(calls).toEqual([])
  })

  test("does not expose V2 message history to V1 connections", async () => {
    const calls: string[] = []
    const api = createExternalCompatibleApi({
      protocol: Promise.resolve("v1"),
      current: currentApi(calls),
      legacy: () => {
        throw new Error("legacy client should not be used")
      },
    })

    await expect(api.message.list({ sessionID: "ses_1", limit: 20, order: "desc" })).rejects.toThrow(
      "V2 message history is unavailable on a V1 server",
    )
    expect(calls).toEqual([])
  })

  test("keeps V2 session methods on V2 connections", async () => {
    const calls: string[] = []
    const api = createExternalCompatibleApi({
      protocol: Promise.resolve("v2"),
      current: currentApi(calls),
      legacy: () => {
        throw new Error("legacy client should not be used")
      },
    })

    await expect(api.session.inputList({ sessionID: "ses_1", delivery: "queue" })).resolves.toEqual([])
    expect(calls).toEqual(["inputList"])
  })

  test("routes MCP authentication through the current API on V2 connections", async () => {
    const calls: string[] = []
    const api = createExternalCompatibleApi({
      protocol: Promise.resolve("v2"),
      current: currentApi(calls),
      legacy: () => {
        throw new Error("legacy client should not be used")
      },
    })

    await expect(api.mcp.authenticate({ name: "demo", location: { directory: "/repo" } })).resolves.toMatchObject({
      data: { status: "connected" },
    })
    expect(calls).toContain("mcp.authenticate")
  })

  test("maps MCP authentication to the legacy adapter on V1 connections", async () => {
    const calls: unknown[] = []
    const api = createExternalCompatibleApi({
      protocol: Promise.resolve("v1"),
      current: currentApi([]),
      legacy: (directory) =>
        ({
          mcp: {
            auth: {
              authenticate: async (input: unknown) => {
                calls.push([directory, input])
                return { data: { status: "connected" } }
              },
            },
          },
        }) as never,
    })

    await expect(api.mcp.authenticate({ name: "demo", location: { directory: "/repo" } })).resolves.toMatchObject({
      data: { status: "connected" },
    })
    expect(calls).toEqual([["/repo", { name: "demo" }]])
  })

  test("maps V1 todo and LSP reads through the compatibility adapter", async () => {
    const calls: string[] = []
    const todos = [{ id: "todo_1", content: "finish migration", status: "pending", priority: "high" }]
    const api = createExternalCompatibleApi({
      protocol: Promise.resolve("v1"),
      current: currentApi([]),
      legacy: () =>
        ({
          session: {
            todo: async (input: { sessionID: string }) => {
              calls.push(`todo:${input.sessionID}`)
              return { data: todos }
            },
          },
          lsp: {
            status: async () => {
              calls.push("lsp")
              return { data: [{ id: "typescript", name: "TypeScript", root: "/repo", status: "connected" }] }
            },
          },
        }) as never,
    })

    await expect(api.session.todo({ sessionID: "ses_1" })).resolves.toEqual(todos)
    await expect(api.lsp.status({ location: { directory: "/repo" } })).resolves.toEqual({
      location: { directory: "/repo", project: { id: "", directory: "/repo" } },
      data: [{ id: "typescript", name: "TypeScript", root: "/repo", status: "connected" }],
    })
    expect(calls).toEqual(["todo:ses_1", "lsp"])
  })

  test("keeps external V1 session creation and prompts on the directory-scoped legacy client", async () => {
    const calls: Array<{ method: string; input: unknown }> = []
    const api = createExternalCompatibleApi({
      protocol: Promise.resolve("v1"),
      directory: "/repo",
      current: currentApi([]),
      legacy: () =>
        ({
          session: {
            create: async (input: unknown) => {
              calls.push({ method: "create", input })
              return {
                data: {
                  id: "ses_1",
                  projectID: "project_1",
                  agent: "build",
                  model: { id: "model_1", providerID: "provider_1" },
                  cost: 0,
                  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
                  time: { created: 1, updated: 1 },
                  title: "session",
                  directory: "/repo",
                },
              }
            },
            promptAsync: async (input: unknown) => {
              calls.push({ method: "promptAsync", input })
              return { data: undefined }
            },
          },
        }) as never,
    })

    await expect(api.session.create({ location: { directory: "/repo" } })).resolves.toMatchObject({
      id: "ses_1",
      location: { directory: "/repo" },
    })

    await api.session.prompt({
      sessionID: "ses_1",
      id: "msg_1",
      text: "hello",
      agent: "build",
      model: { providerID: "provider_1", modelID: "model_1" },
      delivery: "queue",
      resume: true,
      legacyParts: [{ type: "text", text: "hello" }],
    })

    expect(calls).toEqual([
      { method: "create", input: { directory: "/repo" } },
      {
        method: "promptAsync",
        input: {
          sessionID: "ses_1",
          messageID: "msg_1",
          agent: "build",
          model: { providerID: "provider_1", modelID: "model_1" },
          variant: undefined,
          parts: [{ type: "text", text: "hello" }],
        },
      },
    ])
  })

  test("does not send V1 OAuth cleanup through the current API", async () => {
    const calls: string[] = []
    const api = createExternalCompatibleApi({
      protocol: Promise.resolve("v1"),
      current: currentApi(calls),
      legacy: () => {
        throw new Error("legacy client should not be used")
      },
    })

    await expect(api.integration.oauth.cancel({ integrationID: "demo", attemptID: "demo:0" })).resolves.toBeUndefined()
    expect(calls).not.toContain("integration.oauth.cancel")
  })

  test("re-evaluates the protocol resolver for a new connection generation", async () => {
    const calls: string[] = []
    let protocol: "v1" | "v2" = "v2"
    const api = createExternalCompatibleApi({
      protocol: () => Promise.resolve(protocol),
      current: currentApi(calls),
      legacy: () => {
        throw new Error("legacy client should not be used")
      },
    })

    await expect(api.session.inputList({ sessionID: "ses_1", delivery: "queue" })).resolves.toEqual([])
    protocol = "v1"
    await expect(api.session.inputList({ sessionID: "ses_1", delivery: "queue" })).rejects.toThrow(
      "Durable session follow-up inputs is unavailable on a V1 server",
    )
    expect(calls).toEqual(["inputList"])
  })

  test("keeps a resolved API on the generation selected before reconnect", async () => {
    const calls: string[] = []
    let protocol: "v1" | "v2" = "v2"
    const api = createExternalCompatibleApi({
      protocol: () => Promise.resolve(protocol),
      current: currentApi(calls),
      legacy: () => {
        throw new Error("legacy client should not be used")
      },
    })

    const selected = await resolveCompatibleApiForProtocol(api, () => Promise.resolve(protocol))
    protocol = "v1"

    await expect(selected.session.inputList({ sessionID: "ses_1", delivery: "queue" })).resolves.toEqual([])
    expect(calls).toEqual(["inputList"])
  })

  test("does not downgrade an admitted V2 prompt to V1 after reconnect", async () => {
    const calls: string[] = []
    let protocol: "v1" | "v2" = "v2"
    const current = currentApi(calls, (input) => {
      calls.push(`v2:${input.id}:${input.delivery}:${input.resume}`)
    })
    const api = createExternalCompatibleApi({
      protocol: () => Promise.resolve(protocol),
      current,
      legacy: () => ({
        session: {
          promptAsync: async () => {
            calls.push("v1:promptAsync")
            throw new Error("V1 downgrade must not happen")
          },
        },
      }) as never,
    })

    const selected = await resolveCompatibleApiForProtocol(api, () => Promise.resolve(protocol))
    protocol = "v1"

    await selected.session.prompt({
      sessionID: "ses_1",
      id: "msg_admitted",
      text: "already admitted",
      delivery: "queue",
      resume: false,
    })

    expect(calls).toEqual(["v2:msg_admitted:queue:false"])
  })

  test("keeps the protocol and API selected from the same generation", async () => {
    const calls: string[] = []
    const api = createExternalCompatibleApi({
      protocol: Promise.resolve("v2"),
      current: currentApi(calls),
      legacy: () => {
        throw new Error("legacy client should not be used")
      },
    })

    const selected = resolveCompatibleGeneration(api, "v2")

    await expect(selected.api.session.inputList({ sessionID: "ses_1", delivery: "queue" })).resolves.toEqual([])
    expect(selected.protocol).toBe("v2")
    expect(calls).toEqual(["inputList"])
  })
})
