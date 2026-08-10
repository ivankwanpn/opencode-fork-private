import { describe, expect } from "bun:test"
import path from "path"
import { pathToFileURL } from "url"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Location } from "@opencode-ai/core/location"
import { LocationMutation } from "@opencode-ai/core/location-mutation"
import { LSP } from "@opencode-ai/core/lsp/lsp"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { LSPTool } from "@opencode-ai/core/tool/lsp"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { ToolOutputStore } from "@opencode-ai/core/tool-output-store"
import { location } from "./fixture/location"
import { testEffect } from "./lib/effect"
import { executeTool, settleTool, toolDefinitions, toolIdentity } from "./lib/tool"

const directory = AbsolutePath.make(path.resolve(import.meta.dir, ".."))
const file = path.join(directory, "package.json")
const sessionID = SessionV2.ID.make("ses_lsp_tool_test")
const assertions: PermissionV2.AssertInput[] = []
const invocations: Array<{ readonly operation: string; readonly input: unknown }> = []
let external = false
let available = true
let denyAction: string | undefined

const permission = Layer.succeed(
  PermissionV2.Service,
  PermissionV2.Service.of({
    assert: (input) =>
      Effect.sync(() => assertions.push(input)).pipe(
        Effect.andThen(
          input.action === denyAction
            ? Effect.fail(new PermissionV2.BlockedError({ rules: [] }))
            : Effect.void,
        ),
      ),
    ask: () => Effect.die("unused"),
    reply: () => Effect.die("unused"),
    get: () => Effect.die("unused"),
    forSession: () => Effect.die("unused"),
    list: () => Effect.die("unused"),
  }),
)

const mutation = Layer.succeed(
  LocationMutation.Service,
  LocationMutation.Service.of({
    resolve: () =>
      Effect.succeed({
        canonical: file,
        resource: external ? file.replaceAll("\\", "/") : "package.json",
        externalDirectory: external
          ? {
              action: "external_directory" as const,
              directory: path.dirname(file),
              resource: path.join(path.dirname(file), "*").replaceAll("\\", "/"),
              save: path.join(path.dirname(file), "*").replaceAll("\\", "/"),
            }
          : undefined,
      }),
  }),
)

const record = <T>(operation: string, input: unknown, result: T) =>
  Effect.sync(() => {
    invocations.push({ operation, input })
    return result
  })

const lsp = Layer.succeed(
  LSP.Service,
  LSP.Service.of({
    init: () => Effect.void,
    status: () => Effect.succeed([]),
    hasClients: () => Effect.succeed(available),
    touchFile: (input, diagnostics) => record("touchFile", { input, diagnostics }, undefined).pipe(Effect.asVoid),
    diagnostics: () => Effect.succeed({}),
    hover: (input) => record("hover", input, []),
    definition: (input) => record("goToDefinition", input, [{ uri: "file:///definition.ts" }]),
    references: (input) => record("findReferences", input, []),
    implementation: (input) => record("goToImplementation", input, []),
    documentSymbol: (input) => record("documentSymbol", input, []),
    workspaceSymbol: (input) => record("workspaceSymbol", input, []),
    prepareCallHierarchy: (input) => record("prepareCallHierarchy", input, []),
    incomingCalls: (input) => record("incomingCalls", input, []),
    outgoingCalls: (input) => record("outgoingCalls", input, []),
  }),
)

const activeLocation = Layer.succeed(
  Location.Service,
  Location.Service.of(location(Location.Ref.make({ directory }))),
)

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([ToolRegistry.node, ToolRegistry.toolsNode, LSPTool.node]), [
    [LSP.node, lsp],
    [PermissionV2.node, permission],
    [LocationMutation.node, mutation],
    [Location.node, activeLocation],
    [ToolOutputStore.node, ToolOutputStore.nodeWithoutConfig],
  ]),
)

const call = (operation: typeof LSPTool.Input.Type["operation"], id: string = operation, query?: string) => ({
  sessionID,
  ...toolIdentity,
  call: {
    type: "tool-call" as const,
    id: `call-lsp-${id}`,
    name: LSPTool.name,
    input: { operation, filePath: "package.json", line: 3, character: 7, query },
  },
})

const reset = () => {
  assertions.length = 0
  invocations.length = 0
  external = false
  available = true
  denyAction = undefined
}

describe("LSPTool", () => {
  it.effect("registers and dispatches all operations with V1 cursor and title semantics", () =>
    Effect.gen(function* () {
      reset()
      const registry = yield* ToolRegistry.Service
      expect((yield* toolDefinitions(registry)).map((tool) => tool.name)).toEqual([LSPTool.name])

      const operations = [
        "goToDefinition",
        "findReferences",
        "hover",
        "documentSymbol",
        "workspaceSymbol",
        "goToImplementation",
        "prepareCallHierarchy",
        "incomingCalls",
        "outgoingCalls",
      ] as const
      for (const operation of operations) {
        const settlement = yield* settleTool(registry, call(operation, operation, "Needle"))
        const detail =
          operation === "workspaceSymbol"
            ? ""
            : operation === "documentSymbol"
              ? "package.json"
              : "package.json:3:7"
        expect(settlement.output?.structured).toMatchObject({
          title: detail ? `${operation} ${detail}` : operation,
        })
      }

      const dispatched = invocations.filter((item) => item.operation !== "touchFile")
      expect(dispatched.map((item) => item.operation)).toEqual([...operations])
      expect(dispatched[0]).toEqual({
        operation: "goToDefinition",
        input: { file, line: 2, character: 6 },
      })
      expect(dispatched[3]).toMatchObject({ operation: "documentSymbol", input: pathToFileURL(file).href })
      expect(dispatched[4]).toEqual({ operation: "workspaceSymbol", input: "Needle" })
      expect(
        assertions
          .filter((input) => input.action === "lsp")
          .map((input) => input.metadata)
          .slice(0, 5),
      ).toEqual([
        { operation: "goToDefinition", filePath: file, line: 3, character: 7 },
        { operation: "findReferences", filePath: file, line: 3, character: 7 },
        { operation: "hover", filePath: file, line: 3, character: 7 },
        { operation: "documentSymbol", filePath: file },
        { operation: "workspaceSymbol" },
      ])
    }),
  )

  it.effect("requires external-directory approval before LSP approval", () =>
    Effect.gen(function* () {
      reset()
      external = true
      const registry = yield* ToolRegistry.Service

      yield* executeTool(registry, call("hover"))
      expect(assertions.map((input) => input.action)).toEqual(["external_directory", "lsp"])
    }),
  )

  it.effect("does not touch the server when permission is denied or no server is available", () =>
    Effect.gen(function* () {
      reset()
      const registry = yield* ToolRegistry.Service
      denyAction = "lsp"
      expect(yield* executeTool(registry, call("hover", "denied"))).toEqual({
        type: "error",
        value: "Permission denied: lsp",
      })
      expect(invocations).toEqual([])

      reset()
      available = false
      expect(yield* executeTool(registry, call("hover", "unavailable"))).toEqual({
        type: "error",
        value: "No LSP server available for this file type.",
      })
      expect(invocations).toEqual([])
    }),
  )
})
