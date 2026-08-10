# 999.0.16 設計：工具暴露模型 + MCP/Plugin 閘道 + 子代理重設計

> 狀態：草案（供用戶審核後進入實現）
> 分支：`999.0.16`
> 參考代碼庫：codex-rust-v0.146.0（ToolExposure + tool_search）、cc-custom（Claude Code marketplace/plugin/agent 模型）、opencode-1.18.15（上游現狀確認）

---

## 1. 背景與問題

現有 fork（999.0.15）的架構：

- MCP/plugin 工具被**逐個註冊成獨立工具**，命名為 `claude_claude-..._playwright_br_<hash>`，與內建工具地位相同
- 權限按工具名匹配（hash 名脆弱），通配符易放太寬
- 子代理 `general`/`worker` 用 **allow-all 默認**，間接拿到所有 MCP/plugin 工具
- 已發生的安全事故：research 子代理透過 playwright 的 `browser_run_code_unsafe`（RCE 等價）逃逸唯讀沙箱執行任意命令
- MCP 工具一多，模型上下文被大量工具定義撐大（token 浪費）

## 2. 目標

1. **安全**：MCP/plugin 工具不再直接暴露給模型（尤其子代理），RCE 類工具從根源不可觸及
2. **Token 節省**：模型上下文只新增一個 `tool_search` 工具，不再注入全部 MCP/plugin 工具定義
3. **子代理最小權限**：四角色（general/explore/research/worker）只配內建工具白名單，外部工具經主代理授權
4. **單一入口**：MCP/plugin 工具統一走 `tool_search` 發現 + 執行，訪問控制收斂在入口

## 3. 新架構

### 3.1 工具暴露模型（移植 codex `ToolExposure`）

每個工具（內建/MCP/plugin）都有一個暴露等級：

| 等級 | 行為 | 適用 |
|---|---|---|
| `Direct` | 直接注入模型工具清單 | 核心內建工具（bash/read/write/edit/grep/glob/webfetch/websearch/task/skill/todo…） |
| `Deferred` | 不注入；註冊進 `tool_search` 索引，模型先搜索再載入 | MCP 工具、plugin 工具、大型/低頻工具 |
| `Hidden` | 永不暴露給模型（僅內部派發） | 內部/管理工具、被黑名單攔截的工具 |

**`tool_search` 工具**（抄 codex）：
- 簽名：`tool_search { query: string, limit?: number }`
- 用 **BM25** 對工具索引（名稱 + 描述 + 參數）做檢索
- 返回匹配的 `LoadableToolSpec`（含名稱、描述、schema、執行入口）
- 模型搜索到後即可像普通工具一樣調用
- 工具描述中列出可搜索的「源」（MCP server / plugin / 命名空間）

**MCP 可見性元數據**（抄 codex `tool_is_model_visible`）：
- MCP server 可在工具 meta 宣告 `ui.visibility`；不含 `model` 的工具即使 Direct 也不對模型顯示

**危險工具黑名單**：
- 在工具註冊層（`McpCatalog`）按原始工具名（如 `browser_run_code_unsafe`）過濾
- 命中黑名單 → `Hidden`（不進 Direct、不進 tool_search 索引）→ 任何 agent 都不可觸及
- 默認值 + 用戶可擴展配置

### 3.2 MCP / Plugin 閘道

- MCP server 連接、工具發現、工具命名邏輯保留，但**註冊等級改為 `Deferred`**（除非明確標記 Direct）
- plugin 工具（plugin-compat / plugin-compat-v2）同樣 `Deferred`
- 訪問控制收斂在 `tool_search` 與執行入口：
  - `tool_search` 索引建立時就剔除黑名單工具
  - 執行前按「該 session 的權限」校驗（Deferred 工具也受權限規則約束）
- 效果：模型上下文只有 `tool_search`；實際要用的 MCP/plugin 工具才被載入

### 3.3 子代理重設計（保留四角色）

**原則**：子代理 = 內建工具白名單（default deny），MCP/plugin 工具一律不配。

| 角色 | 模型（默認，可設置切換） | 內建工具白名單 | 職責 |
|---|---|---|---|
| `explore` | deepseek v4 flash | read, grep, glob, webfetch, websearch | 快速唯讀代碼搜索 |
| `general` | deepseek v4 flash | bash, read, write, edit, grep, glob, webfetch, websearch, task, skill | 通用多步任務 |
| `research` | gpt-5.6-sol | read, grep, glob, webfetch, websearch | 深度唯讀分析 + 網頁文本 |
| `worker` | gpt-5.6-luna | bash, read, write, edit, grep, glob, webfetch, task | 受限實現 + 驗證 |

**外部工具授權協議**：
1. 子代理需要 MCP/plugin 工具時，在任務中向主代理**請求授權**（哪個工具、做什麼）
2. 主代理判斷後，透過 `task` 工具的**授權參數**（`permission` grant）按任務範圍授予
3. 子代理在該任務內自己使用（其多模態模型可看截圖）
4. 任務結束授權失效
5. 主代理無法授予被黑名單攔截的工具（雙保險）

**權限模型統一**：
- 所有子代理改為 `default deny` + 顯式白名單（explore/research 模式）
- `general`/`worker` 從 allow-all 收窄為白名單
- V1（`packages/opencode/src/agent/agent.ts`）與 V2（`packages/core/src/plugin/agent.ts`）同步

### 3.4 Plugin / 市場

- 保留現有 marketplace/plugin 機制（源自 cc-custom）
- plugin 的 MCP server 工具統一 `Deferred` + `tool_search`
- plugin 可捆綁 agents（後續可支援 markdown agent 定義，抄 cc-custom）

## 4. 數據流

```
開機：
  MCP server 連接 → 工具發現 → 分類：
    core 工具 → Direct（注入）
    MCP/plugin 工具 → Deferred（進 tool_search 索引；黑名單 → Hidden）
  註冊 tool_search 工具（BM25 索引）

模型 turn：
  模型看到 [Direct 工具...] + [tool_search]
  需要 MCP/plugin 工具時 → tool_search {query}
  → 拿到 LoadableToolSpec → 像普通工具一樣調用
  執行時權限校驗（按 session 的 ruleset）

子代理：
  主代理派發 task（可帶 permission grant）
  子代理 session 權限 = 角色白名單 + grant
  子代理只用內建工具；需要外部工具 → 回報請求 → 主代理授權
```

## 5. 實現階段（拆分）

| 階段 | 內容 | 規模 |
|---|---|---|
| **P1：ToolExposure 核心** | 引入 `ToolExposure` 概念；`tool_search` 工具（BM25 索引）；工具註冊層支援 Direct/Deferred/Hidden | 大 |
| **P2：MCP/plugin Deferred 化** | MCP/plugin 工具改 Deferred；黑名單（`browser_run_code_unsafe` 等）；MCP visibility 元數據 | 中 |
| **P3：子代理重設計** | 四角色最小權限白名單（V1+V2）；task 工具授權參數；外部工具授權協議；系統提示更新 | 中 |
| **P4：plugin/市場整合** | plugin MCP 工具 Deferred；plugin 捆綁 agent（markdown）支援 | 中 |

每階段獨立可測、可合併；P1-P3 是安全關鍵，優先做。

## 6. 測試

- P1：`tool_search` 檢索正確性（BM25 命中、limit）；Deferred 工具不進 Direct 清單
- P2：黑名單工具不進索引、不可調用；MCP visibility 元數據生效
- P3：每個子代理權限白名單單元測試；授權 grant 生效/失效；RCE 逃逸回歸測試（子代理無法觸及 `browser_run_code_unsafe`）
- P4：plugin 工具 Deferred 化；markdown agent 載入

## 7. 風險

- `tool_search` 是較大新功能：需要 LLM 層、工具註冊層、協議（tool-call）配合
- 模型（deepseek v4 flash / gpt-5.6）對 `tool_search` 的採用率需要實測（是否會主動搜索，還是直接猜工具名）
- 向後相容：現有 session / 工具名（`br_<hash>`）可能變化
- BM25 需要中文/英文索引質量（工具描述語言）

## 8. 已確認決策

- [x] **工具名重建**：MCP/plugin 工具命名重設計，放棄 `br_<hash>`；接受現有 session/權限規則的遷移成本。新命名需人可讀、穩定（例：`<server>_<tool>` 按原始名 sanitize，避免 hash 截斷）
- [x] **授權由主代理自主判斷**：主代理授權子代理使用外部工具時，自主決定（執行/授權/拒絕），不彈用戶確認
- [x] **tool_search 採用率引導**：在系統提示中加入對 `tool_search` 的明確引導（「需要外部/MCP 工具時，先調 tool_search 查詢，不要憑猜測調用不存在的工具」），尤其針對 deepseek 系模型（實測不主動用）；同時允許把少量高頻 MCP 工具配置為 `Direct` 作為兜底（降低延遲、提高採用）

