# Plugin and Config Tool Parity Design

**Status:** Proposed for implementation review  
**Baseline:** `opencode-fork` on the 1.18.3 source baseline  
**Scope:** Complete the remaining plugin/config tool contribution row in the V2 session parity table without changing the public plugin authoring API.

## Problem

Native V2 sessions materialize tools from Core's Location-scoped `ToolRegistry`. Shipped built-ins, MCP tools, and application registrations reach that registry, but tools contributed by `.opencode/{tool,tools}/*.{js,ts}` and legacy plugin `hooks.tool` currently exist only in the V1 host registry. A native V2 prompt can therefore advertise fewer tools than a V1 prompt in the same directory.

The migration must preserve the current plugin contract while keeping dependency direction intact: Core must not import `packages/opencode`, the legacy V1 registry, or `@opencode-ai/plugin`.

## Goals

- Discover the same config-file and plugin-hook tools, in the same order and with the same names, for V1 and V2.
- Register compatibility tools into the Core V2 Location registry with scoped cleanup.
- Preserve Zod and legacy JSON-schema-shaped inputs, including the missing/null `args` compatibility behavior.
- Preserve plugin execution context: Session, message, call, agent, directory, worktree, abort, metadata/progress, and permission requests.
- Preserve string and structured results, metadata, titles, and attachments.
- Keep Core's canonical settlement, plugin hooks, output bounding, stale-call protection, and permission filtering as the final execution boundary.
- Leave the V1 path active until all consumers have migrated and final deletion criteria are met.

## Non-goals

- Do not create or publish a new V2 plugin SDK in this slice.
- Do not register location-specific tools through process-global `ApplicationTools`.
- Do not migrate prompt, command, shell, TUI, ACP, app, daemon, serve, or worker consumers in this slice.
- Do not delete the V1 registry or plugin ABI.
- Do not add a second executable tool representation inside Core.

## Ownership and Dependency Boundaries

The compatibility implementation belongs in `packages/opencode/src/tool`, because that package already owns config discovery, legacy plugin loading, workspace/instance context, and the bridge from Promise callbacks into Effect.

Core continues to own only:

- the opaque `Tool.make(...)` representation;
- Location-scoped `Tools.Service.register(...)`;
- `PermissionV2.Service`;
- `ToolProgress.Service` and Event V2 publication;
- materialization, settlement, plugin before/after hooks, and output bounding.

The host adapter may import Core and `@opencode-ai/plugin`; Core must not import the host adapter or plugin package.

## Components

### 1. Shared plugin-tool discovery and schema compiler

Extract the existing custom-tool-specific logic from the V1 registry into a host module. It returns an ordered list of compiled contributions rather than either V1 or V2 executable values.

Each contribution contains:

- the effective tool name;
- description;
- the original plugin definition and execute callback;
- a runtime input decoder when all arguments are Zod types;
- the raw JSON Schema shown to the model.

Discovery retains current behavior:

1. scan every configured directory for `{tool,tools}/*.{js,ts}`;
2. wait for config dependencies before importing matches;
3. name a default export after the filename and named exports as `filename_export`;
4. ignore exports that are not plugin tool definitions;
5. append `hooks.tool` definitions returned by loaded plugins;
6. allow later definitions to win when names collide.

Missing or null `args` compiles as an empty object schema. All-Zod arguments retain Zod validation and descriptions. Mixed/legacy schema-shaped arguments retain the current wire JSON Schema and do not invent stronger runtime validation.

The V1 registry consumes this shared list to construct its existing `Tool.Def` values. The V2 adapter consumes the same list to construct canonical Core tools. Discovery is not duplicated.

### 2. Location-scoped compatibility registration service

Add an OpenCode host service with an `init()` operation backed by `InstanceState`. Project bootstrap calls it immediately after `Plugin.init()`, because plugin hooks must be loaded before their tool contributions can be collected.

For the current instance, initialization:

1. resolves the matching Core `Location` layer from `LocationServiceMap` using directory plus workspace identity;
2. discovers and compiles contributions;
3. constructs canonical `Tool.make(...)` values inside that Location context;
4. registers the final name-to-tool record through `Tools.Service.register(...)`.

The registration lives in the `InstanceState` lookup scope. Instance invalidation or disposal closes that scope, unregisters only those registrations, and reveals any older registration according to Core's existing stack semantics.

This preserves the current reload boundary: config/plugin tools are rebuilt when the V1 instance is invalidated or disposed. This slice does not introduce an independent hot-reload watcher.

### 3. Invocation context bridge

The adapter captures the Location services required by an executable tool and maps a Core invocation as follows:

| Plugin `ToolContext` field | V2 source |
|---|---|
| `sessionID` | `Tool.Context.sessionID` |
| `messageID` | `Tool.Context.assistantMessageID` |
| `callID` | `Tool.Context.toolCallID` |
| `agent` | `Tool.Context.agent` |
| `directory` | active `Location.directory` / instance directory |
| `worktree` | active instance worktree |
| `abort` | AbortSignal owned by the interruptible plugin invocation |
| `metadata(...)` | non-blocking `ToolProgress.publish(...)` with title/metadata in structured progress |
| `ask(...)` | Promise bridge to `PermissionV2.Service.assert(...)` |

Permission mapping is exact at the vocabulary boundary:

- `permission` becomes `action`;
- `patterns` become `resources`;
- `always` becomes `save`;
- plugin metadata is retained;
- source is `{ type: "tool", messageID, callID }`;
- Session and agent IDs come from the canonical invocation context.

Canonical denial, correction, reply, saved-permission, and interruption behavior remains owned by `PermissionV2`; the adapter does not maintain a second pending-permission map.

Plugin execution is wrapped in an interruptible Effect/Promise boundary. Interrupting settlement aborts the supplied signal and waits for the callback boundary to settle. Ordinary plugin exceptions become a model-visible `ToolFailure`; canonical permission/interruption causes must not be flattened into a normal plugin error.

### 4. Result projection

The adapter normalizes both supported plugin results:

- a string becomes text content with empty structured metadata;
- a structured result keeps `output`, optional `title`, optional `metadata`, and optional attachments.

The model-facing content begins with the textual output. Attachments become canonical file content while retaining their URI, MIME type, and optional filename. Core's generic `Tool.Content` projection must accept an already-formed URI as well as the existing base64-data convenience form; this is a generic canonical capability, not a plugin-specific registry bypass.

Structured output contains plugin metadata and includes `title` when provided. Attachment descriptors may remain in the encoded execution result for observability, while the canonical file content is what reaches provider lowering.

The adapter must not call the legacy truncation service. Complete plugin output reaches Core settlement, and `ToolOutputStore.bound(...)` remains the only generic model-output bounding and managed-output-path owner for native V2 execution.

### 5. Precedence and hooks

- Location compatibility registrations override process-global application tools.
- A compatibility tool registered after shipped Location built-ins overrides the same name, matching current V1 custom-tool behavior.
- Later config/plugin contributions with the same name win deterministically.
- Core `PluginRuntime` definition, before-execute, and after-execute hooks continue to run once at materialization/settlement. The adapter does not invoke those hooks itself.
- A materialized call retains Core's advertised-registration identity check, so reloads produce a stale-tool result instead of accidentally invoking a replacement definition.

## Error Handling

- Invalid tool names fail registration through Core's existing `Tool.RegistrationError`.
- Zod validation failures become `ToolFailure` with the current plugin validation detail.
- Import/discovery failure behavior remains the same as the current V1 registry; this slice does not silently skip failures that currently abort initialization.
- Ordinary rejected plugin callbacks become `ToolFailure` with a stable message and do not crash the whole Session drain.
- Permission denial/correction and interruption preserve their canonical causes.
- Invalid plugin result shapes or attachment projections fail loudly as `ToolFailure`; no attachment or metadata is silently discarded.

## Bootstrap and Compatibility Sequence

Project bootstrap becomes:

1. load config;
2. initialize plugins and publish their V2 hook adapters;
3. initialize plugin/config tool compatibility registrations;
4. initialize the remaining project services concurrently as today.

V1 requests continue to read the V1 registry. V2 requests read Core `ToolRegistry`. Both are backed by the same discovered contribution list for the life of the instance.

## Phase-Boundary Verification Strategy

Per the project owner's direction, implementation is not test-driven and no test or typecheck command runs between the remaining Phase 8 slices. Test coverage may be authored with the implementation, but execution is deferred until the complete Phase 8 implementation reaches its verification gate. The final verification must operate through the real Location registry rather than a parallel fake registry.

Required cases:

1. a `.opencode/tools` default export appears in V1 and V2 with the same name, description, and JSON Schema;
2. named exports and `.opencode/tool` singular-directory discovery retain current naming;
3. plugin `hooks.tool` contributions appear in V2;
4. null/undefined `args` produces the empty object schema;
5. Zod descriptions and invalid-input failures are preserved;
6. legacy JSON-schema-shaped args retain their wire schema;
7. later contributions override earlier ones deterministically;
8. directory/worktree/Session/message/call/agent context values reach the plugin callback;
9. permission requests appear in `PermissionV2`, accept replies, and preserve save resources;
10. interruption aborts the plugin signal;
11. metadata emits native progress without invoking a legacy event path;
12. string, structured, title, metadata, and attachment results settle through Core correctly;
13. instance disposal removes the compatibility registration and exposes the previous registration;
14. Core before/after plugin hooks run exactly once;
15. existing V1 registry tests remain green.

At the Phase 8 verification gate, commands run from package directories and include OpenCode typecheck, affected OpenCode tests, affected Core tool tests when `Tool.Content` changes, the existing plugin-runtime/tool-registry suites, the remaining Phase 8 consumer suites, build verification, and the planned manual flows.

## Rollout and Deletion Gate

After the Phase 8 verification gate passes, update the V2 session parity table from `partial` to `complete` for plugin/config tool contributions. Implementing the adapter alone does not authorize deleting V1.

The compatibility discovery module can remain after the V1 application registry is removed because it implements the supported legacy plugin ABI at the host boundary. Deleting the V1 registry later removes its consumer of the shared compiled list, not the V2 registration service.

## Rejected Alternatives

- **Process-global `ApplicationTools` registration:** incorrect for directory/workspace-specific configuration and scoped cleanup.
- **Core importing the V1 registry or plugin package:** violates dependency direction and prevents final V1 deletion.
- **Calling the V1 executable `Tool.Def` from V2:** double-applies legacy truncation, retains V1 permission/session dependencies, and makes deletion impossible.
- **A new public V2 plugin SDK in this slice:** expands the migration surface without fixing compatibility for existing plugins.
- **Duplicated V1 and V2 discovery:** invites name, schema, reload, and ordering drift.
