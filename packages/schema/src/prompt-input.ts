export * as PromptInput from "./prompt-input"

import { Schema } from "effect"
import { Context, OutputFormat, Resource, Source } from "./prompt"
import { optional, statics } from "./schema"

export interface FileAttachment extends Schema.Schema.Type<typeof FileAttachment> {}
export const FileAttachment = Schema.Struct({
  uri: Schema.String,
  mime: Schema.String.pipe(optional),
  name: Schema.String.pipe(optional),
  description: Schema.String.pipe(optional),
  source: Source.pipe(optional),
  resource: Resource.pipe(optional),
})
  .annotate({ identifier: "PromptInput.FileAttachment" })
  .pipe(
    statics((schema) => ({
      create: (input: FileAttachment) => schema.make(input),
    })),
  )

export interface AgentAttachment extends Schema.Schema.Type<typeof AgentAttachment> {}
export const AgentAttachment = Schema.Struct({
  name: Schema.String,
  source: Source.pipe(optional),
}).annotate({ identifier: "PromptInput.AgentAttachment" })

export interface Prompt extends Schema.Schema.Type<typeof Prompt> {}
export const Prompt = Schema.Struct({
  text: Schema.String,
  context: Schema.Array(Context).pipe(optional),
  files: Schema.Array(FileAttachment).pipe(optional),
  agents: Schema.Array(AgentAttachment).pipe(optional),
  system: Schema.String.pipe(optional),
  tools: Schema.Record(Schema.String, Schema.Boolean).pipe(optional),
  format: OutputFormat.pipe(optional),
}).annotate({ identifier: "PromptInput" })
