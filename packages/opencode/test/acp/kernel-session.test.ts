import { describe, expect, test } from "bun:test"
import { make as makeACPClient } from "../../src/acp/client"
import { createSessionEngineInput } from "../../src/util/execution-engine"

const session = {
  id: "sess_acp_kernel",
  projectID: "prj_acp",
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 1000, updated: 1000 },
  location: { directory: "D:/work" },
  engine: "kernel",
  title: "acp kernel",
}

describe("ACP kernel session opt-in", () => {
  test("OPENCODE_SESSION_ENGINE=kernel requests a kernel Session on create", () => {
    expect(createSessionEngineInput({ OPENCODE_SESSION_ENGINE: "kernel" })).toEqual({ engine: "kernel" })
  })

  test("production default env does not request an engine, keeping Classic", () => {
    expect(createSessionEngineInput({})).toEqual({})
    expect(createSessionEngineInput({ OPENCODE_SESSION_ENGINE: "classic" })).toEqual({})
  })

  test("the ACP client sends the engine opt-in in the create request body", async () => {
    const bodies: Record<string, unknown>[] = []
    const fakeFetch = Object.assign(
      async (_url: string, init?: RequestInit) => {
        if (init?.body) bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>)
        return Response.json({ data: session })
      },
      { preconnect: () => {} },
    ) as typeof fetch
    const client = makeACPClient({ baseUrl: "http://localhost:4096", fetch: fakeFetch })
    process.env.OPENCODE_SESSION_ENGINE = "kernel"
    try {
      await client.session.create({ directory: "D:/work", agent: "general" })
    } finally {
      delete process.env.OPENCODE_SESSION_ENGINE
    }
    const create = bodies.find((body) => Object.hasOwn(body, "location"))
    expect(create).toMatchObject({ engine: "kernel", location: { directory: "D:/work" } })
  })

  test("default env create requests are engine-agnostic", async () => {
    const bodies: Record<string, unknown>[] = []
    const fakeFetch = Object.assign(
      async (_url: string, init?: RequestInit) => {
        if (init?.body) bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>)
        return Response.json({ data: session })
      },
      { preconnect: () => {} },
    ) as typeof fetch
    const client = makeACPClient({ baseUrl: "http://localhost:4096", fetch: fakeFetch })
    await client.session.create({ directory: "D:/work", agent: "general" })
    const create = bodies.find((body) => Object.hasOwn(body, "location"))
    expect(create).not.toHaveProperty("engine")
  })
})
