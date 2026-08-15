# Native Tool Search Process-Restart E2E Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove that one OS process can durably complete native Tool Search and a second OS process can rebuild the same discovery into a valid OpenAI Responses request from the shared SQLite database.

**Architecture:** A parent Bun test launches the same typed worker twice with `discover` and `resume` modes. Each worker builds a fresh V2 runtime around `Database.layerFromPath(database)`, registers the same deferred application tool, uses a deterministic in-memory LLM stream, and writes a small JSON result file; no runtime objects or process memory cross the boundary.

**Tech Stack:** Bun test/process APIs, Effect layers, V2 Session runner, SQLite WAL, canonical Tool Registry, OpenAI Responses request preparation.

## Global Constraints

- Keep the database, Session runner, Tool Registry, model resolution, and provider request path real; mock only provider event input and unrelated ambient services.
- Use one explicit temporary SQLite path and two distinct child OS processes.
- Do not use network access, timing sleeps, global user storage, or a shell command string.
- The test must pass on Windows and preserve `docs/superpowers/handoffs/` as unrelated untracked work.
- Do not add production behavior merely to make the test injectable.

---

### Task 1: Add the cross-process runner harness and regression

**Files:**

- Create: `packages/core/test/fixture/native-tool-search-process.ts`
- Create: `packages/core/test/session-runner-native-tool-search-process.test.ts`

**Interfaces:**

- Consumes: `Database.layerFromPath(filename)`, `SessionV2`, `SessionRunnerLLM`, `ApplicationTools`, `Tool.withExposure`, `LLMClient.prepare`, and `OpenAIResponses.route`.
- Produces: a worker CLI `bun native-tool-search-process.ts <discover|resume> <database> <output>` and JSON:

```ts
interface WorkerResult {
  readonly mode: "discover" | "resume"
  readonly pid: number
  readonly semanticDiscoveryCount: number
  readonly selectedToolNames: ReadonlyArray<string>
  readonly nativeSearchCallIDs: ReadonlyArray<string>
  readonly nativeSearchOutputIDs: ReadonlyArray<string>
  readonly nativeSearchOutputNames: ReadonlyArray<string>
  readonly advertisedFunctionNames: ReadonlyArray<string>
}
```

- [x] **Step 1: Write the failing parent regression**

Create a test which allocates one `tmpdir()`, starts `discover`, then starts `resume` with the same database, and parses the two result files:

```ts
const run = (mode: "discover" | "resume", database: string, output: string) =>
  Bun.spawnSync([process.execPath, worker, mode, database, output], {
    cwd: path.resolve(import.meta.dir, ".."),
    env: {
      ...process.env,
      OPENCODE_TEST_HOME: runtime,
      XDG_DATA_HOME: path.join(runtime, "data"),
      XDG_CACHE_HOME: path.join(runtime, "cache"),
      XDG_CONFIG_HOME: path.join(runtime, "config"),
      XDG_STATE_HOME: path.join(runtime, "state"),
    },
  })
```

Assert all of the following:

```ts
expect(discover.exitCode).toBe(0)
expect(resume.exitCode).toBe(0)
expect(first.pid).not.toBe(process.pid)
expect(second.pid).not.toBe(process.pid)
expect(first.selectedToolNames).toContain("deferred_echo")
expect(second.semanticDiscoveryCount).toBe(1)
expect(second.selectedToolNames).toContain("deferred_echo")
expect(second.nativeSearchCallIDs).toContain("process-search")
expect(second.nativeSearchOutputIDs).toContain("process-search")
expect(second.nativeSearchOutputNames).toContain("deferred_echo")
expect(second.advertisedFunctionNames).not.toContain("deferred_echo")
```

- [x] **Step 2: Run the parent regression and confirm RED**

From `packages/core` run:

```powershell
bun test test/session-runner-native-tool-search-process.test.ts
```

Expected: FAIL because the worker is absent or does not yet produce a successful `resume` result.

- [x] **Step 3: Build one fresh runtime per worker invocation**

In the worker, parse and validate the three positional arguments, then build a scoped graph equivalent to the minimal recorded runner fixture with these explicit replacements:

```ts
const databaseLayer = Database.layerFromPath(database)
const model = Model.make({
  id: "native-tool-search-process",
  provider: "openai",
  route: OpenAIResponses.route,
  compatibility: { toolSearch: "openai-responses" },
})
const models = SessionRunnerModel.layerWith(() => Effect.succeed(model))
```

Include the real `Database`, `EventV2`, `SessionProjector`, `SessionStore`, `AgentV2`, `ApplicationTools`, `ToolRegistry`, `SessionRunnerLLM`, `SessionExecution`, and `SessionV2` nodes. Use the existing no-op Snapshot, empty System Context/Skill/Reference guidance, permissive test Permission service, empty Config, plugin runtime, and ToolOutputStore test replacements used by `session-runner-recorded.test.ts`.

- [x] **Step 4: Implement deterministic discover/resume provider streams**

Capture every semantic `LLMRequest`. In `discover` mode return a search call followed by a final text turn:

```ts
[
  LLMEvent.stepStart({ index: 0 }),
  LLMEvent.toolCall({ id: "process-search", name: "tool_search", input: { query: "select:deferred_echo" } }),
  LLMEvent.stepFinish({ index: 0, reason: "tool-calls" }),
  LLMEvent.finish({ reason: "tool-calls" }),
]
```

In both modes terminate the final turn with matching text start/delta/end, step-finish, and finish events. Register the same exact deferred tool before prompting:

```ts
yield* applications.register({
  deferred_echo: Tool.withExposure(
    Tool.make({
      description: "Echo text after native tool search",
      input: Schema.Struct({ text: Schema.String }),
      output: Schema.Struct({ text: Schema.String }),
      execute: ({ text }) => Effect.succeed({ text }),
    }),
    "deferred",
  ),
})
```

`discover` creates the Session rows, admits the first prompt, and resumes. `resume` reuses the same Session ID, admits a new prompt, resumes, prepares the captured request through `LLMClient.prepare<OpenAIResponses.OpenAIResponsesBody>`, and writes only the `WorkerResult` JSON to the requested output file.

- [x] **Step 5: Run the focused regression and confirm GREEN**

From `packages/core` run:

```powershell
bun test test/session-runner-native-tool-search-process.test.ts
bun typecheck
```

Expected: one process-restart test passes and Core typecheck exits zero.

- [ ] **Step 6: Commit the independent E2E tranche**

```powershell
git add packages/core/test/fixture/native-tool-search-process.ts packages/core/test/session-runner-native-tool-search-process.test.ts docs/superpowers/plans/2026-08-15-native-tool-search-process-restart.md
git commit -m "test(core): cover tool search process restart"
```

---

### Task 2: Record measured evidence and close the process-restart gap

**Files:**

- Modify: `docs/superpowers/specs/2026-08-11-provider-native-tool-search-design.md`
- Modify: `docs/superpowers/plans/2026-08-15-native-tool-search-process-restart.md`

**Interfaces:**

- Consumes: the passing worker regression from Task 1.
- Produces: an honest status which marks child-OS-process native recovery complete without marking Anthropic native or capability downgrade complete.

- [x] **Step 1: Run fresh affected verification**

```powershell
# packages/llm
bun test
bun typecheck

# packages/core
bun test test/session-runner-native-tool-search-process.test.ts test/session-runner.test.ts test/session-tool-discovery.test.ts test/session-compaction.test.ts
bun typecheck
```

- [x] **Step 2: Update status with exact measured counts**

Add the child process result and focused/full package counts to the design status. Remove only the child-process item from the incomplete list; retain:

```text
Anthropic Messages native tool_reference/defer_loading
automatic capability downgrade persistence
MCP reconnect/late-load and subagent grant hardening
```

- [ ] **Step 3: Verify repository hygiene**

```powershell
git diff --check
git status --short --branch
```

Confirm the two intended test files and tracked plan/design edits are the only changes, and `docs/superpowers/handoffs/` remains untracked and unstaged.

- [ ] **Step 4: Commit documentation evidence**

```powershell
git add docs/superpowers/specs/2026-08-11-provider-native-tool-search-design.md docs/superpowers/plans/2026-08-15-native-tool-search-process-restart.md
git commit -m "docs: record tool search restart evidence"
```
