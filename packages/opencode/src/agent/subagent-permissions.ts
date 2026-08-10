import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import type { Agent } from "./agent"

export type GrantInput = { readonly tool: string; readonly resource?: string }

/**
 * Build the `permission` ruleset for a subagent's session when it's spawned
 * via the task tool. Combines:
 *
 * 1. The parent session's deny rules and external_directory rules.
 *    Parent agent restrictions only govern that agent; the subagent's own
 *    permissions determine its capabilities.
 * 2. Default `todowrite` and `task` denies if the subagent's own ruleset
 *    doesn't already permit them.
 * 3. Task `permission` grants (P3): allow rules appended last so they take
 *    precedence (V1 permission matching is last-match-wins). Blocklisted
 *    tools are dropped — the P2 blocklist keeps them unregistered anyway.
 */
export function deriveSubagentSessionPermission(input: {
  parentSessionPermission: PermissionV1.Ruleset
  subagent: Agent.Info
  grants?: readonly GrantInput[]
  blocked?: ReadonlySet<string>
}): PermissionV1.Ruleset {
  const canTask = input.subagent.permission.some((rule) => rule.permission === "task")
  const canTodo = input.subagent.permission.some((rule) => rule.permission === "todowrite")
  const grantRules: PermissionV1.Rule[] = (input.grants ?? [])
    .filter((grant) => !(input.blocked?.has(grant.tool) ?? false))
    .map((grant) => ({
      permission: grant.tool,
      pattern: grant.resource ?? "*",
      action: "allow" as const,
    }))
  return [
    ...input.parentSessionPermission.filter(
      (rule) => rule.permission === "external_directory" || rule.action === "deny",
    ),
    ...(canTodo ? [] : [{ permission: "todowrite" as const, pattern: "*" as const, action: "deny" as const }]),
    ...(canTask ? [] : [{ permission: "task" as const, pattern: "*" as const, action: "deny" as const }]),
    ...grantRules,
  ]
}
