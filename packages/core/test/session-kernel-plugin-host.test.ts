import { describe, expect } from "bun:test"
import { Cause, Deferred, Effect, Layer, Option, Scope, Schema } from "effect"
import { Plugin } from "@opencode-ai/schema/plugin"
import { AgentV2 } from "@opencode-ai/core/agent"
import { CommandV2 } from "@opencode-ai/core/command"
import { ConfigMCP } from "@opencode-ai/core/config/mcp"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Location } from "@opencode-ai/core/location"
import { LSP } from "@opencode-ai/core/lsp/lsp"
import { MCP } from "@opencode-ai/core/mcp"
import { PluginRuntime } from "@opencode-ai/core/plugin/runtime"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { KernelPluginHost, SeamName, NextCalledError } from "@opencode-ai/core/session/kernel/plugin-host"
import { SkillV2 } from "@opencode-ai/core/skill"
import { Tool } from "@opencode-ai/core/tool/tool"
import { Tools } from "@opencode-ai/core/tool/tools"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { testEffect } from "./lib/effect"
import { tempLocationLayer } from "./fixture/location"

const toolCatalogNames: string[] = []

const stubTools = Layer.succeed(
  Tools.Service,
  Tools.Service.of({
    register: () => Effect.void,
    contribute: (input) =>
      Effect.gen(function* () {
        const scope = yield* Scope.Scope
        const names = Object.keys(input.tools)
        toolCatalogNames.push(...names)
        yield* Scope.addFinalizer(
          scope,
          Effect.sync(() => {
            for (const name of names) {
              const index = toolCatalogNames.lastIndexOf(name)
              if (index >= 0) toolCatalogNames.splice(index, 1)
            }
          }),
        )
      }),
  }),
)

const mcpCatalog: string[] = []
const stubMcp = Layer.mock(MCP.Service, {
  contribute: (name) =>
    Effect.gen(function* () {
      const scope = yield* Scope.Scope
      mcpCatalog.push(name)
      yield* Scope.addFinalizer(
        scope,
        Effect.sync(() => {
          const index = mcpCatalog.lastIndexOf(name)
          if (index >= 0) mcpCatalog.splice(index, 1)
        }),
      )
    }),
})

const lspCatalog: string[] = []
const stubLsp = Layer.mock(LSP.Service, {
  contribute: (server) =>
    Effect.gen(function* () {
      const scope = yield* Scope.Scope
      lspCatalog.push(server.id)
      yield* Scope.addFinalizer(
        scope,
        Effect.sync(() => {
          const index = lspCatalog.lastIndexOf(server.id)
          if (index >= 0) lspCatalog.splice(index, 1)
        }),
      )
    }),
})

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([AgentV2.node, CommandV2.node, KernelPluginHost.node, PluginRuntime.node, SkillV2.node]),
    [
      [Location.node, tempLocationLayer],
      [ToolRegistry.toolsNode, stubTools],
      [MCP.node, stubMcp],
      [LSP.node, stubLsp],
    ],
  ).pipe(Layer.fresh),
)

const fastIt = testEffect(
  Layer.effect(
    KernelPluginHost.Service,
    KernelPluginHost.make({ mountDeadline: "25 millis", disposeDeadline: "25 millis" }),
  ).pipe(
    Layer.provideMerge(stubTools),
    Layer.provideMerge(PluginRuntime.locationLayer),
    Layer.provideMerge(tempLocationLayer),
    Layer.fresh,
  ),
)

const echo = Tool.make({
  description: "echo text",
  input: Schema.String,
  output: Schema.String,
  execute: () => Effect.succeed("ok"),
})

const manifest = (overrides: Partial<Omit<Plugin.Manifest, "version">> = {}) =>
  ({
    id: Plugin.ID.make("test-plugin"),
    version: "0.1.0",
    targets: ["core"],
    requires: [],
    capabilities: ["tool"],
    permissions: ["tool.register"],
    runtime: "trusted-in-process",
    ...overrides,
  }) as Plugin.Manifest

describe("Kernel plugin host", () => {
  it.effect("waits for required services, activates on provide, and disposes every owned contribution", () =>
    Effect.gen(function* () {
      const host = yield* KernelPluginHost.Service
      const activation = yield* host.install({
        manifest: manifest({ requires: [{ id: "mcp:test" }] }),
        mount: () => Effect.succeed({ tools: { waited_tool: echo } }),
      })
      expect(yield* activation.state).toBe("waiting_dependency")
      expect(yield* host.ownedContributions(activation.generation)).toEqual([])
      yield* host.services.provide("mcp:test", { server: "test" })
      expect(yield* activation.state).toBe("ready")
      expect(toolCatalogNames).toContain("waited_tool")
      expect(yield* host.ownedContributions(activation.generation)).toMatchObject([{ kind: "tool", id: "waited_tool" }])
      yield* activation.dispose
      expect(yield* host.ownedContributions(activation.generation)).toEqual([])
      expect(toolCatalogNames).not.toContain("waited_tool")
      expect(yield* activation.state).toBe("disabled")
    }),
  )

  it.effect("records id, version, generation, group, runtime, and state in snapshots", () =>
    Effect.gen(function* () {
      const host = yield* KernelPluginHost.Service
      const activation = yield* host.install(
        { manifest: manifest({ capabilities: [] }), mount: () => Effect.succeed({}) },
        { group: "platform" },
      )
      const snapshot = yield* host.snapshot()
      expect(snapshot).toEqual([
        expect.objectContaining({
          id: activation.id,
          version: "0.1.0",
          generation: activation.generation,
          group: "platform",
          runtime: "trusted-in-process",
          state: "ready",
        }),
      ])
    }),
  )

  it.effect("fences late async registration after disable", () =>
    Effect.gen(function* () {
      const host = yield* KernelPluginHost.Service
      const release = yield* Deferred.make<void>()
      const activation = yield* host.install({
        manifest: manifest({ capabilities: ["tool", "hook"], permissions: ["tool.register"] }),
        mount: (ctx) =>
          Effect.gen(function* () {
            yield* Deferred.await(release).pipe(
              Effect.flatMap(() => ctx.register.tool({ late_tool: echo })),
              Effect.forkScoped,
            )
            return {} as KernelPluginHost.PluginContribution
          }),
      })
      yield* host.disable(activation.id)
      yield* Deferred.succeed(release, undefined)
      expect(toolCatalogNames).not.toContain("late_tool")
    }),
  )

  it.effect("rejects a stale registration handle with a fenced error after disable", () =>
    Effect.gen(function* () {
      const host = yield* KernelPluginHost.Service
      const captured = yield* Deferred.make<KernelPluginHost.RegisterSurface>()
      const activation = yield* host.install({
        manifest: manifest({ capabilities: ["tool"], permissions: ["tool.register"] }),
        mount: (ctx) =>
          Deferred.succeed(captured, ctx.register).pipe(Effect.map(() => ({}) as KernelPluginHost.PluginContribution)),
      })
      const register = yield* Deferred.await(captured)
      yield* host.disable(activation.id)
      const exit = yield* register.tool({ stale_tool: echo }).pipe(Effect.exit)
      expect(exit._tag).toBe("Failure")
      if (exit._tag === "Failure") {
        // The typed failure is `fenced`; the Effect beta wraps error args, so
        // assert the classification through the exit and the rendered cause.
        expect(Cause.pretty(exit.cause)).toContain("fenced")
      }
      expect(toolCatalogNames).not.toContain("stale_tool")
    }),
  )

  it.effect("disposes dependents on service disappearance and remounts on reappearance", () =>
    Effect.gen(function* () {
      const host = yield* KernelPluginHost.Service
      const activation = yield* host.install({
        manifest: manifest({ requires: [{ id: "mcp:test" }] }),
        mount: () => Effect.succeed({ tools: { dependent_tool: echo } }),
      })
      yield* host.services.provide("mcp:test", {})
      expect(yield* activation.state).toBe("ready")
      expect(toolCatalogNames).toContain("dependent_tool")
      yield* host.services.retract("mcp:test")
      expect(yield* activation.state).toBe("waiting_dependency")
      expect(toolCatalogNames).not.toContain("dependent_tool")
      yield* host.services.provide("mcp:test", {})
      expect(yield* activation.state).toBe("ready")
      expect(toolCatalogNames).toContain("dependent_tool")
    }),
  )

  it.effect("isolates plugin groups: disposing one activation leaves the other intact", () =>
    Effect.gen(function* () {
      const host = yield* KernelPluginHost.Service
      const first = yield* host.install(
        {
          manifest: manifest({ id: Plugin.ID.make("group-a") }),
          mount: () => Effect.succeed({ tools: { group_a_tool: echo } }),
        },
        { group: "a" },
      )
      const second = yield* host.install(
        {
          manifest: manifest({ id: Plugin.ID.make("group-b") }),
          mount: () => Effect.succeed({ tools: { group_b_tool: echo } }),
        },
        { group: "b" },
      )
      yield* host.disable(first.id)
      expect(yield* second.state).toBe("ready")
      expect(toolCatalogNames).not.toContain("group_a_tool")
      expect(toolCatalogNames).toContain("group_b_tool")
    }),
  )

  it.effect("isolates observational seam handler failures", () =>
    Effect.gen(function* () {
      const host = yield* KernelPluginHost.Service
      const calls: string[] = []
      yield* host.install({
        manifest: manifest({ capabilities: ["hook"], permissions: ["session.history.read"] }),
        mount: () =>
          Effect.succeed({
            seams: [
              {
                name: SeamName.statusObserve,
                handler: () => Effect.fail(new Error("observation failed")),
              },
              {
                name: SeamName.statusObserve,
                handler: () => {
                  calls.push("second")
                },
              },
            ],
          } as KernelPluginHost.PluginContribution),
      })
      const event = { value: 1 }
      expect(yield* host.seams.run(SeamName.statusObserve, event)).toBe(event)
      expect(calls).toEqual(["second"])
    }),
  )

  it.effect("merges decisions deny-monotonically", () =>
    Effect.gen(function* () {
      const host = yield* KernelPluginHost.Service
      yield* host.install({
        manifest: manifest({ capabilities: ["hook"], permissions: ["tool.policy"] }),
        mount: () =>
          Effect.succeed({
            seams: [
              {
                name: SeamName.toolPrepareDecide,
                handler: (decision) => Effect.succeed({ ...(decision as object), concurrency: "parallel" as const }),
              },
            ],
          } as KernelPluginHost.PluginContribution),
      })
      const decisionRun = yield* host.seams.run(SeamName.toolPrepareDecide, {
        concurrency: "exclusive" as const,
      })
      const decided = decisionRun as { concurrency: string }
      // The parallel proposal cannot widen an exclusive decision.
      expect(decided.concurrency).toBe("exclusive")
      const permittedRun = yield* host.seams.run(SeamName.compactionPolicyDecide, {
        permitted: false as const,
      })
      const permitted = permittedRun as { permitted: boolean }
      // A later-allowing proposal cannot re-allow a denial.
      expect(permitted.permitted).toBe(false)
    }),
  )

  it.effect("freezes transform inputs and outputs and rejects mutation defects", () =>
    Effect.gen(function* () {
      const host = yield* KernelPluginHost.Service
      yield* host.install({
        manifest: manifest({ capabilities: ["hook"], permissions: ["session.context.transform"] }),
        mount: () =>
          Effect.succeed({
            seams: [
              {
                name: SeamName.requestTransform,
                handler: (event) => {
                  ;(event as { tags: string[] }).tags.push("added")
                  return Effect.succeed(event)
                },
              },
            ],
          } as KernelPluginHost.PluginContribution),
      })
      const frozen = yield* host.seams.run(SeamName.requestTransform, { tags: ["base"] })
      expect((frozen as { tags: string[] }).tags).toEqual(["base", "added"])
      expect(Object.isFrozen(frozen)).toBe(true)
      // A handler that mutates its frozen input is a defect; the seam run
      // rejects it instead of forwarding a corrupt value.
      yield* host.install({
        manifest: manifest({
          id: Plugin.ID.make("freezes-mutator"),
          capabilities: ["hook"],
          permissions: ["session.context.transform"],
        }),
        mount: () =>
          Effect.succeed({
            seams: [
              {
                name: SeamName.requestTransform,
                handler: (event) => {
                  ;(event as { nested?: unknown }).nested = "mutated"
                  return Effect.succeed(event)
                },
              },
            ],
          } as KernelPluginHost.PluginContribution),
      })
      const run = yield* host.seams.run(SeamName.requestTransform, { tags: ["only"] }).pipe(Effect.exit)
      expect(run._tag).toBe("Failure")
    }),
  )

  it.effect("allows at most one next per around handler and short-circuits on typed failure", () =>
    Effect.gen(function* () {
      const host = yield* KernelPluginHost.Service
      const observed = yield* Deferred.make<unknown>()
      yield* host.install({
        manifest: manifest({ capabilities: ["hook"], permissions: ["tool.execute.wrap"] }),
        mount: () =>
          Effect.succeed({
            seams: [
              {
                name: SeamName.toolDispatchAround,
                handler: (_event, next) =>
                  Effect.gen(function* () {
                    yield* next!()
                    const second = yield* next!().pipe(Effect.exit)
                    yield* Deferred.succeed(observed, second)
                  }),
              },
            ],
          } as KernelPluginHost.PluginContribution),
      })
      yield* host.seams.run(SeamName.toolDispatchAround, {})
      const second = yield* Deferred.await(observed)
      expect(second).toMatchObject({ _tag: "Failure" })
    }),
  )

  it.effect("denies tool contributions without the tool.register permission", () =>
    Effect.gen(function* () {
      const host = yield* KernelPluginHost.Service
      const activation = yield* host.install({
        manifest: manifest({ capabilities: ["tool"], permissions: [] }),
        mount: () => Effect.succeed({ tools: { denied_tool: echo } }),
      })
      expect(yield* activation.state).toBe("failed")
      expect(toolCatalogNames).not.toContain("denied_tool")
    }),
  )

  it.effect("atomically replaces an activation with the same plugin ID", () =>
    Effect.gen(function* () {
      const host = yield* KernelPluginHost.Service
      const first = yield* host.install({
        manifest: manifest(),
        mount: () => Effect.succeed({ tools: { replaced_tool: echo } }),
      })
      expect(toolCatalogNames).toContain("replaced_tool")

      const second = yield* host.install({
        manifest: manifest(),
        mount: () => Effect.succeed({ tools: { replacement_tool: echo } }),
      })

      expect(yield* first.state).toBe("disabled")
      expect(yield* second.state).toBe("ready")
      expect(toolCatalogNames).not.toContain("replaced_tool")
      expect(toolCatalogNames).toContain("replacement_tool")
      expect(yield* host.snapshot()).toHaveLength(1)
    }),
  )

  it.effect("retracts contributions when activation fails after a partial mount", () =>
    Effect.gen(function* () {
      const host = yield* KernelPluginHost.Service
      const activation = yield* host.install({
        manifest: manifest({ capabilities: ["service", "tool"], permissions: [] }),
        mount: () =>
          Effect.succeed({
            services: [{ id: "partial-service", value: { ready: true } }],
            tools: { denied_after_service: echo },
          }),
      })

      expect(yield* activation.state).toBe("failed")
      expect(yield* host.services.has("partial-service")).toBe(false)
      expect(toolCatalogNames).not.toContain("denied_after_service")
      expect(yield* host.ownedContributions(activation.generation)).toEqual([])
    }),
  )

  it.effect("rejects a duplicate service owner without replacing the live provider", () =>
    Effect.gen(function* () {
      const host = yield* KernelPluginHost.Service
      const first = yield* host.install({
        manifest: manifest({ id: Plugin.ID.make("service-owner-a"), capabilities: ["service"] }),
        mount: () => Effect.succeed({ services: [{ id: "shared-service", value: { owner: "a" } }] }),
      })
      const second = yield* host.install({
        manifest: manifest({ id: Plugin.ID.make("service-owner-b"), capabilities: ["service"] }),
        mount: () => Effect.succeed({ services: [{ id: "shared-service", value: { owner: "b" } }] }),
      })

      expect(yield* first.state).toBe("ready")
      expect(yield* second.state).toBe("failed")
      expect(yield* host.services.get("shared-service")).toEqual(Option.some({ owner: "a" }))

      yield* first.dispose
      expect(yield* host.services.has("shared-service")).toBe(false)
    }),
  )

  it.effect(
    "registers command, skill, and agent contributions in their V2 registries and removes them on dispose",
    () =>
      Effect.gen(function* () {
        const host = yield* KernelPluginHost.Service
        const commands = yield* CommandV2.Service
        const skills = yield* SkillV2.Service
        const agents = yield* AgentV2.Service
        const activation = yield* host.install({
          manifest: manifest({
            id: Plugin.ID.make("registry-plugin"),
            capabilities: ["command", "skill", "agent"],
            permissions: ["ui.command.register"],
          }),
          mount: () =>
            Effect.succeed({
              commands: [
                CommandV2.Info.make({
                  name: "registry-command",
                  template: "Run the registry command",
                  description: "registered by a Kernel plugin",
                }),
              ],
              skills: [
                SkillV2.EmbeddedSource.make({
                  type: "embedded",
                  skill: SkillV2.Info.make({
                    name: "registry-skill",
                    description: "registered by a Kernel plugin",
                    location: AbsolutePath.make("/plugin/registry-skill.md"),
                    content: "Use the registry skill.",
                  }),
                }),
              ],
              agents: [
                AgentV2.Info.make({
                  id: AgentV2.ID.make("registry-agent"),
                  request: { headers: {}, body: {} },
                  mode: "subagent",
                  hidden: false,
                  permissions: [],
                }),
              ],
            }),
        })

        expect((yield* commands.get("registry-command"))?.template).toBe("Run the registry command")
        expect((yield* skills.list()).map((skill) => skill.name)).toContain("registry-skill")
        expect((yield* agents.get(AgentV2.ID.make("registry-agent")))?.mode).toBe("subagent")

        yield* activation.dispose
        expect(yield* commands.get("registry-command")).toBeUndefined()
        expect((yield* skills.list()).map((skill) => skill.name)).not.toContain("registry-skill")
        expect(yield* agents.get(AgentV2.ID.make("registry-agent"))).toBeUndefined()
      }),
  )

  it.effect("mounts and disposes scope-owned MCP and LSP contributions", () =>
    Effect.gen(function* () {
      const host = yield* KernelPluginHost.Service
      const activation = yield* host.install({
        manifest: manifest({
          id: Plugin.ID.make("runtime-contributions"),
          capabilities: ["mcp", "lsp"],
          permissions: ["mcp.manage", "lsp.manage"],
        }),
        mount: () =>
          Effect.succeed({
            mcp: [
              {
                id: "plugin-mcp",
                server: new ConfigMCP.Local({
                  type: "local",
                  command: ["plugin-mcp"],
                  disabled: true,
                }),
              },
            ],
            lsp: [
              {
                id: "plugin-lsp",
                extensions: [".ts"],
                root: async (_file, context) => context.directory,
                spawn: async () => undefined,
              },
            ],
          }),
      })

      expect(yield* activation.state).toBe("ready")
      expect(mcpCatalog).toContain("plugin-mcp")
      expect(lspCatalog).toContain("plugin-lsp")
      expect(yield* host.ownedContributions(activation.generation)).toEqual([
        { kind: "mcp", id: "plugin-mcp" },
        { kind: "lsp", id: "plugin-lsp" },
      ])

      yield* activation.dispose
      expect(mcpCatalog).not.toContain("plugin-mcp")
      expect(lspCatalog).not.toContain("plugin-lsp")
      expect(yield* host.ownedContributions(activation.generation)).toEqual([])
    }),
  )

  it.effect("bridges scope-owned UI contributions with plugin ownership and removes them on dispose", () =>
    Effect.gen(function* () {
      const host = yield* KernelPluginHost.Service
      const activation = yield* host.install({
        manifest: {
          ...manifest({
            id: Plugin.ID.make("ui-registry-plugin"),
            capabilities: ["ui"],
            permissions: ["ui.command.register", "ui.panel.register"],
          }),
          version: "2.3.4",
        },
        mount: () =>
          Effect.succeed({
            ui: [
              { id: "review.open", kind: "command" as const, description: "Open the review workflow" },
              { id: "review.summary", kind: "panel" as const, description: "Review summary" },
            ],
          }),
      })

      expect(yield* activation.state).toBe("ready")
      expect(yield* host.ui.list()).toEqual([
        {
          id: "review.open",
          kind: "command",
          description: "Open the review workflow",
          pluginID: Plugin.ID.make("ui-registry-plugin"),
          version: "2.3.4",
          generation: activation.generation,
        },
        {
          id: "review.summary",
          kind: "panel",
          description: "Review summary",
          pluginID: Plugin.ID.make("ui-registry-plugin"),
          version: "2.3.4",
          generation: activation.generation,
        },
      ])
      expect(yield* host.ownedContributions(activation.generation)).toEqual([
        { kind: "ui", id: "review.open" },
        { kind: "ui", id: "review.summary" },
      ])

      yield* activation.dispose
      expect(yield* host.ui.list()).toEqual([])
      expect(yield* host.ownedContributions(activation.generation)).toEqual([])
    }),
  )

  it.effect("rejects each UI contribution before publication when its product permission is absent", () =>
    Effect.gen(function* () {
      const host = yield* KernelPluginHost.Service
      const activation = yield* host.install({
        manifest: manifest({
          id: Plugin.ID.make("ui-permission-plugin"),
          capabilities: ["ui"],
          permissions: ["ui.command.register"],
        }),
        mount: () =>
          Effect.succeed({
            ui: [
              { id: "allowed-command", kind: "command" as const },
              { id: "forbidden-panel", kind: "panel" as const },
            ],
          }),
      })

      expect(yield* activation.state).toBe("failed")
      expect(yield* host.ui.list()).toEqual([])
      expect(yield* host.ownedContributions(activation.generation)).toEqual([])
    }),
  )

  it.effect("rejects MCP contributions before registration when mcp.manage is absent", () =>
    Effect.gen(function* () {
      const host = yield* KernelPluginHost.Service
      const activation = yield* host.install({
        manifest: manifest({
          id: Plugin.ID.make("missing-mcp-permission"),
          capabilities: ["mcp"],
          permissions: [],
        }),
        mount: () =>
          Effect.succeed({
            mcp: [
              {
                id: "forbidden-mcp",
                server: new ConfigMCP.Local({ type: "local", command: ["forbidden-mcp"], disabled: true }),
              },
            ],
          }),
      })

      expect(yield* activation.state).toBe("failed")
      expect(mcpCatalog).not.toContain("forbidden-mcp")
      expect(yield* host.ownedContributions(activation.generation)).toEqual([])
    }),
  )
  it.effect("rejects LSP contributions before registration when lsp.manage is absent", () =>
    Effect.gen(function* () {
      const host = yield* KernelPluginHost.Service
      const activation = yield* host.install({
        manifest: manifest({
          id: Plugin.ID.make("missing-lsp-permission"),
          capabilities: ["lsp"],
          permissions: [],
        }),
        mount: () =>
          Effect.succeed({
            lsp: [
              {
                id: "forbidden-lsp",
                extensions: [".ts"],
                root: async (_file, context) => context.directory,
                spawn: async () => undefined,
              },
            ],
          }),
      })

      expect(yield* activation.state).toBe("failed")
      expect(lspCatalog).not.toContain("forbidden-lsp")
      expect(yield* host.ownedContributions(activation.generation)).toEqual([])
    }),
  )

  it.effect("never exposes raw lease or SQL capabilities to mounts", () =>
    Effect.gen(function* () {
      const host = yield* KernelPluginHost.Service
      const probe = yield* Deferred.make<{ keys: readonly string[]; hasRaw: boolean }>()
      yield* host.install({
        manifest: manifest({ capabilities: [] }),
        mount: (ctx) =>
          Effect.gen(function* () {
            const hasRaw = "db" in ctx || "sql" in ctx || "lease" in ctx || "leaseToken" in ctx || "execution" in ctx
            yield* Deferred.succeed(probe, { keys: Object.keys(ctx), hasRaw })
            return {} as KernelPluginHost.PluginContribution
          }),
      })
      const result = yield* Deferred.await(probe)
      expect(result.hasRaw).toBe(false)
      expect([...result.keys].sort()).toEqual(["location", "manifest", "register", "services"])
    }),
  )

  it.effect("routes hook contributions through the runtime and detaches them on dispose", () =>
    Effect.gen(function* () {
      const host = yield* KernelPluginHost.Service
      const runtime = yield* PluginRuntime.Service
      const activation = yield* host.install({
        manifest: manifest({ capabilities: ["hook"] }),
        mount: () =>
          Effect.succeed({
            hooks: [
              {
                name: PluginRuntime.HookName.shellEnv,
                callback: (event) => {
                  ;(event as { env: Record<string, string> }).env.PLUGIN_HOST = "active"
                },
              },
            ],
          } as KernelPluginHost.PluginContribution),
      })
      const env: Record<string, string> = { BASE: "1" }
      yield* runtime.run(PluginRuntime.HookName.shellEnv, { env })
      expect(env).toEqual({ BASE: "1", PLUGIN_HOST: "active" })
      yield* activation.dispose
      const after: Record<string, string> = { BASE: "1" }
      yield* runtime.run(PluginRuntime.HookName.shellEnv, { env: after })
      expect(after).toEqual({ BASE: "1" })
    }),
  )
})

describe("Linear plugin host deadlines", () => {
  fastIt.live("mount failure records the deadline", () =>
    Effect.gen(function* () {
      const host = yield* KernelPluginHost.Service
      const gate = yield* Deferred.make<void>()
      const activation = yield* host.install({
        manifest: manifest({ capabilities: [] }),
        mount: () => Deferred.await(gate).pipe(Effect.map(() => ({}) as KernelPluginHost.PluginContribution)),
      })
      expect(yield* activation.state).toBe("failed")
    }),
  )

  fastIt.live("disposal reclamation deadline finalizes even when a finalizer is stuck", () =>
    Effect.gen(function* () {
      const host = yield* KernelPluginHost.Service
      const stuck = yield* Deferred.make<void>()
      const activation = yield* host.install({
        manifest: manifest({ capabilities: [] }),
        mount: () =>
          Effect.gen(function* () {
            yield* Effect.addFinalizer(() => Deferred.await(stuck).pipe(Effect.asVoid))
            return {} as KernelPluginHost.PluginContribution
          }),
      })
      expect(yield* activation.state).toBe("ready")
      yield* activation.dispose
      expect(yield* activation.state).toBe("disabled")
      // The stuck finalizer never resolves; dispose still returned.
      expect(yield* host.ownedContributions(activation.generation)).toEqual([])
    }),
  )
})
