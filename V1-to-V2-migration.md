# V1 → V2 迁移清单

> 分支：`999.0.17`
> 调研日期：2026-08-10
> 调研方式：三个并行只读研究子代理分别分析 `packages/opencode`、`packages/core`、`packages/tui` 的 V1/V2 边界，本文是汇总。

## 总体结论

**执行引擎已经是 V2。** 所有会真正产生模型调用的入口最终都进入
`@opencode-ai/core/session`（`SessionV2`）+ `SessionExecutionLocal` + `SessionRunner` +
V2 `ToolRegistry` / `PermissionV2`。V1 已不是运行时，而是**兼容面**：

- V1 **执行回路**（`SessionPrompt.loop` + `SessionProcessor` + V1 `ToolRegistry` + V1 `TaskTool`）已断线——仍装配在 layer 图里但无任何生产调用方（死代码）。
- V1 剩余活跃资产是四类兼容载体：**存储格式**、**事件兼容面**、**配置 schema**、**外部 wire 契约**。

当前状态与 Codex 评估一致：**V2 基础完成约 50%，剩余难点是"让 V2 成为唯一执行路径、然后删除 V1"**。

---

## 1. 各区域现状总表

| 区域 | 现状 | 判定 |
|---|---|---|
| Session 执行（prompt/command/shell/init） | `LegacySessionExecution`（V1 壳）内部全部委托 V2 `SessionV2`；V1 `SessionPrompt.loop` 仅测试调用 | **V2 主路径，V1 壳待收** |
| Session CRUD（list/get/create/fork/title/metadata） | V1 `Session.Service` 读同一张 `SessionTable`，httpapi CRUD 端点仍依赖 | **V1-only，待迁移** |
| Session 读取（messages） | `LegacySessionRead` = V2 读 + V1 保留消息 merge | **V2 主，V1 merge 待收** |
| Tool registry | V1 `ToolRegistry`（opencode 包）死代码；V2 `ToolRegistry`（core）完整（direct/deferred/hidden + settlement） | **V2 已接管** |
| `tool_search` | `searchDeferred` + 跨 turn `selected/onSelect` 已接入 V2 runner | **已完整生效** |
| Agent | V1 `Agent`（`@/agent`）仍在 `LegacySessionExecution.select` 使用；V2 `AgentV2.Service` 独立 | **双路径** |
| Subagent permission | V1 `subagent-permissions.ts` 只被死 V1 `TaskTool` 引用（不可达）；V2 用 `PermissionV2` + `SubagentPermit` | **V1 死路径，可删** |
| Permission | V1 `@/permission` 为主（pending 表），`replyCompatible` 兜底 V2；V2 请求不出现在 `/permission` list | **V1 主，V2 兜底** |
| Plugin 加载 | V1 格式加载（`@/plugin` + `loader.ts`），hooks 已桥接注册到 V2 `PluginV2` | **V1 格式 + V2 注册并存** |
| Plugin tools | 同一份 `Contribution` 双路：V1 registry（死）+ V2 `PluginToolCompatV2`（deferred，实际生效） | **V2 生效路径已通** |
| TUI 插件 | `plugin/tui/runtime.ts` 纯 V1 adapter，无 V2 运行时对应 | **V1-only** |
| MCP | 单一 V2 runtime（`core/src/mcp/runtime.ts`）；`MCP.toolsNode` 注册进 V2 `Tools.Service`（direct/deferred/blocked） | **V2 已接管** |
| Command | TUI 用 V2 `CommandV2`；V1 `@/command` 只服务 legacy instance API | **双路径** |
| TUI 主体 | 全部走 V2 client（`@opencode-ai/client`）；`native-v1-*` 仅用于 TUI plugin API 外部相容 | **V2 已接管** |
| CLI `run` | V2 执行 + `native-compat.ts` V1 形状外壳（事件对 V1 SDK 客户投影） | **V2 执行，V1 出口** |
| ACP | `native-v1-*` compat 把 V2 降级成 V1 legacy 形状供 ACP/外部协议消费 | **刻意保留的 V1 出口** |
| Config | V1 `ConfigV1.Info` + `ConfigMigrateV1`；httpapi config 组 V1-only | **V1-only** |
| Provider | V1 provider/auth 服务为主，参数混用 `ProviderV2.ID` | **V1 主，V2 ID 混用** |

---

## 2. 仍会落回 V1 的入口清单（迁移目标）

### 2.1 活跃 V1 入口（HTTP/CLI 实际使用，不能直接删）

1. **V1 legacy Session 存储服务** — `opencode/src/session/session.ts`
   httpapi 的 list/get/create/remove/update/fork/children、touch、title/metadata/archived/permission 更新。
   与 V2 共享同一 `SessionTable`。**CRUD 端点迁移前不可移除。**

2. **V1 Config** — `opencode/src/config/config.ts` + `ConfigV1.Info`（`@opencode-ai/core/v1/config/config`）
   `config.get/update` 端点、config 组。此区域 V1 最彻底。

3. **V1 Provider** — `opencode/src/provider/provider.ts`、`provider/auth`
   provider / config.providers 组；`LegacySessionExecution` 的模型解析路径。

4. **V1 Agent** — `opencode/src/agent/agent.ts`
   `LegacySessionExecution.select` 用 V1 Agent 选 agent，再交给 V2 `canonical.switchAgent`。

5. **V1 Permission** — `opencode/src/permission/index.ts`
   permission 组 + `permissionRespond`。V1 pending 表为主，`replyCompatible` 兜底 V2。
   **风险**：V2 工具发起的 `PermissionV2.ask` 不出现在 V1 `/permission` list。

6. **V1 Session 维护服务** — SessionRevert / SessionRunState / SessionStatus / SessionSummary / Todo
   httpapi 相应端点；`LegacySessionExecution.cleanupRevert` 先 V2 commit 再 V1 收尾。

7. **V1 Plugin 加载/触发/TUI** — `opencode/src/plugin/index.ts`、`loader.ts`、`plugin/tui/runtime.ts`
   插件安装/发现/TUI 插件仍 V1；运行时 hooks 已桥接 V2。

8. **V1 Command** — `opencode/src/command/index.ts`
   只服务 legacy instance HTTP API 的 `command.list` 端点。

### 2.2 死代码（已装配但不可达，可安全下线）

| 文件 | 说明 |
|---|---|
| `opencode/src/session/prompt.ts`（`SessionPrompt.loop`，L1373） | V1 主循环，无生产调用，仅测试 35 处 `.loop(` |
| `opencode/src/session/processor.ts`（`SessionProcessor`） | V1 处理器，无调用方 |
| `opencode/src/session/compaction.ts`（V1 `SessionCompaction`） | V1 压缩，无调用方 |
| `opencode/src/session/tools.ts`（V1 tool 组装） | 只被已断线的 `prompt.ts` 引用 |
| `opencode/src/tool/registry.ts`（V1 `ToolRegistry`） | 只被 `prompt.ts`/`tools.ts` 引用 |
| `opencode/src/tool/task.ts`（V1 `TaskTool`） | 依赖 `promptOps`，仅死路径提供 |
| `opencode/src/agent/subagent-permissions.ts` | 只被死 V1 `TaskTool` 引用 |

这些节点仍出现在 `app-runtime.ts`（L88-110）与 `httpapi/server.ts`（`legacySessionRuntimeNodes` L296-300）的 layer 图里。

### 2.3 刻意保留的 V1 出口（外部兼容，迁移完成后独立评估）

- `opencode/src/compat/native-v1-*.ts`（session/transcript/catalog）→ 供 `cli/cmd/run/native-compat.ts`（run 命令）与 `acp/client.ts`（opencode acp）消费
- `tui/src/plugin/native-v1-transcript.ts`、`native-v1-catalog.ts` → 仅 TUI plugin API adapter（`adapters.tsx`）外部相容
- `event-v2-bridge.ts`（`legacyEventPayloads`/`legacyEventProjection`）→ run 命令 stdout/JSON 事件输出、TUI `useEvent()` 的 legacy 事件集

---

## 3. core 包 V1/V2 边界

### 3.1 `packages/core/src/v1/` 目录（不可独立删除）

`v1/session.ts` 是**类型/错误门面**（76 行），非运行时；真数据模型在 `packages/schema/src/v1/session.ts`。
`v1/permission.ts` = schema `permission-v1` re-export + 4 错误类。
`v1/config/` = 18 个文件，V1 配置 schema。

它承载三类活跃资产，**删除前必须完成**：
1. **存储格式**：`core/src/session/sql.ts` 的 message/part/permission 列按 V1 形状存（`V1MessageData`、`PermissionV1.Ruleset`）
2. **事件兼容面**：`core/src/session.ts`（L359/425/440/464/652）、`session/command.ts`（L239）、`execution/local.ts`（L224）发布 `SessionV1.Event.*`/`LegacyEvent`
3. **配置迁移链**：`core/src/config.ts` 用 `ConfigV1.Info + ConfigMigrateV1` 解码旧配置

### 3.2 V2 → V1 交叉引用清单（core 内 11 处）

| V2 文件 | 引用 V1 | 性质 |
|---|---|---|
| `core/src/session.ts` | `SessionV1`、`LegacyEvent` | 发布兼容事件、V1 SessionInfo |
| `core/src/session/command.ts` | `PermissionV1`、`SessionV1` | 权限存 V1 规则、发布 V1 Created |
| `core/src/session/info.ts` | `SessionV1` | `toLegacyInfo` |
| `core/src/session/projector.ts` | `SessionV1.Event.*` | V1 事件投影到 V2 表 |
| `core/src/session/sql.ts` | `PermissionV1`、`V1MessageData` | DB 列类型 |
| `core/src/session/execution/local.ts` | `SessionV1.Event.Error` | drain 失败事件 |
| `core/src/config.ts` | `ConfigV1`、`ConfigMigrateV1` | 配置加载双路径 |
| `core/src/config/plugin/{provider,agent}.ts` | `ConfigV1/MigrateV1` | 配置迁移 |
| `core/src/plugin/provider/opencode.ts` | `ConfigProviderV1` | provider 配置 |

**`core/src/tool/` 目录零 V1 导入**（仅一条 TODO 注释）。

### 3.3 V2 已具备独立执行能力（已验证）

- **admit → wake → drain → settlement 全链路**：`session/execution/local.ts` + `run-coordinator.ts` 完整
- **V2 runner 自带工具循环**：`session/runner/llm.ts`（1217 行）从 provider turn → tool-call → `ToolRegistry.settle` → 回喂 → 下次 `llm.stream`，全自包含
- **compaction/revert 完整**：`session/compaction.ts`（450+ 行）、`session/revert.ts`（120 行）
- **tool registry 完整**：`core/tool/registry.ts` 有 `materialize`/`settle`/direct/deferred/hidden + `tool_search` 动态注入

### 3.4 V2 剩余工程缺口（可靠性优先）

- runner `llm.ts` 头部清单 8 项 `[ ]`：状态持久化、中断后 stale-work 拒绝（**影响可靠性**）、policy-filtered tool definitions、snapshot/patch 增量持久化、scoped runtime context、compaction continuation 条件、最终 status settlement、后台 title/summary/cleanup
- `builtins.ts`：`repo_clone`/`repo_overview`/edit fuzzy 未移植
- `tool/AGENTS.md` 记录的 3 个 gap：插件引导未走 `Tools.Service`、MCP/session-scoped 注册设计、`outputPaths` 未封装
- 集群化所有权、跨进程 drain 恢复（AGENTS.md 明确"未来"项）

---

## 4. TUI / Plugin / MCP 边界

### 4.1 TUI 主体已全 V2

- Client：`tui/src/context/sdk.tsx` 用 `@opencode-ai/client`（V2 effect client）
- Session/消息/catalog：全部 `sdk.native.*`（V2 API，V2 类型）
- 事件：`useNativeEvent()` 消费 V2 `OpenCodeEvent`；`useEvent()` 是 V1 词汇兼容层
- TUI state 结构全 V2（`SessionV2Info`、`SessionMessage`、`PermissionV2Request`）

**注意**：Codex 提到的 `session-compat`/`transcript-compat`/`catalog-compat` **命名在仓库中不存在**。实际命名是 `native-v1-*`（TUI `plugin/native-v1-*.ts` 与 opencode `compat/native-v1-*.ts`）。

### 4.2 V1 adapter 引用者（已确认仅外部相容）

| 文件 | 引用者 | 用途 |
|---|---|---|
| `tui/plugin/native-v1-transcript.ts` | 仅 `tui/plugin/adapters.tsx:23,142` | TUI plugin API `state.session` 外部投影 |
| `tui/plugin/native-v1-catalog.ts` | `adapters.tsx:22,159` + 测试 | plugin API `state.provider` |
| `opencode/compat/native-v1-*.ts`（3 个） | `cli/cmd/run/native-compat.ts`、`acp/client.ts` | run 命令 + ACP 外部协议 |

### 4.3 Plugin 双路径

- **来源单一**：V1 `hooks.tool` + `tool/*.{js,ts}` → `PluginToolCompat` 编译为 `Contribution`
- **V2 生效路径**：`PluginToolCompatV2` 把 Contribution 包成 canonical tool、`withExposure("deferred")`，`Tools.Service.register`（`bootstrap.ts:28,58-61` 触发）
- **V1 死路径**：V1 `ToolRegistry`（opencode 包）同一批 Contribution
- **V2 plugin host 无 tool 注册 API**：`plugin/v2/effect/context.ts` 的 `tool` 仅 ToolDomain（before/after/definition hooks），无 register

### 4.4 MCP 已是单一 V2 runtime

- 唯一实现：`core/src/mcp/runtime.ts`（stdio/StreamableHTTP/SSE/OAuth）
- `MCP.toolsNode`（runtime.ts L879-935）：`blockedTools` + `isModelVisible` 过滤 → `toCoreTool` → `directTools.has(name) ? "direct" : "deferred"` → `tools.register`（V2 `Tools.Service`）
- V1 session 仅通过 `MCP.Service.tools()` 读取同一来源

---

## 5. 迁移执行计划（按依赖排序）

### 批次 0：建立门禁（防倒退）

- 参照 `packages/schema/test/v1-isolation.test.ts`，为 `packages/core` 建立「`core/src` 不得 import `./v1/`」的测试门禁，倒逼迁移
- 盘点 `opencode serve` / `listenNative` vs `listen` 的 route 集合，确认哪套是生产面（避免测试走 noop 路径产生假阴性）

### 批次 1：删除 V1 执行死代码（低风险，纯删除）

> ✅ **已完成（999.0.17）**：
> - 解耦 `tool/task.ts` 对 `SessionPrompt.PromptInput` 的类型依赖 → 改用 `LegacySessionInput`
> - 删除 `session/prompt.ts`（SessionPrompt.loop）、`session/processor.ts`（SessionProcessor）、V1 `session/compaction.ts`、`session/tools.ts`
> - 从 `app-runtime.ts`、`httpapi/server.ts` 移除 `SessionProcessor.node` / `SessionCompaction.node`
> - 删除死代码测试：`prompt.test.ts`、`processor-effect.test.ts`、`compaction.test.ts`、`snapshot-tool-race.test.ts`、`structured-output.test.ts`、`structured-output-integration.test.ts`、`tool/registry.test.ts`、`tool/skill.test.ts`
> - 修复测试引用：`schema-decoding.test.ts`、`tool/task.test.ts` 改用 `LegacySessionInput`；`websearch.test.ts` 的 `webSearchEnabled` 移到 `tool/websearch.ts`
> - **保留** V1 `tool/registry.ts`（`plugin-compat-v2.test.ts` parity 测试仍依赖）；V1 工具定义文件（task/shell/edit 等）被 run 展示层引用，暂留
> - 注：`plugin-compat-v2.test.ts` 27 个失败与 `test/tool/`、`test/session/llm.test.ts` 的部分失败是 **baseline 预先存在问题**（stash 验证确认），非本批引入

原计划步骤：
1. 确认 `app-runtime.ts`、`httpapi/server.ts` 的 layer 图中 `SessionPrompt`/`SessionProcessor`/V1 `SessionCompaction`/V1 `ToolRegistry`/V1 `TaskTool`/`subagent-permissions.ts` 移除后无其他依赖
2. 迁移 `opencode/test/session/*.test.ts`（35 处 `.loop(`）到 V2 测试
3. 删除上述死代码 + 对应 `.node` 从 layer 图移除
4. 删除 V1 `SessionProcessor` 依赖的 `session/tools.ts`

### 批次 2：Permission 双轨合并（中风险）

> ✅ **HTTP 面已完成（999.0.17）**：
> - `groups/permission.ts` + `handlers/permission.ts`：experimental `/permission` list/reply 端点切换到 `PermissionV2`（wire schema `PermissionV2.Request`/`Reply`/`ID`，通过 `LocationServiceMap` 解析 per-Location 服务）
> - `session.permissionRespond`（`POST /api/session/:id/permission`）：从 V1 `replyCompatible` 切换到 V2 `PermissionV2.reply`
> - 移除 handler 中未使用的 V1 `permissionSvc` / imports
> - 调查确认：TUI/run/acp 都走 `packages/server` 的 V2 handler（`server.permission.*`）；experimental httpapi 的 V1 permission group 无实际 HTTP 消费者（仅契约测试），已切 V2

剩余（工具路径，批次 7 前保留）：
1. `@/permission`（V1）仍被 V1 工具路径使用（`agent/agent.ts`、`tool/shell.ts`、`tool/code-mode.ts`、`session/llm.ts` 等 12 个文件）——`Permission.node` 保留在 layer 图
2. V1 工具路径改走 `PermissionV2.ask`（依赖 V1 工具迁移）
3. `replyCompatible` 兜底逻辑仍被 `test/permission/next.test.ts` 覆盖，保留
4. `core/v1/permission.ts` 的运行时使用（session 数据模型的 permission 字段，批次 4）

### 批次 3：V2 可靠性收尾（V2 侧，高优先）

> ✅ **已完成（999.0.17）**：
> - **缺口1（会话级 cost/tokens 列陈旧）**：`Step.Ended` 投影调用 `applyUsage` 更新 `SessionTable` 的 cost/tokens_* 列
> - **缺口2（interrupted 独立行状态）**：`SessionAttemptStatus` 加 `"interrupted"`；`projectEnded` 对 interrupted outcome 写独立状态；`status()` 派生按 idle 处理
> - **缺口3（残留 attempt 自动结算）**：startup recovery 中 `settleCompletedAttempt` 对「assistant 已完成 + 无未结算工具」的残留 attempt 补发 `ProviderAttempt.Ended`
> - **缺口6（后台维护）**：drain 结束用首条用户消息生成启发式标题（`updateSessionTitle`）；`Compaction.Ended` 投影写入 `time_compacting`
> - **缺口7（patch 持久化）**：`Assistant.snapshot` 与 `Step.Ended` 事件加 `patch` 字段（`File.Diff` 提取到 `schema/src/file-diff.ts` 打破循环依赖）；runner 在 `Step.Ended` 用 `Snapshot.diff` 计算 patch 持久化
> - 标记后续：缺口4（delta 流式合并——需异步 timer 有回归风险）、缺口5（repo_clone/repo_overview/edit fuzzy——全新功能非迁移缺口）

原计划：
1. runner 状态持久化 + 中断后 stale-work 拒绝
2. policy-filtered tool definitions
3. 最终 status settlement / delta coalescing / 后台 title/summary/cleanup
4. `builtins.ts` 补齐 `repo_clone`/`repo_overview`/edit fuzzy

### 批次 4：httpapi 各 group 迁移到 V2 数据模型（核心）

> ✅ **部分完成（999.0.17）**：
> - **command group**：`instance.command` 端点切到 V2 `CommandV2`（wire schema 用 `@opencode-ai/schema/command` 的 `Command.Info`，经 `LocationServiceMap` 解析）；契约测试通过
> - **session group**：保留 V1 读壳。调研发现 V1 `Session.Service` 已直接读 V2 存储表（`SessionTable`），切换到 V2 需新建 V2→V1 Info 投影（V2 缺 metadata/permission 等字段），收益小风险大。`LegacySessionRead.history` 的 V1 merge 保留到批次 5
> - **config/provider/event group**：标注待办。调研确认其核心迁移点在 core（配置双路径、事件投影），httpapi 是最后一层出口，归批次 6/8。且这 5 个 group 无生产客户端（TUI/Web 走 `packages/server` V2 handler），主要是契约测试消费

原计划：
1. **session group**：CRUD 从 V1 `Session.Service` 迁到 V2（`SessionV2` 持久化 + 投影），移除 `LegacySessionRead` 的 V1 merge
2. **config group**：`ConfigV1` → V2 config 解码；移除 `ConfigMigrateV1`（保留一次性迁移入口）
3. **provider group**：V1 provider/auth → V2 provider
4. **event group**：`EventV2Bridge` 的 V1 序列化 → V2 事件词汇
5. **command group**：V1 `@/command` → V2 `CommandV2`

### 批次 5：存储格式迁移（高风险，影响用户数据）

> ✅ **部分完成（999.0.17）**：**permission 列切 V2（5a）**
> - `session` 表 `permission` 列从 `PermissionV1.Ruleset` → `PermissionV2.Ruleset`（`{permission,pattern,action}` → `{action,resource,effect}`）
> - 新增数据迁移 `20260811000000_session_permission_v2`（用现有 `DatabaseMigration` 机制；SQL 将既有 V1 JSON 原地重写为 V2 形状，防御性跳过已 V2 的行）
> - `store.ts` 移除 `toV2Rules` 读取转换（列已是 V2），V2 runner 直接消费
> - `command.ts` 复用 `info.ts` 导出的 `toV1Rules`（V1 事件载荷保持 V1 形状）；projector `sessionRow` 写列时 `toV2Rules`（V1→V2）；V1 读侧 `fromRow`/`toLegacyInfo` 用 `toV1Rules`（V2→V1 投影）
> - `data_migration` 表保留（未消费的死表，不删除避免 schema 变更）；V1 消息表（`V1MessageData`/`V1PartData`）退役推迟到批次 8 删除 V1 时一并处理

1. `core/src/session/sql.ts`：`V1MessageData` → `SessionMessage.Message`、`PermissionV1.Ruleset` → `PermissionV2.Ruleset`
2. 更新 `data-migration.sql.ts` 与既有用户库迁移路径
3. 更新 `session/info.ts` `toLegacyInfo`（或删除）

### 批次 6：事件兼容面收口

> 🔄 **进行中（999.0.17）**：
> - **第一步（schema 契约）已完成**：`schema/src/session-event.ts` 新增 V2 生命周期事件 `Created`/`Updated`/`Deleted`（`session.next.created/updated/deleted`），payload 用独立 `SessionSnapshot`（V2 Info 形状 + slug/version/metadata/permission，避免 `session.ts`↔`session-event.ts` 循环依赖）；`message-updater.ts` 的 `All.match` 增加 no-op 分支；client 已重新生成（`generated/types.ts`/`types.d.ts`/`client.d.ts` 含新事件）；event-manifest 契约测试断言 95→98、durable 43→46
> - **第二步（projector 双轨 + V2 发布点切换）已完成**：projector 新增 V2 生命周期投影（`sessionRowFromSnapshot` 从 `SessionSnapshot` 构造 SessionTable 行），V1 生命周期投影保留（V1 Session.Service 仍活跃）；`command.create`/`SessionV2.update`/`remove` 发布点切到 `SessionEvent.Created/Updated/Deleted`；`execution/local.ts` 的 `session.error` 保留（TUI 错误通知面，V2 无等价物，随 TUI 迁移一并处理）；TUI `useEvent` 增加 V2→V1 生命周期映射（`session.next.created/updated/deleted` → `session.created/updated/deleted`），sync.tsx 等零改动；core 全量 1529 pass
> - **第三步（TUI 执行面迁移）部分完成**：`routes/session/index.tsx` 的 plan_exit/plan_enter 从 `message.part.updated`（V1）迁移到 V2 `session.next.tool.input.started`/`tool.success`（callID→工具名追踪）；permission 链路已就位（V2 runner 发布 `permission.v2.asked/replied` → EventV2Bridge 投影 `permission.asked/replied` → TUI 消费）
> - **批次 7（出口收口）逐域推进中**：
>   - **session.status 域（已完成）**：新增 V2 `session.next.status` 事件（`StatusInfo` = busy/idle/retry，含 retry action）；producer 切 V2（core execution 路径 `execution/local.ts`/`session.ts` compact、opencode `SessionStatus.set`）；EventV2Bridge 投影 V2→V1（`session.status`）保 CLI/TUI 兼容；TUI `useEvent` lifecycleMap 加 status 映射；V2 regression 测试（schema `session-event-status.test.ts`）；`SessionStatus.Info` 类型换 V2 `StatusInfo`（wire 结构不变）；compact 测试更新监听 V2 Status
>   - **question.* 域（已完成 producer 切换）**：opencode `Question` 服务类型/ID/Event 切 V2（`@opencode-ai/schema/question`，`question.v2.asked/replied/rejected`）；`QuestionID` 用 V2 `Question.ID`；EventV2Bridge 投影 V2→V1（`question.asked/replied/rejected`）保 CLI/TUI；TUI `useEvent` lifecycleMap 加 question 映射；V2 regression 测试（schema `question-event-v2.test.ts`）。consumer（CLI/TUI）仍走 V1 投影，V1 definition 保留到 consumer 迁移后移除
>   - **session.diff 域（已完成 producer 切换）**：新增 V2 `session.next.diff` 事件（`{ sessionID, diff: FileDiff.Info[] }`）；revert.ts producer 切 V2 `SessionEvent.Diff`；EventV2Bridge 投影 V2→V1（`session.diff`）；TUI `useEvent` lifecycleMap 加 diff 映射；V2 regression 测试（schema `session-event-diff.test.ts`）
>   - **LSP/VCS 域（已完成）**：`LspEvent`（`lsp.updated`）与 `VcsEvent`（`vcs.branch.updated`）从 compatibilityDefinitions 移到 foundationDefinitions，作为独立 V2 domain events（不并入 session.next.*，符合产品决策）。两者无 producer（纯消费端触发拉取），保留在 ServerDefinitions 供 TUI/app 消费
>   - **ACP 域（已确认就绪）**：ACP adapter 已符合产品决策——`acp/client.ts` 全部通过 V2 `OpenCode.make`（native client）获取数据（sessions.get/list、messages.list），`native-v1-session/transcript/catalog` 是纯 V2→V1 形状转换（无任何 DB/存储读取）；`acp/content.ts` 的 `SessionV1.TextPartInput/FilePartInput` 仅作 ACP 协议边界形状（对外协议保持兼容）。无需代码改动
>   - **CLI presenter（--format json）已确认满足**：CLI 的 JSONL 输出数据源已是 V2 事件——`run.ts` 通过 `native-compat.ts`（CLI 的 compatibility adapter）消费，其 `event.subscribe` 从 `native.events.subscribe()`（V2 事件源）经 `legacyEventProjection` 投影 V1 形状；`--format json` 的 JSONL 契约（reasoning/tool/step/continuation ordering + V1 part 形状）由 run-process 契约测试验证通过（12 pass；1 个权限交互测试为 baseline 环境预存失败）。无需代码改动
>   - **compatibilityDefinitions 移除评估（暂不移除）**：按产品决策"先逐域迁移 producer 和 consumer 再移除 definition"。question/status/diff 的 producer 已切 V2，但 CLI/TUI consumer 仍走 V1 投影（未迁移）；`LegacyEvent.CommandExecuted`/`Project.Event` 等 producer 仍是 V1。当前不具备移除条件。待 consumer（TUI/CLI 全面改 V2 词汇）迁移完成后再逐域移除 `SessionStatusEvent`/`QuestionV1`/`sessionV1LiveDefinitions`（message.part.delta/session.diff/session.error）等 V1 definition。`SessionCompactionEvent` 无 producer（疑似废弃），可优先评估移除

1. 替换 `core/src/session.ts`/`command.ts`/`execution/local.ts` 的 `SessionV1.Event.*` 发布点为 V2 `SessionEvent`（`@opencode-ai/schema/session-event`）
2. TUI `useEvent()` legacy 事件集迁移到 V2 事件（`routes/session/index.tsx` 的 plan_exit/plan_enter、`sync.tsx` 的 session.updated/permission.*）
3. `event-manifest.ts` 移除 `compatibilityDefinitions`

### 批次 7：CLI/ACP 出口收口（外部契约，需产品决策）

1. `run.ts` stdout/JSON 事件格式迁移到 V2 词汇（同步改 `--format json` 契约测试）
2. `native-compat.ts` → 评估 V1 SDK 客户端的存续（插件 `client = createOpencodeClient(...)` 输入）
3. `acp/client.ts` + `compat/native-v1-*` → 评估 ACP 协议是否保留 V1 形状
4. `tui/plugin/native-v1-*` + `adapters.tsx` → TUI plugin API 是否提供 V2 state

### 批次 8：删除 V1 目录（最终）

> 🔄 **已改为「删除前置条件审计」（999.0.17）**：批次 8 的删除门槛是「没有 runtime import、没有新 V1 写入、没有直接 V1 consumer、旧资料与旧设定有明确升级路径、完整测试与 typecheck 通过」。当前审计结论：
>
> **前置条件 ① TUI consumer 边界** ✅：`useEvent` 是明确的 V1/V2 边界 adapter（V2 原生流 → V1 词汇投影），满足产品决策「迁移到 V2 词汇或明确的边界 adapter」。强制 consumer 改用 V2 会破坏 6 个调用方的 Event 类型联合，边界 adapter 是正确选择。
>
> **前置条件 ② compatibilityDefinitions 缩减** ⏸️：producer 已切 V2（session.status/question/session.diff），但 V1 definition 仍被依赖——`share-next.ts` 消费 `Session.Event.Updated/Deleted/Diff`（share 同步依赖 V1 事件形状的 SDK 转换），`summary.ts` 发布 `Session.Event.Diff`。需先迁移 share 的 SDK 转换与这些辅助 producer，才能逐项移除 V1 definition。
>
> **前置条件 ③ v1/config 一次性 migration boundary** ✅：`config.ts` 的 `decode` 已是明确的一次性迁移路径——旧配置（`ConfigMigrateV1.isV1`）走 `decodeV1Info + migrate`，新配置直接 V2 解码。新 runtime 配置只使用 V2 结构；旧配置兼容完成前 v1/config 不删除。
>
> **前置条件 ④ V1 消息表写入停止** ⏸️：V1 消息表仍被辅助写入（`reminders.ts`/`revert.ts`/`summary.ts`/`tool/plan.ts` 的 `updateMessage`/`updatePart`/`removeMessage`/`removePart`）通过 V1 Session.Service 发布 V1 事件写入。V2 无公开合成消息写入 API（批次 5 调研结论）——需先为 V2 提供 `updateMessage`/`updatePart` 等价物并迁移这些辅助写入，才能停止 V1 消息表写入并移除 Core V1 message projector。
>
> 进展（999.0.17）：
> - ① `reminders.ts` 已删除（`SessionCommand.synthetic` 接管 reminders/plan）
> - ② `revert.ts` V1 `updateMessage`/`removeMessage` 路径已停用：httpapi revert/unrevert 走 `SessionV2.revert.stage/clear/commit` 薄 adapter，`LegacySessionExecution.cleanupRevert` 不再调 V1 `revert.cleanup`
> - ③ `summary.ts` 的 V1 `updateMessage` 写入（`SessionSummary.summarize`）已删除；httpapi summarize 端点改走新的窄命令 `SessionV2.summarize`（`commitStagedRevert` + `switchModel` + `compact`），`LegacySessionExecution.summarize` 移除
> - ④ 剩余：`tool/plan.ts` 的 V1 `updateMessage`/`updatePart`（下一步转为 `SessionCommand.synthetic` 或标记不可执行）
>
> **批次 8 实际删除（待上述前置条件完成）**：按顺序 `v1/config/config.ts`（已依赖 V2）→ `core/src/v1/permission.ts` → `core/src/v1/session.ts` → `packages/schema/src/v1/*` 中不再被引用的部分。

### 批次 9：全量 V2-only regression gate

- 确认任何主要入口（TUI/CLI run/ACP/HTTP API）都不再落回 V1
- 运行全仓 typecheck + 契约测试

---

## 6. 风险与注意事项

1. **双表读写一致性**：V1 `Session.Service` 与 V2 `SessionV2` 共享 `SessionTable`。任何 V2 消息格式变更都会影响 V1 投影（`MessageV2.toLegacy`）。迁移完成前不要移除 V1 CRUD。
2. **两套 route 树执行语义不同**：TUI worker/native routes 用 `locationServiceMapV2Layer`（forwarding）；`packages/server/src/routes.ts` 独立 route 树仍绑 `noopLayer`（V2 工具彼处 recording-only）。需确认生产 server 入口。
3. **Permission 双轨盲区**：V2 工具请求不出现在 V1 `/permission` list，用户 UI 可能看不到待授权请求。
4. **`tool_search` selection 持久化**：若未来接入非 runner 的 V2 工具调用面（MCP/session-scoped 注册），需显式设计 selection 持久化。
5. **删除 V1 的依赖顺序**：存储格式 → 事件发布点 → 配置解码。`v1/config/config.ts` 已依赖 V2（`config/experimental`/`config/reference`），是最容易先移除的内部引用。
