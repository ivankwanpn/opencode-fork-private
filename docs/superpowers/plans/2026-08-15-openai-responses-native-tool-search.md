# OpenAI Responses Native Tool Search Implementation Plan

> **完成狀態（2026-08-15）：** Task 1–5 與 post-implementation review hardening 已實作並通過 package-local 測試與型別檢查。OpenAI Responses native 路徑只由明確 model compatibility 啟用；Anthropic native、自動 capability downgrade 持久化與 child-OS-process E2E 維持非目標／後續工作。

> **For Codex:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Add Codex-style OpenAI Responses `tool_search` / `tool_search_output` without weakening the existing canonical Tool Registry, durable discovery projection, generic fallback, or provider capability boundaries.

**Architecture:** Keep search, authorization, execution, and durability in Core. Extend the LLM request algebra with explicit provider-neutral discovery semantics: a tool definition identifies a discovery tool or a deferred function, and durable completed searches are carried as typed discovery records. The OpenAI Responses adapter lowers those semantics to native wire items only when the resolved model explicitly advertises the capability. Generic protocols ignore native history records and continue lowering every semantic definition as an ordinary function. OpenAI OAuth through the ChatGPT Codex endpoint is the first fail-closed capability source; normal OpenAI API and compatible proxies remain generic until explicitly proven and configured.

**Reference:** `D:\agent-complete\codex-rust-v0.146.0`, especially `codex-rs/core/src/tools/handlers/tool_search.rs`, `tool_search_spec.rs`, `codex-rs/tools/src/tool_search.rs`, `codex-rs/core/src/tools/context.rs`, `codex-rs/protocol/src/models.rs`, and `codex-rs/core/tests/suite/search_tool.rs`.

**Non-goals:** Anthropic `tool_reference`, automatic capability downgrade persistence, cluster ownership, and a spawned child-OS-process runner test remain separate phases.

---

## Task 1: Add protocol-neutral tool discovery semantics

**Files:**

- Modify: `packages/llm/src/schema/messages.ts`
- Modify: `packages/llm/src/llm.ts`
- Modify: `packages/llm/src/cache-policy.ts`
- Modify: `packages/llm/test/schema.test.ts`
- Modify: `packages/llm/test/provider/openai-chat.test.ts`

### Step 1: Write failing schema and generic-fallback tests

Add tests proving:

- a discovery tool is represented explicitly and is not inferred from its name;
- a deferred function carries an explicit provider-neutral marker and optional namespace;
- a completed discovery record contains `callID`, normalized query/limit, and current loadable function definitions;
- OpenAI Chat still lowers the discovery tool and deferred definitions as ordinary function tools.

### Step 2: Add the semantic carrier

Extend `ToolDefinition` with a normalized `kind: "function" | "tool-search"`, plus `deferLoading?: true` and `namespace?: string`. Preserve ergonomic callers by defaulting omitted `kind` to `function` in `ToolDefinition.make`; update direct constructors explicitly.

Add `ToolDiscovery` as a provider-neutral request record and add `toolDiscoveries` to `LLMRequest`. This record contains no provider wire fields such as `execution`, `defer_loading`, or `tool_search_output`.

### Step 3: Preserve generic behavior

All non-native protocol lowerers must accept the richer definitions but continue emitting ordinary function definitions. Cache-policy copies must preserve semantic fields.

### Step 4: Verify and commit

From `packages/llm`:

```powershell
bun test test/schema.test.ts test/provider/openai-chat.test.ts
bun typecheck
```

Commit:

```powershell
git commit -m "feat(llm): add tool discovery semantics"
```

---

## Task 2: Rebuild native history from durable Core state

**Files:**

- Modify: `packages/core/src/tool/registry.ts`
- Modify: `packages/core/src/session/tool-discovery.ts`
- Modify: `packages/core/src/session/runner/llm.ts`
- Modify: `packages/core/test/tool-search-deferred.test.ts`
- Modify: `packages/core/test/session-tool-discovery.test.ts`
- Modify: `packages/core/test/session-runner.test.ts`

### Step 1: Write failing Core regressions

Prove that:

- the registry marks only `tool_search` as `kind: "tool-search"`;
- selected deferred definitions are tagged `deferLoading: true`, while direct tools are not;
- durable invocation rows rebuild typed discovery records from the current catalog;
- stale/missing/hash-mismatched catalog entries are omitted from rebuilt loadable specs;
- empty durable results produce a valid record with no tools;
- the runner supplies rebuilt discovery records on every provider turn, including after compaction and runtime reconstruction.

### Step 2: Implement catalog revalidation and record rebuilding

Add a `SessionToolDiscovery.records(db, sessionID, snapshot)` read boundary. Join each durable match to the current permission-filtered catalog by exact ToolKey + definition hash. Reconstruct definitions from the current catalog rather than storing schemas in the event log.

### Step 3: Tag registry definitions

Create the search definition with explicit `kind: "tool-search"`. Copy selected deferred definitions with `deferLoading: true` and their namespace. Do not mark direct tools.

### Step 4: Pass records to the LLM request

After materialization, attach rebuilt discovery records to `LLMRequest`. Generic protocols ignore the records and continue receiving selected ordinary definitions.

### Step 5: Verify and commit

From `packages/core`:

```powershell
bun test test/tool-search-deferred.test.ts test/session-tool-discovery.test.ts test/session-runner.test.ts
bun typecheck
```

Commit:

```powershell
git commit -m "feat(core): rebuild native tool discovery history"
```

---

## Task 3: Add a fail-closed OpenAI Responses capability

**Files:**

- Modify: `packages/llm/src/schema/options.ts`
- Modify: `packages/core/src/session/runner/model.ts`
- Modify: `packages/core/test/session-runner-model.test.ts`
- Modify: `packages/llm/test/schema.test.ts`

### Step 1: Write failing capability tests

Prove that:

- OpenAI OAuth resolved to `https://chatgpt.com/backend-api/codex` advertises native Responses Tool Search;
- ordinary OpenAI API-key models do not advertise it;
- custom OpenAI-compatible and explicit proxy models do not gain it by provider name or route ID alone.

### Step 2: Add explicit compatibility metadata

Add `toolSearch?: "openai-responses"` to `ModelCompatibility`. Set it only at the OAuth/ChatGPT Codex resolution boundary. The protocol adapter reads this capability; it must not inspect provider IDs, model-name prefixes, or endpoint strings.

### Step 3: Verify and commit

From `packages/llm` and `packages/core`:

```powershell
bun test test/schema.test.ts
bun typecheck

cd ..\core
bun test test/session-runner-model.test.ts
bun typecheck
```

Commit:

```powershell
git commit -m "feat(core): gate native responses tool search"
```

---

## Task 4: Implement native OpenAI Responses lowering and parsing

**Files:**

- Modify: `packages/llm/src/protocols/openai-responses.ts`
- Modify: `packages/llm/test/provider/openai-responses.test.ts`
- Modify: `packages/llm/test/continuation-scenarios.ts` if a reusable scenario is warranted

### Step 1: Write failing request-body tests

Assert that native-capable requests:

- advertise `{ type: "tool_search", execution: "client", description, parameters }`;
- do not advertise the same search as a function;
- do not inject selected `deferLoading` functions into follow-up `tools[]`;
- lower completed searches as paired `tool_search_call` / `tool_search_output` items;
- encode loadable functions with `strict: false` and `defer_loading: true`;
- coalesce same-namespace results deterministically while leaving unnamespaced results as flat functions;
- keep the second and third provider requests free of ordinary discovered-tool injection;
- synthesize a missing pair from durable records before chronological messages after compaction;
- preserve generic Responses behavior when capability is absent.

### Step 2: Extend wire schemas

Add native search tool, call, and output schemas to both HTTP and WebSocket body validation. Accept streamed `tool_search_call` arguments as structured JSON while keeping ordinary function arguments string-validated.

### Step 3: Lower native tools and durable history

Use only `ToolDefinition.kind`, `deferLoading`, `namespace`, `LLMRequest.toolDiscoveries`, and `ModelCompatibility.toolSearch`. Never infer semantics from the literal tool name.

Before lowering chronological messages, identify discovery call IDs already present. Insert any missing durable call/output pairs immediately after system input and before conversation messages. Existing pairs retain their chronological location. Empty/failed searches lower to a completed output with an empty `tools` array.

### Step 4: Parse native calls

Initialize parser state from the semantic search definition. Translate `tool_search_call` into the normal `LLMEvent.toolCall` used by Core, carrying provider metadata for item replay. Preserve namespace metadata on ordinary discovered function calls without changing the executable callable name.

### Step 5: Verify and commit

From `packages/llm`:

```powershell
bun test test/provider/openai-responses.test.ts
bun test
bun typecheck
```

Commit:

```powershell
git commit -m "feat(llm): support native responses tool search"
```

---

## Task 5: Add cross-package runner regression and update status

**Files:**

- Modify: `packages/core/test/session-runner.test.ts`
- Modify: `docs/superpowers/specs/2026-08-11-provider-native-tool-search-design.md`
- Modify: `docs/superpowers/plans/2026-08-15-openai-responses-native-tool-search.md`

### Step 1: Add a three-turn runner regression

Drive search, discovered-tool execution, and final response through one V2 Session. Prepare each captured semantic request with the actual OpenAI Responses adapter and assert:

- first request exposes native Tool Search but no deferred tool;
- second contains native search history and no ordinary deferred definition;
- third retains native search history, contains the ordinary discovered tool call output, and still has no ordinary deferred definition;
- durable selection remains the authorization source.

### Step 2: Run affected suites

Run package-local tests and typechecks:

```powershell
# packages/llm
bun test
bun typecheck

# packages/core
bun test test/session-runner.test.ts test/session-tool-discovery.test.ts test/tool-search-deferred.test.ts test/tool-search-dynamic.test.ts
bun typecheck
```

Then run relevant App/TUI/OpenCode regressions and typechecks if shared public schemas changed.

### Step 3: Update design status honestly

Mark OpenAI Responses native adapter complete only with the measured results. Keep Anthropic native support, automatic downgrade persistence, and child-OS-process E2E explicitly incomplete.

### Step 4: Final repository checks and commit

```powershell
git diff --check
git status --short --branch
```

Confirm `docs/superpowers/handoffs/` remains untracked and unstaged.

Commit:

```powershell
git commit -m "test(core): cover native tool search loop"
```

Do not push the new implementation commits until the user asks for another push.

---

## Post-implementation review hardening

不可只以 provider-local `callID` 關聯 durable search。Core 的 invocation identity 是
`(assistantMessageID, callID)`，因此 provider-neutral `ToolDiscovery` 也保存
`assistantMessageID`，而 Core 產生的 assistant/tool replay messages 共用該來源 ID。OpenAI
Responses lowering 以完整 invocation identity 配對 call/output；重複 search ID，以及普通工具在
後續 assistant message 重用同一 ID，都有獨立回歸。

另外完成以下 recovery 與 protocol 邊界：

- durable call 只剩一側時補成合法 native pair，output-only history 不會重複輸出；
- native request token estimate 包含 durable discovery schemas，且不重複計算已隱藏的 deferred top-level definitions；
- stream 只把 `execution: "client"` 且有 `call_id` 的 Tool Search 交給 Core，server/null-ID items 安全忽略；
- native 匿名 Tool Search 不接受以 semantic function 名稱強制 `tool_choice`；
- canonical `ToolDefinition.kind` 改為必填 discriminator，ergonomic input 仍由 `ToolDefinition.make` 預設為 `function`。

新鮮驗證結果：LLM `334 pass / 30 skip / 0 fail`、Core
`1605 pass / 7 skip / 0 fail`；LLM、Core、Schema、Protocol、Client、Server、OpenCode、App、TUI
package typecheck 全部通過。
