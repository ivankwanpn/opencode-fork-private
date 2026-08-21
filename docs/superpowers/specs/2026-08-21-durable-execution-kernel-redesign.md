# Durable Execution Kernel Redesign

**Date:** 2026-08-21

**Status:** Chat design approved; written-spec review pending

**Repository:** `D:\agent-complete\opencode-fork-private-999.0.15`

**Target implementation branch:** `999.0.20`

## 1. Purpose

Rebuild OpenCode fork's execution core around a durable, fenced, single-owner
turn kernel. DeepSeek Harness rc.8 supplies the primary composition style:
explicit services, scoped plugin contributions, staged tool execution, bounded
parallelism, presets, mailboxes, and capability ownership. Codex 0.147.0 is the
correctness reference for turn-task ownership, cancellation, ordered tool
commit, transient delta policy, completion flush, and conservative recovery.
The unfinished I-harness repository is an algorithm and test reference only.

The product surfaces remain OpenCode: Desktop, Web, TUI, ACP, providers,
Marketplace, MCP/LSP management, configuration UI, and the canonical V2 API.
The new kernel does not import DSH, Codex, or I-harness as production
dependencies.

## 2. Motivation

The current fork has accumulated several related failure modes:

- a tool can fail or be interrupted without a matching ProviderAttempt terminal
  event;
- turn, attempt, input, notification, and status projections can contradict one
  another;
- startup service construction has triggered provider work without a new user
  action;
- stop can abort a fiber without durably fencing late callbacks;
- compaction, provider attempts, tools, notification delivery, and follow-up
  admission are presented as one undifferentiated busy state;
- long-running shell and task ownership has been coupled to the foreground
  waiter;
- plugin lifecycle and capability registration still contain V1-format
  compatibility boundaries;
- durable events commit one at a time, leaving crash windows between logically
  atomic lifecycle facts.

These are lifecycle-boundary problems, not isolated UI bugs. Fixing them by
adding more compatibility projections or fire-and-forget event writes would
increase technical debt.

## 3. Reference Synthesis

### 3.1 DeepSeek Harness rc.8

Adopt these concepts:

- capabilities are mounted services, not implicit config mutations;
- required services gate plugin activation;
- plugin scopes own listeners, contributions, fibers, timers, and disposers;
- service groups may isolate same-named capabilities;
- durable session events and transient runtime events are separate vocabularies;
- the tool pipeline is pre-policy, monotonic guards, approval, around-dispatch,
  body, post-processing, finalization, and immutable result observation;
- tool bodies may run concurrently while policy and result commit stay ordered;
- subagent mailboxes distinguish quiet delivery from a waking follow-up;
- recovery reconciles durable provisioning rather than assuming an in-memory
  operation finished;
- session persistence may batch and pack streaming chunks without weakening
  terminal durability.

Do not import Cordis as a second dependency-injection runtime. Effect Layer,
Scope, and Location remain the implementation substrate.

### 3.2 Codex 0.147.0

Use Codex as the lifecycle oracle:

- one turn has one task owner and cancellation chain;
- provider response events are consumed in one ordered turn loop;
- tool calls are collected before execution;
- parallel tool results commit in model order;
- text, reasoning, and command-output deltas are transient;
- terminal turn/item facts are persisted;
- turn completion has an explicit persistence flush boundary;
- thread persistence and live turn ownership are distinct;
- uncertain provider work is not blindly replayed after process loss.

Codex persists a durable event according to rollout policy before delivering it.
This design therefore does not introduce a global provisional-live event API in
the first kernel.

### 3.3 I-harness

Use the following as design/test references:

- M13 staged prepare/dispatch/finalize pipeline;
- bounded rolling-pool scheduling;
- exclusive barriers;
- head-of-line ordered result commit;
- abort-aware replenishment;
- per-session FIFO write-behind with requeue on failure;
- compaction shadowing and session-query surface;
- output-retention and spill concepts.

Do not use I-harness as a runtime base. Its current tree type-checks, but its
full test suite fails on Windows for external abort of a running command and an
already-aborted signal before spawn. Its session vocabulary, recovery closer,
job registry, child depth, and document persistence remain prototype-grade.

## 4. Goals

1. One valid execution owner per Session.
2. Durable generation and opaque lease fencing for every execution commit.
3. Atomic lifecycle event batches with same-transaction projection.
4. Separate prompt admission, execution scheduling, and model/tool work.
5. Explicit provider, tool, compaction, retry, notification, and recovery phases.
6. Deterministic bounded parallel tool execution with ordered results.
7. Stop that durably invalidates old callbacks before reporting acceptance.
8. Startup that reconciles state without automatically running root provider work.
9. Durable evidence sufficient to classify recovery without redoing uncertain
   side effects.
10. DSH-style scoped, typed plugin capabilities without raw lifecycle authority.
11. A gradual, no-V1-projection cutover from the current V2 runner.
12. Event and status contracts shared by Desktop, Web, TUI, CLI, ACP, and SDK.

## 5. Non-goals

- migrating old classic Session data;
- distributed or clustered execution ownership;
- importing Cordis, Codex Rust crates, or `@i-harness/*` packages;
- replacing Desktop, TUI, Web, ACP, providers, or Marketplace in the kernel
  tranche;
- allowing uncommitted provisional lifecycle facts to masquerade as durable;
- executing a kernel Session through the classic runner when a capability is
  missing;
- granting plugins direct SQL, lease, generation, projector, or durable-sequence
  access;
- implementing a worker-process plugin sandbox in the durable-kernel tranche;
- preserving a hidden classic fallback after final cutover.

## 6. Product Boundary and Engine Routing

The canonical V2 surface remains stable:

```text
SessionV2.prompt
SessionV2.command
SessionV2.interrupt
SessionV2.status
SessionV2.history
SessionV2.input.*
```

An `ExecutionRouter` chooses a Session engine:

```text
Session API
    |
    v
ExecutionRouter
    |-- classic: current SessionExecutionLocal
    `-- kernel:  DurableExecutionKernel
```

Each Session fixes its engine at creation:

```ts
type ExecutionEngine = "classic" | "kernel"
```

Rules:

- an existing Session without the field is classic;
- tests and DEV may explicitly create a kernel Session;
- the first product release keeps classic as the new-Session default;
- a later gate changes the default to kernel;
- a Session never changes engine after creation;
- kernel capability absence fails loudly;
- old Sessions are not migrated;
- after the observation window the classic runner and switch are deleted.

This temporary router is not a V1 compatibility layer. Both engines consume the
canonical V2 API.

## 7. Kernel Components

```text
DurableExecutionKernel
|-- TurnCoordinator
|-- LifecycleStore
|-- PublicationActor
|-- ToolScheduler
|-- RecoveryPlanner
`-- StatusProjector
```

### 7.1 TurnCoordinator

- owns one process-local actor per active Session;
- coalesces same-Session wakes;
- permits different Sessions to run concurrently;
- creates the turn cancellation scope;
- starts and closes the PublicationActor;
- waits for publication, tools, checkpoints, and terminal commit;
- releases ownership only after durable settlement;
- never writes SQLite directly;
- never classifies recovery itself.

### 7.2 LifecycleStore

The only service permitted to change durable execution coordination state. It:

- acquires generation and lease;
- validates fencing tokens;
- performs atomic lifecycle transitions;
- batches durable events and projectors;
- promotes and terminalizes inputs;
- updates task submission and notification outbox state;
- returns typed stale, conflict, persistence, and invariant errors.

### 7.3 PublicationActor

The sole owner of mutable provider-turn publication state:

- assistant identity;
- text and reasoning fragments;
- tool call map and result slots;
- attempt identity;
- step settlement;
- structured output;
- checkpoint buffers;
- publication error and close state.

Provider readers, tools, compaction, and notifications communicate only through
typed actor commands.

### 7.4 ToolScheduler

Runs ordered preparation, bounded body dispatch, and ordered finalization. It
does not write durable lifecycle facts without PublicationActor and
LifecycleStore.

### 7.5 RecoveryPlanner

Reads durable evidence and produces a plan. It does not run provider, tool,
shell, compaction, or notification work. A separate executor revalidates and
applies a plan.

### 7.6 StatusProjector

Derives busy, idle, retry, cancelling, and recovery status from execution and
input snapshots. Status is a transient notification, not a second durable truth.

## 8. Durable Coordination Model

### 8.1 Domain facts versus coordination state

```text
EventV2 durable log
    domain history and replayable transcript facts

session_execution
    current generation, lease, phase, and recovery coordination
```

The event log is authoritative for domain history. `session_execution` is
authoritative for current ownership and fencing. The lease token is not a
public domain fact and is not exposed to plugins or clients.

### 8.2 `session_execution`

```ts
type ExecutionState =
  | "idle"
  | "active"
  | "retry_wait"
  | "needs_recovery"
  | "cancelling"

type ExecutionPhase =
  | "admitting"
  | "dispatching"
  | "responding"
  | "tools"
  | "compacting"
  | "settling"
```

Columns:

```text
session_id             primary key
engine                 "kernel"
generation             monotonic integer
lease_token            nullable opaque UUID
process_incarnation    nullable UUID
state                  ExecutionState
phase                  nullable ExecutionPhase
turn_id                nullable message ID
input_id               nullable message ID
attempt_id             nullable event ID
assistant_message_id   nullable message ID
retry_at               nullable timestamp
recovery_reason        nullable typed reason
started_seq            nullable durable sequence
updated_seq            nullable durable sequence
time_updated           timestamp
```

The row is created with the kernel Session: generation `0`, state `idle`, null
lease/identity/phase/retry/recovery/sequence fields, and the creation timestamp.
The first atomic start sets both `started_seq` and `updated_seq`. Every later
coordination transition advances `updated_seq` to its final committed event
sequence.

### 8.3 Lease

```ts
interface ExecutionLease {
  sessionID: SessionID
  generation: number
  token: string
}
```

Every execution transition uses a CAS predicate over Session, generation,
token, and expected state. Updating zero rows yields `StaleExecutionError`.
The caller may not obtain a new lease and silently continue the old operation.

### 8.4 Interrupt fencing

Interrupt first commits:

```text
generation = generation + 1
lease_token = NULL
state = cancelling or idle
```

Only after this durable fence is accepted does it abort provider/tool scopes.
Late callbacks retain the old generation/token and cannot commit.

## 9. Atomic Event Batches

Add:

```ts
events.publishBatch({
  aggregateID,
  expectedSeq,
  location,
  events: [
    { definition, data, id? },
    { definition, data, id? },
  ],
  commit,
})
```

Contract:

- one aggregate per batch;
- durable typed definitions only;
- IDs generated and checked before transaction work;
- inputs Schema-encoded before write;
- one expected-sequence check;
- contiguous sequence allocation;
- projectors execute in array order inside one transaction;
- the commit hook runs in that transaction;
- one failure rolls back events, sequence, read models, and coordination state;
- the sequence table advances to the final batch sequence;
- live listeners receive events only after commit, in batch order;
- durable subscribers receive one wake;
- transient deltas never mix into the durable batch;
- existing single-event `publish` becomes a one-event batch wrapper.

### 9.1 Atomic start

One transaction:

1. validate idle/eligible execution;
2. increment generation and install lease;
3. set turn/input/attempt identities;
4. promote the selected input;
5. append Prompted, Turn.Started, and ProviderAttempt.Started;
6. set active/dispatching;
7. update start/final sequence.

### 9.2 Atomic terminal

One transaction contains all remaining terminal facts:

- incomplete part/tool terminal events;
- Step.Ended or Step.Failed;
- ProviderAttempt.Ended;
- Turn.Ended;
- Input.Terminalized;
- input/task/outbox read-model updates;
- execution transition to idle, retry wait, or recovery;
- lease clear.

## 10. Input Lifecycle

Canonical stages:

```text
PromptAdmitted       input accepted
Prompted             input promoted to owning turn
Input.Terminalized   input reached terminal outcome
```

Add:

```ts
SessionEvent.Input.Terminalized {
  sessionID
  inputID
  timestamp
  outcome: "completed" | "error" | "cancelled" | "recovery-required"
  resultMessageID?
  error?
}
```

Kernel input terminalization occurs only through the event/projector batch.
Classic direct updates remain isolated to the classic engine until deletion.

## 11. Attempt and Turn Read Models

During coexistence:

- `session_execution` is kernel-only;
- `session_turn` and `session_provider_attempt` are classic-only;
- `session_input`, tasks, outbox, and EventV2 remain shared with engine-aware
  mutation rules.

After cutover:

- `session_turn` is deleted;
- `session_provider_attempt` is deleted or redesigned as append-only history;
- current execution comes from `session_execution`;
- Status is removed from the durable Session manifest and remains a transient
  schema/event.

## 12. Retry and Process Incarnation

Each physical provider request has a unique attempt ID. A retryable attempt
settles to retry wait, clears its lease, and persists `retry_at`. A scheduler
later acquires a new generation/token and creates a new attempt.

Each server process has one `process_incarnation` UUID. An active database lease
from another incarnation is ownership-lost evidence. The new process never
adopts its token and never starts provider work from service construction.

## 13. PublicationActor

```ts
type PublicationCommand =
  | { type: "provider-event"; event: LLMEvent }
  | { type: "tool-batch"; calls: ToolCall[] }
  | { type: "tool-result"; index: number; result: ToolSettlement }
  | { type: "checkpoint"; reason: CheckpointReason }
  | { type: "barrier"; reply: Deferred<void> }
  | { type: "interrupt"; reason: InterruptReason }
  | { type: "close"; outcome: TurnOutcome }
```

Mailbox rules:

- bounded FIFO, initial capacity 256 commands;
- durable boundaries are never dropped;
- adjacent same-part deltas may coalesce before enqueue;
- capacity exhaustion backpressures the provider reader;
- interrupt has a high-priority ingress but does not cross an in-flight atomic
  transaction;
- post-interrupt ordinary commands are rejected;
- close waits for an explicit barrier.

## 14. Provider Flow

```text
LifecycleStore.startAttempt
    -> llm.stream
    -> ProviderReader
    -> PublicationActor
```

ProviderReader validates and forwards protocol events, observes cancellation,
and records telemetry. It does not execute tools, publish EventV2, mutate
messages, or terminalize attempts.

PublicationActor translates provider events into live deltas, durable
boundaries, tool batches, errors, and settlement.

## 15. Streaming Checkpoints

Text, reasoning, and tool-input deltas stay live. The actor persists bounded
checkpoints when any condition is met:

- 250 milliseconds since the previous checkpoint;
- 8 KiB of new content;
- part/tool boundary;
- interrupt or flush barrier.

Add typed Text.Checkpoint, Reasoning.Checkpoint, and ToolInput.Checkpoint facts.
They store content since the previous checkpoint. Projectors update partial
messages. Final Ended events remain authoritative.

The first version uses the existing Event table. Packed rows and zstd are a
later storage optimization behind the same event API.

## 16. Tool Execution

### 16.1 Collect before dispatch

All tool calls in a provider step are collected before local dispatch. Hosted
provider-executed tools use a separate path but retain the same identity and
ordered commit rules.

### 16.2 Three stages

```text
ORDERED       prepare
CONCURRENT    dispatch body
ORDERED       finalize and durable commit
```

Prepare performs identity lookup, schema validation, exposure snapshot check,
permission, plugin policy, sandbox plan, approval, deadline, and concurrency
classification.

Dispatch runs only the real tool body through bounded around-dispatch wrappers.

Finalize runs post-tool hooks, result normalization, retention/spill,
content/structured validation, durable result publication, task transitions,
and additional-context collection.

### 16.3 Bounded pool and exclusivity

- initial maximum parallel bodies: 10;
- default classification: exclusive;
- read, glob, grep, Session query, approved tool-search reads, and pure catalog
  inspection may opt into parallel;
- shell, writes, edits, questions, task/subagent mutations, config/plugin
  mutation, unknown third-party tools, and MCP without an explicit declaration
  remain exclusive;
- an exclusive call drains the pool, runs alone, then allows replenishment.

### 16.4 Ordered result commit

Completed bodies fill index-addressed slots. A head-of-line cursor commits only
the contiguous settled prefix. Fast later results wait for earlier calls.

Normal tool errors become model-visible error results. Only corruption,
identity/order violations, stale leases, projector failure, and other kernel
invariants terminate the kernel.

## 17. Tool Cancellation and Background Work

Interrupt fences generation, aborts provider/compaction, stops pool
replenishment, signals active tools, and waits a three-second grace period.
Never-started calls receive synthetic cancelled results. Non-cooperative active
tools become abandoned after the grace period. Late completion cannot replace a
terminal result.

Foreground shell ownership may transfer to BackgroundJob after three minutes or
through the Desktop action. Transfer returns a task ID and terminalizes the tool
without killing the process. A steer never implicitly kills a shell.

Turn interrupt does not cancel an already transferred background job. Only
stop-task, an explicit tree policy, shutdown policy, or recovery of a lost OS
process changes job state.

## 18. Admission, Steer, Queue, and Follow-up

### 18.1 Idle input

An idle prompt acquires a new generation and creates a new turn. A prompt after
a completed turn is never attached to the preceding assistant answer.

### 18.2 Steer

An active steer is durably admitted and promoted only at a safe boundary:

- provider response and actor barrier complete;
- contiguous tool result prefix committed;
- compaction complete;
- immediately before the next provider request.

Multiple steers may promote in admitted order as one batch and reset the
provider-turn allowance once.

### 18.3 Queue

An unpromoted queue never joins the current turn and never runs automatically on
startup. When a turn would otherwise become idle, one queued input may promote,
then continuation is re-evaluated.

### 18.4 Quiet versus waking message

`send_message` persists mailbox delivery without a wake. `followup_task`
persists delivery plus a wake request. A wake is considered only when the target
is idle or at an atomic safe boundary.

## 19. Subagents and Notifications

Each child is an independent kernel Session with its own execution row,
generation, lease, actor, compaction, tools, and recovery.

Child completion atomically terminalizes TaskSubmission and creates an outbox
entry. Delivery and waking are separate facts. A notification cannot replace an
active parent turn owner. If the parent is idle, a waking notification obtains a
new generation and explicit synthetic input/turn identity.

Tree cancellation requests child cancellation, but each child terminalizes in
its own kernel. Parent and child never share publisher maps or cancellation
controllers.

## 20. Compaction

Compaction is an explicit task under the current lease:

```text
policy decision
  -> phase compacting
  -> Compaction.Started
  -> summary stream/checkpoints
  -> Compaction.Ended or Failed
  -> barrier
  -> reload durable projected history
  -> phase dispatching
```

Partial summaries never become model context. Process loss terminalizes the
compaction as failed/process-lost and leaves original context authoritative.

## 21. Interrupt Contract

Interrupt has accepted and terminal milestones.

Accepted is returned only after generation invalidation, lease clear, and
cancellation state commit. A normal-database p95 threshold is 500ms. Failure to
commit returns a typed PersistenceError; UI must not claim idle.

Terminal follows provider/tool/compaction cancellation, checkpoint flush,
synthetic or abandoned tool settlement, atomic lifecycle terminalization, and
derived status. The graceful settlement budget is three seconds.

Repeated interrupt is idempotent and cannot duplicate terminal facts,
Tool.Failed, input terminalization, or task notifications.

## 22. Question Tool

Question is exclusive. Its request is bound to generation and request identity.
A reply for a stale generation is rejected. Interrupt atomically settles the
question, tool, step, attempt, turn, and input; it cannot publish idle while an
attempt remains responding.

If a prompt arrives during cancellation, it is admitted but not routed to the
old actor. It becomes a new turn only after terminal settlement.

## 23. Recovery

### 23.1 Planner

```ts
interface RecoveryPlan {
  sessionID: SessionID
  generation: number
  classification:
    | "no-action"
    | "settle-from-durable-output"
    | "safe-to-resume"
    | "needs-user-decision"
    | "abandon"
  evidence: RecoveryEvidence
  actions: RecoveryAction[]
}
```

The planner is read-only. The executor rechecks generation, latest sequence,
owner absence, and action validity.

### 23.2 Startup policy

Starting services scans, classifies, reconciles terminal facts, and publishes
recovery snapshots. It does not start root provider requests, pending root
steers, queues, retries, compaction, tools, or notifications as turns.

Root provider work requires a new user action, explicit resume API, approved
automation/scheduler, or a background-child policy explicitly marked
auto-resumable.

### 23.3 Classification

`settle-from-durable-output` applies when durable output proves completion and
only missing terminal/read-model facts remain.

`safe-to-resume` indicates eligibility, not automatic execution. It includes an
admitted root steer never leased and a provider request proven not dispatched.

`needs-user-decision` covers ambiguous dispatched/responding provider work,
unknown mutation outcome, disconnected approval/question, partial compaction,
unknown shell process, remote-tool ambiguity, or sequence inconsistency.

`abandon` records explicit terminal facts without deleting evidence.

Tool retry safety is read-only, idempotent with a real idempotency key,
mutation, or external side effect. An undeclared tool is treated as external
side effect.

## 24. Error Policy

Typed categories distinguish provider authentication, rate limits, retryable
transport, context overflow, tool error, permission denial, cancellation,
compaction, plugin policy, stale lease, abandonment, kernel invariant, and
persistence failure.

Observational plugin hooks are isolated. Policy hooks fail closed. Persistence
failure rolls back the batch, stops subsequent durable actor commands, and
surfaces a Session-local neutral toast with a closable error-details tab. Root
fatal UI remains reserved for application startup/router/database-wide failure.

## 25. Lifecycle Invariants

1. At most one valid lease per Session.
2. Active execution has all required identities.
3. Idle execution has no lease/turn/attempt identity.
4. An input promotes at most once.
5. An input terminalizes at most once.
6. A turn has exactly one terminal outcome.
7. A physical attempt has exactly one terminal outcome.
8. A tool call has exactly one model-visible result.
9. No event commits after its generation is terminal.
10. Status is derived, not an independent durable truth.
11. Batch failure changes no event, sequence, read model, or execution snapshot.
12. Interrupt/prompt races do not lose the admitted input.
13. Startup performs zero root provider calls.
14. Recovery never silently repeats an uncertain mutation.
15. Notification delivery cannot replace an active turn owner.

## 26. Plugin and Capability Architecture

### 26.1 Manifest and contributions

```ts
interface PluginManifest {
  id: PluginID
  version: string
  targets: PluginTarget[]
  requires: ServiceRequirement[]
  capabilities: PluginCapability[]
  permissions: PluginPermission[]
}

interface PluginModule {
  manifest: PluginManifest
  mount(ctx: PluginContext): Effect<PluginContribution, PluginActivationError>
}
```

Mount returns structured services, tools, hooks, commands, skills, agents, MCP,
LSP, and UI contributions. It does not mutate Config.

### 26.2 Dependency and activation lifecycle

Required services delay activation with explicit `waiting_dependency`. Optional
services are queried at use time. Provider disappearance disposes dependents;
reappearance may remount them.

Activation states are disabled, resolving, waiting dependency, activating,
ready, degraded, failed, and disposing. Mount code has an eight-second
deadline; disposer reclamation has a five-second deadline. Plugin generation
fences late async registration.

### 26.3 Scoped ownership

Plugin scope owns listeners, tools, hooks, commands, skills, MCP/LSP clients,
fibers, timers, services, and finalizers. Registries store plugin ID, version,
generation, Location, and optional group. Disposal atomically removes all
contributions.

### 26.4 Event modes

- durable facts: post-commit read-only observation;
- runtime observations: isolated transient broadcast;
- decisions: deterministic typed policy where deny is monotonic;
- transforms: immutable input, Schema-validated output, frozen final value;
- around hooks: at-most-once `next`, typed short circuit, scoped cancellation.

### 26.5 Kernel seams

```text
execution.request.transform
execution.response.observe
execution.turn.observe
tool.exposure.transform
tool.prepare.decide
tool.dispatch.around
tool.finalize.transform
compaction.policy.decide
compaction.summary.transform
recovery.advice
status.observe
```

Tool exposure selects from an approved ToolCatalog and cannot create an
executable or increase permissions. It supports anchored/minimal-first tool
surface strategies without changing the kernel loop.

Tool policy may make a parallel tool exclusive, never the reverse. Recovery
advice is advisory; kernel evidence and policy are final.

### 26.6 Permissions

```text
session.history.read
session.metadata.read
session.context.transform
tool.register
tool.exposure.transform
tool.policy
tool.execute.wrap
filesystem.read
filesystem.write
process.spawn
network.request
credential.use
credential.read
provider.transform
mcp.manage
lsp.manage
background-job.manage
ui.command.register
ui.panel.register
```

`credential.use` does not reveal raw values. `credential.read` is separately
high-risk.

No plugin receives raw execution tables, lease tokens, generation writes,
durable sequence writes, terminal commit, projector transactions, cancellation
override, mandatory guard bypass, engine switching, another plugin's scope, or
unapproved executables.

### 26.7 Runtime classes

The manifest distinguishes trusted in-process, isolated worker, and external
runtime. In-process JavaScript is not advertised as OS-sandboxed. Worker
isolation is reserved for a later plugin-runtime project; the manifest field is
defined now to avoid another format change.

## 27. Migration Program

### Phase 0: baseline and contract freeze

- submit the verified `999.0.19` bugfix batch;
- keep `docs/superpowers/handoffs/` excluded;
- regenerate and verify Client artifacts;
- create `999.0.20`;
- define `SessionExecutionEngine` and classic adapter;
- add content-free latency/ownership diagnostics.

### Phase 1: EventV2 atomic batch

Implement and fault-test `publishBatch` with single-event compatibility.

### Phase 2: execution snapshot and fencing

Add engine field, execution table, lease CAS, LifecycleStore, derived status,
and read-only recovery planning without a real provider.

### Phase 3: minimal provider turn

Support prompt, text/reasoning, no tools, provider errors/retry, interrupt, and
terminal batches. Unsupported capabilities fail loudly.

### Phase 4: checkpoints

Add bounded streaming checkpoints, reconnect hydration, and checkpoint flush.

### Phase 5: staged tools

Add ordered prepare, bounded dispatch, ordered finalization, error results,
exclusive barriers, and abort settlement.

### Phase 6: shell and background jobs

Integrate automatic/manual background transfer, output/status tools, process
termination, and real Windows cancellation gates.

### Phase 7: compaction

Add explicit compaction phase, cancellation, overflow policy, restart
settlement, durable reload, and UI phase reporting.

### Phase 8: steer, queue, and follow-up

Move delivery semantics, prompt/interrupt races, quiet/waking mailboxes, and
notification boundaries to the kernel.

### Phase 9: subagents

Run child Sessions through independent kernels, durable TaskSubmission/outbox,
continuable follow-up, event-driven wait, bounded concurrency, and restart
reconciliation.

### Phase 10: kernel plugin host

Add scoped service injection and migrate official auth, exposure, search,
compaction, guard, skill, command, and Marketplace contributions.

### Phase 11: product opt-in

DEV exposes Classic/Kernel for new Sessions. Desktop, Web, TUI, CLI, ACP,
Provider, Plugin, shell, compaction, and subagent flows run against kernel
Sessions.

### Phase 12: shadow contracts and long runs

Feed recorded/mock events to both engines without duplicating real provider side
effects. Run concurrency, restart, interruption, SQLite contention, large
reasoning, plugin reload, and long-session gates.

### Phase 13: kernel default

After all gates, new Sessions default to kernel. Keep Classic only in DEV for
one observation release.

### Phase 14: delete classic

Remove classic runner wiring, old turn/attempt tables or convert required
history to append-only read models, old startup recovery, classic repair
helpers, engine toggle, and classic-only compatibility events. Old classic
Sessions become export/delete-only or hidden; no migration is added.

## 28. Acceptance Budgets

| Metric | Target |
|---|---:|
| interrupt durable acceptance p95 | at most 500ms under normal DB conditions |
| interrupt terminal p95 without external background job | at most 3s |
| PublicationActor mailbox | bounded, no unbounded growth |
| first live delta relative to classic | no more than 10% regression |
| checkpoint rate | at most 4/s/active part outside boundaries |
| idle kernel CPU | near zero |
| startup root provider calls | zero |
| plugin permanently pending | zero |
| duplicate or missing terminal facts | zero |
| valid active leases per Session | at most one |

Metrics are recorded separately on Windows, Linux, and macOS.

## 29. Fault Matrix

Inject failure or process loss:

- before and inside atomic start;
- after start commit;
- after provider dispatch;
- after first checkpoint;
- during question wait;
- during tool dispatch and finalization;
- inside terminal projector;
- after terminal commit before listener notification;
- during outbox creation;
- during compaction;
- during interrupt.

Recovery may produce only idle, settle-from-durable-output, safe-to-resume,
needs-user-decision, or abandoned. It may not produce permanent
busy/responding or silently repeat uncertain side effects.

## 30. Test Gates

Every phase runs package-local Schema, Core, Protocol, Server, Client, OpenCode,
App, Session UI, Desktop, TUI, and ACP checks appropriate to changed public
surfaces. Public HttpApi changes regenerate Client; generated files are never
hand-edited.

Mandatory system tests include:

- real server process restart;
- installed Desktop restart;
- real Windows process abort before and after spawn;
- long foreground shell and manual/automatic background transfer;
- question interrupt;
- prompt submitted during interrupt;
- provider output followed by transport loss;
- compaction process loss;
- parent active/idle child completion;
- plugin disable/re-enable with late callbacks;
- OAuth failure without network proxy;
- 1,000 scripted turns;
- 100 concurrent Sessions;
- ten parallel-safe calls per step;
- repeated interrupt/resume;
- large reasoning stream and SQLite contention.

## 31. Cutover and Rollback

Before kernel-default cutover, the new-Session default can return to classic.
An existing kernel Session never switches engine. Additive schema is retained;
kernel events are not deleted; classic never adopts a kernel lease.

After classic deletion there is no runtime rollback to classic. Kernel defects
are repaired through kernel recovery and new code, not by restoring dual
runners.

## 32. Branch and Commit Policy

- finish and commit the current `999.0.19` bugfix batch first;
- start production kernel work on `999.0.20`;
- keep phase commits independently testable;
- do not mix unrelated V1-to-V2 cleanup into a kernel commit;
- do not commit `docs/superpowers/handoffs/`;
- do not push until the user explicitly requests it.

## 33. Decision Log

1. Durable Execution Kernel is the first harness-redesign subproject.
2. Use a temporary parallel engine router, then delete Classic.
3. DSH supplies composition style; Codex supplies lifecycle correctness.
4. I-harness supplies selected algorithms/tests, never a runtime dependency.
5. Keep Effect, typed Schema, EventV2, Location, and OpenCode product surfaces.
6. Add atomic durable batches rather than a global provisional-live channel.
7. Introduce durable generation and opaque lease fencing.
8. Derive Status instead of persisting it as independent truth.
9. Startup performs no root provider execution.
10. Tools collect before bounded execution and commit results in model order.
11. Normal tool failures remain model-visible results.
12. Plugin capabilities are typed, scoped, permissioned, and excluded from raw
    lifecycle authority.
13. Old Session data is not migrated.
14. Classic is removed after an observation release; no hidden fallback remains.

## 34. Definition of Done

The redesign is complete only when:

- new Sessions use Kernel by default across every product surface;
- all lifecycle invariants and fault-matrix tests pass;
- stop/restart/compaction/tool/subagent/plugin gates pass on supported platforms;
- Classic cannot be selected or invoked;
- `SessionExecutionLocal` and classic lifecycle repair are deleted;
- old turn/attempt coordination tables no longer drive runtime state;
- Kernel has no V1 runtime dependency or projection;
- no startup path automatically runs a root provider request;
- no stale generation can commit a durable execution fact;
- no tool call, attempt, turn, or promoted input lacks one terminal outcome;
- generated clients, SDKs, docs, and migration status accurately describe the
  final architecture.
