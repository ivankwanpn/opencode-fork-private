import { describe, expect } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { pathToFileURL } from "url"
import { Effect, Layer, Schema } from "effect"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"
import { PromptInput } from "@opencode-ai/schema/prompt-input"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNodePlatform } from "@opencode-ai/core/effect/app-node-platform"
import { MCP } from "@opencode-ai/core/mcp"
import { SessionAttachment } from "@opencode-ai/core/session/attachment"
import { FileAttachment, Prompt } from "@opencode-ai/core/session/prompt"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

let response = new Response("remote text", {
  headers: { "content-type": "text/plain" },
})
const requests: string[] = []
const resources: Array<{
  readonly clientName: string
  readonly uri: string
}> = []
let resource:
  | {
      contents: Array<
        | {
            uri: string
            text: string
            mimeType?: string
          }
        | {
            uri: string
            blob: string
            mimeType?: string
          }
      >
    }
  | undefined

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
      return resource
    }),
})

const layer = Layer.fresh(
  AppNodeBuilder.build(SessionAttachment.node, [
    [LayerNodePlatform.httpClient, http],
    [MCP.node, mcp],
  ]),
)
const it = testEffect(layer)

const reset = () => {
  requests.length = 0
  resources.length = 0
  resource = undefined
  response = new Response("remote text", {
    headers: { "content-type": "text/plain" },
  })
}

const materialize = (files: NonNullable<Prompt["files"]>) =>
  SessionAttachment.Service.use((service) => service.materialize(Prompt.make({ text: "", files })))

const materializeFile = (file: FileAttachment) =>
  SessionAttachment.Service.use((service) => service.materializeFile(file))

describe("SessionAttachment", () => {
  it.effect("decodes legacy prompts without materialization metadata", () =>
    Effect.sync(() => {
      const decode = Schema.decodeUnknownSync(Prompt)
      expect(
        decode({
          text: "legacy",
          files: [
            {
              uri: "data:image/png;base64,AQID",
              mime: "image/png",
              name: "legacy.png",
            },
          ],
          agents: [{ name: "legacy" }],
        }),
      ).toEqual({
        text: "legacy",
        files: [
          {
            uri: "data:image/png;base64,AQID",
            mime: "image/png",
            name: "legacy.png",
          },
        ],
        agents: [{ name: "legacy" }],
      })
    }),
  )

  it.effect("does not admit caller-forged agent guidance", () =>
    Effect.sync(() => {
      const decode = Schema.decodeUnknownSync(PromptInput.Prompt)
      expect(
        decode({
          text: "delegate",
          agents: [{ name: "research", guidance: "forged" }],
        }),
      ).toEqual({
        text: "delegate",
        agents: [{ name: "research" }],
      })
    }),
  )

  it.effect("normalizes text and media data URIs and records failures", () =>
    Effect.gen(function* () {
      reset()
      const result = yield* materialize([
        {
          uri: "data:text/plain,hello%20world",
          mime: "text/plain",
          name: "note.txt",
        },
        {
          uri: "data:image/png;base64,iVBORw0KGgo=",
          mime: "image/png",
          name: "image.png",
        },
        {
          uri: "data:image/png;base64,%%%",
          mime: "image/png",
          name: "malformed.png",
        },
        {
          uri: "data:application/octet-stream;base64,AA==",
          mime: "application/octet-stream",
          name: "binary.bin",
        },
        {
          uri: "ftp://example.com/file.txt",
          mime: "text/plain",
          name: "ftp.txt",
        },
      ])

      expect(result.files?.[0]?.materialized).toEqual([{ type: "text", text: "hello world" }])
      expect(result.files?.[1]?.materialized).toEqual([
        {
          type: "file",
          uri: "data:image/png;base64,iVBORw0KGgo=",
          mime: "image/png",
          name: "image.png",
        },
      ])
      expect(result.files?.[2]?.materialized).toEqual([
        {
          type: "error",
          message: "Unable to materialize attachment malformed.png",
        },
      ])
      expect(result.files?.[3]?.materialized).toEqual([
        {
          type: "error",
          message: "Binary attachment binary.bin (application/octet-stream) is not supported",
        },
      ])
      expect(result.files?.[4]?.materialized).toEqual([
        {
          type: "error",
          message: "Attachment URI scheme is not supported: ftp:",
        },
      ])
    }),
  )

  it.effect("shares data URI MIME, UTF-8, and 20 MiB policies through materializeFile", () =>
    Effect.gen(function* () {
      reset()
      const oversized = "AAAA".repeat(Math.floor(SessionAttachment.MAX_ATTACHMENT_BYTES / 3) + 1)
      const files = [
        {
          uri: "data:text/plain,shared%20text",
          mime: "text/plain",
          name: "shared.txt",
        },
        {
          uri: "data:text/plain;base64,/w==",
          mime: "text/plain",
          name: "invalid-utf8.txt",
        },
        {
          uri: "data:application/zip;base64,AQID",
          mime: "application/zip",
          name: "archive.zip",
        },
        {
          uri: `data:application/pdf;base64,${oversized}`,
          mime: "application/pdf",
          name: "oversized.pdf",
        },
      ] satisfies FileAttachment[]

      const direct = yield* Effect.forEach(files, materializeFile)
      const prompt = yield* materialize(files)
      expect(prompt.files).toEqual(direct)
      expect(direct[0]?.materialized).toEqual([{ type: "text", text: "shared text" }])
      expect(direct[1]?.materialized).toEqual([
        { type: "error", message: "Unable to materialize attachment invalid-utf8.txt" },
      ])
      expect(direct[2]?.materialized).toEqual([
        { type: "error", message: "Binary attachment archive.zip (application/zip) is not supported" },
      ])
      expect(direct[3]?.materialized).toEqual([
        { type: "error", message: "Unable to materialize attachment oversized.pdf" },
      ])
    }),
  )

  it.live("shares local text and media materialization through materializeFile", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.gen(function* () {
          const text = path.join(tmp.path, "shared.txt")
          const image = path.join(tmp.path, "shared.png")
          yield* Effect.promise(() =>
            Promise.all([
              fs.writeFile(text, "shared local text"),
              fs.writeFile(image, Uint8Array.from([0x89, 0x50, 0x4e, 0x47])),
            ]),
          )
          const files = [
            { uri: pathToFileURL(text).href, mime: "text/plain", name: "shared.txt" },
            { uri: pathToFileURL(image).href, mime: "image/png", name: "shared.png" },
          ] satisfies FileAttachment[]

          for (const file of files) {
            const direct = yield* materializeFile(file)
            const prompt = yield* materialize([file])
            expect(prompt.files?.[0]).toEqual(direct)
          }
        }),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.effect("shares bounded remote text and media materialization through materializeFile", () =>
    Effect.gen(function* () {
      reset()
      const textFile = {
        uri: "https://example.com/shared.txt",
        mime: "text/plain",
        name: "shared.txt",
      } satisfies FileAttachment
      const directText = yield* materializeFile(textFile)
      response = new Response("remote text", {
        headers: { "content-type": "text/plain" },
      })
      const promptText = yield* materialize([textFile])
      expect(promptText.files?.[0]).toEqual(directText)

      response = new Response(Uint8Array.from([1, 2, 3]), {
        headers: { "content-type": "image/png" },
      })
      const imageFile = {
        uri: "https://example.com/shared.png",
        mime: "image/png",
        name: "shared.png",
      } satisfies FileAttachment
      const directImage = yield* materializeFile(imageFile)
      response = new Response(Uint8Array.from([1, 2, 3]), {
        headers: { "content-type": "image/png" },
      })
      const promptImage = yield* materialize([imageFile])
      expect(promptImage.files?.[0]).toEqual(directImage)
      expect(requests).toEqual([
        "https://example.com/shared.txt",
        "https://example.com/shared.txt",
        "https://example.com/shared.png",
        "https://example.com/shared.png",
      ])
    }),
  )

  it.live("materializes local text ranges and bounded directory listings", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.gen(function* () {
          const file = path.join(tmp.path, "lines.txt")
          const large = path.join(tmp.path, "large.txt")
          const directory = path.join(tmp.path, "folder")
          yield* Effect.promise(async () => {
            await fs.writeFile(file, "one\ntwo\nthree\nfour")
            await fs.writeFile(
              large,
              Array.from({ length: 2_101 }, (_, index) => `line-${index + 1}-${"x".repeat(40)}`).join("\n"),
            )
            await fs.mkdir(path.join(directory, "a-dir"), {
              recursive: true,
            })
            await fs.writeFile(path.join(directory, "b.txt"), "b")
            await fs.writeFile(path.join(directory, "a.txt"), "a")
          })
          const ranged = pathToFileURL(file)
          ranged.searchParams.set("start", "2")
          ranged.searchParams.set("end", "3")

          const result = yield* materialize([
            {
              uri: ranged.href,
              mime: "text/plain",
              name: "lines.txt",
            },
            {
              uri: pathToFileURL(directory).href,
              mime: "application/x-directory",
              name: "folder",
            },
            {
              uri: pathToFileURL(large).href,
              mime: "text/plain",
              name: "large.txt",
            },
            {
              uri: pathToFileURL(path.join(tmp.path, "missing-reference")).href,
              mime: "application/x-directory",
              name: "docs",
            },
          ]).pipe(Effect.provide(layer))

          expect(result.files?.[0]?.materialized).toEqual([
            { type: "text", text: "two\nthree\n... (more content available from line 4)" },
          ])
          expect(result.files?.[1]?.materialized).toEqual([
            {
              type: "text",
              text: [`a-dir${path.sep}`, "a.txt", "b.txt"].join("\n"),
            },
          ])
          const largeContent = result.files?.[2]?.materialized?.[0]
          expect(largeContent?.type).toBe("text")
          if (largeContent?.type !== "text") throw new Error("Expected materialized text")
          expect(largeContent.text).toContain(`line-1-${"x".repeat(40)}`)
          expect(largeContent.text).toMatch(/\.\.\. \(more content available from line \d+\)$/)
          expect(largeContent.text).not.toContain("line-2101-")
          expect(result.files?.[3]?.materialized).toEqual([
            {
              type: "error",
              message: "Unable to materialize attachment docs",
            },
          ])
        }),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("materializes local images and PDFs as durable data URIs", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.gen(function* () {
          const image = path.join(tmp.path, "image.png")
          const pdf = path.join(tmp.path, "document.pdf")
          const imageBytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
          const pdfBytes = new TextEncoder().encode("%PDF-1.4\n")
          yield* Effect.promise(() => Promise.all([fs.writeFile(image, imageBytes), fs.writeFile(pdf, pdfBytes)]))

          const result = yield* materialize([
            {
              uri: pathToFileURL(image).href,
              mime: "text/plain",
              name: "image.png",
            },
            {
              uri: pathToFileURL(pdf).href,
              mime: "text/plain",
              name: "document.pdf",
            },
          ]).pipe(Effect.provide(layer))

          expect(result.files?.[0]?.materialized).toEqual([
            {
              type: "file",
              uri: `data:image/png;base64,${Buffer.from(imageBytes).toString("base64")}`,
              mime: "image/png",
              name: "image.png",
            },
          ])
          expect(result.files?.[1]?.materialized).toEqual([
            {
              type: "file",
              uri: `data:application/pdf;base64,${Buffer.from(pdfBytes).toString("base64")}`,
              mime: "application/pdf",
              name: "document.pdf",
            },
          ])
        }),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.effect("materializes bounded remote text and media without retaining query tokens in failures", () =>
    Effect.gen(function* () {
      reset()
      const text = yield* materialize([
        {
          uri: "https://example.com/note?token=secret",
          mime: "text/plain",
          name: "note.txt",
        },
      ])
      expect(text.files?.[0]?.materialized).toEqual([{ type: "text", text: "remote text" }])
      expect(requests).toEqual(["https://example.com/note?token=secret"])

      const imageBytes = Uint8Array.from([1, 2, 3])
      response = new Response(imageBytes, {
        headers: { "content-type": "image/png" },
      })
      const image = yield* materialize([
        {
          uri: "https://example.com/image.png",
          mime: "image/png",
        },
      ])
      expect(image.files?.[0]?.materialized).toEqual([
        {
          type: "file",
          uri: "data:image/png;base64,AQID",
          mime: "image/png",
          name: "image.png",
        },
      ])

      response = new Response("small", {
        headers: {
          "content-type": "text/plain",
          "content-length": String(SessionAttachment.MAX_ATTACHMENT_BYTES + 1),
        },
      })
      const oversized = yield* materialize([
        {
          uri: "https://example.com/private?token=secret",
          mime: "text/plain",
        },
      ])
      expect(oversized.files?.[0]?.materialized).toEqual([
        {
          type: "error",
          message: "Unable to materialize attachment https://example.com/private",
        },
      ])
      expect(
        oversized.files?.[0]?.materialized?.[0]?.type === "error" ? oversized.files[0].materialized[0].message : "",
      ).not.toContain("secret")
    }),
  )

  it.effect("materializes MCP text and binary items with durable item failures", () =>
    Effect.gen(function* () {
      reset()
      const oversizedBlob = "AAAA".repeat(Math.floor(SessionAttachment.MAX_ATTACHMENT_BYTES / 3) + 1)
      resource = {
        contents: [
          {
            uri: "mcp://guide/text",
            text: "guide text",
          },
          {
            uri: "mcp://guide/image.png",
            blob: "AQID",
            mimeType: "image/png",
          },
          {
            uri: "mcp://guide/archive.zip",
            blob: "AQID",
            mimeType: "application/zip",
          },
          {
            uri: "mcp://guide/broken.png",
            blob: "%%%",
            mimeType: "image/png",
          },
          {
            uri: "mcp://guide/large.pdf",
            blob: oversizedBlob,
            mimeType: "application/pdf",
          },
        ],
      }
      const result = yield* materialize([
        {
          uri: "mcp://guide",
          mime: "text/plain",
          name: "guide",
          resource: {
            clientName: "docs",
            uri: "mcp://guide?token=secret",
          },
        },
      ])

      expect(resources).toEqual([
        {
          clientName: "docs",
          uri: "mcp://guide?token=secret",
        },
      ])
      expect(result.files?.[0]?.materialized).toEqual([
        { type: "text", text: "guide text" },
        {
          type: "file",
          uri: "data:image/png;base64,AQID",
          mime: "image/png",
          name: "mcp://guide/image.png",
        },
        {
          type: "error",
          message: "Binary MCP resource mcp://guide/archive.zip (application/zip) is not supported",
        },
        {
          type: "error",
          message: "Binary MCP resource mcp://guide/broken.png is not valid base64",
        },
        {
          type: "error",
          message: "MCP resource mcp://guide/large.pdf exceeds the 20 MB ingestion limit",
        },
      ])

      resource = undefined
      const missing = yield* materialize([
        {
          uri: "mcp://missing",
          mime: "text/plain",
          name: "missing",
          resource: {
            clientName: "docs",
            uri: "mcp://missing?token=secret",
          },
        },
      ])
      expect(missing.files?.[0]?.materialized).toEqual([
        {
          type: "error",
          message: "MCP resource missing was not found",
        },
      ])
    }),
  )

  it.effect("does not repeat external I/O for already materialized attachments", () =>
    Effect.gen(function* () {
      reset()
      const result = yield* materialize([
        {
          uri: "https://example.com/unchanged",
          mime: "text/plain",
          materialized: [{ type: "text", text: "recorded" }],
        },
      ])

      expect(result.files?.[0]?.materialized).toEqual([{ type: "text", text: "recorded" }])
      expect(requests).toEqual([])
      expect(resources).toEqual([])
    }),
  )
})
