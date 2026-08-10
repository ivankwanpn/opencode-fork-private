# OpenAI OAuth 即時模型清單與上下文覆寫

## 背景

目前 OpenCode 的 OpenAI 模型目錄主要來自 `models.dev`，V1 Codex 插件另外以靜態規則過濾模型；這與同一個 OpenAI OAuth 帳號可取得的 Codex 模型清單不是同一個來源，因此會顯示帳號實際不能使用的模型，也會漏掉服務端新增的模型。

## 目標

1. OpenAI OAuth 已連線時，以 Codex 模型端點回傳的模型 ID 作為可用模型的權威來源。
2. V1 與 V2 的模型選擇器使用相同的 live allow-list，不再依靠硬編碼 GPT 版本範圍。
3. Live 回應中的模型若本地目錄沒有，也能以保守的預設 metadata 顯示；本地設定的 context limit 仍具有最高優先級。
4. 在模型管理介面提供每個模型的 context size 覆寫，並寫入現有 provider model config，讓重啟與 V1/V2 切換後仍有效。

## 非目標

- 不自動重送或猜測 OAuth provider request。
- 不把未連線的 OpenAI 公開模型目錄誤稱為 OAuth 帳號可用模型。
- 不把服務端回傳的未確認欄位直接當作完整成本或能力描述。

## 設計

### Live discovery

對 OpenAI OAuth credential 呼叫 `https://chatgpt.com/backend-api/codex/models`，帶上 bearer token 與可用的 `ChatGPT-Account-Id`。解析 `models`、`data` 或陣列形式的回應，只信任有非空 `id` 的項目。

成功取得清單後，模型目錄只保留 live ID；本地 `models.dev` metadata 用於補充名稱、能力與輸出限制，live 回應有 context window 時優先採用。OpenAI API key 或其他 authentication 不走這個過濾器。

live 請求失敗時保留最後一次成功的 live snapshot；若本次 process 尚無成功 snapshot，才使用既有 catalog 作為啟動期間的安全 fallback，並在下一次刷新時重試，避免短暫網路錯誤導致模型選擇器整個消失。

### 刷新時機

- provider/catalog 初始化時執行一次。
- OpenAI OAuth connection 更新、登入、登出或 token refresh 後重新執行。
- 只更新模型可見性與 metadata，不改變 session 目前選用的 model。

### Context size 編輯

模型管理介面增加「上下文大小」編輯入口。保存時更新：

`provider.<providerID>.models.<modelID>.limit.context`

輸入必須是正整數；空值代表清除覆寫並恢復 provider/catalog 預設。現有 provider limit 的其他欄位與全局 config 其餘內容必須保留。

## 驗收條件

- live endpoint 回傳 `gpt-live` 與 `gpt-stale` 時，選擇器只顯示 `gpt-live`。
- live endpoint 新增本地未知模型時，該模型可選且不會因靜態 GPT 版本規則被剔除。
- OAuth endpoint 暫時失敗不會清空最後成功的清單。
- 非 OAuth OpenAI provider 行為不變。
- 保存 context limit 後，V1 與 V2 provider catalog 都讀到同一個覆寫值。
- 相關測試、`bun typecheck` 與格式檢查通過。
