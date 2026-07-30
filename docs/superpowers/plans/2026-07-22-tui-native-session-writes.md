# TUI Native Session Writes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Verification runs only at the complete Phase 8 gate.

**Goal:** Move lossless TUI Session creation, command, and shell writes to the generated V2 client.

**Architecture:** Extend native shell admission with optional agent/model selection so it preserves the legacy wrapper's observable Session selection. Create Sessions and submit ordinary commands/shells directly through `sdk.native.sessions`; retain the legacy command route only for attachment shapes that the canonical schema cannot preserve exactly.

## Constraints

- Keep caller-ID and file/symbol-source command attachments on the compatibility route.
- Do not silently drop attachment source data.
- Keep existing TUI error and progress behavior.
- Generate clients; do not hand-edit generated output.
- Do not run tests/typecheck/build before the Phase 8 gate.

### Task 1: Preserve shell selection semantics

- [x] Add optional agent/model fields to Core V2 shell input and switch them before execution.
- [x] Add those fields to Protocol/Server shell delegation.
- [x] Regenerate and inspect Promise/Effect clients.

### Task 2: Switch lossless TUI writes

- [x] Create new Sessions through `sdk.native.sessions.create`.
- [x] Send shell commands through `sdk.native.sessions.shell` with current agent/model.
- [x] Send lossless configured commands through `sdk.native.sessions.command`.
- [x] Keep a clearly named compatibility predicate and legacy fallback for noncanonical attachment identity/source fields.

### Task 3: Deferred verification

- [ ] At the Phase 8 gate, cover native create/command/shell, selection updates, safe attachment projection, legacy fallback selection, errors, typecheck, and build.
