# V2 Session Consumer Hard Cut Design

## Status

- Branch: `999.0.17`
- Date: 2026-08-13
- Prerequisite: V2-only transcript storage hard cut is complete
- Scope: remove production runtime dependence on `packages/opencode/src/session/session.ts` (`Session.Service`)

## Context

The model execution path and transcript storage are already canonical V2. `SessionV2.Service` owns durable prompt
admission, execution coordination, canonical transcript access, and the core Session CRUD operations. The remaining
legacy `Session.Service` does not own a second transcript anymore, but it is still consumed by HTTP session CRUD,
workspace placement, share/stats/CLI utilities, sync/TUI handlers, legacy execution adapters, and legacy tool wrappers.

`Session.Service` and `SessionV2.Service` both read the same `SessionTable`. Keeping both services active therefore no
longer protects user data; it preserves duplicated query/update logic, V1 event projection, and legacy wire shapes.
The migration goal is a hard cut: add missing capabilities to V2, migrate every production consumer, then delete the
legacy service. Retained legacy `message` and `part` data remains intentionally abandoned and is not part of this
design.

## Decisions

### Canonical ownership

`SessionV2.Service` is the only Session domain service after this migration. It owns:

- canonical Session CRUD and hierarchy;
- canonical `Location.Ref` placement (`directory` plus optional `workspaceID`);
- canonical metadata, permission rules, archive state, agent/model selection, and share state;
- recursive deletion and active execution interruption;
- lifecycle event publication and projection into `SessionTable`.

OpenCode-specific services may coordinate product concerns around a canonical operation, but they must not recreate a
second Session repository. Remote share integration and reporting remain OpenCode-owned, while canonical share state,
task-tree settlement, and durable Session deletion remain Core-owned.

### No new V1 fallback

No migrated consumer may call `Session.Service`, query legacy transcript tables, or catch a V2 error and retry through
a V1 path. If V2 lacks required behavior, the V2 interface and its canonical event/projector path are extended first.

Temporary adapters are allowed only at an explicit external protocol boundary and must be pure projections from V2
values. They cannot query storage or own mutable state. Internal HTTP middleware, TUI state, CLI implementation, and
tool execution are not external boundaries and must move to V2 types.

### Legacy user data

There is no migration or adoption of legacy `message` / `part` rows. The generated drop migration remains the sole
retirement behavior for those tables. This Session consumer migration must not recreate the tables, tombstones,
retained transcript merging, or legacy import support.

## Migration Architecture

### Phase 1: Placement lookup

`WorkspaceRoutingMiddleware` currently loads a Session through `Session.Service` only to select the directory and
workspace for a request containing a Session ID. It will instead require process-global `SessionV2.Service`, call
`get(SessionV2.ID.make(sessionID))`, and derive placement from `session.location`.

Missing Session lookup remains advisory for routing: the middleware falls back to request headers/query and the default
directory exactly as it does today. Unexpected database/service defects are no longer swallowed and must fail the
request rather than silently selecting a different directory. An invalid `workspace` query on `/api/*` still produces
the V2 public query error. Remote workspace forwarding and control-plane route behavior do not change.

This phase must remove `Session.Service` from the middleware service requirement and test layers. It changes no HTTP
response schema.

### Phase 2: Canonical callers and read contracts

The repository already has canonical `/api/session` list/get/children/create/update/fork/remove endpoints and generated
Promise/Effect Clients. TUI, the primary App network path, Desktop smoke, and ACP network access already use them. The
remaining first-party legacy `/session` callers are migrated to those native Clients before the legacy route is
removed:

- CLI run list/create/children compatibility paths;
- the legacy JS SDK example and generated Session client;
- the Plugin `PluginInput.client` ABI, which currently exposes `createOpencodeClient()`;
- App legacy-shape normalization and ACP internal legacy-shaped facades after their network paths are already native;
- the GitHub share card's use of `session.version`, which moves to an explicit installation/protocol version source.

The legacy `/session` path is not repurposed to return `SessionV2.Info`. A same-path, different-shape endpoint would
silently break third-party callers while preserving a duplicate API surface. Once its callers are migrated, the route
and legacy generated Session client are deleted.

Required legacy list semantics must first be represented explicitly by the V2 list API where a confirmed caller still
needs them:

- project and directory scoping;
- optional workspace scoping;
- root-only filtering;
- title search;
- created- or updated-time sorting selected explicitly by the caller;
- archived filtering and updated-time bounds for reporting/continue workflows;
- deterministic `(time, id)` keyset ordering and limit;
- path/subpath filtering where an active consumer still requires it.

The V2 API is extended only for query semantics that have a confirmed production consumer. Dead legacy query options
are removed from the public contract instead of being copied forward.

The legacy `Session.Info` response must not remain an internal model. During caller migration, an unavoidable external
ACP/plugin compatibility response may use one named, pure V2-to-legacy projector. The projector may derive `directory`
from `location.directory`, `workspaceID` from `location.workspaceID`, and `path` from `subpath`; it must not query
`SessionTable` to recover V1-only fields.

Fields with no canonical V2 meaning are retired rather than synthesized:

- `slug` and installation `version` are not canonical Session identity;
- legacy summary counters are replaced by canonical assistant patch/diff data at the endpoint that needs them;
- legacy permission rule vocabulary is replaced by `PermissionV2.Ruleset` or a dedicated permission endpoint;
- legacy revert shape is replaced by canonical `Revert.State`;
- `directory` and `path` are represented by `location` and `subpath`.

### Phase 3: Canonical mutations

Create, update, fork, and remove move to `SessionV2.Service` after the required V2 mutation surface is complete.

Core create already accepts canonical location, optional parent, title, agent/model, metadata, and
`PermissionV2.Ruleset`. The native Protocol/Server create schema is extended only where it does not yet expose those
existing Core capabilities. The Location-scoped handler supplies the current location; Core resolves project/subpath
and publishes one durable V2 Created event.

Update becomes one atomic canonical operation. It supports the fields still exposed by the native Session API:

- title;
- archived timestamp, including explicit unarchive;
- metadata replacement and explicit clearing;
- canonical share state replacement and explicit clearing;
- workspace/location changes only through an explicit placement operation, never an incidental partial patch.

Permission is intentionally not added to public `SessionV2.Info`. Core exposes explicit `permissions(sessionID)` and
`setPermissions({ sessionID, permissions })` operations over `PermissionV2.Ruleset`. HTTP/plugin callers merge in V2
vocabulary before one canonical update event is published. The implementation must not convert to V1 rules or publish
a V1 Updated event.

Workspace relocation is not an ordinary Session patch. It uses the canonical move/control-plane contract and
`SessionEvent.Moved`, keeping validation and data movement with `MoveSession` ownership instead of directly changing
`workspace_id`.

Fork reads canonical messages, applies the requested canonical message boundary, creates the target with canonical
Session attributes, and imports canonical messages with fresh IDs. It never projects through `SessionV1.WithParts`.

Remove first settles the owned task tree through `TaskCancellation.Service`, using `SessionExecution.interrupt/wait`
hooks for active local execution. It then recursively removes children, publishes V2 Deleted events, and removes durable
event history according to the existing canonical contract. The legacy `BackgroundJob` registry is not moved into
Core. Missing Session behavior remains a typed not-found error; cleanup failures must not be silently swallowed.

### Phase 4: Product and external consumers

Remaining consumers migrate by ownership domain:

- workspace-routing uses canonical `Location.Ref`; control-plane movement uses the canonical move contract;
- share services update canonical share state and read canonical messages;
- stats/CLI session commands query canonical Session/message data; stats remains a reporting/read-model concern rather
  than a new Session aggregate API;
- TUI remains on its existing native Client Session shape; App removes its residual legacy normalization;
- legacy execution wrappers use `SessionV2.get/messages/update` directly until their external request adapters are
  removed;
- task/code-mode tools consume the canonical Session permission and location context;
- ACP removes its internal legacy facade after preserving the external ACP protocol mapping;
- Plugin input receives the canonical Client as an intentional breaking ABI change; protocol-required compatibility
  keeps only pure projections.

No consumer receives direct `Database.Service` access merely to replace `Session.Service`. Shared query behavior is
added to the canonical Core service or to a clearly owned reporting service.

### Phase 5: Deletion and gates

After the final runtime consumer is migrated:

- delete `packages/opencode/src/session/session.ts`;
- remove its node from application/server/test layer graphs;
- remove V1 Session lifecycle projector branches that no remaining external compatibility boundary consumes;
- remove obsolete V1 Session schemas and generated client contracts in dependency order;
- retain one-time V1 config decoding only until the separate config hard cut is complete.

A source-level isolation test must reject production imports of `@/session/session` and direct `Session.Service`
references outside explicitly allowlisted migration history or test fixtures. The gate supplements behavioral tests; it
does not replace them.

## Error Semantics

Core V2 typed errors remain authoritative. HTTP boundaries map `Session.NotFoundError`, busy/conflict errors, invalid
query schemas, and permission errors to the declared public errors once. Internal consumers preserve the typed error
instead of converting it to the storage package's V1 `NotFoundError`.

Workspace routing treats a missing Session as absence because routing can still be selected by explicit request
placement. CRUD and transcript endpoints treat the same missing Session as a public not-found response. Recursive
delete reports unexpected cleanup defects; it does not return success after logging and swallowing them.

## Compatibility and Breaking Changes

Breaking internal and public changes are accepted when they remove V1 vocabulary. They must nevertheless be staged so
the repository stays usable after every commit:

1. migrate a caller to the native V2 endpoint/client;
2. change or remove the legacy endpoint contract;
3. regenerate generated Clients for public Protocol/HttpApi changes;
4. delete the now-unreferenced adapter/schema.

No long-lived V2-to-V1 Session repository or storage-backed projector will be introduced. External ACP/plugin wire
compatibility may remain temporarily, but it consumes only native V2 clients and pure conversion functions.

Third-party Plugin SDK compatibility cannot be proven by monorepo search. Changing `PluginInput.client` is therefore an
explicit breaking release item with generated types, examples, and plugin contract tests updated in the same batch.

## Test Strategy

Every behavior change follows red-green TDD with real services where practical.

### Placement tests

- a request containing a canonical V2 Session ID routes using `session.location.directory`;
- canonical `location.workspaceID` takes precedence over a conflicting query workspace;
- a missing Session falls back to explicit request placement;
- an unexpected Session lookup defect fails instead of silently routing elsewhere;
- the middleware layer composes without `Session.Service`;
- remote proxy, control-plane-local, invalid-workspace, and WebSocket behavior remains unchanged.

### Read tests

- list applies canonical project/directory/workspace/root/search/sort/archive/time/limit semantics and deterministic
  keyset order;
- get and children return typed not-found errors;
- children ordering is deterministic;
- native response schemas contain canonical `location`, `metadata`, and revert state; permissions are tested through
  the dedicated V2 policy operations;
- legacy-only fields are absent after their consumers migrate.

### Mutation tests

- create projects metadata, permissions, parent, model/agent, and canonical location once;
- update atomically changes metadata/share/title/archive fields and publishes one V2 Updated event;
- permission read/replace uses V2 rules without exposing policy in Session list responses;
- explicit unarchive is distinguishable from an omitted archive field;
- fork uses canonical messages and honors the message boundary;
- remove settles the durable task tree, interrupts/waits for execution, removes descendants, and does not hide cleanup
  failure;
- none of the paths publishes V1 Session lifecycle or message/part events.

### Regression gates

- focused package tests from `packages/core`, `packages/opencode`, `packages/tui`, and affected client packages;
- `bun typecheck` from each affected package;
- `bun run generate` from `packages/client` after public schema changes;
- source isolation tests for legacy Session service/table symbols;
- `git diff --check` and an explicit staged-file audit before every commit.

## Commit Boundaries

The implementation is split into independently reviewable commits:

1. route workspace placement through V2 Session;
2. expose missing canonical create/list/read fields and migrate CLI run callers;
3. extend atomic metadata/share/permission mutations and migrate HTTP/share callers;
4. settle task ownership before deletion and validate canonical fork boundaries;
5. migrate move, stats, App normalization, ACP facade, tools, and legacy execution consumers by domain;
6. change Plugin input to the canonical Client and regenerate its public contract;
7. delete the legacy `/session` route/SDK, `Session.Service`, V1 projector branches, and obsolete schemas;
8. update `V1-to-V2-migration.md` and run the V2-only regression gate.

Each commit must leave production entrypoints type-correct and tested. The untracked provider-native tool-search design
file remains outside this work and every commit.
