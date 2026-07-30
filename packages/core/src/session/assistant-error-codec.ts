export * as AssistantErrorCodec from "./assistant-error-codec"

export type Kind = "authentication" | "unknown"

export type Decoded = {
  readonly kind: Kind
  readonly message: string
}

const PREFIX = "opencode:assistant-error:v1:"

export function encode(message: string, kind: Kind = "unknown") {
  if (kind === "unknown" && !message.startsWith(PREFIX)) return message
  return `${PREFIX}${JSON.stringify({ kind, message })}`
}

export function decode(message: string): Decoded {
  if (!message.startsWith(PREFIX)) return { kind: "unknown", message }
  const source = message.slice(PREFIX.length)
  let value: unknown
  try {
    value = JSON.parse(source)
  } catch {
    return { kind: "unknown", message }
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { kind: "unknown", message }
  const keys = Object.keys(value)
  if (keys.length !== 2 || !keys.includes("kind") || !keys.includes("message"))
    return { kind: "unknown", message }
  const envelope = value as Record<string, unknown>
  const kind = envelope.kind
  const decoded = envelope.message
  if ((kind !== "authentication" && kind !== "unknown") || typeof decoded !== "string")
    return { kind: "unknown", message }
  if (JSON.stringify({ kind, message: decoded }) !== source) return { kind: "unknown", message }
  return { kind, message: decoded }
}
