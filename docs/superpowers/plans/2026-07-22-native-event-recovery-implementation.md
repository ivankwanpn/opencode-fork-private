# Native Event Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Per the project owner's direction, verification runs only at the complete Phase 8 gate.

**Goal:** Make the TUI's native event reducer recover from SSE disconnects, bounded-subscriber overflow, and observable durable sequence gaps without silently losing state.

**Architecture:** Add a small transport-independent recovery adapter in the TUI. It tracks the latest durable sequence per Session, buffers live events during recovery, replays missing durable events through `sessions.history(after)`, rebuilds all currently loaded canonical read models, then drains the buffer. Reducer start events become idempotent by resource ID so a rebuild followed by buffered delivery cannot duplicate text, reasoning, or tool entries.

**Tech Stack:** TypeScript, native generated Promise client, Solid store reducers, canonical Session history and read endpoints.

## Global Constraints

- Do not change Protocol or generated clients.
- Treat `server.connected` after the first observed connection as a recovery boundary.
- Treat a durable sequence jump greater than one as a recovery boundary even if the transport remains open.
- Replay only Sessions with an observed cursor; rebuild every currently loaded canonical resource after any recovery boundary.
- Buffer live events while replay/rebuild is in progress and never silently discard a recovery failure.
- Do not run tests, typecheck, build, or manual flows until the complete Phase 8 verification gate.

---

### Task 1: Add the recovery state machine

**Files:**

- Create: `packages/tui/src/context/native-event-recovery.ts`

**Interfaces:**

- Consumes: `accept(V2Event)`, `sessions()`, paginated `replay(sessionID, after)`, `rebuild()`, and `dispatch(V2Event)` callbacks.
- Produces: ordered dispatch with durable cursor tracking, reconnect/gap recovery, buffering, and surfaced errors.

- [x] Track durable sequence by Session aggregate and ignore duplicate durable delivery.
- [x] Detect reconnect and live sequence gaps.
- [x] Replay each observed Session from its exclusive sequence cursor until `hasMore` is false.
- [x] Rebuild loaded canonical state, then drain buffered live events in arrival order.
- [x] Coalesce overlapping recovery requests and report replay/rebuild failures with their Session context.

### Task 2: Make streaming reducers rebuild-safe

**Files:**

- Modify: `packages/tui/src/context/data.tsx`

- [x] Make text-start, reasoning-start, and tool-input-start upsert by stable content/call ID.
- [x] Keep ended/success/failed events authoritative so buffered lifecycle delivery converges to exact canonical state.

### Task 3: Wire replay and canonical rebuild

**Files:**

- Modify: `packages/tui/src/context/data.tsx`

- [x] Page `sdk.native.sessions.history({ sessionID, after, limit: 100 })` and return native durable events in sequence order.
- [x] Rebuild only resources already represented in the Solid store: Session info/messages/permissions/questions, project saved permissions, and loaded Location catalogs.
- [x] Route native subscription events through the adapter and log any recovery failure with explicit context.

### Task 4: Deferred verification

**Files:**

- Create at Phase 8 gate: `packages/tui/test/context/native-event-recovery.test.ts`
- Modify at Phase 8 gate: `packages/tui/test/cli/tui/use-native-event.test.tsx`

- [ ] Cover first connect, reconnect, sequence gap, multi-page replay, duplicate durable events, buffered events, replay failure with rebuild continuation, and rebuild-safe started events.
- [ ] At the Phase 8 gate, run focused TUI tests and typecheck from `packages/tui`, then full build and manual local/attach TUI reconnect flows.
