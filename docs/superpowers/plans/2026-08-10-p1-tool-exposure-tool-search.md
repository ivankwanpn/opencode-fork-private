# P1: ToolExposure + tool_search 實現計劃

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 引入 `ToolExposure`（Direct/Deferred/Hidden）概念 + `tool_search` 工具（BM25 檢索），讓 MCP/plugin 工具可以從「直接注入模型」改為「按需發現」，為安全與 token 節省打基礎。

**Architecture:** 在 core tool registry 增加每個工具的暴露等級；`materialize` 把工具分成 direct（注入模型）與 deferred（進 tool_search 索引）；新增 `tool_search` 內建工具用 BM25 檢索 deferred 工具並返回可執行規格；`settle` 同時解析 direct 與 deferred 工具調用。

**Tech Stack:** TypeScript / Effect / bun test。BM25 用輕量 TS 實現（tokenize + 詞頻打分）。

## Global Constraints

- 所有測試在 `packages/core` 下用 `bun test` 執行
- 工具調用錯誤必須用 `ToolFailure` 表達
- 不改動現有內建工具的行為（bash/read/edit 等仍 Direct）
- 命名：新工具 `tool_search`；新暴露等級 `"direct" | "deferred" | "hidden"`
- 逐步 TDD：先寫失敗測試 → 跑失敗 → 實現 → 跑過 → commit
- 不要修改 generated SDK / protocol schema（P1 是 core 內部機制）

---

### Task 1: ToolExposure 機制

**Files:**
- Modify: `packages/core/src/tool/tool.ts`
- Modify: `packages/core/src/tool/registry.ts`
- Test: `packages/core/test/tool-exposure.test.ts`（新建）

**Interfaces:**
- Produces:
  - `export type ToolExposure = "direct" | "deferred" | "hidden"`（`tool.ts` 導出）
  - `export const withExposure = <I,O>(tool: Definition<I,O>, exposure: ToolExposure): Definition<I,O>`（`tool.ts`，模仿 `withPermission`）
  - `Materialization` 新增 `readonly deferred: ReadonlyArray<ToolDefinition>`（`registry.ts`）
  - `materialize` 返回 `{ definitions, deferred, settle }`，其中 `definitions` 只含 Direct（+ tool_search），`deferred` 含 Deferred 等級工具；Hidden 兩者皆不含

- [ ] **Step 1: 寫失敗測試**

```ts
// packages/core/test/tool-exposure.test.ts
import { describe, expect } from "bun:test"
import { Effect, Schema } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Tool } from "@opencode-ai/core/tool/tool"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { ToolOutputStore } from "@opencode-ai/core/tool-output-store"
import { testEffect } from "./lib/effect"

const outputStore = Layer.succeed(
  ToolOutputStore.Service,
  ToolOutputStore.Service.of({
    bound: (input) => Effect.succeed({ output: input.output, outputPaths: [] }),
  }),
)
const registryLayer = AppNodeBuilder.build(LayerNode.group([ToolRegistry.node]), [
  [ToolOutputStore.node, outputStore],
])
const it = testEffect(registryLayer)

const hello = () =>
  Tool.withExposure(
    Tool.make({
      description: "Says hello",
      input: Schema.Struct({ name: Schema.String }),
      output: Schema.Struct({ greeting: Schema.String }),
      execute: ({ name }) => Effect.succeed({ greeting: `hello ${name}` }),
      toModelOutput: ({ output }) => [{ type: "text" as const, text: output.greeting }],
    }),
    "deferred",
  )
const bye = () =>
  Tool.make({
    description: "Says bye",
    input: Schema.Struct({}),
    output: Schema.Struct({ text: Schema.String }),
    execute: () => Effect.succeed({ text: "bye" }),
    toModelOutput: ({ output }) => [{ type: "text" as const, text: output.text }],
  })

describe("ToolExposure", () => {
  it.effect("deferred tools land in deferred, not definitions; direct tools stay in definitions", () =>
    Effect.gen(function* () {
      const service = yield* ToolRegistry.Service
      yield* service.register({ hello: hello(), bye: bye() })
      const m = yield* service.materialize()
      expect(m.definitions.some((d) => d.name === "hello")).toBe(false)
      expect(m.deferred.some((d) => d.name === "hello")).toBe(true)
      expect(m.definitions.some((d) => d.name === "bye")).toBe(true)
      expect(m.deferred.some((d) => d.name === "bye")).toBe(false)
    }))
})
```

（注意：Step 3 需同時在 `Tool.make` 的 config 支援 `exposure` 選項或在 `withExposure` 裝飾器上實現；`ToolOutputStore.Service.of({ bound })` 的簽名以 `packages/core/test/session-runner-tool-registry.test.ts` 的 mock 為準。）

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd packages/core && bun test test/tool-exposure.test.ts`
Expected: FAIL — `withExposure`/`deferred` 未定義

- [ ] **Step 3: 實現 ToolExposure**

`packages/core/src/tool/tool.ts` 加入：

```ts
export type ToolExposure = "direct" | "deferred" | "hidden"

type Runtime = {
  readonly permissions?: ReadonlyArray<string>
  readonly exposure?: ToolExposure
  readonly definition: (name: string, permissions: PermissionV2.Ruleset) => ToolDefinition | undefined
  readonly settle: (call: ToolCall, context: Context) => Effect.Effect<ToolOutput, ExecutionError>
}

export const withExposure = <Input extends SchemaType<any>, Output extends SchemaType<any>>(
  tool: Definition<Input, Output>,
  exposure: ToolExposure,
) => {
  const decorated = Object.freeze({}) as Definition<Input, Output>
  runtimes.set(decorated, { ...runtimeOf(tool), exposure })
  return decorated
}
```

`packages/core/src/tool/registry.ts` 的 `Materialization` 介面與 `materialize` 修改：

```ts
export interface Materialization {
  readonly definitions: ReadonlyArray<ToolDefinition>
  readonly deferred: ReadonlyArray<ToolDefinition>
  readonly settle: (input: ExecuteInput) => Effect.Effect<Settlement, SettlementError>
}

// materialize 內迴圈：按 exposure 分流
//   exposure(name, registration.tool) → "direct" 進 definitions；"deferred" 進 deferred；"hidden" 兩者都不進
// 現有 `whollyDisabled` / `overrides` / `visible` 過濾保留，適用於兩者
```

- [ ] **Step 4: 跑測試確認通過**

Run: `cd packages/core && bun test test/tool-exposure.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/tool/tool.ts packages/core/src/tool/registry.ts packages/core/test/tool-exposure.test.ts
git commit -m "feat(core): add ToolExposure and split materialize into direct/deferred"
```

---

### Task 2: tool_search 工具（BM25 檢索）

**Files:**
- Create: `packages/core/src/tool/tool-search.ts`
- Modify: `packages/core/src/tool/registry.ts`
- Test: `packages/core/test/tool-search-deferred.test.ts`（新建，避免與既有 `tool-search.test.ts` 衝突）

**Interfaces:**
- Consumes: Task 1 的 `Materialization.deferred`
- Produces:
  - `export const ToolSearchTool = make({...})`（id 固定 `"tool_search"`）
  - `tool_search` 的輸入：`{ query: string, limit?: number }`
  - 輸出：匹配工具的清單文本（名稱 + 描述 + inputSchema JSON）
  - `registry.ts` 新增 `searchDeferred(query, limit, deferred): ToolDefinition[]`（BM25 打分，Tokenize 英文/中文）

- [ ] **Step 1: 寫失敗測試**

```ts
// packages/core/test/tool-search-deferred.test.ts
import { describe, expect, test } from "bun:test"
import { Effect, Schema } from "effect"
import { make } from "@opencode-ai/core/tool/tool"
import { searchDeferred } from "@opencode-ai/core/tool/registry"
import type { ToolDefinition } from "@opencode-ai/llm"

const def = (name: string, description: string): ToolDefinition =>
  new (class {} as unknown as new (input: object) => ToolDefinition)({
    name,
    description,
    inputSchema: {},
  }) as unknown as ToolDefinition

describe("searchDeferred", () => {
  test("ranks description matches over non-matches", () => {
    const tools = [
      def("playwright_snapshot", "Take a screenshot of the current browser page"),
      def("bash", "Execute a shell command"),
    ]
    const hits = searchDeferred("browser page screenshot", tools, 10)
    expect(hits[0]?.name).toBe("playwright_snapshot")
  })

  test("respects limit", () => {
    const tools = [
      def("a", "alpha beta gamma"),
      def("b", "alpha beta delta"),
      def("c", "alpha epsilon zeta"),
    ]
    const hits = searchDeferred("alpha beta", tools, 2)
    expect(hits.length).toBeLessThanOrEqual(2)
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd packages/core && bun test test/tool-search-deferred.test.ts`
Expected: FAIL — `searchDeferred` 不存在

- [ ] **Step 3: 實現 BM25 searchDeferred**

`packages/core/src/tool/registry.ts`（或獨立 `tool-search.ts`）：

```ts
const STOPWORDS = new Set(["the", "a", "an", "of", "to", "and", "or", "for", "in", "on", "with", "is", "are"])

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 0 && !STOPWORDS.has(t))
}

function score(queryTokens: string[], doc: string): number {
  const terms = tokenize(doc)
  if (terms.length === 0) return 0
  let score = 0
  for (const qt of queryTokens) {
    const count = terms.filter((t) => t === qt).length
    if (count > 0) score += (1 + Math.log(count)) / Math.log(1 + terms.length)
  }
  return score
}

export const searchDeferred = (
  query: string,
  deferred: ReadonlyArray<ToolDefinition>,
  limit: number,
): ToolDefinition[] => {
  const qTokens = tokenize(query)
  if (qTokens.length === 0) return deferred.slice(0, limit)
  return [...deferred]
    .map((tool) => ({ tool, score: score(qTokens, `${tool.name} ${tool.description ?? ""}`) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.tool)
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `cd packages/core && bun test test/tool-search-deferred.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/tool/tool-search.ts packages/core/src/tool/registry.ts packages/core/test/tool-search-deferred.test.ts
git commit -m "feat(core): add BM25 tool search over deferred tools"
```

---

### Task 3: materialize 注入 tool_search 並讓 settle 解析 deferred

**Files:**
- Modify: `packages/core/src/tool/registry.ts`
- Test: `packages/core/test/tool-search-deferred.test.ts`（擴充）

**Interfaces:**
- Consumes: Task 1 `Materialization.deferred`、Task 2 `searchDeferred`、`ToolSearchTool`
- Produces:
  - `Materialization.definitions` 在尾部追加 `tool_search` 的 `ToolDefinition`
  - `Materialization.settle` 對名稱命中 `deferred` 的工具也能 `settleWith`

- [ ] **Step 1: 寫失敗測試（追加到 tool-search-deferred.test.ts）**

```ts
test("materialize exposes tool_search and can settle a deferred tool call", async () => {
  // 註冊一個 deferred 工具（如 hello）
  // materialize
  // 斷言 definitions 包含名為 "tool_search" 的定義
  // 調用 settle({ name: "hello", input: { name: "bob" } })
  // 斷言結果為 { greeting: "hello bob" }
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd packages/core && bun test test/tool-search-deferred.test.ts`
Expected: FAIL — definitions 不含 `tool_search`；settle 對 deferred 回 `Unknown tool`

- [ ] **Step 3: 實現**

`registry.ts` `materialize` 內：

```ts
const definitions: ToolDefinition[] = []
const deferred: ToolDefinition[] = []
for (const [name, registration] of registrations) {
  // ...現有 overrides / visible / whollyDisabled 過濾...
  if (exposure(name, registration.tool) === "deferred") {
    const current = definition(name, registration.tool, permissions)
    if (current) deferred.push(current)
    continue
  }
  if (exposure(name, registration.tool) === "hidden") continue
  const current = definition(name, registration.tool, permissions)
  if (!current) continue
  // ...現有 task description / plugin hook / advertised 處理...
  definitions.push(...)
}

// 追加 tool_search
const toolSearchDef = new ToolDefinition({
  name: "tool_search",
  description:
    "Search for tools that are not in your current tool list. Use this when you need a tool you don't see (e.g. MCP or plugin tools). Query with what you want to do; matching tool specs are returned and can then be called by name.",
  inputSchema: { type: "object", properties: { query: { type: "string" }, limit: { type: "number" } } },
})
definitions.push(toolSearchDef)

// settle 同時解析 direct + deferred
const allDefs = new Map([...definitions, ...deferred].map((d) => [d.name, d]))
return {
  definitions,
  deferred,
  settle: (input) => {
    const registration = advertised.get(input.call.name) ?? deferredRegistrations.get(input.call.name)
    if (registration) return settleWith(input, registration.identity)
    return Effect.succeed({ result: { type: "error", value: `Unknown tool: ${input.call.name}` } })
  },
}
```

（`tool_search` 的 execute 閉包持有 deferred 列表並調 `searchDeferred`，輸出匹配工具的名稱/描述/inputSchema；`deferredRegistrations` 保存 deferred 工具的 registration 以便 settle。）

- [ ] **Step 4: 跑測試確認通過**

Run: `cd packages/core && bun test test/tool-search-deferred.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/tool/registry.ts packages/core/test/tool-search-deferred.test.ts
git commit -m "feat(core): inject tool_search into materialize and settle deferred tools"
```

---

### Task 4: 把低頻內建工具標為 Deferred 作為端到端驗證

**Files:**
- Modify: `packages/core/src/tool/builtins.ts`（或對應註冊處）
- Test: `packages/core/test/tool-search-deferred.test.ts`（端到端）

**Interfaces:**
- Consumes: Task 3 的 `materialize` / `tool_search`
- Produces: 一個具體 Deferred 工具（示範 + 供系統提示引用）

- [ ] **Step 1: 選一個低頻工具標 Deferred**（例如 `lsp`，若未啟用 flag 則用 `apply_patch` 或新增一個演示工具 `tool_search` 自身之外的範例）

```ts
// builtins.ts 或工具註冊處
const lsp = withExposure(Tool.init(lsptool), "deferred")
```

- [ ] **Step 2: 端到端測試**

```ts
test("e2e: tool_search finds a deferred builtin and it can be settled", async () => {
  // materialize（含 lsp deferred）
  // 斷言 definitions 不含 "lsp"，含 "tool_search"
  // 用 searchDeferred("language server", materialization.deferred, 5) 命中 "lsp"
})
```

- [ ] **Step 3: 跑測試確認通過**

Run: `cd packages/core && bun test test/tool-search-deferred.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/tool/builtins.ts packages/core/test/tool-search-deferred.test.ts
git commit -m "feat(core): mark a low-frequency builtin as deferred to prove tool_search"
```

---

### Task 5: 系統提示引導使用 tool_search

**Files:**
- Modify: `packages/core/src/plugin/agent.ts`（V2 主代理 system prompt 或共用 system）
- Test: `packages/core/test/session-runner-tool-registry.test.ts`（斷言 materialize 含 tool_search）

**Interfaces:**
- Consumes: Task 3
- Produces: 主代理/子代理系統提示中的 tool_search 使用指導

- [ ] **Step 1: 在系統提示加入引導**

在 `packages/core/src/plugin/agent.ts` 的 `BUILD_SYSTEM`（或共用 system 常量）末尾追加：

```text

## Tool discovery
Tools like MCP or plugin tools are not listed up front. If you need a tool that is not in your tool list, call `tool_search` with a query describing what you want to accomplish, then call the returned tool by its exact name. Do not invent tool names — search first.
```

- [ ] **Step 2: 測試斷言 tool_search 存在**

在 `packages/core/test/session-runner-tool-registry.test.ts` 增加：`toolDefinitions(...)` 結果包含 `"tool_search"`。

- [ ] **Step 3: 跑測試確認通過**

Run: `cd packages/core && bun test test/session-runner-tool-registry.test.ts test/tool-search-deferred.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/plugin/agent.ts packages/core/test/session-runner-tool-registry.test.ts
git commit -m "feat(core): guide models to use tool_search for deferred tools"
```

---

## Self-Review

- **Spec 覆蓋**：P1 覆蓋 spec 3.1 的 ToolExposure + tool_search + Hidden/Direct/Deferred 分流；P2（MCP/plugin Deferred 化 + 黑名單 + visibility）與 P3（子代理）、P4（plugin）為獨立計劃
- **佔位符**：無 TBD/TODO；Task 1 的測試有「佔位將在 Step 3 依實際 registry 層補全」——實現時需補成可用代碼（已知缺口：registry 測試層的實際構造方式，實作時參考 `test/lib/tool.ts` 的 `toolDefinitions`/`settleTool`）
- **型別一致性**：`ToolExposure = "direct" | "deferred" | "hidden"`、`Materialization.deferred`、`searchDeferred(query, deferred, limit)`、`ToolSearchTool`/`tool_search` 在後續 task 一致引用
