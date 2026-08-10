import { describe, expect, test } from "bun:test"
import type { ServerApi } from "./server"
import { createV2OnlyApi, resolveCompatibleApiForProtocol, resolveCompatibleGeneration } from "./server-compat"

function currentApi(calls: string[], onPrompt?: (input: Parameters<ServerApi["session"]["prompt"]>[0]) => void) {
  const current = {
    session: {
      prompt: async (input: Parameters<ServerApi["session"]["prompt"]>[0]) => {
        onPrompt?.(input)
        return undefined
      },
      inputList: async () => {
        calls.push("inputList")
        return []
      },
    },
    permission: { request: {} },
  }
  return current as unknown as ServerApi
}

describe("server compatibility API", () => {
  test("blocks every API call when the selected server generation is V1", async () => {
    const calls: string[] = []
    const api = createV2OnlyApi({
      protocol: Promise.resolve("v1"),
      current: currentApi(calls),
    })

    await expect(api.session.inputList({ sessionID: "ses_1", delivery: "queue" })).rejects.toThrow(
      "V2 server protocol unavailable",
    )
    expect(calls).toEqual([])
  })

  test("allows the current API when the selected server generation is V2", async () => {
    const calls: string[] = []
    const api = createV2OnlyApi({
      protocol: Promise.resolve("v2"),
      current: currentApi(calls),
    })

    await expect(api.session.inputList({ sessionID: "ses_1", delivery: "queue" })).resolves.toEqual([])
    expect(calls).toEqual(["inputList"])
  })

  test("re-evaluates the protocol resolver without falling back after reconnect", async () => {
    const calls: string[] = []
    let protocol: "v1" | "v2" = "v2"
    const api = createV2OnlyApi({
      protocol: () => Promise.resolve(protocol),
      current: currentApi(calls),
    })

    await expect(api.session.inputList({ sessionID: "ses_1", delivery: "queue" })).resolves.toEqual([])
    protocol = "v1"
    await expect(api.session.inputList({ sessionID: "ses_1", delivery: "queue" })).rejects.toThrow(
      "V2 server protocol unavailable",
    )
    expect(calls).toEqual(["inputList"])
  })

  test("keeps a resolved V2 API on the generation selected before reconnect", async () => {
    const calls: string[] = []
    let protocol: "v1" | "v2" = "v2"
    const api = createV2OnlyApi({
      protocol: () => Promise.resolve(protocol),
      current: currentApi(calls),
    })

    const selected = await resolveCompatibleApiForProtocol(api, () => Promise.resolve(protocol))
    protocol = "v1"

    await expect(selected.session.inputList({ sessionID: "ses_1", delivery: "queue" })).resolves.toEqual([])
    expect(calls).toEqual(["inputList"])
  })

  test("never downgrades an admitted V2 prompt after reconnect", async () => {
    const calls: string[] = []
    let protocol: "v1" | "v2" = "v2"
    const api = createV2OnlyApi({
      protocol: () => Promise.resolve(protocol),
      current: currentApi(calls, (input) => {
        calls.push(`v2:${input.id}:${input.delivery}:${input.resume}`)
      }),
    })

    const selected = await resolveCompatibleApiForProtocol(api, () => Promise.resolve(protocol))
    protocol = "v1"
    await selected.session.prompt({
      sessionID: "ses_1",
      id: "msg_admitted",
      text: "already admitted",
      delivery: "queue",
      resume: false,
    })

    expect(calls).toEqual(["v2:msg_admitted:queue:false"])
  })

  test("keeps the protocol and API selected from the same V2 generation", async () => {
    const calls: string[] = []
    const api = createV2OnlyApi({
      protocol: Promise.resolve("v2"),
      current: currentApi(calls),
    })

    const selected = resolveCompatibleGeneration(api, "v2")

    await expect(selected.api.session.inputList({ sessionID: "ses_1", delivery: "queue" })).resolves.toEqual([])
    expect(selected.protocol).toBe("v2")
    expect(calls).toEqual(["inputList"])
  })

  test("refuses to construct a V1 generation", () => {
    const api = createV2OnlyApi({
      protocol: Promise.resolve("v2"),
      current: currentApi([]),
    })

    expect(() => resolveCompatibleGeneration(api, "v1")).toThrow("V2 server protocol unavailable")
  })
})
