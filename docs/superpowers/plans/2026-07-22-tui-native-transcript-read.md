# TUI Native Transcript Read Implementation Plan

> Verification is deferred until the Phase 8 gate under the agreed phase-level testing workflow.

## Goal

Read canonical mixed V1/V2 transcripts through the native message endpoint while the existing TUI renderer still consumes legacy `Message + Part[]` records.

## Tasks

- [x] Preserve retained V1 records from native message `metadata.legacy` while normalizing message references.
- [x] Project native user, assistant, shell, synthetic, system, and compaction messages into the legacy renderer shape.
- [x] Switch central session get/message hydration to native endpoints.
- [ ] Replace the projection when the TUI renderer consumes `SessionMessage` directly.
- [ ] Run focused tests and typecheck at the final Phase 8 verification gate.
