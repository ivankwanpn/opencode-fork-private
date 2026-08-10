# ACP Native Client Facade Design

**Status:** Approved for written-spec review  
**Baseline:** `opencode-fork` during Phase 8 of the V1-to-V2 migration  
**Scope:** Move ACP operations with native contracts to `/api` while retaining legacy dynamic MCP registration as one explicit fallback.

## Problem

The ACP command currently constructs only `@opencode-ai/sdk/v2` and passes that
legacy client through session lifecycle, prompt execution, transcript replay,
events, permissions, catalog loading, configuration, and MCP registration.
Phase 8 now has native contracts for every ACP dependency except dynamic MCP
`add`, but ACP cannot switch clients mechanically:

- native prompt and command endpoints durably admit a user input rather than
  returning the completed assistant message expected by ACP;
- native transcripts and events use canonical V2 shapes while ACP's service,
  event, tool, permission, and usage modules consume legacy-compatible shapes;
- the native permission reply requires a Session ID that the legacy reply call
  does not carry;
- catalog data is split across native provider, model, integration, agent,
  command, skill, and config endpoints;
- ACP must construct native and legacy clients with exactly the same base URL,
  headers, and fetch implementation.

Migrating calls directly inside `service.ts` would spread transport and
projection concerns across the ACP domain. Reusing
`cli/cmd/run/native-compat.ts` would couple ACP to a compatibility surface with
different completion semantics: `opencode run` consumes live output and may
return after admission, while ACP `session/prompt` must return a final
`PromptResponse`.

## Goals

- Route ACP session create/get/list/fork/interrupt, prompt, command, compact,
  transcript reads, individual message reads, events, permission replies,
  catalog reads, and config reads through the native `/api` client.
- Preserve ACP's existing response behavior, including final stop reason,
  usage, transcript replay, tool updates, permission prompts, and error
  classification.
- Give prompt and command one deterministic completion boundary:
  admit, wait for the Session to become idle, then read the mixed transcript.
- Keep dynamic MCP `add` as the only legacy SDK operation used by ACP.
- Construct both generated clients from one base URL, one header set, and one
  fetch function.
- Keep the facade ACP-specific and independent from the `opencode run`
  compatibility adapter.
- Preserve Phase 8's phase-boundary verification rule: author coverage with
  implementation, but do not run tests, typecheck, or build until the complete
  phase is ready for its gate.

## Non-goals

- Do not add a native dynamic MCP registration endpoint in this slice.
- Do not remove the legacy SDK package or other consumers of it.
- Do not change the public ACP protocol or its advertised capabilities.
- Do not change Session execution, admission, wait, transcript, or event
  contracts to accommodate ACP.
- Do not make ACP depend on Core or Server internals that bypass HTTP.
- Do not reuse or expand `cli/cmd/run/native-compat.ts`.
- Do not add a second event or transcript projection implementation when the
  existing shared projection helpers already express the required mapping.

## Ownership and File Boundaries

Add `packages/opencode/src/acp/client.ts` as the ACP transport and projection
boundary. It owns:

- construction of `@opencode-ai/client` and `@opencode-ai/sdk/v2`;
- native request selection and location mapping;
- ACP-specific prompt and command completion;
- native-to-legacy session, transcript, event, permission, and catalog
  projection;
- the single legacy MCP `add` fallback.

`packages/opencode/src/acp/service.ts`, `event.ts`, `permission.ts`, `usage.ts`,
and `agent.ts` consume the facade's narrow exported interface rather than
`OpencodeClient`. They continue to own ACP behavior such as local Session
state, JSON-RPC responses, command detection, replay notifications, edit
application, tool-call presentation, and usage notifications.

`packages/opencode/src/cli/cmd/acp.ts` creates one facade from the server URL
and `ServerAuth.headers()`. No ACP domain module constructs either generated
client independently.

The facade may reuse pure projections from:

- `@opencode-ai/tui/context/session-compat`;
- `@opencode-ai/tui/context/transcript-compat`;
- `@opencode-ai/tui/context/catalog-compat`;
- `packages/opencode/src/event-v2-bridge.ts`.

It must not import the `opencode run` adapter.

## Facade Shape

Export a narrow `ACPClient.Interface` containing only operations ACP uses:

- `session.create`, `get`, `list`, `messages`, `message`, `fork`,
  `interrupt`, `prompt`, `command`, and `compact`;
- `events.subscribe`;
- `permission.reply`;
- `catalog.load`;
- `config.get`;
- `mcp.add`.

The interface returns ACP/legacy-compatible domain values directly, not
generated-client response wrappers. This removes `data!` and
`throwOnError: true` handling from ACP services while keeping the current
legacy message, part, Session, provider, command, skill, and event shapes at
the ACP boundary.

The constructor accepts generated-client `baseUrl`, `headers`, and optional
`fetch`. It resolves one fetch function and passes that exact function and
header set to both clients. The legacy client is private and is referenced
only by `mcp.add`.

Tests may inject an `ACPClient.Interface` directly. Production construction is
the only place that creates both generated clients.

## Session Lifecycle and Transcript Reads

Session create, get, list, and fork call their native equivalents and project
native Session values with the shared Session compatibility helper. Create
passes the ACP working directory as native `location`. List passes the ACP
directory filter, root-session requirement where applicable, descending
ordering, and a bounded page size.

Transcript reads use native `messages.list`, not the legacy session message
route. The facade follows native cursors until it has the requested range,
preserves chronological order, obtains the native Session once, and projects
the mixed transcript through the shared transcript compatibility helper.
This retains imported legacy messages alongside canonical V2 messages and
prevents ACP replay, state restoration, and usage calculation from seeing
different histories.

An individual message read uses native `sessions.message` plus the same
projection rules. It is used only as event-recovery metadata lookup and must
not open an independent legacy read path.

Close Session remains local ACP state removal followed by best-effort native
interrupt, matching current behavior. Cancel uses native interrupt and keeps
the local ACP Session available.

## Prompt, Command, and Compact Completion

Before prompt or command admission, the facade applies the selected agent and
model through native switch operations when values are present. It translates
ACP prompt parts into native text, file, resource, and agent prompt fields
without discarding MIME, filename, source, resource identity, tool filters, or
system text.

Prompt and known slash command then use this sequence:

1. call native `sessions.prompt` or `sessions.command` with `resume: true`;
2. retain the admitted user message ID returned by the native endpoint;
3. call native `sessions.wait` for the same Session;
4. read the mixed transcript through the facade;
5. select the completed assistant message whose parent is the admitted user
   message;
6. return that projected legacy assistant message to ACP service code.

Selecting by parent identity, rather than taking the last assistant message,
keeps concurrent or coalesced admissions from returning another caller's
result. If wait completes without a matching terminal assistant message, the
facade raises a stable Session service failure instead of returning a false
successful turn.

Native assistant error projection remains the source for ACP stop reasons:
abort becomes `cancelled`, output limit becomes `max_tokens`, content filter
becomes `refusal`, provider authentication becomes ACP auth-required, and
other failures become sanitized Session service failures.

`/compact` calls native `sessions.compact` and then `sessions.wait` before ACP
returns an end-turn response. It does not invent an assistant message when the
compact contract returns no message.

## Event and Permission Flow

The facade subscribes to native `events.subscribe`. For each native EventV2
payload it uses a subscription-local `legacyEventProjection()` and
`legacyEventPayloads(...)` to emit the legacy event shapes already consumed by
`ACPEvent.Subscription`. Subscription-local projection state prevents
assistant/tool reconstruction from leaking between ACP connections.

The facade preserves native location metadata on each projected global event,
so ACP's local Session lookup continues to discard unrelated Sessions. Abort
signals close the native SSE iterator. A normally ended stream reconnects
with the existing bounded retry behavior; an explicitly aborted stream does
not reconnect.

Native `permission.v2.asked` events project to legacy `permission.asked`.
Permission handling retains the Session ID from the projected request and
passes it explicitly to `permission.reply`, which calls native
`permissions.reply`. The facade does not maintain an independent pending
permission registry solely to recover a missing Session ID.

## Catalog and Configuration

`catalog.load(directory)` obtains native providers, models, integrations,
agents, commands, and skills concurrently for the same Location. It uses the
shared catalog compatibility helpers to produce the provider and agent shapes
ACP already consumes. Commands and skills retain the current deterministic
merge rule: commands win on a duplicate name, unique skills are appended as
command-shaped entries, and the final list is sorted by name.

Native `config.get` supplies the configured default model. Default-model,
variant, and primary-agent selection stay in ACP's Directory service because
those are ACP policy, not transport projection.

Every catalog request uses `{ location: { directory } }`. No catalog method
falls back to a legacy route.

## Dynamic MCP Fallback

`mcp.add` delegates to the private legacy client's dynamic MCP add method,
including the ACP Session directory, server name, and normalized local or
remote configuration. This is the only allowed ACP request outside `/api`.

The fallback is explicit in the facade interface and tests. It is not exposed
as a general legacy client escape hatch. Native MCP status, resource,
connect, and disconnect methods are not substitutes because they cannot add a
runtime configuration.

When a native dynamic-add contract is introduced later, replacing this one
method removes ACP's legacy dependency without changing ACP services.

## Errors and Cancellation

Generated native HTTP errors and transport failures flow through the existing
ACP request error mapper with the service label supplied by the caller.
Messages exposed to ACP remain sanitized; raw response bodies, headers,
tokens, and stack traces are not copied into JSON-RPC errors.

Prompt and command request abort signals apply to admission and wait. Native
Session interruption remains the authoritative cancellation action. After
wait returns, the facade reads the terminal assistant state so an interrupted
turn is reported as `cancelled` rather than as a successful empty response.

Event projection failures are isolated to the offending event and do not stop
the subscription. Transport termination retains the current reconnect loop.
MCP registration remains best-effort per current ACP behavior and records a
registration key only after the legacy add call succeeds.

## Phase-Boundary Verification Strategy

Implementation and coverage are completed before any command is run. At the
Phase 8 verification gate, run package-scoped tests and typechecks from their
own package directories, then the single-binary build.

Required facade evidence:

1. native and legacy generated clients receive the same base URL, headers, and
   fetch identity;
2. create/get/list/fork/interrupt/messages/message call only `/api` routes and
   preserve legacy-compatible ACP values;
3. mixed transcript pagination preserves chronological imported and canonical
   messages;
4. prompt and command admit once, wait once, and return the assistant linked
   to the admitted user message;
5. a busy Session with coalesced work still returns the correct assistant;
6. compact calls native compact and wait without fabricating a response
   message;
7. native text, reasoning, tool progress, tool completion, file attachment,
   permission, and error events produce the existing ACP notifications once;
8. permission replies include the correct Session and request IDs;
9. providers, models, integrations, agents, commands, skills, and config use
   native routes and retain current Directory selection behavior;
10. dynamic MCP add uses the one legacy route with the shared transport;
11. a recording transport rejects every other ACP legacy endpoint;
12. existing ACP service, event, permission, usage, and CLI subprocess suites
    remain green without weakening their assertions.

The final gate also includes the other Phase 8 Session, TUI, CLI, plugin,
event-recovery, provider, typecheck, and build suites. No plan checkbox or
parity row is updated from stale or partial evidence.

## Rollout and Deletion Gate

The ACP migration is complete only when all ACP tests pass with a transport
recording showing native `/api` calls for every operation except MCP `add`.
At that point ACP's parity row may record the explicit MCP fallback.

The fallback may be deleted only after a native dynamic MCP add contract is
implemented, generated clients are refreshed, ACP uses that method, and the
same phase-gate evidence passes with zero legacy ACP requests.

## Rejected Alternatives

- **Migrate calls directly throughout ACP modules:** spreads generated-client
  transport and projection details across domain code and makes fallback
  auditing unreliable.
- **Reuse `cli/cmd/run/native-compat.ts`:** its broad `OpencodeClient` cast and
  live-output completion behavior are not ACP's contract.
- **Keep prompt and command on legacy while migrating reads:** leaves the most
  important execution path outside V2 and cannot complete ACP parity.
- **Return the last assistant after wait:** races concurrent/coalesced
  admissions and can associate the wrong turn with the ACP request.
- **Add a native MCP route only for this migration:** expands protocol and
  server scope when the approved temporary legacy fallback is isolated and
  removable.
