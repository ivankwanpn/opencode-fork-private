import { Schema } from "effect"
import { optional, NonNegativeInt, statics } from "./schema"

export interface Source extends Schema.Schema.Type<typeof Source> {}
export const Source = Schema.Struct({
  start: Schema.Finite,
  end: Schema.Finite,
  text: Schema.String,
}).annotate({ identifier: "Prompt.Source" })

export interface Resource extends Schema.Schema.Type<typeof Resource> {}
export const Resource = Schema.Struct({
  clientName: Schema.String,
  uri: Schema.String,
}).annotate({ identifier: "Prompt.Resource" })

export const MaterializedText = Schema.Struct({
  type: Schema.Literal("text"),
  text: Schema.String,
}).annotate({ identifier: "Prompt.MaterializedText" })

export const MaterializedFile = Schema.Struct({
  type: Schema.Literal("file"),
  uri: Schema.String,
  mime: Schema.String,
  name: Schema.String.pipe(optional),
}).annotate({ identifier: "Prompt.MaterializedFile" })

export const MaterializedError = Schema.Struct({
  type: Schema.Literal("error"),
  message: Schema.String,
}).annotate({ identifier: "Prompt.MaterializedError" })

export const MaterializedContent = Schema.Union([MaterializedText, MaterializedFile, MaterializedError]).annotate({
  discriminator: "type",
  identifier: "Prompt.MaterializedContent",
})
export type MaterializedContent = typeof MaterializedContent.Type

export interface FileAttachment extends Schema.Schema.Type<typeof FileAttachment> {}
export const FileAttachment = Schema.Struct({
  uri: Schema.String,
  mime: Schema.String,
  name: Schema.String.pipe(optional),
  description: Schema.String.pipe(optional),
  source: Source.pipe(optional),
  resource: Resource.pipe(optional),
  materialized: Schema.Array(MaterializedContent).pipe(optional),
})
  .annotate({ identifier: "Prompt.FileAttachment" })
  .pipe(
    statics((schema) => ({
      create: (input: FileAttachment) =>
        schema.make({
          uri: input.uri,
          mime: input.mime,
          name: input.name,
          description: input.description,
          source: input.source,
          resource: input.resource,
          materialized: input.materialized,
        }),
    })),
  )

export interface AgentAttachment extends Schema.Schema.Type<typeof AgentAttachment> {}
export const AgentAttachment = Schema.Struct({
  name: Schema.String,
  source: Source.pipe(optional),
  guidance: Schema.String.pipe(optional),
}).annotate({ identifier: "Prompt.AgentAttachment" })

export const OutputFormatText = Schema.Struct({
  type: Schema.Literal("text"),
}).annotate({ identifier: "Prompt.OutputFormat.Text" })

export const OutputFormatJsonSchema = Schema.Struct({
  type: Schema.Literal("json_schema"),
  schema: Schema.Record(Schema.String, Schema.Unknown).annotate({ identifier: "Prompt.JSONSchema" }),
  retryCount: NonNegativeInt.pipe(optional),
}).annotate({ identifier: "Prompt.OutputFormat.JsonSchema" })

export const OutputFormat = Schema.Union([OutputFormatText, OutputFormatJsonSchema]).annotate({
  discriminator: "type",
  identifier: "Prompt.OutputFormat",
})
export type OutputFormat = typeof OutputFormat.Type

export interface Context extends Schema.Schema.Type<typeof Context> {}
export const Context = Schema.Struct({
  text: Schema.String,
  metadata: Schema.Record(Schema.String, Schema.Unknown).pipe(optional),
}).annotate({ identifier: "Prompt.Context" })

export interface Prompt extends Schema.Schema.Type<typeof Prompt> {}
export const Prompt = Schema.Struct({
  text: Schema.String,
  context: Schema.Array(Context).pipe(optional),
  files: Schema.Array(FileAttachment).pipe(optional),
  agents: Schema.Array(AgentAttachment).pipe(optional),
  system: Schema.String.pipe(optional),
  tools: Schema.Record(Schema.String, Schema.Boolean).pipe(optional),
  format: OutputFormat.pipe(optional),
})
  .annotate({ identifier: "Prompt" })
  .pipe(
    statics((schema) => ({
      equivalence: Schema.toEquivalence(schema),
      fromUserMessage: (
        input: Pick<Prompt, "text" | "context" | "files" | "agents" | "system" | "tools" | "format">,
      ) =>
        schema.make({
          text: input.text,
          ...(input.context === undefined ? {} : { context: input.context }),
          ...(input.files === undefined ? {} : { files: input.files }),
          ...(input.agents === undefined ? {} : { agents: input.agents }),
          ...(input.system === undefined ? {} : { system: input.system }),
          ...(input.tools === undefined ? {} : { tools: input.tools }),
          ...(input.format === undefined ? {} : { format: input.format }),
        }),
    })),
  )
