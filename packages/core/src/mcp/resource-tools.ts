export * as McpResourceTools from "./resource-tools"

import type { Client } from "@modelcontextprotocol/sdk/client/index.js"
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import { Effect, Schema } from "effect"
import { PermissionV2 } from "../permission"
import { Tool } from "../tool/tool"
import { McpCatalog } from "./catalog"
import { MCP } from "./runtime"

export const list = "list_mcp_resources"
export const listTemplates = "list_mcp_resource_templates"
export const read = "read_mcp_resource"

const ListInput = Schema.Struct({ server: Schema.optional(Schema.String) })
const ReadInput = Schema.Struct({ server: Schema.String, uri: Schema.String })
const Descriptor = Schema.Record(Schema.String, Schema.Unknown)
const ListResourcesOutput = Schema.Struct({ resources: Schema.Array(Descriptor) })
const ListTemplatesOutput = Schema.Struct({ resourceTemplates: Schema.Array(Descriptor) })
const ReadStructuredOutput = Schema.Struct({
  server: Schema.String,
  uri: Schema.String,
  contents: Schema.Array(Schema.Unknown),
})
const ReadOutput = Schema.Struct({
  ...ReadStructuredOutput.fields,
  content: Schema.Array(Schema.Unknown),
})

export const catalog = Effect.fn("McpResourceTools.catalog")(function* () {
  const mcp = yield* MCP.Service
  const permission = yield* PermissionV2.Service
  const clients = yield* mcp.clients()
  const servers = resourceServers(clients)
  if (servers.length === 0) {
    const empty: Readonly<Record<string, Tool.AnyTool>> = {}
    return empty
  }
  const tools: Readonly<Record<string, Tool.AnyTool>> = {
    [list]: makeListResources(mcp, permission, servers),
    [listTemplates]: makeListTemplates(mcp, permission, servers),
    [read]: makeReadResource(mcp, permission, servers),
  }
  return tools
})

function makeListResources(mcp: MCP.Interface, permission: PermissionV2.Interface, servers: ReadonlyArray<string>) {
  return Tool.make({
    description:
      "Lists resources provided by connected MCP servers. Resources provide context such as files, database schemas, or application-specific information.",
    input: ListInput,
    output: ListResourcesOutput,
    toModelOutput: ({ output }) => [{ type: "text", text: JSON.stringify(output, null, 2) }],
    execute: (input, context) =>
      Effect.gen(function* () {
        const selected = yield* selectServers(input.server, servers)
        const resources = selected.map((server) => `mcp:${server}:*`)
        yield* assertRead(permission, {
          resources,
          save: resources,
          metadata: input.server ? { server: input.server } : {},
          context,
        })
        return {
          resources: Object.values(yield* mcp.resources(input.server))
            .filter((resource) => selected.includes(resource.client))
            .map((resource) => {
              const { client, ...descriptor } = resource
              return { ...descriptor, server: client }
            })
            .toSorted((left, right) => compareDescriptor(left, right, "uri")),
        }
      }),
  })
}

function makeListTemplates(mcp: MCP.Interface, permission: PermissionV2.Interface, servers: ReadonlyArray<string>) {
  return Tool.make({
    description:
      "Lists resource templates provided by connected MCP servers. Resource templates are parameterized resources that can be read after filling in their URI template.",
    input: ListInput,
    output: ListTemplatesOutput,
    toModelOutput: ({ output }) => [{ type: "text", text: JSON.stringify(output, null, 2) }],
    execute: (input, context) =>
      Effect.gen(function* () {
        const selected = yield* selectServers(input.server, servers)
        const resources = selected.map((server) => `mcp:${server}:*`)
        yield* assertRead(permission, {
          resources,
          save: resources,
          metadata: input.server ? { server: input.server } : {},
          context,
        })
        return {
          resourceTemplates: Object.values(yield* mcp.resourceTemplates(input.server))
            .filter((template) => selected.includes(template.client))
            .map((template) => {
              const { client, ...descriptor } = template
              return { ...descriptor, server: client }
            })
            .toSorted((left, right) => compareDescriptor(left, right, "uriTemplate")),
        }
      }),
  })
}

function makeReadResource(mcp: MCP.Interface, permission: PermissionV2.Interface, _servers: ReadonlyArray<string>) {
  return Tool.make({
    description:
      "Read a specific resource from an MCP server using the server name and resource URI. The URI is an MCP identifier and does not need to be a file URL.",
    input: ReadInput,
    output: ReadOutput,
    structured: ReadStructuredOutput,
    toStructuredOutput: ({ output }) => ({
      server: output.server,
      uri: output.uri,
      contents: output.contents,
    }),
    toModelOutput: ({ output }) => output.content as ReadonlyArray<Tool.Content>,
    execute: (input, context) =>
      Effect.gen(function* () {
        const clients = yield* mcp.clients()
        const client = clients[input.server]
        if (!client) return yield* new Tool.Failure({ message: `MCP server "${input.server}" is not connected` })
        if (!client.getServerCapabilities()?.resources)
          return yield* new Tool.Failure({
            message: `MCP server "${input.server}" does not support resources`,
          })

        yield* assertRead(permission, {
          resources: [`mcp:${input.server}:${input.uri}`],
          save: [`mcp:${input.server}:*`],
          metadata: { server: input.server, uri: input.uri },
          context,
        })

        const result = yield* mcp.readResource(input.server, input.uri)
        if (!result)
          return yield* new Tool.Failure({
            message: `Failed to read MCP resource: ${input.server}/${input.uri}`,
          })
        if (result.contents.length === 0)
          return yield* new Tool.Failure({
            message: `MCP resource ${input.uri} from ${input.server} returned no contents.`,
          })

        const projection = result.contents.map((item) => {
          const current = McpCatalog.projectResult(input.server, {
            ...(result._meta === undefined ? {} : { _meta: result._meta }),
            content: [{ type: "resource", resource: item }],
          } satisfies CallToolResult)
          if (!("text" in item)) return current
          const mime = item.mimeType ?? "application/octet-stream"
          return {
            contents: current.contents,
            content: current.content.map((part) =>
              part.type === "text" ? { ...part, text: `Resource: ${item.uri}\nMIME: ${mime}\n${part.text}` } : part,
            ),
          }
        })
        const contents = projection.flatMap((item) => item.contents)
        const content = projection.flatMap((item) => item.content)
        if (contents.length === 0 || content.length === 0)
          return yield* new Tool.Failure({
            message: `MCP resource ${input.uri} from ${input.server} returned no usable contents.`,
          })
        return { server: input.server, uri: input.uri, contents, content }
      }),
  })
}

function resourceServers(clients: Readonly<Record<string, Client>>) {
  return Object.entries(clients)
    .filter(([, client]) => !!client.getServerCapabilities()?.resources)
    .map(([server]) => server)
    .toSorted(compareOrdinal)
}

function selectServers(server: string | undefined, servers: ReadonlyArray<string>) {
  if (!server) return Effect.succeed(servers)
  if (servers.includes(server)) return Effect.succeed([server])
  const message =
    servers.length === 0
      ? `MCP server "${server}" does not support resources`
      : `MCP server "${server}" does not support resources. Available resource servers: ${servers.join(", ")}`
  return Effect.fail(new Tool.Failure({ message }))
}

function compareDescriptor(
  left: {
    readonly server: string
    readonly name: string
    readonly uri?: string
    readonly uriTemplate?: string
  },
  right: {
    readonly server: string
    readonly name: string
    readonly uri?: string
    readonly uriTemplate?: string
  },
  uri: "uri" | "uriTemplate",
) {
  return (
    compareOrdinal(left.server, right.server) ||
    compareOrdinal(left.name, right.name) ||
    compareOrdinal(String(left[uri]), String(right[uri]))
  )
}

function compareOrdinal(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0
}

function assertRead(
  permission: PermissionV2.Interface,
  input: {
    readonly resources: ReadonlyArray<string>
    readonly save: ReadonlyArray<string>
    readonly metadata: Readonly<Record<string, unknown>>
    readonly context: Tool.Context
  },
) {
  const source = {
    type: "tool" as const,
    messageID: input.context.assistantMessageID,
    callID: input.context.toolCallID,
  }
  return permission
    .assert({
      action: "read",
      resources: input.resources,
      save: input.save,
      metadata: input.metadata,
      sessionID: input.context.sessionID,
      agent: input.context.agent,
      source,
    })
    .pipe(
      Effect.catchTag("PermissionV2.BlockedError", () =>
        Effect.fail(new Tool.Failure({ message: "Permission denied: read" })),
      ),
    )
}
