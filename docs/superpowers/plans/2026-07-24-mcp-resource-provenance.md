# MCP Resource Provenance and V2 Helper Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve MCP resource provenance through native V2 settlement and provider replay, materialize provider-bound tool files safely, add provider MIME fallback, and register the three V2 MCP resource helper tools.

**Architecture:** Extend the shared canonical `ToolContent` contract with one optional MCP provenance carrier, populate it at the MCP producer, and preserve it through origin-aware plugin compatibility. Prepare unresolved tool-result files in a transient request copy, let each provider protocol choose native tool-result media or an immediate user-content fallback, and register resource helpers through the existing Location-scoped MCP tool contribution.

**Tech Stack:** TypeScript, Bun 1.3, Effect 4, `@modelcontextprotocol/sdk` 1.29, `@opencode-ai/schema`, `@opencode-ai/llm`, Core V2 Session and Tool services, generated Promise/Effect clients.

## Global Constraints

- Follow `docs/superpowers/specs/2026-07-24-mcp-resource-provenance-design.md`.
- Keep the source baseline at 1.18.3; do not merge or copy code from 1.18.4 in this plan.
- Keep `packages/schema/src/llm.ts` as the one encoded `ToolContent` owner.
- Do not add dedicated MCP Session content variants, a provenance side table, or a second executable tool representation.
- Do not put MCP identity into filenames, display text, or `structuredContent` as its only durable representation.
- Generic MCP image/audio blocks remain generic files and never acquire resource provenance.
- Resource links remain readable text and are not implicitly dereferenced.
- Durable Session history keeps original URIs and provenance; provider materialization changes only the outgoing request copy.
- Reuse the existing 20 MiB `SessionAttachment.MAX_ATTACHMENT_BYTES` ingestion limit for local/remote request materialization.
- Preserve the V1 10 MiB MCP resource-blob producer limit and the V1 resource MIME allowlist: PDF, GIF, JPEG, PNG, and WebP.
- Provider lowering ignores MCP provenance, annotations, and `_meta` by default.
- A provider MIME unsupported in tool results moves to the first provider-legal following user-content position when that route supports the MIME there; otherwise lowering fails before HTTP I/O.
- `tool.execute.after` string replacement changes text only and preserves all file content.
- The project owner explicitly rejected TDD for this phase. Author implementation and coverage together, but do not run tests, typecheck, formatter, lint, generation, or build until Task 8.
- Run tests only from package directories, never from the repository root.
- The checkout has no usable Git metadata. Capture filesystem baselines for static review and omit commit steps.
- Work with existing user changes. Never restore a whole file from a baseline; baselines exist only for no-index review.

---

### Task 1: Add the Shared Provenance Contract

**Files:**

- Modify: `packages/schema/src/llm.ts`
- Modify: `packages/core/src/tool/tool.ts`
- Create: `packages/schema/test/llm.test.ts`
- Modify: `packages/core/test/session-runner-tool-registry.test.ts`

**Interfaces:**

- Consumes: the existing `ToolTextContent`, `ToolFileContent`, `ToolContent`, `Tool.Content`, and `Tool.make()` projection boundary.
- Produces: exported `McpProvenance`, optional `provenance` on shared tool text/file content, and a Core tool projection that retains it.

- [ ] **Step 1: Capture the four files before editing**

  Copy each file into
  `.superpowers/sdd/phase8-mcp-task-1-baseline/` while preserving its relative
  path. Record absent files as zero-byte `.absent` markers rather than creating
  a source file early.

- [ ] **Step 2: Define the additive shared schema**

  In `packages/schema/src/llm.ts`, add `McpProvenance` before the two content
  schemas and attach it to both variants:

  ```ts
  export interface McpProvenance extends Schema.Schema.Type<typeof McpProvenance> {}
  export const McpProvenance = Schema.Struct({
    type: Schema.Literal("mcp"),
    clientName: Schema.String,
    uri: Schema.String,
    kind: Schema.Literals(["resource", "resource_link"]),
    mime: optional(Schema.String),
    name: optional(Schema.String),
    description: optional(Schema.String),
    size: optional(Schema.Number),
    annotations: optional(Schema.Record(Schema.String, Schema.Unknown)),
    meta: optional(Schema.Record(Schema.String, Schema.Unknown)),
  }).annotate({ identifier: "Tool.McpProvenance" })

  export const ToolTextContent = Schema.Struct({
    type: Schema.Literal("text"),
    text: Schema.String,
    provenance: optional(McpProvenance),
  }).annotate({ identifier: "Tool.TextContent" })

  export const ToolFileContent = Schema.Struct({
    type: Schema.Literal("file"),
    uri: Schema.String,
    mime: Schema.String,
    name: optional(Schema.String),
    provenance: optional(McpProvenance),
  }).annotate({ identifier: "Tool.FileContent" })
  ```

  Keep the existing tagged union and exported interface names unchanged so
  Session event/message consumers pick up the field without a second schema.

- [ ] **Step 3: Preserve provenance through `Tool.make()`**

  Import the shared content types from `@opencode-ai/llm`. Keep Core's base64
  convenience input, but include provenance in every branch:

  ```ts
  export type Content =
    | ToolTextContent
    | ToolFileContent
    | {
        readonly type: "file"
        readonly data: string
        readonly mime: string
        readonly name?: string
        readonly provenance?: McpProvenance
      }
  ```

  Replace the projection that reconstructs text/file objects without optional
  fields with:

  ```ts
  content:
    config.toModelOutput?.({ input, output }).map((part) =>
      part.type === "text"
        ? part
        : {
            type: "file" as const,
            uri: "uri" in part ? part.uri : `data:${part.mime};base64,${part.data}`,
            mime: part.mime,
            name: part.name,
            provenance: part.provenance,
          },
    ) ?? (typeof output === "string" ? [{ type: "text" as const, text: output }] : []),
  ```

- [ ] **Step 4: Add schema and canonical projection coverage without running it**

  In `packages/schema/test/llm.test.ts`, encode and decode one text and one file
  contribution carrying every provenance field. Assert:

  ```ts
  expect(decoded).toEqual(encoded)
  expect(decoded[0]?.provenance?.meta).toEqual({
    result: { trace: "result" },
    content: { trace: "content" },
    resource: { trace: "resource" },
  })
  ```

  Add a legacy fixture with no provenance and assert its encoded shape does not
  gain `provenance: undefined`.

  In `session-runner-tool-registry.test.ts`, add a canonical tool whose
  `toModelOutput` returns a provenance-bearing file. Assert the settlement
  output retains the exact object.

- [ ] **Step 5: Perform the Task 1 static gate**

  Compare the source files against the captured baselines with no-index diffs.
  Check that:
  - no Session event/message schema was duplicated;
  - old content remains backward compatible;
  - every Core projection branch retains provenance;
  - no test, formatter, typecheck, generation, or build command ran.

### Task 2: Project MCP Resources and Opaque Metadata

**Files:**

- Modify: `packages/core/src/mcp/catalog.ts`
- Modify: `packages/core/test/mcp-catalog.test.ts`

**Interfaces:**

- Consumes: Task 1 `McpProvenance` and `Tool.Content`.
- Produces: `McpCatalog.projectResult(clientName, result)`, ordered canonical content, validated resource diagnostics, and metadata-preserving dynamic MCP tools.

- [ ] **Step 1: Capture the MCP catalog files before editing**

  Store source/test baselines under
  `.superpowers/sdd/phase8-mcp-task-2-baseline/`.

- [ ] **Step 2: Introduce one result projector**

  Export a narrow projection value:

  ```ts
  export type Projection = {
    readonly content: ReadonlyArray<Tool.Content>
    readonly contents: ReadonlyArray<unknown>
  }

  export function projectResult(clientName: string, result: CallToolResult): Projection
  ```

  `toCoreTool()` must call this function once and use `projection.content` as
  model output. `structuredContent` remains the dynamic tool's structured
  output.

- [ ] **Step 3: Build exact MCP provenance**

  Use a helper that omits absent fields and keeps each `_meta` source separate:

  ```ts
  function provenance(
    clientName: string,
    result: CallToolResult,
    item: Extract<CallToolResult["content"][number], { type: "resource" | "resource_link" }>,
  ): McpProvenance {
    const resource = item.type === "resource" ? item.resource : item
    const meta = {
      ...(result._meta === undefined ? {} : { result: result._meta }),
      ...(item._meta === undefined ? {} : { content: item._meta }),
      ...(item.type !== "resource" || item.resource._meta === undefined ? {} : { resource: item.resource._meta }),
    }
    return {
      type: "mcp",
      clientName,
      uri: resource.uri,
      kind: item.type,
      mime: resource.mimeType,
      name: item.type === "resource_link" ? item.name : undefined,
      description: item.type === "resource_link" ? item.description : undefined,
      size: item.type === "resource_link" ? item.size : undefined,
      annotations: item.annotations,
      meta: Object.keys(meta).length === 0 ? undefined : meta,
    }
  }
  ```

  Preserve exact resource-link `name`, `description`, `size`, MIME, URI,
  annotations, and `_meta`. Do not derive resource identity from a path
  segment.

- [ ] **Step 4: Project every content type in order**

  Implement these exact cases:

  ```ts
  switch (item.type) {
    case "text":
      return [{ type: "text", text: item.text }]
    case "image":
    case "audio":
      return [{ type: "file", data: item.data, mime: item.mimeType }]
    case "resource":
      return projectEmbeddedResource(clientName, result, item)
    case "resource_link":
      return [
        {
          type: "text",
          text: `${item.name}: ${item.uri}`,
          provenance: provenance(clientName, result, item),
        },
      ]
  }
  ```

  `projectEmbeddedResource()` returns raw text plus provenance for text
  resources. For valid allowed blobs at or below 10 MiB, return a base64 file
  plus provenance and use only a display filename. For invalid base64,
  over-limit data, or a disallowed MIME, return one diagnostic text item with
  the same provenance and a sanitized `contents` diagnostic that excludes the
  rejected base64 string.

- [ ] **Step 5: Add discriminating catalog coverage without running it**

  Extend `mcp-catalog.test.ts` with one result containing:
  - generic text, image, and audio;
  - a text resource with outer and inner `_meta`;
  - a valid blob resource;
  - a resource link with every optional field;
  - result-level `_meta`;
  - `structuredContent`.

  Assert exact order and values. Explicitly assert:

  ```ts
  expect(genericImage).not.toHaveProperty("provenance")
  expect(resource.provenance).toMatchObject({
    type: "mcp",
    clientName: "server",
    uri: "mcp://server/item",
    kind: "resource",
  })
  ```

  Add separate invalid-base64, unsupported-MIME, and over-limit cases. Assert
  valid siblings remain and serialized output does not contain the rejected
  payload.

- [ ] **Step 6: Perform the Task 2 static gate**

  Review the no-index diff against the spec and Task 1 interface. Confirm
  generic media has no resource provenance, `structuredContent` is untouched,
  and diagnostics cannot retain invalid bytes.

### Task 3: Preserve Canonical Content Through Legacy Hooks

**Files:**

- Modify: `packages/core/src/tool/registry.ts`
- Modify: `packages/core/src/session/runner/to-llm-message.ts`
- Modify: `packages/core/test/session-runner-tool-registry.test.ts`
- Modify: `packages/core/test/session-runner-message.test.ts`

**Interfaces:**

- Consumes: provenance-bearing `ToolContent`, SDK V2 `ToolPart` and
  `FilePart`, existing `PluginMessageProjection`.
- Produces: text-only `tool.execute.after` replacement,
  `PluginMessageOrigins`, occurrence-aware file projection, and lossless
  `toPluginMessages()` / `fromPluginMessages()` reconstruction.

- [ ] **Step 1: Capture the registry and message-projection files**

  Store all four baselines under
  `.superpowers/sdd/phase8-mcp-task-3-baseline/`.

- [ ] **Step 2: Make `tool.execute.after` text-only**

  Add a close local helper below registry settlement:

  ```ts
  function replaceText(content: ReadonlyArray<ToolContent>, text: string): ReadonlyArray<ToolContent> {
    const indexes = content.flatMap((part, index) => (part.type === "text" ? [index] : []))
    if (indexes.length === 1) {
      const target = indexes[0]!
      return content.map((part, index) => (index === target && part.type === "text" ? { ...part, text } : part))
    }
    const files = content.filter((part) => part.type === "file")
    if (indexes.length === 0) return [{ type: "text", text }, ...files]
    const first = indexes[0]!
    return content.flatMap((part, index) => {
      if (index === first) return [{ type: "text" as const, text }]
      return part.type === "text" ? [] : [part]
    })
  }
  ```

  Use this helper only when the legacy after hook changes `output` to a
  string. Keep unchanged and non-string behavior as-is. One text part retains
  provenance; multiple text parts collapse to one generic text part; files
  always survive.

- [ ] **Step 3: Define request-local attachment origins**

  Replace the single origin map type with:

  ```ts
  type ToolAttachmentOrigin =
    | { readonly type: "canonical"; readonly content: ToolFileContent }
    | { readonly type: "legacy"; readonly file: FileAttachment }

  export type PluginMessageOrigins = {
    readonly messages: ReadonlyMap<string, SessionMessage.Message>
    readonly toolAttachments: ReadonlyMap<string, ToolAttachmentOrigin>
  }

  export type PluginMessageProjection = {
    readonly messages: readonly PluginMessage[]
    readonly origins: PluginMessageOrigins
  }
  ```

  Populate `toolAttachments` only during this projection call. Do not encode
  it in SDK metadata or Session messages.

- [ ] **Step 4: Project canonical and legacy tool files**

  Add a canonical file-to-SDK helper and give canonical and legacy origins
  different deterministic part-ID prefixes containing the tool call ID.
  `toSDKTool()` must:
  1. collect canonical files in content order;
  2. collect legacy `state.attachments`;
  3. remove only occurrence-matched legacy shadows using URL, MIME, filename;
  4. emit canonical files first and unmatched legacy files second;
  5. record every emitted part ID in `toolAttachments`.

  Use a counted fingerprint map, not a `Set`, so two intentional identical
  canonical files remain two files.

- [ ] **Step 5: Reconstruct text, canonical files, and legacy compatibility**

  In `fromSDKTool()`:
  - return the original completed state unchanged when output and attachment
    semantics are unchanged;
  - reuse an unchanged canonical origin object byte-for-byte;
  - rebuild a changed canonical origin or new SDK file as a generic canonical
    file with no provenance;
  - honor SDK attachment deletion;
  - retain unchanged legacy-origin entries in legacy `state.attachments`, but
    also project them once into canonical file content for provider replay;
  - insert reordered/rebuilt files at the first original file position, or
    after text when the original had no file;
  - apply the approved single-text and multi-text rules;
  - preserve `result`, `outputPaths`, timing, provider metadata, and structured
    output exactly.

  Change `fromPluginMessages()` to accept `PluginMessageOrigins` and use
  `origins.messages` for user and assistant reconstruction.

- [ ] **Step 6: Add registry and round-trip coverage without running it**

  Extend `session-runner-tool-registry.test.ts` with:
  - unchanged after hook;
  - single provenance text mutation;
  - multi-text mutation;
  - media-only result changed to a string.

  Extend `session-runner-message.test.ts` with:
  - no-hook full round trip;
  - unchanged hook;
  - canonical and legacy duplicate;
  - two intentional identical canonical files;
  - attachment add/change/delete/reorder;
  - one text resource plus two file resources.

  Assert exact canonical content, provenance, and zero duplicate provider
  files after `toPluginMessages -> fromPluginMessages -> toLLMMessages`.

- [ ] **Step 7: Perform the Task 3 static gate**

  Review both compatibility boundaries independently. Reject the slice if a
  changed string can remove media, if a changed SDK file inherits provenance,
  or if no-hook projection reconstructs content instead of reusing it.

### Task 4: Add Transient Tool-Result Materialization

**Files:**

- Modify: `packages/core/src/session/attachment.ts`
- Create: `packages/core/src/session/runner/tool-result-preparation.ts`
- Modify: `packages/core/src/session/runner/llm.ts`
- Modify: `packages/core/test/lib/location-service-map.ts`
- Modify: `packages/core/test/session-attachment.test.ts`
- Create: `packages/core/test/session-runner-tool-result-preparation.test.ts`
- Modify: `packages/core/test/session-runner.test.ts`

**Interfaces:**

- Consumes: `SessionAttachment.Service`, canonical LLM `Message`,
  `ToolResultPart`, and the runner's provider-attempt boundary.
- Produces: `SessionAttachment.materializeFile(file)`,
  `SessionRunnerToolResultPreparation.prepare(messages)`, transient
  data-URI/text tool results, and non-retryable preparation failures.

- [ ] **Step 1: Capture all existing Task 4 files**

  Store baselines under
  `.superpowers/sdd/phase8-mcp-task-4-baseline/` and create absent markers for
  the two new files.

- [ ] **Step 2: Expose one attachment materialization unit**

  Extend `SessionAttachment.Interface`:

  ```ts
  export interface Interface {
    readonly materializeFile: (file: FileAttachment) => Effect.Effect<FileAttachment>
    readonly materialize: (prompt: Prompt) => Effect.Effect<Prompt>
  }
  ```

  Return the existing internal `one` function as `materializeFile`. Rewrite
  `materialize(prompt)` to call the public field's shared implementation, not
  a copied branch. Update the location-service-map fake with an identity
  `materializeFile`.

- [ ] **Step 3: Create provider-bound preparation**

  In `tool-result-preparation.ts`, export:

  ```ts
  export const prepare = Effect.fn("SessionRunnerToolResultPreparation.prepare")(function* (
    messages: ReadonlyArray<Message>,
  ) {
    const attachments = yield* SessionAttachment.Service
    return yield* Effect.forEach(messages, (message) => prepareMessage(message, attachments))
  })

  export * as SessionRunnerToolResultPreparation from "./tool-result-preparation"
  ```

  Traverse only `tool-result` parts with `result.type === "content"`. Keep
  text and `data:` files untouched. For each non-data file, call
  `materializeFile({ uri, mime, name })` without translating MCP provenance
  into `FileAttachment.resource`, so historical output is never re-read from
  MCP.

  Map materialized text to canonical text and materialized media to canonical
  file content. Carry the original provenance to a materialized replacement.
  Convert the first materialized error into:

  ```ts
  new LLMError({
    module: "SessionRunnerToolResultPreparation",
    method: "prepare",
    reason: new InvalidRequestReason({
      message: `Unable to prepare tool result ${safeLabel}: ${error.message}`,
    }),
  })
  ```

  The safe label must use `SessionAttachment.attachmentLabel()` and must not
  contain URL query or fragment data.

- [ ] **Step 4: Place preparation inside the durable attempt**

  Keep compaction and raw request assembly before
  `ProviderAttempt.Started`. After that event is committed and immediately
  before the single `llm.stream(...)` call:

  ```ts
  const prepared = yield * SessionRunnerToolResultPreparation.prepare(request.messages)
  const providerRequest = new LLMRequest({ ...request, messages: prepared })
  ```

  Feed `providerRequest` to the stream. A preparation `InvalidRequest` must
  pass through the existing failed-attempt path with no retry and no provider
  I/O. Add `SessionAttachment.node` to runner dependencies.

- [ ] **Step 5: Add unit and full-runner coverage without running it**

  Extend `session-attachment.test.ts` to prove `materializeFile` and prompt
  materialization share the same local, remote, data, MIME, UTF-8, and 20 MiB
  rules.

  In the new preparation test, cover:
  - `file:` text;
  - `file:` image/PDF;
  - bounded HTTP(S) text/media;
  - preserved provenance;
  - data URI identity;
  - invalid URI, unsupported scheme/MIME, read failure, and oversize;
  - original `SessionMessage` and pre-preparation LLM messages remain equal to
    captured copies.

  Extend `session-runner.test.ts` with a preparation failure that records
  `ProviderAttempt.Ended(outcome: "failed")`, performs zero provider requests,
  and does not retry.

- [ ] **Step 6: Perform the Task 4 static gate**

  Confirm there is one filesystem/HTTP/base64 safety implementation, no
  durable mutation, no MCP re-fetch, and one explicit `llm.stream` call only
  after preparation succeeds.

### Task 5: Implement OpenAI Provider Fallback

**Files:**

- Modify: `packages/llm/src/protocols/shared.ts`
- Modify: `packages/llm/src/protocols/openai-responses.ts`
- Modify: `packages/llm/src/protocols/openai-chat.ts`
- Modify: `packages/llm/test/provider/openai-responses.test.ts`
- Modify: `packages/llm/test/provider/openai-chat.test.ts`

**Interfaces:**

- Consumes: materialized canonical tool files and shared media validation.
- Produces: a shared content partition helper, native OpenAI Responses image
  output, PDF `input_file` fallback, OpenAI Chat image fallback, and explicit
  unsupported-MIME errors.

- [ ] **Step 1: Capture the OpenAI protocol files**

  Store baselines under
  `.superpowers/sdd/phase8-mcp-task-5-baseline/`.

- [ ] **Step 2: Add a route-owned partition helper**

  In `shared.ts`, add a pure helper that preserves order:

  ```ts
  export const partitionToolContent = (
    content: ReadonlyArray<ToolContent>,
    supportsToolFile: (file: ToolFileContent) => boolean,
    supportsUserFile: (file: ToolFileContent) => boolean,
  ) => ({
    tool: content.filter((item) => item.type === "text" || supportsToolFile(item)),
    user: content.filter(
      (item): item is ToolFileContent => item.type === "file" && !supportsToolFile(item) && supportsUserFile(item),
    ),
    unsupported: content.filter(
      (item): item is ToolFileContent => item.type === "file" && !supportsToolFile(item) && !supportsUserFile(item),
    ),
  })
  ```

  Provider files retain control over the predicates and wire shapes.

- [ ] **Step 3: Add OpenAI Responses PDF user content**

  Define `OpenAIResponsesInputFile` and include it only in user input content:

  ```ts
  const OpenAIResponsesInputFile = Schema.Struct({
    type: Schema.tag("input_file"),
    filename: Schema.String,
    file_data: Schema.String,
  })
  ```

  Images remain valid in both tool output and user content. PDF is invalid in
  function-call output but valid as `input_file`. Validate PDF bytes with the
  shared 20 MiB media validator, retain tool-result text, emit the
  `function_call_output`, then emit one user input item containing fallback
  files at the first route-legal following position. Any other file MIME
  returns `ProviderShared.invalidRequest()` before transport preparation.

- [ ] **Step 4: Tighten OpenAI Chat fallback order**

  Preserve one string tool response containing all text. Validate image files
  with the existing image MIME set and queue them as user `image_url` content.
  Flush fallback content at the first legal position after the contiguous
  tool-result group, before the next assistant/user/system message. Reject
  PDF, audio, video, and unknown MIME explicitly because OpenAI Chat has no
  matching user file shape in this route.

- [ ] **Step 5: Add OpenAI protocol coverage without running it**

  OpenAI Responses assertions:
  - image stays inside `function_call_output`;
  - PDF becomes the next user `input_file`;
  - text remains in the function output;
  - two PDFs preserve order and share one user item;
  - unsupported audio returns `LLMError.InvalidRequest`;
  - provenance is absent from the wire body.

  OpenAI Chat assertions:
  - tool output remains text-only;
  - images become following user content;
  - consecutive tool results remain a valid contiguous group;
  - unsupported PDF fails before the recorder sees an HTTP request.

- [ ] **Step 6: Perform the Task 5 static gate**

  Verify every media branch validates bytes and MIME, no provider body contains
  provenance, and no file is dropped from both the tool and fallback arrays.

### Task 6: Implement Anthropic, Gemini, and Bedrock Fallback

**Files:**

- Modify: `packages/llm/src/protocols/anthropic-messages.ts`
- Modify: `packages/llm/src/protocols/gemini.ts`
- Modify: `packages/llm/src/protocols/bedrock-converse.ts`
- Modify: `packages/llm/test/provider/anthropic-messages.test.ts`
- Modify: `packages/llm/test/provider/gemini.test.ts`
- Modify: `packages/llm/test/provider/bedrock-converse.test.ts`

**Interfaces:**

- Consumes: Task 5 `ProviderShared.partitionToolContent`, media validation,
  `BedrockMedia.lower()`, and canonical tool result content.
- Produces: route-correct native media, synthetic user fallback, and explicit
  unsupported-MIME failure for all remaining native protocols.

- [ ] **Step 1: Capture the three protocol and test files**

  Store baselines under
  `.superpowers/sdd/phase8-mcp-task-6-baseline/`.

- [ ] **Step 2: Add Anthropic PDF user documents**

  Add an Anthropic document block accepted only in normal user content:

  ```ts
  const AnthropicDocumentBlock = Schema.Struct({
    type: Schema.tag("document"),
    source: Schema.Struct({
      type: Schema.tag("base64"),
      media_type: Schema.Literal("application/pdf"),
      data: Schema.String,
    }),
  })
  ```

  Keep image files native in `tool_result.content`. Partition PDFs into one
  following user message containing document blocks. Reject audio, video, and
  unknown files. Preserve the provider-required grouping of all local tool
  results before inserting the fallback user message.

- [ ] **Step 3: Separate Gemini function responses from fallback media**

  Gemini tool results remain `functionResponse` parts. All MIME values in
  `ProviderShared.MEDIA_MIMES` are valid user `inlineData`, not function
  response data. Emit the function-response content first and one following
  user content entry containing ordered fallback media. Reject PDF and unknown
  MIME because this route's user media set does not admit them.

- [ ] **Step 4: Move Bedrock documents out of tool results**

  Keep image blocks inside `toolResult.content`. When `BedrockMedia.lower()`
  yields a document block, keep text/image tool content in the original
  tool-result message and emit ordered documents in the next user message.
  If `BedrockMedia.lower()` rejects the MIME, propagate its
  `LLMError.InvalidRequest` unchanged.

- [ ] **Step 5: Add remaining protocol coverage without running it**

  For each route, assert:
  - native image position;
  - supported user fallback position and stable order;
  - text stays associated with the original tool result;
  - multiple consecutive tool results retain provider-valid ordering;
  - fully unsupported MIME is an `InvalidRequest`;
  - no provenance or MCP metadata appears in the provider body.

  Include Anthropic PDF, Gemini audio/video, and Bedrock PDF/document cases so
  each capability difference is explicit rather than inferred.

- [ ] **Step 6: Perform the Task 6 static gate**

  Compare the capability predicates with the actual wire schemas. Reject any
  branch where the predicate claims support for a block absent from that
  route's request schema.

### Task 7: Register Canonical MCP Resource Helpers

**Files:**

- Create: `packages/core/src/mcp/resource-tools.ts`
- Modify: `packages/core/src/mcp/runtime.ts`
- Create: `packages/core/test/mcp-resource-tools.test.ts`
- Modify: `packages/core/test/mcp-runtime.test.ts`

**Interfaces:**

- Consumes: `MCP.Service`, `PermissionV2.Service`, `Tools.Service`,
  Task 2 `McpCatalog.projectResult()`, and existing `McpEvent.ToolsChanged`
  synchronization.
- Produces: `McpResourceTools.catalog()`, exact V1 helper names, V2 read
  permissions, stable list outputs, and canonical read-resource settlement.

- [ ] **Step 1: Capture runtime/test baselines and mark new files absent**

  Store baselines under
  `.superpowers/sdd/phase8-mcp-task-7-baseline/`.

- [ ] **Step 2: Define names, schemas, and catalog API**

  In `resource-tools.ts`, export:

  ```ts
  export const list = "list_mcp_resources"
  export const listTemplates = "list_mcp_resource_templates"
  export const read = "read_mcp_resource"

  const ListInput = Schema.Struct({ server: Schema.optional(Schema.String) })
  const ReadInput = Schema.Struct({ server: Schema.String, uri: Schema.String })

  export const catalog = Effect.fn("McpResourceTools.catalog")(function* () {
    const mcp = yield* MCP.Service
    const permission = yield* PermissionV2.Service
    const clients = yield* mcp.clients()
    const servers = resourceServers(clients)
    if (servers.length === 0) return {}
    return {
      [list]: makeListResources(mcp, permission, servers),
      [listTemplates]: makeListTemplates(mcp, permission, servers),
      [read]: makeReadResource(mcp, permission, servers),
    } satisfies Readonly<Record<string, Tool.AnyTool>>
  })

  export * as McpResourceTools from "./resource-tools"
  ```

  `resourceServers()` filters connected clients by advertised resource
  capability and sorts server names.

- [ ] **Step 3: Implement list helpers**

  Each list executor:
  1. validates an explicitly requested server against `resourceServers`;
  2. asserts V2 `read` permission against one `mcp:<server>:*` resource per
     selected server;
  3. calls `mcp.resources(server?)` or `mcp.resourceTemplates(server?)`;
  4. removes the internal `client` field and adds exact `server`;
  5. sorts by server, name, then URI/URI template;
  6. returns `{ resources }` or `{ resourceTemplates }`;
  7. projects `JSON.stringify(output, null, 2)` as canonical text.

  Build permission sources as:

  ```ts
  const source = {
    type: "tool" as const,
    messageID: context.assistantMessageID,
    callID: context.toolCallID,
  }
  ```

- [ ] **Step 4: Implement exact read and sanitized contents**

  Validate server connection/capability before permission. Assert:

  ```ts
  yield *
    permission.assert({
      action: "read",
      resources: [`mcp:${input.server}:${input.uri}`],
      save: [`mcp:${input.server}:*`],
      metadata: { server: input.server, uri: input.uri },
      sessionID: context.sessionID,
      agent: context.agent,
      source,
    })
  ```

  Call `mcp.readResource(input.server, input.uri)`. Wrap returned
  `ResourceContents` values into embedded-resource contributions, pass them
  through the shared Task 2 projector with server and result `_meta`, and
  return:

  ```ts
  {
    server: input.server,
    uri: input.uri,
    contents: projection.contents,
    content: projection.content,
  }
  ```

  The output codec includes structured fields plus internal canonical content;
  `toStructuredOutput` omits the internal `content`, and `toModelOutput`
  returns it. Text display includes `Resource: <uri>` and `MIME: <mime>`.

  Translate expected disconnected/capability/read/empty-content failures to
  `ToolFailure`. Let interactive permission rejection and Effect interruption
  retain their canonical causes.

- [ ] **Step 5: Merge helper registration into the existing MCP sync scope**

  In `runtime.ts`, build one scoped catalog per sync:

  ```ts
  const catalog = {
    ...Object.fromEntries(
      Object.entries(yield * mcp.tools()).map(([name, entry]) => [name, McpCatalog.toCoreTool(entry)]),
    ),
    ...(yield * McpResourceTools.catalog()),
  }
  ```

  Add `PermissionV2.node` to `toolsNode` dependencies. Keep one child scope and
  the existing `ToolsChanged` subscription so disconnect removes helpers when
  the final resource server disappears.

- [ ] **Step 6: Add helper coverage without running it**

  In `mcp-resource-tools.test.ts`, cover:
  - exact names and empty catalog without resource servers;
  - cross-server and filtered list sorting;
  - every list/template descriptor field;
  - permission resources, metadata, source, and save patterns;
  - exact read URI passed to the selected client;
  - ordered text/blob projection and provenance;
  - invalid base64, unsupported MIME, oversized blob, empty content;
  - disconnected server, missing capability, read failure, deterministic deny,
    and interactive rejection.

  Extend `mcp-runtime.test.ts` to prove helper registration appears and
  disappears in the same scoped sync lifecycle as connection changes.

- [ ] **Step 7: Perform the Task 7 static gate**

  Confirm helpers use no V1 Session, permission, attachment, plugin, or
  truncation imports. Confirm the registry remains the only hook, settlement,
  stale-call, and generic-bounding owner.

### Task 8: Integrate, Generate Public Clients, and Run the Phase Gate

**Files:**

- Modify: `packages/core/test/session-runner.test.ts`
- Modify: `packages/schema/test/compatibility.test.ts`
- Regenerate: `packages/client/src/generated/**`
- Regenerate: `packages/client/src/generated-effect/**`
- Regenerate: `packages/sdk/js/src/gen/**`
- Regenerate: `packages/sdk/js/src/v2/gen/**`
- Modify after successful gate: `specs/v2/session.md`
- Modify after successful gate: `.superpowers/sdd/progress.md`
- Create: `.superpowers/sdd/phase8-mcp-resource-provenance-report.md`

**Interfaces:**

- Consumes: every preceding task and all earlier completed Phase 8 slices.
- Produces: end-to-end durable coverage, regenerated public types, complete
  Phase 8 verification evidence, and final ledger/report status.

- [ ] **Step 1: Add the full durable replay scenario before executing tests**

  Extend `session-runner.test.ts` with a local fake MCP tool that returns:
  - one text resource;
  - one image blob resource;
  - one resource link;
  - result/content/resource `_meta`;
  - annotations.

  Drive:

  ```text
  first provider tool call
    -> Core settlement
    -> Session event/message projection
    -> database reload
    -> plugin message no-op round trip
    -> transient preparation
    -> second captured provider request
  ```

  Assert durable history retains original canonical provenance and the second
  provider request contains text/media exactly once. Do not call
  `toLLMMessages()` directly in this test.

- [ ] **Step 2: Add public compatibility assertions**

  Extend `packages/schema/test/compatibility.test.ts` with an encoded Session
  message carrying provenance. Assert old payloads decode and new payloads
  retain all fields.

- [ ] **Step 3: Regenerate both public client surfaces**

  From `packages/client`:

  ```powershell
  bun run generate
  ```

  Expected: exit code 0 and generated Promise/Effect types expose optional MCP
  provenance on tool text/file content.

  From `packages/sdk/js`:

  ```powershell
  bun run build
  ```

  Expected: exit code 0 and both legacy and V2 generated SDK trees compile.

- [ ] **Step 4: Run targeted affected tests from package directories**

  From `packages/schema`:

  ```powershell
  bun test test/llm.test.ts test/compatibility.test.ts
  ```

  From `packages/llm`:

  ```powershell
  bun test test/provider/openai-responses.test.ts test/provider/openai-chat.test.ts test/provider/anthropic-messages.test.ts test/provider/gemini.test.ts test/provider/bedrock-converse.test.ts
  ```

  From `packages/core`:

  ```powershell
  bun test test/mcp-catalog.test.ts test/mcp-resource-tools.test.ts test/mcp-runtime.test.ts test/session-attachment.test.ts test/session-runner-tool-result-preparation.test.ts test/session-runner-message.test.ts test/session-runner-tool-registry.test.ts test/session-runner.test.ts
  ```

  From `packages/opencode`:

  ```powershell
  bun test test/tool/plugin-compat-v2.test.ts test/mcp/session-recovery.test.ts test/acp
  ```

  Expected for every command: exit code 0, zero failed tests. Diagnose and fix
  any regression, then restart this targeted-test step from the first package.

- [ ] **Step 5: Run complete affected package suites**

  Run `bun test` separately from:

  ```text
  packages/schema
  packages/llm
  packages/core
  packages/opencode
  packages/sdk/js
  packages/client
  ```

  Expected: exit code 0 for each package. Record test counts and duration in
  the report. If a verified pre-existing baseline failure exists, record its
  exact command, failure text, and why the changed files cannot cause it; do
  not label the Phase fully passing.

- [ ] **Step 6: Run package-local typechecks**

  Run `bun typecheck` separately from:

  ```text
  packages/schema
  packages/llm
  packages/core
  packages/protocol
  packages/server
  packages/client
  packages/sdk/js
  packages/opencode
  ```

  Expected: exit code 0 in every package.

- [ ] **Step 7: Run lint and formatting checks**

  From the repository root:

  ```powershell
  bun run lint
  ```

  Then run Prettier in check mode over every manually changed source, test,
  spec, and plan file:

  ```powershell
  bun prettier --check packages/schema/src/llm.ts packages/core/src/tool/tool.ts packages/core/src/mcp/catalog.ts packages/core/src/mcp/resource-tools.ts packages/core/src/mcp/runtime.ts packages/core/src/session/attachment.ts packages/core/src/session/runner/tool-result-preparation.ts packages/core/src/session/runner/to-llm-message.ts packages/core/src/session/runner/llm.ts packages/core/src/tool/registry.ts packages/llm/src/protocols/shared.ts packages/llm/src/protocols/openai-responses.ts packages/llm/src/protocols/openai-chat.ts packages/llm/src/protocols/anthropic-messages.ts packages/llm/src/protocols/gemini.ts packages/llm/src/protocols/bedrock-converse.ts docs/superpowers/specs/2026-07-24-mcp-resource-provenance-design.md docs/superpowers/plans/2026-07-24-mcp-resource-provenance.md
  ```

  Expected: exit code 0 and no files requiring formatting.

- [ ] **Step 8: Run the complete OpenCode build**

  From `packages/opencode`:

  ```powershell
  bun run build
  ```

  Expected: exit code 0 and production artifacts complete.

- [ ] **Step 9: Perform final static review**

  Use task baselines and no-index diffs to review:
  - spec compliance;
  - schema ownership and dependency direction;
  - lossless persistence and no-hook round trip;
  - provider MIME matrices and request ordering;
  - no network I/O on unsupported MIME;
  - permission and interruption semantics;
  - generated public types;
  - absence of V1 imports in the new helper layer.

  Do not close Phase 8 with any Critical or Important finding.

- [ ] **Step 10: Update the parity spec, ledger, and report**

  After every required executable gate passes, update the provider-tool row in
  `specs/v2/session.md` from `partial` to `complete` and describe native plugin
  tools plus MCP resource helpers.

  Update `.superpowers/sdd/progress.md` with:
  - every Task 1-8 static review result;
  - exact test/typecheck/lint/build commands and outcomes;
  - generated-client status;
  - remaining migration-wide V1 deletion blockers.

  Write `.superpowers/sdd/phase8-mcp-resource-provenance-report.md` with the
  final evidence. Phase 8 is complete only when the full report has no
  unclassified failure and no Critical or Important finding.
