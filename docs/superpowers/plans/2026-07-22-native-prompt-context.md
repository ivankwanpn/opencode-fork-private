# Native Prompt Context Implementation Plan

> Verification is deferred until the Phase 8 gate under the agreed phase-level testing workflow.

## Goal

Carry hidden per-prompt editor context through native admission, durable projection, model request assembly, replay, and the transitional TUI renderer without changing its instruction role.

## Tasks

- [x] Add optional durable prompt context entries with text and metadata.
- [x] Preserve context through admission, plugin projection, message projection, compaction, and LLM conversion.
- [x] Project context back to legacy synthetic text parts for the current TUI renderer.
- [x] Switch the final TUI prompt write to the native endpoint.
- [ ] Run focused tests and typecheck at the final Phase 8 verification gate.
