import { describe, expect } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { pathToFileURL } from "url"
import { LLMError, Message, Model, type ToolContent } from "@opencode-ai/llm"
import * as OpenAIChat from "@opencode-ai/llm/protocols/openai-chat"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNodePlatform } from "@opencode-ai/core/effect/app-node-platform"
import { MCP } from "@opencode-ai/core/mcp"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { SessionAttachment } from "@opencode-ai/core/session/attachment"
import { SessionMessage } from "@opencode-ai/core/session/message"
import type { FileAttachment } from "@opencode-ai/core/session/prompt"
import { SessionRunnerToolResultPreparation } from "@opencode-ai/core/session/runner/tool-result-preparation"
import { toLLMMessages } from "@opencode-ai/core/session/runner/to-llm-message"
import { DateTime, Effect, Layer } from "effect"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

let response = new Response("remote text", {
  headers: { "content-type": "text/plain" },
})
const requests: string[] = []
const resources: Array<{ readonly clientName: string; readonly uri: string }> = []

const http = Layer.succeed(
  HttpClient.HttpClient,
  HttpClient.make((request) =>
    Effect.sync(() => {
      requests.push(request.url)
      return HttpClientResponse.fromWeb(request, response)
    }),
  ),
)

const mcp = Layer.mock(MCP.Service, {
  readResource: (clientName, uri) =>
    Effect.sync(() => {
      resources.push({ clientName, uri })
      return undefined
    }),
})

const layer = Layer.fresh(
  AppNodeBuilder.build(SessionAttachment.node, [
    [LayerNodePlatform.httpClient, http],
    [MCP.node, mcp],
  ]),
)
const it = testEffect(layer)
const model = Model.make({ id: "model", provider: "provider", route: OpenAIChat.route })
const provenance = {
  type: "mcp",
  clientName: "docs",
  uri: "mcp://docs/historical",
  kind: "resource_link",
  meta: { result: { trace: "original" } },
} as const

const reset = () => {
  requests.length = 0
  resources.length = 0
  response = new Response("remote text", {
    headers: { "content-type": "text/plain" },
  })
}

const toolMessage = (content: ReadonlyArray<ToolContent>) =>
  Message.tool({
    id: "call-prepare",
    name: "inspect",
    result: { type: "content", value: content },
  })

const resultContent = (messages: ReadonlyArray<Message>) => {
  const part = messages.flatMap((message) => message.content).find((content) => content.type === "tool-result")
  if (part?.type !== "tool-result" || part.result.type !== "content") throw new Error("Expected content tool result")
  return part.result.value
}

const prepareContent = (content: ReadonlyArray<ToolContent>) =>
  SessionRunnerToolResultPreparation.prepare([toolMessage(content)]).pipe(Effect.map(resultContent))

const materializationLayer = (materialized: FileAttachment["materialized"]) =>
  Layer.succeed(
    SessionAttachment.Service,
    SessionAttachment.Service.of({
      materializeFile: (file) =>
        Effect.succeed({
          ...file,
          ...(materialized === undefined ? {} : { materialized }),
        }),
      materialize: (prompt) => Effect.succeed(prompt),
    }),
  )

const expectInvalidRequest = (error: LLMError, label: string) => {
  expect(error).toBeInstanceOf(LLMError)
  expect(error.module).toBe("SessionRunnerToolResultPreparation")
  expect(error.method).toBe("prepare")
  expect(error.reason._tag).toBe("InvalidRequest")
  expect(error.reason.message).toContain(label)
  expect(error.retryable).toBe(false)
}

describe("SessionRunnerToolResultPreparation", () => {
  it.effect("keeps text and data URI content identity-preserved", () =>
    Effect.gen(function* () {
      reset()
      const text = { type: "text" as const, text: "already canonical", provenance }
      const data = {
        type: "file" as const,
        uri: "data:image/png;base64,AQID",
        mime: "image/png",
        name: "image.png",
        provenance,
      }
      const message = toolMessage([text, data])
      const original = resultContent([message])
      const prepared = yield* SessionRunnerToolResultPreparation.prepare([message])

      expect(prepared[0]).toBe(message)
      expect(resultContent(prepared)[0]).toBe(original[0])
      expect(resultContent(prepared)[1]).toBe(original[1])
      expect(requests).toEqual([])
      expect(resources).toEqual([])
    }),
  )

  it.live("materializes file text, images, and PDFs while preserving provenance", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.gen(function* () {
          reset()
          const text = path.join(tmp.path, "note.txt")
          const image = path.join(tmp.path, "image.png")
          const pdf = path.join(tmp.path, "document.pdf")
          const imageBytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
          const pdfBytes = new TextEncoder().encode("%PDF-1.4\n")
          yield* Effect.promise(() =>
            Promise.all([
              fs.writeFile(text, "local text"),
              fs.writeFile(image, imageBytes),
              fs.writeFile(pdf, pdfBytes),
            ]),
          )

          const prepared = yield* prepareContent([
            { type: "file", uri: pathToFileURL(text).href, mime: "text/plain", name: "note.txt", provenance },
            { type: "file", uri: pathToFileURL(image).href, mime: "image/png", name: "image.png", provenance },
            { type: "file", uri: pathToFileURL(pdf).href, mime: "application/pdf", name: "document.pdf", provenance },
          ])

          expect(prepared).toEqual([
            { type: "text", text: "local text", provenance },
            {
              type: "file",
              uri: `data:image/png;base64,${Buffer.from(imageBytes).toString("base64")}`,
              mime: "image/png",
              name: "image.png",
              provenance,
            },
            {
              type: "file",
              uri: `data:application/pdf;base64,${Buffer.from(pdfBytes).toString("base64")}`,
              mime: "application/pdf",
              name: "document.pdf",
              provenance,
            },
          ])
          expect(resources).toEqual([])
        }),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.effect("materializes bounded HTTPS text and media", () =>
    Effect.gen(function* () {
      reset()
      const text = yield* prepareContent([
        {
          type: "file",
          uri: "https://example.com/note.txt?token=secret",
          mime: "text/plain",
          provenance,
        },
      ])
      expect(text).toEqual([{ type: "text", text: "remote text", provenance }])

      response = new Response(Uint8Array.from([1, 2, 3]), {
        headers: { "content-type": "image/png" },
      })
      const image = yield* prepareContent([
        {
          type: "file",
          uri: "https://example.com/image.png",
          mime: "image/png",
          provenance,
        },
      ])
      expect(image).toEqual([
        {
          type: "file",
          uri: "data:image/png;base64,AQID",
          mime: "image/png",
          name: "image.png",
          provenance,
        },
      ])
      expect(requests).toEqual(["https://example.com/note.txt?token=secret", "https://example.com/image.png"])
      expect(resources).toEqual([])
    }),
  )

  it.live("maps invalid URIs, unsupported schemes, and read failures to InvalidRequest", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.gen(function* () {
          reset()
          const invalid = yield* prepareContent([{ type: "file", uri: "not a URI", mime: "text/plain" }]).pipe(
            Effect.flip,
          )
          expectInvalidRequest(invalid, "tool result attachment")

          const scheme = yield* prepareContent([
            { type: "file", uri: "ftp://example.com/private.txt?token=secret#fragment", mime: "text/plain" },
          ]).pipe(Effect.flip)
          expectInvalidRequest(scheme, "tool result ftp://example.com/private.txt")
          expect(scheme.reason.message).not.toContain("secret")
          expect(scheme.reason.message).not.toContain("fragment")

          const missing = yield* prepareContent([
            {
              type: "file",
              uri: pathToFileURL(path.join(tmp.path, "missing.txt")).href,
              mime: "text/plain",
              name: "missing.txt",
            },
          ]).pipe(Effect.flip)
          expectInvalidRequest(missing, "tool result missing.txt")
        }),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.effect("maps unsupported MIME, invalid UTF-8, and oversize HTTP bodies to InvalidRequest", () =>
    Effect.gen(function* () {
      reset()
      response = new Response(Uint8Array.from([1, 2, 3]), {
        headers: { "content-type": "application/zip" },
      })
      const unsupported = yield* prepareContent([
        { type: "file", uri: "https://example.com/archive.zip", mime: "application/zip" },
      ]).pipe(Effect.flip)
      expectInvalidRequest(unsupported, "tool result https://example.com/archive.zip")

      response = new Response(Uint8Array.from([0xff]), {
        headers: { "content-type": "text/plain" },
      })
      const utf8 = yield* prepareContent([
        { type: "file", uri: "https://example.com/invalid.txt", mime: "text/plain" },
      ]).pipe(Effect.flip)
      expectInvalidRequest(utf8, "tool result https://example.com/invalid.txt")

      response = new Response("small", {
        headers: {
          "content-type": "text/plain",
          "content-length": String(SessionAttachment.MAX_ATTACHMENT_BYTES + 1),
        },
      })
      const oversized = yield* prepareContent([
        {
          type: "file",
          uri: "https://example.com/private?token=secret#fragment",
          mime: "text/plain",
        },
      ]).pipe(Effect.flip)
      expectInvalidRequest(oversized, "tool result https://example.com/private")
      expect(oversized.reason.message).not.toContain("secret")
      expect(oversized.reason.message).not.toContain("fragment")
    }),
  )

  it.effect("rejects an empty materialized result", () =>
    Effect.gen(function* () {
      reset()
      const failure = yield* prepareContent([
        { type: "file", uri: "https://example.com/empty.txt", mime: "text/plain" },
      ]).pipe(Effect.provide(materializationLayer([])), Effect.flip)

      expectInvalidRequest(failure, "Attachment produced no materialized content")
      expect(requests).toEqual([])
    }),
  )

  it.effect("rejects an unknown materialized variant without deleting canonical content", () =>
    Effect.gen(function* () {
      reset()
      const file = {
        type: "file" as const,
        uri: "https://example.com/future.txt",
        mime: "text/plain",
        provenance,
      }
      const message = toolMessage([file])
      const original = resultContent([message])[0]
      const unknown = [{ type: "future", value: "unsupported" }] as unknown as NonNullable<
        FileAttachment["materialized"]
      >

      const failure = yield* SessionRunnerToolResultPreparation.prepare([message]).pipe(
        Effect.provide(materializationLayer(unknown)),
        Effect.flip,
      )

      expectInvalidRequest(failure, "unsupported materialized content variant: future")
      expect(resultContent([message])).toEqual([file])
      expect(resultContent([message])[0]).toBe(original)
    }),
  )

  it.effect("fails the whole file when a valid materialized sibling precedes an error", () =>
    Effect.gen(function* () {
      reset()
      const failure = yield* prepareContent([
        { type: "file", uri: "https://example.com/mixed.txt", mime: "text/plain" },
      ]).pipe(
        Effect.provide(
          materializationLayer([
            { type: "text", text: "must not be returned" },
            { type: "error", message: "materialization failed" },
          ]),
        ),
        Effect.flip,
      )

      expectInvalidRequest(failure, "materialization failed")
    }),
  )

  it.effect("rejects a missing materialized result", () =>
    Effect.gen(function* () {
      reset()
      const failure = yield* prepareContent([
        { type: "file", uri: "https://example.com/missing.txt", mime: "text/plain" },
      ]).pipe(Effect.provide(materializationLayer(undefined)), Effect.flip)

      expectInvalidRequest(failure, "Attachment was not materialized")
    }),
  )

  it.effect("does not mutate durable Session messages or pre-preparation LLM messages", () =>
    Effect.gen(function* () {
      reset()
      const content = {
        type: "file" as const,
        uri: "https://example.com/historical.txt",
        mime: "text/plain",
        name: "historical.txt",
        provenance,
      }
      const tool = SessionMessage.AssistantTool.make({
        type: "tool",
        id: "call-historical",
        name: "inspect",
        provider: { executed: false },
        state: SessionMessage.ToolStateCompleted.make({
          status: "completed",
          input: {},
          structured: {},
          content: [content],
        }),
        time: {
          created: DateTime.makeUnsafe(0),
          ran: DateTime.makeUnsafe(1),
          completed: DateTime.makeUnsafe(2),
        },
      })
      const durable = SessionMessage.Assistant.make({
        id: SessionMessage.ID.make("msg_historical"),
        type: "assistant",
        agent: "build",
        model: { id: ModelV2.ID.make("model"), providerID: ProviderV2.ID.make("provider") },
        content: [tool],
        finish: "tool-calls",
        time: { created: DateTime.makeUnsafe(0), completed: DateTime.makeUnsafe(2) },
      })
      const durableCopy = structuredClone(durable)
      const messages = toLLMMessages([durable], model)
      const messageCopy = structuredClone(messages)

      const prepared = yield* SessionRunnerToolResultPreparation.prepare(messages)

      expect(durable).toEqual(durableCopy)
      expect(messages).toEqual(messageCopy)
      expect(resultContent(messages)).toEqual([content])
      expect(resultContent(prepared)).toEqual([{ type: "text", text: "remote text", provenance }])
      expect(resources).toEqual([])
    }),
  )
})
