<p align="center">
  <picture>
    <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
    <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
    <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="OpenCode logo">
  </picture>
</p>
<p align="center">開源的 AI Coding Agent —— 增強版 Fork。</p>

<p align="center">
  <a href="README.md">English</a> |
  <a href="README.zh.md">简体中文</a> |
  <a href="README.zht.md">繁體中文</a>
</p>

---

本倉庫是 [OpenCode](https://opencode.ai)（MIT 授權）的**功能增強 Fork**，基於上游 `1.18.3` 分叉，並持續演進為 `999.0.11`。它保留了上游的終端介面（TUI）、桌面應用、Web 應用、無頭 API 伺服器與 SDK，同時將核心 agent loop 重構為**事件驅動、持久化、非同步**的架構，並加入了一系列可靠性、相容性與開發者體驗改進。

> **注意：** 本專案並非 OpenCode 團隊開發，也與 OpenCode 官方沒有任何隸屬關係。「OpenCode」是各自所有者的商標；本 Fork 以 MIT 授權散佈。

---

## 為什麼有這個 Fork？

上游 OpenCode 本身已經非常出色。本 Fork 在四個方向上更進一步：

1. **事件驅動的持久化子代理迴圈。** 原生 V2 工作階段中的背景子代理預設非同步執行；V1 相容路徑需要設定 `OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true` 才啟用相同能力。子工作階段透過基於 SQLite 的持久化任務協定被接納，父工作階段由完成通知**喚醒**，而不是阻塞其 provider 回合。同時提供一流的 `get_task_output` 工具，用於顯式快照與有界等待。
2. **持久化的任務提交與通知生命週期。** `task_submission`、子輸入終態投影與父工作階段通知 outbox 會跨程序重啟保留。正在進行的 provider 工作不會自動續接；不明確的嘗試會標記為 `recovery-required`，而不是自動重送。遞迴取消樹語意也保持持久化。
3. **原生 V2 / 舊版 V1 共存且保持相容。** 外掛相容層讓舊的 `.opencode/tool/*` 工具與 `hooks.tool` 外掛可以出現在 V2 工作階段中；舊版 SDK/API 路徑仍然可用於外部伺服器；ACP（Agent Client Protocol）伺服器運行在原生 `/api` 之上。
4. **覆蓋全端的生產力功能。** 自訂 Provider（OpenAI Responses / OpenAI 相容 / Anthropic Messages）與伺服器端模型探索、預設 Provider 的即時模型探索、LSP 支援、MCP 資源溯源與輔助工具、Composer 上下文用量指示器、持久化的 Queue/Steer 後續輸入等。

---

## 亮點

### 事件驅動的子代理迴圈

- 在原生 V2 工作階段中，`task` 工具**預設非同步**啟動子代理。V1 相容路徑需要設定 `OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true`；啟用後工具呼叫立即傳回執行中的句柄，子代理在 provider 回合之外繼續工作。
- 子代理完成時，一條持久化通知會被接納為父工作階段的合成輸入並喚醒父工作階段——協調器無需等待整個批次即可回應已完成的工作並排程後續任務。
- `get_task_output` 為 1–20 個歸屬的任務 ID 傳回持久化狀態快照，並支援對目前程序中活躍任務的可選有界等待。重啟後會傳回持久化狀態，而不會等待已經遺失的記憶體任務；未知或非歸屬 ID 以相同方式失敗，避免被用作工作階段 ID 探測工具。
- `background: false` 仍然是真正立即依賴的顯式逃生通道。切勿在一條助手訊息中批次發起多個前景 `task` 呼叫。
- 內建任務代理：`general`、`explore`、`research` 與 `worker`。`research` 是唯讀的深度分析專家；`worker` 是聚焦的實作專家。`general-purpose` 仍然是 `general` 的別名。

### 持久化的任務生命週期

- 每次任務呼叫由 `(parentSessionID, assistantMessageID, toolCallID)` 唯一識別。精確重試會採用既有提交；衝突復用會失敗。
- `task_submission` 資料表記錄狀態（`accepted → running → completed / error / cancelled / recovery-required`）、代理路徑、模型、結果與時間戳。
- 子任務結算與父工作階段通知 outbox 列在**同一交易**中寫入；outbox 在當機後可冪等重放，因此重試不會產生重複的持久化父工作階段輸入。
- `completion_delivery` 區分 `"tool"`（前景，直接傳回結果）與 `"parent"`（背景，走通知通道），並支援原子提升。
- 遞迴 `cancelTree(rootSessionID)` 持久化地取消完整的擁有關係樹，並在報告完成前等待後代靜默。
- `subagent_max_concurrency` 與 `subagent_depth` 設定可限制失控的並發扇出。

### 持久化的後續輸入（Queue / Steer）

- 提示與指令攜帶顯式投遞模式。`queue` 輸入在工作階段忙碌時持久化待處理，並在工作階段閒置時依序提升；`steer` 輸入在下一個安全的 provider 回合邊界提升。
- 新增 V2 端點：待處理輸入列表 / 精確查詢 / 提升 / 取消。待處理佇列項在用戶端重新整理與伺服器重啟後仍然存在，並透過確定性訊息 ID 冪等對帳。
- `Enter` 使用設定的預設模式（預設 `steer`，與上游一致）；`Ctrl+Enter`（及平台對應按鍵）始終強制 Steer。

### 自訂 Provider

- 可從 Desktop、TUI 或 CLI（`opencode providers configure [id]`）設定 **OpenAI Responses**、**OpenAI Chat Completions / OpenAI 相容** 或 **Anthropic Messages** 三種協定。
- **伺服器端模型探索**會探測相容的 `/models` 端點（總逾時 15 秒，僅跟隨同源重新導向），正規化常見目錄結構，並將結果合併到表單中而不覆蓋你的編輯。
- 支援依模型的推理能力、上下文視窗與最大輸出限制。設定檔保持與官方 V1 相容；API 金鑰絕不會寫入 `opencode.json`（字面金鑰存入憑證儲存，`{env:NAME}` 參照保持為環境變數參照）。
- 推理努力值選項透過 OpenCode 的模型 variant 機制做到協定與模型感知。

### 預設 Provider 的即時模型探索

- 預設 Provider 反映其設定的上游端點實際暴露的模型，而不是陳舊的 `models.dev` 快照。
- 保留既有中繼資料（限制、能力、成本、variants）；暫時性失敗會保留最後一次成功的快照或靜態目錄。
- 在啟動、連線變化以及 `models.dev` 重新整理後自動重新整理。OAuth 與 Provider 原生整合保持其專用載入器。

### 外掛相容層

- 舊的 `.opencode/{tool,tools}/*` 設定工具與外掛 `hooks.tool` 定義被統一探索一次，並註冊進 **V2 Core ToolRegistry**（帶作用域清理），使 V1 與 V2 工作階段展示完全相同的工具集。
- 完整的 V1 外掛鉤子橋（`v1-compat.ts`）將 `chat.message`、`chat.params`、`chat.headers`、`permission.ask`、`tool.execute.before/after`、`experimental.chat.messages/system.transform`、`experimental.text.complete`、`experimental.provider.small_model` 等對應到 V2 外掛執行時期。
- 既有外掛無需改動即可繼續運作；公開外掛 ABI 沒有被破壞。

### MCP 增強

- **資源溯源：** MCP 內嵌資源與資源連結現在攜帶型別化溯源（伺服器、URI、MIME、名稱、描述、註解、`_meta`），在結算、持久化儲存與外掛往返中都不會遺失身分資訊。
- 新增 V2 資源輔助工具：`list_mcp_resources`、`list_mcp_resource_templates` 與 `read_mcp_resource`，透過規範 V2 註冊表註冊，並帶有 V2 權限與輸出約束。
- MCP 成為一級 Core 子系統（`packages/core/src/mcp/`），包含 catalog、runtime、browser、OAuth、callback 與 resource-tool 模組，統一暴露在 `packages/core/src/mcp.ts` 之後。

### LSP 支援

- 新增語言伺服器協定子系統（`packages/core/src/lsp/`），提供 LSP 用戶端執行時期、語言偵測、診斷以及接入 V2 工具註冊表的 `lsp` 工具族。

### 借鏡 Codex 的 agent loop 加固

- **停止鉤子：** `session.stop` / `session.subagent.stop` 外掛鉤子決定一個回合是結束還是繼續（帶區塊計數上限），並採用 fail-open 策略，避免鉤子異常卡死回合。
- **交易安全的 steer 定向：** EventV2 提交交易中可選的 `expectedActiveAttemptID` 會用型別化錯誤拒絕過期的 steer。
- **回合級 Responses WebSocket：** 內部續接迴圈重複使用同一條 Responses WebSocket 連線，而不是每個回合重新建立。
- **持久化代理路徑：** `task_submission` 記錄完整的代理祖先路徑；**投影修復工具**可以從持久化事件日誌重建讀模型。
- **Plan/Build 提醒：** 工作階段代理切換模式時，runner 會注入 plan-mode / build-switch 上下文。

### 模型專用提示詞

- 為 OpenAI GPT/Codex、Anthropic Claude、Gemini、Kimi、Meta（muse-spark）、Trinity 以及面向推理重型模型的 "beast" 變體提供依模型區分的系統提示詞——依模型 ID 自動選擇，並帶有預設回退。

### 桌面 / Web 應用

- **Composer 上下文用量指示器** 直接在提示輸入區顯示 `Context window: 3% · Used: 31.6k / 1M`（舊版與 V2 兩種 composer 均支援），並可開啟上下文詳情分頁。
- **安全關閉專案：** 關閉陳舊/缺失的專案列不再因 stale-read 錯誤而當機。
- **分階段工作階段分頁還原：** 還原的非活動分頁立即使用持久化的分頁資訊渲染；完整工作階段同步透過可取消、單併發的閒置佇列執行，並支援滑鼠懸停/聚焦優先。
- **OpenAI OAuth 嘗試生命週期：** 取消瀏覽器 OAuth 嘗試會正確釋放 `localhost:1455`，重試流程不再報 `EADDRINUSE`。
- **Provider 管理** 工具：編輯、中斷連線與變更輔助函式，帶樂觀狀態對帳；settings-v2 的 agent/plugin 面板。
- Electron 主程序支援**系統代理與全域代理**，並帶伺服器健康檢查。

### TUI

- **自訂 Provider 精靈**——鍵盤驅動的分步設定流程，支援 Back/Cancel/Retry/手動輸入。
- **原生事件復原：** SSE 斷線與持久化序號缺口復原，可重放缺失事件並重建規範讀模型，而不會重複文字、推理或工具條目。
- 原生 V2 工作階段 / 轉錄 / 目錄相容配接器。

### ACP（Agent Client Protocol）

- ACP 伺服器現在透過**原生用戶端門面**（`packages/opencode/src/acp/client.ts`）執行：工作階段、轉錄、事件、權限、目錄與設定均使用原生 `/api` 用戶端；動態 MCP `add` 是唯一的舊版回退。

---

## 安裝

我們建議**先自行打包，然後透過生成的安裝包進行安裝**，而不是從原始碼直接執行。這是目前在 **Windows** 上已驗證的流程；macOS 和 Linux 的打包目標已設定，但我們尚未驗證。

### 前置需求

- [Bun](https://bun.sh) 1.3+ —— 本倉庫使用 bun workspaces 管理
- Git —— 用於克隆倉庫

```bash
git clone <你的倉庫網址>
cd <倉庫目錄>
bun install
```

### Windows —— 打包並安裝（已驗證）

```bash
bun run --cwd packages/desktop package:win
```

命令完成後，會在 `packages/desktop/dist/` 下產生一鍵式 NSIS 安裝包：

```
opencode-desktop-win-x64.exe
```

雙擊安裝包並依提示完成安裝即可。未打包的建置產物同時寫入 `packages/desktop/dist/win-unpacked/`，可供檢查。

#### NSIS 相依

建置 Windows 安裝包需要使用 **NSIS**。大多數情況下 electron-builder 會在首次建置時自動下載 NSIS（需要連網，並快取在 `%LOCALAPPDATA%\electron-builder\Cache\nsis`），**無需手動安裝**。如果環境中沒有 NSIS——例如自動下載失敗或處於離線環境——請手動安裝並設定：

1. 用以下任一方式安裝 NSIS：
   ```powershell
   winget install NSIS.NSIS
   # 或：choco install nsis
   # 或從 https://nsis.sourceforge.io/Download 下載
   ```
2. 驗證已安裝且已加入 `PATH`：
   ```powershell
   makensis /VERSION
   ```
3. 如果 electron-builder 仍然找不到，請透過 `NSIS_PATH` 環境變數指向你的 NSIS 安裝目錄（包含 `makensis.exe` 的目錄）：
   ```powershell
   setx NSIS_PATH "C:\Program Files (x86)\NSIS"
   # 設定後請重新開啟終端機，使新值生效
   ```
4. 如果因無法存取 GitHub 導致自動下載失敗（例如公司代理），請讓 electron-builder 使用其二進位檔的鏡像：
   ```powershell
   setx ELECTRON_BUILDER_BINARIES_MIRROR "https://npmmirror.com/mirrors/electron-builder-binaries/"
   ```
5. 重新執行 `bun run --cwd packages/desktop package:win`。

### macOS / Linux —— 尚未驗證

打包目標已定義在 `packages/desktop/electron-builder.config.ts` 中，但我們**尚未**在真實機器上驗證：

```bash
# macOS —— 在 packages/desktop/dist/ 下產生 .dmg / .zip
bun run --cwd packages/desktop package:mac

# Linux —— 在 packages/desktop/dist/ 下產生 .AppImage / .deb / .rpm
bun run --cwd packages/desktop package:linux
```

> [!NOTE]
> 我們目前只驗證了 **Windows** 上的打包安裝流程。上面針對 macOS 和 Linux 的指令依現狀提供；如果遇到問題，請回報給我們。

### 從原始碼執行（面向開發者）

```bash
bun dev                 # 在目前目錄執行 TUI
bun dev serve           # 無頭 API 伺服器（預設連接埠 4096）
bun run --cwd packages/app dev          # Web 應用
bun run --cwd packages/desktop dev      # 桌面應用（Electron）
```

建置出的 `opencode` 二進位檔支援與上游相同的指令：`opencode [directory]`、`opencode serve`、`opencode run`、`opencode acp`、`opencode providers configure` 等。

---

## VS Code 擴充功能

本 Fork 在 [`sdks/vscode/`](./sdks/vscode/) 中附帶了一個 VS Code 擴充功能，用於將 `opencode` 整合到編輯器中。請自行打包成 `.vsix` 然後本機安裝。

> **前置需求**：擴充功能會在終端機中啟動 `opencode` CLI，因此請先確保 Fork 的 `opencode` 二進位檔在 `PATH` 中可用（依 [安裝](#安裝) 一節從原始碼建置或安裝）。

### 1. 打包產生 `.vsix`

```bash
cd sdks/vscode
bun install
bun install -g @vscode/vsce     # 全域安裝 vsce（或直接用下面的 bunx @vscode/vsce）
vsce package --no-dependencies --skip-license
```

`vsce` 會自動執行 `vscode:prepublish` 鉤子（型別檢查 + lint + esbuild 正式建置），並在 `sdks/vscode/` 下產生 **`opencode-999.0.11.vsix`**。

如果 `vsce` 對倉庫或版本中繼資料報錯，可以加上發佈管線使用的相同參數：

```bash
vsce package --no-dependencies --skip-license --no-git-tag-version --no-update-package-json
```

### 2. 安裝 `.vsix`

命令列方式：

```bash
code --install-extension opencode-999.0.11.vsix
```

或透過 VS Code 介面：

1. 開啟**延伸模組**面板（`Ctrl+Shift+X` / `Cmd+Shift+X`）
2. 點擊 **...**（更多操作）選單
3. 選擇 **Install from VSIX...**（從 VSIX 安裝...）
4. 選取 `opencode-999.0.11.vsix`

如果擴充功能沒有立即啟動，請重新載入視窗。

### 使用方式

| 快捷鍵（Windows / Linux / macOS） | 作用 |
| --- | --- |
| `Ctrl+Esc` / `Cmd+Esc` | 開啟 `opencode` 終端機，若已在執行則聚焦 |
| `Ctrl+Shift+Esc` / `Cmd+Shift+Esc` | 開啟新的 `opencode` 終端機會話 |
| `Ctrl+Alt+K` / `Cmd+Alt+K` | 插入檔案參照（例如 `@File#L37-42`） |

---

## 文件

- [自訂 Provider](./docs/custom-providers.md) —— 在 Desktop、TUI 或 CLI 中設定 Provider。
- 本 Fork 主要改動的設計文件位於 [`docs/superpowers/`](./docs/superpowers/)。
- 上游文件：https://opencode.ai/docs

---

## 基於本專案開發

如果你的專案名稱衍生自或包含本倉庫（例如 `opencode-dashboard` 或 `opencode-mobile`），請在 README 中註明它並非 OpenCode 團隊開發，且與該團隊沒有隸屬關係。

---

## 參與貢獻

歡迎貢獻程式碼。請在提交 PR 前閱讀 [`CONTRIBUTING.md`](./CONTRIBUTING.md)。

- 分支名：簡短、連字號分隔，不要使用 `feat/` 前綴。
- 提交訊息：約定式風格 `type(scope): summary`。
- 測試：在套件目錄下執行（`bun run --cwd packages/core test`），切勿在倉庫根目錄執行。

---

## 授權

[MIT](./LICENSE)
