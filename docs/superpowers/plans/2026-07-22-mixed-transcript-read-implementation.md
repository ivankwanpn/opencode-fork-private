# Mixed V1/V2 Transcript Read Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Per the project owner's direction, verification runs only at the complete Phase 8 gate.

**Goal:** Make native V2 message list and single-message reads include retained V1 transcript rows while preserving the standalone Server package's pure V2 behavior.

**Architecture:** Add a narrow transcript-read service in Server with a canonical default layer. OpenCode supplies a host-owned layer that projects retained V1 messages into canonical `SessionMessage.Message` values, overlays native V2 messages by ID, and paginates the unified ordered timeline. Session list/get/tree data needs no adapter because V1 and V2 already share the canonical `session` table and `parentID` projection.

**Tech Stack:** TypeScript, Effect services/layers, Effect Schema, Drizzle-backed V1 and V2 Session services.

## Global Constraints

- Keep the 1.18.3 baseline and do not absorb 1.18.4.
- Do not make Core, Schema, Protocol, or Server depend on OpenCode V1 modules.
- Do not change the public Protocol or generated clients.
- Native V2 rows win when the same message ID exists in both stores.
- Do not run tests, typecheck, build, or manual flows until the complete Phase 8 verification gate.
- Do not remove the retained V1 message or part tables in this slice.

---

### Task 1: Add the Server transcript-read seam

**Files:**

- Create: `packages/server/src/session-read.ts`
- Modify: `packages/server/src/handlers/message.ts`
- Modify: `packages/server/src/handlers/session.ts`
- Modify: `packages/server/src/routes.ts`

**Interfaces:**

- Consumes: `SessionV2.Interface["messages"]` and `SessionV2.Interface["message"]`.
- Produces: `SessionRead.Service`, whose default layer delegates both methods to `SessionV2.Service`.

- [x] Add the narrow service and canonical default layer.
- [x] Route `session.messages` and `session.message` through the service.
- [x] Provide the canonical default layer in standalone Server routes.

### Task 2: Project retained V1 messages into canonical wire messages

**Files:**

- Create: `packages/opencode/src/session/transcript-read.ts`

**Interfaces:**

- Consumes: `Session.Service`, `SessionV2.Service`, and `SessionRead.Service`.
- Produces: `TranscriptRead.layer` for the hybrid OpenCode server.

- [x] Project V1 user text, files, agents, prompt policy, and output format into canonical user messages.
- [x] Project V1 assistant text, reasoning, tools, snapshots, finish state, usage, model, structured output, and errors into canonical assistant messages.
- [x] Retain the complete original V1 message in canonical metadata so unsupported legacy-only parts are explicit rather than silently discarded.
- [x] Normalize legacy message IDs into stable canonical `msg_` IDs when necessary.

### Task 3: Merge and paginate the unified transcript

**Files:**

- Modify: `packages/opencode/src/session/transcript-read.ts`

**Interfaces:**

- Consumes: canonical and projected legacy message arrays.
- Produces: V2-compatible ordered pages and single-message lookup.

- [x] Load both stores only after canonical session existence is established.
- [x] Overlay canonical messages by ID, sort by creation time and ID, and implement `asc`/`desc` plus `previous`/`next` cursor semantics over the merged timeline.
- [x] Return an empty page for a stale cursor, matching the canonical service behavior.
- [x] Resolve single-message reads from the same canonical-wins merged view.

### Task 4: Install the host adapter

**Files:**

- Modify: `packages/opencode/src/server/routes/instance/httpapi/server.ts`

**Interfaces:**

- Consumes: `TranscriptRead.layer`.
- Produces: hybrid native V2 routes with mixed-history reads.

- [x] Provide the host adapter only to `@opencode-ai/server` handlers.
- [x] Keep legacy HTTP handlers and standalone Server routes unchanged in behavior.

### Task 5: Deferred verification coverage

**Files:**

- Create at Phase 8 gate: `packages/opencode/test/server/transcript-read.test.ts`
- Modify at Phase 8 gate if required: `packages/server/test/message.test.ts`

- [ ] Cover legacy-only, canonical-only, overlapping-ID, mixed ordering, both orders, both cursor directions, stale cursors, single-message lookup, unsupported V1-part metadata, and noncanonical legacy IDs.
- [ ] At the Phase 8 gate, run affected Server and OpenCode suites from their package directories, then package typechecks, build, and planned manual flows.

### Static Review Checklist

- [x] Confirm Server has no OpenCode/V1 import.
- [x] Confirm Protocol and generated clients are untouched.
- [x] Confirm native rows win duplicate IDs.
- [x] Confirm unsupported V1 fields remain visible in metadata.
- [x] Confirm session list/get need no compatibility layer because both services read the same `session` table.
- [x] Confirm no verification command ran before the Phase 8 gate.
