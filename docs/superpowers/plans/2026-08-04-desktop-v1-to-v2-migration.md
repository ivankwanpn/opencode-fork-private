# Desktop V1 to V2 Migration Plan

> Status: in progress for branch `999.0.9`.
>
> The first `999.0.9` slice hardens the Desktop connection boundary. It does not remove legacy routes or compatibility code by itself.

## Goal

Make the Desktop application use the same V2 session execution path as TUI and CLI for normal operation, while keeping a deliberate and testable V1 fallback for older external servers during the compatibility window.

The target is not a second Desktop-specific agent loop. Desktop should submit durable V2 session inputs, consume V2 events, and rely on the shared Core `SessionExecution`, `SessionRunner`, task submission, permission, question, MCP, PTY, and compaction services.

## Current Runtime Inventory

The current source does not support the claim that Desktop is entirely V1. It already has a V2 path, but the path is selected dynamically and legacy code remains in the same server and client surface.

| Area | Current behavior | Migration implication |
| --- | --- | --- |
| Desktop sidecar | `packages/desktop/electron.vite.config.ts` bundles `packages/opencode/dist/node.js` as `virtual:opencode-server`. | Verify the bundled server starts with the same V2 service graph as the development server. |
| Server routes | `packages/opencode/src/server/routes/instance/httpapi/server.ts` composes typed V2 `serverRoutes` together with legacy root and instance routes. | Keep route coexistence until every Desktop workflow has a V2 contract and compatibility tests. |
| Protocol detection | `packages/app/src/utils/server-protocol.ts` probes `/api/health`, then `/global/health`; a healthy modern response with a numeric PID is classified as V2. Desktop sidecars additionally require `/api/capability`. | Keep external-server fallback, but fail closed instead of silently treating a bundled sidecar as V1 when its V2 contract is incomplete. |
| API selection | `packages/app/src/context/server-sdk.tsx` subscribes to V2 events for V2 servers and legacy events for V1 servers. | Move the normal Desktop connection to an explicit V2 client; retain fallback only at the connection boundary. |
| Compatibility API | `packages/app/src/utils/server-compat.ts` selects the current V2 API or maps operations to legacy APIs. V1 prompt uses `session.promptAsync`; V2 prompt and shell are adapted at the current API boundary. | Inventory every legacy branch before deleting it; do not infer migration completion from prompt alone. |
| Session prompt | `packages/server/src/handlers/session.ts` handles `session.prompt` through `SessionV2.Service`. | Add end-to-end Desktop tests that prove prompt admission reaches V2 `SessionExecution`. |
| Native server | `createNativeRoutes()` exposes the V2 `serverRoutes` used by native clients. | Prefer this contract for Desktop-owned sidecars and TUI/CLI parity. |

## Design Principles

1. V2 is the default for the Desktop-owned sidecar and modern server responses.
2. V1 fallback is selected by an explicit protocol result, not by a failed V2 request after a partial mutation.
3. Durable admission happens before provider execution. A reconnect or renderer restart must be able to recover from SQLite state.
4. V2 event streams are the source for live session state. The UI must not reconstruct state by polling legacy endpoints.
5. The migration must preserve existing user data and provide a rollback path at the server/client boundary.
6. Desktop and TUI must share Core behavior. Any Desktop-only workaround requires a documented protocol or platform reason.

## Phase 0: Baseline and Contract Tests

Before changing the client selection logic, record the current behavior for a packaged Desktop sidecar and a development server.

### 999.0.9 progress

- [x] V2 prompt forwards `delivery`, `resume`, and `expectedActiveAttemptID` without dropping them.
- [x] V2 shell converts the Desktop model shape (`modelID`) into the V2 model reference (`id`).
- [x] Sidecar protocol selection fails closed unless V2 health and capability contracts are present.
- [x] Desktop health probing preserves the `/global/health` fallback for external V1 connections and validates both V2 sidecar responses.
- [x] Protocol authentication and V1/V2 prompt/shell compatibility regressions are covered by app tests.
- [x] Reconnect recovery refreshes active sessions, reconciles stale busy state, and force-syncs affected session projections when a valid snapshot is available.
- [x] Packaged `resources/app.asar` sidecar smoke test passes against the bundled sidecar.
- [x] Packaged reconnect/restore integration, permissions, questions, MCP, plugin catalog, and PTY lifecycle have V2 smoke coverage.
- [x] Packaged provider-backed prompt execution and compaction lifecycle have smoke coverage through a local OpenAI-compatible fake provider.
- [x] Packaged plugin install and marketplace mutation have smoke coverage through a local Claude marketplace fixture.

### Tests to add

- Protocol detection:
  - V2 `/api/health` with `{ healthy: true, pid: number }` returns `v2`.
  - V1 `/global/health` returns `v1` when the V2 probe is absent or invalid.
  - A healthy but incomplete `/api/health` response follows the documented compatibility rule.
  - Auth headers are sent to both probes.
- API selection:
  - V2 selects the generated current API and V2 event subscription.
  - V1 selects the legacy adapter and legacy event stream.
  - A protocol decision is cached for one connection generation and is re-evaluated after reconnect.
- Sidecar smoke test:
  - Start the packaged server entrypoint.
  - Probe health, capability, OpenAPI, and event subscription.
  - Create a session, submit a prompt, interrupt it, and restore it after reconnect.
- Session lifecycle:
  - A V2 prompt creates one durable `session_input` record before execution.
  - Reusing the same prompt ID is idempotent only for the same session and delivery mode.
  - A V2 task completion wakes the parent through the durable notification outbox.

### Baseline evidence

Record the exact sidecar build commit, channel, version, health response, route set, and database location used by the tests. This is required because Desktop can otherwise appear to use V2 while loading an older `opencode/dist/node.js` artifact.

### 999.0.9 artifact evidence

- `packages/desktop/package.json` and the packaged `app.asar` metadata report version `999.0.9`.
- `bun run package:win` completed with `OPENCODE_CHANNEL=prod` and produced `packages/desktop/dist/win-unpacked/resources/app.asar`.
- Static archive inspection found `out/main/sidecar.js`, `out/renderer/index.html`, one bundled server chunk, `/api/health`, `/api/capability`, and `backgroundSubagents` in the archive.
- The live packaged smoke report at `C:\Users\inkik\AppData\Local\Temp\opencode-packaged-sidecar-smoke.json` confirms the actual `app.asar/out/main/sidecar.js` selected V2 and passed health, capability, `/doc` OpenAPI, SSE, session admission, provider execution, compaction, permission, question, MCP, plugin catalog, PTY, interrupt, and reconnect checks.
- The smoke test keeps a separate `resume: false` prompt for durable-admission/reconnect coverage and uses a second `resume: true` session with `test/test-model` to verify provider execution, `session.next.compaction.started`, `session.next.compaction.delta`, `session.next.compaction.ended`, and inactive state after reconnect.

## Phase 1: Make the Desktop-Owned Connection V2-First

### Connection boundary

1. Keep `detectServerProtocol` for connections to external servers.
2. Mark the bundled Desktop sidecar as V2-capable after the sidecar smoke test passes.
3. Expose the selected protocol and server generation in diagnostics so a support bundle can show whether the renderer is attached to V1 or V2.
4. Make V2 selection fail closed for the Desktop-owned sidecar if the required V2 health/capability contract is absent. Do not silently send a partial prompt to a legacy endpoint.
5. Keep the V1 adapter available for explicitly connected old external servers.

### API boundary

Refactor `createExternalCompatibleApi` so its responsibility is limited to protocol adaptation. The normal Desktop path should consume a V2-shaped API directly. The adapter should not hide protocol differences from session execution code.

Required invariants:

- `session.prompt` on V2 calls the V2 `session.prompt` endpoint exactly once.
- `session.prompt` on V1 is the only path that calls `promptAsync`.
- V2 `delivery`, `resume`, `expectedActiveAttemptID`, and durable prompt IDs are never dropped by a compatibility conversion.
- V1-only fields such as legacy parts are not sent to V2 unless they have an explicit V2 representation.

## Phase 2: Migrate Desktop Session Workflows

Migrate one workflow at a time. Each workflow must have a V2 path, an integration test, and a user-visible rollback decision before the next workflow is changed.

### Prompt and continuation

- Use V2 `session.prompt` for normal prompts, steers, queued input, resume, and retry.
- Preserve the V2 admission-before-wake contract. The renderer must not treat a network response as proof that provider execution has completed.
- Consume V2 session status and durable events for busy, idle, error, compaction, and task completion state.
- Ensure reconnect replays durable events or reloads the projected session history before displaying the session as idle.

### Session creation, restore, rename, archive, and removal

- Use V2 session identity and location fields for creation and restore.
- Validate that a restored session's project, directory, parent relationship, and projected history are internally consistent.
- Keep deletion and archive operations serialized with active session execution. A failed removal must not leave the renderer with a stale selected session or a dead server tab.
- Add regression coverage for the existing project-close and stale-read behavior before removing any legacy fallback.

### Permissions and questions

- Use V2 permission and question APIs and V2 events for request, reply, reject, and cancellation.
- Verify that a reconnect does not duplicate a pending request or lose a response.
- Keep the request ownership tied to the session and location, not to a renderer component instance.

### MCP, plugins, marketplaces, and PTY

- Route Desktop-owned MCP status/connect/disconnect, plugin and marketplace operations, and PTY lifecycle through the V2 server contract.
- Preserve explicit location/workspace identity when the operation is sent to a sidecar or WSL server.
- Add one packaged-sidecar test per operation family. A route being present in the OpenAPI document is not sufficient; test authentication, event delivery, and failure recovery.
- Keep V1 adapters for external old servers until the compatibility exit criteria are met.

### Compaction and context state

- Use the V2 compaction lifecycle and durable session events.
- Verify that compaction start, completion, interruption, and failure cannot leave the Desktop stuck in a busy state after reconnect.
- Keep the V2 context epoch and projected history as the source for context-size display. Do not infer context state from legacy message counts.

## Phase 3: Remove Hidden V1 Execution Dependencies

After Phase 2 is green, audit the remaining V1 surfaces instead of deleting them by search-and-replace.

### Removal checklist

- `packages/app/src/utils/server-compat.ts`: list every remaining V1 method and its caller. Each must be either removed from the normal Desktop path or explicitly documented as external-server fallback. The `createExternalCompatibleApi` factory is reserved for that boundary; bundled sidecars use `createV2OnlyApi`.
- `packages/app/src/context/server-sdk.tsx`: retain one protocol-specific event implementation. Confirm V2 event adaptation does not pass legacy payloads through the V2 branch.
- `packages/opencode/src/server/routes/instance/httpapi/server.ts`: identify routes needed only by old clients. Keep them until external compatibility is intentionally ended.
- Legacy `packages/opencode` task and prompt handlers: do not remove until V1 clients, installed versions, and migration data are covered by the release policy.
- Any V1 session projection used during restore: add a data migration or read-only adapter first; never reinterpret old rows in memory without a validation test.

### 999.0.9 Phase 3 audit progress

- [x] Renamed the compatibility factory to `createExternalCompatibleApi` so its external-server boundary is explicit.
- [x] Confirmed bundled sidecars construct `createV2OnlyApi` in both global and directory-scoped SDK contexts.
- [x] Renamed the retained generated client to `legacyClient`/`createLegacyClient`; V1 PTY, history, bootstrap, and catalog fallbacks now declare their boundary at the call site.
- [x] Removed an unused directory-sync legacy client allocation; V2 directory sync does not construct a compatibility client merely by opening a directory.
- [x] Recorded the V1 adapter methods, event branch, and non-adapter fallbacks in `docs/superpowers/plans/2026-08-05-v1-compatibility-inventory.md`.
- [ ] Satisfy the removal gate and delete V1 code from the normal Desktop path.

### Removal gate

V1 code may be removed from the Desktop normal path only when:

- packaged Desktop, dev Desktop, TUI, and CLI all pass the same V2 session lifecycle suite;
- no Desktop normal-path call reaches `promptAsync`, legacy event subscription, or a legacy session mutation;
- old external-server behavior is covered by an explicit V1 compatibility suite;
- stored sessions from the previous release restore successfully;
- rollback can switch the Desktop connection boundary back to the prior protocol selector without data loss.

## Phase 4: Rollout and Rollback

Use a small feature boundary instead of a broad flag scattered through UI components.

### 999.0.9 progress

- [x] Protocol diagnostics now expose the server type, explicit compatibility boundary, selected protocol, protocol/event generations, reconnect count, server version, sidecar PID, and capability result.
- [x] Add the last durable aggregate and sequence to support diagnostics without logging prompt contents.
- [x] Add and exercise the single connection-boundary protocol override. `VITE_OPENCODE_DESKTOP_SERVER_PROTOCOL=auto|v1|v2` applies only to external server SDK creation; bundled sidecars remain V2-only.
- [x] Unit-test the sidecar invariant: a global `v1` override cannot downgrade a bundled sidecar.
- [x] Verify renderer build-time injection in both `v1` override and default `auto` builds; the bundle contains the selected value and no unresolved environment lookup.

### Recommended controls

- `desktopServerProtocol`: `v2` for the bundled sidecar, `auto` for external servers, and `v1` only for emergency compatibility testing. The current build-time input is `VITE_OPENCODE_DESKTOP_SERVER_PROTOCOL`.
- Diagnostic logging: selected protocol, server build/version, sidecar PID, health result, event stream generation, and last durable session sequence. Do not log prompt contents or credentials.
- A single kill switch at connection creation that can force the legacy adapter for external servers. The switch must not change the durable database schema or delete session data.

### Rollback behavior

- If V2 health or event subscription fails before prompt admission, show a connection failure and permit a retry or explicit V1 external-server connection.
- If a V2 prompt is admitted, do not retry it automatically through V1. Reusing the prompt ID against another protocol could create a duplicate or conflicting execution.
- If the renderer disconnects after admission, reconnect to the same V2 session and reload durable state.
- If a server-side V2 defect is found, roll back the server/client build as a pair or disable new connections; do not downgrade an already-admitted prompt by replaying it through V1.

## Verification Matrix

Run these from the package directories, not the repository root:

```powershell
# app and desktop unit/type checks
bun typecheck
bun test --timeout 60000

# core behavior shared by Desktop and TUI
cd packages/core
bun typecheck
bun test --timeout 60000 test/session-task-notification.test.ts test/session-execution-recovery.test.ts test/session-subagent-loop.test.ts

# server and protocol contract
cd ../opencode
bun typecheck
bun run script/httpapi-exercise.ts --mode effect --fail-on-missing --fail-on-skip

# packaged Desktop smoke test
cd ../desktop
bun run package:win
bun run test:packaged-sidecar
```

The packaged smoke test must verify the actual `resources/app.asar` sidecar, not only the source development server. Capture the protocol kind and version from diagnostics.

## Acceptance Criteria

- Desktop-owned sidecar selects V2 and uses V2 session prompt, V2 events, and V2 `SessionExecution`.
- TUI, CLI, and Desktop exercise the same Core V2 task completion and notification behavior.
- Independent child completion can wake the parent while another child remains active; no whole-batch completion barrier is introduced.
- Startup recovery drains notifications created during recovery before safe startup dispatch begins.
- Session restore, project close, delete, compaction, permission, question, MCP, plugin, marketplace, and PTY workflows have V2 integration coverage.
- V1 fallback is explicit, bounded, observable, and covered by tests for old external servers.
- No data migration or protocol downgrade can duplicate an admitted prompt.
- The migration can be rolled back at the connection boundary without removing durable V2 data.

## Non-Goals

- Do not delete all V1 HTTP routes in this migration.
- Do not replace EventV2/SQLite with an in-memory mailbox or WebSocket-only execution protocol.
- Do not remove the provider-turn tool settlement rule.
- Do not make the legacy V1 task tool async-by-default.
- Do not change public Protocol or Server `HttpApi` schemas without generating clients and adding a compatibility decision.
- Do not modify user session data as part of a Desktop UI migration.

## Suggested Execution Order

1. Land Phase 0 tests and collect packaged-sidecar evidence.
2. Finish the `999.0.7` Core notification lifecycle fix and verify Desktop/TUI shared behavior.
3. Migrate protocol selection and prompt/events at the Desktop connection boundary.
4. Migrate session lifecycle and interactive request families.
5. Migrate compaction and restore verification.
6. Run the removal checklist and decide which legacy routes remain for external clients.
7. Only then remove unused V1 code in separate, reversible commits.
