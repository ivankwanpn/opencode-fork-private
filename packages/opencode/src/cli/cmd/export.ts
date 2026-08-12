import { AbsolutePath, RelativePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { autocomplete, intro, isCancel, log, outro } from "@clack/prompts"
import { DateTime, Effect } from "effect"
import { EOL } from "os"
import { effectCmd, fail } from "../effect-cmd"
import { UI } from "../ui"
import { SessionArchive } from "./session-archive"

export const ExportCommand = effectCmd({
  command: "export [sessionID]",
  describe: "export session data as JSON",
  builder: (yargs) =>
    yargs
      .positional("sessionID", {
        describe: "session id to export",
        type: "string",
      })
      .option("sanitize", {
        describe: "redact sensitive transcript and file data",
        type: "boolean",
      }),
  handler: Effect.fn("Cli.export")(function* (args) {
    return yield* run(args)
  }),
})

const run = Effect.fn("Cli.export.body")(function* (args: { sessionID?: string; sanitize?: boolean }) {
  const sessions = yield* SessionV2.Service
  let sessionID = args.sessionID ? SessionV2.ID.make(args.sessionID) : undefined
  process.stderr.write(`Exporting session: ${sessionID ?? "latest"}\n`)

  if (!sessionID) {
    UI.empty()
    intro("Export session", { output: process.stderr })

    const available = yield* sessions.list()
    if (available.length === 0) {
      log.error("No sessions found", { output: process.stderr })
      outro("Done", { output: process.stderr })
      return
    }
    available.sort(
      (left, right) => DateTime.toEpochMillis(right.time.updated) - DateTime.toEpochMillis(left.time.updated),
    )
    const selected = yield* Effect.promise(() =>
      autocomplete({
        message: "Select session to export",
        maxItems: 10,
        options: available.map((session) => ({
          label: session.title,
          value: session.id,
          hint: `${DateTime.formatLocal(session.time.updated)} - ${session.id.slice(-8)}`,
        })),
        output: process.stderr,
      }),
    )
    if (isCancel(selected)) return yield* Effect.die(new UI.CancelledError())
    sessionID = selected
    outro("Exporting session...", { output: process.stderr })
  }

  return yield* SessionArchive.read(sessionID).pipe(
    Effect.map((archive) => (args.sanitize ? sanitize(archive) : archive)),
    Effect.map(SessionArchive.encode),
    Effect.tap((archive) =>
      Effect.sync(() => {
        process.stdout.write(JSON.stringify(archive, null, 2))
        process.stdout.write(EOL)
      }),
    ),
    Effect.catchCause(() => fail(`Session not found: ${sessionID}`)),
  )
})

function redact(kind: string, id: string, value: string) {
  return value.trim() ? `[redacted:${kind}:${id}]` : value
}

function data(kind: string, id: string, value: Record<string, unknown> | undefined) {
  if (!value) return value
  return Object.keys(value).length ? { redacted: `${kind}:${id}` } : value
}

function providerData(kind: string, id: string, value: Record<string, Record<string, unknown>> | undefined) {
  if (!value) return value
  return Object.keys(value).length ? { redacted: { value: `${kind}:${id}` } } : value
}

function source(id: string, value: { text: string; start: number; end: number } | undefined) {
  if (!value) return value
  return { ...value, text: redact("file-text", id, value.text) }
}

function provenance(
  id: string,
  value:
    | {
        type: "mcp"
        clientName: string
        uri: string
        kind: "resource" | "resource_link"
        mime?: string
        name?: string
        description?: string
      }
    | undefined,
) {
  if (!value) return value
  return {
    ...value,
    clientName: redact("mcp-client", id, value.clientName),
    uri: redact("mcp-uri", id, value.uri),
    name: value.name === undefined ? undefined : redact("mcp-name", id, value.name),
    description: value.description === undefined ? undefined : redact("mcp-description", id, value.description),
  }
}

function file(id: string, value: NonNullable<SessionMessage.User["files"]>[number]) {
  return {
    ...value,
    uri: redact("file-uri", id, value.uri),
    name: value.name === undefined ? undefined : redact("file-name", id, value.name),
    description: value.description === undefined ? undefined : redact("file-description", id, value.description),
    source: source(id, value.source),
    resource: value.resource
      ? {
          clientName: redact("file-client", id, value.resource.clientName),
          uri: redact("file-resource-uri", id, value.resource.uri),
        }
      : undefined,
    materialized: value.materialized?.map((item, index) => {
      const itemID = `${id}-${index}`
      if (item.type === "text") return { ...item, text: redact("file-content", itemID, item.text) }
      if (item.type === "error") return { ...item, message: redact("file-error", itemID, item.message) }
      return {
        ...item,
        uri: redact("file-content-uri", itemID, item.uri),
        name: item.name === undefined ? undefined : redact("file-content-name", itemID, item.name),
      }
    }),
  }
}

function toolContent(id: string, value: SessionMessage.ToolStateRunning["content"][number], index: number) {
  const itemID = `${id}-${index}`
  if (value.type === "text") {
    return {
      ...value,
      text: redact("tool-content", itemID, value.text),
      provenance: provenance(itemID, value.provenance),
    }
  }
  return {
    ...value,
    uri: redact("tool-file-uri", itemID, value.uri),
    name: value.name === undefined ? undefined : redact("tool-file-name", itemID, value.name),
    provenance: provenance(itemID, value.provenance),
  }
}

function content(item: SessionMessage.AssistantContent): SessionMessage.AssistantContent {
  if (item.type === "text") return { ...item, text: redact("text", item.id, item.text) }
  if (item.type === "reasoning") {
    return {
      ...item,
      text: redact("reasoning", item.id, item.text),
      providerMetadata: providerData("reasoning-provider", item.id, item.providerMetadata),
    }
  }
  const state = item.state
  const mapped = {
    ...state,
    input:
      state.status === "pending"
        ? redact("tool-input", item.id, state.input)
        : (data("tool-input", item.id, state.input) ?? state.input),
    ...(state.status === "pending"
      ? {}
      : {
          structured: data("tool-structured", item.id, state.structured) ?? state.structured,
          content: state.content.map((value, index) => toolContent(item.id, value, index)),
        }),
    ...(state.status === "completed"
      ? {
          attachments: state.attachments?.map((value, index) => file(`${item.id}-${index}`, value)),
          outputPaths: state.outputPaths?.map((value, index) =>
            redact("tool-output-path", `${item.id}-${index}`, value),
          ),
          result: state.result === undefined ? undefined : { redacted: `tool-result:${item.id}` },
        }
      : {}),
    ...(state.status === "error"
      ? {
          error: { ...state.error, message: redact("tool-error", item.id, state.error.message) },
          result: state.result === undefined ? undefined : { redacted: `tool-result:${item.id}` },
        }
      : {}),
  } as SessionMessage.ToolState
  return {
    ...item,
    provider: item.provider
      ? {
          ...item.provider,
          metadata: providerData("tool-provider", item.id, item.provider.metadata),
          resultMetadata: providerData("tool-result-provider", item.id, item.provider.resultMetadata),
        }
      : undefined,
    state: mapped,
  }
}

function message(value: SessionMessage.Message): SessionMessage.Message {
  const metadata = data("message-metadata", value.id, value.metadata)
  if (value.type === "user") {
    return {
      ...value,
      metadata,
      text: redact("text", value.id, value.text),
      context: value.context?.map((item, index) => ({
        ...item,
        text: redact("context", `${value.id}-${index}`, item.text),
        metadata: data("context-metadata", `${value.id}-${index}`, item.metadata),
      })),
      files: value.files?.map((item, index) => file(`${value.id}-${index}`, item)),
      agents: value.agents?.map((item, index) => ({
        ...item,
        guidance:
          item.guidance === undefined ? undefined : redact("agent-guidance", `${value.id}-${index}`, item.guidance),
        source: source(`${value.id}-${index}`, item.source),
      })),
      system: value.system === undefined ? undefined : redact("system", value.id, value.system),
      format:
        value.format?.type === "json_schema"
          ? { ...value.format, schema: data("output-schema", value.id, value.format.schema) ?? value.format.schema }
          : value.format,
    }
  }
  if (value.type === "assistant") {
    return {
      ...value,
      metadata,
      content: value.content.map(content),
      structured: value.structured === undefined ? undefined : { redacted: `structured:${value.id}` },
      error: value.error
        ? { ...value.error, message: redact("assistant-error", value.id, value.error.message) }
        : undefined,
      snapshot: value.snapshot
        ? {
            ...value.snapshot,
            files: value.snapshot.files?.map((item, index) =>
              RelativePath.make(redact("snapshot-file", `${value.id}-${index}`, item)),
            ),
            patch: value.snapshot.patch?.map((item, index) => ({
              ...item,
              path: RelativePath.make(redact("snapshot-path", `${value.id}-${index}`, item.path)),
              patch: redact("snapshot-patch", `${value.id}-${index}`, item.patch),
            })),
          }
        : undefined,
    }
  }
  if (value.type === "shell") {
    return {
      ...value,
      metadata,
      command: redact("shell-command", value.id, value.command),
      output: redact("shell-output", value.id, value.output),
    }
  }
  if (value.type === "synthetic") {
    return {
      ...value,
      metadata,
      text: redact("synthetic", value.id, value.text),
      description:
        value.description === undefined ? undefined : redact("synthetic-description", value.id, value.description),
    }
  }
  if (value.type === "system") return { ...value, metadata, text: redact("system", value.id, value.text) }
  if (value.type === "compaction") {
    return {
      ...value,
      metadata,
      summary: redact("compaction-summary", value.id, value.summary),
      recent: redact("compaction-recent", value.id, value.recent),
    }
  }
  return { ...value, metadata }
}

function sanitize(archive: SessionArchive.Envelope): SessionArchive.Envelope {
  const session = archive.session
  return SessionArchive.Envelope.make({
    version: 2,
    session: {
      ...session,
      title: redact("session-title", session.id, session.title),
      location: {
        ...session.location,
        directory: AbsolutePath.make(redact("session-directory", session.id, session.location.directory)),
      },
      subpath:
        session.subpath === undefined
          ? undefined
          : RelativePath.make(redact("session-subpath", session.id, session.subpath)),
      share: session.share ? { url: redact("session-share", session.id, session.share.url) } : undefined,
      revert: session.revert
        ? {
            ...session.revert,
            snapshot:
              session.revert.snapshot === undefined
                ? undefined
                : redact("revert-snapshot", session.id, session.revert.snapshot),
            diff:
              session.revert.diff === undefined ? undefined : redact("revert-diff", session.id, session.revert.diff),
            files: session.revert.files?.map((item, index) => ({
              ...item,
              path: RelativePath.make(redact("revert-file", `${session.id}-${index}`, item.path)),
              patch: redact("revert-patch", `${session.id}-${index}`, item.patch),
            })),
          }
        : undefined,
    },
    messages: archive.messages.map(message),
  })
}
