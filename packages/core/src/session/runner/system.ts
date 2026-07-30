export * as SessionRunnerSystem from "./system"

import type { Model } from "@opencode-ai/llm"
import type { PermissionV2 } from "../../permission"
import type { MCP } from "../../mcp/runtime"
import { Wildcard } from "../../util/wildcard"
import PROMPT_ANTHROPIC from "./prompt/anthropic.txt"
import PROMPT_BEAST from "./prompt/beast.txt"
import PROMPT_CODEX from "./prompt/codex.txt"
import PROMPT_DEFAULT from "./prompt/default.txt"
import PROMPT_GEMINI from "./prompt/gemini.txt"
import PROMPT_GPT from "./prompt/gpt.txt"
import PROMPT_KIMI from "./prompt/kimi.txt"
import PROMPT_META from "./prompt/meta.txt"
import PROMPT_TRINITY from "./prompt/trinity.txt"

export function provider(model: Pick<Model, "id">) {
  if (model.id.includes("muse-spark")) return PROMPT_META
  if (model.id.includes("gpt-4") || model.id.includes("o1") || model.id.includes("o3")) return PROMPT_BEAST
  if (model.id.includes("gpt")) return model.id.includes("codex") ? PROMPT_CODEX : PROMPT_GPT
  if (model.id.includes("gemini-")) return PROMPT_GEMINI
  if (model.id.includes("claude")) return PROMPT_ANTHROPIC
  if (model.id.toLowerCase().includes("trinity")) return PROMPT_TRINITY
  if (model.id.toLowerCase().includes("kimi")) return PROMPT_KIMI
  return PROMPT_DEFAULT
}

export function identity(model: Pick<Model, "id" | "provider">) {
  return `You are powered by the model named ${model.id}. The exact model ID is ${model.provider}/${model.id}`
}

export function mcp(
  instructions: ReadonlyArray<MCP.ServerInstructions>,
  permissions: PermissionV2.Ruleset = [],
) {
  const visible = instructions.filter(
    (item) => item.tools.length === 0 || item.tools.some((tool) => !disabled(tool, permissions)),
  )
  if (visible.length === 0) return
  return [
    "<mcp_instructions>",
    ...visible.flatMap((item) => [
      `  <server name="${item.name}">`,
      ...item.instructions.split("\n").map((line) => `    ${line}`),
      "  </server>",
    ]),
    "</mcp_instructions>",
  ].join("\n")
}

function disabled(action: string, permissions: PermissionV2.Ruleset) {
  const rule = permissions.findLast((rule) => Wildcard.match(action, rule.action))
  return rule?.resource === "*" && rule.effect === "deny"
}
