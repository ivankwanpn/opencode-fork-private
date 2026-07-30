# Native Command and Shell API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Verification runs only at the complete Phase 8 gate.

**Goal:** Expose the already-implemented Core V2 command and shell operations through the native Protocol, Server, and generated Client.

**Architecture:** Add two Session endpoints without introducing another execution path. Server delegates directly to `SessionV2.Service.command` and `.shell`, maps existing typed errors to Protocol errors, and retains Core's durable command admission and serialized synchronous shell semantics.

**Tech Stack:** Effect HttpApi Protocol, Server handlers, Core Session service, generated Promise/Effect clients.

## Constraints

- Do not bridge through `SessionPrompt.command` or `SessionPrompt.shell`.
- Keep command admission durable and return `SessionInput.Admitted`.
- Keep shell execution synchronous and return NoContent.
- Run client generation after the API source changes; do not hand-edit generated files.
- Do not run tests/typecheck/build before the Phase 8 gate.

### Task 1: Define native endpoints

- Modify: `packages/protocol/src/groups/session.ts`

- [x] Add `session.command` with optional message ID, agent/model/files/delivery/resume/commit fields.
- [x] Add `session.shell` with optional event and user-message IDs, command, and resume fields.
- [x] Declare conflict/not-found/invalid-request and busy/service-unavailable errors precisely.

### Task 2: Implement Server delegation

- Modify: `packages/server/src/handlers/session.ts`

- [x] Delegate command to `SessionV2.command`, mapping prompt conflicts and expansion errors.
- [x] Delegate shell to `SessionV2.shell`, mapping missing/busy errors and returning NoContent.

### Task 3: Regenerate clients

- Generate from: `packages/client`

- [x] Run `bun run generate` after implementation and inspect generated command/shell methods without manual edits.

### Task 4: Deferred verification

- Modify at Phase 8 gate: Server, Client, and OpenCode HttpApi tests.
- [ ] Verify command admission, expansion failure, shell completion, interruption, busy handling, and generated Promise/Effect client calls.
