# Native Mixed Session Fork Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Verification runs only at the complete Phase 8 gate.

**Goal:** Fork legacy-only, canonical-only, and mixed Sessions into a durable canonical Session without bypassing event sourcing.

**Architecture:** Add one durable `session.next.message.imported` event whose projector inserts exactly one complete canonical message at that event's aggregate sequence. Server reads the already-unified transcript through `SessionRead`, applies the optional exclusive boundary, and asks Core to create a target Session, remap message references, and publish one import event per message. This keeps fork replayable and gives future V2 turns canonical context even when the source history originated in V1.

## Constraints

- Do not copy `session_message` rows directly.
- The optional message boundary is exclusive, matching the retained UI behavior.
- Remap message IDs, synthetic Session IDs, and shell user-message references.
- Preserve full projected legacy metadata rather than silently dropping unsupported fields.
- Do not hand-edit generated clients.
- Do not run tests/typecheck/build before the Phase 8 gate.

### Task 1: Add durable message import

- [x] Define the durable import event with a complete canonical message payload.
- [x] Add it to public durable/all manifests.
- [x] Project one imported message at the event aggregate sequence.

### Task 2: Add Core fork

- [x] Add a fork operation accepting the unified ordered canonical transcript.
- [x] Create the target with source location, agent/model, and a deterministic fork title.
- [x] Remap IDs and publish one import event per selected message.

### Task 3: Add Server/API boundary

- [x] Read the unified transcript through `SessionRead` in ascending order.
- [x] Enforce an exact exclusive message boundary, including retained noncanonical V1 IDs, and map missing boundaries precisely.
- [x] Add the Protocol endpoint and regenerate/inspect Promise and Effect clients.

### Task 4: Switch TUI fork consumers

- [x] Move startup fork, timeline fork, and message-action fork to native Session fork.
- [x] Preserve navigation and prompt-prefill behavior.

### Task 5: Deferred verification

- [ ] At the Phase 8 gate, cover legacy-only/canonical-only/mixed histories, exact boundaries, ID/reference remapping, replay rebuild, TUI consumers, typecheck, and build.
