# V1 Transcript Mutation Closeout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task by task.

**Goal:** Preserve the retained V1 HTTP/SDK contract while moving its remaining transcript mutations and diff reads onto the canonical V2 session transcript.

**Architecture:** V1 routes remain compatibility adapters only. Revert boundaries are resolved against the deterministic V2-to-V1 projection, then persisted as explicit V2 boundary data so replay and commit do not depend on the V1 tables. Experimental message and part mutations either map to narrow canonical V2 operations with unchanged observable events, or fail explicitly when the requested V1 shape has no lossless V2 representation. Diff calculation reads a projected V2 transcript; the obsolete V1 revert runtime service is removed after its last consumer is gone.

**Tech Stack:** TypeScript, Effect, Drizzle SQLite, Bun test, HttpApi schemas, generated Effect client.

## Constraints

- Keep `SessionMessageTable` as the canonical transcript; do not add a V2 Part table.
- Keep legacy Part IDs deterministic and stable at the compatibility boundary.
- Never silently widen a Part-boundary revert into a Message-boundary revert.
- Revert commit must update the canonical message and delete later messages and admitted inputs atomically in projection order.
- Do not write `MessageTable` or `PartTable` from retained mutation routes.
- Do not edit generated client sources manually; run `bun run generate` from `packages/client` after public API changes.
- Run tests and typechecks from package directories, never the repository root.
- Preserve `docs/superpowers/specs/2026-08-11-provider-native-tool-search-design.md` as an unrelated untracked file.

### Task 1: Make Part-Level Revert Canonical

**Files:**
- Modify: `packages/schema/src/revert.ts`
- Modify: `packages/schema/src/session-event.ts`
- Modify: `packages/core/src/session/revert.ts`
- Modify: `packages/core/src/session/projector.ts`
- Modify: `packages/core/test/session-projector.test.ts`
- Modify: `packages/opencode/src/session/message-v2.ts`
- Modify: `packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts`
- Modify: `packages/opencode/test/server/httpapi-session.test.ts`

1. Add a projector regression that commits a revert at an assistant content boundary and expects earlier content to remain, boundary/later content to disappear, later messages and inputs to disappear, and the staged marker to clear.
2. Run the focused Core test and confirm it fails because commit currently ignores the Part boundary.
3. Add an HTTP regression that sends a deterministic projected `partID`, commits through the next prompt-like write, and verifies the canonical V2 row is trimmed while V1 message/part row counts do not change.
4. Run the focused OpenCode test and confirm the request currently widens to a message boundary.
5. Extend `Revert.State` and `RevertEvent.Committed` with an optional canonical content boundary. Preserve the projected legacy `partID` separately for compatibility responses.
6. Resolve a legacy Part ID by projecting the target canonical message. Only retain a Part boundary when the legacy algorithm would have retained it; otherwise explicitly resolve to the correct message boundary.
7. Include the boundary in stage and commit events. On commit, decode the boundary message, trim its assistant content and completion-only fields from the boundary onward, then delete later messages and inputs.
8. Reject a supplied Part ID that is not present in the target message instead of silently staging a broader revert.
9. Run the focused Core and OpenCode tests and confirm they pass.

### Task 2: Remove V1 Writes From Experimental Mutation Routes

**Files:**
- Modify: `packages/core/src/session/event.ts`
- Modify: `packages/core/src/session/projector.ts`
- Modify: `packages/core/src/session/command.ts` or add one narrow adjacent command module if required
- Modify: `packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts`
- Modify: `packages/opencode/test/server/httpapi-session.test.ts`
- Modify: `packages/opencode/test/server/httpapi-sdk.test.ts`

1. Characterize update-part, delete-part, and delete-message with focused tests: response payload, not-found behavior, busy behavior, emitted compatibility event, canonical transcript result, and V1 table row counts.
2. Run those tests and confirm the canonical transcript currently remains unchanged while V1 tables mutate.
3. Add the smallest durable V2 events/commands needed for lossless supported operations. Keep arbitrary V1-only Part kinds outside the canonical mutation surface.
4. Map deterministic assistant text/reasoning/tool Part IDs and message deletion to the narrow V2 commands. Return an explicit bad request for unsupported Part shapes rather than writing V1.
5. Project the canonical update/removal and let the existing V2-to-V1 event adapter provide compatibility events.
6. Re-run focused HTTP and SDK tests and confirm the canonical transcript changes, V1 tables remain unchanged, and responses/events preserve the supported contract.

### Task 3: Move Diff Reads to V2 and Remove the V1 Revert Service

**Files:**
- Modify: `packages/opencode/src/session/summary.ts`
- Modify: `packages/opencode/src/session/native-session-diff.ts`
- Delete: `packages/opencode/src/session/revert.ts`
- Modify: `packages/opencode/src/effect/app-runtime.ts`
- Modify: `packages/opencode/src/server/routes/instance/httpapi/server.ts`
- Modify: related tests under `packages/opencode/test/session` and `packages/opencode/test/server`
- Modify: `V1-to-V2-migration.md`

1. Add a diff regression whose transcript exists only in `SessionMessageTable`; confirm the current summary reader misses it.
2. Change `SessionSummary.diff` to load canonical history and project it through the existing V2-to-V1 read adapter before calling the retained pure diff calculation.
3. Remove `SessionRevert.Service`, its runtime/server layers, and tests that exercise only the obsolete V1 mutation path. Retain pure compatibility schemas only where the external API still needs them.
4. Audit production imports for `SessionRevert`, V1 `removeMessage`/`removePart`/`updatePart` calls, and `Session.Service.messages()` in summary/revert paths.
5. Update the migration ledger with exact remaining V1 runtime dependencies and deletion prerequisites.

### Task 4: Regenerate and Verify

1. If Protocol or HttpApi schemas changed, run `bun run generate` from `packages/client`.
2. Run focused Core projector/revert tests from `packages/core`.
3. Run focused HTTP session, SDK, revert/compact, and diff tests from `packages/opencode`.
4. Run `bun typecheck` from `packages/schema`, `packages/core`, `packages/opencode`, and `packages/client` as applicable.
5. Inspect `git diff --check`, `git status --short`, and the final diff. Confirm the Tool Search design file is still untracked and unstaged.
6. Commit each independently green unit with conventional commit messages, then push `999.0.17`.
