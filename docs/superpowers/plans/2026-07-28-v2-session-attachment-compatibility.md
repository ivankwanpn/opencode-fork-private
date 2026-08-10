# V2 Session Attachment Compatibility Implementation Plan

**Goal:** Open current V2 sessions containing attachments without breaking
legacy session attachment rendering.

**Architecture:** Normalize current and legacy attachment representations only
when projecting server messages into App render parts.

## Constraints

- Do not mutate or migrate persisted session data.
- Do not modify Protocol, Server APIs, generated clients, or Core.
- Preserve current V2 and legacy attachment/mention representations.
- Run tests from `packages/app`, not the repository root.

### Task 1: Reproduce the current V2 crash

**File:** `packages/app/src/utils/session-message.test.ts`

- Add a current V2 user attachment with top-level `uri`, `materialized: []`, and
  no `source`.
- Include current file and agent `source` metadata in the same regression area.
- Run:

```powershell
bun test --preload ./happydom.ts ./src/utils/session-message.test.ts
```

- Verify the new case fails at `file.source.type`.

### Task 2: Normalize both attachment generations

**File:** `packages/app/src/utils/session-message.ts`

- Prefer top-level `uri`.
- Fall back to legacy URI source or inline base64 data.
- Read current `source` mention metadata or legacy `mention`.
- Reuse the mention normalization for agent attachments.
- Avoid changing valid legacy output.

Run the focused test again and require all cases to pass.

### Task 3: Verify nearby App behavior

Run from `packages/app`:

```powershell
bun test --preload ./happydom.ts ./src/utils/session-message.test.ts ./src/utils/server-compat.test.ts
bun run typecheck
```

Record known pre-existing typecheck failures separately from this fix.

Finally, start the dev desktop application and open the affected session.
Verify that the timeline renders and the renderer does not enter its
