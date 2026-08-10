export * as LSPTool from "./lsp"

import path from "path"
import { pathToFileURL } from "url"
import { ToolFailure } from "@opencode-ai/llm"
import { Effect, Layer, Schema } from "effect"
import { makeLocationNode } from "../effect/app-node"
import { FSUtil } from "../fs-util"
import { Location } from "../location"
import { LocationMutation } from "../location-mutation"
import { LSP } from "../lsp/lsp"
import { PermissionV2 } from "../permission"
import { ToolRegistry } from "./registry"
import { Tool } from "./tool"
import { Tools } from "./tools"

export const name = "lsp"

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

export const Input = Schema.Struct({
  operation: Schema.Literals(operations).annotate({ description: "The LSP operation to perform" }),
  filePath: Schema.String.annotate({ description: "The absolute or relative path to the file" }),
  line: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).annotate({
    description: "The line number (1-based, as shown in editors)",
  }),
  character: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).annotate({
    description: "The character offset (1-based, as shown in editors)",
  }),
  query: Schema.optional(Schema.String).annotate({
    description: "Search query for workspaceSymbol. Empty string requests all symbols.",
  }),
})

export const Output = Schema.Struct({
  title: Schema.String,
  metadata: Schema.Struct({ result: Schema.Array(Schema.Unknown) }),
  output: Schema.String,
})

export const description = `Interact with Language Server Protocol (LSP) servers to get code intelligence features.

Supported operations:
- goToDefinition: Find where a symbol is defined
- findReferences: Find all references to a symbol
- hover: Get hover information (documentation, type info) for a symbol
- documentSymbol: Get all symbols (functions, classes, variables) in a document
- workspaceSymbol: List project-wide symbols matching a query string
- goToImplementation: Find implementations of an interface or abstract method
- prepareCallHierarchy: Get call hierarchy item at a position (functions/methods)
- incomingCalls: Find all functions/methods that call the function at a position
- outgoingCalls: Find all functions/methods called by the function at a position

All operations require filePath, line, and character. Line and character are 1-based. workspaceSymbol also accepts a query string; filePath selects and starts the matching LSP server but is not sent in the workspace/symbol request.`

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const lsp = yield* LSP.Service
    const fs = yield* FSUtil.Service
    const location = yield* Location.Service
    const mutation = yield* LocationMutation.Service
    const permission = yield* PermissionV2.Service

    yield* tools
      .register({
        [name]: Tool.make({
          description,
          input: Input,
          output: Output,
          toModelOutput: ({ output }) => [{ type: "text", text: output.output }],
          execute: (input, context) =>
            Effect.gen(function* () {
              const source = {
                type: "tool" as const,
                messageID: context.assistantMessageID,
                callID: context.toolCallID,
              }
              const target = yield* mutation
                .resolve({ path: input.filePath, kind: "directory" })
                .pipe(Effect.mapError(() => new ToolFailure({ message: `File not found: ${input.filePath}` })))
              if (target.externalDirectory)
                yield* permission
                  .assert({
                    ...LocationMutation.externalDirectoryPermission(target.externalDirectory),
                    sessionID: context.sessionID,
                    agent: context.agent,
                    source,
                  })
                  .pipe(
                    Effect.mapError(
                      () => new ToolFailure({ message: `Permission denied: external_directory ${input.filePath}` }),
                    ),
                  )

              const file = target.canonical
              const metadata =
                input.operation === "workspaceSymbol"
                  ? { operation: input.operation }
                  : input.operation === "documentSymbol"
                    ? { operation: input.operation, filePath: file }
                    : {
                        operation: input.operation,
                        filePath: file,
                        line: input.line,
                        character: input.character,
                      }
              yield* permission
                .assert({
                  action: name,
                  resources: ["*"],
                  save: ["*"],
                  metadata,
                  sessionID: context.sessionID,
                  agent: context.agent,
                  source,
                })
                .pipe(Effect.mapError(() => new ToolFailure({ message: "Permission denied: lsp" })))

              const exists = yield* fs.existsSafe(file)
              if (!exists) return yield* new ToolFailure({ message: `File not found: ${file}` })
              const available = yield* lsp.hasClients(file)
              if (!available) return yield* new ToolFailure({ message: "No LSP server available for this file type." })

              yield* lsp.touchFile(file, "document")
              const uri = pathToFileURL(file).href
              const position = { file, line: input.line - 1, character: input.character - 1 }
              const result: unknown[] = yield* (() => {
                switch (input.operation) {
                  case "goToDefinition":
                    return lsp.definition(position)
                  case "findReferences":
                    return lsp.references(position)
                  case "hover":
                    return lsp.hover(position)
                  case "documentSymbol":
                    return lsp.documentSymbol(uri)
                  case "workspaceSymbol":
                    return lsp.workspaceSymbol(input.query ?? "")
                  case "goToImplementation":
                    return lsp.implementation(position)
                  case "prepareCallHierarchy":
                    return lsp.prepareCallHierarchy(position)
                  case "incomingCalls":
                    return lsp.incomingCalls(position)
                  case "outgoingCalls":
                    return lsp.outgoingCalls(position)
                }
              })()

              const relative = path.relative(location.project.directory, file)
              const detail =
                input.operation === "workspaceSymbol"
                  ? ""
                  : input.operation === "documentSymbol"
                    ? relative
                    : `${relative}:${input.line}:${input.character}`
              return {
                title: detail ? `${input.operation} ${detail}` : input.operation,
                metadata: { result },
                output:
                  result.length === 0 ? `No results found for ${input.operation}` : JSON.stringify(result, null, 2),
              }
            }).pipe(
              Effect.mapError((error) =>
                error instanceof ToolFailure
                  ? error
                  : new ToolFailure({ message: `Unable to run ${input.operation}`, error }),
              ),
            ),
        }),
      })
      .pipe(Effect.orDie)
  }),
)

export const node = makeLocationNode({
  name: "tool/lsp",
  layer,
  deps: [ToolRegistry.node, LSP.node, FSUtil.node, Location.node, LocationMutation.node, PermissionV2.node],
})
