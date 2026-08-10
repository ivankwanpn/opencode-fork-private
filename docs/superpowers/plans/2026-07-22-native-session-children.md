# Native Session Children Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Verification runs only at the complete Phase 8 gate.

**Goal:** Expose the shared V1/V2 Session tree through the native Core, Protocol, Server, and generated clients.

**Architecture:** Query the canonical shared `session.parent_id` column in Core V2, require the parent Session to exist, return canonical `Session.Info` children in stable creation order, and delegate the public endpoint directly to that service.

## Constraints

- Do not copy or re-project Session rows.
- Do not depend on the OpenCode V1 Session service.
- Keep ordering deterministic by creation time then Session ID.
- Generate clients; do not hand-edit generated output.
- Do not run tests/typecheck/build before the Phase 8 gate.

### Task 1: Add Core tree read

- [x] Add `SessionV2.children(parentID)` to the service interface.
- [x] Require the parent to exist and query the shared Session table in deterministic order.

### Task 2: Add the native endpoint

- [x] Add `GET /api/session/:sessionID/children` to Protocol.
- [x] Delegate in Server and map a missing parent to `SessionNotFoundError`.

### Task 3: Generate and inspect clients

- [x] Run `bun run generate` from `packages/client` and inspect Promise/Effect methods.

### Task 4: Deferred verification

- [ ] At the Phase 8 gate, cover empty and populated trees, stable ordering, cross-generation rows, missing parents, clients, typecheck, and build.
