import { Prompt } from "@opencode-ai/schema/prompt"

export {
  AgentAttachment,
  FileAttachment,
  MaterializedContent,
  MaterializedError,
  MaterializedFile,
  MaterializedText,
  OutputFormat,
  OutputFormatJsonSchema,
  OutputFormatText,
  Prompt,
  Resource,
  Source,
} from "@opencode-ai/schema/prompt"

export const dematerialize = (prompt: Prompt) =>
  Prompt.make({
    ...prompt,
    files: prompt.files?.map((file) => ({
      uri: file.uri,
      mime: file.mime,
      name: file.name,
      description: file.description,
      source: file.source,
      resource: file.resource,
    })),
    agents: prompt.agents?.map((agent) => ({
      name: agent.name,
      source: agent.source,
    })),
  })

export const STRUCTURED_OUTPUT_TOOL_NAME = "StructuredOutput"
