# V1 → V2 迁移清单

> 分支：`999.0.19`
> 调研日期：2026-08-10；最近核对：2026-08-18
> 调研方式：三个并行只读研究子代理分别分析 `packages/opencode`、`packages/core`、`packages/tui` 的 V1/V2 边界，本文是汇总。

## 总体结论

**执行引擎已经是 V2。** 所有会真正产生模型调用的入口最终都进入
`@opencode-ai/core/session`（`SessionV2`）+ `SessionExecutionLocal` + `SessionRunner` +
V2 `ToolRegistry` / `PermissionV2`。V1 已不是运行时，而是**兼容面**：

- V1 **执行回路**（`SessionPrompt.loop` + `SessionProcessor` + V1 `ToolRegistry`）已从生产 layer 图与源码删除；仍保留的 legacy 工具定义只服务兼容出口。
- V1 剩余活跃资产是四类兼容载体：**存储格式**、**事件兼容面**、**配置 schema**、**外部 wire 契约**。

当前已推进到**批次 8 的 Session consumer hard cut 收口**。V2 已是唯一模型执行路径，transcript storage hard cut
也已完成：运行时读取、mutation/revert 与 CLI import/export 全部只使用 canonical V2 transcript；retained
legacy `message` / `part` 用户资料按产品决策直接放弃，不迁移；`message`、`part` 与
`session_message_tombstone` 已从當前 schema 刪除並生成 drop migration。`Session.Service` production consumer
也已在 999.0.19 清零，舊 repository/layer source 與 Core V1 lifecycle projector 隨後完成刪除。下一阻塞點是
legacy HTTP/plugin/CLI/ACP wire schema 仍引用 V1 message/session/catalog型別；V1 event definitions已從
replay/public manifest與Schema export移除。整個
V1 → V2 遷移尚未完成，不能以 transcript 或 Session hard cut 代替最終完成狀態。

**999.0.19 進度**：production runtime 已無 `Session.Service` / `Session.node` consumer。CLI session/stats/GitHub、
workspace/sync、share、TUI validation、legacy execution adapter、legacy task/code-mode 與 experimental global list
均改讀寫 `SessionV2`；新增 source gate 阻止 production graph 重新掛載舊 Session service。`SessionV2.list` 補齊
archived 與 updated-time reporting filter，`SessionV2.move` 以 canonical `SessionEvent.Moved` 處理 workspace
placement，share subscriber 改消費 V2 Updated/Diff/Deleted。舊 `Service`/`Interface`/`layer`/row
repository/list/mutation implementation 與所有 V1 lifecycle publisher 已從 `session/session.ts` 刪除；該模組現在只保留明確的 legacy
HTTP wire schema、event alias、BusyError、title/usage/background helpers。舊 repository 專用測試已刪除，仍在測
現役 workspace/share/task/HttpApi 行為的 fixtures 全部改用 canonical V2。Core projector 的 V1
Created/Updated/Deleted branches 與 `sessionRow(SessionV1.Info)` 已刪除，V1 import allowlist 同步縮小。

**999.0.19 durable manifest closeout**：7 個 SessionV1 durable definitions（lifecycle 3 個、message/part 4 個）
已從 `DurableEventManifest.Durable` 移除，durable map 由 54 降至 47，只接受 canonical SessionEvent replay。
全部 SessionV1 definitions 暫留 `ServerDefinitions`，並保持原 public 排序，因此 Latest/OpenAPI/SSE union 仍保持
106 個事件，舊 wire consumer 不會在此批被靜默刪除。Core generic Event fixture 與 database migration restart 測試
也改用 V2 durable definitions。

**999.0.19 Session error producer closeout**：新增 public live `session.next.error`，payload 保留 optional Session ID
與 named-error `{ name, data }` 形狀。Core drain failure、legacy async adapter、plugin runtime 與 skill discovery
producers 全部切到 V2；EventV2Bridge 對舊 CLI/TUI/App consumer 純投影 `session.error`。public event inventory
由 106 增至 107，durable map 維持 47；Client generation 為 identity，沒有手動修改 generated files。

**999.0.19 deprecated idle producer closeout**：Core drain、manual compaction 與 OpenCode SessionStatus state
只發布 canonical `session.next.status`，不再緊接著重複發布 `session.idle`。EventV2Bridge 繼續投影唯一的
`session.status` 給舊 CLI/TUI/App consumer；Desktop 完成通知改由該 status 的 idle variant 觸發。
隨後 App/TUI 冗餘 fallback 已遷移，`session.idle` 與從未有 producer 的 `session.compacted` 一併從 public
manifest 移除；public event inventory 由 107 降至 105，durable map 維持 47。

**999.0.19 SDK V2 contract refresh**：legacy JavaScript SDK 的 V2 client 已從當前 OpenAPI 全量重生，補齊
此前未進入 generated surface 的 Session/Plugin/MCP routes 與 canonical event/type definitions。OpenCode、TUI
與 plugin consumer 改用 `PermissionV2Request` / `QuestionV2Request`、V2 permission 的
`action/resources/save/source` 欄位，以及 readonly native Session wire shape。Command catalog 不再假造
`source`：Core 合成的 skill slash commands 與其他 commands 共用 `CommandV2Info`，Direct footer 全部直接
搜尋/提交，ACP 也只讀一次 canonical command catalog，不再額外讀 skills 後重複合成。

**999.0.19 runtime V1 event alias closeout**：OpenCode `Session.Event` 與 `MessageV2.Event.PartDelta` 無任何
consumer，只是把 V1 Session event schema 重新 export 到 production runtime；兩者已刪除並以 source gate
阻止回流。Session consumer hard cut完成後，`SessionV1.Event`與其delta/diff/error schema也從Schema/Core
export刪除，不再存在可重新註冊的V1 Session event definition。

**999.0.19 Session status consumer hard cut**：CLI native adapter、TUI native event bus、App server state 與
E2E fixtures 全部改用 `session.next.status`，EventV2Bridge 不再投影 `session.status`。TUI plugin API 新增
typed `nativeEvent`（`Frozen<V2Event>`）並由 runtime scope 自動釋放 listener；內建 notifications 直接消費
canonical status。`SessionStatusEvent` definition 已刪除，public event inventory 由 105 降至 104，durable
map 維持 47；HTTP `session.status()` polling endpoint 保留，因為它是查詢而非 legacy event。

SDK 重生同時移除舊 `SessionStatus` / `PermissionRequest` / `QuestionRequest` aliases。App、Session UI 與
plugin state 改用 `SessionNextStatusInfo`、`PermissionV2Request`、`QuestionV2Request`；permission 欄位只使用
`action/resources/save/source`。V2 Session snapshot 的 unknown metadata 在唯一 UI projection boundary 安全
正規化為 JSON，非 JSON object 欄位丟棄、array 位置以 `null` 保留，並防止循環引用。

**999.0.19 request lifecycle event hard cut**：OpenCode legacy Permission service保留V1 ruleset/error/internal
pending shape，但發布邊界已切到`PermissionV2.Event`並投影`action/resources/save/source`；Question producer
原本已是V2。CLI、ACP、TUI plugin native bus與App event/state consumer全部直接使用
`permission.v2.asked/replied`、`question.v2.asked/replied/rejected`。EventV2Bridge不再重新命名或降級payload，
`PermissionV1.Event.Definitions`與`QuestionV1.Event.Definitions`已從public manifest移除；event inventory由
104降至99，durable map維持47。V1 permission rules/config/errors暫留給尚未遷移的legacy工具執行面，
不再是public event producer。

**999.0.19 Session diff/error live hard cut**：CLI、ACP、TUI native plugin bus與App state/notifications改為直接
消費`session.next.diff/error`；EventV2Bridge不再投影`session.diff/error`，Step.Failed只保留legacy assistant
message projection。Provider/model/structured-output失敗在`failAssistant()`以同一timestamp發布durable
Step.Failed與live Error，避免錯誤通知依賴compatibility bridge；outer runner defect仍由ExecutionLocal發布。
public manifest的SessionV1 live集合現只保留`message.part.delta`，event inventory由99降至97，durable維持47。
仍公開的7個V1 durable wire definitions改為明確列舉，避免`Array.filter`未縮窄型別而讓已退役diff/error
繼續污染Client declaration union；tracked Client declarations以排除既有`.d.ts`輸入的乾淨emit重生。

**999.0.19 final SessionV1 live event hard cut**：`message.part.delta`consumer已切到canonical
text/reasoning/tool-input delta。CLI以fragment ID綁定bridge建立的active part，保留resize replay與ended snapshot
防重複；ACP直接將assistant text/reasoning delta轉為ACP chunk，App/TUI使用既有native V2 reducer。
EventV2Bridge不再投影delta，SessionV1 live definitions已從public manifest清空；event inventory由97降至96，
durable維持47。仍公開的SessionV1項目只剩7個durable wire compatibility definitions，待message snapshot
consumer整體遷移後刪除。

**999.0.19 Session lifecycle consumer hard cut**：TUI native state、App Home/global/session/titlebar與OpenAI Codex
plugin改用`session.next.created/updated/deleted`，不再由TUI/App邊界降級命名。Codex websocket cleanup修正為
讀取native`event.data.info.id`；原本讀`properties.info`在V2 hook上實際無效。V1 lifecycle三項已從public
manifest移除，event inventory由96降至93，durable維持47；SessionV1 public compatibility只剩四個
message/part snapshot definitions。

**999.0.19 Message snapshot consumer hard cut**：CLI、ACP、App、TUI、Slack與GitHub handler已直接消費
canonical text/reasoning/tool/step/transcript mutation事件；App補齊message/user-text/content五類mutation、
hydration與message tombstone，UI view projection不再偽裝成wire event。`EventV2Bridge`的有狀態V1 snapshot
projector已刪除，舊`/event`與`/global/event`只保留canonical`data -> properties`無狀態包裝。四個
`message.updated/removed`與`message.part.updated/removed`已從public manifest移除，event inventory由93降至89，
durable維持47；Client與SDK生成型別不再暴露這四項事件。

**999.0.19 SessionV1 event schema closeout**：完成public/consumer hard cut後，Schema/Core中零production引用的
`SessionV1.Event`、`PartDelta`、`Diff`與`Error` export已刪除；V1 Session模組只保留仍被legacy HTTP/ACP/
CLI/TUI wire view使用的message/session資料型別與錯誤門面。這個批次不改public inventory或durable map。

---

## 1. 各区域现状总表

| 区域 | 现状 | 判定 |
|---|---|---|
| Session 执行（prompt/command/shell/init） | `LegacySessionExecution` 仅保留外部请求/响应形状，内部选择、权限、admission 与执行全部走 V2；V1 `SessionPrompt.loop` 已删除 | **V2-only 执行，wire 壳待收** |
| Session CRUD（list/get/create/fork/title/metadata） | production consumer 與 Core projector 全部走 `SessionV2`；舊 repository/layer source 已刪除 | **V2-only runtime，wire schema 待收** |
| Session 读取（messages） | HTTP/CLI/runtime 只读 canonical `SessionV2` transcript；retained V1 rows 不再合并 | **V2-only** |
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

6. **Session 维护兼容服务** — SessionRunState / SessionStatus / SessionSummary / Todo
   httpapi 相应端点仍保留 V1 wire 形状；`SessionRevert.Service`、其 runtime layer 与
   `LegacySessionExecution.cleanupRevert` 已移除，revert/unrevert 直接适配 V2 canonical state。

7. **V1 Plugin 加载/触发/TUI** — `opencode/src/plugin/index.ts`、`loader.ts`、`plugin/tui/runtime.ts`
   插件安装/发现/TUI 插件仍 V1；运行时 hooks 已桥接 V2。

8. **V1 Command** — `opencode/src/command/index.ts`
   只服务 legacy instance HTTP API 的 `command.list` 端点。

### 2.2 V1 执行死代码（已删除）

| 文件 | 说明 |
|---|---|
| `opencode/src/session/prompt.ts`（`SessionPrompt.loop`） | 已删除 |
| `opencode/src/session/processor.ts`（`SessionProcessor`） | 已删除 |
| `opencode/src/session/compaction.ts`（V1 `SessionCompaction`） | 已删除 |
| `opencode/src/session/tools.ts`（V1 tool 组装） | 已删除 |
| `opencode/src/agent/subagent-permissions.ts` | 已删除 |
| V1 loop/processor/compaction 对应测试 | 已删除或迁移到 V2 contract |

`app-runtime.ts` 与 `httpapi/server.ts` 的 production layer 图已移除上述节点。`opencode/src/tool/registry.ts`
暂留给 plugin compatibility parity test，不属于模型执行路径；legacy 工具定义仍被 run/外部展示层引用，随
对应 consumer 迁移再删除。

### 2.3 刻意保留的 V1 出口（外部兼容，迁移完成后独立评估）

- `opencode/src/compat/native-v1-*.ts`（session/transcript/catalog）→ 供 `cli/cmd/run/native-compat.ts`（run 命令）与 `acp/client.ts`（opencode acp）消费
- `tui/src/plugin/native-v1-transcript.ts`、`native-v1-catalog.ts` → 仅 TUI plugin API adapter（`adapters.tsx`）外部相容
- `event-v2-bridge.ts`（`legacyEventPayloads`）→ 僅為舊`/event`與`/global/event`保留canonical `data -> properties` envelope；不再投影或改名Session事件

---

## 3. core 包 V1/V2 边界

### 3.1 `packages/core/src/v1/` 目录（不可独立删除）

`v1/session.ts` 是**类型/错误门面**（76 行），非运行时；真数据模型在 `packages/schema/src/v1/session.ts`。
`v1/permission.ts` = schema `permission-v1` re-export + 4 错误类。
`v1/config/` = 18 个文件，V1 配置 schema。

它目前承载两类兼容资产，**删除前必须完成**：
1. **Session/wire 类型投影**：`SessionV1` ID、Info 与错误类型仍被 legacy API、CLI/TUI/ACP compatibility 边界消费
2. **配置迁移链**：`core/src/config.ts` 用 `ConfigV1.Info + ConfigMigrateV1` 解码旧配置

canonical transcript 与 permission 已使用 V2 schema；legacy `message` / `part` / tombstone tables 已从当前
schema 删除，不再是 `packages/core/src/v1/` 的保留理由。

### 3.2 V2 → V1 主要交叉引用清单

| V2 文件 | 引用 V1 | 性质 |
|---|---|---|
| `core/src/session.ts` | `SessionV1.MessageID` | exact-retry legacy ID 投影 |
| `core/src/session/info.ts` | `SessionV1`、`PermissionV1` | `toLegacyInfo` / `toV1Rules` 外部投影 |
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
> - **session group**：transcript list/get/revert/mutation 已切 canonical `SessionV2`，`LegacySessionRead` 的 retained merge 已删除；Session CRUD 仍保留 V1 `Session.Service` 读壳。`Session.Service` 直接读 `SessionTable`，下一批必须扩充 V2 等价能力并逐个迁移 consumer，不能回退 legacy transcript。
> - **config/provider/event group**：标注待办。调研确认其核心迁移点在 core（配置双路径、事件投影），httpapi 是最后一层出口，归批次 6/8。且这 5 个 group 无生产客户端（TUI/Web 走 `packages/server` V2 handler），主要是契约测试消费

原计划：
1. **session group**：CRUD 从 V1 `Session.Service` 迁到 V2（`SessionV2` 持久化 + 投影）；transcript merge 已先行移除
2. **config group**：`ConfigV1` → V2 config 解码；移除 `ConfigMigrateV1`（保留一次性迁移入口）
3. **provider group**：V1 provider/auth → V2 provider
4. **event group**：`EventV2Bridge` 的 V1 序列化 → V2 事件词汇
5. **command group**：V1 `@/command` → V2 `CommandV2`

### 批次 5：存储格式迁移（transcript hard cut 已完成）

> ✅ **部分完成（999.0.17）**：**permission 列切 V2（5a）**
> - `session` 表 `permission` 列从 `PermissionV1.Ruleset` → `PermissionV2.Ruleset`（`{permission,pattern,action}` → `{action,resource,effect}`）
> - 新增数据迁移 `20260811000000_session_permission_v2`（用现有 `DatabaseMigration` 机制；SQL 将既有 V1 JSON 原地重写为 V2 形状，防御性跳过已 V2 的行）
> - `store.ts` 移除 `toV2Rules` 读取转换（列已是 V2），V2 runner 直接消费
> - `command.ts` 复用 `info.ts` 导出的 `toV1Rules`（V1 事件载荷保持 V1 形状）；projector `sessionRow` 写列时 `toV2Rules`（V1→V2）；V1 读侧 `fromRow`/`toLegacyInfo` 用 `toV1Rules`（V2→V1 投影）
> - `data_migration` 表保留（未消费的死表，另批处理）
>
> ✅ **transcript storage hard cut（999.0.17）**：
> - CLI export/import 改为 `{ version: 2, session, messages }` canonical envelope；versionless V1 export 与旧 flat share payload 明确拒绝
> - HTTP/runtime transcript list/get/revert/mutation 只读写 `SessionV2` 与 `SessionMessageTable`，不再 merge、adopt 或回写 retained rows
> - retained legacy `message` / `part` 用户资料按产品决策直接放弃，不做一次性迁移
> - `MessageTable`、`PartTable`、`SessionMessageTombstoneTable` 已从 runtime schema/export 删除
> - migration `20260812130609_drop_legacy_transcript` 会删除 `message`、`part`、`session_message_tombstone`
> - source isolation gate 阻止 production runtime 重新引用上述 legacy table symbols
>
> 存储面的下一步不是恢复 retained compatibility，而是随着 `Session.Service` consumer 迁移，删除其余只为
> V1 CRUD/wire projection 存在的 schema 与 projector 分支。

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
> **999.0.19 Session consumer hard cut** ✅：
> - production `packages/opencode/src` 已零 `Session.Service` / `Session.node` 引用，source gate 同時檢查指定 migrated consumer 與全域 runtime graph。
> - CLI session delete 走 `SessionRemoval`，保留 descendant background cancellation 與 durable share revocation；list/stats 走 V2 list/messages 與 keyset pagination。
> - workspace warp/sync steal 走 `SessionV2.move` + `SessionEvent.Moved`；同目錄 workspace 設定/清除不再經 V1 full-snapshot update。projector 對省略 subpath 寫 SQL NULL，避免 Drizzle 忽略 clear。
> - share state 走 `SessionV2.update` 的 value/null 語義；share transcript 從 canonical messages 純投影到既有 remote wire；subscriber 改聽 V2 Updated/Diff/Deleted。
> - legacy task/code-mode 從 V2 permissions/get/create 取得 Session 狀態；GitHub Action 建立 Session 不再發布 V1 Created。
> - HttpApi Exerciser 的 seed/get/messages helpers 已改 V2，因此 runtime graph 移除 `Session.node` 後不靠測試專用 fallback。
> - **後續 closeout**：不可達的 OpenCode Session repository/layer 與 V1 lifecycle publishers 已刪除；所有現役測試 seed 改用 V2 fixture，Core projector 不再接受 V1 Created/Updated/Deleted。
>
> **前置条件 ① TUI consumer 边界** ✅：`useEvent` 是明确的 V1/V2 边界 adapter（V2 原生流 → V1 词汇投影），满足产品决策「迁移到 V2 词汇或明确的边界 adapter」。强制 consumer 改用 V2 会破坏 6 个调用方的 Event 类型联合，边界 adapter 是正确选择。
>
> **前置条件 ② compatibilityDefinitions 缩减** ⏸️：producer 已切 V2（session.status/question/session.diff），`SessionSummary.diff` 也已改读 canonical assistant `snapshot.patch`，不再发布或依赖 V1 diff。V1 definition 仍被 `share-next.ts`、CLI/TUI compatibility projection 等 consumer 依赖；需先迁移这些 consumer，才能逐项移除 definition。
>
> **前置条件 ③ v1/config 一次性 migration boundary** ✅：`config.ts` 的 `decode` 已是明确的一次性迁移路径——旧配置（`ConfigMigrateV1.isV1`）走 `decodeV1Info + migrate`，新配置直接 V2 解码。新 runtime 配置只使用 V2 结构；旧配置兼容完成前 v1/config 不删除。
>
> **前置条件 ④ transcript storage hard cut** ✅：HTTP `updatePart`/`deletePart`/`deleteMessage`、revert commit、reminders/plan、summarize、CLI import/export 与 transcript reads 全部走 V2 command/event/projector；不再读取、写入或 adopt retained V1 rows。
>
> **本轮 transcript mutation closeout（999.0.17）**：
> - Part-level revert 现在持久化 canonical `contentIndex`，message-level revert 的边界不再误删前一条消息。
> - commit 原子截断 canonical assistant content、删除边界后的 canonical messages，并清除边界后的 pending inputs。
> - `SessionSummary.diff` 读取 canonical `snapshot.patch`；obsolete `SessionRevert.Service`、runtime/server layer 与 V1-only compact/revert test 已移除。
> - retained legacy transcript rows 明确退役且不迁移；legacy-only message/part ID 统一按 not found 处理。
> - CLI import/export 使用 version 2 canonical envelope；runtime schema 与生成 migration 已删除三张 legacy transcript tables。
>
> **本轮 canonical mutation closeout（999.0.17）**：
> - `SessionV2.update` 现支持 metadata/share 的原子替换与显式清除（`undefined` 保留 / `null` 清除 / 值整体替换；`{}` 是合法存储值而非清除）；projector 全快照投影改用 SQL null 语义（`?? null`），显式清除不再被 Drizzle 忽略而残留旧值。
> - 新增 `SessionV2.permissions` / `SessionV2.setPermissions`：V2 ruleset 完整替换、保序保重复、`[]` 为合法清除；权限不进入 `SessionSchema.Info`。
> - 新增 durable 乐观并发原语：`EventV2.publish` 支持 `expectedSeq`（immediate transaction 内比较 `event_sequence.seq`，不符以 `EventV2.ConflictError` defect 抛出）；`SessionV2` 的 update/setPermissions 走文件内 `mutateSession` 边界（读 row+seq → 推导全快照 → 带 expectedSeq 发布 → 冲突重试，上限 32；`NotFoundError` 不重试）；`publishCompatibilityUpdate`（revert compat echo）同样带 expectedSeq 守衛，不再可能以 stale 快照覆盖 canonical mutation 的投影。已知限制：跨进程下 WAL + `BEGIN IMMEDIATE` 保证事件日志一致，但投影为进程内注册，跨进程投影一致性仍待后续批次。
> - `PermissionV2.configured` 与 CodeMode 执行期 catalog 过滤统一为 agent → Session → prompt overrides 三源合并（`evaluate` 的 last-match-wins 不变）；Session 级规则可通过 `setPermissions` 生效。
>
> **仍阻止实际删表/删目录的依赖** ⏸️：
> - `session/session.ts` 已不含 repository/layer，只剩 legacy HTTP wire schema、BusyError、event alias 與通用 helpers；legacy route/plugin/CLI consumer 未遷移前仍不能整檔刪除。
> - Durable manifest 已 V2-only；`ServerDefinitions` 仍保留 V1 live/wire definitions，待 CLI/TUI/plugin/ACP consumer 遷移後逐項刪除。
> - `session.error` 與 Session status producer 已 V2-only；舊 consumer 暫經 bridge 投影，dead `session.idle` / `session.compacted` definitions 已移除。
> - Config、Provider、Agent、Permission 与 plugin/TUI 外部 wire compatibility 仍有活跃 V1 consumer。
> - `packages/core/src/v1/*` 与 `packages/schema/src/v1/*` 因上述 runtime/wire consumer 尚不能整体删除。
>
> **批次 8 下一步**：Session mutation、production consumer、repository、projector 與 durable replay manifest 已 canonical。接下来逐一遷移
> legacy HTTP/plugin/CLI/TUI/ACP live/wire consumer；之后按 Config/Provider/Agent/Permission 与外部
> wire 边界的引用关系删除 `core/src/v1/*`、`packages/schema/src/v1/*`。`v1/config` 必须保留到旧配置一次性
> 升级路径不再需要时。整个批次仍未完成。
>
> ✅ **本輪 httpapi session CRUD 遷移（999.0.17）**：
> - 實驗性 httpapi 的 list/get/children/create/remove/update/fork 與 requireSession 全部改走 `SessionV2.Service`；handler 不再 resolve V1 `Session.Service`，`LegacySessionRead` 的 httpapi 引用已移除。
> - 響應保留 V1 `Session.Info` wire 形狀，經 compat 層新增的純投影 `legacySessionFromV2`（`compat/native-v1-session.ts`，無任何 storage 讀取）；`summary`/`permission` 不在 V2 公共 Info 中，響應不再攜帶（與 production server 面一致），契約測試已同步。
> - `SessionV2.list` 擴充 `orderBy: "updated"`、`start`（time_updated >=）、`subpath` 前綴過濾與 pathless-directory fallback，完整覆蓋原 V1 list 的 directory/scope/path/roots/start/search/limit 語義。
> - create 走 `SessionV2.create`，auto-share 門檻（`flags.autoShare || conf.share === "auto"`，子 session 跳過）內聯至 handler；`SessionShare.create`（V1 wrapper）已移除，share/unshare 端點保留待後續批次。
> - update 走 `SessionV2.update` + `permissions`/`setPermissions`（permission 合併語義不變）；remove 走 `SessionV2.remove`（遞迴子 session）+ 保留 background-job 取消；fork 直接讀取 canonical V2 messages 並以 `SessionV2.fork` 複製（無 V2→V1→V2 往返）。
> - 剩餘 `Session.Service` consumer（stats/share sync/experimental list/CLI/TUI/sync/legacy execution/GitHub/task/code-mode 等）留待後續批次。
>
> **本輪 P1/P2 修正（999.0.17）**：
> - `EventV2.publish({ replaceAggregate: true })` 將舊 aggregate history purge、Session Deleted projector、sequence 推進與 `session.next.deleted` tombstone 寫入放進同一 durable DB transaction；失敗會整體 rollback，不再可能 crash 於 purge 與 publish 之間而留下「live Session row + 空 history」。
> - 新增無 Session foreign key 的 `session_share_revocation` durable outbox 與 `session_share_removal` intent marker（migrations `20260815012419_session_share_revocation`、`20260815025712_share_removal_intent`）。outbox 以 `(session_id, share_id)` 為複合鍵，可同時保存刪除交錯中產生的舊、新遠端憑證；即使 staging 時尚無 live share，intent marker 也會攔截稍後完成的 remote create 並把結果轉入 outbox。HTTP `2xx`/`404` 才刪除對應憑證，網路/服務端失敗保留 secret、增加 `attempt_count`，並在同一 instance scope 內以 1s/5s/15s 做去重、有限重試。
> - share removal 採明確 fail-closed invariant：staging DB transaction 失敗時不得刪除本地 Session，因為沒有 durable revocation credential 就繼續會永久孤立遠端分享；staging 後 local remove 失敗時 intent/outbox 也保留，重試相同 Session remove 可接續完成。`revokePending` 不再用「Session 存在」作 check-then-delete，而是保留與 live share 相同的 staged row，只有 Session 消失或 row 已不是 live share 時才撤銷，消除了 concurrent delete 清掉合法 outbox 的窗口。
> - `ShareNext.init()` 維持依 canonical directory 恢復，而不是用目前登入帳號做 process-global revocation：現有 durable row 尚未保存建立時的 endpoint/account/org identity，全域重試可能把 org share 送往錯誤控制面。當前刪除流程已有同 process bounded retry；若要安全移除 directory scope，必須先把 share 的控制面身份一併持久化。
> - `SessionRemoval` 成為 legacy httpapi 與 native V2 server 的共用生命週期：遞迴收集後代、stage share revocation、取消整棵子樹 background jobs、呼叫 atomic `SessionV2.remove`、處理 pending revocation。`packages/server` 經 `SessionRemovalCapability` 解耦 host 實作；native adapter 優先由 durable Session location 載入正確 `InstanceStore` context，但 directory/project boot 失敗時會記錄 warning 並改走無 instance 依賴的 durable removal，process-local job 清理降級不再阻止 Session 刪除。
> - create 尊重 payload 的 `workspaceID`（`payload.workspaceID ?? routedWorkspace`）；未指定 title 的子 session 使用 V1 的 `Child session - ` 前綴。
> - fork 改以 cutoff 的 transcript index 切割（`findIndex` + `slice`），未知 cutoff 回 400；原字典序過濾在 imported IDs 下會複製錯誤子集。
> - `SessionV2.ListInput` union 順序修正（project variant 優先，`{project,directory,subpath}` 不再被剝成 directory 查詢）；subpath LIKE 逃逸 `%`/`_`/`\`（`ESCAPE '\'`）；`fromRow` 的 `archived: 0` 改 nullish 讀取。
> - model projection 保留 optional presence：資料庫省略 variant 時仍為 `undefined`，明確 `"default"` 與非 default 值均原樣投影至 V2/V1 wire；不再把 omitted 與 explicit default 合併。macOS 原生選單的 zoom 動作在 role 檢查前走 renderer-owned 路徑。

### 批次 9：全量 V2-only regression gate

- 确认任何主要入口（TUI/CLI run/ACP/HTTP API）都不再落回 V1
- 运行全仓 typecheck + 契约测试

---

## 6. 风险与注意事项

1. **共享 Session row 一致性**：V1 `Session.Service` 与 V2 `SessionV2` 仍共享 `SessionTable`；迁移 CRUD consumer 时必须先补齐 V2 metadata/permission 等等价能力，再移除 V1 projection。V2 mutation 之间已由 `expectedSeq` 乐观并发守衛（update/setPermissions/compat echo 全覆盖），但 V1 `Session.Service` 经 V1 事件投影的直接写表路径仍无此守衛，consumer 迁移完成前两者仍可能交错。Transcript 已是 canonical-only，不得恢复双表读写。
2. **两套 route 树执行语义不同**：TUI worker/native routes 用 `locationServiceMapV2Layer`（forwarding）；`packages/server/src/routes.ts` 独立 route 树仍绑 `noopLayer`（V2 工具彼处 recording-only）。需确认生产 server 入口。
3. **Permission 双轨盲区**：V2 工具请求不出现在 V1 `/permission` list，用户 UI 可能看不到待授权请求。
4. **`tool_search` selection 持久化**：若未来接入非 runner 的 V2 工具调用面（MCP/session-scoped 注册），需显式设计 selection 持久化。
5. **删除 V1 的依赖顺序**：存储格式 → 事件发布点 → 配置解码。`v1/config/config.ts` 已依赖 V2（`config/experimental`/`config/reference`），是最容易先移除的内部引用。
