# OpenAI OAuth live model list implementation plan

## 1. 固定 live discovery 契約

- 在 Codex plugin 附近建立可測試的 response parser 與 endpoint client。
- 先替換既有「GPT 版本/allow-list」測試，加入成功回應、未知模型、非 OAuth bypass 與失敗 fallback 測試。
- 使用可注入 endpoint 只用於測試，production 預設仍指向 Codex models endpoint。

## 2. 接入 V1 provider models hook

- 讓 OAuth provider models hook 以 live IDs 建立模型集合。
- 保留本地 metadata 與 config limit merge；移除 static GPT version filter 及硬編碼 context 判斷。
- 對 token refresh、account header 與最後成功 snapshot 加測試。

## 3. 接入 V2 catalog

- 在 core OpenAI plugin 共享同一套 live discovery 邏輯。
- 初始載入與 Integration connection event 觸發刷新，斷線時恢復 base catalog baseline。
- 只修改 OpenAI provider 的 live availability，避免影響其他 provider。

## 4. 加入上下文大小編輯

- 先新增純函式測試，驗證只更新指定 provider/model 的 `limit.context` 並保留其他設定。
- 在模型管理/設定模型 UI 加入編輯入口與正整數驗證。
- 使用現有 `serverSync.updateConfig` 持久化，不新增另一套模型設定儲存。

## 5. 驗證

- 執行 V1 Codex plugin tests、core OpenAI/catalog tests 與 app helper tests。
- 執行受影響 package 的 `bun typecheck`。
- 執行 prettier/格式檢查，最後檢查 generated files 未被手動修改。
