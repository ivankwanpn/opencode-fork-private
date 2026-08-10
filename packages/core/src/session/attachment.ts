export * as SessionAttachment from "./attachment"
export { dematerialize } from "./prompt"

import path from "path"
import { fileURLToPath } from "url"
import { Context, Effect, Layer } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import { makeLocationNode } from "../effect/app-node"
import { httpClient } from "../effect/app-node-platform"
import { FSUtil } from "../fs-util"
import { MCP } from "../mcp"
import { AbsolutePath } from "../schema"
import { collectBoundedResponseBody } from "../tool/http-body"
import { ReadToolFileSystem } from "../tool/read-filesystem"
import { Prompt, type FileAttachment, type MaterializedContent } from "./prompt"

export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024
const supportedMedia = new Set(["application/pdf", "image/gif", "image/jpeg", "image/png", "image/webp"])

const textual = (mime: string) =>
  !mime ||
  mime.startsWith("text/") ||
  mime === "application/json" ||
  mime.endsWith("+json") ||
  mime === "application/xml" ||
  mime.endsWith("+xml") ||
  mime === "application/javascript" ||
  mime === "application/x-javascript" ||
  mime === "image/svg+xml"

const mimeFrom = (contentType: string | undefined) => contentType?.split(";", 1)[0]?.trim().toLowerCase() ?? ""

const formatBytes = (value: number) => {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${Math.ceil(value / 1024)} KB`
  return `${Math.ceil(value / (1024 * 1024))} MB`
}

const dataUri = (mime: string, bytes: Uint8Array) => `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`

const materializedFile = (mime: string, bytes: Uint8Array, name?: string): MaterializedContent => ({
  type: "file",
  uri: dataUri(mime, bytes),
  mime,
  name,
})

const decodeText = (bytes: Uint8Array) =>
  Effect.try({
    try: () => new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    catch: () => new Error("Attachment is not valid UTF-8"),
  })

const failure = (message: string): readonly MaterializedContent[] => [{ type: "error", message }]

export const attachmentLabel = (file: FileAttachment) => {
  if (file.name) return file.name
  if (file.resource) {
    try {
      const url = new URL(file.resource.uri)
      return `${file.resource.clientName}/${url.protocol}//${url.host}${url.pathname}`
    } catch {
      return `${file.resource.clientName}/resource`
    }
  }
  try {
    const url = new URL(file.uri)
    if (url.protocol === "data:") return "data attachment"
    return `${url.protocol}//${url.host}${url.pathname}`
  } catch {
    return "attachment"
  }
}

const normalizeBase64 = (input: string) => {
  const compact = input.replace(/\s/g, "")
  const padding = compact.indexOf("=")
  if (
    !/^[A-Za-z0-9+/]*={0,2}$/.test(compact) ||
    (padding !== -1 && padding < compact.length - 2) ||
    compact.length % 4 === 1
  )
    throw new Error("Malformed base64")
  return compact
}

const base64Size = (input: string) => {
  const padding = input.endsWith("==") ? 2 : input.endsWith("=") ? 1 : 0
  return Math.max(0, Math.floor((input.length * 3) / 4) - padding)
}

const decodeBase64 = (input: string) => {
  const compact = normalizeBase64(input)
  const bytes = Buffer.from(compact, "base64")
  if (bytes.toString("base64").replace(/=+$/, "") !== compact.replace(/=+$/, "")) throw new Error("Malformed base64")
  return new Uint8Array(bytes)
}

const parseDataUri = (uri: string) =>
  Effect.try({
    try: () => {
      const comma = uri.indexOf(",")
      if (comma === -1) throw new Error("Malformed data URI")
      const metadata = uri.slice(5, comma)
      const segments = metadata.split(";")
      const mime = segments[0]?.trim().toLowerCase() || "text/plain"
      const encoded = uri.slice(comma + 1)
      let bytes: Uint8Array
      if (segments.includes("base64")) {
        const compact = normalizeBase64(encoded)
        if (base64Size(compact) > MAX_ATTACHMENT_BYTES) throw new Error("Data URI is too large")
        bytes = decodeBase64(compact)
      } else {
        if (encoded.length > MAX_ATTACHMENT_BYTES * 3) throw new Error("Data URI is too large")
        const decoded = decodeURIComponent(encoded)
        if (Buffer.byteLength(decoded, "utf8") > MAX_ATTACHMENT_BYTES) throw new Error("Data URI is too large")
        bytes = new Uint8Array(Buffer.from(decoded, "utf8"))
      }
      return { mime, bytes }
    },
    catch: () => new Error("Malformed data URI"),
  })

const pageFrom = (url: URL) => {
  const start = Number.parseInt(url.searchParams.get("start") ?? "", 10)
  const end = Number.parseInt(url.searchParams.get("end") ?? "", 10)
  if (!Number.isFinite(start) || start < 1) return undefined
  return {
    offset: start,
    ...(!Number.isFinite(end) || end < start
      ? {}
      : {
          limit: Math.min(end - start + 1, ReadToolFileSystem.MAX_READ_LINES),
        }),
  }
}

export interface Interface {
  readonly materializeFile: (file: FileAttachment) => Effect.Effect<FileAttachment>
  readonly materialize: (prompt: Prompt) => Effect.Effect<Prompt>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/SessionAttachment") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const mcp = yield* MCP.Service
    const read = yield* ReadToolFileSystem.Service
    const http = HttpClient.filterStatusOk(yield* HttpClient.HttpClient)

    const localMedia = Effect.fn("SessionAttachment.localMedia")(function* (filepath: string, file: FileAttachment) {
      const label = attachmentLabel(file)
      const mime = file.mime === "text/plain" ? FSUtil.mimeType(filepath) : file.mime
      if (!supportedMedia.has(mime)) return failure(`Binary attachment ${label} (${mime}) is not supported`)
      const info = yield* fs.stat(filepath)
      if (Number(info.size) > MAX_ATTACHMENT_BYTES)
        return failure(`Attachment ${label} exceeds the ${formatBytes(MAX_ATTACHMENT_BYTES)} ingestion limit`)
      const bytes = yield* fs.readFile(filepath)
      return [materializedFile(mime, bytes, file.name ?? path.basename(filepath))]
    })

    const local = Effect.fn("SessionAttachment.local")(function* (file: FileAttachment, url: URL) {
      const filepath = fileURLToPath(url)
      const absolute = AbsolutePath.make(filepath)
      const kind = yield* read.inspect(absolute)
      if (kind === "directory") {
        const page = yield* read.list(absolute)
        const entries = page.entries.map((entry) => entry.path).join("\n")
        const suffix = page.truncated && page.next ? `\n... (more entries available from ${page.next})` : ""
        return [{ type: "text" as const, text: entries + suffix }]
      }

      const content = yield* read.read(absolute, file.uri, pageFrom(url)).pipe(
        Effect.map((value) => ({ type: "content" as const, value })),
        Effect.catchTag("ReadTool.BinaryFileError", () =>
          localMedia(filepath, file).pipe(Effect.map((value) => ({ type: "materialized" as const, value }))),
        ),
      )
      if (content.type === "materialized") return content.value
      if ("encoding" in content.value) {
        if (content.value.encoding === "utf8") return [{ type: "text" as const, text: content.value.content }]
        const bytes = new Uint8Array(Buffer.from(content.value.content, "base64"))
        return [materializedFile(content.value.mime, bytes, file.name ?? content.value.name)]
      }
      return [
        {
          type: "text" as const,
          text:
            content.value.content +
            (content.value.truncated && content.value.next
              ? `\n... (more content available from line ${content.value.next})`
              : ""),
        },
      ]
    })

    const data = Effect.fn("SessionAttachment.data")(function* (file: FileAttachment) {
      const parsed = yield* parseDataUri(file.uri)
      if (parsed.bytes.byteLength > MAX_ATTACHMENT_BYTES)
        return failure(
          `Attachment ${attachmentLabel(file)} exceeds the ${formatBytes(MAX_ATTACHMENT_BYTES)} ingestion limit`,
        )
      const mime = parsed.mime || file.mime
      if (textual(mime))
        return [
          {
            type: "text" as const,
            text: yield* decodeText(parsed.bytes),
          },
        ]
      if (!supportedMedia.has(mime))
        return failure(`Binary attachment ${attachmentLabel(file)} (${mime}) is not supported`)
      return [materializedFile(mime, parsed.bytes, file.name)]
    })

    const remote = Effect.fn("SessionAttachment.remote")(function* (file: FileAttachment, url: URL) {
      const response = yield* HttpClientRequest.get(url.href).pipe(http.execute)
      const bytes = yield* collectBoundedResponseBody(
        response,
        MAX_ATTACHMENT_BYTES,
        () => new Error(`Attachment exceeds the ${formatBytes(MAX_ATTACHMENT_BYTES)} ingestion limit`),
      )
      const mime = mimeFrom(response.headers["content-type"]) || file.mime
      if (textual(mime))
        return [
          {
            type: "text" as const,
            text: yield* decodeText(bytes),
          },
        ]
      if (!supportedMedia.has(mime))
        return failure(`Remote attachment ${attachmentLabel(file)} (${mime}) is not supported`)
      return [materializedFile(mime, bytes, file.name ?? (path.basename(url.pathname) || undefined))]
    })

    const resource = Effect.fn("SessionAttachment.resource")(function* (file: FileAttachment) {
      const source = file.resource!
      const response = yield* mcp.readResource(source.clientName, source.uri)
      if (!response) return failure(`MCP resource ${attachmentLabel(file)} was not found`)
      const contents = Array.isArray(response.contents) ? response.contents : [response.contents]
      const result: MaterializedContent[] = []
      for (const item of contents) {
        if (!item || typeof item !== "object") continue
        if ("text" in item && typeof item.text === "string" && item.text.length > 0) {
          result.push({ type: "text", text: item.text })
          continue
        }
        if (!("blob" in item) || typeof item.blob !== "string" || item.blob.length === 0) continue
        const mime = mimeFrom("mimeType" in item && typeof item.mimeType === "string" ? item.mimeType : file.mime)
        const name = "uri" in item && typeof item.uri === "string" ? item.uri : file.name
        const display = name ?? attachmentLabel(file)
        let compact: string
        try {
          compact = normalizeBase64(item.blob)
        } catch {
          result.push({
            type: "error",
            message: `Binary MCP resource ${display} is not valid base64`,
          })
          continue
        }
        if (base64Size(compact) > MAX_ATTACHMENT_BYTES) {
          result.push({
            type: "error",
            message: `MCP resource ${display} exceeds the ${formatBytes(MAX_ATTACHMENT_BYTES)} ingestion limit`,
          })
          continue
        }
        const bytes = decodeBase64(compact)
        if (!supportedMedia.has(mime)) {
          result.push({
            type: "error",
            message: `Binary MCP resource ${display} (${mime}) is not supported`,
          })
          continue
        }
        result.push(materializedFile(mime, bytes, name))
      }
      return result.length === 0
        ? failure(`MCP resource ${attachmentLabel(file)} returned no supported content`)
        : result
    })

    const materializeFile = Effect.fn("SessionAttachment.materializeFile")(function* (file: FileAttachment) {
      if (file.materialized !== undefined) return file
      const materialized = yield* Effect.gen(function* () {
        if (file.resource) return yield* resource(file)
        if (!URL.canParse(file.uri)) return failure(`Attachment URI is invalid: ${attachmentLabel(file)}`)
        const url = new URL(file.uri)
        if (url.protocol === "data:") return yield* data(file)
        if (url.protocol === "file:") return yield* local(file, url)
        if (url.protocol === "http:" || url.protocol === "https:") return yield* remote(file, url)
        return failure(`Attachment URI scheme is not supported: ${url.protocol}`)
      }).pipe(
        Effect.catch(() =>
          Effect.succeed(
            file.resource
              ? failure(`Unable to read MCP resource ${file.resource.clientName}/${file.resource.uri}`)
              : failure(`Unable to materialize attachment ${attachmentLabel(file)}`),
          ),
        ),
      )
      return { ...file, materialized }
    })

    return Service.of({
      materializeFile,
      materialize: Effect.fn("SessionAttachment.materialize")(function* (prompt) {
        if (!prompt.files?.length) return prompt
        return {
          ...prompt,
          files: yield* Effect.forEach(prompt.files, materializeFile, { concurrency: 4 }),
        }
      }),
    })
  }),
)

export const locationLayer = layer
export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [FSUtil.node, MCP.node, ReadToolFileSystem.node, httpClient],
})
