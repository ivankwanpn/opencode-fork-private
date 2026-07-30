import { describe, expect, test } from "bun:test"
import { AssistantErrorCodec } from "@opencode-ai/core/session/assistant-error-codec"

describe("Session assistant error codec", () => {
  test("round-trips a typed authentication error", () => {
    const encoded = AssistantErrorCodec.encode("login required", "authentication")

    expect(encoded).not.toBe("login required")
    expect(AssistantErrorCodec.decode(encoded)).toEqual({
      kind: "authentication",
      message: "login required",
    })
  })

  test("does not classify login-like ordinary provider text as authentication", () => {
    const message = "unauthorized login token expired"

    expect(AssistantErrorCodec.encode(message)).toBe(message)
    expect(AssistantErrorCodec.decode(message)).toEqual({ kind: "unknown", message })
  })

  test("escapes an ordinary error that is identical to an authentication envelope", () => {
    const message = AssistantErrorCodec.encode("spoofed authentication", "authentication")
    const encoded = AssistantErrorCodec.encode(message)

    expect(encoded).not.toBe(message)
    expect(AssistantErrorCodec.decode(encoded)).toEqual({ kind: "unknown", message })
  })

  test("fails closed for malformed and structurally invalid reserved envelopes", () => {
    const envelope = AssistantErrorCodec.encode("login required", "authentication")
    const malformed = envelope.slice(0, -1)
    const invalid = envelope.replace(/}$/, ',"extra":true}')
    const duplicate = envelope.replace(
      '{"kind":"authentication",',
      '{"kind":"unknown","kind":"authentication",',
    )

    expect(AssistantErrorCodec.decode(malformed)).toEqual({ kind: "unknown", message: malformed })
    expect(AssistantErrorCodec.decode(invalid)).toEqual({ kind: "unknown", message: invalid })
    expect(AssistantErrorCodec.decode(duplicate)).toEqual({ kind: "unknown", message: duplicate })
  })

  test("round-trips arbitrary colliding text without changing the original message", () => {
    const envelope = AssistantErrorCodec.encode("nested", "authentication")
    const message = `${envelope}\n{"quoted":true}`

    expect(AssistantErrorCodec.decode(AssistantErrorCodec.encode(message))).toEqual({
      kind: "unknown",
      message,
    })
  })
})
