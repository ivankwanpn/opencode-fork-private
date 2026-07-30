export * as SessionPromptExpansion from "./prompt-expansion"

import os from "os"
import path from "path"
import { fileURLToPath, pathToFileURL } from "url"
import type { Part } from "@opencode-ai/sdk/v2/types"
import { PromptInput } from "@opencode-ai/schema/prompt-input"
import { Context, Effect, Layer, Schema } from "effect"
import { AgentV2 } from "../agent"
import { CommandV2 } from "../command"
import { ConfigMarkdown } from "../config/markdown"
import { makeLocationNode } from "../effect/app-node"
import { FSUtil } from "../fs-util"
import { Location } from "../location"
import { ModelV2 } from "../model"
import { PermissionV2 } from "../permission"
import { AppProcess } from "../process"
import { Reference } from "../reference"
import { SessionCommand } from "./command"
import { SessionMessage } from "./message"
import { Prompt } from "./prompt"
import { SessionSchema } from "./schema"
import { SessionShell } from "./shell"

const argsRegex = /(?:\[Image\s+\d+\]|"[^"]*"|'[^']*'|[^\s"']+)/gi
const placeholderRegex = /\$(\d+)/g
const quoteTrimRegex = /^["']|["']$/g

export class CommandNotFoundError extends Schema.TaggedErrorClass<CommandNotFoundError>()(
  "SessionPromptExpansion.CommandNotFound",
  {
    command: Schema.String,
    available: Schema.Array(Schema.String),
  },
) {}

export class AgentNotFoundError extends Schema.TaggedErrorClass<AgentNotFoundError>()(
  "SessionPromptExpansion.AgentNotFound",
  {
    agent: Schema.String,
    available: Schema.Array(Schema.String),
  },
) {}

export type Error = CommandNotFoundError | AgentNotFoundError | AppProcess.AppProcessError

export type CommandInput = {
  readonly session: SessionSchema.Info
  readonly messageID: SessionMessage.ID
  readonly command: string
  readonly arguments: string
  readonly agent?: AgentV2.ID
  readonly model?: ModelV2.Ref
  readonly variant?: ModelV2.VariantID
  readonly files?: readonly PromptInput.FileAttachment[]
}

export type CommandResult = {
  readonly prompt: Prompt
  readonly agent: AgentV2.ID
  readonly model?: ModelV2.Ref
  readonly subtask: boolean
}

export interface Interface {
  readonly resolve: (prompt: PromptInput.Prompt) => Effect.Effect<PromptInput.Prompt>
  readonly materializeAgents: (prompt: Prompt, activeAgent?: AgentV2.ID) => Effect.Effect<Prompt>
  readonly command: (input: CommandInput) => Effect.Effect<CommandResult, Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/SessionPromptExpansion") {}

export const hasMentions = (text: string) => ConfigMarkdown.files(text).length > 0

export const agentGuidance = (name: string, denied = false) =>
  `Use the above message and context to generate a prompt and call the task tool with subagent: ${name}${
    denied ? " . Invoked by user; guaranteed to exist." : ""
  }`

export const unavailableAgentGuidance = (name: string) => `[Unavailable: requested subagent ${name} is not configured]`

export const expandArguments = (template: string, input: string) => {
  const raw = input.match(argsRegex) ?? []
  const args = raw.map((arg) => arg.replace(quoteTrimRegex, ""))
  const placeholders = template.match(placeholderRegex) ?? []
  const last = placeholders.reduce((maximum, item) => Math.max(maximum, Number(item.slice(1))), 0)
  const withNumbered = template.replaceAll(placeholderRegex, (_, index: string) => {
    const position = Number(index)
    const argIndex = position - 1
    if (argIndex >= args.length) return ""
    if (position === last) return args.slice(argIndex).join(" ")
    return args[argIndex] ?? ""
  })
  const usesArguments = template.includes("$ARGUMENTS")
  const expanded = withNumbered.replaceAll("$ARGUMENTS", input)
  if (placeholders.length > 0 || usesArguments || !input.trim()) return expanded
  return `${expanded}\n\n${input}`
}

const existingFilePaths = (files: readonly PromptInput.FileAttachment[] | undefined) => {
  const result = new Set<string>()
  for (const file of files ?? []) {
    if (!URL.canParse(file.uri)) continue
    const url = new URL(file.uri)
    if (url.protocol !== "file:") continue
    result.add(FSUtil.normalizePath(fileURLToPath(url)))
  }
  return result
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const agents = yield* AgentV2.Service
    const commands = yield* CommandV2.Service
    const fs = yield* FSUtil.Service
    const location = yield* Location.Service
    const references = yield* Reference.Service
    const shell = yield* SessionShell.Service

    const availableAgents = () =>
      agents.all().pipe(Effect.map((items) => items.filter((item) => !item.hidden).map((item) => item.id)))

    const requireAgent = Effect.fn("SessionPromptExpansion.requireAgent")(function* (name?: string) {
      const selected = yield* agents.select(name)
      if (selected.info) return selected.info
      return yield* new AgentNotFoundError({
        agent: name ?? selected.id,
        available: yield* availableAgents(),
      })
    })

    const resolve = Effect.fn("SessionPromptExpansion.resolve")(function* (prompt: PromptInput.Prompt) {
      const matches = ConfigMarkdown.files(prompt.text)
      if (matches.length === 0) return prompt

      const seen = new Set<string>()
      const explicitFiles = existingFilePaths(prompt.files)
      const explicitAgents = new Set((prompt.agents ?? []).map((agent) => agent.name))
      const configuredReferences = new Map(
        (yield* references.list()).map((reference) => [reference.name, reference] as const),
      )
      const attachments = yield* Effect.forEach(
        matches,
        Effect.fnUntraced(function* (match) {
          const name = match[1]
          if (!name || seen.has(name)) return []
          seen.add(name)
          const filepath = name.startsWith("~/")
            ? path.join(os.homedir(), name.slice(2))
            : path.resolve(location.directory, name)
          const info = yield* fs.stat(filepath).pipe(Effect.catch(() => Effect.succeed(undefined)))
          const source = {
            text: match[0],
            start: match.index,
            end: match.index + match[0].length,
          }

          if (info) {
            const normalized = FSUtil.normalizePath(filepath)
            if (explicitFiles.has(normalized)) return []
            explicitFiles.add(normalized)
            return [
              {
                type: "file" as const,
                value: PromptInput.FileAttachment.make({
                  uri: pathToFileURL(filepath).href,
                  name,
                  mime: info.type === "Directory" ? "application/x-directory" : "text/plain",
                  source,
                }),
              },
            ]
          }

          const agent = yield* agents.get(AgentV2.ID.make(name))
          if (agent) {
            if (explicitAgents.has(agent.id)) return []
            explicitAgents.add(agent.id)
            return [
              {
                type: "agent" as const,
                value: { name: agent.id, source },
              },
            ]
          }

          const reference = configuredReferences.get(name)
          if (!reference) return []
          const normalized = FSUtil.normalizePath(reference.path)
          if (explicitFiles.has(normalized)) return []
          explicitFiles.add(normalized)
          return [
            {
              type: "file" as const,
              value: PromptInput.FileAttachment.make({
                uri: pathToFileURL(reference.path).href,
                name,
                mime: "application/x-directory",
                source,
              }),
            },
          ]
        }),
      ).pipe(Effect.map((items) => items.flat()))

      const files = attachments.filter((item) => item.type === "file").map((item) => item.value)
      const mentionedAgents = attachments.filter((item) => item.type === "agent").map((item) => item.value)
      return PromptInput.Prompt.make({
        ...prompt,
        ...(files.length === 0 ? {} : { files: [...(prompt.files ?? []), ...files] }),
        ...(mentionedAgents.length === 0 ? {} : { agents: [...(prompt.agents ?? []), ...mentionedAgents] }),
      })
    })

    const materializeAgents = Effect.fn("SessionPromptExpansion.materializeAgents")(function* (
      prompt: Prompt,
      activeAgent?: AgentV2.ID,
    ) {
      if (!prompt.agents?.length) return prompt
      const selected = yield* agents.resolve(activeAgent)
      const configured = selected?.permissions ?? [{ action: "*", resource: "*", effect: "deny" as const }]
      const overrides = PermissionV2.fromToolOverrides(prompt.tools)
      return Prompt.make({
        ...prompt,
        agents: yield* Effect.forEach(prompt.agents, (attachment) => {
          if (attachment.guidance !== undefined) return Effect.succeed(attachment)
          return agents.get(AgentV2.ID.make(attachment.name)).pipe(
            Effect.map((target) => ({
              ...attachment,
              guidance: target
                ? agentGuidance(
                    target.id,
                    PermissionV2.evaluate("task", target.id, configured, overrides).effect === "deny",
                  )
                : unavailableAgentGuidance(attachment.name),
            })),
          )
        }),
      })
    })

    const runShell = Effect.fn("SessionPromptExpansion.shell")(function* (command: string, sessionID: string) {
      let output = ""
      yield* shell.execute({
        command,
        cwd: location.directory,
        sessionID,
        onOutput: (chunk) => Effect.sync(() => void (output += chunk)),
      })
      return output
    })

    const expandShell = Effect.fn("SessionPromptExpansion.expandShell")(function* (
      template: string,
      sessionID: string,
    ) {
      const matches = ConfigMarkdown.shell(template)
      if (matches.length === 0) return template
      const outputs = yield* Effect.forEach(matches, (match) => runShell(match[1] ?? "", sessionID), {
        concurrency: "unbounded",
      })
      let index = 0
      return template.replace(ConfigMarkdown.SHELL_REGEX, () => outputs[index++] ?? "")
    })

    const command = Effect.fn("SessionPromptExpansion.command")(function* (input: CommandInput) {
      const definition = yield* commands.get(input.command)
      if (!definition)
        return yield* new CommandNotFoundError({
          command: input.command,
          available: (yield* commands.list()).map((item) => item.name),
        })

      const targetAgent = yield* requireAgent(definition.agent ?? input.agent ?? input.session.agent)
      const taskModel =
        definition.model ?? (definition.agent ? targetAgent.model : undefined) ?? input.model ?? input.session.model
      const subtask = (targetAgent.mode === "subagent" && definition.subtask !== false) || definition.subtask === true
      const parentAgent = subtask ? yield* requireAgent(input.agent ?? input.session.agent) : targetAgent
      const selected = subtask ? (input.model ?? input.session.model) : taskModel
      const selectedModel =
        selected && input.variant ? { ...selected, variant: input.variant } : selected

      const withArguments = expandArguments(definition.template, input.arguments)
      const template = (yield* expandShell(withArguments, input.session.id)).trim()
      let prompt = yield* resolve(
        PromptInput.Prompt.make({
          text: template,
          ...(input.files === undefined ? {} : { files: input.files }),
        }),
      )
      if (subtask && !(prompt.agents ?? []).some((agent) => agent.name === targetAgent.id)) {
        prompt = PromptInput.Prompt.make({
          ...prompt,
          agents: [...(prompt.agents ?? []), { name: targetAgent.id }],
        })
      }

      const durable = SessionCommand.resolvePrompt(prompt)
      const projected = SessionCommand.projectPrompt({
        session: input.session,
        messageID: input.messageID,
        prompt: durable,
        agent: parentAgent.id,
        model: selectedModel,
      })
      const transformedParts = yield* commands.beforeExecute({
        command: input.command,
        sessionID: input.session.id,
        arguments: input.arguments,
        parts: projected.parts as readonly Part[],
      })

      return {
        prompt: SessionCommand.restorePrompt(durable, input.messageID, projected.message, transformedParts),
        agent: parentAgent.id,
        model: selectedModel,
        subtask,
      }
    })

    return Service.of({ resolve, materializeAgents, command })
  }),
)

export const locationLayer = layer
export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [AgentV2.node, CommandV2.node, FSUtil.node, Location.node, Reference.node, SessionShell.node],
})
