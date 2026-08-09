import { describe, expect, mock, test } from "bun:test"
import { createRoot } from "solid-js"

const translatedKeys: string[] = []
const legacyEditHandlers: Array<() => void> = []
const v2EditHandlers: Array<() => void> = []
const oauthModel = {
  id: "discovered-runtime-model",
  name: "Discovered runtime model",
  limit: { context: 272_000 },
  provider: { id: "openai" },
}
const testServerSDK = {
  protocolKind: () => "v2" as const,
  apiForGeneration: async () => ({
    providers: { discoverModels: async () => ({ data: { source: "oauth", models: [] } }) },
  }),
}

mock.module("@/context/language", () => ({
  useLanguage: () => ({
    t: (key: string) => {
      translatedKeys.push(key)
      return key
    },
  }),
}))
mock.module("@/context/models", () => ({
  useModels: () => ({
    list: () => [oauthModel],
    visible: () => true,
    setVisibility: () => {},
  }),
}))
mock.module("@/context/global", () => ({ useGlobal: () => ({ ensureServerCtx: () => ({ sdk: testServerSDK }) }) }))
mock.module("@/context/server", () => ({
  ServerConnection: {},
  useServer: () => ({ current: { type: "http", http: { url: "http://settings.test" } } }),
}))
mock.module("@/context/server-sync", () => ({
  useServerSync: () => () => ({
    data: { path: { directory: "/workspace" }, config: {}, provider: {} },
    refreshProviders: async () => {},
  }),
}))
mock.module("@/hooks/use-providers", () => ({
  popularProviders: [],
  useProviders: () => ({
    connected: () => [{ id: "openai", name: "OpenAI", auth: "oauth", source: "api", models: {} }],
    popular: () => [],
  }),
}))
mock.module("@/utils/toast", () => ({ showToast: () => {} }))
mock.module("@/utils/provider-disconnect", () => ({ disconnectProviderAndRefresh: async () => {} }))
mock.module("./settings-server-picker", () => ({
  SettingsServerPicker: () => null,
  SettingsServerScope: (props: { children: unknown }) => props.children,
}))
mock.module("./settings-list", () => ({ SettingsList: (props: { children: unknown }) => props.children }))
mock.module("./settings-v2/parts/list", () => ({ SettingsListV2: (props: { children: unknown }) => props.children }))
mock.module("./dialog-connect-provider", () => ({
  DialogConnectProvider: () => null,
  useProviderConnectController: () => ({ select: () => {} }),
}))
mock.module("./dialog-custom-provider", () => ({ DialogCustomProvider: () => null }))
mock.module("@opencode-ai/ui/button", () => ({
  Button: (props: { children?: unknown; onClick?: () => void }) => {
    if (props.children === "common.edit" && props.onClick) legacyEditHandlers.push(props.onClick)
    return null
  },
}))
mock.module("@opencode-ai/ui/v2/button-v2", () => ({
  ButtonV2: (props: { children?: unknown; onClick?: () => void }) => {
    if (props.children === "common.edit" && props.onClick) v2EditHandlers.push(props.onClick)
    return null
  },
}))
mock.module("@opencode-ai/ui/context/dialog", () => ({
  useDialog: () => ({ show: async (factory: () => unknown) => factory(), close: () => {} }),
}))
mock.module("@opencode-ai/ui/dialog", () => ({ Dialog: () => null }))
mock.module("@opencode-ai/ui/icon-button", () => ({ IconButton: () => null }))
mock.module("@opencode-ai/ui/list", () => ({
  List: (props: { children?: (row: typeof oauthModel) => unknown }) => props.children?.(oauthModel),
}))
mock.module("@opencode-ai/ui/provider-icon", () => ({ ProviderIcon: () => null }))
mock.module("@opencode-ai/ui/switch", () => ({ Switch: () => null }))
mock.module("@opencode-ai/ui/tag", () => ({ Tag: () => null }))
mock.module("./dialog-edit-model-context", () => ({ DialogEditModelContext: () => null }))

Object.assign(globalThis, {
  React: {
    createElement: (component: unknown, props: Record<string, unknown> | null, ...children: unknown[]) => {
      if (typeof component !== "function") return null
      return component({ ...props, children: children.length <= 1 ? children[0] : children })
    },
  },
  Fragment_8vg9x3sq: Symbol.for("solid-test-fragment"),
})

const { DialogOAuthProvider } = (await import("./dialog-oauth-provider")) as {
  DialogOAuthProvider: (props: { providerID: string; providerName: string; onBack: () => void }) => unknown
}
const { ServerSDKProvider } = await import("@/context/server-sdk")
const { SettingsProviders } = await import("./settings-providers")
const { SettingsProvidersV2 } = await import("./settings-v2/providers")

describe("DialogOAuthProvider context boundary", () => {
  test("requires the real SDK provider", () => {
    let dispose: VoidFunction | undefined
    expect(() =>
      dispose = createRoot((disposeRoot) => {
        DialogOAuthProvider({ providerID: "openai", providerName: "OpenAI", onBack: () => {} })
        return disposeRoot
      }),
    ).toThrow("SDK context must be used within a context provider")
    dispose?.()
  })

  test("both settings layouts open OAuth editing through the real SDK context", () => {
    const render = (layout: () => unknown, handlers: Array<() => void>) => {
      let dispose: VoidFunction | undefined
      expect(() => {
        dispose = createRoot((disposeRoot) => {
          ServerSDKProvider({
            get children() {
              layout()
              const edit = handlers.shift()
              expect(edit).toBeDefined()
              edit?.()
              return null
            },
          })
          return disposeRoot
        })
      }).not.toThrow()
      dispose?.()
    }

    translatedKeys.length = 0
    render(() => SettingsProviders({}), legacyEditHandlers)
    render(() => SettingsProvidersV2({}), v2EditHandlers)

    expect(translatedKeys).toContain("provider.oauth.authManaged")
    expect(translatedKeys).toContain("provider.oauth.models.context")
  })
})
