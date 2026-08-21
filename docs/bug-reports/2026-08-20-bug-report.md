# Bug 報告：opencode fork（branch `999.0.19`）— 2026-08-20

> 本報告彙整 2026-08-20 調查期間發現的全部問題（使用者實測回報 + 靜態程式碼審查 + 實機 log/安裝目錄調查）。
> **所有問題均未修改**，僅記錄證據與建議修補方向，供開發 agent 接手。
>
> 調查基準：`D:\agent-complete\opencode-fork-private-999.0.15`（HEAD `7bfc7d6`，領先 origin 1 commit）。
> 背景：專案正在執行 V1→V2 全面遷移（見 `V1-to-V2-migration.md`），執行引擎已是 V2，plugin 載入為「V1 格式 + V2 註冊」過渡態。

---

## 2026-08-20 開發跟進

此區記錄 HEAD `7bfc7d6` 之後的實作與反證；下方原始報告保留當時證據，不應再被視為目前狀態。

| ID | 跟進狀態 | 結果 |
|---|---|---|
| S1 | 已修復 | openai-chat 在 text/tool output 開始後忽略違規的 late `reasoning_content`，不再重啟同一 reasoning id。 |
| S2 | 已修復 | V2 message updater 對相同 reasoning id 的 Started 事件採冪等處理。 |
| S3 | 部分修復 | 新舊介面的 thinking placeholder 都只在「尚無可見 assistant output」時顯示；reasoning 內容預設折疊仍未實作。 |
| S4 | 獨立重構 | 不能直接移除 semaphore：它還保護平行 tool-result 與 publisher fragments/tools 狀態。應另行設計 EventV2 live/durable 雙通道與 durability flush barrier，先補 profile/ordering tests。 |
| S5 | 原報告已過期 | App 現碼已使用 16ms frame flush、Solid batch，並合併相鄰 canonical text/reasoning/tool-input/compaction deltas；相關測試通過。 |
| S6 | 原報告已過期 | `createPacedValue` 在剩餘內容不超過 512 字元時已立即同步，不存在原報告的最後 96 字固定爬行。 |
| S7 | 組態行為 | 使用者選擇 `max` 會增加模型思考量；未改成靜默覆寫使用者 variant。 |
| P1 | 已修復 | 真正根因是 `Location.Ref.make({ directory })` 與顯式 `workspaceID: undefined` 產生不同 Effect hash key；LocationServiceMap 現在先正規化 Ref。真實 serve subprocess 已驗證 marketplace plugin/skill 共用同一 Location runtime。 |
| P2 | 已修復 | 非 plugin export 會被略過；只有整個 module 沒有可用 plugin function 時才失敗。 |
| P3 | 診斷已收斂 | catalog 的 capability 只代表 package 宣告 server entrypoint；不在列表頁 import/執行未啟用程式碼。實際 shape/load failure 由 PluginV2 status 回傳具體 Cause。 |
| P4 | 原報告已過期 | Core `PluginV2.add()` 已自行保留 failed status 與 Cause，add effect 失敗後不需要第二個 die-plugin。 |
| P5 | 已修復 | 每個 V1 event hook 呼叫獨立 catch/log；單次 handler failure 不再殺死 subscription。 |
| P6 | 已修復 | V1 compatibility projection 將暫時無法解析的 OAuth credential 視為 unavailable 並記 warning，不再讓 plugin activation 因 refresh 403 失敗；真正模型請求仍會回報授權錯誤。 |
| P7 | 反證：不可刪 | 自賦值會觸發 State draft proxy，聲明 plugin 對 base integration 的 overlay ownership。刪除後 `plugin.auth-override` 測試失敗；已恢復並補註解。 |
| P8 | 已修復 | V1 config hooks 只取得一次性深層快照；plugin 間仍按順序共享 mutation，但不再污染 Config singleton 或後續寫回。V2 skill/MCP/plugin capability 仍直接註冊 registry。 |
| C1 | 已修復 | Client/generated-effect 已重新生成；連續生成前後 diff hash 相同。 |
| C2 | 已修復 | V2 key connect payload、Server handler、generated Client 與 App prompt UI 全部支援 `inputs`。 |
| C3 | 已修復 | 未知 integration 與缺少 method 現在回 typed V2 `InputValidationError`，不再寫入幽靈 credential。 |
| C4 | 已修復 | scanner 能辨識 `~user/...`；跨平台無可靠 identity resolver 時 fail closed，不啟動 shell process。 |
| C5 | 已修復 | process-global Share subscriber 在 callback 邊界恢復初始化 Location 的 InstanceRef/workspace scope。 |
| C6 | 已實作，待安裝版 smoke | sidecar 強制 `OPENCODE_PRINT_LOGS=1`，Effect log 會進 stderr pipe，再由 Desktop logger 收集。 |
| C7 | 已實作，待安裝版 smoke | Desktop 不再自動把 `XDG_STATE_HOME` 指向 userData；明確外部 XDG 與 onboarding 隔離環境仍保留。 |
| R1 | 額外修復 | 未 promoted 的 queue input 不再列入 startup candidates；真實 server restart 測試確認重啟不會自行執行 queue。 |

---

## 摘要表

| ID | 嚴重度 | 區域 | 標題 |
|---|---|---|---|
| S1 | 🔴 高 | LLM 協定 | native openai-chat：reasoning 可用同一 id 在 text 之後重新開始 → 思考與文字重疊 |
| S2 | 🟠 中 | 投影 | `message-updater` 對重啟的 reasoning 重複 push 相同 id 的 part |
| S3 | 🟡 低 | UI | 思考全文永不折疊 + 「思考中」占位 row 常駐 → 視覺上的思考/文字重疊 |
| S4 | 🟠 中 | Runner | 所有事件發布被 1-permit semaphore 串行化，durable DB 事務夾在 delta 之間 |
| S5 | 🟠 中 | App/Desktop | 每 delta 全量 store/timeline/markdown 更新 → renderer 掉幀、事件積壓（含 ResizeObserver loop） |
| S6 | 🟡 低 | UI | `createPacedValue` 尾段爬行（最後 ~96 字元每 24ms 只揭露 2-8 字元） |
| S7 | 🟡 低 | 組態 | deepseek-v4 模型掛 `reasoning_effort` variants（low/medium/high/max），high/max 會拉長思考 |
| P1 | 🟠 中 | Plugin | superpowers「外挂程式不可用」：載入路徑實測正常，需 tooltip 訊息定位（競態或執行環境失敗） |
| P2 | 🔴 高 | Plugin | `getLegacyPlugins` 對任一非函數 export 直接 throw（production 實證：`~/.config/opencode/plugin/core.ts`） |
| P3 | 🟠 中 | Plugin | `installedCapabilities` 以 `pkg.main` 存在即宣稱 plugin capability，與 loader 支援形狀不一致 |
| P4 | 🟡 低 | Plugin | 7bfc7d6 的 add-failure 隔離：`recordRuntimeFailure` 在 failures 迴圈之後執行 → 無 die-plugin 占位，UI 只剩籠統訊息 |
| P5 | 🟡 低 | Plugin | v1-compat event hook 訂閱全部事件，handler 拋錯會靜默殺掉 stream（ready 狀態不受影響） |
| P6 | 🟠 中 | Plugin | 4 個內建 auth plugin 反覆啟動失敗（`Integration.Authorization`，每 ~30s 重試迴圈） |
| P7 | 🟡 低 | Plugin | v1-compat 內的自賦值 no-op（`integration.name = integration.name`） |
| P8 | 🟠 中 | Plugin | plugin `config` hook 的 mutation 洩漏進持久化設定檔（superpowers 把 skills 路徑寫進 `opencode.jsonc`） |
| C1 | 🟠 中 | 生成檔 | `7a03492` 改 Schema 後未重新生成 `packages/client`；HEAD 上 `types.ts` 缺 `prompts` 而 `types.d.ts` 有（自相矛盾） |
| C2 | 🟠 中 | Integration | key-method prompts 只有 CLI 支援；web/HTTP 的 `connect.key` payload 沒有 `inputs`，驗證被靜默跳過 |
| C3 | 🟠 中 | Integration | `connection.key` 對不存在的 integrationID 不拒絕 → 寫入幽靈 credential 並回 204 |
| C4 | 🟡 低 | Bash | 路徑掃描不認 `~user/...`（tilde+username）→ 繞過 external_directory 授權 |
| C5 | 🟠 中 | Share | share transcript subscriber 對每個事件失敗：`Die(Error: InstanceRef not provided)` |
| C6 | 🟡 低 | Desktop | 側車 server 日誌完全沒有落盤（stdout 與 opencode.log 皆無）→ server 端錯誤無法排查 |
| C7 | 🟡 低 | Marketplace | desktop 覆寫 XDG_STATE_HOME → 狀態檔在 userData、資料在 `~/.local/share`，CLI 與 desktop 互看不到 marketplace 安裝狀態（實測 CLI 回 `plugins:[]`） |

---

## 一、串流 / 速度問題（使用者實測：同一個 DeepSeek，比本環境慢很多；思考與文字重疊）

### 🔴 S1：native openai-chat 協定允許 reasoning 在 text 之後用同一 id 重新開始

- **檔案**：`packages/llm/src/protocols/openai-chat.ts:428-436`
- **現象**：正常應「思考完才輸出文字」，但 fork 有時**同步進行**，或**文字已結束、上方思考還在增長**。
- **機制**：
  ```ts
  if (delta?.reasoning_content)
    lifecycle = Lifecycle.reasoningDelta(lifecycle, events, "reasoning-0", delta.reasoning_content)
  if (delta?.content) {
    lifecycle = Lifecycle.reasoningEnd(lifecycle, events, "reasoning-0")
    ...
  }
  ```
  1. 若 provider（或 proxy）在 content 之後又送 `reasoning_content`（第二段思考），`Lifecycle.reasoningDelta` 會對已結束的 `"reasoning-0"` **重新 start**（`protocols/utils/lifecycle.ts:39-47` 只檢查 set 中沒有就重發 `reasoning-start`）；
  2. publisher 重發 `SessionEvent.Reasoning.Started`（同一 reasoningID，`session/runner/publish-llm-event.ts:287-308`）；
  3. app 端 `contentOrdinal`（`packages/app/src/context/server-session-v2-reducer.ts:27-35`）對相同 ID 回傳同一 ordinal → delta 繼續 append 到**同一個 thinking part**（文字上方）→ **「輸出完了，上面還在思考」**。
  4. 單一 chunk 同時含 `reasoning_content` + `content` 時，同一步發出 reasoningDelta + reasoningEnd + textStart + textDelta → 思考與文字**同時**出現。
- **驗證**：native 路徑需 `OPENCODE_EXPERIMENTAL_NATIVE_LLM` 啟用；預設 AI SDK 路徑則忠實反映 provider 的 part 順序（多階段思考 → 多個 thinking block）。
- **修補方向**：協定層把 reasoning 限制為「text 開始前」的單一階段；若 provider 在 text 後又送 reasoning，應開新 id（`reasoning-1`）或合併進既有 block，不應重用 `reasoning-0` 重啟。

### 🟠 S2：`message-updater` 對重啟的 reasoning 重複 push 相同 id 的 part

- **檔案**：`packages/core/src/session/message-updater.ts:384-398`（`session.next.reasoning.started` 直接 `content.push(...)`）+ `latestReasoning`（:93-94，`findLast` by id）
- **機制**：reasoning 以同一 id 重啟時，`Started` 事件會 push 一個**重複 id 的 reasoning part**（前一個還在 content 陣列裡）；`Ended` 只更新最後一個 → 最終訊息含一個空的重複 thinking block（S1 的連鎖後果）。
- **修補方向**：`started` 分支先檢查相同 id 是否已存在（存在則不 push，直接視為續寫）。

### 🟡 S3：UI 層的思考/文字重疊觀感

- **檔案**：
  - `packages/session-ui/src/components/message-part.tsx:1778-1797`（`ReasoningPartDisplay`）：思考全文**沒有折疊**，完整 `PacedMarkdown` 永遠展開在文字上方。
  - `packages/app/src/pages/session/timeline/rows.ts:196`：`showReasoning ? assistantPartRefs.length === 0 : true`——當設定關閉 `showReasoningSummaries` 時，「思考中…」閃爍占位 row 在**整個 busy 期間**常駐，即使文字已在下面輸出。
- **影響**：長思考 + 下方文字同時滾動，視覺上就是「還在思考」；多階段思考（AI SDK 路徑）會呈現多個 thinking block 同時展開。
- **修補方向**：thinking block 加預設折疊；思考占位 row 只在「無任何 assistant part」時顯示。

### 🟠 S4：所有事件發布被 1-permit semaphore 串行化，durable 事務夾在 delta 之間

- **檔案**：`packages/core/src/session/runner/llm.ts:608-622`
  ```ts
  const withPublication = Semaphore.makeUnsafe(1).withPermit
  const publish = (event, outputPaths = []) => withPublication(publisher.publish(event, outputPaths))
  ```
- **機制**：**每個 delta** 都要過同一把 semaphore，而鎖內還夾著 durable 事件的 **SQLite transaction**（每 part 的 Text/Reasoning/Step Started/Ended + 投影）。SQLite 寫延遲一高（WAL checkpoint、其他 session 投影、permission/session 查詢），**所有後續 delta 全部排隊**。
- **影響**：串流速度對 DB 延遲敏感——使用者實測「比本環境慢很多」的候選根因之一。
- **修補方向**：live delta 與 durable Started/Ended 拆鎖（delta 不需等 durable 完成）；或 durable 發布改批次/異步。

### 🟠 S5：App/Desktop 每 delta 全量更新 → renderer 掉幀、事件積壓

- **檔案**：
  - `packages/session-ui/src/components/markdown.tsx:459-469`：每 delta 對整段 part 跑 `pendingBlocks` + `innerHTML` diff（有 block cache，但仍是整段計算量）；
  - app store 每 delta `produce` 重建 message → timeline rows 重建（`rows.ts` 全量 `constructSessionMessageRows`）；
  - `packages/app/src/context/server-sdk.tsx:337-353`：SSE 消費迴圈每 8ms yield 一次，renderer 忙時積壓。
- **實證**：desktop `renderer.log` 持續出現 `ResizeObserver loop completed with undelivered notifications`（timeline 尺寸觀察打轉）。
- **影響**：desktop（Electron）特別明顯——「很慢」的直接來源；長思考文本下每 token 是 O(part 長度) 的工作。
- **修補方向**：delta 合併窗口放大/按幀節流渲染；timeline rows 依賴細化（只重建受影響 turn）；markdown 增量渲染。

### 🟡 S6：`createPacedValue` 尾段爬行

- **檔案**：`packages/session-ui/src/components/message-part.tsx:253-262, 273-334`
- **機制**：`TEXT_RENDER_PACE_MS=24`；剩餘 ≤96 chars 時每步只揭露 2-8 chars → **每個 part（含長思考）結尾最後 ~96 字元要多花約 0.7 秒**；積壓 >512 chars 時先被 paced。
- **影響**：輸出「慢慢吐」的觀感；強化 S3 的「還在思考」錯覺。
- **修補方向**：streaming 結束（`time.completed` 已設）時立即 `sync` 全部；尾段步進放大。

### 🟡 S7：deepseek-v4 模型的 `reasoning_effort` variants

- **檔案**：`packages/opencode/src/provider/transform.ts:927-931`（deepseek-v4 → low/medium/high/max）、`:1762`（`@ai-sdk/openai-compatible` → `{ reasoningEffort }` 送進請求 body）
- **影響**：若 agent 選的 variant 是 high/max（fork 測試 fixture 就有 `variant: "max"`，`packages/opencode/test/server/httpapi-config.test.ts:103`），API 會做更長思考；本環境（harness）不送 `reasoning_effort` → 對比更明顯。
- **待確認**：使用者 agent/model 的實際 variant；DeepSeek API 是否接受該參數。

---

## 二、Plugin 問題（使用者實測：playwright 可用 + MCP 可用；superpowers 部分可用——技能可用、外挂程式不可用）

### 🔴 P1：superpowers「外挂程式不可用」——**已定案：雙 LocationServiceMap 導致註冊與查詢讀到不同的 PluginV2 實例**

- **最終實證（2026-08-20 晚間，臨時診斷 log + 使用者實測）**：
  - 在 plugin boot 內部的 `PluginV2.status()`：`claude-marketplace/claude-plugins-official/superpowers.state=ready`——**plugin 註冊成功且 ready**；
  - 同一 server 的 `plugins.runtime` 查詢回應：`"message":"Plugin runtime did not register"`；
  - server log 中同一目錄 `C:\Users\inkik` 出現**兩次** `booting location services`（12:13:29 與 12:13:34.711，第二次由 runtime 查詢觸發）。
- **根因**：`packages/server` 的 `makeRoutes`（`packages/server/src/routes.ts:78`）**無條件自建並提供自己的 `LocationServiceMap`**（`buildLocationServiceMap([[SessionExecution.node, SessionExecution.noopLayer]])`，map B），並以 `Layer.provide(serviceLayer)` 蓋過 host 的 map（opencode httpapi 的 `locationServiceMapV2Layer`，map A，`packages/opencode/src/server/routes/instance/httpapi/server.ts:300,325`）。
  - plugin 註冊發生在 opencode 側 plugin boot（map A）；
  - `plugins.runtime` handler（packages/server Api）在 map B 底下解析 `PluginV2.Service`（`native-claude-marketplace.ts:101`）→ 讀到 map B 的**空 PluginV2** → `statuses.length === 0` → 「did not register」（`runtime-readiness.ts:79`）。
  - `V1-to-V2-migration.md` 風險 #2 早就標記此雙 route 樹語義分裂，但未處理 plugin 面。
- **為何 skills/mcp 顯示 ready**：skills 來自 config `skills.paths`（見 P8——superpowers 的 config hook 把路徑寫進了 `opencode.jsonc`），mcp 來自 config `mcp` 設定——都是 config 驅動，不經 PluginV2 註冊，所以兩張 map 都能看到。
- **影響**：所有經 marketplace 安裝且帶 `plugin` capability 的 plugin 在 desktop 與 native server 上**永遠顯示「外挂程式不可用」**（playwright 只因沒有 plugin capability 而正常）。同時每次 runtime 查詢都會多 boot 一組 location services（資源浪費 + log 噪音）。
- **修補方向**：`packages/server` 的 Api 不應自建 map 遮蔽 host 的 map——`makeRoutes` 應接受 host 的 `LocationServiceMap`（比照 `SessionExecution` 以 replacement 注入的做法）；或 `PluginCapability.runtime()` 改用與 plugin boot 相同的 location 上下文解析服務；或把 plugin boot 移到 packages/server 的 map 底下。修補後應驗證「同一目錄只 boot 一次 location services」。

### 🔴 P2：`getLegacyPlugins` 對任一非函數 export 直接 throw

- **檔案**：`packages/opencode/src/plugin/index.ts:154-166`
  ```ts
  const plugin = getServerPlugin(entry)
  if (!plugin) throw new TypeError("Plugin export is not a function")
  ```
- **機制**：`Object.values(mod)` 裡**任何一個**不是函數、也沒有 `server` 屬性的 export（例如多餘的具名常數、`{ name, hooks }` 形狀的 default export）→ 整個 plugin 載入失敗 → die-plugin。
- **production 實證**：使用者 log（2026-08-15）`failed to load plugin path=file:///C:/Users/inkik/.config/opencode/plugin/core.ts error="Plugin export is not a function"`。
- **修補方向**：改為 filter（跳過非函數 export）而非 throw；或補 `{ name, hooks }`（claude-code 風格）形狀支援。

### 🟠 P3：`installedCapabilities` 的 plugin 判定過寬

- **檔案**：`packages/opencode/src/plugin/claude-marketplace.ts:450-463`
- **機制**：只要 `pkg.exports["./server"]` **或 `pkg.main`** 存在就宣稱 `plugin` capability；但 loader（`plugin/index.ts:169-199`）只認 `{ id, server }`、單一 function、`{ server }` 三種形狀。**capability 說「有 plugin」但 loader 不認得 → UI 顯示「Plugin runtime did not register」，無真實原因**（診斷死路）。
- **修補方向**：capability 判定改為實際解析 entry 並檢查 export 形狀；或兩邊共用同一偵測函數。

### 🟡 P4：7bfc7d6 的 add-failure 隔離留下診斷缺口

- **檔案**：`packages/opencode/src/plugin/index.ts:376-400`
- **機制**：`plugins.add` 失敗時 `recordRuntimeFailure` 在 failures 迴圈（:379-383）**之後**執行 → 本次初始化不會為它註冊 die-plugin 占位；若 add 從未發生（P3 路徑），UI 只剩「Plugin runtime did not register」。
- **修補方向**：add 失敗後補註冊 die-plugin（或在 failures 迴圈後再跑一次）。

### 🟡 P5：v1-compat event hook 靜默死亡

- **檔案**：`packages/core/src/plugin/v1-compat.ts:112-118`
- **機制**：`hooks.event` 訂閱**所有**事件（`host.event.all()`），每個事件 `Effect.promise(() => eventHook({ event }))`；handler 遇到 fork 的 V2 事件形狀（`session.next.*`）拋錯時，forked stream 靜默死亡（不影響 ready 狀態，但 hook 從此失效）。
- **影響**：superpowers 之類的 event hook 可能「顯示可用但實際沒在跑」。
- **修補方向**：每個事件的 handler 呼叫加 catch + 記錄；stream 死亡時記錄並嘗試重訂閱。

### 🟠 P6：4 個內建 auth plugin 反覆啟動失敗（重試迴圈）

- **實證**（`~/.local/share/opencode/log/opencode.log`，2026-08-20 09:53-09:54）：
  ```
  failed to activate external plugin id=opencode/openai-codex-auth cause="Integration.Authorization: ..."
  （github-copilot-auth / digitalocean-auth / modal 同，每 ~30s 一輪）
  ```
  stack：`State.reload.update → Plugin.add → Plugin.state → Plugin.init → InstanceBootstrap`（7bfc7d6 隔離後只記 log）。
- **影響**：登入相關內建 plugin 實際不可用；每次 location instance 重建都重跑並失敗 → log 噪音 + 可能的啟動延遲。
- **修補方向**：找出 `Integration.Authorization` 在 auth plugin 啟動期間的急切來源（`v1-compat.ts` 的 `auth` / `auth.loader` 路徑，:120-249）；無憑證時應視為「未設定」而非失敗，且避免每 instance 重試。

### 🟡 P7：v1-compat 內的自賦值 no-op

- **檔案**：`packages/core/src/plugin/v1-compat.ts:122-125`
  ```ts
  integrations.update(auth.provider, (integration) => {
    if (integration.name === auth.provider) integration.name = auth.provider
  })
  ```
- 條件與賦值相同，恆為 no-op（疑似原本要 rename/fallback）。

---

## 三、其他 bug

### 🟠 C1：`packages/client` generated 檔案過期，且 committed 狀態自相矛盾

- **緣由**：`7a03492 refactor: retire legacy provider auth` 在 Schema 新增 `Integration.KeyMethod.prompts`（`packages/schema/src/integration.ts:59-64`），重新生成了 legacy SDK（`packages/sdk/js`）但**沒有重新生成 `packages/client`**（最後一次提交停在更早的 `1229fca`）。
- **現狀**：
  - HEAD 上 `types.d.ts` 已有 `prompts`、`types.ts` **沒有** → 同一 commit 內不一致；
  - 實測 `bun run generate` 後 diff：`types.ts` +50 行、`client.d.ts` 284 行（還包含 event manifest 變動：`project.updated`→`catalog.updated`、新增 `integration.connection.updated` 等，代表過期範圍更大）；
  - 工作目錄有未提交的 regeneration；
  - repo 自己的 gate `check:generated`（`packages/client/package.json`）在 HEAD 上會失敗。
- **修補方向**：重新生成並提交 `packages/client/src/generated`（+`generated-effect` 若需要）。

### 🟠 C2：key-method prompts 是半套功能（CLI 有、web/HTTP 沒有）

- **證據**：
  - CLI 完整支援：`packages/opencode/src/cli/cmd/providers.ts:82-104, 146`（收集 prompts → `connection.key({ ..., inputs })`）；
  - HTTP `connect.key` payload 只有 `{ key, label }`（`packages/protocol/src/groups/integration.ts:44-47`），server handler 不傳 inputs（`packages/server/src/handlers/integration.ts:37-48`）；
  - Web app 只對 OAuth 收集 prompts（`packages/app/src/components/dialog-connect-provider.tsx:559-563, 597-599`）；
  - 但 v1-compat 已把 prompts 掛上 key method 並驗證（`v1-compat.ts:148, 151`）——web 連線時 `inputs` 恆為 `{}`，`validateLegacyPrompts` 對 undefined 靜默跳過（`v1-compat.ts:636`），authorize 收到空物件。
- **影響**：舊版 plugin 的 key method prompts（含必填驗證）在 web/HTTP 被靜默繞過。
- **修補方向**：`connect.key` payload 加 `inputs`（並更新 generated client）；web 端 key method 也走 prompts 流程。

### 🟠 C3：`connection.key` 對不存在的 integrationID 不拒絕

- **檔案**：`packages/core/src/integration.ts:466-485`
  ```ts
  if (entry && !method) return yield* Effect.die(`Key method not found: ...`)
  // entry === undefined 時直接掉到這裡 → 建立 credential
  ```
- **影響**：`POST /api/integration/<任意字串>/connect/key` 會為不存在的 integration 寫入 credential（DB + credential 檔）並回 204；oauth 路徑（:487-490）用 `Effect.die` → HTTP 500 defect 而非宣告的 `InvalidRequestError`。
- **修補方向**：`!entry || !method` 都回 typed error；oauth 的 die 改 typed error。

### 🟡 C4：bash 工具路徑掃描不認 `~user/...`

- **檔案**：`packages/core/src/tool/bash.ts:122-183, 211-223`
- **機制**：`bashLiteral` 把 `home` 設為 `word.startsWith("~")`，但 `scannerPaths` 的 home 判斷只接受 `~`、`~/`（powershell 為 `~\`）→ `~alice/x` 不產生 path candidate → **不會觸發 external_directory 授權**，但 bash 會把 `~alice` 展開到其他使用者家目錄。
- **影響**：`cat ~alice/secret.txt`、`echo x > ~alice/out.txt` 繞過工作區外的目錄授權（命令層級 resource 仍會檢查，路徑層級被繞過）。Windows PowerShell 的 `~user\...` 同理。
- **修補方向**：home 判定支援 `~<user>/...`（`nativePath` 需同步處理或保守拒絕）。

### 🟠 C5：share transcript subscriber 對每個事件失敗——`InstanceRef not provided`

- **實證**（`opencode.log` 2026-08-20 10:28，大量重複）：
  ```
  message="share transcript subscriber failed" type=session.next.tool.called cause="Cause([Die(Error: InstanceRef not provided)])"
  ```
- **檔案**：`packages/opencode/src/share/share-next.ts:286-295`（transcript 訂閱者呼叫 `syncTranscript`，effect 缺少 `InstanceRef` service context）。
- **影響**：share transcript 更新實際失效；每個 transcript 事件都噴 error。
- **修補方向**：`syncTranscript` 執行前提供 `InstanceRef`（或改用不依賴 instance 的 canonical 讀取）。

### 🟡 C6：desktop 側車（sidecar）的 server 日誌完全沒有落盤

- **實證**：
  - `~/.local/share/opencode/log/opencode.log` 自 2026-08-20 11:18 後沒有任何 desktop session 的條目（11:46-12:39 與 17:52+ 兩個 desktop session 都無痕跡）；
  - electron-log 的 `resolvePathFn` 會把 scope 寫成獨立檔（`logging.ts:25-29`），但 session 目錄（`%APPDATA%\ai.opencode.desktop\logs\<run>\`）只有 main/renderer/network/utility 等檔，**沒有 `server.stdout.log` / `server.stderr.log`**；
  - `spawnLocalServer` 的 `onStdout/onStderr`（`packages/desktop/src/main/server.ts:98-99`）→ `writeLog("server", "stdout", ...)`，但檔案不存在。
- **影響**：plugin 啟動失敗等 server 端錯誤**在 desktop 上無法排查**——本次 P1 調查的最大障礙；任何 server-side 失敗都被吞掉。
- **修補方向**：確認側車 server 的 log 輸出目標（stdout vs opencode.log）並確保寫入可收集的位置；或在 `Server.listen` 路徑明確建立日誌檔。

---

### 🟡 C7：marketplace 狀態檔位置被 desktop 的 XDG_STATE_HOME 覆寫拆走——CLI 與 desktop 互看不到安裝狀態

- **實證**：desktop 側車以 `XDG_STATE_HOME = Electron userData` 啟動（`packages/desktop/src/main/server.ts:64`、`sidecar.ts:89`），因此 `claude-marketplaces.json`（`Global.Path.state`）落在 `%APPDATA%\ai.opencode.desktop\opencode\`；而 plugin 安裝目錄（`Global.Path.data`）仍在 `~/.local/share/opencode\claude-plugins`。
- **後果**：同一台機器上，CLI/dev server（無 XDG_STATE_HOME 覆寫）讀 `~/.local/state/opencode\claude-marketplaces.json` → **不存在 → 空狀態 → `plugins.runtime` 回傳 `{"plugins":[]}`**（使用者實測確認），desktop 已安裝的 marketplace plugin 對 CLI 完全不可見（反之亦然）。
- **影響**：跨執行環境的 marketplace 管理不一致；也讓「從 repo 起 server 複現 desktop 狀態」變成陷阱（本次 P1 調查的實測踩到）。
- **修補方向**：狀態檔位置改為與資料同源（`Global.Path.data`）或明確共用；desktop 只覆寫 state 的做法需重新評估（state 與 data 被拆到兩個目錄）。

### 🟠 P8：plugin `config` hook 的 mutation 洩漏進持久化設定檔

- **實證**：使用者的 `~/.config/opencode/opencode.jsonc` 出現 `"skills": { "paths": ["C:\\Users\\inkik\\.local\\share\\opencode\\claude-plugins\\claude-plugins-official__superpowers\\skills"] }`——正是 superpowers 的 `config` hook 推入的路徑（`superpowers.js:107-113`）。
- **機制**：config hook 直接 mutation `config.get()` 的 live singleton（`plugin/index.ts:359`），之後任何 `config.updateGlobal`/設定儲存都會把 mutation 寫回磁碟。
- **影響**：plugin 的 config hook 變更（本應是 ephemeral runtime 調整）污染使用者設定檔；同時也是 P1 調查中「skills 顯示 ready」的來源之一（config 路徑讓 map B 也能看到 skills）。
- **修補方向**：config hook 改在副本上執行或明確標記不可持久化的欄位；或設定寫回前過濾 plugin 注入的欄位。

## 四、已驗證「非 bug」（避免重複調查）

| 項目 | 結論 |
|---|---|
| `SessionV2.update` 讀取-發布競態（handoff 舊疑慮） | 已解決：`mutateSession`（`packages/core/src/session/mutation.ts`）transaction 內 re-read + `expectedSeq` CAS + 32 次重試 |
| metadata/share 顯式清除 | 已解決：projector 用 `?? null`（`session/projector.ts:51-52`） |
| Permission reject → defect | 刻意設計：runner `isUserDeclined`（`session/runner/llm.ts:192-197`）辨識後停止 loop（V1 對齊） |
| bash `background()` 的 promote race | 有 fallback：`jobs.promote` 對已完成 job 回 undefined → `foregroundOutput` 處理 |
| `Config.reload` 重複載入 policy | `policy.load` 是替換語意，無累積 |
| 使用者的 `~/.config/opencode/plugin/core.ts` 報錯 | 歷史問題（2026-08-15），該檔案現已刪除；根因即 P2 |

---

## 五、待補資料 / 下一步建議

1. **S7 確認**：使用者 agent/model 的 variant 設定——已確認：所有 agent 均為 `deepseek1/deepseek-v4-flash` + `variant: "max"` + `anthropic-messages` protocol（`opencode.jsonc`）→ max thinking 預算，思考變慢的直接來源。
2. **S1 驗證**：使用者實際走 `@ai-sdk/anthropic` protocol（`api.deepseek.com/anthropic`）——多 thinking block 與文字交錯的來源可能在 anthropic-messages 協定側（`reasoning-${index}` 多 block），需實測確認。
3. 建議修補優先序：P1（雙 LocationServiceMap，已定案）→ P2（一票否決式 throw）→ C1（生成檔）→ S4（semaphore）→ C3/C2（integration 驗證缺口）→ P6（auth plugin 重試迴圈）→ C5（share subscriber）→ P8（config hook 洩漏）→ 其餘低優先。

---

*報告產生：2026-08-20。調查基於 branch `999.0.19`（HEAD `7bfc7d6`）。*
