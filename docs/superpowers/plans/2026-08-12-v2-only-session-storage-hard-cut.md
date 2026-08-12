# V2-only Session Storage Hard Cut Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove legacy message/part storage from runtime transcript reads and writes without migrating retained user data.

**Architecture:** Canonical `SessionV2` and `SessionMessageTable` become the only transcript authority. CLI import publishes durable V2 message-import events, while existing legacy HTTP response shapes remain temporary stateless projections at the handler boundary.

**Tech Stack:** TypeScript, Bun, Effect, Drizzle SQLite, Effect HttpApi.

## Global Constraints

- Do not migrate or retain legacy `message` / `part` user rows.
- Add missing behavior to V2 rather than falling back to V1 services or tables.
- Preserve durable prompt admission and the Session-ID-based process-global execution boundary.
- Run tests and `bun typecheck` from package directories, never from the repository root.
- Regenerate the Client after public Protocol or HttpApi schema changes; do not edit generated files manually.
- Keep `docs/superpowers/specs/2026-08-11-provider-native-tool-search-design.md` untracked and out of every commit.

---

### Task 1: Lock canonical transcript reads

**Files:**
- Modify: `packages/opencode/test/server/httpapi-session.test.ts`
- Modify: `packages/opencode/test/server/transcript-read.test.ts`
- Modify: `packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts`
- Modify: `packages/opencode/src/server/routes/instance/httpapi/server.ts`
- Delete: `packages/opencode/src/session/transcript-read.ts`

**Interfaces:**
- Consumes: `SessionV2.Service.messages`, `SessionV2.Service.message`, `MessageV2.toLegacy`.
- Produces: HTTP list/get/revert/diff behavior whose only transcript source is canonical V2.

- [ ] **Step 1: Write failing HTTP tests**

Insert a legacy-only message/part row beside a canonical session, then assert message list/get omit it and a
legacy-only message ID returns not found. Change the existing merge test to assert canonical-only behavior.

- [ ] **Step 2: Run tests and verify RED**

Run from `packages/opencode`:

```bash
bun test test/server/transcript-read.test.ts test/server/httpapi-session.test.ts --timeout 20000
```

Expected: retained-message assertions fail because `TranscriptRead` still merges legacy rows.

- [ ] **Step 3: Replace the merge service**

Inject `SessionV2.Service` directly in the session HTTP handler. Use `messages({ order: "asc" })` and
`message(...)`, then call `MessageV2.toLegacy(session, messages)` only for current response contracts.
Remove `TranscriptRead.layer` from the server graph and delete the merge service/tests.

- [ ] **Step 4: Run focused tests and typecheck**

```bash
bun test test/server/httpapi-session.test.ts --timeout 20000
bun typecheck
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts packages/opencode/src/server/routes/instance/httpapi/server.ts packages/opencode/src/session/transcript-read.ts packages/opencode/test/server/httpapi-session.test.ts packages/opencode/test/server/transcript-read.test.ts
git commit -m "refactor(opencode): read canonical transcripts only"
```

### Task 2: Replace CLI export/import with a canonical V2 envelope

**Files:**
- Modify: `packages/opencode/src/cli/cmd/import.ts`
- Modify: `packages/opencode/src/cli/cmd/export.ts`
- Modify: `packages/opencode/test/cli/import.test.ts`
- Test: `packages/opencode/test/cli/import-v2.test.ts`
- Test: `packages/opencode/test/cli/export-v2.test.ts`
- Modify if required: `packages/core/src/session.ts`
- Test if required: `packages/core/test/session-projector.test.ts`

**Interfaces:**
- Consumes: `SessionV2.Service.create`, `SessionV2.Service.transcript.importMessage`.
- Produces: `{ version: 2, session, messages }` exports and canonical-only imports with stable message IDs and no direct database writes.

- [ ] **Step 1: Write failing import integration tests**

Export a canonical session and assert the decoded envelope has `version: 2`, canonical session info, and
canonical messages. Import that envelope and assert `SessionV2.messages(...)` returns it in order. Add a failure
case for a versionless V1 export and an old flat share payload.

- [ ] **Step 2: Run tests and verify RED**

```bash
bun test test/cli/import.test.ts test/cli/import-v2.test.ts test/cli/export-v2.test.ts --timeout 20000
```

Expected: canonical messages are absent because the current command writes `MessageTable` / `PartTable`.

- [ ] **Step 3: Implement canonical import**

Define an Effect schema for `{ version: Schema.Literal(2), session: SessionSchema.Info, messages:
Schema.Array(SessionMessage.Message) }`. Export directly from `SessionV2.Service`; update canonical sanitization
without a V1 projection. Import the same envelope, create/adopt the V2 session, and call `transcript.importMessage`
sequentially. Remove `Database`, `SessionV1`, `MessageTable`, and `PartTable` imports. Keep share URL fetching but
reject responses that do not decode as the V2 envelope.

- [ ] **Step 4: Run focused Core/OpenCode tests and typechecks**

```bash
# packages/core
bun test test/session-projector.test.ts
bun typecheck

# packages/opencode
bun test test/cli/import.test.ts test/cli/import-v2.test.ts test/cli/export-v2.test.ts --timeout 20000
bun typecheck
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/session.ts packages/core/test/session-projector.test.ts packages/opencode/src/cli/cmd/import.ts packages/opencode/src/cli/cmd/export.ts packages/opencode/test/cli/import.test.ts packages/opencode/test/cli/import-v2.test.ts packages/opencode/test/cli/export-v2.test.ts
git commit -m "refactor(opencode): import transcripts through V2"
```

### Task 3: Remove retained transcript adoption

**Files:**
- Modify: `packages/opencode/src/session/message-v2.ts`
- Modify: `packages/opencode/src/session/legacy-session-read.ts`
- Modify: `packages/opencode/src/session/legacy-session-execution.ts`
- Modify: `packages/opencode/test/session/message-v2.test.ts`
- Modify: `packages/opencode/test/server/httpapi-session.test.ts`
- Modify: `packages/core/src/session.ts`
- Modify: `packages/core/src/session/projector.ts`
- Modify: `packages/core/src/session/sql.ts`
- Modify: `packages/core/test/session-projector.test.ts`

**Interfaces:**
- Consumes: canonical `SessionMessage.Message` and transcript mutation events.
- Produces: mutation/revert helpers that never query or adopt retained V1 messages.

- [ ] **Step 1: Write failing hard-cut tests**

Replace lazy-adoption expectations with not-found behavior for legacy-only IDs. Assert canonical mutation and
revert continue to work without `removedMessages` or tombstone state.

- [ ] **Step 2: Run tests and verify RED**

```bash
# packages/core
bun test test/session-projector.test.ts

# packages/opencode
bun test test/session/message-v2.test.ts test/server/httpapi-session.test.ts --timeout 20000
```

Expected: legacy-only IDs are still adopted and therefore violate the new hard-cut assertions.

- [ ] **Step 3: Remove compatibility logic**

Delete legacy-table page/get/parts helpers, retained projection/adoption code, tombstone reads/writes, and V1
message/Part projector branches. Resolve mutations only against `SessionV2.message(...)` and canonical content.

- [ ] **Step 4: Run focused tests and typechecks**

Run the commands from Step 2 followed by `bun typecheck` in `packages/core` and `packages/opencode`.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/session.ts packages/core/src/session/projector.ts packages/core/src/session/sql.ts packages/core/test/session-projector.test.ts packages/opencode/src/session/message-v2.ts packages/opencode/src/session/legacy-session-read.ts packages/opencode/src/session/legacy-session-execution.ts packages/opencode/test/session/message-v2.test.ts packages/opencode/test/server/httpapi-session.test.ts
git commit -m "refactor(core): remove retained transcript compatibility"
```

### Task 4: Drop legacy transcript tables

**Files:**
- Modify: `packages/core/src/session/sql.ts`
- Modify: `packages/core/src/database/schema.gen.ts`
- Modify: `packages/core/src/database/migration.gen.ts`
- Create: `packages/core/src/database/migration/<timestamp>_drop-legacy-transcript.ts`
- Modify: `packages/core/schema.json`
- Modify: `packages/opencode/src/storage/schema.ts`
- Modify/delete: tests that directly corrupt legacy Part rows.

**Interfaces:**
- Consumes: zero production references to `MessageTable`, `PartTable`, or tombstone table.
- Produces: a database schema containing only canonical session transcript storage.

- [ ] **Step 1: Add an isolation gate**

Add a source-level test that fails when production files reference `MessageTable`, `PartTable`, or
`SessionMessageTombstoneTable` outside the migration history.

- [ ] **Step 2: Run the gate and verify RED**

Run the new test from `packages/core`; expected failure lists remaining references.

- [ ] **Step 3: Remove tables and generate migration artifacts**

Remove legacy table exports and obsolete tests. Regenerate schema/migration artifacts using repository scripts;
do not edit generated files manually.

- [ ] **Step 4: Verify schema and packages**

```bash
# packages/core
bun run migration --check
bun test
bun typecheck

# packages/schema
bun test
bun typecheck

# packages/opencode
bun typecheck
```

Expected: zero failures and no production source references to removed tables.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/session/sql.ts packages/core/src/database/schema.gen.ts packages/core/src/database/migration.gen.ts packages/core/src/database/migration packages/core/schema.json packages/core/test packages/opencode/src/storage/schema.ts packages/opencode/test/server/negative-tokens-regression.test.ts packages/opencode/test/server/httpapi-schema-error-body.test.ts
git commit -m "refactor(core): drop legacy transcript tables"
```

### Task 5: Regenerate clients and update migration tracking

**Files:**
- Modify if generated: `packages/client/src/generated/**`
- Modify: `V1-to-V2-migration.md`

**Interfaces:**
- Consumes: final V2-only storage API/schema.
- Produces: current generated client contracts and an accurate Batch 8 progress record.

- [ ] **Step 1: Regenerate the Client if public schemas changed**

Run from `packages/client`:

```bash
bun run generate
bun typecheck
```

- [ ] **Step 2: Update migration status**

Record that legacy transcript rows are intentionally abandoned, import/read paths are canonical-only, and the
next blocker is broad `Session.Service` consumer migration rather than retained transcript storage.

- [ ] **Step 3: Run final gates**

Run package typechecks, focused HTTP/import/projector tests, `bun run migration --check`, and `git diff --check`.

- [ ] **Step 4: Commit**

```bash
git add packages/client/src/generated V1-to-V2-migration.md
git commit -m "docs: record V2-only transcript storage"
```
