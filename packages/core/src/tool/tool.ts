export * as Tool from "./tool"

import {
  ToolDefinition,
  ToolFailure,
  ToolOutput,
  type ToolCall,
  type ToolFileContent,
  type ToolTextContent,
} from "@opencode-ai/llm"
import { Effect, JsonSchema, Schema } from "effect"
import type { AgentV2 } from "../agent"
import type { PermissionV2 } from "../permission"
import type { SessionCommand } from "../session/command"
import type { SessionMessage } from "../session/message"
import type { SessionSchema } from "../session/schema"

export interface Context {
  readonly sessionID: SessionSchema.ID
  readonly agent: AgentV2.ID
  readonly assistantMessageID: SessionMessage.ID
  readonly toolCallID: string
}

export type SchemaType<A> = Schema.Codec<A, any, never, never>

declare const TypeId: unique symbol

export interface Definition<Input extends SchemaType<any>, Output extends SchemaType<any>> {
  readonly [TypeId]: {
    readonly _Input: Input
    readonly _Output: Output
  }
}

export type AnyTool = Definition<any, any>
export const Failure = ToolFailure
export type Failure = ToolFailure
export type ExecutionError = ToolFailure | PermissionV2.CorrectedError | SessionCommand.NotFoundError

export class RegistrationError extends Schema.TaggedErrorClass<RegistrationError>()("Tool.RegistrationError", {
  name: Schema.String,
  message: Schema.String,
}) {}

export type Content =
  | ToolTextContent
  | ToolFileContent
  | {
      readonly type: "file"
      readonly data: string
      readonly mime: string
      readonly name?: string
      readonly provenance?: ToolFileContent["provenance"]
    }

type Config<
  Input extends SchemaType<any>,
  Output extends SchemaType<any>,
  Structured extends SchemaType<any> = Output,
> = {
  readonly description: string
  /** Computes a permission-filtered model description, or hides the tool when no description is available. */
  readonly describe?: (permissions: PermissionV2.Ruleset) => string | undefined
  readonly input: Input
  readonly output: Output
  /** Raw protocol schemas for dynamic tools whose JSON Schema cannot be represented as an Effect Schema. */
  readonly jsonSchema?: {
    readonly input: JsonSchema.JsonSchema
    readonly output?: JsonSchema.JsonSchema
  }
  readonly structured?: Structured
  readonly toStructuredOutput?: (input: {
    readonly input: Schema.Schema.Type<Input>
    readonly output: Output["Encoded"]
  }) => Schema.Schema.Type<Structured>
  readonly execute: (
    input: Schema.Schema.Type<Input>,
    context: Context,
  ) => Effect.Effect<Schema.Schema.Type<Output>, ExecutionError>
  readonly toModelOutput?: (input: {
    readonly input: Schema.Schema.Type<Input>
    readonly output: Output["Encoded"]
  }) => ReadonlyArray<Content>
}

type Runtime = {
  readonly permission?: string
  readonly definition: (name: string, permissions: PermissionV2.Ruleset) => ToolDefinition | undefined
  readonly settle: (call: ToolCall, context: Context) => Effect.Effect<ToolOutput, ExecutionError>
}

const runtimes = new WeakMap<AnyTool, Runtime>()

export function make<
  Input extends SchemaType<any>,
  Output extends SchemaType<any>,
  Structured extends SchemaType<any> = Output,
>(config: Config<Input, Output, Structured>): Definition<Input, Structured> {
  const tool = Object.freeze({}) as Definition<Input, Structured>
  const definitions = new Map<string, ToolDefinition>()
  runtimes.set(tool, {
    definition: (name, permissions) => {
      const description = config.describe ? config.describe(permissions) : config.description
      if (description === undefined) return undefined
      const key = `${name}\u0000${description}`
      const cached = definitions.get(key)
      if (cached) return cached
      const definition = new ToolDefinition({
        name,
        description,
        inputSchema: config.jsonSchema?.input ?? toJsonSchema(config.input),
        outputSchema: config.jsonSchema ? config.jsonSchema.output : toJsonSchema(config.structured ?? config.output),
      })
      definitions.set(key, definition)
      return definition
    },
    settle: (call, context) =>
      Schema.decodeUnknownEffect(config.input)(call.input).pipe(
        Effect.mapError((error) => new ToolFailure({ message: `Invalid tool input: ${error.message}` })),
        Effect.flatMap((input) =>
          config.execute(input, context).pipe(
            Effect.flatMap((output) =>
              Schema.encodeEffect(config.output)(output).pipe(
                Effect.flatMap((output) => {
                  if (!config.structured || !config.toStructuredOutput)
                    return Effect.succeed({ output, structured: output })
                  return Schema.encodeEffect(config.structured)(config.toStructuredOutput({ input, output })).pipe(
                    Effect.map((structured) => ({ output, structured })),
                  )
                }),
                Effect.mapError(
                  (error) =>
                    new ToolFailure({
                      message: `Tool returned an invalid value for its output schema: ${error.message}`,
                    }),
                ),
              ),
            ),
            Effect.map(({ output, structured }) => ({
              structured,
              content:
                config.toModelOutput?.({ input, output }).map((part) =>
                  part.type === "text"
                    ? part
                    : {
                        type: "file" as const,
                        uri: "uri" in part ? part.uri : `data:${part.mime};base64,${part.data}`,
                        mime: part.mime,
                        name: part.name,
                        ...(part.provenance === undefined ? {} : { provenance: part.provenance }),
                      },
                ) ?? (typeof output === "string" ? [{ type: "text" as const, text: output }] : []),
            })),
          ),
        ),
      ),
  })
  return tool
}

export const validateName = (name: string) =>
  /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(name)
    ? Effect.void
    : Effect.fail(new RegistrationError({ name, message: `Invalid tool name: ${name}` }))

export const withPermission = <Input extends SchemaType<any>, Output extends SchemaType<any>>(
  tool: Definition<Input, Output>,
  permission: string,
) => {
  const decorated = Object.freeze({}) as Definition<Input, Output>
  runtimes.set(decorated, { ...runtimeOf(tool), permission })
  return decorated
}

export const permission = (tool: AnyTool, name: string) => runtimeOf(tool).permission ?? name
export const definition = (name: string, tool: AnyTool, permissions: PermissionV2.Ruleset = []) =>
  runtimeOf(tool).definition(name, permissions)
export const settle = (tool: AnyTool, call: ToolCall, context: Context) => runtimeOf(tool).settle(call, context)

function runtimeOf(tool: AnyTool) {
  const runtime = runtimes.get(tool)
  if (!runtime) throw new TypeError("Invalid Core Tool value")
  return runtime
}

function toJsonSchema(schema: Schema.Top): JsonSchema.JsonSchema {
  const document = Schema.toJsonSchemaDocument(schema)
  if (Object.keys(document.definitions).length === 0) return document.schema
  return { ...document.schema, $defs: document.definitions }
}
