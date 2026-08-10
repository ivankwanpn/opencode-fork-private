import { describe, expect, spyOn, test } from "bun:test"
import { createStore } from "solid-js/store"
import { QueryClient } from "@tanstack/solid-query"
import type { Config, PermissionRequest, Project, QuestionRequest } from "@opencode-ai/sdk/v2/client"
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

  test("uses the V2 active snapshot for session status", async () => {
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
      api,
      activeSessions: () => ({ ses_running: { type: "running" } }),
      store,
      setStore,
      vcsCache: { setStore() {} } as unknown as VcsCache,
      loadSessions() {},
      translate: (key) => key,
      queryClient: new QueryClient(),
    })

    await new Promise((resolve) => setTimeout(resolve, 80))

    expect(store.session_status).toEqual({ ses_running: { type: "busy" } })
  })

  test("routes provider failures through one common error path and keeps the directory partial", async () => {
    const [store, setStore] = directoryState()
    let resolveReported!: () => void
    const reported = new Promise<void>((resolve) => {
      resolveReported = resolve
    })
    const errorLog = spyOn(console, "error").mockImplementation((message) => {
      if (message === "Failed to finish bootstrap instance") resolveReported()
    })

    try {
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
        api: {
          ...api,
          providers: {
            catalog: async () => {
              throw new Error("Instance bootstrap failed")
            },
          },
        } as unknown as ServerApi,
        store,
        setStore,
        vcsCache: { setStore() {} } as unknown as VcsCache,
        loadSessions() {},
        translate: (key) => key,
        queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }),
      })

      await Promise.race([
        reported,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("provider bootstrap error was not reported")), 2_000),
        ),
      ])

      expect(store.status).toBe("partial")
      expect(errorLog.mock.calls.filter((call) => call[0] === "Failed to finish bootstrap instance")).toHaveLength(1)
    } finally {
      errorLog.mockRestore()
    }
  })

  test("does not overwrite requests changed while list snapshots are in flight", async () => {
    const [store, setStore] = directoryState()
    const revisions = { permission: 0, question: 0 }
    const permission = {
      id: "per_1",
      sessionID: "ses_1",
      permission: "read",
      patterns: ["src/**"],
      metadata: {},
      always: [],
    } satisfies PermissionRequest
    const question = {
      id: "que_1",
      sessionID: "ses_1",
      questions: [{ question: "Continue?", header: "Continue", options: [] }],
    } satisfies QuestionRequest

    let startPermission!: () => void
    let startQuestion!: () => void
    const permissionStarted = new Promise<void>((resolve) => {
      startPermission = resolve
    })
    const questionStarted = new Promise<void>((resolve) => {
      startQuestion = resolve
    })
    type EmptyList = { location: Record<string, never>; data: never[] }
    let resolvePermission!: (value: EmptyList) => void
    let resolveQuestion!: (value: EmptyList) => void
    const permissionList = () => {
      startPermission()
      return new Promise<EmptyList>((resolve) => {
        resolvePermission = resolve
      })
    }
    const questionList = () => {
      startQuestion()
      return new Promise<EmptyList>((resolve) => {
        resolveQuestion = resolve
      })
    }

    const running = bootstrapDirectory({
      directory: "/project",
      scope: ServerScope.local,
      mcp: false,
      global: {
        config: {} satisfies Config,
        path: { state: "", config: "", worktree: "/project", directory: "/project", home: "/home" },
        project: [{ id: "project", worktree: "/project" } as Project],
        provider,
      },
      api: {
        ...api,
        permission: { request: { list: permissionList } },
        question: { request: { list: questionList } },
      } as unknown as ServerApi,
      store,
      setStore,
      vcsCache: { setStore() {} } as unknown as VcsCache,
      loadSessions() {},
      translate: (key) => key,
      queryClient: new QueryClient(),
      pendingRequestRevision: {
        permission: () => revisions.permission,
        question: () => revisions.question,
      },
    })

    await Promise.all([permissionStarted, questionStarted])
    setStore("permission", permission.sessionID, [permission])
    setStore("question", question.sessionID, [question])
    revisions.permission += 1
    revisions.question += 1
    resolvePermission({ location: {}, data: [] })
    resolveQuestion({ location: {}, data: [] })
    await running

    expect(store.permission.ses_1).toEqual([permission])
    expect(store.question.ses_1).toEqual([question])
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

  test("uses the provider catalog from the selected V2 generation", async () => {
    const calls: string[] = []
    const stale = {
      providers: {
        catalog: async () => {
          calls.push("stale")
          return { location: {}, data: { providers: [], models: [], connected: [], default: {} } }
        },
      },
    } as unknown as Parameters<typeof loadProvidersQuery>[2]
    const current = {
      providers: {
        catalog: async () => {
          calls.push("current")
          return { location: {}, data: { providers: [], models: [], connected: [], default: {} } }
        },
      },
    } as unknown as ServerApi

    const result = await new QueryClient().fetchQuery(
      loadProvidersQuery(ServerScope.local, "/repo", stale, async () => current),
    )

    expect(calls).toEqual(["current"])
    expect(result.all.size).toBe(0)
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

  test("loads commands from the current protocol generation", async () => {
    const calls: string[] = []
    const stale = {
      list: async () => {
        calls.push("stale")
        return { location: {}, data: [] }
      },
    } as unknown as CommandApi
    const current = {
      command: {
        list: async (input: unknown) => {
          calls.push(JSON.stringify(input))
          return {
            location: {},
            data: [{ name: "review", template: "Current command", source: "command" as const }],
          }
        },
      },
    } as unknown as ServerApi

    const result = await loadCommands("/repo", stale, async () => current)

    expect(calls).toEqual(['{"location":{"directory":"/repo"}}'])
    expect(result).toEqual([{ name: "review", template: "Current command", source: "command" }])
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
