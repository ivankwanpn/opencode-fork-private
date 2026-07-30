# TUI Native Session List Implementation Plan

> Verification is intentionally deferred until the Phase 8 gate, per the agreed phase-level testing workflow.

## Goal

Move TUI session list reads to the native V2 API without silently changing the existing project, subpath, workspace, search, or display behavior.

## Tasks

- [x] Add a single transitional adapter from native `SessionV2.Info` to the legacy TUI session-list shape.
- [x] Translate legacy list filters into native `project`, `subpath`, and `workspace` query fields.
- [x] Switch the session picker browse/search reads to `sdk.native.sessions.list`.
- [x] Switch the central sync session list bootstrap/refresh read to `sdk.native.sessions.list`.
- [ ] Remove the adapter after the central TUI session store uses native types.
- [ ] Run focused tests and typecheck at the final Phase 8 verification gate.
