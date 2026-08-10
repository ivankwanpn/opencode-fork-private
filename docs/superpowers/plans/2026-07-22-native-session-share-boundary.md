# Native Session Share Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Verification runs only at the complete Phase 8 gate.

**Goal:** Expose host-provided Session share/unshare through the native API without making Core or generic Server depend on OpenCode.

**Architecture:** Add a narrow Server capability with an unavailable default. The hybrid OpenCode server supplies an adapter around its account/config/remote-sync aware SessionShare service. Protocol returns the share URL directly; shared Session-row updates continue through the existing durable compatibility event until remote share storage is migrated separately.

## Constraints

- Keep Server free of OpenCode imports.
- Fail explicitly when a host does not provide sharing.
- Verify Session existence before invoking the host capability.
- Do not hand-edit generated clients.
- Do not run tests/typecheck/build before the Phase 8 gate.

### Task 1: Add Server capability and API

- [x] Add share/unshare capability with an unavailable default layer.
- [x] Add Protocol endpoints and Server handlers with NotFound/Unavailable mapping.
- [x] Provide the default from standalone routes.

### Task 2: Wire OpenCode host and clients

- [x] Adapt OpenCode SessionShare to the Server capability.
- [x] Supply it only to native Server handlers in the hybrid graph.
- [x] Regenerate and inspect Promise/Effect clients.

### Task 3: Switch consumers

- [x] Switch TUI share/unshare to the native endpoint.
- [x] Switch CLI `run --share`/auto-share calls to the native endpoint while retaining legacy config reads.

### Task 4: Deferred verification

- [ ] At the Phase 8 gate, cover enabled/disabled/unavailable/missing/share/unshare, row events, TUI/CLI calls, typecheck, and build.
