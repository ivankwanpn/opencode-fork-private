import { describe, expect, test } from "bun:test"
import type { ServerApi } from "./server"
import { createCompatibleApi } from "./server-compat"

function currentApi(calls: string[]) {
  const current = {
    session: {
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
      revert: {
        stage: async () => undefined,
        clear: async () => undefined,
        commit: async () => {
          calls.push("revert.commit")
        },
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
    integration: { connect: {}, oauth: {} },
    credential: {},
    pty: {},
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
  test("does not leak V2 session input methods into V1 connections", async () => {
    const calls: string[] = []
    const api = createCompatibleApi({
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

  test("keeps V2 session methods on V2 connections", async () => {
    const calls: string[] = []
    const api = createCompatibleApi({
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
    const api = createCompatibleApi({
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
    const api = createCompatibleApi({
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

  test("re-evaluates the protocol resolver for a new connection generation", async () => {
    const calls: string[] = []
    let protocol: "v1" | "v2" = "v2"
    const api = createCompatibleApi({
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
})
