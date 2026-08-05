# Desktop V1 Compatibility Inventory

Status: audit for branch `999.0.9`.

This document records the remaining V1 paths after the Desktop V2-first migration. It is an inventory, not a decision to remove legacy routes. V1 remains supported only for explicitly connected external servers until the migration removal gate is satisfied.

## Construction Boundary

Production code has two API construction sites in `packages/app/src/context/server-sdk.tsx`:

- `createServerSdkContextBase`: a bundled Desktop sidecar uses `createV2OnlyApi`; an external HTTP or SSH-backed server uses `createExternalCompatibleApi`.
- `createDirSdkContext`: follows the same sidecar versus external-server split for directory-scoped APIs.
- The generated SDK retained for old-server calls is exposed as `legacyClient`/`createLegacyClient`; normal V2 code resolves `apiForGeneration()` instead of using an ambiguously named `client`.

The old generic `createCompatibleApi` name was removed so a new caller has to state that it is constructing the external compatibility boundary. `createV2OnlyApi` rejects a V1 generation before invoking the current API.

## Event Boundary

`createServerSdkContextBase` selects one event implementation per connection generation:

- V2: the generated `eventApi.event.subscribe` stream, then `adaptServerEvent`.
- V1: the legacy `eventSdk.global.event` stream, then the legacy payload adapter.

The V1 event branch is selected only after `detectServerProtocol` returns `v1`. A sidecar protocol probe is V2-only and fails closed when its health or capability contract is missing.

## V1 Adapter Methods

All methods below are implemented inside `createV1Api` in `packages/app/src/utils/server-compat.ts`. They are reachable only when an external compatibility API resolves the current connection generation as `v1`.

### Explicitly Unsupported On V1

- `message.list`: V2 message history.
- `plugins.list`, `add`, `refresh`, `remove`, `install`, `uninstall`, `enable`, `disable`: plugin management.
- `session.switchAgent`, `switchModel`: session agent/model switching.
- `session.inputList`, `inputGet`, `inputPromote`, `inputCancel`: durable follow-up inputs.
- `session.background`, `wait`, `context`, `revert.commit`: V2 execution, context, and revert operations.

### Session And Project Operations

- `session.list`, `create`, `get`, `active`, `todo`, `rename`, `archive`, `remove`, `share`, `unshare`, `fork`, `interrupt`, `prompt`, `command`, `shell`, `compact`.
- `session.revert.stage`, `session.revert.clear`.
- `project.list`, `current`, `initGit`, `update`, `directories`.
- `worktree.create`, `remove`, `reset`.

### Workspace And Source Operations

- `location.dispose`.
- `path.get`.
- `lsp.status`.
- `vcs.get`, `status`, `diff`.
- `file.read`, `list`, `find`.
- `config.get`, `update`.

### MCP, Authentication, And Interactive Requests

- `mcp.list`, `connect`, `disconnect`, `authenticate`, `resource.catalog`.
- `integration.get`, `integration.connect.key`.
- `integration.oauth.connect`, `complete`, `status`, `cancel`.
- `credential.remove`.
- `pty.shells`, `list`, `create`, `get`, `update`, `remove`, `connectToken`.
- `permission.request.list`, `permission.reply`.
- `question.request.list`, `question.reply`, `question.reject`.

The V1 implementations translate these operations to the legacy SDK endpoints. V2-only fields are either converted explicitly or rejected; they are not sent to the legacy prompt endpoint by accident.

## Non-Adapter V1 Fallbacks

These paths are intentionally outside `createV1Api` and must remain explicit:

- `packages/app/src/context/global-sync/session-load.ts`: `loadRootSessionsV1` retries the root session list without `limit` for older servers that reject the limited request.
- `packages/app/src/context/server-session.ts`: V1 message history and single-message hydration use `client.session.messages` and `client.session.message` only when the selected generation is V1. V2 uses the projected message API.
- `packages/app/src/context/server-session.ts`: the legacy todo fallback is used only when no selected V2 API is available and the resolved protocol is V1.
- `packages/app/src/components/terminal.tsx`: V1 PTY existence checks and connect-token requests use the legacy client and preserve the old 404/405 behavior. V2 uses the generation-pinned PTY API.
- `packages/app/src/context/global-sync/bootstrap.ts`: legacy command, reference, provider, and related catalog reads are selected only for an explicitly detected V1 generation.

## Residual Risk

`createV1Api` starts from `input.current` and overrides the known V1 translations. This preserves shared operations that still have compatible legacy behavior, but it means a newly added `ServerApi` method must be reviewed before it can be considered V1-safe. The safe rule for future changes is:

1. Add an explicit V1 translation or `unsupportedV1` override.
2. Add a V1 and V2 test proving the selected endpoint.
3. Keep the method out of the Desktop sidecar's V1-capable construction path.

No V1 code should be removed until packaged Desktop, development Desktop, TUI, and CLI pass the shared V2 lifecycle suite, old external-server behavior has an explicit compatibility suite, stored sessions restore successfully, and the connection-boundary rollback test passes.
