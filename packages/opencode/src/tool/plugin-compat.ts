import type { JSONSchema7, JSONSchema7Definition } from "@ai-sdk/provider"
import type { JsonSchemaType } from "@modelcontextprotocol/sdk/validation"
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv"
import type { ToolDefinition } from "@opencode-ai/plugin"
import { Glob } from "@opencode-ai/core/util/glob"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Context, Effect, Layer, Option, Schema, SchemaIssue } from "effect"
import path from "path"
import { pathToFileURL } from "url"
import z from "zod"
import { Config } from "@/config/config"
import { InstanceState } from "@/effect/instance-state"
import { Plugin } from "@/plugin"
import { errorMessage } from "@/util/error"

export type Definition = Omit<ToolDefinition, "args"> & {
  readonly args?: ToolDefinition["args"] | null
}

export interface Contribution {
  readonly id: string
  readonly description: string
  readonly parameters: Schema.Codec<unknown, unknown, never, never>
  readonly jsonSchema: JSONSchema7
  readonly definition: Definition
}

export interface Interface {
  readonly list: () => Effect.Effect<ReadonlyArray<Contribution>>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/PluginToolCompat") {}

const discover = Effect.fn("PluginToolCompat.discover")(function* (config: Config.Interface, plugin: Plugin.Interface) {
  const contributions: Contribution[] = []
  const directories = yield* config.directories()
  const matches = directories.flatMap((directory) =>
    Glob.scanSync("{tool,tools}/*.{js,ts}", {
      cwd: directory,
      absolute: true,
      dot: true,
      symlink: true,
    }).toSorted(comparePath),
  )

  if (matches.length > 0) yield* config.waitForDependencies()
  for (const match of matches) {
    const namespace = path.basename(match, path.extname(match))
    const loaded = yield* Effect.tryPromise({
      try: async () => {
        const module = await import(pathToFileURL(match).href)
        return Object.entries(module).flatMap(([name, definition]) =>
          isPluginTool(definition)
            ? [compile(name === "default" ? namespace : `${namespace}_${name}`, definition)]
            : [],
        )
      },
      catch: (error) => error,
    }).pipe(
      Effect.tapError((error) =>
        Effect.logWarning("custom tool load failed", { path: match, error: errorMessage(error) }),
      ),
      Effect.option,
    )
    if (Option.isNone(loaded)) continue
    contributions.push(...loaded.value)
  }

  for (const hooks of yield* plugin.list()) {
    for (const [id, definition] of Object.entries(hooks.tool ?? {})) contributions.push(compile(id, definition))
  }

  return contributions
})

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const plugin = yield* Plugin.Service
    const state = yield* InstanceState.make(() => discover(config, plugin))
    return Service.of({ list: () => InstanceState.get(state) })
  }),
)

export function compile(id: string, definition: Definition): Contribution {
  const args = isRecord(definition.args) ? definition.args : {}
  const entries = Object.entries(args)
  const zodParams = isZodRawShape(args) ? z.object(args) : undefined
  const jsonSchema = zodParams ? zodJsonSchema(zodParams) : legacyJsonSchema(entries)
  const mixedZodEntries = zodParams ? [] : entries.filter((entry): entry is [string, z.ZodType] => isZodType(entry[1]))
  const mixedZodParams =
    mixedZodEntries.length > 0 ? z.object(Object.fromEntries(mixedZodEntries) as z.ZodRawShape) : undefined
  const runtimeJsonSchema = mixedZodParams ? mixedRuntimeJsonSchema(entries) : jsonSchema
  return {
    id,
    description: definition.description,
    parameters: zodParams ? zodParameters(zodParams) : jsonSchemaParameters(runtimeJsonSchema, mixedZodParams),
    jsonSchema,
    definition,
  }
}

function zodParameters(schema: z.ZodType): Schema.Codec<unknown, unknown, never, never> {
  return Schema.declareConstructor<unknown>()([], () => (value) => {
    const result = schema.safeParse(value)
    return result.success ? Effect.succeed(result.data) : Effect.fail(zodIssue(value, result.error))
  })
}

function jsonSchemaParameters(
  jsonSchema: JSONSchema7,
  zodSchema?: z.ZodObject<z.ZodRawShape>,
): Schema.Codec<unknown, unknown, never, never> {
  const validate = new AjvJsonSchemaValidator().getValidator<unknown>(jsonSchema as JsonSchemaType)
  const decode = (value: unknown): Effect.Effect<unknown, SchemaIssue.InvalidValue> => {
    const result = validate(value)
    return result.valid
      ? Effect.succeed(result.data)
      : Effect.fail(
          new SchemaIssue.InvalidValue(Option.some(value), {
            message: `JSON Schema validation failed: ${result.errorMessage}`,
          }),
        )
  }
  if (!zodSchema) return Schema.declareConstructor<unknown>()([], () => decode)

  return Schema.declareConstructor<unknown>()([], () => (value) => {
    const result = zodSchema.safeParse(value)
    if (!result.success) return Effect.fail(zodIssue(value, result.error))
    return decode(value).pipe(Effect.map((raw) => (isRecord(raw) ? { ...raw, ...result.data } : result.data)))
  })
}

function zodIssue(value: unknown, error: z.ZodError) {
  return new SchemaIssue.InvalidValue(Option.some(value), {
    message: z.prettifyError(error),
  })
}

function isPluginTool(value: unknown): value is Definition {
  return (
    isRecord(value) &&
    typeof value.description === "string" &&
    typeof value.execute === "function" &&
    (value.args === undefined || value.args === null || isRecord(value.args))
  )
}

function isZodType(value: unknown): value is z.ZodType {
  return typeof value === "object" && value !== null && "_zod" in value
}

function isZodRawShape(value: Record<string, unknown>): value is z.ZodRawShape {
  return Object.values(value).every(isZodType)
}

function isJsonSchemaDefinition(value: unknown): value is JSONSchema7Definition {
  return typeof value === "boolean" || (typeof value === "object" && value !== null && !Array.isArray(value))
}

function legacyJsonSchema(entries: [string, unknown][]): JSONSchema7 {
  const zodEntries = entries.filter((entry): entry is [string, z.ZodType] => isZodType(entry[1]))
  const zodSchema =
    zodEntries.length > 0 ? zodJsonSchema(z.object(Object.fromEntries(zodEntries) as z.ZodRawShape)) : undefined
  const zodProperties = zodSchema?.properties ?? {}
  const zodRequired = new Set(zodSchema?.required ?? [])
  const properties = Object.fromEntries(
    entries.flatMap(([key, value]): [string, JSONSchema7Definition][] => {
      if (isZodType(value)) {
        const property = zodProperties[key]
        return property === undefined ? [] : [[key, property]]
      }
      return isJsonSchemaDefinition(value) ? [[key, value]] : []
    }),
  )
  const required = entries.flatMap(([key, value]) =>
    isZodType(value) ? (zodRequired.has(key) ? [key] : []) : isJsonSchemaDefinition(value) ? [key] : [],
  )
  const { properties: _properties, required: _required, ...zodRoot } = zodSchema ?? {}
  return {
    ...zodRoot,
    type: "object",
    properties,
    required,
    ...(zodSchema === undefined ? {} : { additionalProperties: false }),
  }
}

function mixedRuntimeJsonSchema(entries: [string, unknown][]): JSONSchema7 {
  const properties = Object.fromEntries(
    entries.flatMap(([key, value]): [string, JSONSchema7Definition][] => {
      if (isZodType(value)) return [[key, true]]
      return isJsonSchemaDefinition(value) ? [[key, value]] : []
    }),
  )
  const required = entries.flatMap(([key, value]) => (!isZodType(value) && isJsonSchemaDefinition(value) ? [key] : []))
  return {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  }
}

function zodJsonSchema(schema: z.ZodType): JSONSchema7 {
  const result = normalizeZodJsonSchema(
    z.toJSONSchema(schema, {
      target: "draft-7",
      io: "input",
      metadata: zodMetadataRegistry(schema),
    }),
  )
  if (!isJsonSchemaObject(result)) throw new Error("plugin tool Zod schema produced a non-object JSON Schema")
  return result as JSONSchema7
}

function zodMetadataRegistry(schema: z.ZodType) {
  const registry = z.registry<Record<string, unknown>>()
  const seen = new WeakSet<object>()
  const collect = (value: unknown) => {
    if (typeof value !== "object" || value === null || seen.has(value)) return
    seen.add(value)
    if (isZodType(value)) {
      const metadata = typeof value.meta === "function" ? value.meta() : undefined
      const description = typeof value.description === "string" ? value.description : undefined
      const merged = {
        ...(metadata && typeof metadata === "object" ? metadata : {}),
        ...(description ? { description } : {}),
      }
      if (Object.keys(merged).length > 0) registry.add(value, merged)
      collect(value._zod.def)
      return
    }
    for (const item of Object.values(value)) collect(item)
  }
  collect(schema)
  return registry
}

function normalizeZodJsonSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => normalizeZodJsonSchema(item))
  if (typeof value !== "object" || value === null) return value
  return Object.fromEntries(
    Object.entries(value)
      .filter((entry) =>
        (entry[0] === "exclusiveMaximum" || entry[0] === "exclusiveMinimum") && typeof entry[1] === "boolean"
          ? false
          : true,
      )
      .map(([key, item]) => [key, normalizeZodJsonSchema(item)]),
  )
}

function isJsonSchemaObject(value: unknown): value is Record<string, unknown> {
  return isRecord(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function comparePath(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0
}

export const node = LayerNode.make({ service: Service, layer, deps: [Config.node, Plugin.node] })

export * as PluginToolCompat from "./plugin-compat"
