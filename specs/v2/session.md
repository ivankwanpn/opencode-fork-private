# Session API

## Current V2 Core Slice

The Effect-native core facade treats prompt recording and execution as separate responsibilities:

```text
sessions.create({ id?, location, ... })
  -> omitted ID generates one internal Session ID
  -> supplied ID creates the Session when absent
  -> reused ID returns the existing Session identity

sessions.prompt({ id?, sessionID, prompt, delivery?, resume? })
  -> omitted ID generates one internal message ID
  -> supplied ID inserts one durable Session inbox row when absent
  -> exact reuse returns the same admission receipt
  -> reusing one message ID for another Session, prompt, or delivery mode fails
  -> exact retry schedules another wake unless resume is false
  -> resume omitted or true schedules execution after admission
  -> resume false admits only

sessions.interrupt(sessionID)
  -> interrupts active execution on this process
  -> waits for runner cleanup and settlement
  -> clears a coalesced follow-up wake already registered with this coordinator
  -> preserves durable inbox rows for a later wake or resume
  -> idle or missing Session is a no-op

sessions.active()
  -> snapshots foreground Session drains owned by this process
  -> returns only active Session IDs with { type: "running" }
  -> absence means inactive; activity is not durable across process restarts
```

`session_input` is the durable admission inbox. `PromptAdmitted` records and projects accepted input, including per-prompt system text and tool overrides, so pending queue state can be replayed, replicated, and observed by clients. Admitted inputs remain outside model-visible Session history until the serialized runner publishes `Prompted`. Its projector atomically writes the visible user message and marks the inbox row promoted in the same event transaction. Exact admission retries compare the complete prompt policy as part of prompt equivalence. The V1-to-V2 shadow bridge publishes the same `Prompted` event for already-visible V1 prompts.

`admittedSeq` is the durable Session event sequence of `PromptAdmitted`. Clients may use the admission event to represent queued input before `Prompted` makes it part of visible conversation history.

Execution routing starts from only the Session ID:

```text
SessionExecution.resume(sessionID)
-> SessionStore.get(sessionID)
-> LocationServiceMap.get(session.location)
-> SessionRunner.run({ sessionID, force? })
```

`SessionExecution` and the read-side `SessionStore` are process-global. `SessionRunner`, catalog, model resolver, tool registry, permission state, and filesystem are cached per Location. No layer takes a Session ID. An omitted `Location.workspaceID` means implicit-local placement; explicit workspace identity remains reserved for future placement semantics.

The local runner issues one explicit `llm.stream(request)` per provider turn, projects each complete local tool call durably before eagerly starting its structured child execution, awaits every started tool fiber after provider-stream closure, and reloads projected history once before continuation. Promoting any new user input resets the selected agent's configured provider-turn allowance; multiple steers promoted at one boundary reset it once. Tool settlement events carry the owning assistant message ID because provider-local call IDs may repeat across turns. Before assembling a provider request, the runner durably fails any local tool still projected as `running` from a previous process with `Tool execution interrupted`; abandoned side effects are never silently replayed.

Projected hosted tools preserve call-side and settlement-side provider metadata separately so settlement and interruption recovery cannot erase continuation identifiers. Provider-native reasoning and provider metadata replay only while the historical assistant model matches the selected continuation model; after a model switch, visible reasoning text remains ordinary assistant text and provider-native metadata is omitted.

## Context Epochs

V2 Sessions persist the exact privileged System Context shown to the model. A Context Epoch stores one immutable provider-cache baseline and a model-hidden structured snapshot used to compare independently observed Context Sources. Environment facts, the host-local date, ambient global/upward-project `AGENTS.md` files, and selected-agent available-skill guidance are the initial sources. Location-wide sources come from the System Context Registry; selected-agent guidance composes with them immediately before Context Epoch admission.

The first complete observation initializes the epoch before any pending prompt becomes model-visible. If initial context is temporarily unavailable, execution stops while the prompt remains pending and retryable. On later provider turns, the runner promotes eligible input first, then reconciles current sources at the safe boundary. Changed context becomes one durable chronological System message, and its event commit advances the epoch snapshot atomically.

```text
Client            Runner                         System Context Registry       Context Epoch Store       Session History         LLM
   ??                ??                                     ??                          ??                      ??                ??   ?? Admit prompt ???????????????????????????????????????????????????????????????????????????????????????????????                ??   ??                ??                                     ??                          ??                      ??                ??   ??                ?? Observe initial context ??????????????                          ??                      ??                ??   ??                ??                                     ??                          ??                      ??                ??   ??                ?? Complete baseline or unavailable ?????                          ??                      ??                ??   ??                ??                                     ??                          ??                      ??                ??   ??                ?? Initialize missing epoch ?????????????????????????????????????????                      ??                ??   ??                ??                                     ??                          ??                      ??                ??   ??                ?? Promote eligible input ???????????????????????????????????????????????????????????????????                ??   ??                ??                                     ??                          ??                      ??                ??   ??                ?? Reconcile at safe boundary ???????????                          ??                      ??                ??   ??                ??                                     ??                          ??                      ??                ??   ??                ?? Unchanged or chronological update ????                          ??                      ??                ??   ??                ??                                     ??                          ??                      ??                ??   ??                ?? Advance snapshot atomically with update ??????????????????????????                      ??                ??   ??                ??                                     ??                          ??                      ??                ??   ??                ?? Baseline + chronological history ???????????????????????????????????????????????????????????????????????????```

Agent and model selection are provider-turn scoped. A switch admitted after the current safe provider-turn boundary applies to the next provider turn without restarting the current turn or replacing the baseline. Agent-specific skill guidance remains a Context Source, so changed guidance is admitted as a chronological System message. A completed compaction causes the next provider attempt to render a fresh baseline directly from current complete context. A Session move clears the epoch so the destination Location initializes a complete baseline on its next run.

After resolving the effective agent and model for a provider turn, request assembly selects the V1-compatible provider-family baseline unless the agent supplies its own system prompt, appends the selected provider/model identity, then appends the durable Context Epoch baseline. Connected MCP server instructions are observed again for each provider turn and omitted only when every associated tool is wholly denied by the effective agent's last-matching permission rules; instruction-only servers remain visible. Plugin system transforms receive this complete per-turn array. Provider prompts, model identity, and MCP instructions are therefore not stored as Location-wide Context Sources and a model switch cannot leave a stale identity in the durable epoch.

Effective model selection gives an explicit Session model and variant precedence over the selected agent's model and variant, then falls back to the catalog default or first supported model. The effective reference is used consistently for resolution, plugin message and request context, and durable assistant model metadata. Request assembly applies route and resolved-model defaults first, overlays the selected agent's request headers and body, and lets plugin `chat.params` and `chat.headers` transforms make the final mutations. Legacy generation aliases from model variants and agent policy are lifted into canonical generation options and removed from raw HTTP body overlays, while remaining provider-specific options use the resolved route's namespace. This preserves protocol-owned request fields and makes model, agent, and plugin precedence explicit without changing durable Session model state.

The latest promoted `session_input` row is the durable authority for per-prompt request policy. Its system text is appended after MCP server instructions and before the plugin system transform. Its tool overrides become last-matching permission rules after the selected agent's permissions, and an exact advertised tool name set to `false` is also removed directly from the materialized catalog. Pending inputs do not affect an active turn. Keeping policy authority outside compaction-filtered model history preserves the same system text, tool visibility, and permission decisions after completed compaction and projection replay; the next promoted prompt replaces that policy.

Plan workflow reminders are canonical model-facing history rather than request-local mutations. After eligible input promotion and before request assembly, the runner compares the selected agent with the latest model-facing agent or typed reminder in the full projected transcript. Entering the `plan` agent publishes one `plan-mode` synthetic event with the durable plan path and current file state; leaving plan publishes one `build-switch` synthetic event. The approved `plan_exit` instruction is recorded separately as `plan-approved` synthetic context instead of a normal user prompt. These typed markers prevent duplicate injection across retries and projection replay, remain detectable across compaction, and let a later opposite switch emit the matching reminder even when no intervening assistant completed. The legacy transient reminder path is not retained. Final-step enforcement remains request-local and disables tools while appending the maximum-step prompt.

Native prompt shorthand is resolved before durable admission. Normal prompt text scans V1-compatible `@` mentions relative to the Session Location and records existing files, directories, and configured agents as typed attachments while preserving explicit caller attachments. Native commands resolve the registered template, apply numbered and `$ARGUMENTS` substitutions, append otherwise-unused arguments, execute shell substitutions, resolve mentions, and then run `command.execute.before`; only those resolved parts reach `session.message.before` and `session_input`. Command-selected agent and model changes are published only after successful admission, while subtask commands retain the parent selection and record the target as an agent attachment for the agent-reference expansion stage. Missing shorthand remains ordinary text as in V1. Expansion, shell-spawn, or hook failure produces no durable prompt, although side effects performed by a shell substitution are not transactionally reversible. Projection replay consumes the recorded resolved Prompt and never re-executes template expansion.

Prompt attachments are materialized after `session.message.before` and before durable admission, so plugin-added or modified files cannot reintroduce unresolved provider input. Local text and directories use bounded deterministic pages, supported local and remote media become bounded normalized data URIs, data URIs are decoded and normalized, and MCP resources become ordered text, media, or visible failure items while retaining their original provenance. Per-attachment read, network, decoding, size, or format failures are durable model-visible errors rather than admission failures. An exact message-ID retry compares unresolved provenance with the recorded prompt and reuses its materialized contents without repeating filesystem, network, or MCP I/O; projection replay likewise performs no external attachment I/O. Runner lowering accepts recorded materialized text, errors, and normalized data-URI media, retains legacy data-URI compatibility, and renders every other legacy unresolved URI as unavailable instead of treating it as media bytes. The HTTP compatibility surface maps MCP resource parts into this canonical path while retaining loss-sensitive V1 fallback for file and symbol sources.

Configured reference aliases participate in native `@` shorthand after existing filesystem paths and configured agents. Direct aliases include hidden references, use the `Reference` service's materialized absolute path, preserve the mention source range, deduplicate an explicitly attached file with the same normalized path, and become directory attachments before `session.message.before`. Their content or durable read failure then follows the normal post-hook attachment materialization boundary, so Git checkout state and missing local paths are never re-read during replay.

Agent attachments are expanded after `session.message.before`, using the plugin-transformed active agent and attachment names. Each configured target records V1-compatible task-tool guidance; the denied hint is selected from the active agent's last-matching permissions plus per-prompt tool overrides. Unknown explicit targets record a visible unavailable message. Generated guidance is durable provider context but not caller-owned provenance: exact retries compare the attachment name and source range, reuse the recorded guidance without re-expansion, and old durable agent attachments receive deterministic compatibility guidance during lowering. The caller input schema cannot supply generated guidance.

Native expansion replay no longer depends on transient V1 synthetic parts. Resolved command templates, mention provenance, materialized attachment content and failures, agent guidance, and typed plan/build reminders are all recorded before provider lowering. Replaying projections therefore reproduces the same model-visible context without rerunning shell substitutions or external attachment/reference I/O.

```text
Session                            Epoch
   ??                                ??   ?? initialize complete baseline ????   ??                                ??   ??                                ????????????????????????????????????   ??                                ??reconcile chronological update  ??   ??                                ????????????????????????????????????   ??                                ??   ?? completed compaction ????????????   ??                                ?? render fresh baseline
   ??                                ??   ?? clear after Location move ???????```

Ambient project discovery canonicalizes and contains traversal within the project root and honors `OPENCODE_DISABLE_PROJECT_CONFIG`. An unavailable observation preserves the previously admitted value. A confirmed partial instruction removal emits the complete remaining aggregate with explicit supersession text; removing the final instruction emits a revocation message.

Successful canonical file reads durably record their canonical absolute paths in completed tool output; directory listings record no loaded file. At the next safe provider-turn boundary, nested instruction observation rebuilds those paths from projected Session history, rejects paths outside the Session Location root, and walks each file directory toward but not including that root. Each directory selects `AGENTS.md`, then optional `CLAUDE.md`, then deprecated `CONTEXT.md`; configured instruction paths and an instruction file read directly are excluded, and discoveries are deduplicated. Temporary observation failure preserves admitted context, while confirmed disappearance emits revocation. The same projection-derived observation runs after replay, so no process-local claim is durable truth.

Current Context Epoch follow-ups:

- Add explicit manual compaction on top of automatic request-budget compaction.
- Add operational metrics for observation latency, unavailable sources, contention, baseline size, and chronological-update growth.
- Consider watcher-backed per-file caching only if measurements show direct safe-boundary observation is too expensive.
- Expose plugin-defined Context Sources only after plugin reload and scoped cleanup semantics are designed.
- Add clustered Session execution ownership and stale-runtime fencing.

## Automatic Compaction

Before each provider turn, the runner estimates the complete model-visible request and compares it with the selected model's context window minus absolute reserved headroom. The reserve is the greater of the requested/model output allowance and configured `compaction.buffer`. When the request exceeds that budget and older complete turns are available, the runner compacts before executing the pending turn.

Compaction keeps the full transcript durable while replacing its active model representation with one hidden checkpoint containing a structured rolling summary and token-bounded serialized recent context. Provider-native assistant, reasoning, and tool messages never survive across the boundary, avoiding signature and encrypted-reasoning failures when the earlier prefix changes.

`session.next.compaction.started.1` durably identifies the attempt. Compaction deltas are live-only progress. `session.next.compaction.ended.1` durably stores the final summary and serialized recent context; only this completed event projects a model-visible compaction message. On the next provider attempt, the runner observes that completed compaction and directly renders a fresh Context Epoch baseline. A failed or interrupted attempt therefore leaves the previous history boundary active.

Repeated compactions update the previous structured summary with newly compacted messages. The runner then reloads projected history and executes the original pending turn.

When a provider rejects a request as context overflow before durable assistant output or tool execution, the runner attempts one overflow-triggered compaction even when the local estimate did not predict pressure. A completed checkpoint rebuilds the same logical provider turn with one remaining physical attempt. A second overflow, unavailable compaction, or overflow after durable output becomes the ordinary terminal failure; recovery never loops or replays partial side effects. Deterministic old tool-result pruning remains a separate follow-up.

## V1 Runtime Context Parity

This is the canonical checklist for model-visible runtime context still needed before the V2 runner replaces V1. Keep each behavior in its owning boundary rather than treating all model-visible text as a durable Context Source. Update this table in the PR that changes a status.

Status: `complete` is usable in the native V2 path, `partial` covers only part of V1 behavior, and `missing` has no native V2 equivalent.

| Boundary                   | Behavior                                                                 | Status   | Remaining V2 work                                                                                                     |
| -------------------------- | ------------------------------------------------------------------------ | -------- | --------------------------------------------------------------------------------------------------------------------- |
| Durable Context Source     | Environment facts and host-local date                                    | complete | None.                                                                                                                 |
| Durable Context Source     | Global and upward project instructions                                   | complete | None.                                                                                                                 |
| Durable Context Source     | Configured local/glob and remote URL instructions                        | complete | None.                                                                                                                 |
| Durable Context Source     | Nearby nested instructions discovered after successful reads             | complete | None.                                                                                                                 |
| Durable Context Source     | Selected-agent available skill guidance and skill-body loading           | complete | None.                                                                                                                 |
| Per-turn request assembly  | Placement, selected model, chronological history, and canonical lowering | complete | None.                                                                                                                 |
| Per-turn request assembly  | Selected agent, agent prompt, and effective permissions                  | complete | None.                                                                                                                 |
| Per-turn request assembly  | Provider/model-specific base instructions                                | complete | None.                                                                                                                 |
| Per-turn request assembly  | Selected provider/model identity and connected MCP server instructions   | complete | None.                                                                                                                 |
| Per-turn request assembly  | Policy-filtered built-in, MCP, plugin, and structured-output tools       | complete | Native V2 assembles built-in, MCP (including resource helpers with provenance), plugin, and structured-output tools. MCP resource results retain canonical provenance through durable persistence, plugin-message round trip, and transient provider-bound preparation. |
| Per-turn request assembly  | Per-prompt system text and tool overrides                                | complete | None.                                                                                                                 |
| Per-turn request assembly  | Steering, plan/build-switch, and final-step reminders                    | complete | None.                                                                                                                 |
| Per-turn request assembly  | Plugin message, system, parameter, and header transforms                 | complete | None.                                                                                                                 |
| Per-turn request assembly  | Model variants and request settings                                      | complete | None.                                                                                                                 |
| Per-turn request assembly  | Structured-output policy                                                 | complete | None.                                                                                                                 |
| Per-turn request assembly  | Automatic/context-pressure compaction                                    | complete | V2 initiates automatic and overflow-triggered compaction, then rebuilds the baseline from the completed checkpoint.   |
| Prompt/reference expansion | Durable typed prompt attachments                                         | complete | None.                                                                                                                 |
| Prompt/reference expansion | Native template and `@` mention expansion                                | complete | None.                                                                                                                 |
| Prompt/reference expansion | File, directory, media, and MCP-resource materialization                 | complete | None.                                                                                                                 |
| Prompt/reference expansion | Agent-reference expansion                                                | complete | None.                                                                                                                 |
| Prompt/reference expansion | Configured-reference expansion                                           | complete | None.                                                                                                                 |
| Prompt/reference expansion | Native synthetic expansion replay                                        | complete | None.                                                                                                                 |

A JSON Schema output format is part of the durable prompt contract and survives message hooks, inbox admission, exact retries, continuation turns, and projection replay. The runner generates a canonical `StructuredOutput` tool from that schema, removes the schema dialect marker before provider dispatch, requires tool use, and adds model-visible final-response policy. A successful generated-tool call records its arguments through the ordinary durable tool lifecycle and projects them onto the assistant message; it terminates the turn instead of executing as a local tool. Ordinary research tools may settle and continue under the same format policy. A successful terminal provider turn that neither requires continuation nor records structured output is settled as failed. The V1 structured-output runner remains reachable only when another loss-sensitive HTTP prompt property forces the retained legacy fallback.

The Phase 6 parity gate leaves consumer fallbacks in place when their payload or lifecycle contract is not yet canonical. HTTP prompts now route JSON Schema structured-output format through native V2 while retaining V1 for caller-supplied part IDs, subtask parts, synthetic/ignored/timed/metadata-bearing text, noncanonical part ordering, and file or symbol source forms; `test/server/httpapi-session.test.ts` characterizes those cases separately from canonical prompts and MCP resources. The legacy `/command` route now sends lossless payloads through `SessionV2.command`, including native template expansion, hooks, durable admission, exact message IDs, synchronous execution, and projection back to the V1 response contract. Command variants, caller-supplied attachment part IDs, and file or symbol attachment sources still use `SessionPrompt.command` because the native command input cannot preserve those payload details. The dedicated `/init` compatibility wrapper also runs through `SessionV2.command`. Legacy session metadata, sharing, fork, revert, and direct message/part mutation routes retain their V1 services because the native protocol does not yet expose equivalent legacy lifecycle and response contracts; history reads merge canonical projections with retained V1 rows. `SessionReminders.apply` and V1 plugin triggers likewise remain reachable only through the retained V1 runner; the V2 runner owns durable typed reminders and native plugin transforms. No protected V1 runtime is removed by the Phase 6 gate.

## Durable Provider Attempts and Recovery

Provider execution uses an explicit durable attempt state machine. Request assembly, compaction checks, and snapshot capture remain preparation; immediately before `llm.stream(request)` can perform network I/O, the runner publishes `session.next.provider.attempt.started` with a fresh attempt ID, the reserved assistant message ID, the physical attempt number, and an optional `retryOf`. The committed start event is a dispatch-intent boundary: absence proves that this runner did not cross into provider dispatch and permits safe preparation again, while presence without settlement means the provider outcome may be unknown. No post-crash path treats a started attempt as evidence that the provider definitely received or definitely did not receive the request.

The first provider event is preceded by one durable `session.next.provider.attempt.response.started` event. Event-specific assistant, text, reasoning, and tool publication follows it. `Step.Started` retains its model-facing meaning and uses the assistant ID reserved by the attempt; it is not the provider-dispatch authority. A crash after receiving a provider event but before committing `response.started` therefore remains conservatively dispatch-unknown.

Each attempt reaches one durable terminal transition:

- `session.next.provider.attempt.ended` records `completed`, `failed`, `interrupted`, or `abandoned` and whether another provider turn is required from the resulting durable history.
- `session.next.retried` is retained as the terminal transition for a safely retryable physical attempt. It records the settled attempt ID, the next physical attempt number, normalized retry error, and absolute retry time. It is a durable retry authorization and visible status, not the general attempt identity.
- `session.next.provider.recovery.decided` records a user's `retry` or `abandon` decision for exactly one unsettled attempt. A decision is idempotent for that attempt and conflicts with a different second decision.

The attempt projection exposes `idle`, `running`, `retrying`, `continuation-required`, and `recovery-required` state. `running` is reported only while the current process coordinator owns the matching Session. A projected `started` or `response-started` attempt without current-process ownership is `recovery-required`; process restart alone never converts it into a retry authorization. `continuation-required` means the preceding attempt and all recorded local tools settled durably, but the next provider attempt has not crossed its dispatch-intent boundary. That state is safe to resume automatically.

Recovery classifies crash windows as follows:

| Last durable boundary                                                            | Recovery behavior                                                                                                                                                               |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Promoted input or required continuation, no attempt start                        | Rebuild from durable history and dispatch automatically; this process did not cross the provider boundary.                                                                      |
| Attempt started, no terminal transition                                          | Report `recovery-required`; wake and ordinary resume preserve pending inbox work and do not dispatch. The provider may have accepted the request.                               |
| Response started with incomplete assistant output, tool input, or tool execution | Durably fail pending/running tools as interrupted, preserve all recorded partial output, and report `recovery-required`; never replay a tool or provider request automatically. |
| Completed assistant step and settled tools, but attempt end missing              | Finalize the attempt deterministically from the owned assistant projection. Continue automatically only when that projection requires a local-tool continuation.                |
| Attempt ended with `continuation: true`, no successor attempt start              | Dispatch the required continuation automatically.                                                                                                                               |
| Durable retry notice, no successor attempt start                                 | Resume the authorized backoff and start only the recorded bounded replacement attempt.                                                                                          |
| Provider/hosted tool may have executed without durable settlement                | Report `recovery-required`; no automatic resend or hosted-side-effect replay.                                                                                                   |

Automatic retries are bounded to two replacements, for at most three physical provider attempts per logical turn. They are permitted only for an explicit retryable provider response or typed retryable `LLMError` before durable assistant text/reasoning, any local tool call, or any provider-executed tool. Context overflow keeps its separate one-compaction/one-replacement rule and does not consume this retry budget. Transport ambiguity, interruption, invalid output, authentication, quota, policy, and all failures after model-visible output or tool activity are not automatically retried. Retry delay honors a bounded provider retry hint and otherwise uses bounded exponential backoff. Each wait is represented by `Retried`, so a process crash during backoff cannot reset the budget or silently turn one retry into an unbounded loop.

Ordinary `sessions.resume(sessionID)` no longer means permission to resend an unsettled provider attempt. It joins current ownership, starts safe pending/continuation work, or returns a typed recovery-required result without dispatch. `sessions.recover({ sessionID, attemptID, decision: "retry" | "abandon" })` is the only API that resolves ambiguous work. `retry` explicitly accepts duplicate-provider or side-effect risk, closes any incomplete assistant and tool projection as interrupted, and authorizes one replacement attempt linked by `retryOf`; it does not reset the automatic retry budget. `abandon` closes the attempt without provider I/O and preserves its partial durable history and pending inbox. Later ordinary work may continue from that history, but abandonment itself does not dispatch.

On local service startup, recovery discovery scans only local Session projections. It schedules promoted input that never crossed an attempt boundary, `continuation-required` work, elapsed durable retry waits, and still-pending inbox rows. It leaves `recovery-required` attempts stopped and observable. This is process-local recovery, not clustered ownership: there is no distributed lease, remote interruption, stale-owner fencing, or claim that another process cannot be running the same Session. Clustered Session ownership remains deferred and must add those guarantees before multiple execution nodes are enabled.

Provider timeout and watchdog policy remains separate. The runner does not impose a universal provider-stream inactivity or absolute timeout; configurable timeout policy must settle through the same durable attempt state machine rather than releasing a drain and implicitly retrying.

Inbox delivery is explicit:

- `steer` inputs promote at the next safe provider-turn boundary, including continuation inside the current drain.
- `queue` inputs remain in a FIFO while the current drain requires continuation. When the Session would otherwise become idle, the runner promotes exactly one queued input, then reevaluates continuation before promoting another.

Execution has two scheduling paths:

- `resume` joins active execution or starts only safe durable work while idle. It cannot bypass a recovery-required attempt.
- `wake` reports newly recorded durable inbox work. Repeated wakes coalesce, and a wake never resolves provider-dispatch ambiguity.

A process-global `SessionRunCoordinator` serializes execution for each local Session while allowing different Sessions to run concurrently. Resumes join active execution, overlapping wakes coalesce into one follow-up, and interruption stops current process-local execution without deleting durable inbox work. The runner enters the Session's current Location when execution starts and fences each new provider turn against that Location.

The coordinator's active registry remains the source for `sessions.active()`. It represents only foreground Session drains owned by the current process; background subagents and tasks do not add parent Sessions to this registry. Durable attempt status survives restart, while the active registry itself is empty after restart.

Inbox promotion coalesces pending steers in durable admission order. Once continuation would otherwise end, it promotes one queued input at a time in FIFO order. Add explicit inbox backlog and steering-batch limits before exposing broad multi-caller admission or untrusted queue growth.

Eager local-tool execution is intentionally unbounded in the current local slice. This minimizes tool latency but does not increase SQLite settlement throughput: Session-event publication remains serialized per provider turn. Before broadening exposure, revisit per-turn call limits, output truncation, and operational backpressure using observed workloads. The `session.next.*` event schemas remain experimental and unshipped; databases created by earlier experimental builds are disposable rather than compatibility targets.

The synchronized `session.next.*` event family and projected Session-message model predate this branch. This slice refines their replay contract: projected Session messages retain their source aggregate sequence so canonical context ordering and `sessions.messages(...)` pagination follow durable event order even when caller-supplied IDs or timestamps do not. Consumers can use `sessions.events({ sessionID, after? })` to replay durable `session.next.*` events after an aggregate sequence cursor, then tail durable events without a race. Live-only text, reasoning, and tool-input fragments remain available through EventV2 subscriptions for connected renderers; they are intentionally absent from the replayable Session stream.

The first `sessions.events(...)` contract is durable-only during both replay and live tailing. This keeps one cursor equal to one persisted aggregate sequence and is sufficient for reconnect-safe consumers. A later UI-facing API may optionally interleave live-only deltas while connected, but those fragments must remain explicitly ephemeral: they cannot advance the durable cursor, replay after reconnect, or be mistaken for publication boundaries.

`sessions.history({ sessionID, after?, limit? })` is the finite counterpart for request/response consumers. `after` is an exclusive aggregate sequence, and omission starts before sequence zero. The response is `{ data, hasMore }`; callers derive the next `after` from the final event's durable sequence when `hasMore` is true. Public durable Session events are selected before pagination, which permits gaps from private or historical aggregate events while preserving strictly increasing unique sequences. The log has a moving head, so events committed between pages may appear on the next page.

The finite endpoint is `GET /api/session/:sessionID/history`, uses the normal Session Location and authorization middleware, defaults to 50 events, and accepts at most 100. It returns only events in the public durable Session schema. The existing `sessions.events()` replay-and-tail stream is unchanged.

Durable event tail wakeups are advisory and edge-triggered. Each active tail owns one sliding-capacity-1 dirty signal for its aggregate and re-queries SQLite after a wake. Repeated commits coalesce while the tail is busy because durable rows, not in-memory notifications, preserve every event and sequence. Subscribe and register the dirty signal before historical replay, then remove it when the tail closes, so replay handoff cannot miss a commit and inactive aggregates retain no wake state.

Event replay owner claims are separate from clustered Session execution ownership. The former already fences synchronized projection reconstruction; the latter still needs distributed active-run acquisition, stale-runtime rejection, interruption, and placement orchestration.

## Current Tool Registry Slice

`ApplicationTools` stores process-scoped application registrations shared by all Locations. Each Location-scoped `ToolRegistry` overlays Location registrations, materializes definitions, and owns lookup and settlement. Closing a contribution scope removes its definition and rebuilds the advertised catalog. Trusted tool executors capture and perform authorization; the registry applies catalog visibility filtering, decodes input, invokes the retained handler, validates output, and settles failures as typed tool-result errors.

When a Session omits `agent`, both execution and permission evaluation use the default `build` agent. A caller must not observe `build` model behavior while permission checks silently evaluate an empty no-agent policy.

The first built-in contribution is bounded `read`:

```text
resolve one path relative to the Location or a named project reference
-> reject absolute paths, path escapes, and symlink escapes
-> authorize read against the canonical resource identity
-> for a file: return UTF-8 text or base64 binary content; page oversized UTF-8 text by bounded line ranges
-> for a directory: return direct children in directory-first alphabetical order
-> page directory results with one-based offset and next cursor
```

V2 `bash` uses the normal permission semantics: configured agent rules plus saved project approvals, with `ask` as the default when no rule matches. Bash is not sandboxed: the spawned shell runs with the host user's filesystem, process, and network authority. Structured external `workdir` resolution remains an enforced `external_directory` authority check. Best-effort scans of absolute command arguments produce advisory warnings only; they are not sandbox boundaries and do not request or enforce `external_directory` approval.

The first V2 `apply_patch` leaf supports add, update, and delete hunks. It parses every hunk, resolves every mutation target, approves external directories, approves one edit batch, and preflights approved update/delete targets before committing operations sequentially. A later commit-time failure leaves earlier operations applied and returns an explicit partial-application report. Moves and atomic rollback remain separate follow-ups rather than implied behavior.

### Current Runner Follow-Ups

- Keep eager structured local-tool settlement: durably record each complete call, start its child execution immediately, await all started settlements after provider-turn consumption, persist every result, and reload history once before continuation.
- Buffer or coalesce streamed deltas before rewriting growing assistant projections.
- Revisit additional covering indexes as larger-history query shapes become concrete.
- Design any global multi-Session event stream separately; the finite history API deliberately reads one authorized Session aggregate and does not change global Event publication.
- Decide whether UI-facing Session subscriptions should optionally interleave ephemeral deltas while connected without advancing the durable cursor.
- Add provider-aware context control for provider-executed tool results. Generic text truncation cannot replace provider-native structured payloads that must round-trip exactly.

## Remove Dedicated `session.init` Route

The dedicated `POST /session/:sessionID/init` endpoint exists only as a compatibility wrapper around the normal `/init` command flow.

Current behavior:

- the compatibility route calls `SessionV2.command(...)`
- it sends `Command.Default.INIT` with the caller's exact message and model IDs
- it waits for canonical execution to finish and returns the legacy boolean response
- it does not provide distinct session-core behavior beyond running the existing init command in an existing session

V2 plan:

- remove the dedicated `session.init` endpoint
- rely on the normal `/init` command flow instead
- avoid reintroducing `Session.initialize`-style special cases in the session service layer
