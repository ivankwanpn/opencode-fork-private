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

mock.module("@/context/global", () => ({
  useGlobal: () => ({
    ensureServerCtx: () => ({ sdk: testServerSDK }),
  }),
}))

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
  useDialog: () => ({
    show: async (factory: () => unknown) => factory(),
    close: () => {},
  }),
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

// Bun's test transpiler uses the classic JSX runtime for this imported TSX module.
Object.assign(globalThis, {
  React: {
    createElement: (component: unknown, props: Record<string, unknown> | null, ...children: unknown[]) => {
      if (typeof component !== "function") return null
      return component({ ...props, children: children.length <= 1 ? children[0] : children })
    },
  },
  Fragment_8vg9x3sq: Symbol.for("solid-test-fragment"),
})

const dialogModule = (await import("./dialog-oauth-provider")) as Record<string, unknown>
const { ServerSDKProvider } = await import("@/context/server-sdk")
const { SettingsProviders } = await import("./settings-providers")
const { SettingsProvidersV2 } = await import("./settings-v2/providers")
const { DialogOAuthProvider, oauthModelRows } = dialogModule as {
  DialogOAuthProvider: (props: { providerID: string; providerName: string; onBack: () => void }) => unknown
  oauthModelRows: <T extends { provider: { id: string } }>(input: { providerID: string; models: readonly T[] }) => T[]
}

type DiscoveryResponse = { data: { source: string; models: readonly { id: string }[] } }
type DiscoveryState = {
  attempted: boolean
  loading: boolean
  source?: string
  count?: number
  error?: string
}
type DiscoveryController = { discover: () => Promise<void> }
type DiscoveryControllerFactory = (input: {
  providerID: string
  directory: () => string
  discoverModels: (input: { providerID: string; location: { directory: string } }) => Promise<DiscoveryResponse>
  refreshProviders: () => Promise<void>
  update: (patch: Partial<DiscoveryState>) => void
}) => DiscoveryController
type ErrorKey = (error: unknown) => string

const createOAuthDiscoveryController = dialogModule.createOAuthDiscoveryController as DiscoveryControllerFactory
const oauthDiscoveryErrorKey = dialogModule.oauthDiscoveryErrorKey as ErrorKey

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function controllerFixture(input: {
  discoverModels: (input: { providerID: string; location: { directory: string } }) => Promise<DiscoveryResponse>
  refreshProviders?: () => Promise<void>
}) {
  const state: DiscoveryState = { attempted: false, loading: false }
  const calls: Array<{ providerID: string; location: { directory: string } }> = []
  let refreshes = 0
  const controller = createOAuthDiscoveryController({
    providerID: "openai",
    directory: () => "/workspace",
    discoverModels: async (request) => {
      calls.push(request)
      return input.discoverModels(request)
    },
    refreshProviders: async () => {
      refreshes += 1
      await input.refreshProviders?.()
    },
    update: (patch) => Object.assign(state, patch),
  })

  return { calls, controller, refreshes: () => refreshes, state }
}

describe("oauthModelRows", () => {
  test("uses arbitrary catalog model IDs", () => {
    const rows = oauthModelRows({
      providerID: "openai",
      models: [
        { id: "runtime-only-model", name: "Runtime", provider: { id: "openai" } },
        { id: "other-model", name: "Other", provider: { id: "other" } },
      ],
    })

    expect(rows.map((row) => ({ id: row.id, name: row.name }))).toEqual([
      { id: "runtime-only-model", name: "Runtime" },
    ])
  })
})

describe("oauth discovery error presentation", () => {
  test("maps discovery failures to translated keys without exposing server details", () => {
    expect(oauthDiscoveryErrorKey({
      _tag: "ProviderModelDiscoveryError",
      kind: "unsupported",
      message: "https://provider.example/v1/models Bearer secret-token",
    })).toBe("provider.oauth.discovery.unsupported")
    expect(oauthDiscoveryErrorKey({ _tag: "ProviderModelDiscoveryError", kind: "empty" })).toBe(
      "provider.oauth.discovery.empty",
    )
    expect(oauthDiscoveryErrorKey({ _tag: "ProviderModelDiscoveryError", kind: "authentication" })).toBe(
      "provider.oauth.discovery.failure",
    )
    expect(oauthDiscoveryErrorKey(new Error("Bearer secret-token"))).toBe("provider.oauth.discovery.failure")
  })
})

describe("OAuth discovery controller", () => {
  test("sends only the current provider and location, then ignores a stale completion", async () => {
    const first = deferred<DiscoveryResponse>()
    const second = deferred<DiscoveryResponse>()
    const requests = [first.promise, second.promise]
    const fixture = controllerFixture({ discoverModels: async () => requests.shift()! })

    const older = fixture.controller.discover()
    const newer = fixture.controller.discover()

    expect(fixture.calls).toEqual([
      { providerID: "openai", location: { directory: "/workspace" } },
      { providerID: "openai", location: { directory: "/workspace" } },
    ])

    first.resolve({ data: { source: "oauth", models: [{ id: "old" }] } })
    await older
    expect(fixture.refreshes()).toBe(0)
    expect(fixture.state.source).toBeUndefined()

    second.resolve({ data: { source: "provider", models: [{ id: "new" }, { id: "newer" }] } })
    await newer
    expect(fixture.refreshes()).toBe(1)
    expect(fixture.state).toMatchObject({ attempted: true, loading: false, source: "provider", count: 2 })
  })

  test("keeps catalog rows usable after failure and allows a retry", async () => {
    const rows = [{ id: "runtime-model", provider: { id: "openai" } }]
    const failure = deferred<DiscoveryResponse>()
    const success = deferred<DiscoveryResponse>()
    const requests = [failure.promise, success.promise]
    const fixture = controllerFixture({ discoverModels: async () => requests.shift()! })

    const failed = fixture.controller.discover()
    failure.reject({ _tag: "ProviderModelDiscoveryError", kind: "empty", message: "raw upstream response" })
    await failed
    expect(oauthModelRows({ providerID: "openai", models: rows })).toEqual(rows)
    expect(fixture.state).toMatchObject({ attempted: true, loading: false, error: "provider.oauth.discovery.empty" })
    expect(fixture.refreshes()).toBe(0)

    const retried = fixture.controller.discover()
    success.resolve({ data: { source: "oauth", models: [{ id: "fresh" }] } })
    await retried
    expect(fixture.state).toMatchObject({ attempted: true, loading: false, source: "oauth", count: 1, error: undefined })
    expect(fixture.refreshes()).toBe(1)
  })
})

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
