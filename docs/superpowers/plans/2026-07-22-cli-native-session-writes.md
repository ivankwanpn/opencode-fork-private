# CLI Native Session Writes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Verification runs only at the complete Phase 8 gate.

**Goal:** Move lossless `opencode run` command, shell, and interrupt writes to the generated V2 client.

**Architecture:** Pass the already-constructed native client into the interactive stream transport. Use native command/shell/interrupt endpoints while retaining the compatibility command route only for legacy attachment sources that cannot be represented losslessly.

## Constraints

- Keep the legacy event reducer until its native reducer migration is complete.
- Do not change prompt transport in this slice; it still carries loss-sensitive V1 parts.
- Do not silently drop command attachment identity or source fields.
- Do not run tests/typecheck/build before the Phase 8 gate.

### Task 1: Switch non-interactive command

- [x] Use the native command endpoint and current parsed model/variant.
- [x] Preserve CLI error formatting and completion waiting.

### Task 2: Switch interactive writes

- [x] Pass `NativeClient` into the stream transport.
- [x] Use native shell with agent/model selection.
- [x] Use native command for lossless attachments and retain explicit compatibility fallback otherwise.
- [x] Use native Session interrupt from the interactive runtime.

### Task 3: Deferred verification

- [ ] At the Phase 8 gate, cover local/attach command, shell, interrupt, attachment fallback, errors, event completion, typecheck, and build.
