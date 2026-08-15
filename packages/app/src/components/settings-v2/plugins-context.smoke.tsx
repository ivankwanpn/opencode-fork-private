import { describe, expect, mock, test } from "bun:test"
import { createRoot } from "solid-js"

mock.module("@/context/language", () => ({
  useLanguage: () => ({
    t: (key: string) => key,
  }),
}))

mock.module("@/context/server-sdk", () => ({
  useServerSDK: () => () => ({
    protocolGeneration: () => 1,
    protocolKind: () => "v2",
    apiForGeneration: async () => ({
      plugins: {
        list: async () => ({ marketplaces: [], plugins: [] }),
        runtime: async () => ({
          location: { directory: "/workspace", project: { id: "project", directory: "/workspace" } },
          data: { plugins: [] },
        }),
      },
    }),
  }),
}))

mock.module("@/context/server-sync", () => ({
  useServerSync: () => () => ({
    data: { path: { directory: "/workspace" } },
    ensureDirSyncContext: () => ({
      data: { mcp: {}, mcp_ready: false },
      mcp: { refresh: async () => {} },
      commands: { refresh: async () => {} },
    }),
  }),
}))

mock.module("@/context/sync", () => ({
  useSync: () => {
    throw new Error("legacy directory SDK context must not be used by settings")
  },
}))

const empty = () => null
mock.module("@opencode-ai/ui/v2/button-v2", () => ({ ButtonV2: empty }))
mock.module("@opencode-ai/ui/v2/icon", () => ({ Icon: empty }))
mock.module("@opencode-ai/ui/v2/icon-button-v2", () => ({ IconButtonV2: empty }))
mock.module("@opencode-ai/ui/v2/switch-v2", () => ({ Switch: empty }))
mock.module("@opencode-ai/ui/v2/text-input-v2", () => ({ TextInputV2: empty }))

// Bun's test transpiler uses the classic JSX runtime for this imported TSX module.
Object.assign(globalThis, {
  React: {
    createElement: () => null,
  },
  Fragment_8vg9x3sq: Symbol.for("solid-test-fragment"),
})

const { SettingsPluginsV2 } = await import("./plugins")

describe("SettingsPluginsV2 context boundary", () => {
  test("uses the server-scoped sync context available to settings", () => {
    let dispose: VoidFunction | undefined
    expect(() => {
      dispose = createRoot((disposeRoot) => {
        SettingsPluginsV2({})
        return disposeRoot
      })
    }).not.toThrow()
    dispose?.()
  })
})
