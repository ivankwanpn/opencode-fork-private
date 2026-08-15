# Durable Tool Discovery Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Persist canonical `tool_search` results in the V2 Session event log so discovered deferred tools survive a new drain, process restart, provider retry, and compaction without weakening current Tool Registry filtering.

**Architecture:** Add one minimal durable `SessionEvent.ToolDiscovery.Completed` record and two rebuildable SQLite projections: one invocation record for exact retry and one unioned discovered-tool set. The Tool Registry remains the only executable registry and continues to revalidate every projected `ToolKey + definitionHash` against the current Location-scoped, permission-filtered catalog. `tool_search` gains an Effectful execution boundary that can reuse an existing invocation before running the local search and can publish a new result before returning it. The Session runner hydrates its selected map from the projection at the start of every turn and updates its in-memory copy only after the durable event commits.

**Tech Stack:** TypeScript, Effect, Effect Schema, Drizzle SQLite, Bun tests, V2 `EventV2` projectors, generated Promise/Effect clients.

**Scope:** This tranche completes durable discovery and the generic provider fallback only. OpenAI Responses native `tool_search_output`, Anthropic `tool_reference`, capability negotiation, and native-history reconstruction remain separate follow-up plans.

---

### Task 1: Define the minimal durable discovery event

**Files:**
- Modify: `packages/schema/src/session-event.ts`
- Modify: `packages/schema/test/event-manifest.test.ts`
- Modify: `packages/core/src/session/message-updater.ts`
- Modify: `packages/opencode/test/v2/session-message-updater.test.ts`

**Interfaces:**
- Produces `SessionEvent.ToolDiscovery.Completed` with invocation identity, normalized search input, catalog revision, minimal match identity, and pending source identity.
- Adds no transcript part; existing `Tool.Called` and `Tool.Success` remain the model-facing transcript.

- [ ] **Step 1: Write the failing manifest and schema assertions**

  Extend `packages/schema/test/event-manifest.test.ts` to assert that the new definition is present in `SessionEvent.DurableDefinitions`, `EventManifest.Latest`, and the versioned durable manifest. Decode one valid event containing:

  ```ts
  {
    id: "evt_discovery",
    type: "session.next.tool-discovery.completed",
    data: {
      timestamp: 1,
      sessionID: "ses_discovery",
      assistantMessageID: "msg_discovery",
      callID: "call_search",
      query: "calendar events",
      limit: 8,
      catalogRevision: "revision",
      matches: [{
        key: "tool_key",
        callableName: "calendar_create",
        definitionHash: "hash",
        source: { type: "plugin", id: "calendar" },
      }],
      pendingSources: [{ type: "mcp", id: "remote" }],
    },
  }
  ```

  Encode a value that also contains a full input/output schema and assert those excess fields are absent from the encoded durable event, keeping the persisted record minimal.

- [ ] **Step 2: Run the focused Schema test and confirm failure**

  From `packages/schema`:

  ```powershell
  bun test test/event-manifest.test.ts
  ```

  Expected: FAIL because `ToolDiscovery.Completed` is not defined.

- [ ] **Step 3: Add the event namespace and inventory entries**

  In `packages/schema/src/session-event.ts`, add schemas local to `ToolDiscovery`:

  ```ts
  export namespace ToolDiscovery {
    export const Key = Schema.String.pipe(Schema.brand("ToolCatalog.Key"))
    export const Source = Schema.Struct({
      type: Schema.Literals(["builtin", "plugin", "mcp", "app"]),
      id: Schema.String,
      displayName: Schema.String.pipe(optional),
    })
    export const Match = Schema.Struct({
      key: Key,
      callableName: Schema.String,
      definitionHash: Schema.String,
      source: Source,
    })
    export const Completed = Event.define({
      type: "session.next.tool-discovery.completed",
      ...options,
      schema: {
        ...Base,
        assistantMessageID: SessionMessage.ID,
        callID: Schema.String,
        query: Schema.String,
        limit: PositiveInt,
        catalogRevision: Schema.String,
        matches: Schema.Array(Match),
        pendingSources: Schema.Array(Source),
      },
    })
  }
  ```

  Import `PositiveInt`, then add `ToolDiscovery.Completed` to both `DurableDefinitions` and `Definitions` adjacent to the existing tool lifecycle events.

- [ ] **Step 4: Make transcript projection explicitly ignore discovery state**

  Add this exhaustive no-op to `SessionMessageUpdater`:

  ```ts
  "session.next.tool-discovery.completed": () => Effect.void,
  ```

  Add a focused updater assertion in `packages/opencode/test/v2/session-message-updater.test.ts` showing the event does not append or mutate a transcript message.

- [ ] **Step 5: Run focused tests and typechecks**

  From `packages/schema`:

  ```powershell
  bun test test/event-manifest.test.ts
  bun typecheck
  ```

  From `packages/opencode`:

  ```powershell
  bun test test/v2/session-message-updater.test.ts
  bun typecheck
  ```

  Expected: all commands exit 0. Update manifest cardinality assertions only to the new measured totals.

- [ ] **Step 6: Commit the event contract**

  ```powershell
  git add packages/schema/src/session-event.ts packages/schema/test/event-manifest.test.ts packages/core/src/session/message-updater.ts packages/opencode/test/v2/session-message-updater.test.ts
  git commit -m "feat(schema): add durable tool discovery event"
  ```

---

### Task 2: Add invocation and discovered-set projection tables

**Files:**
- Modify: `packages/core/src/session/sql.ts`
- Modify: `packages/core/test/database-migration.test.ts`
- Generate: `packages/core/schema.json`
- Generate: `packages/core/src/database/migration/<timestamp>_session-tool-discovery.ts`
- Generate: `packages/core/src/database/migration.gen.ts`
- Generate: `packages/core/src/database/schema.gen.ts`

**Interfaces:**
- `SessionToolDiscoveryCallTable`: unique `(session_id, assistant_message_id, tool_call_id)` invocation, storing query, effective limit, catalog revision, minimal matches, pending source refs, sequence, and completion time.
- `SessionToolDiscoveryTable`: unique `(session_id, tool_key)` unioned selection, storing the most recently discovered definition identity and source.

- [ ] **Step 1: Add failing database shape assertions**

  Extend `packages/core/test/database-migration.test.ts` to assert that a current database has both new tables, the invocation uniqueness constraint, the `(session_id, tool_key)` primary key, and cascading foreign keys to `session`.

- [ ] **Step 2: Run the focused migration test and confirm failure**

  From `packages/core`:

  ```powershell
  bun test test/database-migration.test.ts
  ```

  Expected: FAIL because the tables do not exist.

- [ ] **Step 3: Define the Drizzle tables**

  Add the following snake_case columns in `packages/core/src/session/sql.ts`:

  ```text
  session_tool_discovery_call
    session_id, assistant_message_id, tool_call_id
    query, limit, catalog_revision
    matches JSON, pending_sources JSON
    seq, time_completed

  session_tool_discovery
    session_id, tool_key
    definition_hash, callable_name, source JSON
    discovered_seq, time_discovered
  ```

  Use typed JSON values from `SessionEvent.ToolDiscovery`, a composite primary key for each identity, a `session_tool_discovery_session_seq_idx`, and `onDelete: "cascade"` on both Session foreign keys. Do not add a second executable registry or store full tool schemas.

- [ ] **Step 4: Generate the migration and schema artifacts**

  From `packages/core`:

  ```powershell
  bun script/migration.ts --name session-tool-discovery
  ```

  Inspect the generated migration before proceeding. It must only create the two new tables and their indexes; it must not rewrite or drop unrelated tables.

- [ ] **Step 5: Run migration verification and typecheck**

  From `packages/core`:

  ```powershell
  bun test test/database-migration.test.ts
  bun script/migration.ts --check
  bun typecheck
  ```

  Expected: all commands exit 0.

- [ ] **Step 6: Commit the projection storage**

  ```powershell
  git add packages/core/src/session/sql.ts packages/core/test/database-migration.test.ts packages/core/schema.json packages/core/src/database/migration packages/core/src/database/migration.gen.ts packages/core/src/database/schema.gen.ts
  git commit -m "feat(core): store durable tool discovery projections"
  ```

---

### Task 3: Project discovery events and expose canonical selections

**Files:**
- Create: `packages/core/src/session/tool-discovery.ts`
- Create: `packages/core/test/session-tool-discovery.test.ts`
- Modify: `packages/core/src/session/projector.ts`
- Test: `packages/core/test/session-projector.test.ts`

**Interfaces:**
- `SessionToolDiscovery.projectCompleted(db, event)` projects the invocation and unioned tool rows.
- `SessionToolDiscovery.call(db, identity)` returns one prior invocation projection.
- `SessionToolDiscovery.selections(db, sessionID)` returns `ReadonlyMap<ToolCatalog.Key, definitionHash>` without deciding current visibility.
- Current visibility, permissions, exposure, and hash validity remain enforced by `ToolRegistry.materialize`.

- [ ] **Step 1: Write failing projector and selection tests**

  Add tests for:

  1. one completed event atomically writes one call row and every matched discovered row;
  2. a later event unions a different key without dropping the first;
  3. re-searching the same key with a new hash updates that key only;
  4. empty results write the call row but unlock nothing;
  5. exact EventV2 replay is idempotent;
  6. deleting the Session cascades both projections;
  7. `selections` returns only key/hash identity and does not expose stored source data as authorization.

- [ ] **Step 2: Run the new tests and confirm failure**

  From `packages/core`:

  ```powershell
  bun test test/session-tool-discovery.test.ts test/session-projector.test.ts
  ```

  Expected: FAIL because the projector module and registration do not exist.

- [ ] **Step 3: Implement the focused projection module**

  In `packages/core/src/session/tool-discovery.ts`:

  - require `event.durable` and use its sequence as both call sequence and discovered sequence;
  - insert one call row for `(sessionID, assistantMessageID, callID)`;
  - fail closed on a fresh conflicting duplicate invocation instead of overwriting it;
  - upsert each match on `(session_id, tool_key)`, replacing the hash/metadata only when a new completed event explicitly discovers that key;
  - expose sorted reads for deterministic tests;
  - keep helpers synchronous unless they perform database work.

- [ ] **Step 4: Register the EventV2 projector**

  In `packages/core/src/session/projector.ts`, register:

  ```ts
  yield* events.project(SessionEvent.ToolDiscovery.Completed, (event) =>
    SessionToolDiscovery.projectCompleted(db, event),
  )
  ```

  Rely on `EventV2.publish`'s immediate transaction so the projections and event append commit or roll back together. Do not open a nested transaction in `projectCompleted`.

- [ ] **Step 5: Run focused and EventV2 regression tests**

  From `packages/core`:

  ```powershell
  bun test test/session-tool-discovery.test.ts test/session-projector.test.ts test/event.test.ts
  bun typecheck
  ```

  Expected: all commands exit 0.

- [ ] **Step 6: Commit the projector**

  ```powershell
  git add packages/core/src/session/tool-discovery.ts packages/core/src/session/projector.ts packages/core/test/session-tool-discovery.test.ts packages/core/test/session-projector.test.ts
  git commit -m "feat(core): project durable tool discoveries"
  ```

---

### Task 4: Make `tool_search` exact-retry aware and durably complete results

**Files:**
- Modify: `packages/core/src/tool/tool-search.ts`
- Modify: `packages/core/src/tool/registry.ts`
- Modify: `packages/core/src/session/tool-discovery.ts`
- Modify: `packages/core/test/tool-search-deferred.test.ts`
- Modify: `packages/core/test/tool-search-dynamic.test.ts`
- Modify: `packages/core/test/session-tool-discovery.test.ts`
- Modify: `packages/core/test/mcp-runtime.test.ts`

**Interfaces:**
- Export `ToolSearch.normalize(input)` so durable identity compares the trimmed query and effective default limit.
- Replace synchronous `onSelect` with an optional Effectful `executeSearch(input, context, snapshot, search)` boundary. The supplied `search` Effect is cold and is not evaluated on exact retry.
- `SessionToolDiscovery.execute(...)` returns a canonical `ToolSearch.Result`, publishes before success, and maps conflict/staleness to model-visible `Tool.Failure`.

- [ ] **Step 1: Write failing exact-retry and durability tests**

  Cover these cases:

  1. first invocation executes the local index once, publishes one event, and returns the structured result;
  2. same `(sessionID, assistantMessageID, callID)`, normalized query, and effective limit reuses the call projection without executing the cold search or appending another event;
  3. same identity with a different query or limit returns `tool_search invocation conflicts with its durable result`;
  4. a projected result whose key/hash no longer exists in the current catalog fails with a stale-result message and requires a new tool call identity;
  5. empty results are durably completed and exact retry remains empty;
  6. persistence failure prevents `tool_search` from returning success and prevents in-memory selection.

- [ ] **Step 2: Run focused tests and confirm failure**

  From `packages/core`:

  ```powershell
  bun test test/session-tool-discovery.test.ts test/tool-search-deferred.test.ts test/tool-search-dynamic.test.ts
  ```

  Expected: FAIL because search execution cannot be intercepted before the index runs.

- [ ] **Step 3: Extract one normalization boundary**

  Move the existing trim/default/range validation into:

  ```ts
  export type NormalizedInput = { readonly query: string; readonly limit: number }
  export const normalize = (input: { readonly query: string; readonly limit?: number }) =>
    Effect.Effect<NormalizedInput, SearchError>
  ```

  Make `Index.search` consume this helper so exact retry and first execution use identical input semantics.

- [ ] **Step 4: Add Effectful search execution to Tool Registry materialization**

  Replace `MaterializationContext.onSelect` with:

  ```ts
  readonly executeSearch?: ToolSearch.ExecuteSearch
  ```

  `makeToolSearchTool` must pass the decoded input, `Tool.Context`, current immutable catalog snapshot, and a cold `index.search(snapshot, input)` Effect to this callback. With no callback, behavior remains the current provider-neutral local search. Update Core/MCP tests to return Effects from their callback fixtures.

- [ ] **Step 5: Implement durable first-run and retry behavior**

  `SessionToolDiscovery.execute` must:

  - normalize before reading the call projection;
  - on exact retry, reconstruct full loadable matches only from current catalog entries with the stored `ToolKey + definitionHash`;
  - reconstruct pending entries as `state: "pending"` from their stored source refs;
  - fail stale rather than substitute a replacement definition;
  - on first run, evaluate the supplied search Effect, publish `ToolDiscovery.Completed`, and return only after the event/projector commit;
  - persist only source refs for pending sources and only minimal match identity, never the full JSON schema;
  - map conflict and stale errors to stable, actionable `Tool.Failure` messages.

- [ ] **Step 6: Run focused tests and typecheck**

  From `packages/core`:

  ```powershell
  bun test test/session-tool-discovery.test.ts test/tool-search-deferred.test.ts test/tool-search-dynamic.test.ts test/mcp-runtime.test.ts
  bun typecheck
  ```

  Expected: all commands exit 0.

- [ ] **Step 7: Commit the durable execution boundary**

  ```powershell
  git add packages/core/src/tool/tool-search.ts packages/core/src/tool/registry.ts packages/core/src/session/tool-discovery.ts packages/core/test/session-tool-discovery.test.ts packages/core/test/tool-search-deferred.test.ts packages/core/test/tool-search-dynamic.test.ts packages/core/test/mcp-runtime.test.ts
  git commit -m "feat(core): complete tool searches durably"
  ```

---

### Task 5: Restore active discoveries in every Session turn

**Files:**
- Modify: `packages/core/src/session/runner/llm.ts`
- Modify: `packages/core/test/session-runner.test.ts`
- Modify: `packages/core/test/tool-search-dynamic.test.ts`

**Interfaces:**
- At each turn boundary, seed `SearchedTools.current` from `SessionToolDiscovery.selections(db, sessionID)`.
- Wire `ToolRegistry.MaterializationContext.executeSearch` to `SessionToolDiscovery.execute`.
- Update the process-local map only after durable completion succeeds, preserving same-drain next-provider-turn behavior.

- [ ] **Step 1: Write failing new-drain, hash, and compaction regressions**

  Extend `packages/core/test/session-runner.test.ts` with:

  1. a first drain that completes `tool_search`, followed by a separate user prompt/resume whose first provider request already advertises the discovered deferred tool;
  2. a compaction boundary between discovery and the next prompt that still restores the tool;
  3. a same-key replacement after discovery that is not advertised until searched again;
  4. a permission or prompt override that hides a previously discovered tool;
  5. a failed durable completion that never advertises the selection on the next provider turn.

  Assert the first provider request before discovery contains `tool_search` but not the deferred tool, and the first request of the new drain contains the still-valid discovered tool.

- [ ] **Step 2: Run the runner tests and confirm failure**

  From `packages/core`:

  ```powershell
  bun test test/session-runner.test.ts
  ```

  Expected: FAIL because each new turn currently starts with `new Map()`.

- [ ] **Step 3: Hydrate the per-turn selected map**

  Change `SearchedTools.select` to an Effect-free local merge helper used only after persistence succeeds. Initialize `current` with:

  ```ts
  current: yield* SessionToolDiscovery.selections(db, input.sessionID)
  ```

  Do this once per logical turn, not once per provider retry. Do not cache it process-globally.

- [ ] **Step 4: Wire the durable search executor**

  Pass `executeSearch` into `tools.materialize`. The callback calls `SessionToolDiscovery.execute`, then uses `Effect.tap` to merge returned match key/hash pairs into `searchedTools.current`. This ordering guarantees that an interrupted/failed event commit cannot unlock a tool in memory.

- [ ] **Step 5: Preserve Tool Registry revalidation**

  Keep the existing exact comparison:

  ```ts
  context.selected.get(searchable.key) === searchable.definitionHash
  ```

  Do not pre-filter selections in the database layer. Current materialization remains responsible for Location, model visibility, permissions, source readiness, exposure, and definition-hash checks.

- [ ] **Step 6: Run focused and full Core verification**

  From `packages/core`:

  ```powershell
  bun test test/session-runner.test.ts test/tool-search-dynamic.test.ts test/session-tool-discovery.test.ts
  bun test
  bun typecheck
  ```

  Expected: all commands exit 0.

- [ ] **Step 7: Commit runner restoration**

  ```powershell
  git add packages/core/src/session/runner/llm.ts packages/core/test/session-runner.test.ts packages/core/test/tool-search-dynamic.test.ts
  git commit -m "feat(core): restore discovered tools across drains"
  ```

---

### Task 6: Regenerate the public V2 clients and prove consumers tolerate the event

**Files:**
- Generate: `packages/client/src/generated/**`
- Generate: `packages/client/src/generated-effect/**`
- Modify only if typechecking requires an explicit no-op: `packages/app/src/context/server-session-v2-reducer.ts`
- Modify only if typechecking requires an explicit no-op: `packages/tui/src/context/data.tsx`
- Modify only if typechecking requires an explicit no-op: `packages/opencode/src/event-v2-bridge.ts`
- Test: `packages/app/src/context/server-session-v2-reducer.test.ts`
- Test: `packages/tui/test/cli/tui/data.test.tsx`
- Test: `packages/opencode/test/server/httpapi-event.test.ts`

**Interfaces:**
- The existing Session history and SSE APIs return `SessionEvent.Durable`; therefore the new durable event is part of their generated union.
- UI/TUI compatibility reducers ignore the discovery event because it has no transcript representation.

- [ ] **Step 1: Regenerate clients from the Protocol**

  From `packages/client`:

  ```powershell
  bun run generate
  ```

  Do not edit `src/generated` or `src/generated-effect` manually.

- [ ] **Step 2: Inspect generated changes**

  Confirm both Promise and Effect Session history/event unions contain `session.next.tool-discovery.completed` with minimal match identity only. Confirm no unrelated endpoint or method changed.

- [ ] **Step 3: Add explicit consumer no-ops only where exhaustive typing requires them**

  App, TUI, and V1 bridge consumers must neither render the event as a new message nor request hydration. Add narrow cases/tests only when their exhaustive reducer contracts require it; do not bridge discovery back into V1 state.

- [ ] **Step 4: Run generated-client and consumer verification**

  From `packages/client`:

  ```powershell
  bun run check:generated
  bun test
  bun typecheck
  ```

  From `packages/app`:

  ```powershell
  bun test src/context/server-session-v2-reducer.test.ts
  bun typecheck
  ```

  From `packages/tui`:

  ```powershell
  bun test test/cli/tui/data.test.tsx
  bun typecheck
  ```

  From `packages/opencode`:

  ```powershell
  bun test test/server/httpapi-event.test.ts
  bun typecheck
  ```

  Expected: all commands exit 0.

- [ ] **Step 5: Commit generated contracts and compatibility handling**

  ```powershell
  git add packages/client/src/generated packages/client/src/generated-effect packages/app/src/context/server-session-v2-reducer.ts packages/app/src/context/server-session-v2-reducer.test.ts packages/tui/src/context/data.tsx packages/tui/test/cli/tui/data.test.tsx packages/opencode/src/event-v2-bridge.ts packages/opencode/test/server/httpapi-event.test.ts
  git commit -m "chore(client): generate tool discovery event types"
  ```

  Stage only files that actually changed.

---

### Task 7: Close the durable tranche with fresh evidence

**Files:**
- Modify: `docs/superpowers/specs/2026-08-11-provider-native-tool-search-design.md`
- Modify: `docs/superpowers/plans/2026-08-15-durable-tool-discovery.md`

- [ ] **Step 1: Run affected package suites and typechecks**

  Run package-locally:

  ```powershell
  # packages/schema
  bun test
  bun typecheck

  # packages/core
  bun test
  bun typecheck

  # packages/client
  bun run check:generated
  bun test
  bun typecheck

  # packages/protocol
  bun typecheck

  # packages/server
  bun typecheck

  # packages/app
  bun typecheck

  # packages/tui
  bun typecheck

  # packages/opencode
  bun typecheck
  ```

  Record exact pass/fail totals from fresh command output. Do not claim process-restart/compaction behavior unless the corresponding regression executed.

- [ ] **Step 2: Audit durability and security invariants**

  Confirm from code and tests:

  - no discovery projection stores full input/output schemas;
  - the event and both projection rows commit atomically;
  - exact retry does not execute search or publish twice;
  - mismatched retry conflicts and stale hashes fail closed;
  - empty results do not unlock tools;
  - new drains and compaction restore valid selection identity;
  - current Tool Registry visibility, permissions, source state, and definition hash still gate advertisement and settlement;
  - `docs/superpowers/handoffs/` remains untouched and untracked.

- [ ] **Step 3: Update design status and plan checkboxes**

  Mark durable discovery plus generic cross-drain fallback complete in the design. Keep provider-native OpenAI Responses, Anthropic, and capability negotiation explicitly incomplete. Update this plan's checkboxes and add the measured verification evidence.

- [ ] **Step 4: Run final repository checks**

  From the repository root:

  ```powershell
  git diff --check
  git status --short --branch
  git log --oneline --decorate -12
  ```

  Inspect every changed path and ensure the protected untracked handoff directory is not staged.

- [ ] **Step 5: Commit the durable tranche report**

  ```powershell
  git add docs/superpowers/specs/2026-08-11-provider-native-tool-search-design.md docs/superpowers/plans/2026-08-15-durable-tool-discovery.md
  git commit -m "docs: record durable tool discovery verification"
  ```

  Do not push the new implementation commits until the user asks for another push.
