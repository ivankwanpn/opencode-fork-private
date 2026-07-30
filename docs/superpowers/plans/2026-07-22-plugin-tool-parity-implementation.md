# Plugin and Config Tool Parity Implementation Plan

> Execute implementation tasks in order. Per the project owner's direction, do not run tests or typecheck between tasks; all verification is deferred to the final Phase 8 verification gate.

**Goal:** Make config-file and legacy plugin tool contributions available to native V2 sessions without making Core depend on V1 or the plugin host.

**Architecture:** Extract host-owned discovery/schema compilation shared by V1 and V2, construct canonical Core tools in an OpenCode Location-scoped compatibility service, and initialize registrations during instance bootstrap after plugin initialization.

**Reference design:** `docs/superpowers/specs/2026-07-22-plugin-tool-parity-design.md`

## Constraints

- Keep the current 1.18.3 baseline; do not absorb 1.18.4.
- Do not delete or disable V1.
- Do not publish a new V2 plugin SDK.
- Do not register location-specific tools in `ApplicationTools`.
- Do not run tests or typecheck until the complete Phase 8 verification task.
- Do not mark the parity row complete before the Phase 8 verification gate passes.

### Task 1: Extract shared discovery and schema compilation

**Files:**

- Create: `packages/opencode/src/tool/plugin-compat.ts`
- Modify: `packages/opencode/src/tool/registry.ts`

- [x] Move plugin-tool identification, missing-args normalization, Zod JSON Schema conversion, legacy schema conversion, naming, config-directory scanning, and plugin-hook collection behind a host-owned compatibility module.
- [x] Return ordered compiled contributions with the original execute callback, decoder information, and wire JSON Schema.
- [x] Preserve config tools before plugin-hook tools and deterministic later-wins behavior.
- [x] Refactor the V1 registry to consume this shared representation without changing its public interface or execution behavior.

### Task 2: Support exact attachment URI projection in canonical tools

**Files:**

- Modify: `packages/core/src/tool/tool.ts`

- [x] Extend the canonical model-output file content input to accept either base64 data or an already-formed URI.
- [x] Keep existing built-in `data` callers source-compatible.
- [x] Project URI attachments directly to `LLM.ToolFileContent` without a plugin-specific settlement path.

### Task 3: Add the Location-scoped V2 compatibility registration service

**Files:**

- Create: `packages/opencode/src/tool/plugin-compat-v2.ts`
- Modify as required: `packages/opencode/src/effect/app-runtime.ts`

- [x] Add an `init()` service backed by `InstanceState`.
- [x] Resolve the active Location layer through `LocationServiceMap` with directory and workspace identity.
- [x] Build canonical `Tool.make(...)` values from shared compiled contributions.
- [x] Register the final later-wins record through Location-scoped `Tools.Service`.
- [x] Capture Permission V2, ToolProgress, Location, and Effect/Promise bridge services while constructing tools.
- [x] Ensure instance scope disposal unregisters only compatibility registrations.

### Task 4: Bridge invocation context and result semantics

**Files:**

- Modify: `packages/opencode/src/tool/plugin-compat-v2.ts`

- [x] Map Session, assistant message, call, agent, directory, and worktree context fields.
- [x] Supply an interruptible AbortSignal to plugin execution.
- [x] Map plugin permission requests to `PermissionV2.Service.assert(...)` with canonical source metadata.
- [x] Map plugin metadata calls to native `ToolProgress` events.
- [x] Convert ordinary plugin exceptions and invalid results to `ToolFailure` while preserving permission/interruption causes.
- [x] Project string and structured results, title, metadata, textual output, and URI attachments.
- [x] Leave generic output bounding exclusively to Core settlement.

### Task 5: Initialize compatibility registration during project bootstrap

**Files:**

- Modify: `packages/opencode/src/project/bootstrap.ts`
- Modify as required: `packages/opencode/src/effect/bootstrap-runtime.ts`

- [x] Add the compatibility service dependency.
- [x] Invoke compatibility initialization immediately after `Plugin.init()` and before other project services initialize.
- [x] Preserve existing bootstrap ordering and failure behavior.

### Task 6: Author deferred verification coverage

**Files:**

- Create: `packages/opencode/test/tool/plugin-compat-v2.test.ts`
- Modify only if required: existing Core tool tests and OpenCode test fixtures

- [ ] Add coverage for config and plugin discovery, schemas, missing args, naming, precedence, context mapping, permission, interruption, progress, result projection, attachments, cleanup, stale identity, and single hook execution.
- [ ] Do not execute these tests during implementation.

### Task 7: Static implementation audit

- [x] Re-read all changed files for dependency direction, scoped cleanup, duplicate hook execution, unsafe casts, and silent data loss.
- [x] Confirm no generated files were edited.
- [x] Confirm no test or typecheck command was run.
- [x] Leave the parity table `partial` until the Phase 8 verification gate.

### Task 8: Phase 8 verification gate

- [ ] Run only after every remaining Phase 8 implementation slice is complete.
- [ ] Run package typechecks and focused/full test suites from their package directories.
- [ ] Run build verification, including CLI/TUI worker packaging.
- [ ] Execute the planned manual local, attach, run, TUI, server, app, ACP, and daemon flows.
- [ ] Resolve failures and repeat the gate until clean.
- [ ] Only then update parity tables, remove authorized V1 modules, and claim Phase 8 complete.
