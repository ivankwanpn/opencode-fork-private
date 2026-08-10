# Native Session Update and Delete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Verification runs only at the complete Phase 8 gate.

**Goal:** Add native title/archive mutation and recursive Session deletion, then switch TUI consumers.

**Architecture:** Convert the shared Session row to the retained durable lifecycle schema, publish update/delete events through EventV2 so both compatibility and native consumers observe one mutation, and let the existing projector own SQL writes. Recursive deletion interrupts active Sessions, deletes children first, and removes aggregate history after the deletion boundary is published.

## Constraints

- Preserve every Session row field not explicitly updated.
- Represent archive clearing explicitly with `null`.
- Delete children before parents and interrupt execution before deletion.
- Do not hand-edit generated clients.
- Do not run tests/typecheck/build before the Phase 8 gate.

### Task 1: Add Core lifecycle operations

- [x] Add a single shared Session-row to durable lifecycle projection.
- [x] Add title/archive update with full-row preservation and NotFound errors.
- [x] Add recursive interrupt/delete/event-history cleanup.

### Task 2: Add public API and clients

- [x] Add PATCH update and DELETE remove endpoints with precise NotFound mapping.
- [x] Regenerate and inspect Promise/Effect clients.

### Task 3: Switch TUI consumers

- [x] Move Session rename to native update.
- [x] Move Session deletion to native remove.
- [x] Confirm there are no remaining TUI archive mutations; app archive consumers remain in their separate client migration.

### Task 4: Deferred verification

- [ ] At the Phase 8 gate, cover field preservation, archive set/clear, stable events, recursive deletion, active interruption, missing Sessions, TUI calls, typecheck, and build.
