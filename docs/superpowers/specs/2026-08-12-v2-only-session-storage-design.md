# V2-only Session Storage Hard Cut Design

> 日期：2026-08-12
> 目標分支：`999.0.17`
> 決策：不遷移或保留 legacy `message` / `part` 使用者資料；缺少能力時擴充 V2。

## 背景

V2 已是唯一模型執行路徑，但 session transcript 仍有雙軌儲存：canonical
`session_message` 與 legacy `message` / `part`。目前 CLI import 仍直接寫 legacy 表，HTTP message
讀取會透過 `TranscriptRead` 合併兩套資料，Core projector 也保留 V1 message/Part event 分支。
這些相容路徑使 legacy schema、projector 與 `Session.Service` 無法移除。

本批次採取 storage hard cut：只保留 canonical V2 transcript。現有 legacy rows 不做一次性轉換，
升級後不再顯示。這是有意的 breaking change，不用 tombstone 或 lazy adoption 模擬資料遷移。

## 範圍

本批次包含：

1. CLI import 將輸入轉成 `SessionMessage.Message`，經由
   `SessionV2.transcript.importMessage(...)` 發布 durable `MessageImported` event。
2. CLI export 直接輸出 canonical session 與 canonical messages，不再讀取 `Session.Service` 或
   產生 V1 `WithParts`。
3. HTTP message list/get、revert boundary、diff 與 transcript mutation 只讀
   `SessionV2.messages(...)` / `SessionV2.message(...)`。
4. 移除 `TranscriptRead`、retained transcript merge、legacy lazy adoption 與 transcript tombstone。
5. 移除 Core projector 的 V1 message/Part event 寫入分支。
6. 當 production 與 test 引用歸零後，移除 `MessageTable` / `PartTable`、tombstone table 及其 schema。

本批次不包含：

1. 移除全部 `Session.Service` CRUD/stats/share consumer。
2. 移除現有 HTTP response 的 legacy message/part wire shape。
3. 移除 CLI/TUI/ACP compatibility adapter 或全部 `compatibilityDefinitions`。
4. 移除 V1 config 的一次性設定解碼邊界。

這些工作分別屬於後續 Session service hard cut 與 wire/event hard cut。

## 資料模型與資料流

### 寫入

CLI export/import 使用明確的 V2 envelope：

```ts
{
  version: 2,
  session: SessionSchema.Info,
  messages: SessionMessage.Message[]
}
```

`version` 必須等於 `2`；本批次不接受沒有版本的舊 V1 export 檔。`--sanitize` 需要直接遍歷
canonical message union 做資料遮罩，不能先投影為 V1 parts。Share URL import 暫時只保留 URL
解析與下載邊界；遠端 payload 必須是同一個 V2 envelope，舊 flat share payload 明確拒絕，待
後續 V2 share API 完成後再接回。

CLI import 不再操作資料庫表。匯入流程是：

1. 解析輸入 session metadata 與 message payload。
2. 以 `SessionV2.create(...)` 建立或採用 canonical session。
3. 將每條可支援的訊息轉成 `SessionMessage.Message`。
4. 逐條呼叫 `SessionV2.transcript.importMessage(...)`。
5. projector 只透過 durable V2 event 寫入 `session_message`。

匯入必須保持 message ID，因為 parent/input/assistant 關係與外部引用會依賴 ID。相同 ID、相同
session 的重試採用既有 canonical message；跨 session 衝突回報失敗。不能無損表示的舊 Part
shape 必須明確拒絕，不回落寫 legacy 表。

### 讀取

所有 runtime transcript 讀取以 `SessionV2.Service` 為唯一來源：

- list/page：`messages(...)`
- exact lookup：`message(...)`
- revert/diff：在 canonical message 陣列上解析 boundary 與 `snapshot.patch`
- 現有 legacy HTTP wire：僅在 handler 邊界用 `MessageV2.toLegacy(...)` 投影

投影是外部 response adapter，不具有儲存或合併職責。

### 舊資料

不讀取、不遷移、不 lazy adopt legacy `message` / `part` rows。schema migration 可直接 drop
legacy tables；如果 SQLite migration generator 無法安全表達 drop，使用專用 migration 並由
`bun run migration --check` 驗證全量與增量 schema 一致。

## 邊界調整

`TranscriptRead` 的 merge service 會消失。HTTP handler 直接依賴 `SessionV2.Service`；需要 legacy
response 時使用無狀態投影。`LegacySessionRead` 暫時只保留 session info 與仍未遷移的外部
execution adapter，不再提供 retained transcript。

`MessageV2` 中直接查詢 legacy tables 的 `page` / `stream` / `parts` / `get` 舊函式會刪除或改成
canonical service 呼叫；不可讓同名函式暗中維持雙表行為。

## 錯誤處理

- 匯入 payload 缺少 `version: 2` 或不符合 canonical schema：回報具體的 import validation error，
  不能部分靜默丟棄。
- 匯入訊息跨 session ID 衝突：沿用 `Session.MessageNotFoundError` 或新增精確 V2 conflict error，
  由 CLI 轉成非零退出與可讀訊息。
- HTTP 查詢 legacy-only message：按不存在處理，不嘗試讀 legacy table。
- 不支援的舊 Part：明確拒絕整次匯入；不產生半套 legacy/canonical transcript。

## 測試策略

按照 TDD 分四層驗證：

1. Core：canonical message import 的順序、重試、衝突與 durable projection。
2. CLI：import 後只有 `session_message` 資料，HTTP/SessionV2 可讀；不支援 payload 會失敗。
3. HTTP：只回傳 canonical messages；插入 legacy rows 不會影響 list/get/revert/diff。
4. Schema/migration：全倉 production code 不再引用 `MessageTable` / `PartTable`，migration check
   通過，Core/OpenCode/Schema/Client typecheck 與 focused suites 通過。

## 後續批次

完成 storage hard cut 後：

1. 擴充 V2 session CRUD/stats/share/lookup 窄能力，遷移所有 `Session.Service` consumer。
2. 將 CLI/TUI/ACP/HTTP 改成 V2 wire vocabulary，移除 compatibility projector。
3. 移除 `core/src/v1/*`、`schema/src/v1/*` 與剩餘 V1 event definitions；保留 config migration
   boundary 直到設定格式另行做 breaking hard cut。
