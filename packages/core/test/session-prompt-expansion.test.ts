import { describe, expect, test } from "bun:test"
import path from "path"
import { pathToFileURL } from "url"
import { AgentV2 } from "@opencode-ai/core/agent"
import { CommandV2 } from "@opencode-ai/core/command"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Location } from "@opencode-ai/core/location"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProjectV2 } from "@opencode-ai/core/project"
import { Reference } from "@opencode-ai/core/reference"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { Prompt } from "@opencode-ai/core/session/prompt"
import { SessionPromptExpansion } from "@opencode-ai/core/session/prompt-expansion"
import { SessionShell } from "@opencode-ai/core/session/shell"
import { DateTime, Effect, Layer } from "effect"
import { testEffect } from "./lib/effect"

const directory = AbsolutePath.make(process.cwd())
const shellCalls: string[] = []
const build = AgentV2.Info.make({ ...AgentV2.Info.empty(AgentV2.ID.make("build")), mode: "primary" })
const research = AgentV2.Info.make({
  ...AgentV2.Info.empty(AgentV2.ID.make("research")),
  mode: "subagent",
  model: {
    providerID: ProviderV2.ID.make("research-provider"),
    id: ModelV2.ID.make("research-model"),
  },
})
const allow = AgentV2.Info.make({
  ...AgentV2.Info.empty(AgentV2.ID.make("allow")),
  hidden: true,
  permissions: [{ action: "task", resource: "*", effect: "allow" }],
})
const deny = AgentV2.Info.make({
  ...AgentV2.Info.empty(AgentV2.ID.make("deny")),
  hidden: true,
  permissions: [{ action: "task", resource: "*", effect: "deny" }],
})
const agentItems = new Map([
  [build.id, build],
  [research.id, research],
  [allow.id, allow],
  [deny.id, deny],
])
const agentLayer = Layer.succeed(
  AgentV2.Service,
  AgentV2.Service.of({
    get: (id) => Effect.succeed(agentItems.get(id)),
    default: () => Effect.succeed(build),
    resolve: (id) => Effect.succeed(id === undefined ? build : agentItems.get(AgentV2.ID.make(id))),
    select: (id) => {
      const selected = id === undefined ? build.id : AgentV2.ID.make(id)
      return Effect.succeed({ id: selected, info: agentItems.get(selected) })
    },
    all: () => Effect.succeed(Array.from(agentItems.values())),
    reload: () => Effect.void,
    transform: () => Effect.die("unused transform"),
  }),
)
const commandLayer = Layer.succeed(
  CommandV2.Service,
  CommandV2.Service.of({
    get: (name) =>
      Effect.succeed(
        name === "review"
          ? CommandV2.Info.make({
              name,
              template: "Review $1 and $2 !`status` @package.json @research",
              agent: "research",
              subtask: true,
            })
          : name === "direct"
            ? CommandV2.Info.make({ name, template: "Direct $ARGUMENTS", agent: "research", subtask: false })
            : name === "bad-agent"
              ? CommandV2.Info.make({ name, template: "Delegate", agent: "ghost" })
              : undefined,
      ),
    list: () =>
      Effect.succeed([
        CommandV2.Info.make({
          name: "review",
          template: "Review $1 and $2 !`status` @package.json @research",
          agent: "research",
          subtask: true,
        }),
        CommandV2.Info.make({
          name: "direct",
          template: "Direct $ARGUMENTS",
          agent: "research",
          subtask: false,
        }),
        CommandV2.Info.make({ name: "bad-agent", template: "Delegate", agent: "ghost" }),
      ]),
    beforeExecute: (input) =>
      Effect.succeed(
        input.parts.map((part) => (part.type === "text" ? { ...part, text: `${part.text} [command-hook]` } : part)),
      ),
    reload: () => Effect.void,
    transform: () => Effect.die("unused transform"),
  }),
)
const locationLayer = Layer.succeed(
  Location.Service,
  Location.Service.of({
    directory,
    project: { id: ProjectV2.ID.global, directory },
  }),
)
const shellLayer = Layer.succeed(
  SessionShell.Service,
  SessionShell.Service.of({
    execute: (input) =>
      Effect.gen(function* () {
        shellCalls.push(input.command)
        yield* input.onOutput(`[${input.command}]`)
      }),
  }),
)
const referencePaths = {
  docs: AbsolutePath.make(path.join(directory, "configured-docs")),
  gitdocs: AbsolutePath.make(path.join(directory, "git-cache")),
  secret: AbsolutePath.make(path.join(directory, "secret-docs")),
  research: AbsolutePath.make(path.join(directory, "agent-collision")),
}
const referenceLayer = Layer.succeed(
  Reference.Service,
  Reference.Service.of({
    list: () =>
      Effect.succeed([
        new Reference.Info({
          name: "docs",
          path: referencePaths.docs,
          source: { type: "local", path: referencePaths.docs },
        }),
        new Reference.Info({
          name: "gitdocs",
          path: referencePaths.gitdocs,
          source: { type: "git", repository: "https://example.com/docs.git" },
        }),
        new Reference.Info({
          name: "secret",
          path: referencePaths.secret,
          hidden: true,
          source: { type: "local", path: referencePaths.secret, hidden: true },
        }),
        new Reference.Info({
          name: "research",
          path: referencePaths.research,
          source: { type: "local", path: referencePaths.research },
        }),
      ]),
    reload: () => Effect.void,
    transform: () => Effect.die("unused transform"),
  }),
)
const it = testEffect(
  AppNodeBuilder.build(SessionPromptExpansion.node, [
    [AgentV2.node, agentLayer],
    [CommandV2.node, commandLayer],
    [Location.node, locationLayer],
    [Reference.node, referenceLayer],
    [SessionShell.node, shellLayer],
  ]),
)

const session = SessionV2.Info.make({
  id: SessionV2.ID.make("ses_prompt_expansion"),
  projectID: ProjectV2.ID.global,
  title: "test",
  agent: AgentV2.ID.make("build"),
  model: {
    providerID: ProviderV2.ID.make("test-provider"),
    id: ModelV2.ID.make("test-model"),
  },
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: DateTime.makeUnsafe(0), updated: DateTime.makeUnsafe(0) },
  location: { directory },
})

describe("SessionPromptExpansion", () => {
  test("expands numbered and raw command arguments with V1-compatible tokenization", () => {
    expect(SessionPromptExpansion.expandArguments("Review $1 then $2", '"src one" tests extra')).toBe(
      "Review src one then tests extra",
    )
    expect(SessionPromptExpansion.expandArguments("Review $ARGUMENTS", '"src one" tests')).toBe(
      'Review "src one" tests',
    )
    expect(SessionPromptExpansion.expandArguments("Review", "src tests")).toBe("Review\n\nsrc tests")
    expect(SessionPromptExpansion.expandArguments("Review $1", "[Image 1] src")).toBe("Review [Image 1] src")
  })

  it.effect("resolves file and agent mentions into durable typed attachments", () =>
    Effect.gen(function* () {
      const expansion = yield* SessionPromptExpansion.Service
      const prompt = yield* expansion.resolve({ text: "Inspect @package.json with @research and @missing" })

      expect(prompt.files).toHaveLength(1)
      expect(prompt.files?.[0]).toMatchObject({
        name: "package.json",
        mime: "text/plain",
        source: { text: "@package.json", start: 8, end: 21 },
      })
      expect(prompt.files?.[0]?.uri).toStartWith("file:")
      expect(prompt.agents).toEqual([{ name: "research", source: { text: "@research", start: 27, end: 36 } }])
    }),
  )

  it.effect("resolves configured local, Git, and hidden reference aliases after agent mentions", () =>
    Effect.gen(function* () {
      const expansion = yield* SessionPromptExpansion.Service
      const prompt = yield* expansion.resolve({
        text: "Use @docs @gitdocs @secret @research",
      })

      expect(prompt.files).toEqual([
        {
          uri: pathToFileURL(referencePaths.docs).href,
          name: "docs",
          mime: "application/x-directory",
          source: { text: "@docs", start: 4, end: 9 },
        },
        {
          uri: pathToFileURL(referencePaths.gitdocs).href,
          name: "gitdocs",
          mime: "application/x-directory",
          source: { text: "@gitdocs", start: 10, end: 18 },
        },
        {
          uri: pathToFileURL(referencePaths.secret).href,
          name: "secret",
          mime: "application/x-directory",
          source: { text: "@secret", start: 19, end: 26 },
        },
      ])
      expect(prompt.agents).toEqual([
        {
          name: "research",
          source: { text: "@research", start: 27, end: 36 },
        },
      ])
    }),
  )

  it.effect("deduplicates configured references against explicit file attachments", () =>
    Effect.gen(function* () {
      const expansion = yield* SessionPromptExpansion.Service
      const explicit = {
        uri: pathToFileURL(referencePaths.docs).href,
        mime: "application/x-directory",
        name: "manual-docs",
      }
      const prompt = yield* expansion.resolve({
        text: "Use @docs",
        files: [explicit],
      })

      expect(prompt.files).toEqual([explicit])
    }),
  )

  it.effect("materializes permission-aware durable agent guidance", () =>
    Effect.gen(function* () {
      const expansion = yield* SessionPromptExpansion.Service
      const prompt = Prompt.make({
        text: "Delegate",
        agents: [{ name: "research" }],
      })

      const ask = yield* expansion.materializeAgents(prompt, build.id)
      const allowed = yield* expansion.materializeAgents(prompt, allow.id)
      const denied = yield* expansion.materializeAgents(prompt, deny.id)
      const overridden = yield* expansion.materializeAgents(
        Prompt.make({ ...prompt, tools: { task: false } }),
        allow.id,
      )

      expect(ask.agents?.[0]?.guidance).toBe(SessionPromptExpansion.agentGuidance("research"))
      expect(allowed.agents?.[0]?.guidance).toBe(SessionPromptExpansion.agentGuidance("research"))
      expect(denied.agents?.[0]?.guidance).toBe(SessionPromptExpansion.agentGuidance("research", true))
      expect(overridden.agents?.[0]?.guidance).toBe(SessionPromptExpansion.agentGuidance("research", true))
    }),
  )

  it.effect("records an explicit visible failure for unknown agent attachments", () =>
    Effect.gen(function* () {
      const expansion = yield* SessionPromptExpansion.Service
      const prompt = yield* expansion.materializeAgents(
        Prompt.make({ text: "Delegate", agents: [{ name: "ghost" }] }),
        build.id,
      )

      expect(prompt.agents).toEqual([
        {
          name: "ghost",
          guidance: SessionPromptExpansion.unavailableAgentGuidance("ghost"),
        },
      ])
    }),
  )

  it.effect("applies command agent model precedence for direct commands", () =>
    Effect.gen(function* () {
      const expansion = yield* SessionPromptExpansion.Service
      const result = yield* expansion.command({
        session,
        messageID: SessionMessage.ID.make("msg_direct_command"),
        command: "direct",
        arguments: "src",
        variant: ModelV2.VariantID.make("high"),
      })

      expect(result).toMatchObject({
        agent: "research",
        model: { providerID: "research-provider", id: "research-model", variant: "high" },
        subtask: false,
        prompt: { text: "Direct src [command-hook]" },
      })
    }),
  )

  it.effect("expands a subtask command and applies the command hook before admission", () =>
    Effect.gen(function* () {
      shellCalls.length = 0
      const expansion = yield* SessionPromptExpansion.Service
      const result = yield* expansion.command({
        session,
        messageID: SessionMessage.ID.make("msg_prompt_expansion"),
        command: "review",
        arguments: '"src one" tests extra',
      })

      expect(shellCalls).toEqual(["status"])
      expect(result).toMatchObject({
        agent: "build",
        model: { providerID: "test-provider", id: "test-model" },
        subtask: true,
      })
      expect(result.prompt.text).toBe("Review src one and tests extra [status] @package.json @research [command-hook]")
      expect(result.prompt.files?.map((file) => file.name)).toEqual(["package.json"])
      expect(result.prompt.agents?.map((agent) => agent.name)).toEqual(["research"])
    }),
  )

  it.effect("fails commands whose selected agent cannot be resolved", () =>
    Effect.gen(function* () {
      const expansion = yield* SessionPromptExpansion.Service
      const failure = yield* expansion
        .command({
          session,
          messageID: SessionMessage.ID.make("msg_missing_agent"),
          command: "bad-agent",
          arguments: "",
        })
        .pipe(Effect.flip)

      expect(failure).toMatchObject({
        _tag: "SessionPromptExpansion.AgentNotFound",
        agent: "ghost",
        available: ["build", "research"],
      })
    }),
  )

  it.effect("fails unresolved commands before producing a prompt", () =>
    Effect.gen(function* () {
      const expansion = yield* SessionPromptExpansion.Service
      const failure = yield* expansion
        .command({
          session,
          messageID: SessionMessage.ID.make("msg_missing_command"),
          command: "missing",
          arguments: "",
        })
        .pipe(Effect.flip)

      expect(failure).toMatchObject({
        _tag: "SessionPromptExpansion.CommandNotFound",
        command: "missing",
      })
    }),
  )
})
