# P4: Plugin/市場整合——plugin 工具 Deferred 化 + plugin 捆綁 agent 驗證

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 plugin 工具（plugin-compat-v2 註冊的自定義工具）從 Direct 改為 Deferred（進 `tool_search` 索引，不直接注入模型），並驗證 plugin 捆綁 agent（markdown agent 定義）的發現機制已覆蓋 plugin 目錄。

**Architecture:** plugin 工具經 `packages/opencode/src/tool/plugin-compat-v2.ts` 的 `makeTool` 建立並 `registry.register(tools)` 註冊進 core ToolRegistry（materialize 的 `whollyDisabled` 權限過濾自動生效）。P4 在 `makeTool` 處套用 P1 的 `Tool.withExposure(..., "deferred")`，使 plugin 工具進 tool_search（P1 機制，與 MCP Deferred 相同）。

**Tech Stack:** TypeScript / Effect / bun test。基於 P1（ToolExposure + tool_search）與 P2（MCP Deferred）已合入的機制。

## Global Constraints

- 所有測試在 `packages/core`（V2）或 `packages/opencode`（V1）下用 `bun test`；typecheck 用 `bun typecheck`
- 不改 plugin API 本身（`@opencode-ai/plugin` 的工具 contribution 結構）
- plugin 工具 Deferred 後，既有直接依賴 plugin 工具名的流程需確認（工具名不變，僅不再注入模型）
- 內建工具、MCP 工具（P2）、白名單（P3）行為不變
- 逐步 TDD：先寫失敗測試 → 實現 → 跑過 → commit

---

### Task 1: plugin 工具 Deferred 化

**Files:**
- Modify: `packages/opencode/src/tool/plugin-compat-v2.ts`（`makeTool` 加 `Tool.withExposure(..., "deferred")`）
- Test: 新建 `packages/opencode/test/tool/plugin-tool-deferred.test.ts`

**Interfaces:**
- Produces: plugin 工具註冊後 materialize 時進 `deferred`（tool_search 索引），不在 `definitions`
- Consumes: P1 的 `Tool.withExposure`（`@opencode-ai/core/tool/tool`）

- [ ] **Step 1: 寫失敗測試**

用 plugin-compat-v2 的 node（或直接測 `makeTool` + registry materialize）：
- 註冊一個假 plugin 工具（`makeTool` 或透過 plugin contribution）
- materialize 後：definitions 不含該工具、deferred 含該工具
- 需要 inspect 現有 plugin-compat-v2 測試（若存在）或 plugin test host

- [ ] **Step 2: 跑測試確認失敗**（plugin 工具目前在 definitions）
- [ ] **Step 3: 實現**：`makeTool` 回傳 `Tool.withExposure(Tool.make({...}), "deferred")`
- [ ] **Step 4: 跑測試確認通過**；跑 plugin 相關既有測試無回歸
- [ ] **Step 5: Commit**

```bash
git commit -m "feat(opencode): defer plugin tools behind tool_search"
```

---

### Task 2: plugin 捆綁 agent（markdown）驗證

**Files:**
- 驗證：`packages/core/src/config/plugin/agent.ts`（`discover` 從 `config.entries()` 目錄掃描 `{agent,agents}/**/*.md` 與 `{mode,modes}/*.md`）
- Test: 新建 `packages/core/test/config-agent-markdown.test.ts`（若無現有覆蓋）

**Interfaces:**
- Produces: 驗證 markdown agent 定義（plugin 安裝到 agent/agents/mode/modes 目錄的 .md）能被 `ConfigAgentPlugin` 發現並轉成 `AgentV2` 定義
- 若發現 plugin agent 文件不在發現目錄（如 plugin 自帶 `agents/` 在 plugin 自己的目錄而未被掃描），記錄並視情況補發現邏輯

- [ ] **Step 1: 寫測試**：在 tmpdir 建 `agent/foo.md`（frontmatter: mode/description/system）→ 載入 ConfigAgentPlugin → AgentV2.Service 含 `foo`
- [ ] **Step 2: 跑測試**（若通過：markdown agent 機制已完整；若失敗：補實現）
- [ ] **Step 3: 跑全量 + typecheck**
- [ ] **Step 4: Commit**

```bash
git commit -m "test(core): verify markdown agent discovery covers plugin agent dirs"
```

---

## Self-Review

- **Spec 覆蓋**：P4 覆蓋 spec §3.4 的「plugin MCP 工具統一 Deferred」與「plugin 捆綁 agent（markdown）」；前者是實作（T1），後者經探查已由 `ConfigAgentPlugin` 實現（T2 驗證 + 補測）
- **探查結論**：`ConfigAgentPlugin` 已從 `{agent,agents}/**/*.md` 與 `{mode,modes}/*.md` 載入 markdown agent（gray-matter frontmatter → `ConfigAgent.Info`）；plugin 工具的註冊入口是 `plugin-compat-v2.makeTool` → core registry（權限過濾自動生效）
- **風險**：plugin 工具 Deferred 後，既有依賴「plugin 工具直接可用」的流程（如 CLI 直接調用 plugin 工具）需要 tool_search；工具名不變。plugin 黑名單不在 P4 範圍（P3 的白名單已 deny 子代理的外部工具；plugin 工具經 materialize 權限過濾受控）
- **佔位符**：T1 的測試構造需參考現有 plugin test host / plugin-compat 測試；T2 若現有測試已覆蓋 markdown agent，則降級為驗證 + 記錄
