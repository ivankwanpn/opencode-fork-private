import { describe, expect, test } from "bun:test"
import { createStore } from "solid-js/store"
import { QueryClient } from "@tanstack/solid-query"
import type { Config, OpencodeClient, Project } from "@opencode-ai/sdk/v2/client"
import type { AgentApi, CommandApi, ProjectApi, ReferenceApi } from "@opencode-ai/client/promise"
import type { NormalizedProviderListResponse } from "@opencode-ai/session-ui/context"
import {
  bootstrapDirectory,
  loadAgentsQuery,
  loadCommands,
  loadPathQuery,
  loadProjectsQuery,
  loadProvidersQuery,
  loadReferencesQuery,
} from "./bootstrap"
import type { State, VcsCache } from "./types"
import { ServerScope } from "@/utils/server-scope"
import type { ServerApi } from "@/utils/server"

const provider = { all: new Map(), connected: [], default: {} } satisfies NormalizedProviderListResponse
const api = {
  agent: { list: async () => ({ location: {}, data: [] }) },
  providers: {
    catalog: async () => ({ location: {}, data: { providers: [], models: [], connected: [], default: {} } }),
  },
  provider: { list: async () => ({ location: {}, data: [] }) },
  model: {
    list: async () => ({ location: {}, data: [] }),
    default: async () => ({ location: {}, data: null }),
  },
  config: { get: async () => ({ location: {}, data: {} }) },
  permission: { request: { list: async () => ({ location: {}, data: [] }) } },
  project: {
    list: async () => [],
    current: async () => ({ id: "project", directory: "/project" }),
  },
  question: { request: { list: async () => ({ location: {}, data: [] }) } },
  reference: { list: async () => ({ location: {}, data: [] }) },
  vcs: { get: async () => ({ location: {}, data: {} }) },
} as unknown as ServerApi

function directoryState() {
  return createStore<State>({
    status: "loading",
    agent: [],
    command: [],
    reference: [],
    project: "",
    projectMeta: undefined,
    icon: undefined,
    provider_ready: true,
    provider,
    config: {},
    path: { state: "", config: "", worktree: "/project", directory: "/project", home: "/home" },
    session: [],
    sessionTotal: 0,
    session_status: {},
    session_working(id: string) {
      return this.session_status[id]?.type !== "idle"
    },
    session_diff: {},
    todo: {},
    permission: {},
    question: {},
    mcp_ready: true,
    mcp: {},
    mcp_resource: {},
    lsp_ready: true,
    lsp: [],
    vcs: undefined,
    limit: 5,
    message: {},
    session_message: {},
    part: {},
    part_text_accum_delta: {},
  })
}

describe("bootstrapDirectory", () => {
  test("marks a loading directory partial during bootstrap and complete after success", async () => {
    const mcpReads: string[] = []
    const [store, setStore] = directoryState()

    await bootstrapDirectory({
      directory: "/project",
      scope: ServerScope.local,
      mcp: false,
      global: {
        config: {} satisfies Config,
        path: { state: "", config: "", worktree: "/project", directory: "/project", home: "/home" },
        project: [{ id: "project", worktree: "/project" } as Project],
        provider,
      },
      sdk: {
        app: { agents: async () => ({ data: [{ name: "build", mode: "primary" }] }) },
        config: { get: async () => ({ data: {} }) },
        vcs: { get: async () => ({ data: undefined }) },
        command: {
          list: async () => {
            mcpReads.push("command")
            return { data: [] }
          },
        },
        permission: { list: async () => ({ data: [] }) },
        question: { list: async () => ({ data: [] }) },
        v2: { reference: { list: async () => ({ data: { data: [] } }) } },
        mcp: {
          status: async () => {
            mcpReads.push("status")
            return { data: {} }
          },
        },
        provider: { list: async () => ({ data: { all: [], connected: [], default: {} } }) },
      } as unknown as OpencodeClient,
      api,
      store,
      setStore,
      vcsCache: { setStore() {} } as unknown as VcsCache,
      loadSessions() {},
      translate: (key) => key,
      queryClient: new QueryClient(),
    })

    expect(store.status).toBe("partial")

    await new Promise((resolve) => setTimeout(resolve, 80))

    expect(store.status).toBe("complete")
    expect(mcpReads).toEqual([])
  })
})

describe("query keys", () => {
  test("partitions identical directories by server scope", () => {
    const client = {} as Parameters<typeof loadPathQuery>[2]
    const api = {} as Parameters<typeof loadProvidersQuery>[2]
    const remote = "https://debian.example" as typeof ServerScope.local

    expect([...loadPathQuery(ServerScope.local, "/repo", client).queryKey]).toEqual(["local", "/repo", "path"])
    expect([...loadPathQuery(remote, "/repo", client).queryKey]).toEqual(["https://debian.example", "/repo", "path"])
    expect([...loadProvidersQuery(remote, null, api).queryKey]).toEqual(["https://debian.example", null, "providers"])
  })

  test("loads the native v2 provider catalog with one request", async () => {
    const calls: unknown[] = []
    const api = {
      providers: {
        catalog: async (input: unknown) => {
          calls.push(["catalog", input])
          return {
            location: {},
            data: {
              providers: [
                {
                  info: {
                    id: "openai",
                    name: "OpenAI",
                    api: { type: "aisdk", package: "@ai-sdk/openai", settings: {} },
                    request: { headers: {}, body: {} },
                  },
                  source: "api",
                  env: ["OPENAI_API_KEY"],
                },
              ],
              models: [],
              connected: ["openai"],
              default: {},
            },
          }
        },
      },
    } as unknown as Parameters<typeof loadProvidersQuery>[2]

    const result = await new QueryClient().fetchQuery(loadProvidersQuery(ServerScope.local, "/repo", api))

    expect(calls).toEqual([["catalog", { location: { directory: "/repo" } }]])
    expect(result.connected).toEqual(["openai"])
  })

  test("does not call the legacy provider endpoint for a native v2 server", async () => {
    const calls: string[] = []
    const current = {
      providers: {
        catalog: async () => {
          calls.push("catalog")
          return { location: {}, data: { providers: [], models: [], connected: [], default: {} } }
        },
      },
    } as unknown as Parameters<typeof loadProvidersQuery>[2]
    const legacy = {
      provider: {
        list: async () => {
          calls.push("legacy")
          return {
            data: {
              all: [{ id: "anthropic", name: "Anthropic", source: "env", env: [], options: {}, models: {} }],
              connected: [],
              default: {},
            },
          }
        },
      },
    } as unknown as OpencodeClient

    const result = await new QueryClient().fetchQuery(
      loadProvidersQuery(ServerScope.local, "/repo", current, legacy, Promise.resolve("v2")),
    )

    expect(calls).toEqual(["catalog"])
    expect(result.all.size).toBe(0)
  })

  test("keeps the legacy provider catalog for an explicitly detected v1 server", async () => {
    const calls: string[] = []
    const current = {
      providers: {
        catalog: async () => {
          calls.push("catalog")
          return { location: {}, data: { providers: [], models: [], connected: [], default: {} } }
        },
      },
    } as unknown as Parameters<typeof loadProvidersQuery>[2]
    const legacy = {
      provider: {
        list: async () => {
          calls.push("legacy")
          return {
            data: {
              all: [{ id: "anthropic", name: "Anthropic", source: "env", env: [], options: {}, models: {} }],
              connected: [],
              default: {},
            },
          }
        },
      },
    } as unknown as OpencodeClient

    const result = await new QueryClient().fetchQuery(
      loadProvidersQuery(ServerScope.local, "/repo", current, legacy, Promise.resolve("v1")),
    )

    expect(calls).toEqual(["legacy"])
    expect(result.all.has("anthropic")).toBe(true)
  })

  test("loads agents from the current location-scoped endpoint", async () => {
    const calls: unknown[] = []
    const api = {
      list: async (input: unknown) => {
        calls.push(input)
        return { location: {}, data: [] }
      },
    } as unknown as AgentApi

    const result = await new QueryClient().fetchQuery(loadAgentsQuery(ServerScope.local, "/repo", api))

    expect(calls).toEqual([{ location: { directory: "/repo" } }])
    expect(result).toEqual([])
  })

  test("loads commands from the current location-scoped endpoint", async () => {
    const calls: unknown[] = []
    const api = {
      list: async (input: unknown) => {
        calls.push(input)
        return {
          location: {},
          data: [{ name: "review", template: "Review files", source: "command" as const }],
        }
      },
    } as unknown as CommandApi

    const result = await loadCommands("/repo", api)

    expect(calls).toEqual([{ location: { directory: "/repo" } }])
    expect(result).toEqual([{ name: "review", template: "Review files", source: "command" }])
  })

  test("loads projects from the current endpoint", async () => {
    const api = {
      list: async () => [
        { id: "b", worktree: "/b", time: { created: 1, updated: 1 }, sandboxes: [] },
        { id: "a", worktree: "/a", time: { created: 1, updated: 1 }, sandboxes: [] },
      ],
    } as unknown as ProjectApi

    const result = await new QueryClient().fetchQuery(loadProjectsQuery(ServerScope.local, api))

    expect(result.map((project) => project.id)).toEqual(["a", "b"])
  })

  test("loads references from the current location-scoped endpoint", async () => {
    const calls: unknown[] = []
    const api = {
      list: async (input: unknown) => {
        calls.push(input)
        return { location: {}, data: [{ name: "AGENTS.md", path: "/repo/AGENTS.md", source: "instructions" }] }
      },
    } as unknown as ReferenceApi

    const result = await new QueryClient().fetchQuery(loadReferencesQuery(ServerScope.local, "/repo", api))

    expect(calls).toEqual([{ location: { directory: "/repo" } }])
    expect(result).toHaveLength(1)
  })
})
