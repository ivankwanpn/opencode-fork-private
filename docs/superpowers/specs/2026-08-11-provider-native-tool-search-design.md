# Provider-native Tool Search 與 V2 durable discovery 設計

> 狀態：`888.0.18` 已完成並驗證 Plugin runtime readiness、canonical Tool Catalog、provider-neutral search、durable discovery、generic cross-drain fallback、OpenAI Responses 原生 Tool Search，以及跨 OS process restart recovery；Anthropic native 與其餘 hardening 尚未完成
> 日期：2026-08-11（2026-08-15 依 `999.0.17` 基線修訂）
> 目標工作樹：`D:\agent-complete\opencode-fork-private-999.0.15`
> 參考實作：`D:\agent-complete\codex-rust-v0.146.0`、`D:\opencode-bugfix\cc-custom`
> 實作分支：`888.0.18`
> 基線提交：`12338c50de205a6ce963e723b4548b8535d0e616`

## 1. 文件目的

目前 OpenCode 已把原本的 P5 proof of concept 擴充為 provider-neutral canonical search：結果是結構化 loadable specs，搜索結果以 ToolKey/definitionHash 寫入 V2 durable event 與可重建 projection，generic provider 在同一 drain、後續新 drain、獨立 runtime 重建與 compaction 邊界後都能恢復仍有效的普通 definitions。OpenAI OAuth 經 ChatGPT Codex endpoint 解析出的 Responses route 已能使用原生 `tool_search`／`tool_search_output`，並由三輪 V2 Session regression 驗證不會把已發現工具重新注入普通 definitions。另有兩個完全獨立的 Bun OS processes 共用同一 SQLite 檔案：第一個完成搜索並退出，第二個建立全新 V2 runtime 後恢復相同 `tool_search_call`／`tool_search_output` 配對與 discovered spec。Anthropic 原生協議仍待後續 phase。

本文件定義完整 Tool Search 的目標架構。`888.0.18` 已完成 Phase 0、Phase 1、durable discovery、generic cross-drain fallback、OpenAI Responses native adapter 與 child-OS-process runner 回歸；落地證據記錄於 `docs/superpowers/plans/2026-08-15-durable-tool-discovery.md`、`docs/superpowers/plans/2026-08-15-openai-responses-native-tool-search.md` 與 `docs/superpowers/plans/2026-08-15-native-tool-search-process-restart.md`。後續工作應依序補 Anthropic native adapter、自動 capability downgrade 持久化，以及 MCP／subagent hardening。

核心決策是：

1. 以 Codex 的結構化搜索結果、BM25、namespace 和 OpenAI Responses 原生 `tool_search_output` 為主要架構參考。
2. 以 Claude Code 的 deferred-tool 生命週期、`tool_reference`、MCP pending 狀態、相容性門控和錯誤恢復為運行參考。
3. 不把任何 provider wire format 當成 OpenCode 真實狀態；已發現工具必須保存為 OpenCode V2 durable session record。
4. OpenAI Responses、Anthropic Messages 和 generic provider 各自使用獨立 adapter，但共用同一份 canonical catalog、搜索服務和 durable discovery projection。

## 1.1 `999.0.17` 基線審計結果

已核對目前 HEAD，而不是沿用 2026-08-11 的舊假設：

- `packages/core/src/tool/registry.ts` 已是唯一 canonical executable registry，並且是 Location-scoped；本設計不得新增第二套 executor、authorization callback 或 provider-specific registry。
- `packages/core/src/mcp/runtime.ts` 已把 MCP tool 註冊到該 registry，會監聽 `McpEvent.ToolsChanged` 並以 scoped registration 更新目錄；MCP tool 預設為 `deferred`。
- `packages/opencode/src/tool/plugin-compat-v2.ts` 已把 Plugin tool 轉為 Core Tool 並註冊到相同 registry；Plugin tool 也預設為 `deferred`。
- `packages/schema/src/session-event.ts`、durable manifest、`EventV2` transaction projector 和 `packages/core/src/session/projector.ts` 已提供新增 durable discovery event 所需的完整基礎。
- `packages/llm/src/protocols/openai-responses.ts` 目前只認得 function tool／`function_call_output`；尚無原生 `tool_search`／`tool_search_output`。
- `packages/llm/src/protocols/anthropic-messages.ts` 目前沒有 client tool `tool_reference` 或 deferred definition 的 `defer_loading`。
- 現有 P5 regression 只證明同一個 drain 內下一個 provider turn 會注入工具，沒有證明 restart、replay、compaction 或 provider-native wire 行為。
- `packages/app/src/components/settings-v2/plugins.tsx` 把初始 catalog 設成空陣列，非同步 `plugins.list()` 完成前便渲染 `No plugins available`；既有 `busy === "load"` 沒有參與 empty-state 判斷。
- Plugin 頁面的 `installed`／`enabled` 是管理狀態，不是 runtime readiness；目前只有 MCP 有部分 runtime 顯示，而且 `mcp_ready === false` 時會隱藏狀態而不是顯示初始化中。

因此本分支的方向是**擴充現有 V2 邊界**，而不是重建 Plugin/MCP/ToolRegistry。

## 1.2 `888.0.18` 已驗證範圍

本分支已完成以下 provider-neutral 基礎，不代表整個 Tool Search 設計已完成：

- Plugin catalog 的 loading、empty、error 與 stale-request 狀態不再混淆；runtime readiness 可區分 `initializing`、`ready`、`degraded`、`failed`、`disabled`。
- `ToolRegistry` 仍是唯一可執行 registry 與 settlement boundary，並在 Location-scoped materialization 後產生 canonical catalog。
- Tool identity 使用明確 source ownership、source-local ID 與 deterministic ToolKey；definition hash 覆蓋最終 post-hook model-visible definition。
- 搜索支援驗證後的 exact `select:`、ToolKey/callable exact match、nested schema BM25、穩定排序與 revision cache，輸出 canonical structured loadable specs。
- 同一 drain 內的選擇以 ToolKey/definitionHash 單調累積；schema 或來源替換會使舊選擇失效。
- MCP 與 Plugin 工具以 scoped contribution 發布明確來源；Plugin 設定頁的 tools readiness 直接讀 ToolRegistry source state，不再固定為 `pending`。
- `SessionEvent.ToolDiscovery.Completed` 只保存最小身份資料，兩張 SQLite projection 在 durable append 的同一 transaction 內投影 invocation 與 unioned selection。
- exact retry 不重跑搜索；query/limit 衝突、stale definition hash、empty result、permission override 與 durable commit failure 都 fail closed。
- Session runner 每個 logical turn 從 projection 恢復選擇，因此後續新 drain 與 compaction 後的第一個 provider request 已可 materialize 仍有效的 generic definitions。

2026-08-15 durable tranche 的新鮮回歸證據為 Schema `29 pass / 0 fail`、Core `1600 pass / 7 skip / 0 fail`、Client `21 pass / 0 fail`、App reducer `11 pass / 0 fail`、TUI data `8 pass / 0 fail`、OpenCode event/bridge `11 pass / 0 fail`；Schema、Core、Client、Protocol、Server、App、TUI、OpenCode 的 `bun typecheck` 與 Client `check:generated` 全部通過。

2026-08-15 OpenAI Responses native tranche 新增 explicit provider-neutral discovery semantics、durable native history rebuild、fail-closed model capability、native request lowering/parser，以及真實 adapter 的三輪 V2 Session regression。Post-implementation review 進一步把 durable carrier 與 native history correlation 收斂為完整 `(assistantMessageID, callID)` invocation identity，修復 partial pair reconstruction、native discovery token estimate、client-only stream dispatch、anonymous search tool choice 與 canonical `ToolDefinition.kind`。新鮮證據為 LLM `334 pass / 30 skip / 0 fail`、Core `1605 pass / 7 skip / 0 fail`、Plugin loading/runtime UI `14 pass / 0 fail`；LLM、Core、Schema、Protocol、Client、Server、OpenCode、App、TUI package typecheck 全部通過。

2026-08-15 process-restart tranche 以 parent regression 依序啟動兩個獨立 Bun OS processes，兩者只共用同一個臨時 SQLite 檔案與 Session ID。第一個 process 經真實 V2 runner 完成 native search 後退出；第二個 process 建立全新的 Database、EventV2、Projector、SessionStore、ToolRegistry、SessionRunner 與 SessionExecution runtime，並驗證恢復出的 call/output 都保留 `process-search`、仍包含 `deferred_echo` loadable spec，且不把它重新廣告成普通 function definition。新鮮證據為 process regression `1 pass / 0 fail / 16 assertions`、Core affected suite `142 pass / 0 fail`、LLM full suite `334 pass / 30 skip / 0 fail`，Core 與 LLM typecheck 均通過。

仍未完成且不得提前宣稱完成：

- Anthropic Messages 原生 `tool_reference`／`defer_loading` adapter；
- Anthropic provider-native history reconstruction，以及 capability negotiation 的自動 downgrade 持久化；
- MCP reconnect/late-load 與 subagent grant intersection 的後續 hardening。

## 1.3 方案比較與選擇

考慮過三種落地方式：

1. **只修 P5 的 `Set`。** 把 replacement 改成 union，再把名稱寫入 Session metadata。改動最小，但 callable name 不能抵抗同名 source、Plugin/MCP 更新或 schema replacement，也無法支援 provider-native history。
2. **Canonical catalog + durable discovery + provider adapters。** 在現有 Core Tool runtime 上增加 catalog metadata，以穩定 key/hash 發布 durable event，再由 OpenAI、Anthropic 和 generic adapter 分別編碼。改動較多，但完全符合 V2 durability、Location ownership 和 permission 邊界。
3. **像 Claude Code 一樣從 provider messages 掃描 `tool_reference`。** 可少做 projection table，但 compaction、provider switch 和 crash recovery 都會依賴 wire history，與 V2 event-sourced Session 方向衝突。

選擇方案 2。方案 1 只會延後 identity 與 durability 問題；方案 3 可作 adapter 一致性檢查，但不能成為 OpenCode source of truth。

## 2. 非目標

本分支不應同時重寫整個 Plugin、MCP 或 subagent 系統。那些系統已經共用 V2 ToolRegistry，只需要補足 Tool Search 所需的清晰介面：

- 可搜索的 canonical tool catalog；
- `direct`、`deferred`、`hidden` exposure；
- source、namespace、permissions 和 registry revision；
- MCP server 的 runtime health；
- subagent 的 capability grant。

本設計不處理：

- Marketplace 安裝流程或版面重做；但 Plugin catalog 的 loading/empty/error 真實狀態和 runtime readiness 顯示屬於本設計範圍；
- Plugin 指令列表刷新；
- MCP OAuth UI；
- subagent 排程與背景任務生命週期；
- 將所有 provider 強制統一成相同 wire format；
- 向模型暴露被 `hidden` 或權限拒絕的工具名稱。

## 3. Phase 1 前 P5 的問題與目前邊界

以下清單保留 Phase 1 開始時的基線，便於解釋 canonical tranche 修正了什麼。普通文字結果、名稱 identity、replacement Set、搜尋欄位不足、revision cache、process-local discovery、durable replay、compaction 與 OpenAI Responses provider-native wire 已在 `888.0.18` 修正；Anthropic native wire 與完整 process-restart 整合回歸仍未完成。

- `packages/core/src/tool/tool-search.ts`
  - `Output` 是 `Schema.String`；
  - 只搜索 tool name 和 description；
  - input schema 的 property 名稱和描述不參與搜索；
  - 搜索結果只是包含 JSON 字串的模型文字，不是結構化 loadable spec。
- `packages/core/src/tool/registry.ts`
  - `selected`／`onSelect` 是 materialization 的臨時 context；
  - deferred tool 的解鎖依賴下一次 materialize 時重新注入 definition。
- `packages/core/src/session/runner/llm.ts`
  - `searchedTools` 是 process-local；
  - 每次 `select` 以 `new Set(names)` 替換舊集合，而不是累積；
  - 新 drain、程序重啟、crash recovery 或其他重建路徑會失去狀態。
- `packages/core/test/tool-search-dynamic.test.ts`
  - 名稱聲稱驗證 structured loadable spec，但主要斷言仍是普通文字；
  - 沒有覆蓋兩次搜索的 union、重啟、compaction、catalog revision 或 provider-native wire format。

此外，`onSelect` 的輸入只是 callable name。即使把 `Set` 改成 union，它仍可能把同名但已由其他 Plugin/MCP source 取代的 implementation 當成已解鎖，因此不能作為最終 identity。

在新架構完成前，現有 P5 可以保留作為 generic fallback 的雛形，但不能繼續擴張成 OpenAI／Anthropic 的共同協議。

## 4. 參考實作結論

### 4.1 Codex 應吸收的部分

參考：

- `codex-rs/core/src/tools/handlers/tool_search.rs`
- `codex-rs/core/src/tools/handlers/tool_search_spec.rs`
- `codex-rs/tools/src/tool_search.rs`
- `codex-rs/core/tests/suite/search_tool.rs`

應吸收：

- BM25 搜索；
- 搜索文字包含名稱、描述、namespace、input schema property 和 property description；
- 結構化 `LoadableToolSpec`；
- function 和 namespace 結果；
- loadable spec 明確標記 `defer_loading: true`；
- OpenAI Responses 使用原生 `tool_search`／`tool_search_output`；
- follow-up request 依賴 `tool_search_output` history，不把已發現工具重新放進普通 tool definitions；
- catalog 不變時重用搜索索引，catalog 變化時重建。

不應照搬：

- 把 Responses history 當成 OpenCode 唯一的 discovery source of truth；
- 假設所有 provider 都支援 Responses native Tool Search；
- 把 Codex Apps 的 source 模型直接套到所有 Plugin/MCP。

### 4.2 Claude Code 應吸收的部分

參考：

- `src/tools/ToolSearchTool/ToolSearchTool.ts`
- `src/tools/ToolSearchTool/prompt.ts`
- `src/utils/toolSearch.ts`
- `src/services/api/claude.ts`
- `src/services/tools/toolExecution.ts`
- `src/services/compact/compact.ts`

應吸收：

- `select:ToolA,ToolB` 精確選擇 fast path；
- MCP tool name、server name、action name 和 `searchHint` 的搜索處理；
- `tool_reference` Anthropic 原生結果；
- 已發現工具做 union，不因下一次搜索而撤銷前一次結果；
- MCP server 尚在 connecting 時，把空結果視為暫時狀態；
- 模型、provider route、beta header 和第三方 proxy 的 capability gate；
- 不支援原生格式時退回 generic mode；
- 模型直接調用未載入工具時，回覆 `select:<exact-name>` 的可操作錯誤；
- catalog 變化時失效 description/search cache；
- 對 deferred catalog 大小使用門檻，避免工具很少時多花一次搜索 round trip。

不應照搬：

- 從 Anthropic message blocks 掃描 OpenCode 的 canonical state；
- 將 `preCompactDiscoveredTools` 作為核心持久化格式；
- 用 Anthropic beta capability 判定代替通用 provider capability；
- 讓 model-facing tool name 成為唯一穩定 identity。

## 5. 核心不變量

實作必須維持以下不變量：

1. **Discovery 不等於 permission grant。** 找到工具只代表模型取得 schema；實際執行仍必須通過目前 Session、Agent、Subagent 和 Tool permission。
2. **Hidden 永不出現在搜索索引。** 不得洩露名稱、描述、schema、source 或存在性。
3. **Deferred 只有搜索後才可調用。** generic adapter 不能因工具存在於 registry 就接受未搜索的直接調用。
4. **Direct 永遠不需要搜索。** 重要 built-in 和主要控制工具保持第一輪可用。
5. **已發現集合只累積，不被後一次搜索替換。** 失效必須有可解釋原因，例如工具移除、schema hash 改變、source disable 或 permission 變更。
6. **程序記憶體不是真實來源。** restart、重新 drain、provider retry 和 compaction 後必須可由 durable state 恢復。
7. **Provider wire format 不是 Core schema。** `tool_search_output` 和 `tool_reference` 只能出現在 adapter 邊界。
8. **Catalog 變化可檢測。** 搜索和執行之間發生工具替換時，不得把舊 schema 的參數送給新 implementation。
9. **Location-scoped。** Tool catalog、MCP runtime、Plugin contributions 和搜索索引遵守 Location 邊界，不得退化為 process-global catalog。
10. **Subagent fail closed。** 子代理只能搜索 capability grant 與自身 permission 交集中的工具。
11. **管理狀態不冒充 runtime 狀態。** `installed`／`enabled` 不能顯示為「可用」；只有 Location runtime 的 capability snapshot 能判定 `ready`。
12. **Loading 不冒充 empty。** Plugin catalog 和 runtime snapshot 尚未完成時必須顯示初始化中；只有成功完成且結果為空才可顯示空目錄。

## 6. Canonical Tool Catalog

Tool Search 不應直接遍歷臨時 provider definitions。它應依賴現有 ToolRegistry 在 materialization 時產生的 Location-scoped canonical catalog snapshot。

不得新增第二種 executable tool。Catalog metadata 應附著在現有 Core Tool runtime／registration 上；settlement 仍然只經過 `ToolRegistry.settle` 和 leaf Tool 的 permission 邊界。Builtin、Plugin 與 MCP registration 只需提供來源資訊，沒有提供時只能使用明確的 builtin default，不能從 callable name 猜測第三方 source。

每個可搜索條目至少包含：

```ts
type SearchableTool = {
  key: ToolKey
  sourceLocalID: string
  callableName: string
  namespace?: string
  displayName?: string
  description: string
  searchHint?: string
  inputSchema: JsonSchema
  exposure: "direct" | "deferred" | "hidden"
  source: {
    type: "builtin" | "plugin" | "mcp" | "app"
    id: string
    displayName?: string
  }
  definitionHash: string
}
```

`ToolKey` 必須是 opaque branded string，由 `source.type + source.id + sourceLocalID` 的 canonical encoding 產生，不能只使用 model-facing callable name。MCP 應使用 server identity + 原始 MCP tool name；Plugin 應使用 plugin identity + plugin-local tool name；builtin 使用固定 builtin identity。顯示名稱、description 和 callable-name collision suffix 不得成為唯一 identity。

`definitionHash` 由最終 model-visible description、input/output schema、exposure、callable name 和 source ownership 的 deterministic canonical JSON 計算。Plugin definition hook 的結果必須在 hash 內，避免 hook 改 schema/description 後繼續沿用舊 discovery。

Catalog snapshot 還應包含：

```ts
type ToolCatalogSnapshot = {
  revision: string
  tools: readonly SearchableTool[]
  sources: readonly Array<{
    source: ToolSourceRef
    state: "pending" | "ready" | "degraded" | "failed" | "disabled"
    message?: string
  }>
}
```

`revision` 使用 snapshot 內容的 deterministic hash，必須在可搜索工具集合、definition、exposure、source ownership 或 source state 變化時改變。這比 process-local counter 更適合 Location runtime 重建，也讓相同內容在 restart 後得到相同 revision。

Snapshot 必須在現有 materialization 的 visibility、agent、session permission、tool override 和 subagent grant 過濾後產生；不得先建立含 denied/hidden tools 的共享搜索索引再於結果階段過濾，避免名稱、document frequency 或 diagnostics 洩漏不可見工具。

MCP/Plugin 使用與 tool registration 相同的 scoped contribution 生命週期發布 source state。MCP 尚未完成 `tools/list` 時可註冊 `pending` source；重連後以新 scope 原子替換為 `ready` snapshot。ToolRegistry 仍不反向依賴 MCP 或 Plugin。

同一份 source identity 與 state vocabulary 也提供給 Plugin runtime readiness projection；ToolRegistry 不承擔 Skills、Commands 或 hooks 的管理，但 Plugin 頁面不得另外發明一套互相矛盾的「已連線／可用」判斷。

## 7. 搜索服務

搜索服務是 provider-neutral 的純邏輯邊界。它接收已過濾的 `ToolCatalogSnapshot`，不執行 permission 或 tool settlement。順序為：

1. 驗證非空 query 和 limit；
2. 處理 `select:<name>[,<name>...]`；
3. 處理 exact canonical／callable name match；
4. 對自然語言使用 BM25；
5. 以穩定 tie-breaker 排序；
6. 回傳 canonical 結構化結果。

BM25 document 應包含：

- callable name 原文與分詞版本；
- namespace；
- source display name、Plugin name、MCP server name；
- display name；
- description；
- `searchHint`；
- input schema property 名稱；
- property description；
- nested items、variants 和 enum 的可理解描述。

預設 limit 為 8，上限為 20；空 query、非整數、`limit <= 0` 和超過上限都回傳 typed validation failure，不偷偷使用 catalog 前 N 筆。精確 `select:` 可允許多選，但同樣受上限限制，避免模型一次載入整個 catalog。

BM25 index 以 snapshot revision 作 cache key；相同 revision 重用，revision 變化即重建。排名相同時按 `ToolKey` 排序，確保跨 restart 與測試 deterministic。

搜索結果不得包含 secrets、MCP connection arguments、OAuth token、API key 或本機環境變數。

## 8. Durable discovery record

新增 V2 durable session event，使用 `SessionEvent.ToolDiscovery.Completed` 概念與現有 `session.next.*` 命名：

```ts
SessionEvent.ToolDiscovery.Completed {
  timestamp
  sessionID
  assistantMessageID
  callID
  query
  limit
  catalogRevision
  matches: Array<{
    key: ToolKey
    callableName: string
    definitionHash: string
    source: ToolSourceRef
  }>
  pendingSources: ToolSourceRef[]
}
```

規則：

- 只在本地搜索完成後發布一次；
- empty result 也可保存，以便 UI／diagnostics 理解實際發生過的搜索，但 empty result 不解鎖工具；
- provider retry 不得重複產生互相矛盾的 completed records；
- `(sessionID, assistantMessageID, callID)` 是 invocation identity；exact retry 的 query/limit 相同時重用已投影結果，不再執行搜索或發布事件，不同時回傳 conflict；
- event 中不得保存完整 schema，完整 definition 由當前 catalog 依 `ToolKey + definitionHash` 取得；
- projection 對多次 completed events 做 union；
- 只有當目前 catalog 仍存在相同 `ToolKey + definitionHash`，並且 exposure、permission 和 capability 仍允許時，該工具才是 active discovery。

這個 event 應加入 durable event manifest 和 replay/projector 測試。若 UI 不需要展示 Tool Search，不必立即新增 transcript part；既有 Tool Called/Success transcript 仍負責呈現 model-facing invocation/output，discovery event 只負責 canonical unlock state。

Projection 使用兩個明確用途的表：

- `session_tool_discovery_call`：以 invocation identity 唯一，保存 query、limit、catalog revision、matches、pending sources、event seq 和時間，供 exact retry/recovery 重用；
- `session_tool_discovery`：以 `(session_id, tool_key)` 唯一，保存最新已發現的 definition hash、callable name、source、discovered seq 和時間；多次搜索透過 upsert 做 union，同 key 的新 hash 只有重新搜索後才取代舊 hash。

兩張表都由 durable event projector 在與 event append 相同的 transaction 更新。它們是可重建 projection，不是第二份事件真實來源。

### 8.1 為什麼不保存完整 schema

完整 schema 可能很大，也可能包含不應長期重複保存在每個 Session 的描述。保存 key 和 hash 可以：

- 驗證搜索後 schema 是否仍相同；
- 避免 durable log 膨脹；
- 在 Plugin/MCP 更新後強制重新搜索；
- 讓 provider adapter從目前 canonical catalog生成 wire spec。

### 8.2 Compaction 與 restart

Compaction 只改變提供給模型的上下文，不刪除 durable discovery event。Session 恢復時，projection 從 event log 重建 active discovered set；不需要 Claude Code 的 `preCompactDiscoveredTools` 特殊欄位。

既有 generic Tool Called/Success message 是 provider-neutral 的 search call/output carrier。Provider adapter 根據 tool-search semantic definition 與 typed structured result，將同一對 canonical tool call/result 映射成 `tool_search_output` 或 `tool_reference`；不把原始 provider SDK object存入 Core。

Compaction 後，history builder 必須保留或由 durable call projection重建仍 active 的 search call/result pair，讓 native provider 看得到 loadable spec。不能只恢復 `session_tool_discovery` 的 unlock set，卻丟掉 native provider 執行 deferred call 所需的 wire history。

## 9. Provider adapters

### 9.1 OpenAI Responses

能力可用時：

- advertise 原生 `type: "tool_search"`；
- 本地執行 canonical 搜索；
- 把結果編碼成 `tool_search_output`，包含完整 loadable function／namespace spec；
- spec 標記 `defer_loading: true`；
- follow-up request 依賴 history 中的 `tool_search_output`；
- 不把已發現工具重新注入普通 definitions；
- history normalization、compaction 和 orphan-call repair 必須理解 search call／output 配對。

這條路徑應有 regression，明確斷言第二和第三個 provider request 都沒有普通 discovered-tool injection。

### 9.2 Anthropic Messages

能力可用時：

- `tool_search` 仍可表現為 client-side tool；
- 搜索結果映射為 `tool_result.content[].type = "tool_reference"`；
- 對 deferred definitions 使用 Anthropic 支援的 `defer_loading`；
- 添加正確 beta header；
- 從 OpenCode durable projection決定哪些工具已發現，而不是掃描 SDK message object 作真實來源；
- adapter 可掃描 provider history作一致性檢查，但不能取代 projection；
- 不支援 `tool_reference` 的模型、route 或 proxy 必須改走 generic adapter。

能力判定必須 fail closed。不能只用 model name 猜測後永久假定可用；provider／route 明確拒絕 beta block 時，應記錄安全的 capability downgrade。

### 9.3 Generic provider fallback

不支援原生 Tool Search 時：

- advertise 普通 function tool `tool_search`；
- output 使用結構化 JSON，而不是純 schema 字串；
- settlement 發布相同 durable discovery event；
- 下一個 provider request 只注入 active discovered tools 的普通 definitions；
- 如果模型直接調用未發現的 deferred tool，回覆：先執行 `tool_search`，使用 `select:<exact-name>`，然後重試；
- 不應在同一 provider error 上無限自動重試 native／generic 模式。

Generic fallback 是相容路徑，不應限制 OpenAI／Anthropic 原生路徑的資料模型。

### 9.4 Protocol-neutral semantic carrier

`LLMRequest.tools` 已加入 discriminated semantic tool spec（普通 function 與 tool-search），並以 `deferLoading`、`namespace` 與 typed `toolDiscoveries` 承載 provider-neutral discovery 語義，讓各 protocol mapper 都能看到同一個 `tool-search` 意圖：

- OpenAI Responses lowering 成 provider-native `type: "tool_search"`；
- Anthropic lowering 成帶 deferred semantics 的 client tool；
- generic lowering 成普通 function definition。

這不是把 provider wire format放進 Core，而是把「這是一個 discovery tool」表示為 provider-neutral semantic。不得靠名稱字串、任意 `native` record 或 providerID scattered checks 猜測。

## 10. Capability negotiation

需要明確 capability，而不是散落的 providerID 判斷：

```ts
type ToolDiscoveryCapability =
  | { mode: "responses-native" }
  | { mode: "anthropic-reference"; betaHeader: string }
  | { mode: "generic-injection" }
  | { mode: "disabled"; reason: string }
```

判斷輸入至少包含：

- provider protocol；
- model capability；-實際 route／base URL；
- proxy 或 gateway 已知能力；-使用者 feature override／kill switch；
- deferred catalog 大小；
- Tool Search permission；-是否有 pending MCP sources。

若 deferred 工具很少，adapter 可以直接 materialize 它們而不啟用 Tool Search。門檻應基於估算 token 或 schema size，並提供 deterministic override 供測試和診斷。

Capability 的 ownership 分三層：

1. LLM protocol 宣告它能編碼的模式；
2. resolved route/model capability 明確選擇 native、generic 或 disabled，並可因 proxy/base URL／feature override 降級；
3. Session runner 只消費 resolved capability，不自行用 model name 或 providerID 猜測。

第一個可執行 tranche 先完成 `generic-injection`，其後已打開 OpenAI Responses native adapter。OpenAI native capability 目前只在 OpenAI OAuth 經 `https://chatgpt.com/backend-api/codex` 解析出的 route 上 fail-closed 啟用；API key、自訂 endpoint、proxy 與僅手動選擇 Responses protocol 的模型仍使用 generic semantics。Anthropic native adapter 與 provider 拒絕後的自動 downgrade 持久化仍屬後續 phase。

## 11. MCP 與 Plugin 動態目錄

Tool Search 必須把 enabled state 和 runtime health 分開：

- Plugin enabled 不代表 MCP connected；
- MCP connected 不代表 tools/list 已完成；
- tools/list 完成後仍可能因 server notification 或重連更新。

搜索時：

- 若有匹配結果，正常返回；
- 若沒有結果且相關 source 尚 pending，返回 structured pending source 資訊並建議稍後重試；
- source 更新時增加 catalog revision並重建／失效搜索索引；-已發現工具 definitionHash 改變後不再 active，必須重新搜索；
- source disabled／removed 後不得再 materialize 或執行；
- source 恢復且 key/hash 相同時，是否重新 active 應由 implementation plan 明確決定，預設採較安全策略：要求重新搜索。

### 11.1 Plugin catalog 與 runtime readiness

Plugin 設定頁必須分開處理兩個非同步資料源：

1. **Global management catalog**：Marketplace、已安裝、已啟用和宣告 capabilities；
2. **Location-scoped runtime snapshot**：目前 workspace/location 中，各 capability 是否真正載入。

Catalog request 使用明確的 client-side state machine：

```ts
type PluginCatalogLoadState =
  | { state: "loading"; catalog?: PluginCatalog }
  | { state: "ready"; catalog: PluginCatalog }
  | { state: "failed"; message: string; catalog?: PluginCatalog }
```

規則：

- 初次請求與手動 retry 顯示 loading，不使用空 catalog 佔位；
- 只有 `ready` 且 catalog 真正為空時顯示 `No plugins available`；
- `failed` 保留最後一次成功 catalog（若存在），標記資料可能過期，並提供 Retry；
- mutation 期間可以保留目前清單並在被操作項目顯示 busy，不把整頁退回 loading；
- component unmount 或 generation/server 切換後，過期請求不得覆蓋新 generation 的狀態。

Runtime snapshot 使用新的 Location-scoped read contract，不把 runtime 探測塞進全域 `/api/plugins` catalog 請求：

```ts
type PluginRuntimeSnapshot = {
  revision: string
  plugins: readonly Array<{
    pluginID: string
    state: "disabled" | "initializing" | "ready" | "degraded" | "failed"
    capabilities: readonly Array<{
      type: "skills" | "commands" | "mcp" | "plugin" | "tools"
      state: "disabled" | "pending" | "ready" | "failed"
      message?: string
    }>
    updatedAt: number
  }>
}
```

Client 另以 fetch state 包裝最後成功 snapshot：

```ts
type PluginRuntimeLoadState =
  | { state: "loading"; snapshot?: PluginRuntimeSnapshot }
  | { state: "ready"; snapshot: PluginRuntimeSnapshot }
  | { state: "failed"; message: string; snapshot?: PluginRuntimeSnapshot }
```

`failed` 且帶 snapshot 時，UI 顯示 snapshot 已過期；不得把它當作新的 ready 結果。

Protocol 增加獨立的 Location-aware runtime status endpoint；全域 Plugin catalog 保持管理資料，不因某個 workspace 尚未初始化而變慢。若 public Protocol/HttpApi 因此變更，必須按 repository 規則從 `packages/client` 執行 `bun run generate`，不得直接改 generated client。

Aggregate 規則：

- 未安裝或未啟用是 `disabled`；
- 任一宣告 capability 尚未完成初次探測是 `initializing`；
- 所有宣告 capability 都可用是 `ready`；
- 至少一項可用、至少一項失敗是 `degraded`；
- 已啟用但沒有任何宣告 capability 可用，且不存在 pending，是 `failed`。

Capability 狀態必須來自 authoritative runtime：

- Skills 從目前 `SkillV2` catalog 驗證 Plugin 安裝時預期的 skill identities；
- Commands 從目前 `CommandV2` catalog 驗證 Plugin 安裝時預期的 command identities；
- MCP 使用 `MCP.status()` 與初始 `tools/list` readiness，不把 `enabled` 當作 connected；
- Plugin hooks 使用 Plugin loader 的成功／失敗結果；
- Plugin tools 使用 ToolRegistry 的 source contribution state。

Plugin 安裝資料需要保存或可 deterministic 重建預期 capability identities，不能只憑 `capabilities: ["skills", "commands"]` 推斷「有任意 skill/command 就算成功」。所有 message 必須是去除 secrets 的安全摘要。

UI 顯示：

- 清單 loading：`正在載入 Plugins…`；
- runtime pending：`已啟用 · 正在初始化`，並列出 pending capability；
- ready：`已啟用 · 可用`；
- degraded：`已啟用 · 部分可用`，列出 ready/failed capability；
- failed：`已啟用 · 載入失敗`，提供 Retry/refresh；
- disabled：沿用停用狀態，不顯示綠色 ready indicator。

所有新增文案必須使用現有 i18n key，不在 component 內新增硬編碼英文或中文。

同一個 source lifecycle 供 Tool Search 使用：Plugin tools/MCP pending 時 catalog source 為 `pending`；ready 後更新 revision；degraded 時只有已成功註冊且通過 visibility 的 tools 可搜索；disabled/failed source 不可搜索。這使 UI 顯示與 Agent 實際可發現能力一致。

## 12. Permissions 與 subagent

### 12.1 搜索前過濾

搜索索引只能包含當前 actor 可知道存在的工具：

```text
canonical catalog
∩ exposure != hidden
∩ selected agent visibility
∩ session permission visibility
∩ subagent capability grant
```

執行時仍要重新做 permission check，因為搜索與執行之間規則可能改變。

### 12.2 Subagent 隔離

- discovery state 預設 Session-scoped；父 Session 的 discovered set 不自動複製到子 Session；-父代理授予 capability 後，子代理可在自己的授權 catalog 中搜索；-子代理不得藉由搜索列出未授權 MCP／Plugin tool；-搜索結果不提升 grant；-如果未來需要繼承 discovery，必須用明確的 handoff record，不得共享 process-global `Set`。

## 13. 錯誤與恢復

必須定義並測試：

- 空 query：模型可理解的 validation error；
- limit 為 0、負數或過大：拒絕或 clamp，行為一致；
- 無結果：structured empty result；
- 無結果且 MCP pending：structured pending result；
- 搜索後工具被移除：stale discovery，要求重新搜索；
- 搜索後 schema hash 改變：拒絕舊調用並要求重新搜索；
- 未搜索直接調用 deferred tool：回覆 exact `select:` 指引；
- provider 不接受 native block：安全降級到 generic capability，最多重試一次；
- provider retry：不能重複執行 local search side effect；
- crash 發生在搜索完成與下一輪請求之間：恢復後從 durable event 繼續；
- compaction 發生在搜索後：active discovery 不丟失；
- permission 在搜索後改為 deny：不得執行；
- source reconnect 後同 callable name 指向不同 identity：不得錯誤復用舊 discovery。
- Plugin catalog loading 時不得顯示空目錄；
- Plugin runtime pending 時不得顯示 ready 或靜默隱藏狀態；
- runtime status request 失敗時保留最後成功 snapshot 並標記 stale，不能回退成「已啟用即正常」；
- generation/server/location 切換後忽略前一個 request 的遲到結果。

所有錯誤對模型可以包含安全的 tool name、source display name 和操作指引，但不得包含 token、credential、原始 provider response body 或 MCP 啟動環境。

## 14. Observability

建議記錄不含 secrets 的 metrics／structured logs：

- capability mode；
- deferred tool count 和估算 schema tokens；
- search query token count，不必默認保存完整 query；
- result count；
- exact select／BM25；
- zero-result-with-pending；
- index rebuild count 和 catalog revision；
- native capability downgrade；
- stale discovery；-未搜索直接調用；-搜索後到實際工具調用的 conversion rate；-節省的 tool schema token 估算。
- Plugin catalog load latency／failure；
- Plugin runtime snapshot latency、pending duration 與 degraded/failed capability count。

完整 query 可能含使用者資料，除非明確允許，不應寫入遙測；durable Session event 因為屬於使用者自己的工作階段，可以保存 query，但 export／diagnostics 必須遵守現有隱私邊界。

## 15. 測試矩陣

### 15.1 搜索單元測試

- exact name；
- `select:` 單選與多選；
- BM25 description match；
- schema property／description match；
- namespace 和 source name match；
- MCP server/action 分詞；
- deterministic tie-break；
- limit；
- hidden 和 denied tools 不可搜索；
- catalog 不變重用 index，revision 改變重建 index。

### 15.2 Durable state

-兩次搜索結果做 union；-第二次搜索不撤銷第一次結果；-新 drain 恢復；-程序重啟後 replay 恢復；
-compaction 後恢復；
-provider retry 冪等；
-catalog hash 改變使舊 discovery 失效；
-source removal／disable 失效；
-event payload 不包含完整 schema 或 secrets。

### 15.3 Provider wire tests

OpenAI Responses：

-首個請求只包含 direct tools 和 native `tool_search`；
-search output 是結構化 loadable spec；-第二個和第三個請求不普通注入 discovered tool；
-function 和 namespace 都可執行；
-history normalization 保持 call/output 配對。

Anthropic Messages：

-正確 beta header；
-search result 是 `tool_reference`；-只有 active discovered deferred definitions 被發送；-不支援模型／proxy 使用 generic fallback；
-fallback 時 provider message 不殘留無效 `tool_reference`。

Generic：

-search output 是 structured JSON；-下一輪注入 active discovered definitions；-未搜索直接調用被拒絕；-第二次搜索仍保留第一次工具。

### 15.4 MCP／Plugin／subagent

-Plugin catalog initial request pending 時顯示 loading，不顯示 `No plugins available`；
-Plugin catalog 成功回傳空結果後才顯示 empty；
-Plugin catalog failure 顯示 Retry，並保留/標記最後成功資料；-遲到的舊 generation catalog response 不覆蓋新 generation；
-Plugin runtime initial snapshot 顯示 initializing；
-Skills／Commands／MCP／Plugin hooks／Plugin tools readiness 分別來自 authoritative catalog/runtime；-部分 capability 失敗顯示 degraded，全部成功顯示 ready，全部失敗顯示 failed；
-UI aggregate 狀態與 Tool Search source state 使用相同 identity/state 語義；
-MCP pending 空搜索提示重試；
-late tools/list 後搜索成功；
-MCP reconnect 更新 revision；
-Plugin disable 後 discovered tool 不能執行；-同名不同 source 不錯誤復用；
-subagent 搜索只看到 grant 交集；-父 Session discovery 不自動洩露給子 Session；-搜索不繞過執行 permission。

## 16. 分階段落地順序

這不是逐檔 implementation plan；未來 agent 應在基線穩定後依此順序另外撰寫 plan。

### Phase 0：重新建立基線

- [x] 確認分支 `888.0.18` 和基線 `12338c50`；
- [x] 重新搜索 P5、ToolRegistry、SessionEvent、provider protocol 和 MCP runtime；
- [x] 核對 Codex 結構化 output/BM25/native Responses 行為；
- [x] 核對 Claude Code exact select/tool reference/MCP pending 行為；
- [x] 更新 Plugin/MCP 已共用 V2 ToolRegistry 的失效假設；
- [x] 本設計確認後撰寫逐檔 TDD implementation plan。

### Phase 1：Plugin readiness、Canonical catalog 與搜索服務

- [x] 先以 App component regression 修正 Plugin catalog loading/empty/error，不等待 Tool Search 核心完成；
- [x] 穩定 ToolKey、source identity、definitionHash 和 revision；
- [x] 完成 scoped source lifecycle，使 MCP/Plugin tool contribution 可報告 pending／ready／degraded／failed／disabled；
- [x] 新增 Location-scoped Plugin runtime endpoint，聚合 Skills、Commands、MCP、Plugin hooks 和 Plugin tools readiness；
- [x] Plugin 設定頁顯示 initializing／ready／degraded／failed／disabled，並保留 failed request 前最後一次成功 snapshot；
- [x] 實作 exact select + BM25；
- [x] 保持 provider-neutral；
- [x] 以單元與跨套件 regression 固定語義。

### Phase 2：Durable discovery

- [x] 新增 Schema event；
- [x] event manifest；
- [x] publish／project／replay；
- [x] 把目前的 in-drain union 擴充為 durable union projection；
- [x] 完成新 drain、compaction、exact retry／replay regression；
- [x] 補完整 OS process restart 的端到端整合 regression。

### Phase 3：Generic fallback

- [x] 把現有 P5 改為 canonical structured output；
- [x] 下一輪 definitions 由 durable active discovery materialize；
- [x] 加入 stale／未搜索直接調用提示；
- [x] 以新 drain／compaction regression 證明非原生 provider 行為穩定；
- [x] 以完整 OS process restart regression 補足端到端證據。

### Phase 4：OpenAI Responses native adapter

- [x] 原生 `tool_search`／`tool_search_output`；
- [x] namespace/loadable spec；
- [x] history normalization，含 compaction 後由 durable record 合成缺失配對；
- [x] 禁止 follow-up ordinary definition injection，並以三輪 V2 Session + 真實 Responses adapter regression 固定。

### Phase 5：Anthropic native adapter

- [ ] `tool_reference`；
- [ ] `defer_loading`；
- [ ] beta headers 和 capability gate；
- [ ] proxy/model fallback。

### Phase 6：MCP／Plugin／subagent hardening

- [x] pending/ready/failed/disabled source publication 基礎；
- [ ] catalog revision／reconnect 完整恢復；
- [ ] 驗證 Plugin readiness 和 Tool Search source lifecycle 在 reconnect／late load／source replacement 時保持一致；
- [ ] capability grant intersection；
- [ ] observability；
- [x] durable projection 完成後刪除過時 process-local discovery 真實來源；runner 只保留每 turn 的可重建快取。

## 17. 驗收標準

只有以下條件全部成立，才能宣稱新 Tool Search 完成：

1. OpenAI Responses 走原生 `tool_search_output`，follow-up 不普通注入 definitions。
2. Anthropic 支援時走 `tool_reference`，不支援時安全退回 generic。
3. 其他 provider 可以使用 generic fallback。
4. 搜索結果是結構化 spec，不是純文字 JSON dump。
5. 多次搜索累積，不互相覆蓋。
6. 新 drain、restart 和 compaction 後 discovery 保留。
7. Catalog／schema 變化不會執行 stale tool。
8. MCP pending 和 late connection 可恢復。
9. Hidden、denied 和未授權 subagent tools 不會出現在搜索結果。
10. Discovery 永不繞過 permission。
11. Plugin catalog loading、empty 和 failed 不再混淆，遲到的舊 generation response 不污染目前頁面。
12. Plugin 頁面顯示的 runtime 狀態與 Location 中 Skills、Commands、MCP、hooks 和 tools 的實際 readiness 一致。
13. Provider adapter tests、durable replay tests、Plugin UI/runtime tests 和跨 package typecheck 全部通過。
14. 不新增 Core → Server、Client → Core／Server 等反向 runtime dependency。

## 18. 未來 agent 開始工作的檢查表

1. 先讀 repository `AGENTS.md`。
2. 確認當前 branch、HEAD 和工作樹；不要覆蓋其他 agent 的變更。
3. 讀最新 `V1-to-V2-migration.md` 和本文件。
4. 用 `rg` 重新定位 Tool Search、ToolRegistry、SessionEvent、provider adapters、MCP runtime 和 subagent grants。
5. 先寫新的 implementation plan，不直接照本文件的舊行號修改。
6. 採 TDD：先建立 failing regression，再改 production code。
7. Schema／Protocol／HttpApi 變更後按 repository 指示重新生成 client；不得直接修改 generated files。
8. 測試和 `bun typecheck` 必須從各 package 目錄執行。
9. 每一 phase 單獨 review，避免在同一 commit 混入 V1 清理、Marketplace 版面重做或其他無關重構；本設計要求的 Plugin loading/readiness 顯示除外。
10. 完成前跑 full durable replay、provider wire、MCP reconnect、subagent isolation 和 package typecheck 驗證。

## 19. 最終建議

不要在 Codex 和 Claude Code 之間選擇單一整套移植：

- Codex 適合定義搜索、結構化結果和 OpenAI Responses adapter；
- Claude Code 適合定義 Anthropic adapter、deferred runtime 邊界和失敗恢復；
- OpenCode V2 必須自己擁有 durable discovery state、catalog revision 和跨 provider projection。

如此才能同時得到原生協議效率、多 provider 相容性，以及與 V1 → V2 遷移方向一致的可恢復狀態模型。
