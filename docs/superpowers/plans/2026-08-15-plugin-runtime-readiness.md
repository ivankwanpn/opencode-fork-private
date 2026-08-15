# Plugin Runtime Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Plugin settings page distinguish catalog loading, empty, failed, and stale states, and report Location-scoped runtime readiness from actual Skill, Command, MCP, and PluginV2 observations.

**Architecture:** Keep `/api/plugins` as the global marketplace and installation catalog, then add a separate Location-aware `/api/plugins/runtime` projection. The native Claude marketplace capability supplies expected contributions, Core services supply observed contributions, and the App retains the last successful snapshots while rejecting stale server, protocol-generation, location, and request results.

**Tech Stack:** TypeScript, Effect 4, Effect HttpApi, SolidJS, Bun test, generated `@opencode-ai/client`, App i18n dictionaries.

## Global Constraints

- Work on branch `888.0.18` in `D:\agent-complete\opencode-fork-private-999.0.15`.
- Keep `docs/superpowers/handoffs/` untracked and do not edit, stage, remove, or commit it.
- Keep runtime dependencies directed from Schema to Core and Protocol, then from Core and Protocol to Server. Client runtime code may depend on Schema and Protocol but never Core or Server.
- Keep `/api/plugins` global; make only `/api/plugins/runtime` Location-aware.
- `installed` and `enabled` remain management state and never imply runtime readiness.
- Catalog and runtime requests retain their last successful value on refresh failure and ignore stale responses.
- Render an empty catalog only after a successful empty response; never render empty while the first request is pending or failed.
- Runtime vocabulary is exactly `disabled | initializing | ready | degraded | failed` for a plugin and `disabled | pending | ready | failed` for a capability.
- Capability vocabulary is exactly `skills | commands | mcp | plugin | tools`.
- New user-facing copy must use App i18n keys, with key parity across every locale.
- Do not edit `packages/client/src/generated` or `packages/client/src/generated-effect` by hand. After changing the public Protocol or Server `HttpApi`, run `bun run generate` from `packages/client`.
- Run tests and `bun typecheck` from their package directories, never from the repository root and never by invoking `tsc` directly.
- Use the existing V2 `ToolRegistry` as the only executable registry. This tranche does not add the canonical Tool Search catalog or provider-native adapters.

---

## File Map

- `packages/schema/src/plugin.ts`: shared runtime state vocabulary and wire-safe snapshot schemas.
- `packages/schema/src/index.ts`: exports the existing `Plugin` namespace to package-root consumers.
- `packages/core/src/plugin.ts`: exposes a read-only snapshot of PluginV2 load state without changing activation semantics.
- `packages/core/test/plugin.test.ts`: verifies initializing, ready, failed, replacement, and removal inspection.
- `packages/opencode/src/plugin/claude-marketplace.ts`: describes the contributions an installed marketplace plugin is expected to publish.
- `packages/opencode/src/plugin/runtime-readiness.ts`: pure aggregation from expected contributions plus observed Core runtime state.
- `packages/opencode/src/plugin/runtime-readiness.test.ts`: exhaustively verifies capability and overall-state reduction.
- `packages/opencode/src/plugin/native-claude-marketplace.ts`: reads Location-scoped Core services and produces the runtime snapshot.
- `packages/opencode/src/plugin/claude-marketplace.test.ts`: verifies descriptors and native capability observations.
- `packages/protocol/src/groups/plugin.ts`: declares the Location-aware runtime endpoint.
- `packages/protocol/src/api.ts`: applies Location middleware to the Plugin group so only the runtime handler consumes Location services.
- `packages/server/src/plugin-capability.ts`: adds the runtime capability contract and unavailable fallback.
- `packages/server/src/handlers/plugin.ts`: serves the runtime snapshot through `response(...)`.
- `packages/client/src/generated/**`: regenerated public Promise client output.
- `packages/client/src/generated-effect/**`: regenerated public Effect client output.
- `packages/client/test/promise.test.ts`: verifies URL encoding and Location response typing for `runtime`.
- `packages/app/src/components/settings-v2/plugin-load-state.ts`: pure stale-safe request state reducer.
- `packages/app/src/components/settings-v2/plugin-load-state.test.ts`: verifies first load, refresh, retained snapshot, and stale-request behavior.
- `packages/app/src/components/settings-v2/plugin-runtime-status.ts`: selects the runtime row/status presentation from the server snapshot.
- `packages/app/src/components/settings-v2/plugin-runtime-status.test.ts`: verifies missing, pending, ready, degraded, failed, and stale presentation.
- `packages/app/src/components/settings-v2/plugins.tsx`: drives the two independent resources and renders truthful states.
- `packages/app/src/components/settings-v2/plugins-loading.smoke.tsx`: DOM regression for the first-load empty-state bug.
- `packages/app/src/components/settings-v2/plugins-context.test.ts`: runs the isolated loading smoke test.
- `packages/app/src/components/settings-v2/settings-v2.css`: loading, stale, error, and capability status styles.
- `packages/app/src/i18n/{en,ar,br,bs,da,de,es,fr,ja,ko,no,pl,ru,th,tr,uk,zh,zht}.ts`: new Plugin catalog/runtime copy.
- `packages/app/src/i18n/parity.test.ts`: asserts every locale contains the new keys.

---

### Task 1: Shared Runtime Vocabulary and PluginV2 Inspection

**Files:**
- Modify: `packages/schema/src/plugin.ts`
- Modify: `packages/schema/src/index.ts`
- Modify: `packages/core/src/plugin.ts`
- Test: `packages/core/test/plugin.test.ts`

**Interfaces:**
- Consumes: the existing `Plugin.ID`, PluginV2 `active`, `loading`, and `failures` collections.
- Produces: `Plugin.LoadStatus`, `Plugin.RuntimeCapability`, `Plugin.RuntimeInfo`, `Plugin.RuntimeSnapshot`, and `PluginV2.Interface.status(): Effect.Effect<Readonly<Record<string, Plugin.LoadStatus>>>`.

- [ ] **Step 1: Write failing PluginV2 status tests**

Add tests which hold an activation with a `Deferred`, inspect it while loading, inspect a successful activation, inspect `Effect.die("boom")`, and verify removal deletes the entry:

```ts
it.effect("reports initializing, ready, failed, and removed plugins", () =>
  Effect.gen(function* () {
    const plugins = yield* PluginV2.Service
    const gate = yield* Deferred.make<void>()
    const loading = plugins
      .add(PluginV2.ID.make("loading"), () => Deferred.await(gate))
      .pipe(Effect.forkChild)

    yield* Effect.yieldNow
    expect((yield* plugins.status()).loading?.state).toBe("initializing")
    yield* Deferred.succeed(gate, undefined)
    yield* Fiber.join(loading)
    expect((yield* plugins.status()).loading).toEqual({ state: "ready" })

    yield* plugins.add(PluginV2.ID.make("failed"), () => Effect.die("boom")).pipe(Effect.exit)
    expect((yield* plugins.status()).failed).toMatchObject({ state: "failed" })

    yield* plugins.remove(PluginV2.ID.make("loading"))
    expect((yield* plugins.status()).loading).toBeUndefined()
  }),
)
```

- [ ] **Step 2: Run the focused Core test and confirm failure**

Run from `packages/core`:

```powershell
bun test test/plugin.test.ts
```

Expected: FAIL because `PluginV2.Interface` has no `status` method.

- [ ] **Step 3: Add the shared schemas**

Extend `packages/schema/src/plugin.ts` with these exact public shapes:

```ts
export const LoadState = Schema.Literal("initializing", "ready", "failed")
export type LoadState = typeof LoadState.Type

export const LoadStatus = Schema.Struct({
  state: LoadState,
  message: Schema.optional(Schema.String),
}).annotate({ identifier: "PluginLoadStatus" })
export type LoadStatus = typeof LoadStatus.Type

export const RuntimeState = Schema.Literal("disabled", "initializing", "ready", "degraded", "failed")
export type RuntimeState = typeof RuntimeState.Type

export const RuntimeCapabilityName = Schema.Literal("skills", "commands", "mcp", "plugin", "tools")
export type RuntimeCapabilityName = typeof RuntimeCapabilityName.Type

export const RuntimeCapabilityState = Schema.Literal("disabled", "pending", "ready", "failed")
export type RuntimeCapabilityState = typeof RuntimeCapabilityState.Type

export const RuntimeCapability = Schema.Struct({
  name: RuntimeCapabilityName,
  state: RuntimeCapabilityState,
  message: Schema.optional(Schema.String),
}).annotate({ identifier: "PluginRuntimeCapability" })
export type RuntimeCapability = typeof RuntimeCapability.Type

export const RuntimeInfo = Schema.Struct({
  id: ID,
  state: RuntimeState,
  capabilities: Schema.Array(RuntimeCapability),
}).annotate({ identifier: "PluginRuntimeInfo" })
export type RuntimeInfo = typeof RuntimeInfo.Type

export const RuntimeSnapshot = Schema.Struct({
  plugins: Schema.Array(RuntimeInfo),
}).annotate({ identifier: "PluginRuntimeSnapshot" })
export type RuntimeSnapshot = typeof RuntimeSnapshot.Type
```

Export `Plugin` from `packages/schema/src/index.ts` alongside the other namespaces.

- [ ] **Step 4: Implement a side-effect-free PluginV2 status snapshot**

Add `status` to `PluginV2.Interface` and implement it by copying current state. Precedence is `loading`, then `active`, then `failures`; failed messages use Effect's rendered cause and never expose the mutable maps:

```ts
readonly status: () => Effect.Effect<Readonly<Record<string, Plugin.LoadStatus>>>
```

```ts
const status = Effect.fn("Plugin.status")(function* () {
  return Object.fromEntries(
    Array.from(new Set([...loading, ...active.keys(), ...failures.keys()]))
      .toSorted()
      .map((id) => {
        if (loading.has(id)) return [id, { state: "initializing" as const }]
        if (active.has(id)) return [id, { state: "ready" as const }]
        const failure = failures.get(id)
        return [
          id,
          {
            state: "failed" as const,
            ...(failure && Exit.isFailure(failure) ? { message: Cause.pretty(failure.cause) } : {}),
          },
        ]
      }),
  )
})
```

Import `Cause`, return `status` from the service, and keep `add`, `remove`, and `wait` behavior unchanged.

- [ ] **Step 5: Run Core tests and typecheck**

Run from `packages/core`:

```powershell
bun test test/plugin.test.ts
bun typecheck
```

Expected: both commands exit 0.

- [ ] **Step 6: Commit the runtime vocabulary**

```powershell
git add packages/schema/src/plugin.ts packages/schema/src/index.ts packages/core/src/plugin.ts packages/core/test/plugin.test.ts
git commit -m "feat(core): expose plugin runtime status"
```

---

### Task 2: Marketplace Contribution Descriptors and Pure Readiness Reduction

**Files:**
- Modify: `packages/opencode/src/plugin/claude-marketplace.ts`
- Create: `packages/opencode/src/plugin/runtime-readiness.ts`
- Create: `packages/opencode/src/plugin/runtime-readiness.test.ts`
- Test: `packages/opencode/src/plugin/claude-marketplace.test.ts`

**Interfaces:**
- Consumes: `Plugin.RuntimeSnapshot`, catalog entries, installed artifact directories, `SkillV2.Info[]`, `CommandV2.Info[]`, `MCP.Status`, and `Plugin.LoadStatus`.
- Produces: `ClaudeMarketplaceManager.runtimeDescriptors(): Promise<RuntimeDescriptor[]>` and `runtimeSnapshot(descriptors, observations): Plugin.RuntimeSnapshot`.

- [ ] **Step 1: Write failing descriptor and reducer tests**

Extend the marketplace install test to assert:

```ts
expect(await manager.runtimeDescriptors()).toEqual([
  expect.objectContaining({
    id: "demo@local-marketplace",
    enabled: true,
    capabilities: ["skills", "commands", "mcp"],
    skillDirectory: path.join(testPaths().generatedSkillDirectory, "local-marketplace__demo"),
    commandNames: ["claude/local-marketplace__demo/demo"],
    mcpServers: ["claude:local-marketplace:demo:demo"],
  }),
])
```

Create reducer tests covering these exact reductions:

```ts
expect(runtimeSnapshot([disabled], emptyObservations).plugins[0]?.state).toBe("disabled")
expect(runtimeSnapshot([enabled], emptyObservations).plugins[0]?.state).toBe("initializing")
expect(runtimeSnapshot([enabled], readyObservations).plugins[0]?.state).toBe("ready")
expect(runtimeSnapshot([enabled], partiallyFailedObservations).plugins[0]?.state).toBe("degraded")
expect(runtimeSnapshot([enabled], failedObservations).plugins[0]?.state).toBe("failed")
```

Also assert that MCP `needs_auth`, `needs_client_registration`, `disabled`, and `failed` become capability `failed`, while an absent expected MCP server remains `pending`.

- [ ] **Step 2: Run focused OpenCode tests and confirm failure**

Run from `packages/opencode`:

```powershell
bun test src/plugin/claude-marketplace.test.ts src/plugin/runtime-readiness.test.ts
```

Expected: FAIL because the descriptor and reducer do not exist.

- [ ] **Step 3: Implement deterministic marketplace descriptors**

Export this type from `claude-marketplace.ts`:

```ts
export type RuntimeDescriptor = {
  readonly id: string
  readonly enabled: boolean
  readonly capabilities: readonly Plugin.RuntimeCapabilityName[]
  readonly skillDirectory?: string
  readonly commandNames: readonly string[]
  readonly mcpServers: readonly string[]
  readonly pluginRuntimeID?: string
}
```

Add `runtimeDescriptors()` to the manager. It must:

- read the persisted state and current catalog once;
- include installed plugins only;
- preserve catalog capability order;
- scan enabled command artifact directories with `new Bun.Glob("**/*.md")`;
- derive command names as `claude/<marketplace>__<plugin>/<relative-path-without-.md>`;
- sort descriptors, command names, and MCP server names;
- include `skillDirectory` only when the enabled artifact exists;
- use `claude-marketplace/<marketplace>/<plugin>` as `pluginRuntimeID` only for the `plugin` capability, establishing the future registration identity without guessing from display names.

When a plugin is disabled, keep its declared capabilities but omit active artifact paths/names so the reducer produces `disabled` without treating missing artifacts as failures.

- [ ] **Step 4: Implement the pure readiness reducer**

Create these observation and reduction boundaries:

```ts
export type RuntimeObservations = {
  readonly skills: readonly SkillV2.Info[]
  readonly commands: readonly CommandV2.Info[]
  readonly mcp: Readonly<Record<string, MCP.Status>>
  readonly plugins: Readonly<Record<string, Plugin.LoadStatus>>
}

export function runtimeSnapshot(
  descriptors: readonly RuntimeDescriptor[],
  observations: RuntimeObservations,
): Plugin.RuntimeSnapshot
```

Use exact capability rules:

- disabled descriptor: every declared capability is `disabled`, overall `disabled`;
- skills: `ready` when at least one observed skill location is inside `skillDirectory`, `pending` while the directory is expected but no skill is observed, `failed` when the capability is declared but no enabled directory exists;
- commands: `ready` when every expected command exists, `pending` when at least one expected command is absent, `failed` when the capability is declared but no command names were materialized;
- mcp: `ready` when every expected server is connected, `pending` when at least one expected server has no status, and `failed` for any terminal non-connected status with its safe status/error text;
- plugin: use `pluginRuntimeID` against `PluginV2.status()`; missing is `pending`, active is `ready`, loading is `pending`, and failed is `failed`;
- tools: return `pending` in this tranche; the canonical Tool Catalog plan replaces this with ToolRegistry source state;
- overall: any pending gives `initializing`; all ready gives `ready`; a mixture of ready and failed gives `degraded`; otherwise failed.

Use `path.relative` for directory containment and reject `..`, `..${path.sep}`, and absolute relative results.

- [ ] **Step 5: Run focused OpenCode tests and typecheck**

Run from `packages/opencode`:

```powershell
bun test src/plugin/claude-marketplace.test.ts src/plugin/runtime-readiness.test.ts
bun typecheck
```

Expected: all commands exit 0.

- [ ] **Step 6: Commit descriptor and reduction behavior**

```powershell
git add packages/opencode/src/plugin/claude-marketplace.ts packages/opencode/src/plugin/claude-marketplace.test.ts packages/opencode/src/plugin/runtime-readiness.ts packages/opencode/src/plugin/runtime-readiness.test.ts
git commit -m "feat(plugin): model runtime readiness"
```

---

### Task 3: Location-aware Plugin Runtime API

**Files:**
- Modify: `packages/protocol/src/groups/plugin.ts`
- Modify: `packages/protocol/src/api.ts`
- Modify: `packages/server/src/plugin-capability.ts`
- Modify: `packages/server/src/handlers/plugin.ts`
- Modify: `packages/opencode/src/plugin/native-claude-marketplace.ts`
- Modify: `packages/opencode/src/plugin/claude-marketplace.test.ts`
- Generated: `packages/client/src/generated/**`
- Generated: `packages/client/src/generated-effect/**`
- Test: `packages/client/test/promise.test.ts`

**Interfaces:**
- Consumes: `runtimeDescriptors()`, `runtimeSnapshot(...)`, Location middleware, `SkillV2.Service`, `CommandV2.Service`, `MCP.Service`, and `PluginV2.Service`.
- Produces: `GET /api/plugins/runtime?location[directory]=...`, returning `Location.response(Plugin.RuntimeSnapshot)`, and `client["server.plugins"].runtime(input)`.

- [ ] **Step 1: Write failing native capability and Promise client tests**

In the native capability test, provide mocked Location-scoped services and assert that `plugins.runtime()` returns a ready `demo@local-marketplace` snapshot after installation.

In `packages/client/test/promise.test.ts`, add:

```ts
test("plugin runtime uses the Location-aware HTTP contract", async () => {
  const requests: string[] = []
  const client = OpenCode.make({
    baseUrl: "http://localhost:3000",
    fetch: async (input) => {
      requests.push(typeof input === "string" ? input : input instanceof URL ? input.href : input.url)
      return Response.json({
        location: { directory: "/tmp/project", project: { id: "project", directory: "/tmp/project" } },
        data: { plugins: [] },
      })
    },
  })

  expect(await client["server.plugins"].runtime({ location: { directory: "/tmp/project" } })).toMatchObject({
    data: { plugins: [] },
  })
  expect(requests).toEqual([
    "http://localhost:3000/api/plugins/runtime?location%5Bdirectory%5D=%2Ftmp%2Fproject",
  ])
})
```

- [ ] **Step 2: Run tests and confirm the missing API**

Run from `packages/opencode`:

```powershell
bun test src/plugin/claude-marketplace.test.ts
```

Run from `packages/client`:

```powershell
bun test test/promise.test.ts
```

Expected: FAIL because `runtime` is not in the capability or generated client.

- [ ] **Step 3: Declare the Protocol endpoint and Server capability**

In `groups/plugin.ts`, import `Plugin` from Schema plus `LocationQuery` and `locationQueryOpenApi`, then add:

```ts
HttpApiEndpoint.get("plugins.runtime", "/api/plugins/runtime", {
  query: LocationQuery,
  success: Location.response(Plugin.RuntimeSnapshot),
  error: ServiceUnavailableError,
}).annotateMerge(locationQueryOpenApi)
```

Apply `PluginGroup.middleware(locationMiddleware)` in `protocol/src/api.ts`. Existing catalog endpoints remain global because their request and response schemas do not contain Location; the middleware merely makes Location services available to the runtime handler.

Add this capability method:

```ts
readonly runtime: () => Effect.Effect<
  Plugin.RuntimeSnapshot,
  ServiceUnavailableError,
  SkillV2.Service | CommandV2.Service | MCP.Service | PluginV2.Service
>
```

The unavailable layer returns `{ plugins: [] }`; it must not label absent host support as a ready installed plugin.

- [ ] **Step 4: Implement the native Location projection and handler**

Implement `runtime` in `native-claude-marketplace.ts` as one Effect:

```ts
runtime: () =>
  Effect.gen(function* () {
    const skills = yield* SkillV2.Service
    const commands = yield* CommandV2.Service
    const mcp = yield* MCP.Service
    const plugins = yield* PluginV2.Service
    const descriptors = yield* run("Reading plugin runtime descriptors", () => manager.runtimeDescriptors())
    return runtimeSnapshot(descriptors, {
      skills: yield* skills.list(),
      commands: yield* commands.list(),
      mcp: yield* mcp.status(),
      plugins: yield* plugins.status(),
    })
  }),
```

Handle the endpoint with:

```ts
.handle("plugins.runtime", () => response(plugins.runtime()))
```

Do not cache the projection in the global capability; LocationServiceMap owns the lifecycle of the observed services.

- [ ] **Step 5: Regenerate clients and update generated-client assertions**

Run from `packages/client`:

```powershell
bun run generate
```

Keep all generator output. Add `runtime` to the expected `server.plugins` method list if the generated-client inventory test asserts method names.

- [ ] **Step 6: Run API tests and typechecks**

Run from `packages/client`:

```powershell
bun test test/promise.test.ts
bun typecheck
```

Run from `packages/protocol`, then `packages/server`, then `packages/opencode`:

```powershell
bun typecheck
```

Finally run from `packages/opencode`:

```powershell
bun test src/plugin/claude-marketplace.test.ts
```

Expected: every command exits 0.

- [ ] **Step 7: Commit the Location runtime endpoint**

```powershell
git add packages/protocol/src/groups/plugin.ts packages/protocol/src/api.ts packages/server/src/plugin-capability.ts packages/server/src/handlers/plugin.ts packages/opencode/src/plugin/native-claude-marketplace.ts packages/opencode/src/plugin/claude-marketplace.test.ts packages/client/src/generated packages/client/src/generated-effect packages/client/test/promise.test.ts
git commit -m "feat(plugin): expose location runtime readiness"
```

---

### Task 4: Stale-safe Catalog and Runtime Resource State

**Files:**
- Create: `packages/app/src/components/settings-v2/plugin-load-state.ts`
- Create: `packages/app/src/components/settings-v2/plugin-load-state.test.ts`

**Interfaces:**
- Consumes: monotonically increasing request IDs plus success/failure results.
- Produces: `PluginLoadState<T>`, `beginPluginLoad`, `resolvePluginLoad`, and `rejectPluginLoad`.

- [ ] **Step 1: Write failing reducer tests**

Cover these transitions:

```ts
expect(beginPluginLoad<Catalog>({ state: "idle" }, 1)).toEqual({ state: "loading", request: 1 })
expect(resolvePluginLoad({ state: "loading", request: 1 }, 1, emptyCatalog)).toEqual({
  state: "ready",
  request: 1,
  value: emptyCatalog,
})
expect(rejectPluginLoad({ state: "refreshing", request: 2, value: catalog }, 2, "offline")).toEqual({
  state: "stale",
  request: 2,
  value: catalog,
  error: "offline",
})
expect(resolvePluginLoad({ state: "loading", request: 2 }, 1, oldCatalog)).toEqual({
  state: "loading",
  request: 2,
})
```

Also verify a first-load failure is `{ state: "failed", error }`, beginning a refresh preserves the prior value, and stale rejection does not replace a newer request.

- [ ] **Step 2: Run the focused App test and confirm failure**

Run from `packages/app`:

```powershell
bun test --conditions=browser --preload ./happydom.ts ./src/components/settings-v2/plugin-load-state.test.ts
```

Expected: FAIL because the reducer module does not exist.

- [ ] **Step 3: Implement the discriminated resource state**

Use this exact public union:

```ts
export type PluginLoadState<T> =
  | { readonly state: "idle" }
  | { readonly state: "loading"; readonly request: number }
  | { readonly state: "refreshing"; readonly request: number; readonly value: T }
  | { readonly state: "ready"; readonly request: number; readonly value: T }
  | { readonly state: "stale"; readonly request: number; readonly value: T; readonly error: string }
  | { readonly state: "failed"; readonly request: number; readonly error: string }
```

`beginPluginLoad` increments only through the caller-provided request ID, preserves the last value for `ready`, `refreshing`, and `stale`, and otherwise enters `loading`. Resolve and reject return the current state unchanged when `request !== current.request`.

- [ ] **Step 4: Run the reducer test and App typecheck**

Run from `packages/app`:

```powershell
bun test --conditions=browser --preload ./happydom.ts ./src/components/settings-v2/plugin-load-state.test.ts
bun typecheck
```

Expected: both commands exit 0.

- [ ] **Step 5: Commit the request-state boundary**

```powershell
git add packages/app/src/components/settings-v2/plugin-load-state.ts packages/app/src/components/settings-v2/plugin-load-state.test.ts
git commit -m "feat(app): add stale-safe plugin loading state"
```

---

### Task 5: Truthful Plugin Settings Rendering

**Files:**
- Modify: `packages/app/src/components/settings-v2/plugins.tsx`
- Modify: `packages/app/src/components/settings-v2/plugin-runtime-status.ts`
- Modify: `packages/app/src/components/settings-v2/plugin-runtime-status.test.ts`
- Create: `packages/app/src/components/settings-v2/plugins-loading.smoke.tsx`
- Modify: `packages/app/src/components/settings-v2/plugins-context.test.ts`
- Modify: `packages/app/src/components/settings-v2/settings-v2.css`

**Interfaces:**
- Consumes: `PluginLoadState<Catalog>`, `PluginLoadState<LocationResponse<Plugin.RuntimeSnapshot>>`, `sdk().protocolGeneration()`, the active SDK object, and the active directory.
- Produces: a page which never displays false empty/readiness states and preserves the last successful view during refresh failures.

- [ ] **Step 1: Expand status and DOM regressions before changing the component**

Replace the MCP-only status tests with `pluginRuntimePresentation(...)` tests that assert:

- no snapshot plus loading returns `initializing`;
- a matching server snapshot returns its exact state and capabilities;
- a missing installed plugin in a ready snapshot returns `failed`;
- a retained snapshot marked stale returns the prior state plus `stale: true`.

Create an isolated smoke test whose mocked `plugins.list()` returns a deferred Promise. Render the component into `document.body` and assert:

```ts
expect(document.body.textContent).toContain("plugin.catalog.loading")
expect(document.body.textContent).not.toContain("plugin.catalog.empty")
resolveList({ marketplaces: [], plugins: [] })
await Promise.resolve()
expect(document.body.textContent).toContain("plugin.catalog.empty")
```

Add the smoke test as a second isolated Bun child process in `plugins-context.test.ts` so `mock.module` does not leak into other tests.

- [ ] **Step 2: Run the focused App regressions and confirm failure**

Run from `packages/app`:

```powershell
bun test --conditions=browser --preload ./happydom.ts ./src/components/settings-v2/plugin-runtime-status.test.ts ./src/components/settings-v2/plugins-context.test.ts
```

Expected: FAIL because the component still initializes the catalog as an empty success and has no runtime endpoint state.

- [ ] **Step 3: Drive independent catalog and runtime requests**

In `plugins.tsx`:

- replace the initial empty catalog signal with `PluginLoadState<Catalog>({ state: "idle" })`;
- add a separate runtime state signal;
- use independent incrementing request IDs;
- capture `const target = sdk()`, `const generation = target.protocolGeneration()`, and the active directory at request start;
- after await, ignore the result when the request ID changed, `target !== sdk()`, `generation !== target.protocolGeneration()`, or the runtime directory changed;
- use `createEffect` to load catalog when the SDK object changes and runtime when SDK or directory changes;
- keep manual retry functions for both resources;
- after install, uninstall, enable, disable, marketplace add/remove/refresh, set the returned catalog as a successful snapshot and explicitly refresh runtime;
- keep the existing MCP/command sync refresh only as invalidation assistance, never as readiness truth.

The runtime request must call:

```ts
api.plugins.runtime({ location: { directory } })
```

- [ ] **Step 4: Render loading, failed, stale, empty, filtered-empty, and runtime states**

Use these rules in `plugins.tsx`:

- first catalog load: loading status only;
- first catalog failure: error status plus Retry, no empty message;
- refresh failure with value: stale warning plus retained rows;
- ready empty catalog: empty message;
- nonempty ready catalog with a filter miss: filtered-empty message;
- installed plugin with runtime request pending: `initializing`;
- runtime success: show overall state and each declared capability state;
- runtime failure without a previous snapshot: `failed` with safe error text;
- runtime refresh failure: preserve previous state and add stale indicator.

Do not read `mcp_ready` or derive plugin readiness directly from directory sync. Remove `pluginMcpRuntimeStatus` and its old props from `PluginRow`.

Add `aria-live="polite"` to loading/stale/error status containers and keep Retry as a real button.

- [ ] **Step 5: Add focused styles without changing the settings layout**

Extend the existing Plugin settings classes with:

```css
.settings-v2-plugin-runtime-summary,
.settings-v2-plugin-capabilities {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.settings-v2-plugin-status-dot--pending { background: var(--icon-warning-base); }
.settings-v2-plugin-status-dot--failed { background: var(--icon-critical-base); }
.settings-v2-plugin-status-dot--degraded { background: var(--icon-warning-base); }
```

Use existing design tokens present in `settings-v2.css`; if one of these exact token names is absent, select the existing warning/critical token from the same file instead of introducing a raw color.

- [ ] **Step 6: Run focused App tests and typecheck**

Run from `packages/app`:

```powershell
bun test --conditions=browser --preload ./happydom.ts ./src/components/settings-v2/plugin-load-state.test.ts ./src/components/settings-v2/plugin-runtime-status.test.ts ./src/components/settings-v2/plugins-context.test.ts
bun typecheck
```

Expected: every command exits 0.

- [ ] **Step 7: Commit the truthful Plugin UI state machine**

```powershell
git add packages/app/src/components/settings-v2/plugins.tsx packages/app/src/components/settings-v2/plugin-runtime-status.ts packages/app/src/components/settings-v2/plugin-runtime-status.test.ts packages/app/src/components/settings-v2/plugins-loading.smoke.tsx packages/app/src/components/settings-v2/plugins-context.test.ts packages/app/src/components/settings-v2/settings-v2.css
git commit -m "fix(app): show truthful plugin loading state"
```

---

### Task 6: Localize Plugin Catalog and Runtime Copy

**Files:**
- Modify: `packages/app/src/i18n/en.ts`
- Modify: `packages/app/src/i18n/zh.ts`
- Modify: `packages/app/src/i18n/zht.ts`
- Modify: `packages/app/src/i18n/ar.ts`
- Modify: `packages/app/src/i18n/br.ts`
- Modify: `packages/app/src/i18n/bs.ts`
- Modify: `packages/app/src/i18n/da.ts`
- Modify: `packages/app/src/i18n/de.ts`
- Modify: `packages/app/src/i18n/es.ts`
- Modify: `packages/app/src/i18n/fr.ts`
- Modify: `packages/app/src/i18n/ja.ts`
- Modify: `packages/app/src/i18n/ko.ts`
- Modify: `packages/app/src/i18n/no.ts`
- Modify: `packages/app/src/i18n/pl.ts`
- Modify: `packages/app/src/i18n/ru.ts`
- Modify: `packages/app/src/i18n/th.ts`
- Modify: `packages/app/src/i18n/tr.ts`
- Modify: `packages/app/src/i18n/uk.ts`
- Modify: `packages/app/src/i18n/parity.test.ts`

**Interfaces:**
- Consumes: the App `language.t(key)` contract.
- Produces: nonempty, parity-checked translations for every new Plugin state key.

- [ ] **Step 1: Add a failing targeted key-presence test**

Add this constant to `parity.test.ts`:

```ts
const pluginRuntimeKeys = [
  "plugin.catalog.loading",
  "plugin.catalog.empty",
  "plugin.catalog.failed",
  "plugin.catalog.retry",
  "plugin.catalog.stale",
  "plugin.catalog.filteredEmpty",
  "plugin.runtime.initializing",
  "plugin.runtime.ready",
  "plugin.runtime.degraded",
  "plugin.runtime.failed",
  "plugin.runtime.stale",
  "plugin.capability.skills",
  "plugin.capability.commands",
  "plugin.capability.mcp",
  "plugin.capability.plugin",
  "plugin.capability.tools",
] as const
```

For every App locale including English, assert each value exists and `trim()` is nonempty.

- [ ] **Step 2: Run parity tests and confirm failure**

Run from `packages/app`:

```powershell
bun test --conditions=browser --preload ./happydom.ts ./src/i18n/parity.test.ts
```

Expected: FAIL listing the missing Plugin keys.

- [ ] **Step 3: Add English, Simplified Chinese, and Traditional Chinese copy**

Use these exact English values:

```ts
"plugin.catalog.loading": "Loading plugins…",
"plugin.catalog.empty": "No plugins available",
"plugin.catalog.failed": "Plugins could not be loaded",
"plugin.catalog.retry": "Retry",
"plugin.catalog.stale": "Showing the last loaded plugin list",
"plugin.catalog.filteredEmpty": "No plugins match this search",
"plugin.runtime.initializing": "Initializing",
"plugin.runtime.ready": "Ready",
"plugin.runtime.degraded": "Partially available",
"plugin.runtime.failed": "Unavailable",
"plugin.runtime.stale": "Status may be out of date",
"plugin.capability.skills": "Skills",
"plugin.capability.commands": "Commands",
"plugin.capability.mcp": "MCP",
"plugin.capability.plugin": "Plugin hooks",
"plugin.capability.tools": "Tools",
```

Use native Simplified and Traditional Chinese translations in `zh.ts` and `zht.ts`. Add accurate native translations for the other locales; do not leave empty strings, copied key names, or delete existing locale keys.

- [ ] **Step 4: Replace all new Plugin page literals with i18n lookups**

Verify `plugins.tsx` uses `language.t(...)` for every loading, empty, filtered-empty, stale, Retry, runtime state, and capability label introduced by Tasks 4–5. Server diagnostic messages remain data and are displayed as supplemental safe text.

- [ ] **Step 5: Run i18n, component, and typecheck verification**

Run from `packages/app`:

```powershell
bun test --conditions=browser --preload ./happydom.ts ./src/i18n/parity.test.ts ./src/components/settings-v2/plugin-load-state.test.ts ./src/components/settings-v2/plugin-runtime-status.test.ts ./src/components/settings-v2/plugins-context.test.ts
bun typecheck
```

Expected: every command exits 0.

- [ ] **Step 6: Commit localized Plugin readiness copy**

```powershell
git add packages/app/src/i18n packages/app/src/components/settings-v2/plugins.tsx
git commit -m "feat(app): localize plugin readiness states"
```

---

### Task 7: Cross-package Regression Gate and Design Status

**Files:**
- Modify: `docs/superpowers/specs/2026-08-11-provider-native-tool-search-design.md`
- Modify: `docs/superpowers/plans/2026-08-15-plugin-runtime-readiness.md`

**Interfaces:**
- Consumes: all deliverables from Tasks 1–6.
- Produces: a verified first tranche and an explicit handoff boundary for the canonical Tool Catalog plan.

- [ ] **Step 1: Run generated-code drift verification**

Run from `packages/client`:

```powershell
bun run check:generated
```

Expected: exit 0 with no generated client diff.

- [ ] **Step 2: Run focused tests package by package**

Run from `packages/core`:

```powershell
bun test test/plugin.test.ts
```

Run from `packages/opencode`:

```powershell
bun test src/plugin/claude-marketplace.test.ts src/plugin/runtime-readiness.test.ts
```

Run from `packages/client`:

```powershell
bun test test/promise.test.ts
```

Run from `packages/app`:

```powershell
bun test --conditions=browser --preload ./happydom.ts ./src/i18n/parity.test.ts ./src/components/settings-v2/plugin-load-state.test.ts ./src/components/settings-v2/plugin-runtime-status.test.ts ./src/components/settings-v2/plugins-context.test.ts
```

Expected: all focused suites pass.

- [ ] **Step 3: Run all affected package typechecks**

Run `bun typecheck` separately from each directory:

```text
packages/schema
packages/core
packages/protocol
packages/server
packages/client
packages/opencode
packages/app
```

Expected: all seven typechecks exit 0.

- [ ] **Step 4: Inspect the final diff and protected paths**

Run from the repository root:

```powershell
git diff --check
git status --short --branch
git diff --stat 12338c50de205a6ce963e723b4548b8535d0e616..HEAD
```

Expected: `git diff --check` exits 0; `docs/superpowers/handoffs/` is still the only unrelated untracked path; no runtime artifact, database, cache, or secret file is staged.

- [ ] **Step 5: Mark the tranche complete and name the next plan**

Update the design status to state that Plugin readiness is implemented and that the next independent document is:

```text
docs/superpowers/plans/2026-08-15-canonical-tool-catalog.md
```

Check off completed steps in this plan. Do not claim Tool Search durability or provider-native behavior is complete; those remain separate plans.

- [ ] **Step 6: Commit verification documentation**

```powershell
git add docs/superpowers/specs/2026-08-11-provider-native-tool-search-design.md docs/superpowers/plans/2026-08-15-plugin-runtime-readiness.md
git commit -m "docs: record plugin readiness verification"
```

---

## Acceptance Criteria

- Opening Plugin settings never shows `No plugins available` before the first successful catalog response.
- A first-load error shows a retryable failure and no false empty state.
- A refresh error retains the last successful catalog and runtime snapshot with a stale indicator.
- Responses from an older request, SDK object, protocol generation, or directory never overwrite current state.
- Installed/enabled is visibly separate from runtime readiness.
- Runtime readiness is computed per Location from observed Skills, Commands, MCP, and PluginV2 state.
- Each declared capability exposes `disabled`, `pending`, `ready`, or `failed`; overall state exposes `disabled`, `initializing`, `ready`, `degraded`, or `failed`.
- Public Promise and Effect clients include the Location-aware runtime endpoint and generated files have no drift.
- App i18n parity passes for all supported locales.
- No second executable registry or provider wire behavior is introduced in this tranche.
- `docs/superpowers/handoffs/` remains untouched and untracked.
