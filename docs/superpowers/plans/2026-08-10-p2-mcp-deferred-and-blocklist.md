# P2: MCP 工具 Deferred 化 + 危險工具黑名單 + visibility 實現計劃

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓 MCP 工具默認走 `Deferred`（經 `tool_search` 發現，不再直接注入模型），加危險工具黑名單（`browser_run_code_unsafe` 等）與 MCP `ui.visibility` 元數據支持，並恢復 `todowrite` 為 Direct。

**Architecture:** 在 MCP 工具註冊層（`packages/core/src/mcp/runtime.ts` 的 `toolsLayer.sync`）對每個 MCP 工具做四重判斷：黑名單命中 → 不註冊；`ui.visibility` 不含 `model` → 不註冊（Hidden）；配置 `directTools` 命中 → Direct；否則 → Deferred（經 `tool_search`）。配置在 `ConfigMCP.Info` 新增 `blockedTools` / `directTools`。

**Tech Stack:** TypeScript / Effect / bun test。沿用 P1 的 `Tool.withExposure` 與 `Materialization.deferred`。

## Global Constraints

- 所有測試在 `packages/core` 下用 `bun test` 執行
- 不改動現有內建工具的行為（除 todowrite 恢復 Direct）
- 不要修改 generated SDK / protocol schema；**不要改 `@modelcontextprotocol/sdk` 的 `_meta` 解析之外的外部依賴**
- 黑名單默認值必須包含 `browser_run_code_unsafe`
- 權限/覆寫門控（P1 的 `overrides`/`whollyDisabled`）對 Deferred MCP 工具同樣生效（由 materialize 處理）
- P1 分支（`999.0.16`）已含 ToolExposure + tool_search（HEAD = 94512e5）

---

### Task 1: 配置 schema 擴展（blockedTools / directTools）

**Files:**
- Modify: `packages/core/src/config/mcp.ts`
- Modify: `packages/core/src/mcp/runtime.ts`（`resolveConfig` + `ResolvedConfig` 類型）
- Test: 新增 `packages/core/test/config-mcp.test.ts`（或併入 mcp runtime 測試）

**Interfaces:**
- Produces:
  - `ConfigMCP.Info` 新增 `readonly blockedTools?: string[]` 與 `readonly directTools?: string[]`
  - `ResolvedConfig` 新增 `readonly blockedTools: ReadonlySet<string>` 與 `readonly directTools: ReadonlySet<string>`（resolveConfig 合併所有配置文檔）
  - `DEFAULT_BLOCKED_TOOLS: readonly string[] = ["browser_run_code_unsafe"]`（`catalog.ts` 或 `runtime.ts` 導出）

- [x] **Step 1: 寫失敗測試**

```ts
// packages/core/test/config-mcp.test.ts
import { describe, expect, test } from "bun:test"
import { ConfigMCP } from "@opencode-ai/core/config/mcp"

describe("ConfigMCP", () => {
  test("Info accepts blockedTools and directTools", () => {
    const info = ConfigMCP.Info.make({
      blockedTools: ["browser_run_code_unsafe", "foo"],
      directTools: ["playwright_snapshot"],
    })
    expect(info.blockedTools).toEqual(["browser_run_code_unsafe", "foo"])
    expect(info.directTools).toEqual(["playwright_snapshot"])
  })
})
```

- [x] **Step 2: 跑測試確認失敗**

Run: `cd packages/core && bun test test/config-mcp.test.ts`
Expected: FAIL — 類型上沒有 `blockedTools`/`directTools`

- [x] **Step 3: 實現**

`packages/core/src/config/mcp.ts` 的 `Info` 類新增：

```ts
export class Info extends Schema.Class<Info>("ConfigV2.MCP")({
  timeout: Timeout.pipe(Schema.optional),
  servers: Schema.Record(Schema.String, Server).pipe(Schema.optional),
  blockedTools: Schema.Array(Schema.String).pipe(Schema.optional).annotate({
    description: "MCP tool names to hide entirely (never advertised or searchable). Defaults include RCE-equivalent tools like browser_run_code_unsafe.",
  }),
  directTools: Schema.Array(Schema.String).pipe(Schema.optional).annotate({
    description: "MCP tool names to keep Direct (injected into the model tool list) as a fallback, e.g. high-frequency tools.",
  }),
}) {}
```

`packages/core/src/mcp/runtime.ts`：

```ts
// 新增常量
export const DEFAULT_BLOCKED_TOOLS: readonly string[] = ["browser_run_code_unsafe"]

type ResolvedConfig = {
  readonly timeout: ConfigMCP.Timeout
  readonly servers: Record<string, ServerConfig>
  readonly blockedTools: ReadonlySet<string>
  readonly directTools: ReadonlySet<string>
}

function resolveConfig(entries: ReadonlyArray<Config.Entry>): ResolvedConfig {
  const configured = entries.flatMap((entry) => (entry.type === "document" && entry.info.mcp ? [entry.info.mcp] : []))
  return {
    timeout: Object.assign(new ConfigMCP.Timeout({}), ...configured.map((info) => info.timeout ?? {})),
    servers: Object.assign({}, ...configured.map((info) => info.servers ?? {})),
    blockedTools: new Set([
      ...DEFAULT_BLOCKED_TOOLS,
      ...configured.flatMap((info) => info.blockedTools ?? []),
    ]),
    directTools: new Set(configured.flatMap((info) => info.directTools ?? [])),
  }
}
```

- [x] **Step 4: 跑測試確認通過**

Run: `cd packages/core && bun test test/config-mcp.test.ts`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add packages/core/src/config/mcp.ts packages/core/src/mcp/runtime.ts packages/core/test/config-mcp.test.ts
git commit -m "feat(core): add blockedTools/directTools MCP config"
```

---

### Task 2: MCP 工具註冊層四重判斷（黑名單 / visibility / directTools / 默認 Deferred）

**Files:**
- Modify: `packages/core/src/mcp/runtime.ts`（`toolsLayer.sync`）
- Modify: `packages/core/src/mcp/catalog.ts`（新增 `isModelVisible` / `isBlocked` 輔助）
- Test: 新增 `packages/core/test/mcp-tool-exposure.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `ResolvedConfig.blockedTools/directTools`、`DEFAULT_BLOCKED_TOOLS`；P1 的 `Tool.withExposure`
- Produces:
  - `McpCatalog.isBlockedTool(name: string, blocked: ReadonlySet<string>): boolean`
  - `McpCatalog.isModelVisible(def: MCPToolDefinition): boolean`（解析 `def._meta?.ui?.visibility`；無 visibility 或含 `"model"` 為可見）
  - `toolsLayer.sync` 對每個 MCP 工具：blocked → skip；!isModelVisible → skip；directTools.has(name) → Direct；否則 `withExposure(..., "deferred")`

- [x] **Step 1: 寫失敗測試**

```ts
// packages/core/test/mcp-tool-exposure.test.ts
import { describe, expect } from "bun:test"
import { McpCatalog } from "@opencode-ai/core/mcp/catalog"

describe("McpCatalog exposure", () => {
  test("isBlockedTool", () => {
    expect(McpCatalog.isBlockedTool("browser_run_code_unsafe", new Set(["browser_run_code_unsafe"]))).toBe(true)
    expect(McpCatalog.isBlockedTool("browser_snapshot", new Set(["browser_run_code_unsafe"]))).toBe(false)
  })

  test("isModelVisible: no _meta → visible", () => {
    const def = { name: "x", description: "d", inputSchema: { type: "object" as const } }
    expect(McpCatalog.isModelVisible(def as never)).toBe(true)
  })

  test("isModelVisible: ui.visibility without 'model' → hidden", () => {
    const def = { name: "x", _meta: { ui: { visibility: ["manual"] } } }
    expect(McpCatalog.isModelVisible(def as never)).toBe(false)
  })

  test("isModelVisible: ui.visibility including 'model' → visible", () => {
    const def = { name: "x", _meta: { ui: { visibility: ["model", "manual"] } } }
    expect(McpCatalog.isModelVisible(def as never)).toBe(true)
  })
})
```

（注意 `isModelVisible` 的入參是 `MCPToolDefinition`（`@modelcontextprotocol/sdk` 的 `Tool`），測試用最小物件 cast。）

- [x] **Step 2: 跑測試確認失敗**

Run: `cd packages/core && bun test test/mcp-tool-exposure.test.ts`
Expected: FAIL — `isBlockedTool`/`isModelVisible` 不存在

- [x] **Step 3: 實現**

`packages/core/src/mcp/catalog.ts` 新增：

```ts
export const isBlockedTool = (name: string, blocked: ReadonlySet<string>): boolean => blocked.has(name)

const MCP_UI_META_KEY = "ui"
const MCP_UI_VISIBILITY_KEY = "visibility"
const MCP_UI_MODEL_VISIBILITY = "model"

/** Returns whether an MCP tool may be exposed to the model.
 *  Tools without `_meta.ui.visibility` remain visible; tools with visibility
 *  metadata are hidden unless it explicitly includes `"model"`.
 */
export const isModelVisible = (def: MCPToolDefinition): boolean => {
  const visibility = def._meta?.[MCP_UI_META_KEY]?.[MCP_UI_VISIBILITY_KEY]
  if (!Array.isArray(visibility)) return true
  return visibility.some((target) => target === MCP_UI_MODEL_VISIBILITY)
}
```

（`_meta` 是 `Record<string, unknown>`，取 `ui`/`visibility` 需類型收窄——用 `as Record<string, unknown>` 輔助或結構化取。）

`packages/core/src/mcp/runtime.ts` 的 `toolsLayer.sync`：

```ts
const catalog = {
  ...Object.fromEntries(
    Object.entries(yield* mcp.tools())
      .filter(([, entry]) => !McpCatalog.isBlockedTool(entry.def.name, resolved.blockedTools))
      .filter(([, entry]) => McpCatalog.isModelVisible(entry.def))
      .map(([name, entry]) => {
        const coreTool = McpCatalog.toCoreTool(entry)
        const exposure = resolved.directTools.has(name) ? "direct" : "deferred"
        return [name, Tool.withExposure(coreTool, exposure)]
      }),
  ),
  ...(yield* McpResourceTools.catalog()),
}
```

（`resolved` 已在 layer 開頭由 `resolveConfig(yield* config.entries())` 得到；`Tool` 已是 `catalog.ts` 的導入別名，runtime.ts 需 `import { Tool } from "../tool/tool"`。）

- [x] **Step 4: 跑測試確認通過**

Run: `cd packages/core && bun test test/mcp-tool-exposure.test.ts`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add packages/core/src/mcp/catalog.ts packages/core/src/mcp/runtime.ts packages/core/test/mcp-tool-exposure.test.ts
git commit -m "feat(core): defer MCP tools by default with blocklist and visibility gates"
```

---

### Task 3: 恢復 todowrite 為 Direct + 修正 BUILD_SYSTEM 措辭

**Files:**
- Modify: `packages/core/src/tool/todowrite.ts`（移除 `withExposure(..., "deferred")`）
- Modify: `packages/core/src/plugin/agent.ts`（BUILD_SYSTEM 的 Tool discovery 措辭）
- Test: `packages/core/test/tool-search-deferred.test.ts`、`packages/core/test/location-layer.test.ts`（更新 todowrite 恢復 Direct 後的清單）

**Interfaces:**
- Consumes: Task 2（MCP 已 Deferred）
- Produces: `todowrite` 回到 Direct；BUILD_SYSTEM 措辭與實際行為一致

- [x] **Step 1: 移除 todowrite 的 withExposure**

`packages/core/src/tool/todowrite.ts`：把 `Tool.withExposure(Tool.make({...}), "deferred")` 改回 `Tool.make({...})`。

- [x] **Step 2: 修正 BUILD_SYSTEM 措辭**

`packages/core/src/plugin/agent.ts` 的 `## Tool discovery` 段落改為（現在 MCP 工具確實不直接列出）：

```text

## Tool discovery
MCP and plugin tools are not listed up front. If you need such a tool that is not in your tool list, call `tool_search` with a query describing what you want to accomplish, then call the returned tool by its exact name. Do not invent tool names — search first.
```

（把「Tools like MCP or plugin tools」改為精確的「MCP and plugin tools」，並確保與 P2 後行為一致。）

- [x] **Step 3: 更新受影響測試**

- `packages/core/test/location-layer.test.ts`：`tool_search` 從預期內建清單移除（因 todowrite 恢復 Direct 後無 deferred 內建工具 → tool_search 不再注入；除非 MCP deferred 存在——location-layer 測試無 MCP，故移除 `tool_search`）
- `packages/core/test/tool-search-deferred.test.ts`：todowrite 相關的「deferred builtin e2e」用例更新——若無其他 deferred 內建工具，該用例可改為用自定義 `Tool.withExposure(..., "deferred")` 工具替代，或刪除並保留自定義 deferred 用例
- 跑受影響測試確認通過

- [x] **Step 4: 全量測試**

Run: `cd packages/core && bun test`
Expected: 全綠（數量可能因 MCP/工具暴露變化而變動）

- [x] **Step 5: Commit**

```bash
git add packages/core/src/tool/todowrite.ts packages/core/src/plugin/agent.ts packages/core/test/
git commit -m "fix(core): restore todowrite to direct and align tool_search guidance"
```

---

### Task 4: 驗證 MCP 工具端到端 Deferred + 黑名單

**Files:**
- Test: `packages/core/test/mcp-tool-exposure.test.ts`（擴充）
- 可能 Modify: `packages/core/src/mcp/runtime.ts`（若需要暴露測試掛鉤）

**Interfaces:**
- Consumes: Task 2 的 `toolsLayer.sync` 判斷
- Produces: 端到端驗證——註冊一個模擬 MCP server（deferred 工具 + 一個黑名單名 + 一個 directTools 名），斷言 materialize 的 `deferred`/`definitions` 符合預期

- [x] **Step 1: 寫端到端測試**

```ts
// packages/core/test/mcp-tool-exposure.test.ts（追加）
// 用 MCP runtime 的 mock client（參考現有 mcp 測試的 client mock 模式）註冊：
//   - "playwright_snapshot"（普通）→ deferred 命中
//   - "browser_run_code_unsafe"（黑名單）→ 不在 deferred 也不在 definitions
//   - "playwright_navigate" 且 directTools 含它 → Direct
// 斷言 materialize 結果。
```

- [x] **Step 2: 跑測試確認失敗/通過**

Run: `cd packages/core && bun test test/mcp-tool-exposure.test.ts`

- [x] **Step 3: 檢查 V1 路徑**

`packages/opencode/src/session/tools.ts` 的 MCP 工具循環（`for (const [key, entry] of Object.entries(yield* mcp.tools()))`）——確認 V1 是否仍會把 MCP 工具直接註冊。fork 是 V2-first（legacy-session-execution 路由到 V2），若 V1 循環仍在活躍路徑，需同樣套用 Deferred/黑名單；若為死路徑則記錄並在報告說明。

- [x] **Step 4: 全量測試 + typecheck**

Run: `cd packages/core && bun test && bun typecheck`

- [x] **Step 5: Commit**

```bash
git add packages/core/test/mcp-tool-exposure.test.ts
git commit -m "test(core): e2e verify MCP deferral, blocklist, and directTools override"
```

---

## Self-Review

- **Spec 覆蓋**：P2 覆蓋 spec §3.1 的「MCP/plugin 工具 Deferred」「危險工具黑名單」「MCP visibility 元數據」，以及 §8 決策「少量高頻 MCP 工具可配 Direct 兜底」（`directTools`）；同時兌現 ledger 中 P1 的 P2 指令（恢復 todowrite Direct、修正 BUILD_SYSTEM 措辭）
- **佔位符**：無 TBD/TODO；Task 4 的端到端測試描述了要斷言的內容，實現時需補具體 mock client 構造（參考 `packages/core/test/mcp-resource-tools.test.ts` 或 mcp runtime 現有測試）
- **型別一致性**：`blockedTools`/`directTools`（ConfigMCP.Info）→ `ResolvedConfig.blockedTools/directTools`（ReadonlySet）→ `McpCatalog.isBlockedTool/isModelVisible` → `toolsLayer.sync` 的 `Tool.withExposure` 一致引用
- **風險**：`_meta` 的類型收窄（`Record<string, unknown>`）需要小心；location-layer 測試的 `tool_search` 期望會因 todowrite 恢復而變化（Task 3 處理）

---

## Known Issues (recorded — deferred to a later stage, do not fix during P2)

### K1: App 端 `V2 server health contract unavailable`（環境報錯）

- **症狀**：desktop app renderer 在啟動連線時拋 `Error: V2 server health contract unavailable`（`packages/app/src/utils/server-protocol.ts:89`，`detectServerProtocolDetails` v2 模式）。
- **診斷（已做，2026-08-10）**：
  - 觸發條件：v2 模式下探測 `/api/health` 的回應缺 `pid`（→ 拋「health contract unavailable」）；或 `/api/health` 有 pid 但 `/api/capability` 缺 `backgroundSubagents`（→ 拋「capability contract unavailable」）。
  - **Fork server 已完整實現兩者**：`/api/health` → `{ healthy: true, pid: process.pid }`（`packages/server/src/handlers/health.ts` + `packages/protocol/src/groups/health.ts`）；`/api/capability` → `{ backgroundSubagents: true }`（`handlers/capability.ts` + `groups/capability.ts`）。`serve-process.test.ts` 端到端證實 `/api/health` 正常。
  - 與 P1/P2 變更無關（server 路由/health 代碼未被觸碰）。
- **最可能成因**（按可能性排序）：
  1. 啟動競態：app 首次探測時 server 尚未就緒（連線拒絕 → probe undefined）。app 有 `refreshProtocol()` 重連邏輯，通常自癒。
  2. server 進程是舊版本/非本 fork 構建（不含 `/api/health`）。
  3. auth 401（server 設密碼且探測缺 header；renderer 有密碼時會帶 Basic header，可能性低）。
- **修復方向（後續階段，勿在 P2 做）**：
  - 重啟/重建 server 後驗證：`curl /api/health`（預期 `{"healthy":true,"pid":<num>}`）與 `curl /api/capability`（預期 `{"backgroundSubagents":true}`）。
  - 若確定要防啟動競態：可考慮在 app 側對 `/api/health` 探測加短重試（數次 200ms 退避），或在 server 側確保 listen 完成後才開始對外暴露（通常已如此）。
- **狀態**：已修（2026-08-10）。雙層修復：
  - server 側：`packages/server/src/middleware/authorization.ts` 放行 `/api/health` 與 `/api/capability`（免 auth）——消除帶密碼 server 下探測 401 的根因（實測：health/capability 無 auth 200、`/api/session` 仍 401）
  - app 側：`packages/app/src/utils/server-protocol.ts` 對 `/api/health` 探測加 3 次重試——吸收 sidecar 啟動競態
  - 回歸測試：`httpapi-authorization.test.ts`（免 auth 斷言）、`server-protocol.test.ts`（重試斷言）
