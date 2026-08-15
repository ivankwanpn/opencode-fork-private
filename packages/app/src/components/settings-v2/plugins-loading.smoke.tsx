import { expect, mock, test } from "bun:test"
import { render } from "solid-js/web"

let resolveList: (value: { marketplaces: []; plugins: [] }) => void = () => {}
const list = new Promise<{ marketplaces: []; plugins: [] }>((resolve) => {
  resolveList = resolve
})

mock.module("@/context/language", () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}))

mock.module("@/context/server-sdk", () => {
  const sdk = {
    protocolGeneration: () => 1,
    protocolKind: () => "v2",
    apiForGeneration: async () => ({
      plugins: {
        list: () => list,
        runtime: async () => ({
          location: { directory: "/workspace", project: { id: "project", directory: "/workspace" } },
          data: { plugins: [] },
        }),
      },
    }),
  }
  return { useServerSDK: () => () => sdk }
})

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

const children = (props: { children?: unknown }) => props.children ?? null
const empty = () => null
mock.module("@opencode-ai/ui/v2/button-v2", () => ({ ButtonV2: children }))
mock.module("@opencode-ai/ui/v2/icon", () => ({ Icon: empty }))
mock.module("@opencode-ai/ui/v2/icon-button-v2", () => ({ IconButtonV2: empty }))
mock.module("@opencode-ai/ui/v2/switch-v2", () => ({ Switch: children }))
mock.module("@opencode-ai/ui/v2/text-input-v2", () => ({ TextInputV2: empty }))

const { SettingsPluginsV2 } = await import("./plugins")

test("does not render an empty catalog before the first request succeeds", async () => {
  const dispose = render(() => SettingsPluginsV2({}), document.body)
  await tick()

  expect(document.body.textContent).toContain("plugin.catalog.loading")
  expect(document.body.textContent).not.toContain("plugin.catalog.empty")

  resolveList({ marketplaces: [], plugins: [] })
  await tick()

  expect(document.body.textContent).not.toContain("plugin.catalog.loading")
  expect(document.body.textContent).toContain("plugin.catalog.empty")
  dispose()
})

function tick() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0))
}
