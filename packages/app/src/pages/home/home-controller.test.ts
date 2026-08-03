import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"

let createHomeController: typeof import("./home-controller").createHomeController

const conn = { key: "server-a" }
let projects = [{ worktree: "C:\\Users\\Luke\\repo\\beta" }, { worktree: "C:\\Users\\Luke\\repo\\amazon\\" }]
let recent = [{ worktree: "C:\\Users\\Luke\\repo\\closed" }]
const opened: string[] = []
const touched: string[] = []
const drafted: Array<{ server: string; directory: string }> = []
let lastProject = "C:/Users/Luke/repo/amazon"
let selection: () => { server: string; directory?: string }
let setSelection: (value: { server: string; directory?: string }) => void

beforeAll(async () => {
  mock.module("@/context/global", () => ({
    useGlobal: () => ({
      servers: {
        list: () => [conn],
        health: { "server-a": { healthy: true } },
      },
      ensureServerCtx: () => ({
        sync: { data: { path: { home: "C:/Users/Luke" } } },
        projects: {
          list: () => projects,
          recentlyClosed: () => recent,
          last: () => lastProject,
          open: (directory: string) => opened.push(directory),
          touch: (directory: string) => touched.push(directory),
        },
      }),
    }),
  }))
  mock.module("@/context/layout", () => ({
    useLayout: () => ({
      home: {
        selection,
        setSelection,
      },
      projects: {
        list: () => projects,
        recentlyClosed: () => recent,
      },
    }),
  }))
  mock.module("@/context/server", () => ({
    ServerConnection: {
      key: (value: { key: string }) => value.key,
    },
    useServer: () => ({
      key: "server-a",
      current: conn,
    }),
  }))
  mock.module("@/context/server-sync", () => ({
    useServerSync: () => () => ({ data: { path: { home: "C:/Users/Luke" } } }),
  }))
  mock.module("@/context/tabs", () => ({
    useTabs: () => ({
      newDraft: (value: { server: string; directory: string }) => {
        drafted.push(value)
      },
    }),
  }))

  ;({ createHomeController } = await import("./home-controller"))
})

beforeEach(() => {
  ;[selection, setSelection] = createSignal({ server: "server-a" as string, directory: undefined as string | undefined })
  projects = [{ worktree: "C:\\Users\\Luke\\repo\\beta" }, { worktree: "C:\\Users\\Luke\\repo\\amazon\\" }]
  recent = [{ worktree: "C:\\Users\\Luke\\repo\\closed" }]
  lastProject = "C:/Users/Luke/repo/amazon"
  opened.length = 0
  touched.length = 0
  drafted.length = 0
})

describe("home controller project identity", () => {
  test("finds the selected project by normalized directory identity", () => {
    ;[selection, setSelection] = createSignal({ server: "server-a", directory: "C:/Users/Luke/repo/amazon" })

    createRoot((dispose) => {
      const home = createHomeController()
      expect(home.project.selected()?.worktree).toBe("C:\\Users\\Luke\\repo\\amazon\\")
      dispose()
    })
  })

  test("uses the normalized last project for new sessions", () => {
    createRoot((dispose) => {
      const home = createHomeController()
      expect(home.project.newSession()?.worktree).toBe("C:\\Users\\Luke\\repo\\amazon\\")
      dispose()
    })
  })

  test("selects an existing project when the requested directory only differs by windows separators", () => {
    createRoot((dispose) => {
      const home = createHomeController()
      home.project.select(conn as never, "C:/Users/Luke/repo/amazon")
      expect(selection()).toEqual({ server: "server-a", directory: "C:/Users/Luke/repo/amazon" })
      dispose()
    })
  })
})
