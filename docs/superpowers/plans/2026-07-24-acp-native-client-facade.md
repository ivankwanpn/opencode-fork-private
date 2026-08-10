# ACP Native Client Facade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move every ACP operation with an existing native contract to `/api`, with prompt/command completion reconstructed through `sessions.wait` plus the mixed transcript, while retaining only dynamic MCP `add` as a legacy fallback.

**Architecture:** Add an ACP-specific facade that constructs native and legacy generated clients from one transport configuration, returns ACP-compatible values, and privately owns all V2-to-legacy projections. ACP services depend on that narrow interface; the legacy client is reachable only from the facade's MCP `add` method.

**Tech Stack:** TypeScript, Bun 1.3, Effect 4, `@opencode-ai/client`, legacy `@opencode-ai/sdk/v2`, Agent Client Protocol SDK, Bun test.

## Global Constraints

- Follow `docs/superpowers/specs/2026-07-24-acp-native-client-facade-design.md`.
- Do not change the public ACP JSON-RPC protocol or advertised capabilities.
- Do not change generated files under `packages/client/src/generated` or `packages/client/src/generated-effect`.
- Do not import `packages/opencode/src/cli/cmd/run/native-compat.ts` from ACP.
- Do not add a native dynamic MCP registration endpoint in this slice.
- The only ACP legacy request allowed after migration is dynamic MCP `add`.
- Native and legacy generated clients must use the same base URL, headers, and fetch identity.
- Preserve mixed legacy/canonical transcript order and select completed assistant output by admitted user-message identity.
- The project owner explicitly rejected TDD for this phase. Author implementation and test coverage together, but do not run tests, typecheck, formatter, or build until all Phase 8 implementation is complete.
- Run tests only from package directories, never from the repository root.
- The checkout has no usable Git metadata, so commit steps are intentionally omitted.

---

### Task 1: Define the ACP Client Boundary and Shared Transport

**Files:**

- Create: `packages/opencode/src/acp/client.ts`
- Create: `packages/opencode/test/acp/client-fixture.ts`

**Interfaces:**

- Consumes: `OpenCode.make(options)`, `createOpencodeClient(options)`, shared TUI compatibility projections, and `legacyEventProjection()`.
- Produces: `ACPClient.Interface`, a private shared generated-client transport
  factory, and no public escape hatch to either generated client.

- [ ] **Step 1: Define ACP-facing values and the narrow interface**

  Create `src/acp/client.ts` with flat exports and the repository's self-reexport pattern. Derive transcript types from the shared projector instead of duplicating the legacy message union.

  ```ts
  import {
    OpenCode,
    type MessagesListOutput,
    type SessionsListOutput,
  } from "@opencode-ai/client"
  import {
    createOpencodeClient,
    type AssistantMessage,
    type Event,
    type Message,
    type OpencodeClient,
    type Part,
    type SessionMessageResponse,
    type ToolPart,
  } from "@opencode-ai/sdk/v2"
  import { ModelV2 } from "@opencode-ai/core/model"
  import { ProviderV2 } from "@opencode-ai/core/provider"
  import type { Command } from "@/command"
  import type { Provider } from "@/provider/provider"
  import {
    legacyAgentFromNative,
    legacyCommandFromNative,
    legacyProvidersFromNative,
  } from "@opencode-ai/tui/context/catalog-compat"
  import { legacySessionFromNative } from "@opencode-ai/tui/context/session-compat"
  import { legacyTranscriptFromNative } from "@opencode-ai/tui/context/transcript-compat"
  import type { PromptPart } from "./content"

  export type SessionInfo = ReturnType<typeof legacySessionFromNative>
  export type Transcript = ReturnType<typeof legacyTranscriptFromNative>
  export type LegacyAssistantMessage = AssistantMessage
  export type LegacyEvent = Event
  export type LegacyMessage = Message
  export type LegacyPart = Part
  export type LegacySessionMessage = SessionMessageResponse
  export type LegacyToolPart = ToolPart
  export type ModelSelection = {
    readonly providerID: string
    readonly modelID: string
  }
  export type CompletionInput = {
    readonly sessionID: string
    readonly model: ModelSelection
    readonly variant?: string
    readonly agent?: string
    readonly parts: readonly PromptPart[]
    readonly signal?: AbortSignal
  }
  export type CommandInput = CompletionInput & {
    readonly command: string
    readonly arguments: string
  }
  export type McpConfig = NonNullable<
    Parameters<OpencodeClient["mcp"]["add"]>[0]["config"]
  >
  export type EventEnvelope = {
    readonly directory?: string
    readonly workspace?: string
    readonly payload: Event
  }

  export type Catalog = {
    readonly providers: Record<ProviderV2.ID, Provider.Info>
    readonly agents: ReadonlyArray<{
      readonly name: string
      readonly mode: "subagent" | "primary" | "all"
      readonly hidden?: boolean
      readonly description?: string
    }>
    readonly commands: readonly Command.Info[]
    readonly configuredModel?: string
  }

  export interface Interface {
    readonly session: {
      readonly create: (input: {
        readonly directory: string
        readonly agent?: string
        readonly model?: { readonly providerID: string; readonly modelID: string; readonly variant?: string }
      }) => Promise<SessionInfo>
      readonly get: (input: { readonly sessionID: string }) => Promise<SessionInfo>
      readonly list: (input: { readonly directory?: string }) => Promise<readonly SessionInfo[]>
      readonly messages: (input: {
        readonly sessionID: string
        readonly limit?: number
      }) => Promise<Transcript>
      readonly message: (input: {
        readonly sessionID: string
        readonly messageID: string
      }) => Promise<SessionMessageResponse | undefined>
      readonly fork: (input: {
        readonly sessionID: string
        readonly messageID?: string
      }) => Promise<SessionInfo>
      readonly interrupt: (input: { readonly sessionID: string }) => Promise<void>
      readonly prompt: (input: CompletionInput) => Promise<SessionMessageResponse>
      readonly command: (input: CommandInput) => Promise<SessionMessageResponse>
      readonly compact: (input: { readonly sessionID: string; readonly signal?: AbortSignal }) => Promise<void>
    }
    readonly events: {
      readonly subscribe: (input?: { readonly signal?: AbortSignal }) => AsyncIterable<EventEnvelope>
    }
    readonly permission: {
      readonly reply: (input: {
        readonly sessionID: string
        readonly requestID: string
        readonly reply: "once" | "always" | "reject"
      }) => Promise<void>
    }
    readonly catalog: {
      readonly load: (directory: string) => Promise<Catalog>
    }
    readonly config: {
      readonly get: (directory: string) => Promise<{ readonly model?: string }>
    }
    readonly mcp: {
      readonly add: (input: {
        readonly directory: string
        readonly name: string
        readonly config: McpConfig
      }) => Promise<void>
    }
  }

  export * as ACPClient from "./client"
  ```

  The completion input deliberately carries the same prompt parts for normal
  prompts and commands so command file/resource attachments retain their
  source data.

- [ ] **Step 2: Construct both generated clients from one private transport factory**

  Implement private construction without exposing the generated clients.
  Task 4 assembles the public `make()` only after every interface member has a
  concrete implementation:

  ```ts
  type GeneratedClients = {
    readonly native: ReturnType<typeof OpenCode.make>
    readonly legacy: OpencodeClient
  }

  function generatedClients(options: {
    readonly baseUrl: string
    readonly headers?: HeadersInit
    readonly fetch?: typeof globalThis.fetch
  }): GeneratedClients {
    const fetch = options.fetch ?? globalThis.fetch
    const native = OpenCode.make({
      baseUrl: options.baseUrl,
      headers: options.headers,
      fetch,
    })
    const legacy = createOpencodeClient({
      baseUrl: options.baseUrl,
      headers: options.headers,
      fetch,
    })
    return { native, legacy }
  }
  ```

  Do not add placeholder facade methods. Task 2 and Task 3 add concrete
  Session slices; Task 4 adds the remaining slices and public assembly.

- [ ] **Step 3: Add a reusable recording-transport fixture**

  In `test/acp/client-fixture.ts`, export a fetch implementation that records
  method, URL, headers, body, and fetch identity. Return valid generated-client
  envelopes from the responder supplied by later facade tests.

  ```ts
  type RecordedRequest = {
    readonly method: string
    readonly url: URL
    readonly headers: Headers
    readonly body: unknown
  }

  const json = (value: unknown, status = 200) =>
    new Response(JSON.stringify(value), {
      status,
      headers: { "content-type": "application/json" },
    })

  function recorder(respond: (request: RecordedRequest) => Response | Promise<Response>) {
    const requests: RecordedRequest[] = []
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const request = new Request(input, init)
      const item = {
        method: request.method,
        url: new URL(request.url),
        headers: request.headers,
        body: request.body ? await request.clone().json() : undefined,
      }
      requests.push(item)
      return respond(item)
    }
    return { fetch, requests }
  }
  ```

  Do not construct either generated client in this fixture and do not add a
  transport behavior assertion yet. Task 4 exercises the private factory
  through public `ACPClient.make()` and proves native and fallback requests
  both use this exact recorder function and auth header.

### Task 2: Implement Native Lifecycle and Mixed Transcript Reads

**Files:**

- Modify: `packages/opencode/src/acp/client.ts`

**Interfaces:**

- Consumes: native `sessions` and `messages` groups plus shared Session/transcript projections.
- Produces: a private
  `Pick<Interface["session"], "create" | "get" | "list" | "messages" |
  "message" | "fork" | "interrupt">` with native-only lifecycle
  reads/writes and chronological legacy-compatible transcript values.

- [ ] **Step 1: Project Session create/get/list/fork and interrupt**

  Add `sessionLifecycle(native)` returning the lifecycle `Pick` above. Use
  native routes and the shared Session projector:

  ```ts
  const location = (directory: string) => ({ directory })

  const session = {
    create: async (input: CreateInput) =>
      legacySessionFromNative(
        await native.sessions.create({
          agent: input.agent,
          model: input.model
            ? {
                providerID: input.model.providerID,
                id: input.model.modelID,
                ...(input.model.variant ? { variant: input.model.variant } : {}),
              }
            : undefined,
          location: location(input.directory),
        }),
      ),
    get: async (input: { readonly sessionID: string }) =>
      legacySessionFromNative(await native.sessions.get(input)),
    list: async (input: { readonly directory?: string }) => {
      const data: SessionsListOutput["data"][number][] = []
      let cursor: string | undefined
      while (true) {
        const page = await native.sessions.list({
          directory: input.directory,
          order: "desc",
          limit: 100,
          ...(cursor ? { cursor } : {}),
        })
        data.push(...page.data)
        const next = page.cursor.next ?? undefined
        if (!next || next === cursor) break
        cursor = next
      }
      return data.map(legacySessionFromNative)
    },
    fork: async (input: ForkInput) =>
      legacySessionFromNative(await native.sessions.fork(input)),
    interrupt: (input: { readonly sessionID: string }) =>
      native.sessions.interrupt(input),
  }
  ```

  Preserve ACP's root-session filtering in `service.ts` after projection, since
  the native list route exposes `parentID` instead of a legacy `roots` query.

- [ ] **Step 2: Read every requested mixed-transcript page in ascending order**

  Add a private paginator. For an unbounded read, follow `cursor.next` until it
  is absent. For a bounded read, stop once the requested count is collected.

  ```ts
  async function nativeMessages(sessionID: string, limit?: number) {
    const data: MessagesListOutput["data"][number][] = []
    let cursor: string | undefined
    while (limit === undefined || data.length < limit) {
      const page = await native.messages.list({
        sessionID,
        order: "asc",
        limit: Math.min(limit === undefined ? 100 : limit - data.length, 100),
        ...(cursor ? { cursor } : {}),
      })
      data.push(...page.data)
      const next = page.cursor.next ?? undefined
      if (!next || next === cursor) break
      cursor = next
    }
    return limit === undefined ? data : data.slice(0, limit)
  }
  ```

  Fetch the native Session once and call:

  ```ts
  return legacyTranscriptFromNative({
    session: await native.sessions.get({ sessionID }),
    messages: await nativeMessages(sessionID, limit),
  })
  ```

- [ ] **Step 3: Project an individual native message**

  Call `native.sessions.message` first so missing-message behavior comes from
  the native individual-message contract. A canonical assistant cannot be
  projected in isolation because the shared projector derives its parent from
  chronological user input, so read the complete mixed transcript and select
  the corresponding projected ID:

  ```ts
  const message = await native.sessions.message(input)
  const projected = await session.messages({ sessionID: input.sessionID })
  return projected.find((item) => item.info.id === message.id)
  ```

  Treat native message-not-found as `undefined` only for ACP event metadata
  recovery; propagate all other errors.

### Task 3: Implement ACP Completion Semantics

**Files:**

- Modify: `packages/opencode/src/acp/client.ts`

**Interfaces:**

- Consumes: native switch-agent/model, prompt, command, compact, wait, and mixed transcript reads.
- Produces: a private
  `Pick<Interface["session"], "prompt" | "command" | "compact">` that returns
  terminal `SessionMessageResponse` for ACP prompt/command and `void` for
  compact.

- [ ] **Step 1: Translate ACP prompt and command inputs**

  Add local helpers equivalent to the data-only portions of the run adapter,
  but do not import that adapter:

  ```ts
  function prompt(parts: readonly PromptPart[]) {
    return {
      text: parts
        .filter(
          (part): part is Extract<PromptPart, { type: "text" }> =>
            part.type === "text" && part.ignored !== true,
        )
        .map((part) => part.text)
        .join(""),
      files: parts
        .filter((part): part is Extract<PromptPart, { type: "file" }> => part.type === "file")
        .map((part) => ({
          uri: part.url,
          mime: part.mime,
          name: part.filename,
          source: part.source?.text
            ? {
                text: part.source.text.value,
                start: part.source.text.start,
                end: part.source.text.end,
              }
            : undefined,
          resource:
            part.source?.type === "resource"
              ? { clientName: part.source.clientName, uri: part.source.uri }
              : undefined,
        })),
    }
  }
  ```

  `PromptPart` is exactly the legacy text/file input union. Preserve text
  order, keep synthetic text model-visible, exclude `ignored` text as the V1
  provider projection does, and preserve file source ranges, resource
  identity, MIME, and filename. Do not invent system/tool/agent fields that
  are absent from the ACP input type.

- [ ] **Step 2: Apply optional agent and model selection before admission**

  Add one helper used by prompt and command:

  ```ts
  async function select(input: CompletionSelection) {
    if (input.agent) {
      await native.sessions.switchAgent({
        sessionID: input.sessionID,
        agent: input.agent,
      })
    }
    if (input.model) {
      await native.sessions.switchModel({
        sessionID: input.sessionID,
        model: {
          providerID: input.model.providerID,
          id: input.model.modelID,
          ...(input.variant ? { variant: input.variant } : {}),
        },
      })
    }
  }
  ```

- [ ] **Step 3: Complete prompt/command by admitted parent identity**

  Add `sessionCompletion(native, lifecycle)` returning the completion `Pick`.
  Add one private completion helper:

  ```ts
  async function completed(
    sessionID: string,
    admittedID: string,
    signal?: AbortSignal,
  ): Promise<SessionMessageResponse> {
    await native.sessions.wait({ sessionID }, { signal })
    const messages = await session.messages({ sessionID })
    const assistant = messages.find(
      (message) =>
        message.info.role === "assistant" &&
        message.info.parentID === admittedID &&
        message.info.time.completed !== undefined,
    )
    if (!assistant) {
      throw new Error(`Completed assistant message not found for ${admittedID}`)
    }
    return assistant
  }
  ```

  Prompt supplies `sessionID`, the translated prompt, and `resume: true` to
  native `sessions.prompt`. Command supplies `sessionID`, command name,
  arguments, selected agent/model, translated files, and `resume: true` to
  native `sessions.command`. Both pass the admitted message's `id` to
  `completed`. Do not return the last assistant in the transcript.

- [ ] **Step 4: Complete compact through native wait**

  Implement:

  ```ts
  compact: async (input) => {
    await native.sessions.compact(
      { sessionID: input.sessionID },
      { signal: input.signal },
    )
    await native.sessions.wait(
      { sessionID: input.sessionID },
      { signal: input.signal },
    )
  }
  ```

### Task 4: Implement Native Events, Permissions, Catalog, and MCP Fallback

**Files:**

- Modify: `packages/opencode/src/acp/client.ts`
- Create: `packages/opencode/test/acp/client.test.ts`
- Modify: `packages/opencode/test/acp/client-fixture.ts`

**Interfaces:**

- Consumes: native global EventV2 stream, native permission/catalog/config endpoints, and private legacy MCP client.
- Produces: ACP-compatible global events, explicit native permission replies,
  merged Directory catalog input, one auditable fallback, and the public
  `ACPClient.make(options)` assembly.

- [ ] **Step 1: Project native EventV2 per subscription**

  Create projection state inside each `subscribe()` iterator:

  ```ts
  async function* events(input?: { readonly signal?: AbortSignal }) {
    const projectLegacy = legacyEventProjection()
    for await (const source of native.events.subscribe({ signal: input?.signal })) {
      for (const payload of legacyEventPayloads(
        projectLegacy,
        source as Parameters<typeof legacyEventPayloads>[1],
      )) {
        yield {
          directory: source.location?.directory,
          workspace: source.location?.workspaceID,
          payload: payload as Event,
        }
      }
    }
  }
  ```

  Do not share `projectLegacy` across ACP connections.
  Project each native payload through a small guarded helper. If projection of
  one payload throws, report no projected events for that payload and continue
  the same native iterator; do not terminate the ACP subscription or expose
  the raw projection exception over JSON-RPC.

- [ ] **Step 2: Reply to permissions with explicit Session ownership**

  Implement only:

  ```ts
  permission: {
    reply: (input) =>
      native.permissions.reply({
        sessionID: input.sessionID,
        requestID: input.requestID,
        reply: input.reply,
      }),
  }
  ```

  Do not maintain a request-to-Session map in the facade.

- [ ] **Step 3: Load the full native catalog for one Location**

  Implement `config.get(directory)` with native
  `native.config.get({ location: { directory } })`, returning only the
  decoded config data needed by ACP.

  Fetch provider/model/integration, agent, command, and skill values
  concurrently, alongside the facade's own `config.get(directory)`:

  ```ts
  const target = { location: { directory } }
  const [providers, models, integrations, agents, commands, skills, configuration] =
    await Promise.all([
      native.providers.list(target),
      native.models.list(target),
      native.integrations.list(target),
      native.agents.list(target),
      native.commands.list(target),
      native.skills.list(target),
      config.get(directory),
    ])
  ```

  Use `legacyProvidersFromNative`, `legacyAgentFromNative`, and
  `legacyCommandFromNative`. Merge unique skills into `Command.Info` values,
  sort by name, and return only `configuration.model` as `configuredModel`.

- [ ] **Step 4: Isolate dynamic MCP add**

  Implement the only legacy call:

  ```ts
  mcp: {
    add: async (input) => {
      await legacy.mcp.add(
        {
          directory: input.directory,
          name: input.name,
          config: input.config,
        },
        { throwOnError: true },
      )
    },
  }
  ```

  No other method in `client.ts` may reference `legacy`.

- [ ] **Step 5: Add boundary coverage without running it**

  Create `client.test.ts` with the recording fixture and prove all facade
  slices completed by Tasks 2–4:

  - native and fallback requests both invoke the exact fetch function supplied
    to public `ACPClient.make()` and carry the same authorization header;
  - create uses `POST /api/session` with `location.directory`;
  - get, list, fork, and interrupt use only `/api/session`,
    `/api/session/:sessionID`, `/api/session/:sessionID/fork`, and
    `/api/session/:sessionID/interrupt`;
  - Session list follows `cursor.next` beyond 100 entries, suppresses an
    unchanged cursor, and retains `parentID`;
  - mixed transcript pages follow `cursor.next`, preserve chronological
    imported/canonical messages, and individual message lookup uses the native
    message route before full projection;
  - prompt body preserves model variant and all supported prompt parts;
  - prompt text retains synthetic content and excludes ignored content;
  - prompt order is switch-agent, switch-model, admit, wait, transcript;
  - command preserves command, arguments, file/resource source, and variant;
  - coalesced assistant messages return to callers by admitted parent ID;
  - wait occurs exactly once per prompt/command;
  - missing matching assistant rejects through the stable Session boundary;
  - assistant abort/output-limit/auth/error projection remains available to
    ACP stop-reason handling;
  - compact invokes `/api/session/:id/compact` then `/wait`, with no fabricated
    message;
  - each subscription has isolated EventV2 projection state;
  - one malformed projection is skipped and a following valid event still
    reaches the same iterator;
  - native text, reasoning, tool progress/completion, attachment, permission,
    and error events project once to existing ACP event shapes;
  - permission reply posts Session ID, request ID, and reply to the native
    permission route;
  - all seven catalog reads use `/api` and the same Location;
  - duplicate command/skill names prefer commands and output is sorted;
  - MCP add is the sole request to a non-`/api` path;
  - an allowlist assertion fails if any recorded non-`/api` path other than
    `/mcp` appears.

- [ ] **Step 6: Assemble the public facade without stubs**

  Construct generated clients once, build both Session picks, and return the
  complete interface:

  ```ts
  export function make(options: ClientOptions): Interface {
    const clients = generatedClients(options)
    const lifecycle = sessionLifecycle(clients.native)
    const completion = sessionCompletion(clients.native, lifecycle)
    return {
      session: { ...lifecycle, ...completion },
      events: { subscribe: events(clients.native) },
      permission: permission(clients.native),
      catalog: catalog(clients.native),
      config: config(clients.native),
      mcp: mcp(clients.legacy),
    }
  }
  ```

  `legacy` is passed only into `mcp()`. No other slice can access it.

### Task 5: Migrate ACP Consumers to the Facade

**Files:**

- Modify: `packages/opencode/src/cli/cmd/acp.ts`
- Modify: `packages/opencode/src/acp/agent.ts`
- Modify: `packages/opencode/src/acp/service.ts`
- Modify: `packages/opencode/src/acp/event.ts`
- Modify: `packages/opencode/src/acp/permission.ts`
- Modify: `packages/opencode/src/acp/session.ts`
- Modify: `packages/opencode/src/acp/usage.ts`
- Modify: `packages/opencode/test/acp/service-session.test.ts`
- Modify: `packages/opencode/test/acp/event.test.ts`
- Modify: `packages/opencode/test/acp/permission.test.ts`
- Modify: `packages/opencode/test/acp/usage.test.ts`
- Modify: `packages/opencode/test/cli/acp/lifecycle.test.ts`
- Modify: `packages/opencode/test/cli/acp/prompt-content.test.ts`

**Interfaces:**

- Consumes: completed `ACPClient.Interface`.
- Produces: ACP production and tests with no `OpencodeClient` dependency outside `acp/client.ts`.

- [ ] **Step 1: Construct the facade in the ACP command**

  Replace the direct legacy SDK construction:

  ```ts
  const client = ACPClient.make({
    baseUrl: `http://${server.hostname}:${server.port}`,
    headers: ServerAuth.headers(),
  })
  const agent = ACP.init({ client })
  ```

  Update `ACP.init` and `ACPService.make` to accept `client:
  ACPClient.Interface`.

  Replace production imports of legacy `Message`, `AssistantMessage`, `Part`,
  `ToolPart`, `SessionMessageResponse`, and `Event` in ACP modules with the
  corresponding `ACPClient.Legacy*` aliases. Only `acp/client.ts` may import
  the legacy SDK.

- [ ] **Step 2: Replace lifecycle and Directory calls in service**

  Convert calls from generated response wrappers to facade values:

  ```ts
  const created = yield* profiledRequest(
    "acp.newSession.session.create",
    () =>
      input.client.session.create({
        directory: params.cwd,
        ...(modeId ? { agent: modeId } : {}),
        model: {
          providerID: selected.providerID,
          modelID: selected.modelID,
          ...(variant ? { variant } : {}),
        },
      }),
    "session",
  )
  ```

  Apply the same pattern to get/list/messages/fork/interrupt. Filter
  `parentID === undefined` in ACP list logic to preserve legacy `roots: true`.

  Replace `loadDirectorySnapshot(sdk, directory)` with
  `client.catalog.load(directory)` and retain ACP's default model, mode,
  command, and variant selection policy.

  Remove the `SdkResponse<T>` and `isSdkResponse` compatibility branch.
  `request` and `profiledRequest` now accept direct facade promises:

  ```ts
  function request<T>(fn: () => Promise<T>, service?: string) {
    return Effect.tryPromise({
      try: fn,
      catch: (error) => fromUnknownError(error, service),
    })
  }

  function profiledRequest<T>(name: string, fn: () => Promise<T>, service?: string) {
    return request(() => ACPProfile.measure(name, fn), service)
  }
  ```

- [ ] **Step 3: Replace prompt, command, compact, and usage calls**

  Call facade completion methods directly:

  ```ts
  const response = yield* request(
    () =>
      input.client.session.prompt({
        sessionID: current.id,
        model: selected,
        variant,
        agent: modeId,
        parts,
      }),
    "session",
  )
  return yield* promptResponse(response.info, params.messageId)
  ```

  Use `client.session.command(...)` for known commands and
  `client.session.compact(...)` for `/compact`.

  Rename `messageLoaderFromSDK` to `messageLoaderFromClient`, and make its
  narrow input depend on `ACPClient.Interface["session"]["messages"]`.

- [ ] **Step 4: Replace event and permission dependencies**

  `ACPEvent.Subscription` accepts `client`. Its reconnect loop iterates:

  ```ts
  for await (const event of this.input.client.events.subscribe({
    signal: this.abort.signal,
  })) {
    if (this.abort.signal.aborted) return
    await this.handle(event.payload).catch(() => {})
  }
  ```

  Metadata recovery calls `client.session.message`.

  `ACPPermission.Handler.reply` receives Session ID explicitly:

  ```ts
  private async reply(
    sessionID: string,
    requestID: string,
    reply: Reply,
  ) {
    await this.input.client.permission.reply({
      sessionID,
      requestID,
      reply,
    })
  }
  ```

  Update every reject/allow call site to pass `permission.sessionID`.

- [ ] **Step 5: Replace legacy-shaped test doubles with ACPClient doubles**

  Add a focused `makeClient(overrides)` helper in each affected test file or a
  shared `test/acp/client-fixture.ts` only if at least three suites can reuse
  it. Return direct values, not `{ data }` wrappers.

  Strengthen existing assertions:

  - permission replies equal
    `{ sessionID: "ses_a", requestID: "perm_1", reply: "once" }`;
  - service prompt/command tests receive a completed
    `SessionMessageResponse`;
  - event tests consume `events.subscribe()` directly;
  - usage tests load facade transcripts;
  - CLI subprocess tests continue to validate session create/load/list/resume,
    prompt content, cancel, and clean shutdown through the real server.

- [ ] **Step 6: Add a static legacy-boundary assertion**

  In `client.test.ts`, scan only the production ACP source directory and assert
  that `@opencode-ai/sdk/v2` and `createOpencodeClient` occur solely in
  `src/acp/client.ts`. Also assert that `src/cli/cmd/acp.ts` imports
  `ACPClient`, not the legacy SDK.

### Task 6: Phase 8 Review and Deferred Verification Gate

**Files:**

- Review: all files from Tasks 1-5
- Verify: all Phase 8 production and test files
- Update after fresh evidence only: Phase 8 plans and parity table

**Interfaces:**

- Consumes: the completed ACP facade plus every other Phase 8 slice.
- Produces: fresh package-scoped test, typecheck, and build evidence.

- [ ] **Step 1: Perform static review before executing commands**

  Confirm:

  - no generated file changed;
  - no `OpencodeClient` import remains in ACP production files except
    `src/acp/client.ts`;
  - `legacy` is referenced exactly once in facade implementation, inside MCP
    `add`;
  - prompt and command use `resume: true`, `sessions.wait`, and parent-ID
    selection;
  - transcript pagination cannot repeat an unchanged cursor;
  - all event projection state is subscription-local;
  - no `.only`, accidental `.skip`, conflict markers, or test weakening was
    introduced.

- [ ] **Step 2: Run the ACP package tests only after all Phase 8 code is complete**

  From `D:\agent-admix\opencode-fork\packages\opencode`:

  ```text
  bun test --timeout 30000 test/acp test/cli/acp
  ```

  Expected: all selected ACP unit, service, event, permission, usage, and
  subprocess tests pass with zero failures.

- [ ] **Step 3: Run the complete affected Phase 8 suites**

  From each owning package directory, run the assembled Phase 8 test list,
  including:

  ```text
  packages/core:
    bun test --timeout 30000 test/session-runner.test.ts test/session-wait.test.ts test/session-prompt-expansion.test.ts

  packages/tui:
    bun test --timeout 30000 test/context/native-event-recovery.test.ts test/cli/tui/use-native-event.test.tsx

  packages/opencode:
    bun test --timeout 30000 test/tool/plugin-compat-v2.test.ts test/server/httpapi-session.test.ts test/server/transcript-read.test.ts test/acp test/cli/acp
  ```

  Add the remaining Phase 8 CLI/TUI/session lifecycle suites from the root
  Phase 8 checklist before execution. Expected: zero failures; only
  pre-existing documented skips are allowed.

- [ ] **Step 4: Run package typechecks**

  Run `bun typecheck` from every affected package directory and the repository
  root's established turborepo command only where the root Phase 8 gate
  requires it. Expected: all affected packages typecheck with zero errors.

- [ ] **Step 5: Build and smoke the Windows binary**

  Run the existing Phase 8 single-binary build command from its established
  directory with output isolated under `D:\agent-admix\.phase8-test`.
  Execute the resulting binary's version command and the planned ACP/CLI smoke
  flows. Expected: build exit code `0`, correct version output, and successful
  smoke flows.

- [ ] **Step 6: Update plans and parity only from this fresh gate**

  Mark ACP and other Phase 8 plan items complete only when their owning tests,
  affected typechecks, and build evidence pass. Record dynamic MCP `add` as the
  sole explicit ACP fallback; do not describe ACP as zero-legacy until a
  native dynamic add contract replaces it.
