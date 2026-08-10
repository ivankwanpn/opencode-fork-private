# P3: 子代理重設計——四角色最小權限白名單 + task 工具授權參數 + 外部工具授權協議

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把四個子代理（general/explore/research/worker）從 allow-all（或含 playwright 通配符）收斂為最小權限白名單（default deny），新增 `task` 工具的 `permission` 授權參數讓主代理按任務授予子代理外部工具，更新系統提示實現「外部工具授權協議」，並加 RCE 逃逸回歸測試（子代理無法觸及 `browser_run_code_unsafe`）。

**Architecture:**
- 白名單生效機制 = 現有 V2 權限規則（`PermissionV2.evaluate` 用 `findLast` 匹配）+ `ToolRegistry.materialize` 的 `whollyDisabled` 過濾——`*: deny` 前置 + 顯式 allow 的規則集決定子代理能看到/調用哪些工具（含 P2 後的 Deferred MCP 工具經 tool_search 的廣告）。
- V1（`packages/opencode/src/agent/agent.ts`）與 V2（`packages/core/src/plugin/agent.ts`）兩份內建 agent 定義**同步**改白名單。
- `task` 工具新增 `permission` grant 參數：主代理授權子代理在**該任務內**使用特定外部工具；grant 只允許 allow、黑名單工具不可授予（雙保險）；任務結束（子代理 session 結束）失效；`task_id` 恢復舊 session 不繼承舊 grant。
- 系統提示更新：子代理需要外部工具時向主代理**請求授權**（協議第 1 步）；主代理透過 `task` 的 `permission` 參數授予（spec §8 已確認：主代理自主判斷，不彈用戶確認）。

**Tech Stack:** TypeScript / Effect / bun test。基於 P2 已合入的黑名單（branch 999.0.16）。

## Global Constraints

- 所有測試在 `packages/core`（V2）或 `packages/opencode`（V1）下用 `bun test` 執行；typecheck 用 `bun typecheck`（package 目錄下）
- 四角色白名單必須與 spec §3.3 一致：
  - `explore`：read, grep, glob, webfetch, websearch（**移除現有 bash/list allow**）
  - `general`：bash, read, write, edit, grep, glob, webfetch, websearch, task, skill
  - `research`：read, grep, glob, webfetch, websearch（**移除 playwright 三個通配符 allow**）
  - `worker`：bash, read, write, edit, grep, glob, webfetch, task
- V1 與 V2 的白名單**必須一致**；build（primary）與 plan/title/compaction/summary 不變
- 保留現有防護規則：`question`/`plan_enter`/`plan_exit` deny、`read` 的 env 規則、`external_directory` 的 readonly/ask 配置
- grant 只允許 `effect: "allow"`，不允許 deny；黑名單（`DEFAULT_BLOCKED_TOOLS` + config `blockedTools`）內的工具不可授予
- 不要修改 generated SDK / protocol schema；不要改 MCP 工具命名
- 逐步 TDD：先寫失敗測試 → 實現 → 跑過 → commit

---

### Task 1: 四角色最小權限白名單（V1+V2 同步）

**Files:**
- Modify: `packages/opencode/src/agent/agent.ts`（V1 四角色）
- Modify: `packages/core/src/plugin/agent.ts`（V2 四角色）
- Test: `packages/opencode/test/agent/subagent-whitelist.test.ts`（新建，V1）；`packages/core/test/agent-whitelist.test.ts`（新建，V2）
- 可能 Modify: `packages/opencode/test/agent/plan-mode-subagent-bypass.test.ts`（現有斷言若受白名單影響）

**Interfaces:**
- Produces: V1/V2 的 general/explore/research/worker 四角色 permission ruleset 收斂為 spec §3.3 白名單
- 白名單寫法（沿用 explore 現有模式）：`Permission.merge(defaults, [{ "*": "deny" }, { allowedTool: "allow", ... }, 特殊規則], user)`——`*: deny` 在前、allow 在後，`findLast` 讓 allow 生效

- [ ] **Step 1: 寫失敗測試**

`packages/opencode/test/agent/subagent-whitelist.test.ts`：

```ts
import { describe, expect, test } from "bun:test"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { Agent } from "../../src/agent/agent"
// 用 LayerNode.compile(Agent.node, [locationServiceMapReplacement]) 拿四個子代理的 permission
// 斷言（V1 PermissionV1 evaluate 用 PermissionV1.evaluate(permission, tool, resource?)）：
//   general: bash/read/write/edit/grep/glob/webfetch/websearch/task/skill => allow；playwright_* / browser_run_code_unsafe => deny
//   explore: read/grep/glob/webfetch/websearch => allow；bash/list/write/edit/task => deny；playwright_* => deny
//   research: read/grep/glob/webfetch/websearch => allow；playwright_*/mcp_playwright_* / browser_run_code_unsafe => deny（回歸：RCE 通配符移除）
//   worker: bash/read/write/edit/grep/glob/webfetch/task => allow；skill => deny；playwright_* => deny
```

`packages/core/test/agent-whitelist.test.ts`（V2，用 `AgentV2.Service` + `AgentPlugin` 的 draft 載入，或直接建 ruleset 斷言 `PermissionV2.evaluate`）：
同樣斷言四角色（action/resource/effect 語法）。

- [ ] **Step 2: 跑測試確認失敗**

Expected: FAIL — general/worker 目前 allow-all、explore 允許 bash、research 允許 playwright_*

Run: `cd packages/opencode && bun test test/agent/subagent-whitelist.test.ts`；`cd packages/core && bun test test/agent-whitelist.test.ts`

- [ ] **Step 3: 實現**

V1 `packages/opencode/src/agent/agent.ts`（四角色）：
- general/worker：`Permission.merge(defaults, whitelistFor(general), user)`，其中 `whitelistFor` 為 `Permission.fromConfig({ "*": "deny", bash: "allow", read: {...env 規則保留}, write: "allow", edit: "allow", grep: "allow", glob: "allow", webfetch: "allow", websearch: "allow", task: "allow", skill: "allow" })`（worker 去掉 skill）
- explore：移除 `bash`/`list` allow，保留白名單 + readonlyExternalDirectory
- research：移除 `playwright_*` / `mcp_playwright_*` / `claude_claude-plugins-official_playwright_playwright_*` 三條通配符
- `read` 的 env 規則（`*.env` ask 等）需在白名單 allow 規則內保留（放在 `*:deny` 之後）

V2 `packages/core/src/plugin/agent.ts`：同樣改四角色（action/resource/effect 語法）。V2 explore 目前無 bash（與 V1 不一致），統一後兩邊一致。

- [ ] **Step 4: 跑測試確認通過**；修復受影響的既有測試（`plan-mode-subagent-bypass.test.ts` 若斷言 general 有某些工具）
- [ ] **Step 5: Commit**

```bash
git add packages/opencode/src/agent/agent.ts packages/core/src/plugin/agent.ts packages/opencode/test/agent/subagent-whitelist.test.ts packages/core/test/agent-whitelist.test.ts
git commit -m "feat(core): restrict subagent roles to minimal tool whitelists (V1+V2)"
```

---

### Task 2: task 工具 `permission` 授權參數（V1 注入 + 黑名單雙保險）

**Files:**
- Modify: `packages/opencode/src/tool/task.ts`（input schema 加 `permission` grant 參數）
- Modify: `packages/opencode/src/agent/subagent-permissions.ts`（`deriveSubagentSessionPermission` 合入 grant，含黑名單校驗）
- Test: `packages/opencode/test/tool/task-grant.test.ts`（新建）；`packages/opencode/test/agent/subagent-permissions.test.ts`（新建或擴充）

**Interfaces:**
- Consumes: P2 的 `DEFAULT_BLOCKED_TOOLS` / `McpCatalog.isBlockedTool`（`@opencode-ai/core/mcp/catalog`）
- Produces:
  - `TaskTool.Parameters` 新增 `permission?: Array<{ tool: string; resource?: string }>`（只 grant allow）
  - `deriveSubagentSessionPermission` 增加 `grants?: PermissionV1.Rule[]` 參數，返回的 ruleset 把 grant 規則追加在**最後**（V1 匹配語義：後規則優先，參考 V2 findLast）
  - 黑名單工具 grant 時直接忽略並記錄（不 fail 整個 task；黑名單在註冊層已攔截，這裡是雙保險）
  - 「任務結束失效」：grant 只在 `sessions.create` 時注入子代理 session 的 `permission`；`params.task_id` 恢復舊 session 時**不**注入 grant

- [ ] **Step 1: 寫失敗測試**

`packages/opencode/test/agent/subagent-permissions.test.ts`（純函數測試）：
```ts
// deriveSubagentSessionPermission({ parentSessionPermission, subagent, grants })
// 1. grants=[{permission:"playwright_snapshot",pattern:"*",action:"allow"}] 時，結果含該 allow 規則
// 2. grants 含 browser_run_code_unsafe（黑名單）時，結果不含該規則（被過濾）
// 3. 無 grants 時行為不變（現有 plan-mode-subagent-bypass 斷言保持）
```
`packages/opencode/test/tool/task-grant.test.ts`（task 工具 input schema 解析）：`Parameters` 接受 `permission` 欄位並轉成 grant 規則。

- [ ] **Step 2: 跑測試確認失敗**
- [ ] **Step 3: 實現**
- [ ] **Step 4: 跑測試確認通過**；確認 `plan-mode-subagent-bypass.test.ts` 仍綠
- [ ] **Step 5: Commit**

```bash
git add packages/opencode/src/tool/task.ts packages/opencode/src/agent/subagent-permissions.ts packages/opencode/test/
git commit -m "feat(opencode): task tool permission grants with blocklist double-check"
```

---

### Task 3: V2 grant 注入機制（探索 + 實現）

**Files:**
- Explore: `packages/core/src/session/`（`TaskSubmission`、`BackgroundJob`、runner `llm.ts` 的 `effectivePermissions`）
- Modify: 依探索結果（候選：runner 的 `effectivePermissions` 合入 session 級 grants；或 TaskSubmission 事件攜帶 grants 並在子代理 session 建立時注入）
- Test: `packages/core/test/session-subagent-loop.test.ts`（擴充）或新建 `packages/core/test/task-grant-v2.test.ts`

**Interfaces:**
- Consumes: Task 2 的 grant 概念
- Produces: V2 子代理 session 的 `effectivePermissions` 合入主代理授予的 grant（僅該子代理 session，任務結束失效）

**重要背景**：V2 `Session.Info` **沒有 permission 欄位**；V2 runner `effectivePermissions = merge(agent.info?.permissions, fromToolOverrides(prompt?.tools))`，完全來自 agent 定義（全局共享，不可 per-session 修改）。因此 V2 的 grant 需要新機制。Task 1 的白名單已把子代理限死到內建工具；若 V2 子代理執行路徑目前根本不經 task 工具（或 task 工具在 V2 是死路徑——P2-T4 發現 V1 `SessionPrompt` 未接入 server/CLI，但 `TaskSubmission`/`BackgroundJob` 是 V2 機制），則：
- 若 V2 子代理經 `TaskSubmission`/`canonical` 執行：在該路徑建立子代理 session 時把 grant 寫入某處（session 表新增欄位或 runner 上下文），runner 讀取並合入 `effectivePermissions`
- 若 V2 子代理執行路徑就是 V1 task 工具（V1 session 有 `permission` 欄位，Task 2 已注入）：則 V2 側只需確認 `agent.info.permissions` 在白名單下已 deny 一切外部工具，grant 走 V1 注入即完成——此時本任務降級為「驗證 + 記錄」

- [ ] **Step 1: 探查 V2 子代理執行路徑**（TaskSubmission submit → 誰消費 → 子代理 session 如何建立 → runner 的 permissions 來源），把結論寫入 `task-3-report.md`
- [ ] **Step 2: 依探查結果寫失敗測試**（若需要新機制）
- [ ] **Step 3: 實現**（或若無需新機制，補驗證測試證明 V2 子代理白名單生效 + grant 不可穿越）
- [ ] **Step 4: 跑測試確認通過**
- [ ] **Step 5: Commit**

```bash
git add packages/core/... 
git commit -m "feat(core): V2 subagent permission grant injection"
```

---

### Task 4: 外部工具授權協議（系統提示）+ RCE 逃逸回歸 + 全量驗證

**Files:**
- Modify: `packages/core/src/plugin/agent.ts`（BUILD_SYSTEM + 子代理 prompts 加授權協議指引）
- Modify: `packages/opencode/src/agent/prompt/*.txt`（V1 子代理 prompts，若與 V2 分離）
- Test: `packages/core/test/agent-whitelist.test.ts`（擴充 RCE 回歸斷言）或新建 `packages/core/test/subagent-rce-regression.test.ts`

**Interfaces:**
- Produces:
  - BUILD_SYSTEM 的 Tool discovery 段落補一句：「If you are a subagent and need an MCP or plugin tool not in your tool list, report the request to the main agent; it may grant access for this task.」
  - 子代理 prompts（explore/research/worker/general）加：「需要 MCP/plugin 工具時不要猜名調用，向主代理請求授權（說明工具與用途）」
  - RCE 回歸測試：用四角色的 ruleset 對 `browser_run_code_unsafe`、`playwright_*`、`mcp_playwright_*` 逐個 `evaluate`，全部 `deny`；並用 `ToolRegistry.materialize(ruleset)` 斷言 definitions/deferred 不含任何 MCP 工具名

- [ ] **Step 1: 寫失敗測試**（RCE 回歸：當前 research 有 playwright 通配符 → 測試會 fail，證明回歸測試有效）
- [ ] **Step 2: 跑測試確認失敗**
- [ ] **Step 3: 實現**：更新 BUILD_SYSTEM + 子代理 prompts
- [ ] **Step 4: 全量測試 + typecheck**

Run: `cd packages/core && bun test && bun typecheck`；`cd packages/opencode && bun test && bun typecheck`

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/plugin/agent.ts packages/opencode/src/agent/ packages/core/test/ packages/opencode/test/
git commit -m "feat(core): subagent external-tool authorization protocol prompts + RCE regression tests"
```

---

## Self-Review

- **Spec 覆蓋**：P3 覆蓋 spec §3.3 全部四項（四角色白名單 V1+V2、task 工具授權參數、外部工具授權協議、系統提示更新）+ §6 測試（白名單單元測試、grant 生效/失效、RCE 逃逸回歸）
- **與 P2 銜接**：白名單依賴 P2 的 Deferred 機制（MCP 工具進 tool_search，經 `whollyDisabled` 過濾）；黑名單雙保險用 P2 的 `DEFAULT_BLOCKED_TOOLS`/`isBlockedTool`
- **未知點（實現時探索）**：V2 子代理執行路徑是否經 task 工具（T3 的探索步驟）；`list` 工具不在 spec 白名單（V1 explore 現有，需移除——若實現中發現 read 依賴 list 需回報）
- **風險**：
  - general/worker 從 allow-all 收窄為白名單是破壞性變更：既有依賴子代理跑任意工具的流程可能受影響（spec 已確認此設計）
  - V1/V2 白名單容易漂移：T1 測試對兩邊都斷言，確保一致
  - V2 grant 若需新增 session 持久化欄位，涉及 database migration（`packages/core/src/database/migration/`）——超出 P3 範圍時記錄為 follow-up
- **佔位符**：T3 是探索型任務，具體實作由探查結果決定；T1 的測試代碼是骨架，實現時需補完整 evaluate 斷言
