import { afterAll, describe, expect, test } from "bun:test"
import { AssistantErrorCodec } from "@opencode-ai/core/session/assistant-error-codec"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ACPClient, type EventEnvelope } from "../../src/acp/client"
import { empty, eventStream, json, recorder, type RecordedRequest } from "./client-fixture"
import { readdir } from "node:fs/promises"
import path from "node:path"

const baseUrl = "http://acp.test"
const authorization = "Bearer acp-boundary-token"
const directory = "/workspace/project"
const suiteRequests: RecordedRequest[][] = []

function makeFacade(respond: Parameters<typeof recorder>[0]) {
  const recording = recorder(respond)
  suiteRequests.push(recording.requests)
  return {
    ...recording,
    client: ACPClient.make({
      baseUrl,
      headers: { authorization },
      fetch: recording.fetch,
    }),
  }
}

function nativeSession(id: string, parentID?: string) {
  return {
    id,
    ...(parentID ? { parentID } : {}),
    projectID: "project",
    agent: "build",
    model: { providerID: "provider", id: "model", variant: "careful" },
    cost: 0,
    tokens: {
      input: 0,
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
    time: { created: 1, updated: 2 },
    title: id,
    location: { directory },
  }
}

function nativeUser(id: string, text: string, created: number) {
  return {
    id,
    type: "user",
    time: { created },
    text,
  }
}

function nativeAssistant(
  id: string,
  text: string,
  created: number,
  completed: number,
  input?: {
    readonly finish?: string
    readonly error?: { readonly type: "unknown"; readonly message: string }
  },
) {
  return {
    id,
    type: "assistant",
    time: { created, completed },
    agent: "build",
    model: { providerID: "provider", id: "model", variant: "careful" },
    content: [{ type: "text", id: `prt_${id}`, text }],
    finish: input?.finish ?? "stop",
    ...(input?.error ? { error: input.error } : {}),
  }
}

function importedUser(nativeID: string, legacyID: string, text: string, created: number) {
  return {
    id: nativeID,
    type: "user",
    time: { created },
    text,
    metadata: {
      legacy: {
        info: {
          id: legacyID,
          sessionID: "ses_old",
          role: "user",
          time: { created },
          agent: "build",
          model: { providerID: "provider", modelID: "model", variant: "careful" },
        },
        parts: [
          {
            id: `prt_${legacyID}`,
            sessionID: "ses_old",
            messageID: legacyID,
            type: "text",
            text,
          },
        ],
      },
    },
  }
}

function importedAssistant(nativeID: string, legacyID: string, legacyParentID: string, text: string, created: number) {
  return {
    id: nativeID,
    type: "assistant",
    time: { created, completed: created + 1 },
    metadata: {
      legacy: {
        info: {
          id: legacyID,
          sessionID: "ses_old",
          role: "assistant",
          time: { created, completed: created + 1 },
          parentID: legacyParentID,
          modelID: "model",
          providerID: "provider",
          variant: "careful",
          mode: "build",
          agent: "build",
          path: { cwd: directory, root: directory },
          cost: 0,
          tokens: {
            input: 0,
            output: 0,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          },
        },
        parts: [
          {
            id: `prt_${legacyID}`,
            sessionID: "ses_old",
            messageID: legacyID,
            type: "text",
            text,
          },
        ],
      },
    },
  }
}

function canonicalEvent(type: string, data: Readonly<Record<string, unknown>>) {
  return {
    id: `evt_${type}`,
    type,
    data,
    location: {
      directory,
      workspaceID: "workspace",
    },
  }
}

async function collectEvents(iterable: AsyncIterable<EventEnvelope>) {
  const result: EventEnvelope[] = []
  for await (const event of iterable) result.push(event)
  return result
}

type ProjectedEvent = {
  readonly type: string
  readonly properties: Readonly<Record<string, unknown>>
}

function projected(events: readonly EventEnvelope[]) {
  return events.map((event) => event.payload) as unknown as readonly ProjectedEvent[]
}

afterAll(() => {
  expect(
    suiteRequests
      .flatMap((requests) => requests)
      .map((request) => request.url.pathname)
      .filter((path) => !path.startsWith("/api") && path !== "/mcp"),
  ).toEqual([])
})

test("legacy ACP client construction is confined to the facade", async () => {
  const source = path.join(import.meta.dir, "../../src/acp")
  const files = (await readdir(source)).filter((file) => file.endsWith(".ts"))
  const contents = await Promise.all(
    files.map(async (file) => ({
      file,
      content: await Bun.file(path.join(source, file)).text(),
    })),
  )

  for (const marker of ["@opencode-ai/sdk/v2", "createOpencodeClient"]) {
    expect(contents.filter((item) => item.content.includes(marker)).map((item) => item.file)).toEqual(["client.ts"])
  }

  const command = await Bun.file(path.join(import.meta.dir, "../../src/cli/cmd/acp.ts")).text()
  expect(command).toContain('import { ACPClient } from "@/acp/client"')
  expect(command).not.toContain("@opencode-ai/sdk/v2")
  expect(command).not.toContain("createOpencodeClient")
})

describe("ACP client transport and Session lifecycle", () => {
  test("native and fallback requests share the supplied fetch, base URL, headers, and allowlisted routes", async () => {
    const recording = makeFacade((request) => {
      if (request.url.pathname === "/api/session") {
        return json({ data: nativeSession("ses_created") })
      }
      if (request.url.pathname === "/mcp") return json({})
      throw new Error(`Unexpected request: ${request.method} ${request.url}`)
    })

    await recording.client.session.create({ directory })
    await recording.client.mcp.add({
      directory,
      name: "runtime",
      config: { type: "remote", url: "https://mcp.test/rpc" },
    })

    expect(recording.requests).toHaveLength(2)
    expect(recording.requests.every((request) => request.fetchID === recording.fetchID)).toBe(true)
    expect(recording.requests.map((request) => request.url.origin)).toEqual([baseUrl, baseUrl])
    expect(recording.requests.map((request) => request.headers.get("authorization"))).toEqual([
      authorization,
      authorization,
    ])
    expect(
      recording.requests
        .filter((request) => !request.url.pathname.startsWith("/api"))
        .map((request) => request.url.pathname),
    ).toEqual(["/mcp"])
  })

  test("create, get, list, fork, and interrupt use only their native Session routes", async () => {
    const recording = makeFacade((request) => {
      const path = request.url.pathname
      if (request.method === "POST" && path === "/api/session") {
        return json({ data: nativeSession("ses_created") })
      }
      if (request.method === "GET" && path === "/api/session/ses_existing") {
        return json({ data: nativeSession("ses_existing") })
      }
      if (request.method === "GET" && path === "/api/session") {
        return json({ data: [nativeSession("ses_listed")], cursor: {} })
      }
      if (request.method === "POST" && path === "/api/session/ses_existing/fork") {
        return json({ data: nativeSession("ses_forked", "ses_existing") })
      }
      if (request.method === "POST" && path === "/api/session/ses_existing/interrupt") return empty()
      throw new Error(`Unexpected request: ${request.method} ${request.url}`)
    })

    await recording.client.session.create({
      directory,
      agent: "review",
      model: { providerID: "provider", modelID: "model", variant: "careful" },
    })
    await recording.client.session.get({ sessionID: "ses_existing" })
    await recording.client.session.list({ directory })
    await recording.client.session.fork({ sessionID: "ses_existing", messageID: "msg_fork" })
    await recording.client.session.interrupt({ sessionID: "ses_existing" })

    expect(recording.requests.map((request) => [request.method, request.url.pathname])).toEqual([
      ["POST", "/api/session"],
      ["GET", "/api/session/ses_existing"],
      ["GET", "/api/session"],
      ["POST", "/api/session/ses_existing/fork"],
      ["POST", "/api/session/ses_existing/interrupt"],
    ])
    expect(recording.requests[0]?.body).toEqual({
      agent: "review",
      model: { providerID: "provider", id: "model", variant: "careful" },
      location: { directory },
    })
    expect(recording.requests[2]?.url.searchParams.get("directory")).toBe(directory)
    expect(recording.requests[3]?.body).toEqual({ messageID: "msg_fork" })
  })

  test("Session list follows cursor.next past 100, stops on an unchanged cursor, and retains parentID", async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => nativeSession(`ses_${index}`))
    const recording = makeFacade((request) => {
      if (request.url.pathname !== "/api/session") {
        throw new Error(`Unexpected request: ${request.method} ${request.url}`)
      }
      if (!request.url.searchParams.has("cursor")) {
        return json({ data: firstPage, cursor: { next: "page-2" } })
      }
      return json({
        data: [nativeSession("ses_child", "ses_parent")],
        cursor: { next: "page-2" },
      })
    })

    const sessions = await recording.client.session.list({ directory })

    expect(sessions).toHaveLength(101)
    expect(sessions.at(-1)).toMatchObject({ id: "ses_child", parentID: "ses_parent" })
    expect(recording.requests).toHaveLength(2)
    expect(recording.requests.map((request) => request.url.searchParams.get("cursor"))).toEqual([null, "page-2"])
    expect(recording.requests.map((request) => request.url.searchParams.get("limit"))).toEqual(["100", "100"])
  })
})

describe("ACP client transcript projection", () => {
  test("mixed pages follow cursor.next and preserve imported/canonical chronology", async () => {
    const recording = makeFacade((request) => {
      if (request.url.pathname === "/api/session/ses_mixed") {
        return json({ data: nativeSession("ses_mixed") })
      }
      if (request.url.pathname !== "/api/session/ses_mixed/message") {
        throw new Error(`Unexpected request: ${request.method} ${request.url}`)
      }
      if (!request.url.searchParams.has("cursor")) {
        return json({
          data: [
            importedUser("msg_imported_user", "msg_old_user", "imported user", 10),
            importedAssistant("msg_imported_assistant", "msg_old_assistant", "msg_old_user", "imported assistant", 20),
          ],
          cursor: { next: "page-2" },
        })
      }
      return json({
        data: [
          nativeUser("msg_native_user", "native user", 30),
          nativeAssistant("msg_native_assistant", "native assistant", 40, 50),
        ],
        cursor: {},
      })
    })

    const messages = await recording.client.session.messages({ sessionID: "ses_mixed" })

    expect(messages.map((message) => message.info.id)).toEqual([
      "msg_imported_user",
      "msg_imported_assistant",
      "msg_native_user",
      "msg_native_assistant",
    ])
    expect(messages.map((message) => message.parts[0]?.type === "text" && message.parts[0].text)).toEqual([
      "imported user",
      "imported assistant",
      "native user",
      "native assistant",
    ])
    expect(messages[1]?.info).toMatchObject({ parentID: "msg_imported_user" })
    expect(messages[3]?.info).toMatchObject({ parentID: "msg_native_user", variant: "careful" })
    const pages = recording.requests.filter((request) => request.url.pathname === "/api/session/ses_mixed/message")
    expect(pages.map((request) => request.url.searchParams.get("cursor"))).toEqual([null, "page-2"])
    expect(pages.map((request) => request.url.searchParams.get("order"))).toEqual(["asc", null])
    expect(pages.map((request) => request.url.searchParams.get("limit"))).toEqual(["100", "100"])
  })

  test("individual lookup uses the native message route before projecting the full transcript", async () => {
    const message = nativeUser("msg_target", "target", 10)
    const recording = makeFacade((request) => {
      if (request.url.pathname === "/api/session/ses_lookup/message/msg_target") {
        return json({ data: message })
      }
      if (request.url.pathname === "/api/session/ses_lookup") {
        return json({ data: nativeSession("ses_lookup") })
      }
      if (request.url.pathname === "/api/session/ses_lookup/message") {
        return json({ data: [message], cursor: {} })
      }
      throw new Error(`Unexpected request: ${request.method} ${request.url}`)
    })

    const result = await recording.client.session.message({
      sessionID: "ses_lookup",
      messageID: "msg_target",
    })

    expect(result?.info.id).toBe("msg_target")
    expect(recording.requests.map((request) => request.url.pathname)).toEqual([
      "/api/session/ses_lookup/message/msg_target",
      "/api/session/ses_lookup",
      "/api/session/ses_lookup/message",
    ])
  })

  test("canonical native assistant failures project the legacy structures used by ACP stop reasons", async () => {
    const cases = [
      {
        native: {
          finish: "error",
          error: { type: "unknown" as const, message: "Provider turn interrupted" },
        },
        legacy: {
          name: "MessageAbortedError",
          data: { message: "Provider turn interrupted" },
        },
      },
      {
        native: {
          finish: "length",
        },
        legacy: { name: "MessageOutputLengthError", data: {} },
      },
      {
        native: {
          finish: "length",
          error: {
            type: "unknown" as const,
            message: AssistantErrorCodec.encode("conflicting authentication", "authentication"),
          },
        },
        legacy: { name: "MessageOutputLengthError", data: {} },
      },
      {
        native: {
          finish: "error",
          error: {
            type: "unknown" as const,
            message: AssistantErrorCodec.encode("login required", "authentication"),
          },
        },
        legacy: {
          name: "ProviderAuthError",
          data: { providerID: "provider", message: "login required" },
        },
      },
      {
        native: {
          finish: "content-filter",
        },
        legacy: {
          name: "ContentFilterError",
          data: { message: "Response blocked by content filter" },
        },
      },
      {
        native: {
          finish: "error",
          error: { type: "unknown" as const, message: "unauthorized login token expired" },
        },
        legacy: { name: "UnknownError", data: { message: "unauthorized login token expired" } },
      },
      {
        native: {
          finish: "error",
          error: { type: "unknown" as const, message: "Provider turn interrupted." },
        },
        legacy: { name: "UnknownError", data: { message: "Provider turn interrupted." } },
      },
      {
        native: {
          finish: "error",
          error: {
            type: "unknown" as const,
            message: AssistantErrorCodec.encode(AssistantErrorCodec.encode("spoofed authentication", "authentication")),
          },
        },
        legacy: {
          name: "UnknownError",
          data: {
            message: AssistantErrorCodec.encode("spoofed authentication", "authentication"),
          },
        },
      },
    ] as const
    const messages = cases.flatMap((item, index) => {
      return [
        nativeUser(`msg_user_${index}`, `user ${index}`, index * 10),
        nativeAssistant(`msg_assistant_${index}`, `assistant ${index}`, index * 10 + 1, index * 10 + 2, item.native),
      ]
    })
    const recording = makeFacade((request) => {
      if (request.url.pathname === "/api/session/ses_errors") {
        return json({ data: nativeSession("ses_errors") })
      }
      if (request.url.pathname === "/api/session/ses_errors/message") {
        return json({ data: messages, cursor: {} })
      }
      throw new Error(`Unexpected request: ${request.method} ${request.url}`)
    })

    const transcript = await recording.client.session.messages({ sessionID: "ses_errors" })

    expect(
      transcript.flatMap((message) => (message.info.role === "assistant" ? [message.info.error?.name] : [])),
    ).toEqual(cases.map((item) => item.legacy.name))
    expect(transcript.flatMap((message) => (message.info.role === "assistant" ? [message.info.error] : []))).toEqual(
      cases.map((item) => item.legacy),
    )
  })
})

describe("ACP client completion boundary", () => {
  test("prompt preserves variant and supported parts, orders selection/admission/wait/transcript, and selects by parent", async () => {
    const recording = makeFacade((request) => {
      const path = request.url.pathname
      if (
        path === "/api/session/ses_prompt/agent" ||
        path === "/api/session/ses_prompt/model" ||
        path === "/api/session/ses_prompt/wait"
      ) {
        return empty()
      }
      if (path === "/api/session/ses_prompt/prompt") {
        return json({ data: { id: "msg_admitted", sessionID: "ses_prompt", admittedSeq: 1 } })
      }
      if (path === "/api/session/ses_prompt") return json({ data: nativeSession("ses_prompt") })
      if (path === "/api/session/ses_prompt/message") {
        return json({
          data: [
            nativeUser("msg_admitted", "prompt", 10),
            nativeAssistant("msg_correct", "correct", 20, 21),
            nativeUser("msg_coalesced", "other prompt", 30),
            nativeAssistant("msg_other", "other", 40, 41),
          ],
          cursor: {},
        })
      }
      throw new Error(`Unexpected request: ${request.method} ${request.url}`)
    })

    const result = await recording.client.session.prompt({
      sessionID: "ses_prompt",
      agent: "review",
      model: { providerID: "provider", modelID: "model" },
      variant: "careful",
      parts: [
        { type: "text", text: "visible" },
        { type: "text", text: "+synthetic", synthetic: true },
        { type: "text", text: "+ignored", ignored: true },
        {
          type: "file",
          url: "file:///workspace/project/source.ts",
          filename: "source.ts",
          mime: "text/typescript",
          source: {
            type: "file",
            path: "/workspace/project/source.ts",
            text: { value: "const value = 1", start: 0, end: 15 },
          },
        },
        {
          type: "file",
          url: "mcp://docs/context",
          filename: "context.txt",
          mime: "text/plain",
          source: {
            type: "resource",
            clientName: "docs",
            uri: "mcp://docs/context",
            text: { value: "context", start: 1, end: 8 },
          },
        },
      ],
    })

    if (result === ACPClient.CompletionCancelled) throw new Error("Prompt was unexpectedly cancelled")
    expect(result.info.id).toBe("msg_correct")
    expect(result.info).toMatchObject({ parentID: "msg_admitted", variant: "careful" })
    expect(recording.requests.map((request) => request.url.pathname)).toEqual([
      "/api/session/ses_prompt/agent",
      "/api/session/ses_prompt/model",
      "/api/session/ses_prompt/prompt",
      "/api/session/ses_prompt/wait",
      "/api/session/ses_prompt",
      "/api/session/ses_prompt/message",
    ])
    expect(recording.requests[0]?.body).toEqual({ agent: "review" })
    expect(recording.requests[1]?.body).toEqual({
      model: { providerID: "provider", id: "model", variant: "careful" },
    })
    expect(recording.requests[2]?.body).toEqual({
      prompt: {
        text: "visible+synthetic",
        files: [
          {
            uri: "file:///workspace/project/source.ts",
            mime: "text/typescript",
            name: "source.ts",
            source: { text: "const value = 1", start: 0, end: 15 },
          },
          {
            uri: "mcp://docs/context",
            mime: "text/plain",
            name: "context.txt",
            source: { text: "context", start: 1, end: 8 },
            resource: { clientName: "docs", uri: "mcp://docs/context" },
          },
        ],
      },
      resume: true,
    })
    expect(
      recording.requests.filter((request) => request.url.pathname === "/api/session/ses_prompt/wait"),
    ).toHaveLength(1)
  })

  test("command preserves command, arguments, file/resource source, variant, and waits exactly once", async () => {
    const recording = makeFacade((request) => {
      const path = request.url.pathname
      if (
        path === "/api/session/ses_command/agent" ||
        path === "/api/session/ses_command/model" ||
        path === "/api/session/ses_command/wait"
      ) {
        return empty()
      }
      if (path === "/api/session/ses_command/command") {
        return json({ data: { id: "msg_command", sessionID: "ses_command", admittedSeq: 1 } })
      }
      if (path === "/api/session/ses_command") return json({ data: nativeSession("ses_command") })
      if (path === "/api/session/ses_command/message") {
        return json({
          data: [
            nativeUser("msg_command", "/review changes", 10),
            nativeAssistant("msg_command_assistant", "done", 20, 21),
          ],
          cursor: {},
        })
      }
      throw new Error(`Unexpected request: ${request.method} ${request.url}`)
    })

    const result = await recording.client.session.command({
      sessionID: "ses_command",
      command: "review",
      arguments: "changes",
      agent: "review",
      model: { providerID: "provider", modelID: "model" },
      variant: "thorough",
      parts: [
        {
          type: "file",
          url: "file:///workspace/project/change.diff",
          filename: "change.diff",
          mime: "text/x-diff",
          source: {
            type: "file",
            path: "/workspace/project/change.diff",
            text: { value: "@@ change", start: 0, end: 9 },
          },
        },
        {
          type: "file",
          url: "mcp://review/rules",
          filename: "rules.md",
          mime: "text/markdown",
          source: {
            type: "resource",
            clientName: "review",
            uri: "mcp://review/rules",
            text: { value: "rules", start: 0, end: 5 },
          },
        },
      ],
    })

    if (result === ACPClient.CompletionCancelled) throw new Error("Command was unexpectedly cancelled")
    expect(result.info).toMatchObject({
      id: "msg_command_assistant",
      parentID: "msg_command",
      variant: "careful",
    })
    const command = recording.requests.find((request) => request.url.pathname === "/api/session/ses_command/command")
    expect(
      recording.requests.find((request) => request.url.pathname === "/api/session/ses_command/agent")?.body,
    ).toEqual({ agent: "review" })
    expect(command?.body).toEqual({
      command: "review",
      arguments: "changes",
      agent: "review",
      model: { providerID: "provider", id: "model", variant: "thorough" },
      files: [
        {
          uri: "file:///workspace/project/change.diff",
          mime: "text/x-diff",
          name: "change.diff",
          source: { text: "@@ change", start: 0, end: 9 },
        },
        {
          uri: "mcp://review/rules",
          mime: "text/markdown",
          name: "rules.md",
          source: { text: "rules", start: 0, end: 5 },
          resource: { clientName: "review", uri: "mcp://review/rules" },
        },
      ],
      resume: true,
    })
    expect(
      recording.requests.filter((request) => request.url.pathname === "/api/session/ses_command/wait"),
    ).toHaveLength(1)
  })

  test("missing matching assistant rejects at the stable Session boundary after one wait", async () => {
    const recording = makeFacade((request) => {
      const path = request.url.pathname
      if (path === "/api/session/ses_missing/model" || path === "/api/session/ses_missing/wait") {
        return empty()
      }
      if (path === "/api/session/ses_missing/prompt") {
        return json({ data: { id: "msg_missing", sessionID: "ses_missing", admittedSeq: 1 } })
      }
      if (path === "/api/session/ses_missing") return json({ data: nativeSession("ses_missing") })
      if (path === "/api/session/ses_missing/message") {
        return json({
          data: [nativeUser("msg_other_user", "other", 10), nativeAssistant("msg_other_assistant", "other", 20, 21)],
          cursor: {},
        })
      }
      throw new Error(`Unexpected request: ${request.method} ${request.url}`)
    })

    await expect(
      recording.client.session.prompt({
        sessionID: "ses_missing",
        model: { providerID: "provider", modelID: "model" },
        parts: [{ type: "text", text: "prompt" }],
      }),
    ).rejects.toThrow("Completed assistant message not found for msg_missing")
    expect(
      recording.requests.filter((request) => request.url.pathname === "/api/session/ses_missing/wait"),
    ).toHaveLength(1)
  })

  test("interrupt maps a missing assistant to cancelled without weakening the missing-message invariant", async () => {
    const waiting = Promise.withResolvers<Response>()
    const recording = makeFacade((request) => {
      const path = request.url.pathname
      if (path === "/api/session/ses_cancel/model") return empty()
      if (path === "/api/session/ses_cancel/prompt") {
        return json({ data: { id: "msg_cancel", sessionID: "ses_cancel", admittedSeq: 1 } })
      }
      if (path === "/api/session/ses_cancel/wait") return waiting.promise
      if (path === "/api/session/ses_cancel/interrupt") return empty()
      if (path === "/api/session/ses_cancel") return json({ data: nativeSession("ses_cancel") })
      if (path === "/api/session/ses_cancel/message") {
        return json({ data: [nativeUser("msg_cancel", "prompt", 10)], cursor: {} })
      }
      throw new Error(`Unexpected request: ${request.method} ${request.url}`)
    })

    const completion = recording.client.session.prompt({
      sessionID: "ses_cancel",
      model: { providerID: "provider", modelID: "model" },
      parts: [{ type: "text", text: "prompt" }],
    })
    while (!recording.requests.some((request) => request.url.pathname.endsWith("/wait"))) {
      await Bun.sleep(1)
    }
    await recording.client.session.interrupt({ sessionID: "ses_cancel" })
    waiting.resolve(empty())

    expect(await completion).toBe(ACPClient.CompletionCancelled)
  })

  test("compact invokes compact then wait without reading or fabricating a message", async () => {
    const recording = makeFacade((request) => {
      if (
        request.url.pathname === "/api/session/ses_compact/compact" ||
        request.url.pathname === "/api/session/ses_compact/wait"
      ) {
        return empty()
      }
      throw new Error(`Unexpected request: ${request.method} ${request.url}`)
    })

    const result = await recording.client.session.compact({ sessionID: "ses_compact" })

    expect(result).toBeUndefined()
    expect(recording.requests.map((request) => request.url.pathname)).toEqual([
      "/api/session/ses_compact/compact",
      "/api/session/ses_compact/wait",
    ])
  })
})

describe("ACP client EventV2 boundary", () => {
  test("each subscription has isolated projection state", async () => {
    const streams = [
      [
        canonicalEvent("session.next.prompted", {
          sessionID: "ses_events",
          messageID: "msg_first_user",
        }),
        canonicalEvent("session.next.step.started", {
          sessionID: "ses_events",
          assistantMessageID: "msg_shared_assistant",
          agent: "build",
          model: { providerID: "provider", id: "model" },
          timestamp: 10,
        }),
      ],
      [
        canonicalEvent("session.next.step.started", {
          sessionID: "ses_events",
          assistantMessageID: "msg_shared_assistant",
          agent: "build",
          model: { providerID: "provider", id: "model" },
          timestamp: 20,
        }),
      ],
    ]
    const recording = makeFacade((request) => {
      if (request.url.pathname !== "/api/event") {
        throw new Error(`Unexpected request: ${request.method} ${request.url}`)
      }
      return eventStream(streams.shift() ?? [])
    })

    const first = projected(await collectEvents(recording.client.events.subscribe()))
    const second = projected(await collectEvents(recording.client.events.subscribe()))
    const firstInfo = first.find((event) => event.type === "message.updated")?.properties.info
    const secondInfo = second.find((event) => event.type === "message.updated")?.properties.info

    expect(firstInfo).toMatchObject({ parentID: "msg_first_user" })
    expect(secondInfo).toMatchObject({ parentID: "msg_shared_assistant" })
    expect(recording.requests.map((request) => request.url.pathname)).toEqual(["/api/event", "/api/event"])
  })

  test("malformed projection is skipped and a following valid event reaches the same iterator", async () => {
    const recording = makeFacade((request) => {
      if (request.url.pathname !== "/api/event") {
        throw new Error(`Unexpected request: ${request.method} ${request.url}`)
      }
      return eventStream([
        canonicalEvent("session.next.step.started", {
          sessionID: "ses_events",
          assistantMessageID: "msg_malformed",
          agent: "build",
          model: { providerID: "provider", id: "model" },
          timestamp: null,
        }),
        canonicalEvent("permission.v2.asked", {
          id: "per_after_malformed",
          sessionID: "ses_events",
          action: "read",
          resources: ["file.txt"],
        }),
      ])
    })

    const events = projected(await collectEvents(recording.client.events.subscribe()))

    expect(events.some((event) => event.type === "session.next.step.started")).toBe(false)
    expect(events.filter((event) => event.type === "permission.v2.asked")).toHaveLength(1)
    expect(events.filter((event) => event.type === "permission.asked")).toHaveLength(1)
  })

  test("text, reasoning, tool progress/completion, attachment, permission, and error project once", async () => {
    const step = { sessionID: "ses_events", assistantMessageID: "msg_assistant" }
    const recording = makeFacade((request) => {
      if (request.url.pathname !== "/api/event") {
        throw new Error(`Unexpected request: ${request.method} ${request.url}`)
      }
      return eventStream([
        canonicalEvent("session.next.prompted", {
          sessionID: "ses_events",
          messageID: "msg_user",
        }),
        canonicalEvent("session.next.step.started", {
          ...step,
          agent: "build",
          model: { providerID: "provider", id: "model", variant: "careful" },
          timestamp: 10,
        }),
        canonicalEvent("session.next.text.started", {
          ...step,
          textID: "text",
          timestamp: 11,
        }),
        canonicalEvent("session.next.text.delta", {
          ...step,
          textID: "text",
          delta: "hello",
          timestamp: 12,
        }),
        canonicalEvent("session.next.text.ended", {
          ...step,
          textID: "text",
          text: "hello",
          timestamp: 13,
        }),
        canonicalEvent("session.next.reasoning.started", {
          ...step,
          reasoningID: "reasoning",
          timestamp: 14,
        }),
        canonicalEvent("session.next.reasoning.delta", {
          ...step,
          reasoningID: "reasoning",
          delta: "think",
          timestamp: 15,
        }),
        canonicalEvent("session.next.reasoning.ended", {
          ...step,
          reasoningID: "reasoning",
          text: "think",
          timestamp: 16,
        }),
        canonicalEvent("session.next.tool.input.started", {
          ...step,
          callID: "call",
          name: "read",
          timestamp: 17,
        }),
        canonicalEvent("session.next.tool.called", {
          ...step,
          callID: "call",
          input: { path: "file.txt" },
          timestamp: 18,
        }),
        canonicalEvent("session.next.tool.progress", {
          ...step,
          callID: "call",
          structured: { title: "Reading" },
          content: [{ type: "text", text: "partial" }],
          timestamp: 19,
        }),
        canonicalEvent("session.next.tool.success", {
          ...step,
          callID: "call",
          structured: { title: "Read" },
          content: [
            { type: "text", text: "done" },
            { type: "file", uri: "file:///result.txt", mime: "text/plain", name: "result.txt" },
          ],
          timestamp: 20,
        }),
        canonicalEvent("permission.v2.asked", {
          id: "per_test",
          sessionID: "ses_events",
          action: "read",
          resources: ["file.txt"],
          save: ["*.txt"],
          metadata: { reason: "test" },
        }),
        canonicalEvent("session.next.step.failed", {
          ...step,
          error: { type: "unknown", message: "provider failed" },
          timestamp: 21,
        }),
      ])
    })

    const envelopes = await collectEvents(recording.client.events.subscribe())
    const events = projected(envelopes)
    const partEvents = events.filter((event) => event.type === "message.part.updated") as unknown as ReadonlyArray<{
      readonly type: "message.part.updated"
      readonly properties: {
        readonly sessionID: string
        readonly time: number
        readonly part: {
          readonly [key: string]: unknown
          readonly type: string
          readonly text?: string
          readonly state?: {
            readonly [key: string]: unknown
            readonly status?: string
            readonly title?: string
            readonly attachments?: readonly unknown[]
          }
        }
      }
    }>
    const updatedParts = partEvents.map((event) => event.properties.part)

    expect(envelopes.every((event) => event.directory === directory && event.workspace === "workspace")).toBe(true)
    expect(
      partEvents
        .filter((event) => event.properties.part.type === "text")
        .map((event) => ({ type: event.type, properties: event.properties })),
    ).toEqual([
      {
        type: "message.part.updated",
        properties: {
          sessionID: "ses_events",
          part: {
            id: "prt_msg_assistant_text_0",
            sessionID: "ses_events",
            messageID: "msg_assistant",
            type: "text",
            text: "",
            time: { start: 11 },
          },
          time: 11,
        },
      },
      {
        type: "message.part.updated",
        properties: {
          sessionID: "ses_events",
          part: {
            id: "prt_msg_assistant_text_0",
            sessionID: "ses_events",
            messageID: "msg_assistant",
            type: "text",
            text: "hello",
            time: { start: 11, end: 13 },
          },
          time: 13,
        },
      },
    ])
    expect(
      partEvents
        .filter((event) => event.properties.part.type === "reasoning")
        .map((event) => ({ type: event.type, properties: event.properties })),
    ).toEqual([
      {
        type: "message.part.updated",
        properties: {
          sessionID: "ses_events",
          part: {
            id: "prt_msg_assistant_reasoning_1",
            sessionID: "ses_events",
            messageID: "msg_assistant",
            type: "reasoning",
            text: "",
            time: { start: 14 },
          },
          time: 14,
        },
      },
      {
        type: "message.part.updated",
        properties: {
          sessionID: "ses_events",
          part: {
            id: "prt_msg_assistant_reasoning_1",
            sessionID: "ses_events",
            messageID: "msg_assistant",
            type: "reasoning",
            text: "think",
            time: { start: 14, end: 16 },
          },
          time: 16,
        },
      },
    ])
    expect(
      partEvents
        .filter((event) => event.properties.time === 19)
        .map((event) => ({ type: event.type, properties: event.properties })),
    ).toEqual([
      {
        type: "message.part.updated",
        properties: {
          sessionID: "ses_events",
          part: {
            id: "prt_msg_assistant_tool_2",
            sessionID: "ses_events",
            messageID: "msg_assistant",
            type: "tool",
            callID: "call",
            tool: "read",
            state: {
              status: "running",
              input: { path: "file.txt" },
              title: "Reading",
              metadata: { title: "Reading" },
              time: { start: 18 },
            },
          },
          time: 19,
        },
      },
    ])
    expect(
      events
        .filter((event) => event.type === "message.part.delta")
        .map((event) => ({ type: event.type, properties: event.properties })),
    ).toEqual([
      {
        type: "message.part.delta",
        properties: {
          sessionID: "ses_events",
          messageID: "msg_assistant",
          partID: "prt_msg_assistant_text_0",
          field: "text",
          delta: "hello",
        },
      },
      {
        type: "message.part.delta",
        properties: {
          sessionID: "ses_events",
          messageID: "msg_assistant",
          partID: "prt_msg_assistant_reasoning_1",
          field: "text",
          delta: "think",
        },
      },
    ])
    const completed = updatedParts.filter((part) => part.type === "tool" && part.state?.status === "completed")
    expect(completed).toEqual([
      {
        id: "prt_msg_assistant_tool_2",
        sessionID: "ses_events",
        messageID: "msg_assistant",
        type: "tool",
        callID: "call",
        tool: "read",
        state: {
          status: "completed",
          input: { path: "file.txt" },
          output: "done\nfile:///result.txt",
          title: "Read",
          metadata: { title: "Read" },
          time: { start: 18, end: 20 },
          attachments: [
            {
              id: "prt_msg_assistant_tool-file-2_0",
              sessionID: "ses_events",
              messageID: "msg_assistant",
              type: "file",
              mime: "text/plain",
              filename: "result.txt",
              url: "file:///result.txt",
            },
          ],
        },
      },
    ])
    expect(events.filter((event) => event.type === "permission.asked").map((event) => event.properties)).toEqual([
      {
        id: "per_test",
        sessionID: "ses_events",
        permission: "read",
        patterns: ["file.txt"],
        metadata: { reason: "test" },
        always: ["*.txt"],
      },
    ])
    expect(events.filter((event) => event.type === "session.error").map((event) => event.properties)).toEqual([
      {
        sessionID: "ses_events",
        error: {
          name: "UnknownError",
          data: { message: "provider failed" },
        },
      },
    ])
  })
})

describe("ACP client permission, catalog, and fallback boundaries", () => {
  test("permission reply posts Session ID, request ID, and reply to the native route", async () => {
    const recording = makeFacade((request) => {
      if (request.url.pathname === "/api/session/ses_permission/permission/per_request/reply") return empty()
      throw new Error(`Unexpected request: ${request.method} ${request.url}`)
    })

    await recording.client.permission.reply({
      sessionID: "ses_permission",
      requestID: "per_request",
      reply: "always",
    })

    expect(recording.requests).toHaveLength(1)
    expect(recording.requests[0]?.method).toBe("POST")
    expect(recording.requests[0]?.body).toEqual({ reply: "always" })
    expect(recording.requests[0]?.url.pathname).toBe("/api/session/ses_permission/permission/per_request/reply")
  })

  test("one provider catalog and four supporting reads use /api and one Location", async () => {
    const location = {
      directory,
      project: { id: "project", directory },
    }
    const recording = makeFacade((request) => {
      const data = (() => {
        if (request.url.pathname === "/api/provider/catalog")
          return {
            providers: [
              {
                info: {
                  id: "provider",
                  name: "Provider",
                  api: { type: "aisdk", package: "@ai-sdk/openai" },
                  request: { headers: {}, body: {} },
                },
                source: "api",
                auth: "key",
                env: ["PROVIDER_API_KEY"],
              },
            ],
            models: [
              {
                id: "model",
                providerID: "provider",
                name: "Model",
                api: { id: "model", type: "aisdk", package: "@ai-sdk/openai" },
                capabilities: { tools: true, input: ["text"], output: ["text"] },
                request: { headers: {}, body: {} },
                variants: [],
                time: { released: 1 },
                cost: [{ input: 1, output: 2, cache: { read: 0, write: 0 } }],
                status: "active",
                enabled: true,
                limit: { context: 128_000, output: 8_192 },
              },
            ],
            connected: ["provider"],
            default: { provider: "model" },
          }
        if (request.url.pathname === "/api/agent") return []
        if (request.url.pathname === "/api/command") {
          return [
            { name: "zeta", template: "zeta command" },
            { name: "beta", template: "beta command", description: "command wins" },
          ]
        }
        if (request.url.pathname === "/api/skill") {
          return [
            { name: "beta", content: "beta skill", location: "/skills/beta" },
            { name: "alpha", content: "alpha skill", location: "/skills/alpha" },
          ]
        }
        return undefined
      })()
      if (data) return json({ location, data })
      if (request.url.pathname === "/api/config") {
        return json({ location, data: { model: "provider/configured", ignored: true } })
      }
      throw new Error(`Unexpected request: ${request.method} ${request.url}`)
    })

    const catalog = await recording.client.catalog.load(directory)

    expect(recording.requests.map((request) => request.url.pathname).toSorted()).toEqual([
      "/api/agent",
      "/api/command",
      "/api/config",
      "/api/provider/catalog",
      "/api/skill",
    ])
    expect(recording.requests.every((request) => request.url.pathname.startsWith("/api"))).toBe(true)
    expect(recording.requests.map((request) => request.url.searchParams.get("location[directory]"))).toEqual(
      Array.from({ length: 5 }, () => directory),
    )
    expect(catalog.providers[ProviderV2.ID.make("provider")]).toMatchObject({
      id: "provider",
      name: "Provider",
      source: "api",
      auth: "key",
      env: ["PROVIDER_API_KEY"],
      models: { model: { id: "model", name: "Model" } },
    })
    expect(catalog.commands.map((command) => command.name)).toEqual(["alpha", "beta", "zeta"])
    expect(catalog.commands.find((command) => command.name === "beta")).toMatchObject({
      template: "beta command",
      description: "command wins",
    })
    expect(catalog.commands.find((command) => command.name === "alpha")).toMatchObject({
      source: "skill",
      template: "alpha skill",
    })
    expect(catalog.configuredModel).toBe("provider/configured")
  })

  test("MCP add is the sole non-/api request and preserves its dynamic configuration", async () => {
    const recording = makeFacade((request) => {
      if (request.url.pathname === "/api/config") {
        return json({
          location: { directory, project: { id: "project", directory } },
          data: { model: "provider/model" },
        })
      }
      if (request.url.pathname === "/mcp") return json({})
      throw new Error(`Unexpected request: ${request.method} ${request.url}`)
    })

    await recording.client.config.get(directory)
    await recording.client.mcp.add({
      directory,
      name: "dynamic",
      config: {
        type: "local",
        command: ["bun", "run", "server.ts"],
        environment: { MODE: "test" },
      },
    })

    expect(
      recording.requests
        .filter((request) => !request.url.pathname.startsWith("/api"))
        .map((request) => request.url.pathname),
    ).toEqual(["/mcp"])
    const mcp = recording.requests.find((request) => request.url.pathname === "/mcp")
    expect(mcp?.method).toBe("POST")
    expect(mcp?.body).toEqual({
      name: "dynamic",
      config: {
        type: "local",
        command: ["bun", "run", "server.ts"],
        environment: { MODE: "test" },
      },
    })
    expect(mcp?.url.searchParams.get("directory")).toBe(directory)
  })
})
