import { describe, expect } from "bun:test"
import type { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { AgentV2 } from "@opencode-ai/core/agent"
import { MCP } from "@opencode-ai/core/mcp"
import { McpResourceTools } from "@opencode-ai/core/mcp/resource-tools"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionV2 } from "@opencode-ai/core/session"
import { Tool } from "@opencode-ai/core/tool/tool"
import { Cause, Effect, Exit } from "effect"
import { it } from "./lib/effect"

const sessionID = SessionV2.ID.make("ses_mcp_resource_tools")
const assistantMessageID = SessionMessage.ID.make("msg_mcp_resource_tools")
const agent = AgentV2.ID.make("build")
const context: Tool.Context = {
  sessionID,
  assistantMessageID,
  agent,
  toolCallID: "call_mcp_resource",
}

function resourceClient(resources = true) {
  return {
    getServerCapabilities: () => (resources ? { resources: {} } : {}),
  } as unknown as Client
}

function mcpService(overrides: Partial<MCP.Interface> = {}) {
  return MCP.Service.of({
    status: () => Effect.succeed({}),
    clients: () => Effect.succeed({}),
    instructions: () => Effect.succeed([]),
    tools: () => Effect.succeed({}),
    prompts: () => Effect.succeed({}),
    resources: () => Effect.succeed({}),
    resourceTemplates: () => Effect.succeed({}),
    add: () => Effect.succeed({ status: {} }),
    connect: (name) => Effect.fail(new MCP.NotFoundError({ name })),
    disconnect: (name) => Effect.fail(new MCP.NotFoundError({ name })),
    getPrompt: () => Effect.succeed(undefined),
    readResource: () => Effect.succeed(undefined),
    startAuth: (name) => Effect.fail(new MCP.NotFoundError({ name })),
    authenticate: (name) => Effect.fail(new MCP.NotFoundError({ name })),
    finishAuth: (name) => Effect.fail(new MCP.NotFoundError({ name })),
    removeAuth: () => Effect.void,
    supportsOAuth: (name) => Effect.fail(new MCP.NotFoundError({ name })),
    hasStoredTokens: () => Effect.succeed(false),
    getAuthStatus: () => Effect.succeed("not_authenticated"),
    ...overrides,
  })
}

function permissionService(
  assertions: PermissionV2.AssertInput[],
  assert: PermissionV2.Interface["assert"] = () => Effect.void,
) {
  return PermissionV2.Service.of({
    assert: (input) =>
      Effect.sync(() => {
        assertions.push(input)
      }).pipe(Effect.andThen(assert(input))),
    ask: () => Effect.die("unused"),
    reply: () => Effect.die("unused"),
    get: () => Effect.die("unused"),
    forSession: () => Effect.die("unused"),
    list: () => Effect.die("unused"),
  })
}

function loadCatalog(mcp: MCP.Interface, permission: PermissionV2.Interface) {
  return McpResourceTools.catalog().pipe(
    Effect.provideService(MCP.Service, mcp),
    Effect.provideService(PermissionV2.Service, permission),
  )
}

function settle(catalog: Readonly<Record<string, Tool.AnyTool>>, name: string, input: unknown) {
  return Tool.settle(catalog[name]!, { type: "tool-call", id: context.toolCallID, name, input }, context)
}

describe("MCP resource tools", () => {
  it.effect("exports exact names and omits the catalog without resource-capable servers", () =>
    Effect.gen(function* () {
      expect(McpResourceTools.list).toBe("list_mcp_resources")
      expect(McpResourceTools.listTemplates).toBe("list_mcp_resource_templates")
      expect(McpResourceTools.read).toBe("read_mcp_resource")
      const assertions: PermissionV2.AssertInput[] = []
      const catalog = yield* loadCatalog(
        mcpService({ clients: () => Effect.succeed({ plain: resourceClient(false) }) }),
        permissionService(assertions),
      )
      expect(catalog).toEqual({})
      expect(assertions).toEqual([])
    }),
  )

  it.effect("sorts cross-server resources and preserves every descriptor field", () =>
    Effect.gen(function* () {
      const assertions: PermissionV2.AssertInput[] = []
      const mcp = mcpService({
        clients: () =>
          Effect.succeed({
            zeta: resourceClient(),
            alpha: resourceClient(),
            plain: resourceClient(false),
          }),
        resources: () =>
          Effect.succeed({
            zetaSecond: {
              client: "zeta",
              uri: "mcp://zeta/2",
              name: "same",
              title: "Zeta second",
              description: "second resource",
              mimeType: "text/plain",
              size: 2,
              annotations: {
                audience: ["assistant" as const],
                priority: 0.2,
                lastModified: "2026-07-24T02:00:00Z",
              },
              _meta: { source: "zeta-2" },
            },
            alpha: {
              client: "alpha",
              uri: "mcp://alpha/1",
              name: "alpha",
              title: "Alpha",
              description: "first resource",
              mimeType: "application/json",
              size: 1,
              annotations: {
                audience: ["user" as const],
                priority: 0.8,
                lastModified: "2026-07-24T01:00:00Z",
              },
              icons: [{ src: "data:image/png;base64,YWxwaGE=", mimeType: "image/png", sizes: ["16x16"] }],
              _meta: { source: "alpha" },
            },
            zetaFirst: {
              client: "zeta",
              uri: "mcp://zeta/1",
              name: "same",
              title: "Zeta first",
              description: "first zeta resource",
              mimeType: "image/png",
              size: 3,
              annotations: { audience: ["user" as const, "assistant" as const], priority: 1 },
              _meta: { source: "zeta-1" },
            },
          }),
      })
      const catalog = yield* loadCatalog(mcp, permissionService(assertions))
      expect(Object.keys(catalog)).toEqual([
        McpResourceTools.list,
        McpResourceTools.listTemplates,
        McpResourceTools.read,
      ])

      const result = yield* settle(catalog, McpResourceTools.list, {})
      expect(result.structured).toEqual({
        resources: [
          {
            uri: "mcp://alpha/1",
            name: "alpha",
            title: "Alpha",
            description: "first resource",
            mimeType: "application/json",
            size: 1,
            annotations: {
              audience: ["user"],
              priority: 0.8,
              lastModified: "2026-07-24T01:00:00Z",
            },
            icons: [{ src: "data:image/png;base64,YWxwaGE=", mimeType: "image/png", sizes: ["16x16"] }],
            _meta: { source: "alpha" },
            server: "alpha",
          },
          {
            uri: "mcp://zeta/1",
            name: "same",
            title: "Zeta first",
            description: "first zeta resource",
            mimeType: "image/png",
            size: 3,
            annotations: { audience: ["user", "assistant"], priority: 1 },
            _meta: { source: "zeta-1" },
            server: "zeta",
          },
          {
            uri: "mcp://zeta/2",
            name: "same",
            title: "Zeta second",
            description: "second resource",
            mimeType: "text/plain",
            size: 2,
            annotations: {
              audience: ["assistant"],
              priority: 0.2,
              lastModified: "2026-07-24T02:00:00Z",
            },
            _meta: { source: "zeta-2" },
            server: "zeta",
          },
        ],
      })
      expect(result.content).toEqual([{ type: "text", text: JSON.stringify(result.structured, null, 2) }])
      expect(JSON.stringify(result.structured)).not.toContain('"client"')
      expect(assertions).toEqual([
        {
          action: "read",
          resources: ["mcp:alpha:*", "mcp:zeta:*"],
          save: ["mcp:alpha:*", "mcp:zeta:*"],
          metadata: {},
          sessionID,
          agent,
          source: {
            type: "tool",
            messageID: assistantMessageID,
            callID: context.toolCallID,
          },
        },
      ])
    }),
  )

  it.effect("filters and sorts templates while preserving every descriptor field", () =>
    Effect.gen(function* () {
      const assertions: PermissionV2.AssertInput[] = []
      const mcp = mcpService({
        clients: () => Effect.succeed({ zeta: resourceClient(), alpha: resourceClient() }),
        resourceTemplates: (server) =>
          Effect.succeed(
            Object.fromEntries(
              [
                {
                  key: "zetaSecond",
                  client: "zeta",
                  uriTemplate: "mcp://zeta/{id}/2",
                  name: "same",
                  title: "Zeta second",
                  description: "second template",
                  mimeType: "text/plain",
                  annotations: { audience: ["assistant" as const], priority: 0.2 },
                  _meta: { source: "zeta-2" },
                },
                {
                  key: "alpha",
                  client: "alpha",
                  uriTemplate: "mcp://alpha/{id}",
                  name: "alpha",
                  title: "Alpha",
                  description: "alpha template",
                  mimeType: "application/json",
                  annotations: { audience: ["user" as const], priority: 0.8 },
                  _meta: { source: "alpha" },
                },
                {
                  key: "zetaFirst",
                  client: "zeta",
                  uriTemplate: "mcp://zeta/{id}/1",
                  name: "same",
                  title: "Zeta first",
                  description: "first template",
                  mimeType: "image/png",
                  annotations: { audience: ["user" as const, "assistant" as const], priority: 1 },
                  icons: [{ src: "data:image/png;base64,emV0YQ==", mimeType: "image/png", sizes: ["32x32"] }],
                  _meta: { source: "zeta-1" },
                },
              ]
                .filter((template) => !server || template.client === server)
                .map(({ key, ...template }) => [key, template]),
            ),
          ),
      })
      const catalog = yield* loadCatalog(mcp, permissionService(assertions))
      const result = yield* settle(catalog, McpResourceTools.listTemplates, { server: "zeta" })
      expect(result.structured).toEqual({
        resourceTemplates: [
          {
            uriTemplate: "mcp://zeta/{id}/1",
            name: "same",
            title: "Zeta first",
            description: "first template",
            mimeType: "image/png",
            annotations: { audience: ["user", "assistant"], priority: 1 },
            icons: [{ src: "data:image/png;base64,emV0YQ==", mimeType: "image/png", sizes: ["32x32"] }],
            _meta: { source: "zeta-1" },
            server: "zeta",
          },
          {
            uriTemplate: "mcp://zeta/{id}/2",
            name: "same",
            title: "Zeta second",
            description: "second template",
            mimeType: "text/plain",
            annotations: { audience: ["assistant"], priority: 0.2 },
            _meta: { source: "zeta-2" },
            server: "zeta",
          },
        ],
      })
      for (const template of (result.structured as { resourceTemplates: unknown[] }).resourceTemplates)
        expect(template).not.toHaveProperty("client")
      expect(assertions).toEqual([
        {
          action: "read",
          resources: ["mcp:zeta:*"],
          save: ["mcp:zeta:*"],
          metadata: { server: "zeta" },
          sessionID,
          agent,
          source: {
            type: "tool",
            messageID: assistantMessageID,
            callID: context.toolCallID,
          },
        },
      ])
    }),
  )

  it.effect("uses ordinal server, name, URI, and URI-template ordering for non-ASCII descriptors", () =>
    Effect.gen(function* () {
      const mcp = mcpService({
        clients: () =>
          Effect.succeed({
            éclair: resourceClient(),
            Ångstrom: resourceClient(),
          }),
        resources: () =>
          Effect.succeed({
            omega: { client: "éclair", uri: "mcp://éclair/Ω", name: "βeta" },
            angstrom: { client: "Ångstrom", uri: "mcp://Ångstrom/1", name: "Ωmega" },
            accent: { client: "éclair", uri: "mcp://éclair/1", name: "Álpha" },
            acute: { client: "éclair", uri: "mcp://éclair/é", name: "βeta" },
          }),
        resourceTemplates: () =>
          Effect.succeed({
            omega: { client: "éclair", uriTemplate: "mcp://éclair/{Ω}", name: "βeta" },
            angstrom: { client: "Ångstrom", uriTemplate: "mcp://Ångstrom/{id}", name: "Ωmega" },
            accent: { client: "éclair", uriTemplate: "mcp://éclair/{id}", name: "Álpha" },
            acute: { client: "éclair", uriTemplate: "mcp://éclair/{é}", name: "βeta" },
          }),
      })
      const catalog = yield* loadCatalog(mcp, permissionService([]))
      const resources = yield* settle(catalog, McpResourceTools.list, {})
      expect(
        (
          resources.structured as {
            resources: Array<{ server: string; name: string; uri: string }>
          }
        ).resources.map((item) => [item.server, item.name, item.uri]),
      ).toEqual([
        ["Ångstrom", "Ωmega", "mcp://Ångstrom/1"],
        ["éclair", "Álpha", "mcp://éclair/1"],
        ["éclair", "βeta", "mcp://éclair/é"],
        ["éclair", "βeta", "mcp://éclair/Ω"],
      ])

      const templates = yield* settle(catalog, McpResourceTools.listTemplates, {})
      expect(
        (
          templates.structured as {
            resourceTemplates: Array<{ server: string; name: string; uriTemplate: string }>
          }
        ).resourceTemplates.map((item) => [item.server, item.name, item.uriTemplate]),
      ).toEqual([
        ["Ångstrom", "Ωmega", "mcp://Ångstrom/{id}"],
        ["éclair", "Álpha", "mcp://éclair/{id}"],
        ["éclair", "βeta", "mcp://éclair/{é}"],
        ["éclair", "βeta", "mcp://éclair/{Ω}"],
      ])
    }),
  )

  it.effect("reads the exact URI and preserves ordered text and blob provenance", () =>
    Effect.gen(function* () {
      const assertions: PermissionV2.AssertInput[] = []
      const reads: Array<{ server: string; uri: string }> = []
      const mcp = mcpService({
        clients: () => Effect.succeed({ source: resourceClient() }),
        readResource: (server, uri) =>
          Effect.sync(() => {
            reads.push({ server, uri })
            return {
              _meta: { result: "opaque" },
              contents: [
                {
                  uri: "mcp://source/text",
                  mimeType: "text/plain",
                  text: "body",
                  _meta: { item: "text" },
                },
                {
                  uri: "mcp://source/file.pdf",
                  mimeType: "application/pdf",
                  blob: "aGVsbG8=",
                  _meta: { item: "blob" },
                },
              ],
            }
          }),
      })
      const catalog = yield* loadCatalog(mcp, permissionService(assertions))
      const result = yield* settle(catalog, McpResourceTools.read, {
        server: "source",
        uri: "mcp://source/requested?exact=true",
      })
      expect(reads).toEqual([{ server: "source", uri: "mcp://source/requested?exact=true" }])
      expect(result.structured).toEqual({
        server: "source",
        uri: "mcp://source/requested?exact=true",
        contents: [
          {
            uri: "mcp://source/text",
            mimeType: "text/plain",
            text: "body",
            _meta: { item: "text" },
          },
          {
            uri: "mcp://source/file.pdf",
            mimeType: "application/pdf",
            blob: "aGVsbG8=",
            _meta: { item: "blob" },
          },
        ],
      })
      expect(result.structured).not.toHaveProperty("content")
      expect(result.content).toEqual([
        {
          type: "text",
          text: "Resource: mcp://source/text\nMIME: text/plain\nbody",
          provenance: {
            type: "mcp",
            clientName: "source",
            uri: "mcp://source/text",
            kind: "resource",
            mime: "text/plain",
            meta: { result: { result: "opaque" }, resource: { item: "text" } },
          },
        },
        {
          type: "file",
          uri: "data:application/pdf;base64,aGVsbG8=",
          mime: "application/pdf",
          name: "file.pdf",
          provenance: {
            type: "mcp",
            clientName: "source",
            uri: "mcp://source/file.pdf",
            kind: "resource",
            mime: "application/pdf",
            meta: { result: { result: "opaque" }, resource: { item: "blob" } },
          },
        },
      ])
      expect(assertions).toEqual([
        {
          action: "read",
          resources: ["mcp:source:mcp://source/requested?exact=true"],
          save: ["mcp:source:*"],
          metadata: { server: "source", uri: "mcp://source/requested?exact=true" },
          sessionID,
          agent,
          source: {
            type: "tool",
            messageID: assistantMessageID,
            callID: context.toolCallID,
          },
        },
      ])
    }),
  )

  it.effect("sanitizes invalid, unsupported, and oversized blobs without losing valid siblings", () =>
    Effect.gen(function* () {
      const invalid = "aGVs bG8="
      const unsupported = "dW5zdXBwb3J0ZWQ="
      const oversized = Buffer.alloc(10 * 1024 * 1024 + 1).toString("base64")
      const catalog = yield* loadCatalog(
        mcpService({
          clients: () => Effect.succeed({ source: resourceClient() }),
          readResource: () =>
            Effect.succeed({
              contents: [
                { uri: "mcp://source/before", text: "before" },
                { uri: "mcp://source/invalid", mimeType: "image/png", blob: invalid },
                { uri: "mcp://source/unsupported", mimeType: "application/zip", blob: unsupported },
                { uri: "mcp://source/oversized", mimeType: "image/png", blob: oversized },
                { uri: "mcp://source/after", text: "after" },
              ],
            }),
        }),
        permissionService([]),
      )
      const result = yield* settle(catalog, McpResourceTools.read, {
        server: "source",
        uri: "mcp://source/all",
      })
      expect((result.structured as { contents: unknown[] }).contents).toEqual([
        { uri: "mcp://source/before", text: "before" },
        {
          type: "error",
          uri: "mcp://source/invalid",
          mimeType: "image/png",
          error: "Invalid base64 payload",
        },
        {
          type: "error",
          uri: "mcp://source/unsupported",
          mimeType: "application/zip",
          error: "Unsupported resource MIME: application/zip",
        },
        {
          type: "error",
          uri: "mcp://source/oversized",
          mimeType: "image/png",
          error: "Resource exceeds 10485760 bytes: 10485761 bytes",
        },
        { uri: "mcp://source/after", text: "after" },
      ])
      expect(result.content.map((item) => item.type)).toEqual(["text", "text", "text", "text", "text"])
      const serialized = JSON.stringify(result)
      expect(serialized).not.toContain(invalid)
      expect(serialized).not.toContain(unsupported)
      expect(serialized).not.toContain(oversized)
    }),
  )

  it.effect("returns ToolFailure for unavailable servers, read failures, empty content, and policy denial", () =>
    Effect.gen(function* () {
      const clients = {
        capable: resourceClient(),
        plain: resourceClient(false),
      }
      const cases: ReadonlyArray<{
        readonly label: string
        readonly mcp: MCP.Interface
        readonly permission: PermissionV2.Interface
        readonly input: { readonly server: string; readonly uri: string }
        readonly message: string
      }> = [
        {
          label: "disconnected",
          mcp: mcpService({ clients: () => Effect.succeed(clients) }),
          permission: permissionService([]),
          input: { server: "missing", uri: "mcp://missing/item" },
          message: 'MCP server "missing" is not connected',
        },
        {
          label: "capability",
          mcp: mcpService({ clients: () => Effect.succeed(clients) }),
          permission: permissionService([]),
          input: { server: "plain", uri: "mcp://plain/item" },
          message: 'MCP server "plain" does not support resources',
        },
        {
          label: "read",
          mcp: mcpService({
            clients: () => Effect.succeed(clients),
            readResource: () => Effect.succeed(undefined),
          }),
          permission: permissionService([]),
          input: { server: "capable", uri: "mcp://capable/item" },
          message: "Failed to read MCP resource: capable/mcp://capable/item",
        },
        {
          label: "empty",
          mcp: mcpService({
            clients: () => Effect.succeed(clients),
            readResource: () => Effect.succeed({ contents: [] }),
          }),
          permission: permissionService([]),
          input: { server: "capable", uri: "mcp://capable/item" },
          message: "MCP resource mcp://capable/item from capable returned no contents.",
        },
        {
          label: "deny",
          mcp: mcpService({
            clients: () => Effect.succeed(clients),
            readResource: () => Effect.succeed({ contents: [{ uri: "mcp://capable/item", text: "unused" }] }),
          }),
          permission: permissionService([], () => Effect.fail(new PermissionV2.BlockedError({ rules: [] }))),
          input: { server: "capable", uri: "mcp://capable/item" },
          message: "Permission denied: read",
        },
      ]
      for (const item of cases) {
        const catalog = yield* loadCatalog(item.mcp, item.permission)
        const failure = yield* Effect.flip(settle(catalog, McpResourceTools.read, item.input))
        expect(failure, item.label).toBeInstanceOf(Tool.Failure)
        expect(failure.message, item.label).toBe(item.message)
      }

      const listCatalog = yield* loadCatalog(
        mcpService({ clients: () => Effect.succeed(clients) }),
        permissionService([]),
      )
      const listFailure = yield* Effect.flip(settle(listCatalog, McpResourceTools.list, { server: "missing" }))
      expect(listFailure).toBeInstanceOf(Tool.Failure)
      expect(listFailure.message).toContain("Available resource servers: capable")
    }),
  )

  it.effect("preserves interactive permission rejection and interruption causes", () =>
    Effect.gen(function* () {
      const mcp = mcpService({
        clients: () => Effect.succeed({ source: resourceClient() }),
        readResource: () => Effect.succeed({ contents: [{ uri: "mcp://source/item", text: "unused" }] }),
      })
      const rejected = new PermissionV2.CorrectedError({ feedback: "choose another resource" })
      const rejectedCatalog = yield* loadCatalog(
        mcp,
        permissionService([], () => Effect.fail(rejected)),
      )
      expect(
        yield* Effect.flip(
          settle(rejectedCatalog, McpResourceTools.read, {
            server: "source",
            uri: "mcp://source/item",
          }),
        ),
      ).toBe(rejected)

      const interruptedCatalog = yield* loadCatalog(
        mcp,
        permissionService([], () => Effect.interrupt),
      )
      const exit = yield* settle(interruptedCatalog, McpResourceTools.read, {
        server: "source",
        uri: "mcp://source/item",
      }).pipe(Effect.exit)
      expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true)
    }),
  )
})
