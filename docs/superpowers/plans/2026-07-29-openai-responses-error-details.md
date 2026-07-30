# OpenAI Responses Error Details Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve and display provider error details when an OpenAI-compatible Responses stream wraps them in a top-level `error` object.

**Architecture:** Extend the Responses event schema at the protocol boundary so the decoder retains the compatible proxy shape, then let the existing provider-error formatter read the normalized payload. A fixture-first regression test will exercise the complete HTTP/SSE route and verify that the user-visible event contains the provider code and message.

**Tech Stack:** TypeScript, Effect Schema, Effect Stream, Bun test.

## Global Constraints

- Keep the runtime dependency direction from Schema to Core and Protocol, then Core and Protocol to Server.
- Use Effect Schema codecs for JSON encode/decode; do not add manual JSON parsing in the protocol.
- Keep provider tests fixture-first and run tests from `packages/llm`, not the repository root.
- Run `bun typecheck` from `packages/llm`, not `tsc` directly.
- Do not edit generated sources.

---

### Task 1: Preserve top-level Responses stream error payloads

**Files:**
- Modify: `packages/llm/src/protocols/openai-responses.ts` in the Responses event schema and error projection.
- Test: `packages/llm/test/provider/openai-responses.test.ts` near the existing provider-error cases.

**Interfaces:**
- Consumes: SSE frames decoded by `Protocol.jsonEvent(OpenAIResponsesEvent)`.
- Produces: `LLMEvent` with `type: "provider-error"` and a message containing the nested provider `code` and `message`.

- [x] **Step 1: Write the failing test**

Add an integration test that feeds a compatible proxy error event through `fixedResponse` and expects the nested details:

```ts
it.effect("surfaces top-level nested error event details", () =>
  Effect.gen(function* () {
    const response = yield* LLMClient.generate(request).pipe(
      Effect.provide(
        fixedResponse(
          sseEvents({
            type: "error",
            error: { code: "upstream_error", message: "Model backend unavailable", param: "model" },
          }),
        ),
      ),
    )

    expect(response.events).toEqual([
      {
        type: "provider-error",
        message: "upstream_error: Model backend unavailable (param=model)",
      },
    ])
  }),
)
```

- [x] **Step 2: Run the focused test and verify it fails for the expected reason**

Run: `bun test test/provider/openai-responses.test.ts --test-name-pattern "top-level nested error event details" --timeout 30000`

Expected: FAIL because the current event schema drops the unknown top-level `error` object and emits `OpenAI Responses stream error`.

- [x] **Step 3: Implement the minimal protocol fix**

Add an optional top-level `error` field to `OpenAIResponsesEvent`, reuse `OpenAIResponsesErrorPayload`, and update `providerErrorMessage`/`providerError` to prefer `event.error` while retaining official top-level and `response.error` shapes. Keep the fallback unchanged when no diagnostics are supplied.

- [x] **Step 4: Run the focused test and verify it passes**

Run: `bun test test/provider/openai-responses.test.ts --test-name-pattern "top-level nested error event details" --timeout 30000`

Expected: PASS with one test and zero failures.

Additional review regression: a mixed event containing both `event.error` and `response.error` now prefers the top-level `event.error`; this focused test also passes.

- [x] **Step 5: Run the complete Responses regression suite**

Run: `bun test test/provider/openai-responses.test.ts --timeout 30000`

Expected: PASS for all tests in the file, including official top-level errors, `response.failed`, HTTP errors, tools, reasoning, and WebSocket coverage.

- [ ] **Step 6: Run package typechecking**

Run: `bun typecheck`

Expected: exit code 0 with no TypeScript errors.

Observed: `bun typecheck` could not start because the package-local `@typescript/native-preview/bin/tsgo.js` is missing. The equivalent root `tsgo.js` invocation ran and reported pre-existing baseline errors across unrelated protocol/schema/test files; no new error was reported in the changed error-handling lines.
