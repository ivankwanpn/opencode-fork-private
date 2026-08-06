<p align="center">
  <picture>
    <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
    <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
    <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="OpenCode logo">
  </picture>
</p>
<p align="center">开源的 AI Coding Agent —— 增强版 Fork。</p>

<p align="center">
  <a href="README.md">English</a> |
  <a href="README.zh.md">简体中文</a> |
  <a href="README.zht.md">繁體中文</a>
</p>

---

本仓库是 [OpenCode](https://opencode.ai)（MIT 协议）的**功能增强 Fork**，基于上游 `1.18.3` 分叉，并持续演进为 `999.0.11`。它保留了上游的终端界面（TUI）、桌面应用、Web 应用、无头 API 服务器和 SDK，同时将核心 agent loop 重构为**事件驱动、持久化、异步**的架构，并加入了一系列可靠性、兼容性与开发者体验改进。

> **注意：** 本项目并非 OpenCode 团队开发，也与 OpenCode 官方没有任何隶属关系。"OpenCode" 是各自所有者的商标；本 Fork 以 MIT 协议分发。

---

## 为什么有这个 Fork？

上游 OpenCode 本身已经非常出色。本 Fork 在四个方向上更进一步：

1. **事件驱动的持久化子代理循环。** 原生 V2 会话中的后台子代理默认异步执行；V1 兼容路径需要设置 `OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true` 才启用相同能力。子会话通过基于 SQLite 的持久化任务协议被接纳，父会话由完成通知**唤醒**，而不是阻塞其 provider 轮次。同时提供一流的 `get_task_output` 工具，用于显式快照和有界等待。
2. **持久化的任务提交与通知生命周期。** `task_submission`、子输入终态投影和父会话通知 outbox 会跨进程重启保留。正在进行的 provider 工作不会自动续接；不明确的尝试会标记为 `recovery-required`，而不是自动重发。递归取消树语义也保持持久化。
3. **原生 V2 / 旧版 V1 共存且保持兼容。** 插件兼容层让旧的 `.opencode/tool/*` 工具和 `hooks.tool` 插件可以出现在 V2 会话中；旧版 SDK/API 路径仍然可用于外部服务器；ACP（Agent Client Protocol）服务器运行在原生 `/api` 之上。
4. **覆盖全端的生产力功能。** 自定义 Provider（OpenAI Responses / OpenAI 兼容 / Anthropic Messages）与服务端模型发现、默认 Provider 的实时模型发现、LSP 支持、MCP 资源溯源与辅助工具、Composer 上下文用量指示器、持久化的 Queue/Steer 后续输入等。

---

## 亮点

### 事件驱动的子代理循环

- 在原生 V2 会话中，`task` 工具**默认异步**启动子代理。V1 兼容路径需要设置 `OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true`；启用后工具调用立即返回运行中的句柄，子代理在 provider 轮次之外继续工作。
- 子代理完成时，一条持久化通知会被接纳为父会话的合成输入并唤醒父会话——协调器无需等待整个批次即可响应已完成的工作并调度后续任务。
- `get_task_output` 为 1–20 个归属的任务 ID 返回持久化状态快照，并支持对当前进程中活跃任务的可选有界等待。重启后会返回持久化状态，而不会等待已经丢失的内存任务；未知或非归属 ID 以相同方式失败，避免被用作会话 ID 探测工具。
- `background: false` 仍然是真正立即依赖的显式逃生通道。切勿在一条助手消息中批量发起多个前台 `task` 调用。
- 内置任务代理：`general`、`explore`、`research` 和 `worker`。`research` 是只读的深度分析专家；`worker` 是聚焦的实现专家。`general-purpose` 仍然是 `general` 的别名。

### 持久化的任务生命周期

- 每次任务调用由 `(parentSessionID, assistantMessageID, toolCallID)` 唯一标识。精确重试会采用现有提交；冲突复用会失败。
- `task_submission` 表记录状态（`accepted → running → completed / error / cancelled / recovery-required`）、代理路径、模型、结果与时间戳。
- 子任务结算与父会话通知 outbox 行在**同一事务**中写入；outbox 在崩溃后可幂等重放，因此重试不会产生重复的持久化父会话输入。
- `completion_delivery` 区分 `"tool"`（前台，直接返回结果）与 `"parent"`（后台，走通知通道），并支持原子提升。
- 递归 `cancelTree(rootSessionID)` 持久化地取消完整的拥有关系树，并在报告完成前等待后代静默。
- `subagent_max_concurrency` 与 `subagent_depth` 配置可限制失控的并发扇出。

### 持久化的后续输入（Queue / Steer）

- 提示与命令携带显式投递模式。`queue` 输入在会话忙碌时持久化待处理，并在会话空闲时按顺序提升；`steer` 输入在下一个安全的 provider 轮次边界提升。
- 新增 V2 端点：待处理输入列表 / 精确查询 / 提升 / 取消。待处理队列项在客户端刷新与服务器重启后仍然存在，并通过确定性消息 ID 幂等对账。
- `Enter` 使用配置的默认模式（默认 `steer`，与上游一致）；`Ctrl+Enter`（及平台等价键）始终强制 Steer。

### 自定义 Provider

- 可从 Desktop、TUI 或 CLI（`opencode providers configure [id]`）配置 **OpenAI Responses**、**OpenAI Chat Completions / OpenAI 兼容** 或 **Anthropic Messages** 三种协议。
- **服务端模型发现**会探测兼容的 `/models` 端点（总超时 15 秒，仅跟随同源重定向），归一化常见目录结构，并将结果合并到表单中而不覆盖你的编辑。
- 支持按模型的推理能力、上下文窗口与最大输出限制。配置文件保持与官方 V1 兼容；API 密钥绝不会写入 `opencode.json`（字面密钥存入凭据存储，`{env:NAME}` 引用保持为环境变量引用）。
- 推理努力值选项通过 OpenCode 的模型 variant 机制做到协议与模型感知。

### 默认 Provider 的实时模型发现

- 默认 Provider 反映其配置的上游端点实际暴露的模型，而不是陈旧的 `models.dev` 快照。
- 保留已有元数据（限制、能力、成本、variants）；瞬时失败会保留最后一次成功的快照或静态目录。
- 在启动、连接变化以及 `models.dev` 刷新后自动刷新。OAuth 与 Provider 原生集成保持其专用加载器。

### 插件兼容层

- 旧的 `.opencode/{tool,tools}/*` 配置工具与插件 `hooks.tool` 定义被统一发现一次，并注册进 **V2 Core ToolRegistry**（带作用域清理），使 V1 与 V2 会话展示完全相同的工具集。
- 完整的 V1 插件钩子桥（`v1-compat.ts`）将 `chat.message`、`chat.params`、`chat.headers`、`permission.ask`、`tool.execute.before/after`、`experimental.chat.messages/system.transform`、`experimental.text.complete`、`experimental.provider.small_model` 等映射到 V2 插件运行时。
- 现有插件无需改动即可继续工作；公共插件 ABI 没有被破坏。

### MCP 增强

- **资源溯源：** MCP 内嵌资源与资源链接现在携带类型化溯源（服务器、URI、MIME、名称、描述、注解、`_meta`），在结算、持久化存储与插件往返中都不会丢失身份信息。
- 新增 V2 资源辅助工具：`list_mcp_resources`、`list_mcp_resource_templates` 与 `read_mcp_resource`，通过规范 V2 注册表注册，并带有 V2 权限与输出约束。
- MCP 成为一级 Core 子系统（`packages/core/src/mcp/`），包含 catalog、runtime、browser、OAuth、callback 与 resource-tool 模块，统一暴露在 `packages/core/src/mcp.ts` 之后。

### LSP 支持

- 新增语言服务器协议子系统（`packages/core/src/lsp/`），提供 LSP 客户端运行时、语言检测、诊断以及接入 V2 工具注册表的 `lsp` 工具族。

### 借鉴 Codex 的 agent loop 加固

- **停止钩子：** `session.stop` / `session.subagent.stop` 插件钩子决定一个轮次是结束还是继续（带块计数上限），并采用 fail-open 策略，避免钩子异常卡死轮次。
- **事务安全的 steer 定向：** EventV2 提交事务中可选的 `expectedActiveAttemptID` 会用类型化错误拒绝过期的 steer。
- **轮次级 Responses WebSocket：** 内部续接循环复用同一条 Responses WebSocket 连接，而不是每个轮次重新建立。
- **持久化代理路径：** `task_submission` 记录完整的代理祖先路径；**投影修复工具**可以从持久化事件日志重建读模型。
- **Plan/Build 提醒：** 会话代理切换模式时，runner 会注入 plan-mode / build-switch 上下文。

### 模型专用提示词

- 为 OpenAI GPT/Codex、Anthropic Claude、Gemini、Kimi、Meta（muse-spark）、Trinity 以及面向推理重型模型的 "beast" 变体提供按模型区分的系统提示词——按模型 ID 自动选择，并带有默认回退。

### 桌面 / Web 应用

- **Composer 上下文用量指示器** 直接在提示输入区显示 `Context window: 3% · Used: 31.6k / 1M`（旧版与 V2 两种 composer 均支持），并可打开上下文详情标签页。
- **安全关闭项目：** 关闭陈旧/缺失的项目行不再因 stale-read 错误而崩溃。
- **分阶段会话标签恢复：** 恢复的非活动标签立即使用持久化的标签信息渲染；完整会话同步通过可取消、单并发的空闲队列执行，并支持悬停/聚焦优先。
- **OpenAI OAuth 尝试生命周期：** 取消浏览器 OAuth 尝试会正确释放 `localhost:1455`，重试流程不再报 `EADDRINUSE`。
- **Provider 管理** 工具：编辑、断开连接与变更辅助函数，带乐观状态对账；settings-v2 的 agent/plugin 面板。
- Electron 主进程支持**系统代理与全局代理**，并带服务器健康检查。

### TUI

- **自定义 Provider 向导**——键盘驱动的分步配置流程，支持 Back/Cancel/Retry/手动输入。
- **原生事件恢复：** SSE 断线与持久化序号缺口恢复，可重放缺失事件并重建规范读模型，而不会重复文本、推理或工具条目。
- 原生 V2 会话 / 转录 / 目录兼容适配器。

### ACP（Agent Client Protocol）

- ACP 服务器现在通过**原生客户端门面**（`packages/opencode/src/acp/client.ts`）运行：会话、转录、事件、权限、目录与配置均使用原生 `/api` 客户端；动态 MCP `add` 是唯一的旧版回退。

---

## 安装

我们建议**先自行打包，然后通过生成的安装包进行安装**，而不是从源码直接运行。这是目前在 **Windows** 上已验证的流程；macOS 和 Linux 的打包目标已配置，但我们尚未验证。

### 前置要求

- [Bun](https://bun.sh) 1.3+ —— 本仓库使用 bun workspaces 管理
- Git —— 用于克隆仓库

```bash
git clone <你的仓库地址>
cd <仓库目录>
bun install
```

### Windows —— 打包并安装（已验证）

```bash
bun run --cwd packages/desktop package:win
```

命令完成后，会在 `packages/desktop/dist/` 下生成一键式 NSIS 安装包：

```
opencode-desktop-win-x64.exe
```

双击安装包并按提示完成安装即可。未打包的构建产物同时写入 `packages/desktop/dist/win-unpacked/`，可供检查。

#### NSIS 依赖

构建 Windows 安装包需要使用 **NSIS**。大多数情况下 electron-builder 会在首次构建时自动下载 NSIS（需要联网，并缓存在 `%LOCALAPPDATA%\electron-builder\Cache\nsis`），**无需手动安装**。如果环境中没有 NSIS——例如自动下载失败或处于离线环境——请手动安装并配置：

1. 用以下任一方式安装 NSIS：
   ```powershell
   winget install NSIS.NSIS
   # 或：choco install nsis
   # 或从 https://nsis.sourceforge.io/Download 下载
   ```
2. 验证已安装且已加入 `PATH`：
   ```powershell
   makensis /VERSION
   ```
3. 如果 electron-builder 仍然找不到，请通过 `NSIS_PATH` 环境变量指向你的 NSIS 安装目录（包含 `makensis.exe` 的目录）：
   ```powershell
   setx NSIS_PATH "C:\Program Files (x86)\NSIS"
   # 设置后请重新打开终端，使新值生效
   ```
4. 如果因无法访问 GitHub 导致自动下载失败（例如公司代理），请让 electron-builder 使用其二进制文件的镜像：
   ```powershell
   setx ELECTRON_BUILDER_BINARIES_MIRROR "https://npmmirror.com/mirrors/electron-builder-binaries/"
   ```
5. 重新执行 `bun run --cwd packages/desktop package:win`。

### macOS / Linux —— 尚未验证

打包目标已定义在 `packages/desktop/electron-builder.config.ts` 中，但我们**尚未**在真实机器上验证：

```bash
# macOS —— 在 packages/desktop/dist/ 下生成 .dmg / .zip
bun run --cwd packages/desktop package:mac

# Linux —— 在 packages/desktop/dist/ 下生成 .AppImage / .deb / .rpm
bun run --cwd packages/desktop package:linux
```

> [!NOTE]
> 我们目前只验证了 **Windows** 上的打包安装流程。上面针对 macOS 和 Linux 的命令按现状提供；如果遇到问题，请反馈给我们。

### 从源码运行（面向开发者）

```bash
bun dev                 # 在当前目录运行 TUI
bun dev serve           # 无头 API 服务器（默认端口 4096）
bun run --cwd packages/app dev          # Web 应用
bun run --cwd packages/desktop dev      # 桌面应用（Electron）
```

构建出的 `opencode` 二进制支持与上游相同的命令：`opencode [directory]`、`opencode serve`、`opencode run`、`opencode acp`、`opencode providers configure` 等。

---

## VS Code 扩展

本 Fork 在 [`sdks/vscode/`](./sdks/vscode/) 中附带了一个 VS Code 扩展，用于将 `opencode` 集成到编辑器中。请自行打包成 `.vsix` 然后本地安装。

> **前置要求**：扩展会在终端中启动 `opencode` CLI，因此请先确保 Fork 的 `opencode` 二进制在 `PATH` 中可用（按 [安装](#安装) 一节从源码构建或安装）。

### 1. 打包生成 `.vsix`

```bash
cd sdks/vscode
bun install
bun install -g @vscode/vsce     # 全局安装 vsce（或直接用下面的 bunx @vscode/vsce）
vsce package --no-dependencies --skip-license
```

`vsce` 会自动执行 `vscode:prepublish` 钩子（类型检查 + lint + esbuild 生产构建），并在 `sdks/vscode/` 下生成 **`opencode-999.0.11.vsix`**。

如果 `vsce` 对仓库或版本元数据报错，可以加上发布流水线使用的同样参数：

```bash
vsce package --no-dependencies --skip-license --no-git-tag-version --no-update-package-json
```

### 2. 安装 `.vsix`

命令行方式：

```bash
code --install-extension opencode-999.0.11.vsix
```

或通过 VS Code 界面：

1. 打开**扩展**面板（`Ctrl+Shift+X` / `Cmd+Shift+X`）
2. 点击 **...**（更多操作）菜单
3. 选择 **Install from VSIX...**（从 VSIX 安装...）
4. 选择 `opencode-999.0.11.vsix`

如果扩展没有立即激活，请重载窗口。

### 使用方式

| 快捷键（Windows / Linux / macOS） | 作用 |
| --- | --- |
| `Ctrl+Esc` / `Cmd+Esc` | 打开 `opencode` 终端，若已运行则聚焦 |
| `Ctrl+Shift+Esc` / `Cmd+Shift+Esc` | 打开新的 `opencode` 终端会话 |
| `Ctrl+Alt+K` / `Cmd+Alt+K` | 插入文件引用（例如 `@File#L37-42`） |

---

## 文档

- [自定义 Provider](./docs/custom-providers.md) —— 在 Desktop、TUI 或 CLI 中配置 Provider。
- 本 Fork 主要改动的设计文档位于 [`docs/superpowers/`](./docs/superpowers/)。
- 上游文档：https://opencode.ai/docs

---

## 基于本项目开发

如果你的项目名称衍生自或包含本仓库（例如 `opencode-dashboard` 或 `opencode-mobile`），请在 README 中注明它并非 OpenCode 团队开发，且与该团队没有隶属关系。

---

## 参与贡献

欢迎贡献代码。请在提交 PR 前阅读 [`CONTRIBUTING.md`](./CONTRIBUTING.md)。

- 分支名：简短、连字符分隔，不要使用 `feat/` 前缀。
- 提交信息：约定式风格 `type(scope): summary`。
- 测试：在包目录下运行（`bun run --cwd packages/core test`），切勿在仓库根目录运行。

---

## 许可证

[MIT](./LICENSE)
