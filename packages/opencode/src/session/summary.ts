import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect, Layer, Context, Schema } from "effect"
import { SessionV2 } from "@opencode-ai/core/session"
import { Snapshot } from "@/snapshot"
import { SessionID, MessageID } from "./schema"

function unquoteGitPath(input: string) {
  if (!input.startsWith('"')) return input
  if (!input.endsWith('"')) return input
  const body = input.slice(1, -1)
  const bytes: number[] = []

  for (let i = 0; i < body.length; i++) {
    const char = body[i]!
    if (char !== "\\") {
      bytes.push(char.charCodeAt(0))
      continue
    }

    const next = body[i + 1]
    if (!next) {
      bytes.push("\\".charCodeAt(0))
      continue
    }

    if (next >= "0" && next <= "7") {
      const chunk = body.slice(i + 1, i + 4)
      const match = chunk.match(/^[0-7]{1,3}/)
      if (!match) {
        bytes.push(next.charCodeAt(0))
        i++
        continue
      }
      bytes.push(parseInt(match[0], 8))
      i += match[0].length
      continue
    }

    const escaped =
      next === "n"
        ? "\n"
        : next === "r"
          ? "\r"
          : next === "t"
            ? "\t"
            : next === "b"
              ? "\b"
              : next === "f"
                ? "\f"
                : next === "v"
                  ? "\v"
                  : next === "\\" || next === '"'
                    ? next
                    : undefined

    bytes.push((escaped ?? next).charCodeAt(0))
    i++
  }

  return Buffer.from(bytes).toString()
}

export interface Interface {
  readonly diff: (input: { sessionID: SessionID; messageID?: MessageID }) => Effect.Effect<Snapshot.FileDiff[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionSummary") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const sessions = yield* SessionV2.Service

    const diff = Effect.fn("SessionSummary.diff")(function* (input: { sessionID: SessionID; messageID?: MessageID }) {
      if (!input.messageID) return []
      const messages = yield* sessions
        .messages({ sessionID: SessionV2.ID.make(input.sessionID), order: "asc" })
        .pipe(Effect.orDie)
      const boundary = messages.findIndex(
        (message) => String(message.id) === String(input.messageID) && message.type === "user",
      )
      if (boundary < 0) return []
      const following = messages.slice(boundary + 1)
      const nextUser = following.findIndex((message) => message.type === "user")
      const diffs = (nextUser < 0 ? following : following.slice(0, nextUser))
        .flatMap((message) => (message.type === "assistant" ? (message.snapshot?.patch ?? []) : []))
      return diffs.map((item) => {
        const file = unquoteGitPath(item.path)
        return {
          file,
          status: item.status,
          additions: item.additions,
          deletions: item.deletions,
          patch: item.patch,
        }
      })
    })

    return Service.of({ diff })
  }),
)

export const DiffInput = Schema.Struct({
  sessionID: SessionID,
  messageID: Schema.optional(MessageID),
})
export type DiffInput = Schema.Schema.Type<typeof DiffInput>

export const node = LayerNode.make({
  service: Service,
  layer: layer,
  deps: [SessionV2.node],
})

export * as SessionSummary from "./summary"
