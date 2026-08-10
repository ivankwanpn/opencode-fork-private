# P5: tool_search 動態載入契約（復現 Codex tool_search）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把目前「字串搜尋」的 `tool_search` 升級為 Codex v0.146.0 等價的動態工具載入：搜索返回**結構化結果**、記錄**選中集（searched tools）**、下一輪 provider turn **重新注入選中工具到 definitions**、`settle` **拒絕未搜索的 deferred tool**。P6（Capability 全面統一）明確排除。

**Codex 參考**（`D:\opencode-bugfix\codex-rust-v0.146.0`）：
- `tool_search` 是特殊工具，返回 `ToolSearchOutput { tools: Vec<LoadableToolSpec> }`（結構化，`defer_loading: true`）
- 搜索結果作為請求上下文，下一輪搜索到的工具進入 tool definitions
- 未搜索/不可見的工具即使被模型強制調用也返回 "unsupported call"（`search_tool.rs` 集成測試驗證）

**本 fork 架構**：Effect / ToolRegistry。選中集以 **session 級 `Ref<ReadonlySet<string>>`** 跨 provider turn 傳遞。

**Architecture:**
- `materialize` 擴展接受一個「選中集」來源（Ref 或讀取 callback），把**已選中且權限允許**的 deferred 工具加入 `definitions`
- `tool_search` 返回結構化 LoadableToolSpec（同時保留文字摘要供模型閱讀），並把命中工具名寫入選中集 Ref
- `settle` 對 deferred 工具驗證「該工具在選中集中」；未選中 → 返回 `"unsupported call: <name>"` 錯誤（Codex 等價）
- runner 在 session 執行時創建選中集 Ref，跨 `runTurn` 傳遞；搜索後的下一個 provider turn 重新 materialize 時注入

**Tech Stack:** TypeScript / Effect / bun test。基於 P1（deferred exposure + tool_search）+ P2/P3。

## Global Constraints

- 所有測試在 `packages/core` 下 `bun test`
- 不引入 P6 範圍：不統一 V1/V2 registry、不重建 code-mode、不做完整 capability catalog
- 既有 Direct 工具行為不變；deferred 工具僅在「未搜索」時被拒（已搜索 + 權限允許 → 可執行）
- `tool_search` 仍保持文字輸出（模型可讀），但附加結構化結果與選中集更新
- 權限白名單（P3）優先：選中工具若被權限 deny，仍不注入
- 逐步 TDD

---

### Task 1: 選中集（searched tools）基礎設施 + materialize 注入

**Files:**
- Modify: `packages/core/src/tool/registry.ts`（`materialize` 擴展 + 注入邏輯）
- Modify: `packages/core/src/tool/tool-search.ts`（結構化輸出 + 選中集更新）
- Test: `packages/core/test/tool-search-dynamic.test.ts`（新建）

**Interfaces:**
- Produces:
  - `materialize` 接受 `options.selected?: ReadonlySet<string> | (() => ReadonlySet<string>)`（或等效 Ref）；已選中的 deferred 工具（且 `!whollyDisabled`）加入 `definitions`（不再只進 deferred）
  - `tool_search` 返回結構化結果（名稱 + description + inputSchema + `defer_loading: true`），文字輸出保留；命中工具名可寫入一個選中集
  - `Materialization` 增加 `selected: ReadonlySet<string>`（當前選中集快照）供 runner 傳遞

- [ ] **Step 1: 寫失敗測試**

`packages/core/test/tool-search-dynamic.test.ts`（用 `ToolRegistry` + 註冊 deferred 工具）：
```ts
// 1. 註冊 tool_a（deferred）與 tool_b（deferred）
// 2. materialize({ selected: new Set(["tool_a"]) })
// 3. 斷言 definitions 含 tool_a（注入）、不含 tool_b；deferred 不含 tool_a
// 4. tool_search 對 "alpha" 搜索命中 tool_a → 返回結構化結果（含 name/schema/defer_loading）
```

- [ ] **Step 2: 跑測試確認失敗**（目前 selected 無作用、tool_search 純文字）
- [ ] **Step 3: 實現**
  - `materialize` 接收 selected 來源；對 deferred 工具，若 `selected.has(name)` 且權限允許 → 加入 `definitions`（移出 deferred）
  - `tool-search.ts`：新增 `LoadableToolSpec` 形狀的結構化輸出；`execute` 可選接收 selected 寫入 callback
- [ ] **Step 4: 跑測試確認通過**
- [ ] **Step 5: Commit**

```bash
git commit -m "feat(core): materialize injects searched deferred tools into definitions"
```

---

### Task 2: runner 跨 turn 傳遞選中集（session 級 Ref）

**Files:**
- Modify: `packages/core/src/session/runner/llm.ts`（session 級選中集 Ref + 傳給 materialize + tool_search 更新）
- Modify: `packages/core/src/tool/tool-search.ts`（execute 更新選中集）
- Test: `packages/core/test/tool-search-dynamic.test.ts`（擴充）

**Interfaces:**
- Produces:
  - Session 執行時創建 `Ref<ReadonlySet<string>>`（或等效），跨 `runTurn` 存活
  - `materialize` 調用時傳入選中集；`tool_search` 工具的 execute 能更新該 Ref（命中工具名寫入）
  - 下一輪 provider turn 重新 materialize 時，選中工具被注入 definitions

- [ ] **Step 1: 寫失敗測試**（runner 層：用現有 SessionRunnerLLM 基建，fake provider 兩輪）
  - turn 1：模型調用 tool_search（fake provider 發 tool_search call）
  - turn 2：fake provider 調用搜索到的 deferred 工具
  - 斷言：turn 2 的 request tools 包含該工具定義（已注入）
  - 若難直接驅動 runner，可先在 registry 層測「同一個 selected Ref 兩次 materialize 的行為」
- [ ] **Step 2: 跑測試確認失敗**
- [ ] **Step 3: 實現**
  - runner 的 session 執行上下文加選中集 Ref；tool_search settle 時更新；materialize 傳入
- [ ] **Step 4: 跑測試確認通過**
- [ ] **Step 5: Commit**

```bash
git commit -m "feat(core): thread searched-tool set across provider turns"
```

---

### Task 3: settle 拒絕未搜索的 deferred tool

**Files:**
- Modify: `packages/core/src/tool/registry.ts`（`settle` 驗證選中集）
- Test: `packages/core/test/tool-search-dynamic.test.ts`（擴充）

**Interfaces:**
- Produces:
  - `settle` 對 deferred 工具：若名稱不在選中集（且非 Direct）→ 返回 `{ type: "error", value: "unsupported call: <name> ..." }`（Codex 等價）
  - Direct 工具與 tool_search 不受影響

- [ ] **Step 1: 寫失敗測試**
  - materialize 後，對**未搜索**的 deferred 工具 `settle(call("tool_b"))` → 期望 error "unsupported call"
  - 對已搜索的 `tool_a` → 正常執行
- [ ] **Step 2: 跑測試確認失敗**（目前 deferred settle 只憑名稱）
- [ ] **Step 3: 實現**：settle 閉包持有選中集；deferred registration 需要 `selected.has(name)` 才放行
- [ ] **Step 4: 跑測試確認通過**；跑既有 `tool-search-deferred.test.ts`、`mcp-tool-exposure.test.ts` 確認無回歸（既有 deferred settle 測試可能需要 update）
- [ ] **Step 5: Commit**

```bash
git commit -m "feat(core): reject deferred tool calls that were not searched first"
```

---

### Task 4: fake provider 端到端回歸 + 全量驗證

**Files:**
- Test: `packages/core/test/tool-search-dynamic.test.ts`（端到端）
- 可能 Modify: `packages/core/test/session-runner.test.ts`（若既有 deferred 行為受影響）

**Interfaces:**
- Produces: Codex `search_tool.rs` 等價測試：
  1. turn 1 request 有 tool_search、無 deferred 工具
  2. turn 1 模型調用 tool_search → 結構化 output
  3. turn 2 request 的 tools 包含搜索到的 deferred 工具定義
  4. turn 2 調用該工具成功
  5. （負向）未搜索的 deferred 工具被模型調用 → "unsupported call"

- [ ] **Step 1: 寫端到端測試**（用 SessionRunnerLLM fake provider 基建，參考 `session-runner.test.ts`）
- [ ] **Step 2: 跑測試確認通過**
- [ ] **Step 3: 全量 `bun test`（packages/core）+ typecheck**
- [ ] **Step 4: 檢查既有測試回歸**（mcp-tool-exposure、tool-search-deferred、plugin 相關——deferred settle 行為變化可能影響）
- [ ] **Step 5: Commit**

```bash
git commit -m "test(core): end-to-end tool_search dynamic loading regression"
```

---

## Self-Review

- **與 Codex 對齊**：結構化 ToolSearchOutput、搜索後注入下一輪 definitions、未搜索拒絕執行——三項都覆蓋
- **範圍控制**：P6（V1/V2 統一、code-mode、capability catalog）明確排除；只改 tool_search 契約
- **風險**：
  - 選中集跨 turn 的 Ref 生命周期：session 執行上下文需正確創建/清理（run 完成或失敗時）
  - `settle` 拒絕未搜索工具是行為變更：既有測試（`tool-search-deferred.test.ts`、`mcp-tool-exposure.test.ts`）可能斷言「deferred 可 settle」，需更新為「需先搜索」
  - tool_search 文字輸出格式保留（模型兼容），結構化結果附加而非替換
- **佔位符**：Task 2 的 runner 集成需要先探索 SessionRunner.run 的 session 級狀態位置；若 Ref 難注入，可用「讀取 callback 從 session store 讀」替代（持久化方案）
