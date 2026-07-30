# MCP Resource Provenance and V2 Helper Parity Design

**Status:** Proposed for implementation review  
**Baseline:** `opencode-fork` on the 1.18.3 source baseline  
**Scope:** Complete the Phase 8 MCP resource provenance, provider replay, and resource-helper parity slice for native V2 Sessions.

## Problem

Native V2 MCP tool output crosses two independent lossy boundaries.

First, `McpCatalog.project()` reduces MCP content blocks to generic text and
file content before canonical settlement. The current shared `ToolContent`
schema has no machine-readable provenance carrier, so embedded-resource and
resource-link identity does not survive. Exact server, URI, MIME, name,
description, size, annotations, and MCP metadata are lost.

Second, every provider turn performs a legacy plugin-message round trip.
`toSDKTool()` exposes only canonical tool text plus legacy attachments, and
`fromSDKTool()` rebuilds canonical tool content as one text item. Canonical
files and any provenance attached to them are therefore discarded before
provider lowering even when no plugin changes the message.

Repairing those boundaries exposes two separate parity requirements:

- non-data canonical tool files must be materialized safely for the outgoing
  provider request without changing durable history;
- native V2 must register the V1 MCP resource helper tools
  `list_mcp_resources`, `list_mcp_resource_templates`, and
  `read_mcp_resource`.

The Session event, message, database, and `ToolOutputStore` paths already
preserve every field admitted by the shared schema. They are not separate
repair targets.

## Goals

- Preserve typed MCP resource and resource-link provenance through canonical
  settlement, durable Session storage, reload, and plugin-message transforms.
- Preserve resource annotations and MCP `_meta` as opaque JSON metadata.
- Keep generic MCP image and audio output generic; do not claim resource
  provenance for content that is not an embedded resource or resource link.
- Preserve canonical content when plugin hooks do not modify it.
- Define non-destructive text and attachment mutation semantics for legacy
  hooks.
- Materialize non-data canonical tool file URIs only in a transient provider
  request copy under the existing attachment safety policy.
- Move media unsupported in tool results into immediately following user
  content when the provider supports that MIME there.
- Fail explicitly before provider I/O when materialization or MIME lowering is
  impossible.
- Register the three MCP resource helpers through the canonical V2 tool
  registry with V2 permissions, settlement, hooks, and bounding.
- Complete one Phase 8 verification gate after implementation, including the
  earlier ACP, event-recovery, and plugin-compatibility slices.

## Non-goals

- Do not update or merge the 1.18.4 source baseline in this slice.
- Do not add a dedicated MCP Session content union or a sidecar provenance
  store.
- Do not add a second executable tool representation or settlement path.
- Do not make provider wire formats carry MCP annotations, `_meta`, or server
  identity.
- Do not mutate durable history with materialized bytes or provider-specific
  fallback messages.
- Do not dereference an MCP `resource_link` implicitly.
- Do not delete V1 resource helpers or the retained V1 Session path in this
  slice.
- Do not redesign MCP subscriptions, resource caching, or clustered Session
  ownership.

## Ownership

The shared encoded contract belongs to `packages/schema/src/llm.ts`.
`@opencode-ai/llm`, Core tools, Session events, and Session messages consume
that one schema.

Core MCP owns extraction of MCP identity and metadata. Core Session owns
plugin-message compatibility and transient request preparation. Provider
protocols own MIME capability and wire lowering. A Location-scoped Core MCP
resource-tool layer owns explicit list/read helper registration.

Core `ToolRegistry.Materialization.settle` remains the only generic execution
and output-bounding boundary.

## Canonical Provenance Contract

Add one optional `provenance` property to both existing tool text and file
content variants:

```ts
type McpProvenance = {
  readonly type: "mcp"
  readonly clientName: string
  readonly uri: string
  readonly kind: "resource" | "resource_link"
  readonly mime?: string
  readonly name?: string
  readonly description?: string
  readonly size?: number
  readonly annotations?: Record<string, unknown>
  readonly meta?: Record<string, unknown>
}
```

This is additive. Existing content without `provenance` remains valid and
encodes unchanged. `meta` preserves MCP `_meta` payloads without interpreting
their keys. Preserve each applicable source as a distinct opaque subtree:
`meta.result` for `CallToolResult._meta`, `meta.content` for the content
block's `_meta`, and `meta.resource` for embedded resource-body `_meta`. Omit
absent subtrees and never merge their keys.

The carrier is valid only for an actual embedded resource or resource link.
Generic MCP text, image, and audio blocks do not receive fabricated resource
identity. Their presentation remains ordinary canonical text or file content.

MCP projection is:

| MCP contribution | Canonical presentation                      |
| ---------------- | ------------------------------------------- |
| Text             | Generic text                                |
| Image or audio   | Generic data-URI file                       |
| Text resource    | Text plus resource provenance               |
| Blob resource    | Data-URI file plus resource provenance      |
| Resource link    | Readable text plus resource-link provenance |

Exact `clientName` and URI come from the MCP catalog entry and content block.
Optional fields preserve the MCP values rather than derived labels. A derived
filename may still be used for display, but it is not resource identity.

`structuredContent` remains server-controlled structured output. Provenance
must not be hidden in or reconstructed from it.

## MCP Producer Projection

`McpCatalog.toCoreTool()` passes the catalog entry's `clientName` into a shared
MCP content projector. Dynamic MCP tools and `read_mcp_resource` use the same
projector so the two paths cannot drift.

Projection preserves contribution order. Valid sibling content survives when
one binary contribution is invalid. Invalid base64, an over-limit blob, or a
binary MIME rejected by the producer policy becomes an explicit diagnostic
text contribution carrying the resource provenance. Invalid or oversized
binary bytes are not persisted.

Generic image and audio blocks keep their generic MIME and data. They do not
acquire `kind: "resource"` solely because they came from an MCP server.

## Plugin-Message Round Trip

Each internal-to-SDK projection creates a request-local origin table. It
associates projected SDK tool attachments and text with their original
canonical content. The table is not persisted and is not exposed to plugins.

### Outbound projection

`toSDKTool()` projects:

- canonical text as the legacy string output;
- canonical files as SDK tool attachments;
- genuinely legacy `state.attachments` as SDK tool attachments.

Canonical files are emitted first. Legacy attachments are appended only when
they do not share an origin or stable file fingerprint with a canonical file.
The fallback fingerprint uses URL, MIME, and filename. Matching is
occurrence-aware rather than set-based, so two intentional identical
canonical files remain two files while one shadow legacy copy is removed.
Output order is stable.

### Reconstruction

Unchanged SDK attachments reuse their exact original canonical content.
Provenance, annotations, metadata, and original URI therefore survive.

A changed or newly added SDK file becomes a generic canonical file. It does
not inherit MCP provenance from an origin whose URL, MIME, filename, or
resource source changed.

Removing a projected attachment is an intentional plugin deletion. The
reconstructor does not restore it.

If the legacy output string is unchanged, reconstruction reuses the original
text content and part boundaries. If there is exactly one original text part
and the string changes, only that part's text changes and its provenance is
retained. If multiple original text parts are replaced by one string,
reconstruction creates one generic text part. In every case, non-text
canonical content remains in its original relative order unless the plugin
explicitly changes or removes its projected attachment.

The runner may continue to execute the unconditional plugin-message round
trip. The no-hook and unchanged-hook paths must be identity-preserving for
canonical tool content.

## `tool.execute.after` Semantics

A legacy `tool.execute.after` string mutation replaces textual content only.
It never removes canonical file content.

- One original text contribution: update its text and retain its provenance.
- Multiple original text contributions: replace them with one generic text
  contribution.
- No original text contribution: insert one generic text contribution at the
  textual output position.
- Preserve every non-text contribution and its provenance.

Attachment mutation follows the plugin-message rules above: unchanged origins
retain provenance; changed and new files are generic; deletion is honored.

## Provider Request Preparation

Request preparation is an effectful Core Session step after plugin transforms
and before provider lowering. It creates a transient copy of canonical LLM
history. Durable Session messages and database rows remain unchanged.

Preparation walks canonical files in tool results:

- data URIs remain canonical input for provider validation;
- non-data file URIs reuse the existing `SessionAttachment` local-file,
  HTTP(S), UTF-8, MIME, bounded-download, and size policies;
- textual materialization becomes transient text;
- allowed binary materialization becomes a transient data-URI file.

The materializer must expose a reusable per-file boundary rather than
duplicating filesystem, HTTP, base64, MIME, or size logic in the runner.

Embedded MCP blobs are already durable data URIs and are not re-read from the
server. Resource links remain readable text with provenance and are not
implicitly dereferenced.

Invalid URIs, unsupported schemes, read failures, MIME mismatches, malformed
data, and size violations fail request preparation explicitly. They do not
become `[Unavailable]` placeholders.

## Provider MIME Lowering

Each provider protocol declares or implements two distinct capabilities:

- MIME types accepted inside a tool result;
- MIME types accepted as user content.

Lowering follows this order:

1. Keep text in the original tool result.
2. Keep files supported natively by that route in the tool result.
3. For a file unsupported in tool results but supported as user content,
   remove it from the tool result and place it in one synthetic user message
   immediately after that tool result.
4. Preserve fallback file order and group files from the same tool result.
5. Fail before HTTP dispatch when the provider accepts the MIME in neither
   location.

This is a provider wire workaround only. The synthetic user message is not
written to durable history. Provenance, annotations, and MCP metadata remain
canonical data and are ignored by provider lowering by default.

## V2 MCP Resource Helpers

Add a Location-scoped MCP resource-tool contribution with the exact V1 names:

- `list_mcp_resources`
- `list_mcp_resource_templates`
- `read_mcp_resource`

The contribution is active only while at least one connected MCP server
advertises resource capability. It resynchronizes on the existing MCP
connection/tool-change event. Resource values are read live on each execution;
the tool layer does not add another resource cache.

The helper contribution is separate from each server's dynamic tool catalog.
It registers through `Tools.Service`, executes through `Tool.make`, and relies
on `ToolRegistry` for plugin hooks, stale-call checks, settlement, bounding,
and durable Session publication.

### List resources

Input is an optional `server` string. Omission lists every connected
resource-capable server. Output is:

```ts
{
  readonly resources: ReadonlyArray<ResourceDescriptor & { readonly server: string }>
}
```

Preserve every SDK descriptor field and add the exact server name. Sort by
server, name, and URI.

### List resource templates

Input is an optional `server` string. Output is:

```ts
{
  readonly resourceTemplates: ReadonlyArray<
    ResourceTemplateDescriptor & { readonly server: string }
  >
}
```

Preserve every SDK descriptor field and add the exact server name. Sort by
server, name, and URI template.

### Read resource

Input requires exact `server` and `uri` strings. Structured output preserves:

```ts
{
  readonly server: string
  readonly uri: string
  readonly contents: ReadonlyArray<
    ResourceContents | ResourceContentDiagnostic
  >
}
```

Model content preserves response order and uses the shared MCP content
projector. Text keeps the V1 visible URI and MIME context while also carrying
typed provenance. Blob content becomes a data-URI file with exact resource
provenance.

Valid text and blob entries remain exact SDK resource-content values.
Rejected binary entries are replaced at the same array position by a
diagnostic containing URI, MIME, and the precise rejection reason. Their
invalid or over-limit base64 payload is not copied into structured output.

The helpers return complete validated output. They do not call the legacy
truncation service or create V1 attachment parts.

### Permissions

All three helpers use the V2 `read` action.

- A server-specific list checks `mcp:<server>:*`.
- A cross-server list checks one `mcp:<server>:*` resource for each connected
  resource-capable server.
- A read checks `mcp:<server>:<exact-uri>`.
- A read offers `mcp:<server>:*` as its saved approval.

Permission source is the canonical tool source containing the assistant
message and call IDs. User rejection retains the existing Session
interruption behavior.

## Error Handling

### Tool failures

Disconnected servers, missing resource capability, permission policy failure,
read failure, and a response with no usable content become `ToolFailure`.
The existing tool runtime publishes durable tool failure and lets the model
self-correct without retrying a provider attempt.

Expected MCP and validation errors are translated narrowly. Interruption,
permission rejection, and defects retain their canonical causes.

For a multi-content response, a bad binary contribution becomes explicit
diagnostic text while valid siblings survive. If no usable or diagnostic
content can be produced, the complete tool call fails.

### Provider-request failures

Materialization, media validation, and unsupported provider MIME failures
become non-retryable `LLMError.InvalidRequest` values. Their messages identify
the route, tool/call context, safe resource label, and MIME. Remote query
strings or credentials are not included.

Failure happens before HTTP I/O, records a failed provider attempt, and does
not enter automatic retry. Durable canonical history remains unchanged.

No path silently drops content, returns an empty fallback, or converts a
request-preparation failure into a generic placeholder.

## End-to-End Data Flow

```text
MCP CallToolResult / explicit resource read
  -> shared MCP projector
  -> canonical ToolOutput with optional provenance
  -> ToolRegistry settlement and ToolOutputStore bounding
  -> durable Session event/message/database
  -> plugin SDK projection plus request-local origin table
  -> origin-aware canonical reconstruction
  -> transient URI materialization
  -> provider MIME lowering and optional user-content fallback
  -> provider request
```

Only the canonical content before transient preparation is durable.

## Phase 8 Verification Strategy

Per the project owner's direction, implementation is not test-driven. Coverage
is authored with production changes, but no test, typecheck, formatter, lint,
or build command runs until all Phase 8 implementation is complete.

### Required coverage

1. Shared schema and Session event/message encode-decode preserve provenance,
   annotations, and metadata exactly.
2. MCP catalog projection covers text resources, blob resources, resource
   links, generic image/audio, mixed content, `structuredContent`, and
   per-item binary diagnostics.
3. Plugin-message projection covers no hook, unchanged hook, text mutation,
   attachment add/change/delete, and legacy/canonical deduplication.
4. Request preparation covers data, file, HTTP(S), text, allowed media,
   malformed data, unsupported MIME, size limits, and fetch/read failure while
   proving durable history is unchanged.
5. OpenAI Responses, OpenAI Chat, Anthropic Messages, Gemini, and Bedrock
   Converse cover native tool media, immediate user fallback, ordering, and
   fully unsupported MIME failure.
6. Resource-helper coverage includes registration lifecycle, stable sorting,
   permissions, exact URI handling, ordered text/blob output, invalid base64,
   oversized blobs, disconnected servers, missing capability, and read
   failure.
7. A full Session runner case settles an MCP result, persists and reloads it,
   performs the plugin round trip, and captures the second provider request.
8. Existing Phase 8 ACP client facade, native event recovery, and
   plugin/config compatibility suites remain green.

Tests use real Effect layers, local fake MCP clients, and provider request
capture. They do not use global monkey-patching or external network access.

### Gate order

1. Regenerate `packages/client` artifacts because `ToolContent` is part of the
   public Session-message protocol.
2. Run targeted affected tests from their package directories.
3. Run complete suites in `packages/schema`, `packages/llm`, `packages/core`,
   and `packages/opencode`.
4. Run `bun typecheck` separately in `packages/schema`, `packages/llm`,
   `packages/core`, `packages/protocol`, `packages/server`, `packages/client`,
   and `packages/opencode`.
5. Run lint and formatter checks.
6. Run the complete `packages/opencode` build.
7. Perform final static review and update the Phase 8 progress ledger.

Any failure is classified as a regression from this slice or a verified
pre-existing baseline failure. The Phase cannot close on a partial pass.

## Completion Criteria

This Phase 8 slice is complete only when:

- all approved behavior above is implemented;
- the public client artifacts match the new schema;
- the complete Phase 8 gate passes or every external baseline blocker is
  documented with reproducible evidence;
- independent static review has no Critical or Important findings;
- the Phase 8 ledger records the final result.

Completion of this slice does not authorize removing V1. It supplies the
canonical behavior required for a later migration-wide deletion gate.

## Rejected Alternatives

- **Dedicated MCP content variants:** increase every Session and provider
  branch when optional provenance is sufficient.
- **A Session sidecar provenance table:** splits ordered content identity from
  the content it describes and creates another persistence owner.
- **Encoding identity in display text or filenames:** is lossy,
  non-machine-readable, and cannot preserve the server.
- **Storing provenance only in `structuredContent`:** conflicts with
  server-controlled schemas and loses ordered per-content association.
- **Re-fetching embedded resources during replay:** makes historical output
  depend on server availability and can change the content seen by the model.
- **Persisting materialized provider bytes:** bloats and mutates durable
  history with provider-specific preparation.
- **Dropping files unsupported in tool results:** silently removes model
  context when user-content fallback is available.
- **Registering helpers through process-global application tools:** violates
  Location and server lifecycle boundaries.
- **Calling V1 helper implementations from V2:** retains V1 Session,
  permission, attachment, and truncation dependencies and blocks eventual
  deletion.
