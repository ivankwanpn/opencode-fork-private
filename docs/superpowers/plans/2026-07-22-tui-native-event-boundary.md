# TUI Native Event Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish a typed native-event access boundary for the TUI and prove that V2 data updates can arrive without a matching legacy `GlobalEvent`.

**Architecture:** Keep the existing legacy `useEvent()` and `SyncProvider` path intact for live-only and loss-sensitive events. Add `useNativeEvent()` beside it, backed by `sdk.nativeEvent`, and route `DataProvider` through that accessor. Split the dual-stream test fixture so native and legacy delivery can be tested independently before any canonical state migration.

**Tech Stack:** TypeScript, SolidJS, Bun test, generated `@opencode-ai/client` Promise types.

## Global Constraints

- Do not delete or disable the legacy event stream, `SyncProvider`, V1 server, or V1 SDK in this slice.
- Do not claim native event canonicality until authoritative refresh and durable per-session replay are designed and verified.
- Do not edit generated client files.
- Run tests and typecheck from `packages/tui`, never the repository root.
- The checkout has no usable Git metadata; commit steps are intentionally omitted.

---

### Task 1: Add an independently testable native event accessor

**Files:**

- Modify: `packages/tui/src/context/event.ts`
- Modify: `packages/tui/src/context/data.tsx`
- Modify: `packages/tui/test/fixture/tui-sdk.ts`
- Create: `packages/tui/test/cli/tui/use-native-event.test.tsx`
- Modify: `packages/tui/test/cli/tui/data.test.tsx`

**Interfaces:**

- Consumes: `useSDK().nativeEvent`, `OpenCodeEvent`, and `EventSource.subscribeNative`.
- Produces: `useNativeEvent().subscribe(handler)` and `useNativeEvent().on(type, handler)`, where handlers receive the native event and `event.location` metadata.

- [x] **Step 1: Write the failing native-only boundary test**

  Add a test that imports `useNativeEvent`, mounts `SDKProvider`, subscribes to `catalog.updated`, calls a new fixture method `emitNative(...)`, and asserts the exact native event plus its location are delivered. Do not emit a legacy event.

- [x] **Step 2: Run the test and verify RED**

  Run:

  ```text
  bun test --timeout 30000 test/cli/tui/use-native-event.test.tsx
  ```

  Expected: fail because `useNativeEvent` and `emitNative` do not exist.

- [x] **Step 3: Split fixture delivery and implement the accessor**

  In `createEventSource()`, add separate `emitLegacy(event: GlobalEvent)` and `emitNative(event: OpenCodeEvent)` methods. Keep `emit(event)` as a compatibility helper that sends the legacy event and, only when it has `properties`, projects and sends its native equivalent.

  In `context/event.ts`, preserve `useEvent()` unchanged and add `useNativeEvent()` using `OpenCodeEvent` from `@opencode-ai/client`. Its metadata is `OpenCodeEvent["location"]`; `subscribe` forwards native events without legacy projection, and `on` narrows by `event.type`.

- [x] **Step 4: Run the boundary test and verify GREEN**

  Run the command from Step 2 and require zero failures.

- [x] **Step 5: Route DataProvider through the accessor**

  Replace the direct `sdk.nativeEvent.on(...)` subscription in `context/data.tsx` with `useNativeEvent().subscribe(...)`. Keep all existing event projection behavior unchanged.

- [x] **Step 6: Prove DataProvider accepts native-only delivery**

  Update the existing `catalog.updated` refresh test in `data.test.tsx` to call `emitNative(...)` directly with `{ id, type, data, location }`. Assert model/provider refreshes occur while no legacy event is emitted.

- [x] **Step 7: Run focused tests and typecheck**

  Run:

  ```text
  bun test --timeout 30000 test/cli/tui/use-native-event.test.tsx test/cli/tui/data.test.tsx test/cli/tui/use-event.test.tsx
  bun run typecheck
  ```

  Expected: all selected tests and typecheck pass.

- [x] **Step 8: Re-scan the compatibility boundary**

  Confirm `useEvent()` still reads `sdk.event`, `SyncProvider` still uses `useEvent()`, and only `DataProvider` uses `useNativeEvent()` in this slice.
