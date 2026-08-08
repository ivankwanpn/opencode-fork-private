export * as BuiltInTools from "./builtins"

import { makeLocationNode } from "../effect/app-node"
import { Layer } from "effect"
import { BashTool } from "./bash"
import { CodeModeTool } from "./code-mode"
import { ApplyPatchTool } from "./apply-patch"
import { EditTool } from "./edit"
import { GlobTool } from "./glob"
import { GrepTool } from "./grep"
import { GetTaskOutputTool } from "./get-task-output"
import { LSPTool } from "./lsp"
import { PlanExitTool } from "./plan-exit"
import { QuestionTool } from "./question"
import { ReadTool } from "./read"
import { SkillTool } from "./skill"
import { StopTaskTool } from "./stop-task"
import { TaskTool } from "./task"
import { TodoWriteTool } from "./todowrite"
import { WebFetchTool } from "./webfetch"
import { WebSearchTool } from "./websearch"
import { WriteTool } from "./write"

/**
 * Composes only the shipped Location-scoped built-in tool transforms.
 * Each tool retains its implementation and focused tests independently. Dynamic
 * MCP and plugin tools later use separate scoped canonical registrations, while
 * provider/model filtering belongs to a future materialization phase rather
 * than this static list. The caller intentionally supplies shared Location
 * services once to this merged set.
 *
 * TODO: Port the remaining launch-follow-up leaves deliberately: edit fuzzy
 * parity, repo_clone, and repo_overview. Keep MCP and plugin transforms
 * separate from this static built-in list.
 */
export const node = makeLocationNode({
  name: "built-in-tools",
  layer: Layer.empty,
  deps: [
    ApplyPatchTool.node,
    BashTool.node,
    CodeModeTool.node,
    EditTool.node,
    GlobTool.node,
    GrepTool.node,
    LSPTool.node,
    PlanExitTool.node,
    QuestionTool.node,
    ReadTool.node,
    SkillTool.node,
    StopTaskTool.node,
    TaskTool.node,
    GetTaskOutputTool.node,
    TodoWriteTool.node,
    WebFetchTool.node,
    WebSearchTool.node,
    WriteTool.node,
  ],
})
