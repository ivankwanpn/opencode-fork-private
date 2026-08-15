# Canonical Tool Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the process-local P5 deferred-tool list with a deterministic, Location-scoped canonical catalog and structured exact-select/BM25 search while preserving `ToolRegistry` as the only executable registry.

**Architecture:** Catalog identity and source metadata decorate the existing opaque Core `Tool` runtime and are materialized only after the current Location, visibility, override, permission, and Plugin definition-hook filters. Scoped source contributions live inside `ToolRegistry`; their tools still execute only through the existing materialization settlement closure. A provider-neutral search index consumes the filtered snapshot, returns canonical structured matches, and caches by deterministic snapshot revision; durable Session events and provider-native wire formats remain later plans.

**Tech Stack:** TypeScript, Effect 4, Bun `CryptoHasher`, Effect JSON Schema projection, Bun test, existing V2 `Tool`, `Tools`, `ToolRegistry`, MCP runtime, Plugin compatibility bridge, and Plugin runtime readiness projection.

## Global Constraints

- Work on branch `888.0.18` in `D:\agent-complete\opencode-fork-private-999.0.15`.
- Keep `docs/superpowers/handoffs/` untracked and do not edit, stage, remove, or commit it.
- Do not add a second executable tool type or registry. `ToolRegistry.Materialization.settle` remains the only generic execution and output-bounding boundary.
- Keep `ApplicationTools.Service` process-scoped and `ToolRegistry.Service` Location-scoped.
- Catalog construction must run after effective visibility, prompt override, permission, model feature, and Plugin definition-hook filtering.
- Hidden and wholly denied tools must not enter catalog tools, search documents, document-frequency counts, results, or diagnostics.
- Direct tools remain advertised without search. Deferred tools remain uncallable until an exact `ToolKey + definitionHash` selection is active.
- Tool identity is `source.type + source.id + sourceLocalID`; callable name, display name, description, and collision suffix are not identity.
- Definition hashes include final model-visible description, input/output schemas, exposure, callable name, and source ownership.
- Snapshot revision is a deterministic content hash, not a process-local counter.
- Existing registration without source metadata has the explicit builtin source `{ type: "builtin", id: "opencode" }`. Application SDK tools use `{ type: "app", id: "opencode-sdk" }`; MCP and Plugin producers must publish explicit ownership.
- Tool source state vocabulary is exactly `pending | ready | degraded | failed | disabled`.
- Search validates a nonempty query and integer limit in `1..20`; default limit is `8`.
- Search order is `select:` exact list, exact `ToolKey` or callable name, then BM25; equal scores sort by `ToolKey`.
- Search output is canonical structured data. Core does not emit OpenAI `tool_search_output` or Anthropic `tool_reference` in this tranche.
- Selection union is monotonic within the current drain. Durable persistence across restart, compaction, and retry remains the next plan.
- Source messages and search output must not contain MCP connection arguments, OAuth tokens, API keys, request headers, or environment variables.
- Run tests and `bun typecheck` from package directories, never from the repository root and never with `tsc` directly.

---

## File Map

- Create `packages/core/src/tool/catalog.ts`: ToolKey/source types, stable canonical JSON, definition hash, source key, and deterministic snapshot construction.
- Create `packages/core/test/tool-catalog.test.ts`: identity, key-order, definition-hook-sensitive hash, revision, and source-state regressions.
- Modify `packages/core/src/tool/tool.ts`: attach optional catalog metadata to the existing opaque Tool runtime through a decorator; do not expose execution internals.
- Modify `packages/core/src/tool/tools.ts`: add the narrow scoped source-contribution registration contract.
- Modify `packages/core/src/tool/application-tools.ts`: assign the explicit App source to process registrations.
- Modify `packages/core/src/tool/registry.ts`: own scoped source stacks, build the filtered catalog snapshot, and select deferred tools by key/hash.
- Modify `packages/core/test/session-runner-tool-registry.test.ts`: assert source ownership, hidden/denied filtering, source replacement, and stale-definition behavior.
- Replace `packages/core/src/tool/tool-search.ts`: validated exact select plus deterministic BM25 over catalog snapshots and structured result output.
- Replace P5 expectations in `packages/core/test/tool-search-deferred.test.ts` and `packages/core/test/tool-search-dynamic.test.ts`.
- Modify `packages/core/src/session/runner/llm.ts` and `packages/core/test/session-runner.test.ts`: accumulate key/hash selections within a drain.
- Modify `packages/core/src/mcp/runtime.ts` and `packages/core/test/mcp-runtime.test.ts`: publish one explicit source contribution per MCP server and keep aggregate resource bridge tools builtin-owned.
- Modify `packages/opencode/src/plugin/index.ts`: expose loaded Plugin IDs together with hooks without breaking the existing hooks-only `list()` consumer.
- Modify `packages/opencode/src/tool/plugin-compat.ts`: preserve Plugin/file source identity on each discovered tool contribution.
- Modify `packages/opencode/src/tool/plugin-compat-v2.ts`: register Plugin tools as scoped ready source contributions with explicit local IDs.
- Modify `packages/opencode/test/tool/plugin-compat-v2.test.ts`: verify same callable names from distinct Plugin sources have distinct keys and scoped removal invalidates the source.
- Modify `packages/opencode/src/plugin/runtime-readiness.ts`, `packages/opencode/src/plugin/runtime-readiness.test.ts`, and `packages/opencode/src/plugin/native-claude-marketplace.ts`: derive the Plugin `tools` capability from authoritative ToolRegistry source state.
- Modify `docs/superpowers/specs/2026-08-11-provider-native-tool-search-design.md` and this plan: record the verified tranche and name the durable-discovery plan.

---

### Task 1: Canonical Identity, Source, and Hash Primitives

**Files:**

- Create: `packages/core/src/tool/catalog.ts`
- Modify: `packages/core/src/tool/tool.ts`
- Test: `packages/core/test/tool-catalog.test.ts`

**Interfaces:**

- Consumes: final `ToolDefinition`, the existing `direct | deferred | hidden` exposure vocabulary, and the opaque Tool runtime WeakMap.
- Produces: `ToolCatalog.Key`, `ToolCatalog.SourceRef`, `ToolCatalog.SourceStatus`, `ToolCatalog.Metadata`, `ToolCatalog.SearchableTool`, `ToolCatalog.Snapshot`, `ToolCatalog.key(...)`, `ToolCatalog.definitionHash(...)`, `ToolCatalog.snapshot(...)`, `Tool.withCatalog(...)`, and `Tool.catalog(...)`.

- [ ] **Step 1: Write failing identity and deterministic-hash tests**

Create `packages/core/test/tool-catalog.test.ts` with tests that assert:

```ts
const plugin = { type: "plugin" as const, id: "calendar@market" }
const mcp = { type: "mcp" as const, id: "calendar" }

expect(ToolCatalog.key(plugin, "create_event")).toBe(ToolCatalog.key(plugin, "create_event"))
expect(ToolCatalog.key(plugin, "create_event")).not.toBe(ToolCatalog.key(mcp, "create_event"))
expect(ToolCatalog.key(plugin, "create_event")).not.toBe(ToolCatalog.key(plugin, "delete_event"))
```

Build two semantically equal input schemas with different object-key insertion order and assert identical definition hashes and snapshot revisions. Then change description, input schema, exposure, callable name, source ID, source-local ID, and source state one at a time and assert the appropriate definition hash or revision changes.

Decorate a tool and assert `Tool.catalog(tool)` returns the frozen metadata while `Tool.catalog(original)` stays `undefined`:

```ts
const decorated = Tool.withCatalog(original, {
  source: plugin,
  sourceLocalID: "create_event",
  namespace: "calendar",
  displayName: "Create event",
  searchHint: "schedule a meeting",
})
expect(Tool.catalog(decorated)?.source).toEqual(plugin)
expect(Tool.catalog(original)).toBeUndefined()
```

- [ ] **Step 2: Run the new test and confirm the missing boundary**

Run from `packages/core`:

```powershell
bun test test/tool-catalog.test.ts
```

Expected: FAIL because `tool/catalog.ts`, `Tool.withCatalog`, and `Tool.catalog` do not exist.

- [ ] **Step 3: Implement catalog primitives with canonical hashing**

Create `catalog.ts` with these public shapes:

```ts
export const Key = Schema.String.pipe(Schema.brand("ToolCatalog.Key"))
export type Key = typeof Key.Type

export type SourceRef = {
  readonly type: "builtin" | "plugin" | "mcp" | "app"
  readonly id: string
  readonly displayName?: string
}

export type SourceState = "pending" | "ready" | "degraded" | "failed" | "disabled"

export type SourceStatus = {
  readonly source: SourceRef
  readonly state: SourceState
  readonly message?: string
}

export type Metadata = {
  readonly source: SourceRef
  readonly sourceLocalID: string
  readonly namespace?: string
  readonly displayName?: string
  readonly searchHint?: string
}

export type SearchableTool = Metadata & {
  readonly key: Key
  readonly callableName: string
  readonly description: string
  readonly inputSchema: JsonSchema.JsonSchema
  readonly outputSchema?: JsonSchema.JsonSchema
  readonly exposure: "direct" | "deferred" | "hidden"
  readonly definitionHash: string
}

export type Snapshot = {
  readonly revision: string
  readonly tools: ReadonlyArray<SearchableTool>
  readonly sources: ReadonlyArray<SourceStatus>
}
```

Use `new Bun.CryptoHasher("sha256")` over a recursive canonical JSON encoder which sorts object keys, preserves array order, and rejects non-JSON values. Encode ToolKey from the canonical tuple `['tool', source.type, source.id, sourceLocalID]`. Sort tools by key and sources by canonical source key before computing revision and returning a frozen snapshot.

- [ ] **Step 4: Attach metadata to the existing opaque Tool runtime**

Extend the private `Runtime` in `tool.ts` with optional `catalog: ToolCatalog.Metadata`. Add:

```ts
export const withCatalog = <Input extends SchemaType<any>, Output extends SchemaType<any>>(
  tool: Definition<Input, Output>,
  metadata: ToolCatalog.Metadata,
) => {
  const decorated = Object.freeze({}) as Definition<Input, Output>
  runtimes.set(decorated, {
    ...runtimeOf(tool),
    catalog: Object.freeze({ ...metadata, source: Object.freeze({ ...metadata.source }) }),
  })
  return decorated
}

export const catalog = (tool: AnyTool) => runtimeOf(tool).catalog
```

Keep `withPermission`, `withPermissions`, and `withExposure` copying the whole runtime so decorator order cannot discard metadata.

- [ ] **Step 5: Run tests and Core typecheck**

Run from `packages/core`:

```powershell
bun test test/tool-catalog.test.ts
bun typecheck
```

Expected: both commands exit 0.

- [ ] **Step 6: Commit the canonical primitives**

```powershell
git add packages/core/src/tool/catalog.ts packages/core/src/tool/tool.ts packages/core/test/tool-catalog.test.ts
git commit -m "feat(core): add canonical tool catalog identity"
```

---

### Task 2: Scoped Source Contributions and Filtered Catalog Materialization

**Files:**

- Modify: `packages/core/src/tool/tools.ts`
- Modify: `packages/core/src/tool/application-tools.ts`
- Modify: `packages/core/src/tool/registry.ts`
- Modify: `packages/core/test/session-runner-tool-registry.test.ts`
- Modify: `packages/core/test/application-tools.test.ts`

**Interfaces:**

- Consumes: Task 1 catalog metadata and hashing.
- Produces: `Tools.Contribution`, `Tools.Interface.contribute(...)`, `ToolRegistry.Interface.sources()`, `ToolRegistry.Materialization.catalog`, and source-aware registrations which still settle through the existing closure.

- [ ] **Step 1: Write failing scoped contribution and catalog-filter tests**

Add tests which register these contributions in separate scopes:

```ts
yield *
  tools.contribute({
    source: { type: "mcp", id: "calendar", displayName: "Calendar" },
    state: "ready",
    tools: {
      calendar_create: Tool.withCatalog(deferred(), {
        source: { type: "mcp", id: "calendar", displayName: "Calendar" },
        sourceLocalID: "create",
        namespace: "calendar",
      }),
    },
  })
```

Assert all of the following:

- the materialized catalog contains the deferred tool and one ready source;
- a hidden tool and a wholly denied tool are absent from `catalog.tools`;
- replacing only the Plugin definition-hook description changes `definitionHash` and revision;
- two sources using the same callable name produce different ToolKeys across sequential effective registrations;
- closing a source scope removes its source status and makes an already materialized call stale;
- contributing `{ state: "pending", tools: {} }` exposes a pending source without fabricating a tool;
- `sources()` reflects the active source stack without executing Plugin definition hooks;
- application registrations use source `{ type: "app", id: "opencode-sdk" }`.

- [ ] **Step 2: Run focused Core tests and confirm missing APIs**

Run from `packages/core`:

```powershell
bun test test/session-runner-tool-registry.test.ts test/application-tools.test.ts
```

Expected: FAIL because `contribute`, `sources`, and `Materialization.catalog` do not exist.

- [ ] **Step 3: Add the narrow contribution contract**

In `tools.ts` declare:

```ts
export type Contribution = {
  readonly source: ToolCatalog.SourceRef
  readonly state: ToolCatalog.SourceState
  readonly message?: string
  readonly permissions?: ReadonlyArray<string>
  readonly tools: Readonly<Record<string, Tool.AnyTool>>
}

export interface Interface {
  readonly register: (
    tools: Readonly<Record<string, Tool.AnyTool>>,
  ) => Effect.Effect<void, Tool.RegistrationError, Scope.Scope>
  readonly contribute: (input: Contribution) => Effect.Effect<void, Tool.RegistrationError, Scope.Scope>
}
```

`register` remains the builtin convenience API. It delegates to the same registry transaction with `{ type: "builtin", id: "opencode" }` and `state: "ready"`. `permissions` is an explicit source-listing visibility declaration for a source that currently has no visible tools; it never grants execution permission. When omitted, the source enters the filtered catalog only when at least one of its tools is actually visible. Never derive this field from hidden tools.

- [ ] **Step 4: Store source and tool stacks in one registry**

In `registry.ts`, keep the current per-name registration stacks and add a per-source contribution stack keyed by `ToolCatalog.sourceKey(source)`. A contribution transaction must:

1. validate every callable name;
2. validate decorated metadata source matches `input.source`;
3. assign undecorated entries `sourceLocalID: callableName`;
4. push all tool registrations plus one source status under the same token inside `Effect.uninterruptible`;
5. remove only that token from both stacks in its finalizer.

Do not store an executor in the catalog entry. Keep the existing `{ identity, tool }` registration and settlement capture.

- [ ] **Step 5: Materialize the canonical snapshot after all filters and hooks**

For each effective registration that survives overrides, `visible(...)`, whole-tool permission filtering, missing definitions, and hidden exposure:

1. run `PluginRuntime.HookName.toolDefinition`;
2. build the final `ToolDefinition`;
3. combine the contribution source with `Tool.catalog(tool)` metadata;
4. create `ToolCatalog.SearchableTool` from the final description and schemas;
5. compute definition hash;
6. append it to catalog tools regardless of direct/deferred exposure.

Return:

```ts
export interface Materialization {
  readonly definitions: ReadonlyArray<ToolDefinition>
  readonly deferred: ReadonlyArray<ToolDefinition>
  readonly catalog: ToolCatalog.Snapshot
  readonly selected: ReadonlySet<string>
  readonly settle: (input: ExecuteInput) => Effect.Effect<Settlement, SettlementError>
}
```

Keep the existing callable-name `selected` Set unchanged in this task. Task 4 replaces it with exact key/hash selection after structured search is available; separating these changes keeps this source/catalog tranche independently reviewable.

Source statuses in `catalog.sources` must be deduplicated by source key. Include a source when it has at least one visible catalog tool, or when it declares nonempty source-listing `permissions` that are not wholly denied by the effective rules. This makes pending/failed MCP sources discoverable to an authorized parent agent while a deny-all subagent fails closed. Omit source identities backed only by hidden or wholly denied tools. `sources()` returns raw active statuses for trusted runtime-readiness consumers and never changes execution authorization.

- [ ] **Step 6: Mark Application tools explicitly**

Add the App source to `ApplicationTools.Entry`. `register(...)` assigns:

```ts
{
  source: { type: "app", id: "opencode-sdk", displayName: "OpenCode SDK" },
  sourceLocalID: name,
}
```

ToolRegistry must preserve an explicitly decorated App tool's local ID/display metadata while requiring its source type/id to match the ApplicationTools source.

- [ ] **Step 7: Run focused and existing registry tests**

Run from `packages/core`:

```powershell
bun test test/tool-catalog.test.ts test/session-runner-tool-registry.test.ts test/application-tools.test.ts
bun typecheck
```

Expected: all commands exit 0 and existing settlement regressions remain unchanged.

- [ ] **Step 8: Commit source-aware catalog materialization**

```powershell
git add packages/core/src/tool/tools.ts packages/core/src/tool/application-tools.ts packages/core/src/tool/registry.ts packages/core/test/session-runner-tool-registry.test.ts packages/core/test/application-tools.test.ts
git commit -m "feat(core): materialize scoped tool catalog"
```

---

### Task 3: Structured Exact Select and BM25 Search

**Files:**

- Replace: `packages/core/src/tool/tool-search.ts`
- Modify: `packages/core/src/tool/registry.ts`
- Modify: `packages/core/test/tool-search-deferred.test.ts`
- Modify: `packages/core/test/tool-search-dynamic.test.ts`

**Interfaces:**

- Consumes: a filtered `ToolCatalog.Snapshot` from Task 2.
- Produces: `ToolSearch.SearchError`, `ToolSearch.Selection`, `ToolSearch.Match`, `ToolSearch.Result`, `ToolSearch.makeIndex()`, and a structured `ToolSearch.makeToolSearchTool(snapshot, index, onSelect)`.

- [ ] **Step 1: Replace P5 text-search expectations with failing canonical search tests**

Cover these cases in the two existing search test files:

- empty/whitespace query fails with `query must not be empty`;
- fractional, zero, negative, and `> 20` limits fail; omitted limit returns at most 8;
- `select:<callable>` and `select:<ToolKey>` return exact matches in requested order with duplicates removed;
- comma-separated `select:` over 20 names fails instead of loading the whole catalog;
- an exact callable or key beats BM25;
- BM25 prioritizes rare schema/description terms and includes nested property names/descriptions, `items`, `anyOf`/`oneOf`/`allOf`, and enum strings;
- no token match returns an empty match list, not the first N tools;
- equal scores order by ToolKey;
- identical revision reuses the cached index and changed revision increments the build count;
- only deferred tools enter the search index;
- structured matches include key, definition hash, callable name, namespace/source metadata, description, input schema, and `deferLoading: true`.

- [ ] **Step 2: Run search tests and confirm the old P5 implementation fails**

Run from `packages/core`:

```powershell
bun test test/tool-search-deferred.test.ts test/tool-search-dynamic.test.ts
```

Expected: FAIL because the current helper accepts invalid limits, uses term frequency rather than BM25, returns plain text, and has no catalog identity or cache.

- [ ] **Step 3: Define validated structured search output**

Use these constants and result contract:

```ts
export const name = "tool_search"
export const DEFAULT_LIMIT = 8
export const MAX_LIMIT = 20

export type Selection = {
  readonly key: ToolCatalog.Key
  readonly definitionHash: string
  readonly callableName: string
}

export type Match = Selection & {
  readonly namespace?: string
  readonly displayName?: string
  readonly description: string
  readonly inputSchema: JsonSchema.JsonSchema
  readonly source: ToolCatalog.SourceRef
  readonly deferLoading: true
}

export type Result = {
  readonly query: string
  readonly catalogRevision: string
  readonly matches: ReadonlyArray<Match>
  readonly pendingSources: ReadonlyArray<ToolCatalog.SourceStatus>
}
```

Make `SearchError` a typed `Schema.TaggedErrorClass` with a safe `message`. The Tool executor maps only `SearchError` to `Tool.Failure`; defects and interruption remain unmasked.

- [ ] **Step 4: Build deterministic BM25 documents**

Tokenize lowercase Unicode letters/numbers and split snake/kebab/camel callable forms. Construct each deferred document from callable name, namespace, source/display names, description, search hint, and recursively extracted JSON Schema property names, descriptions, item schemas, variants, and enum strings.

Implement BM25 with fixed constants `k1 = 1.2` and `b = 0.75`:

```text
idf(term) = ln(1 + (N - df(term) + 0.5) / (df(term) + 0.5))
score += idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + b * docLength / averageDocLength)))
```

`makeIndex()` owns only the latest `{ revision, documents }` and an integer build counter. It rebuilds when revision changes and reports `builds()` for deterministic tests; no process-global unbounded cache is allowed.

- [ ] **Step 5: Implement exact modes and stable search**

Trim the query before validation. A case-insensitive `select:` prefix splits comma-separated selectors, trims each, rejects empty selectors, deduplicates by ToolKey, and requires every selector to match an exact ToolKey or callable name. A plain query equal to a key or callable name returns that exact tool. Otherwise run BM25, drop zero-score documents, sort by descending score then ToolKey, and apply the validated limit.

Return pending sources only when matches are empty; include only pending sources already present in the filtered snapshot and sort them by canonical source key.

- [ ] **Step 6: Make the generic tool return structured data**

`makeToolSearchTool` receives the snapshot and the registry-owned index. Its output schema is a concrete Effect `Schema.Struct` matching `Result`; its `toModelOutput` emits one JSON text block from the encoded structured result. On success call `onSelect` with match selections, not callable names.

The description must explain exact `select:<name>` and that returned tools become available on the next provider call. Do not mention OpenAI or Anthropic wire types here.

- [ ] **Step 7: Run search tests and Core typecheck**

Run from `packages/core`:

```powershell
bun test test/tool-search-deferred.test.ts test/tool-search-dynamic.test.ts
bun typecheck
```

Expected: both commands exit 0.

- [ ] **Step 8: Commit canonical search**

```powershell
git add packages/core/src/tool/tool-search.ts packages/core/src/tool/registry.ts packages/core/test/tool-search-deferred.test.ts packages/core/test/tool-search-dynamic.test.ts
git commit -m "feat(core): add deterministic tool catalog search"
```

---

### Task 4: Key/Hash Selection and Monotonic In-Drain Union

**Files:**

- Modify: `packages/core/src/tool/registry.ts`
- Modify: `packages/core/src/session/runner/llm.ts`
- Modify: `packages/core/test/tool-search-dynamic.test.ts`
- Modify: `packages/core/test/session-runner.test.ts`
- Modify: `packages/core/test/mcp-runtime.test.ts`

**Interfaces:**

- Consumes: `ToolSearch.Selection` from Task 3.
- Produces: `MaterializationContext.selected?: ReadonlyMap<ToolCatalog.Key, string>` and `onSelect?: (selections: ReadonlyArray<ToolSearch.Selection>) => void`.

- [ ] **Step 1: Add failing accumulation and stale-hash regressions**

Add a Core search test which searches `calendar`, then `chat`, and asserts the second materialization advertises both tools. Add another which changes the registered tool description/schema after selection and asserts the old key/hash selection neither advertises nor settles the replacement until it is searched again.

Update the Session runner regression to issue two `tool_search` calls in consecutive provider turns and assert the third request contains the union. Keep the existing direct-call-before-search rejection.

- [ ] **Step 2: Run focused tests and confirm Set/name behavior fails**

Run from `packages/core`:

```powershell
bun test test/tool-search-dynamic.test.ts test/session-runner.test.ts
```

Expected: the union regression FAILS because `searchedTools.select` currently replaces the Set, and stale selection is keyed only by callable name.

- [ ] **Step 3: Select exact catalog identity**

Change selection state to `ReadonlyMap<ToolCatalog.Key, string>`. A deferred catalog entry is active only when:

```ts
context?.selected?.get(entry.key) === entry.definitionHash
```

The materialization still maps model calls by callable name, but settlement uses the registration identity captured for the entry whose key/hash was selected. If the current hash differs, return the existing unsupported-search-first error and do not call the replacement executor.

- [ ] **Step 4: Union selections in the runner**

Replace the per-turn Set with a Map. `select` copies the current map and inserts every `{ key, definitionHash }`, preserving earlier selections. A later search for the same key replaces only that key's hash. Do not persist this map outside the drain in this tranche.

Update every test call site that constructs `selected: new Set([name])` to construct the key/hash map obtained from `materialized.catalog.tools` or a helper that performs one actual search. Do not fabricate a hash from a callable name.

- [ ] **Step 5: Run focused runner, search, and MCP tests**

Run from `packages/core`:

```powershell
bun test test/tool-search-deferred.test.ts test/tool-search-dynamic.test.ts test/session-runner.test.ts test/mcp-runtime.test.ts
bun typecheck
```

Expected: all commands exit 0.

- [ ] **Step 6: Commit identity-safe selection**

```powershell
git add packages/core/src/tool/registry.ts packages/core/src/session/runner/llm.ts packages/core/test/tool-search-deferred.test.ts packages/core/test/tool-search-dynamic.test.ts packages/core/test/session-runner.test.ts packages/core/test/mcp-runtime.test.ts
git commit -m "refactor(core): select deferred tools by identity"
```

---

### Task 5: MCP and Plugin Source Ownership

**Files:**

- Modify: `packages/core/src/mcp/runtime.ts`
- Modify: `packages/core/test/mcp-runtime.test.ts`
- Modify: `packages/opencode/src/plugin/index.ts`
- Modify: `packages/opencode/src/tool/plugin-compat.ts`
- Modify: `packages/opencode/src/tool/plugin-compat-v2.ts`
- Modify: `packages/opencode/test/tool/plugin-compat-v2.test.ts`

**Interfaces:**

- Consumes: `Tools.Interface.contribute(...)` and `Tool.withCatalog(...)`.
- Produces: explicit MCP server and Plugin source contributions that share their scoped registration lifetime with executable tools.

- [ ] **Step 1: Write failing MCP ownership/lifecycle tests**

Extend `mcp-runtime.test.ts` to assert:

- connected server `demo_server` publishes source `{ type: "mcp", id: "demo_server" }` with `ready`;
- original MCP tool name is `sourceLocalID`, while sanitized callable name remains only `callableName`;
- tools/list change alters revision and the affected definition hash/key behavior without changing the source identity;
- disconnect or failed connection removes tools and publishes disabled/failed state with a safe message;
- aggregate `list_mcp_resources`, `list_mcp_resource_templates`, and `read_mcp_resource` stay builtin-owned rather than pretending to belong to one server.

- [ ] **Step 2: Write failing Plugin ownership tests**

Expose a Plugin entry accessor while retaining `list(): Hooks[]`:

```ts
export type Entry = { readonly id: string; readonly hooks: Hooks }

export interface Interface {
  readonly list: () => Effect.Effect<Hooks[]>
  readonly entries: () => Effect.Effect<ReadonlyArray<Entry>>
  readonly init: () => Effect.Effect<void>
}
```

Add Plugin compatibility tests proving two plugin IDs with the same plugin-local tool name produce distinct ToolKeys and that closing/replacing the Plugin contribution removes or replaces only its own source.

- [ ] **Step 3: Run focused tests and confirm ownership is missing**

Run from `packages/core`:

```powershell
bun test test/mcp-runtime.test.ts
```

Run from `packages/opencode`:

```powershell
bun test test/tool/plugin-compat-v2.test.ts
```

Expected: FAIL because MCP and Plugin tools currently call source-less `register(...)`, and Plugin `list()` drops loaded IDs.

- [ ] **Step 4: Publish one MCP contribution per server**

In the MCP tools synchronization layer:

1. read `mcp.status()` and `mcp.tools()` once;
2. group tool entries by `entry.clientName`;
3. decorate each tool with source `{ type: "mcp", id: clientName, displayName: clientName }`, original `entry.def.name` as `sourceLocalID`, and `clientName` as namespace;
4. call `tools.contribute(...)` once per configured server using mapped source state and a sanitized server tool-prefix action for source-listing visibility while tools/list is unavailable;
5. register aggregate resource bridge tools with the builtin convenience API;
6. build all new contributions under the child scope before closing the previous scope.

Map `connected → ready`, `disabled → disabled`, and `failed | needs_auth | needs_client_registration → failed`. Messages must use the existing sanitized status text only; never serialize server configuration.

- [ ] **Step 5: Preserve Plugin IDs during discovery and registration**

Implement `Plugin.Service.entries()` from the already deduplicated active `LoadedHook[]`; keep `list()` as `entries().map(entry => entry.hooks)` for compatibility.

Extend `PluginToolCompat.Contribution` with:

```ts
readonly source: ToolCatalog.SourceRef
readonly sourceLocalID: string
readonly namespace?: string
```

Hook tools use the loaded Plugin ID. File tools use a non-path-leaking source ID `file-tools:<sha256-of-canonical-file-url>` and the filename as display name. `PluginToolCompatV2` groups contributions by source, decorates each tool, and calls `Tools.contribute({ state: "ready", ... })` once per source.

- [ ] **Step 6: Run Core/OpenCode tests and typechecks**

Run from `packages/core`:

```powershell
bun test test/mcp-runtime.test.ts test/session-runner-tool-registry.test.ts
bun typecheck
```

Run from `packages/opencode`:

```powershell
bun test test/tool/plugin-compat-v2.test.ts test/plugin/loader-shared.test.ts
bun typecheck
```

Expected: all commands exit 0.

- [ ] **Step 7: Commit explicit source ownership**

```powershell
git add packages/core/src/mcp/runtime.ts packages/core/test/mcp-runtime.test.ts packages/opencode/src/plugin/index.ts packages/opencode/src/tool/plugin-compat.ts packages/opencode/src/tool/plugin-compat-v2.ts packages/opencode/test/tool/plugin-compat-v2.test.ts
git commit -m "feat(plugin): publish tool source ownership"
```

---

### Task 6: Authoritative Plugin Tool Readiness

**Files:**

- Modify: `packages/opencode/src/plugin/claude-marketplace.ts`
- Modify: `packages/opencode/src/plugin/runtime-readiness.ts`
- Modify: `packages/opencode/src/plugin/runtime-readiness.test.ts`
- Modify: `packages/opencode/src/plugin/native-claude-marketplace.ts`
- Modify: `packages/opencode/src/plugin/claude-marketplace.test.ts`

**Interfaces:**

- Consumes: `ToolRegistry.Interface.sources()` and explicit Plugin/MCP source IDs.
- Produces: a `tools` Plugin capability based on authoritative source state rather than the temporary unconditional `pending` fallback.

- [ ] **Step 1: Add failing tools-capability reducer tests**

Add `toolSourceIDs: readonly string[]` to `RuntimeDescriptor` and `toolSources: readonly ToolCatalog.SourceStatus[]` to runtime observations. Test these exact mappings for an enabled descriptor with `capabilities: ["tools"]`:

- missing expected source → `pending`;
- source `pending` → `pending`;
- every expected source `ready` → `ready`;
- any expected source `failed | disabled` with none pending → `failed` with safe message;
- at least one ready plus at least one failed → capability `failed`, allowing the existing overall reducer to show degraded when another capability is ready;
- disabled plugin → `disabled` without inspecting sources.

- [ ] **Step 2: Run readiness tests and confirm the hardcoded pending fallback**

Run from `packages/opencode`:

```powershell
bun test src/plugin/runtime-readiness.test.ts src/plugin/claude-marketplace.test.ts
```

Expected: FAIL because the `tools` branch currently always returns `pending` and descriptors do not carry source identities.

- [ ] **Step 3: Derive expected source identities deterministically**

For managed Claude plugins, populate `toolSourceIDs` from the same runtime Plugin identity used by Plugin tool registration. Do not infer an owner by parsing callable names. Disabled descriptors retain expected IDs but no active artifacts, so the reducer can return disabled from management state first.

- [ ] **Step 4: Read ToolRegistry source state in the Location runtime endpoint**

In `native-claude-marketplace.ts`, acquire `ToolRegistry.Service` alongside Skill, Command, MCP, and PluginV2 services and pass `yield* tools.sources()` into `runtimeSnapshot`. Do not call `materialize()` merely to read readiness and do not run Plugin definition hooks from the settings endpoint.

- [ ] **Step 5: Implement source-state reduction**

Match Plugin sources by exact `{ type: "plugin", id }`. Preserve the existing capability vocabulary: a mixed ready/failed Tool source set returns capability `failed` with a count-only safe summary; it must not list connection arguments or paths. Remove the unconditional final `pending` branch and make the switch exhaustive.

- [ ] **Step 6: Run Plugin, capability, and typecheck verification**

Run from `packages/opencode`:

```powershell
bun test src/plugin/runtime-readiness.test.ts src/plugin/claude-marketplace.test.ts test/tool/plugin-compat-v2.test.ts
bun typecheck
```

Expected: all commands exit 0.

- [ ] **Step 7: Commit authoritative tool readiness**

```powershell
git add packages/opencode/src/plugin/claude-marketplace.ts packages/opencode/src/plugin/runtime-readiness.ts packages/opencode/src/plugin/runtime-readiness.test.ts packages/opencode/src/plugin/native-claude-marketplace.ts packages/opencode/src/plugin/claude-marketplace.test.ts
git commit -m "feat(plugin): report tool source readiness"
```

---

### Task 7: Cross-Package Regression Gate and Design Status

**Files:**

- Modify: `docs/superpowers/specs/2026-08-11-provider-native-tool-search-design.md`
- Modify: `docs/superpowers/plans/2026-08-15-canonical-tool-catalog.md`

**Interfaces:**

- Consumes: Tasks 1–6.
- Produces: a verified canonical-catalog/search tranche and an explicit next plan boundary for durable discovery.

- [ ] **Step 1: Run focused Core regression suites**

Run from `packages/core`:

```powershell
bun test test/tool-catalog.test.ts test/tool-search-deferred.test.ts test/tool-search-dynamic.test.ts test/session-runner-tool-registry.test.ts test/application-tools.test.ts test/mcp-runtime.test.ts test/session-runner.test.ts
```

Expected: all focused Core tests pass with 0 failures.

- [ ] **Step 2: Run focused OpenCode regression suites**

Run from `packages/opencode`:

```powershell
bun test src/plugin/runtime-readiness.test.ts src/plugin/claude-marketplace.test.ts test/tool/plugin-compat-v2.test.ts test/plugin/loader-shared.test.ts
```

Expected: all focused OpenCode tests pass with 0 failures.

- [ ] **Step 3: Run affected typechecks**

Run separately:

```text
packages/core: bun typecheck
packages/opencode: bun typecheck
packages/app: bun typecheck
```

Expected: all three commands exit 0. App is included because its Plugin runtime wire consumer must remain compatible even without public schema changes.

- [ ] **Step 4: Verify the catalog invariants from fresh evidence**

Confirm from tests and final diff:

- hidden/denied tools never enter catalog/search;
- same callable name across sources has different keys;
- definition hook/schema changes alter hash and invalidate selection;
- two searches union within one drain;
- scoped removal makes old calls stale;
- MCP and Plugin sources publish explicit ownership;
- Plugin tools readiness is not hardcoded pending;
- no provider-native wire type or durable Session event was added early.

- [ ] **Step 5: Inspect worktree and protected paths**

Run from repository root:

```powershell
git diff --check
git status --short --branch
git diff --stat fabe31b..HEAD
```

Expected: only intended code/docs are changed or committed and `docs/superpowers/handoffs/` remains the sole unrelated untracked path.

- [ ] **Step 6: Record the next independent plan**

Update the design status to state that Plugin readiness plus canonical catalog/search are verified, while restart/compaction durability and provider-native adapters are not complete. Name the next plan exactly:

```text
docs/superpowers/plans/2026-08-15-durable-tool-discovery.md
```

Check off completed steps in this plan and record fresh test counts.

- [ ] **Step 7: Commit verification documentation**

```powershell
git add docs/superpowers/specs/2026-08-11-provider-native-tool-search-design.md docs/superpowers/plans/2026-08-15-canonical-tool-catalog.md
git commit -m "docs: record canonical tool catalog verification"
```

---

## Acceptance Criteria

- `ToolRegistry` remains the only executable registry and settlement path.
- Every searchable tool has a deterministic ToolKey based on explicit source ownership and source-local identity.
- Definition hashes reflect final post-hook model-visible definitions and source ownership.
- Snapshot revisions are stable for equal content across reconstruction and change for tools, definitions, exposure, ownership, or source-state changes.
- Hidden and wholly denied tools are absent before indexing and cannot affect BM25 document frequency.
- Search rejects invalid query/limit values, supports exact `select:`, returns structured loadable specs, and implements deterministic BM25 with ToolKey tie-breaking.
- Search index reuse is keyed by revision and does not grow without bound.
- Deferred tools require an active matching key/hash selection; stale selections cannot execute replacement definitions.
- Multiple searches accumulate within a drain instead of replacing earlier selections.
- MCP and Plugin tools publish explicit scoped source ownership; source removal/replacement updates catalog state and revision.
- Plugin `tools` readiness comes from ToolRegistry source state.
- Direct tools remain direct and existing permission checks still execute at their canonical leaf boundaries.
- No durable Session discovery claim or native OpenAI/Anthropic wire claim is made by this tranche.
- `docs/superpowers/handoffs/` remains untouched and untracked.
