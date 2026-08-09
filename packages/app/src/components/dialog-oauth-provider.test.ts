import { describe, expect, mock, test } from "bun:test"
import { createRoot } from "solid-js"

mock.module("@/context/language", () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}))

mock.module("@/context/models", () => ({
  useModels: () => ({
    list: () => [],
    visible: () => true,
    setVisibility: () => {},
  }),
}))

mock.module("@/context/server-sdk", () => ({
  useServerSDK: () => async () => ({
    apiForGeneration: async () => ({
      providers: { discoverModels: async () => ({ data: { source: "oauth", models: [] } }) },
    }),
  }),
}))

mock.module("@/context/server-sync", () => ({
  useServerSync: () => () => ({
    data: { path: { directory: "/workspace" } },
    refreshProviders: async () => {},
  }),
}))

mock.module("@opencode-ai/ui/button", () => ({ Button: () => null }))
mock.module("@opencode-ai/ui/context/dialog", () => ({ useDialog: () => ({ show: async () => {} }) }))
mock.module("@opencode-ai/ui/dialog", () => ({ Dialog: () => null }))
mock.module("@opencode-ai/ui/icon-button", () => ({ IconButton: () => null }))
mock.module("@opencode-ai/ui/list", () => ({ List: () => null }))
mock.module("@opencode-ai/ui/provider-icon", () => ({ ProviderIcon: () => null }))
mock.module("@opencode-ai/ui/switch", () => ({ Switch: () => null }))
mock.module("./dialog-edit-model-context", () => ({ DialogEditModelContext: () => null }))

// Bun's test transpiler uses the classic JSX runtime for this imported TSX module.
Object.assign(globalThis, {
  React: { createElement: () => null },
  Fragment_8vg9x3sq: Symbol.for("solid-test-fragment"),
})

const dialogModule = (await import("./dialog-oauth-provider")) as Record<string, unknown>
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
  test("can initialize through the settings-scoped context fixture", () => {
    let dispose: VoidFunction | undefined
    expect(() => {
      dispose = createRoot((disposeRoot) => {
        DialogOAuthProvider({ providerID: "openai", providerName: "OpenAI", onBack: () => {} })
        return disposeRoot
      })
    }).not.toThrow()
    dispose?.()
  })
})
