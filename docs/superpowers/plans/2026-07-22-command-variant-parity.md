# Command Variant Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Verification runs only at the complete Phase 8 gate.

**Goal:** Route legacy command requests with an explicit model variant through native V2 command admission instead of the V1 runner.

**Architecture:** Carry the optional legacy variant as a narrow internal override on `SessionV2.command` and `SessionPromptExpansion.command`. Apply it to the command's selected parent-session model after command/agent/subtask resolution, then stop classifying variant-only requests as loss-sensitive.

**Tech Stack:** TypeScript, Core Session command expansion, OpenCode HttpApi compatibility handlers.

## Constraints

- Do not change the public native Protocol; `Model.Ref` already carries variants there.
- Keep V1 fallback for caller-supplied attachment part IDs and file/symbol source payloads.
- Do not run verification before the Phase 8 gate.

### Task 1: Carry and apply the internal variant override

- Modify: `packages/core/src/session.ts`
- Modify: `packages/core/src/session/prompt-expansion.ts`

- [x] Add `variant?: ModelV2.VariantID` to the internal command inputs.
- [x] Apply it to the selected model while preserving command/subtask model-selection order.

### Task 2: Remove the variant-only V1 fallback

- Modify: `packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts`

- [x] Pass the branded variant to `sessionV2.command`.
- [x] Keep only attachment fidelity checks in `requiresLegacyCommand`.

### Task 3: Deferred verification

- Modify at Phase 8 gate: `packages/opencode/test/server/httpapi-session.test.ts`
- Modify at Phase 8 gate: `packages/core/test/session-prompt-expansion.test.ts`

- [ ] Verify variant-only legacy requests execute once through V2 and preserve the selected variant.
