# Native Revert Consumer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Verification runs only at the complete Phase 8 gate.

**Goal:** Make native revert safe for direct TUI use and for retained compatibility prompt routes.

**Architecture:** A staged revert stays reversible until the next prompt-like write. Native prompt, command, and shell commit it before admitting new work, which removes canonical messages after the boundary. Revert operations also publish a compatibility Session update so retained stores observe the shared-row change. The hybrid legacy handler commits the canonical boundary before running its existing V1 cleanup.

## Constraints

- Never clear the shared revert marker before canonical history truncation.
- Preserve the V1 cleanup while compatibility transcripts remain.
- Do not duplicate truncation when no canonical boundary exists.
- Do not run tests/typecheck/build before the Phase 8 gate.

### Task 1: Make Core writes revert-aware

- [x] Commit staged canonical reverts before prompt, command, and shell writes.
- [x] Reload the Session after commit before continuing.
- [x] Publish compatibility Session updates after stage/clear/commit.

### Task 2: Protect the hybrid compatibility route

- [x] Detect a canonical boundary and commit it before V1 cleanup.
- [x] Keep legacy-only reverts on the existing cleanup path.

### Task 3: Switch TUI undo/redo

- [x] Use native revert stage for full-message undo.
- [x] Use native revert clear for redo/unrevert.
- [x] Retain legacy part-level revert only where the native contract cannot represent it.

### Task 4: Deferred verification

- [ ] At the Phase 8 gate, cover stage, clear, automatic commit, compatibility cleanup, mixed transcripts, TUI undo/redo, typecheck, and build.
