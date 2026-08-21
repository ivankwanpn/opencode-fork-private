import { describe, expect, test } from "bun:test"
import { createNativeCompatClient } from "../../../src/cli/cmd/run/native-compat"
import type { NativeClient } from "../../../src/cli/cmd/run/types"

const session = {
  id: "sess_kernel_cli",
  projectID: "prj_cli",
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 1000, updated: 1000 },
  location: { directory: "D:/work" },
  engine: "kernel",
  title: "kernel run",
}

describe("CLI kernel session opt-in", () => {
  test("OPENCODE_SESSION_ENGINE=kernel creates a kernel Session through the native client", async () => {
    let createInput: Record<string, unknown> | undefined
    const native = {
      sessions: {
        create: async (input: Record<string, unknown>) => {
          createInput = input
          return session
        },
        update: async () => session,
      },
    } as unknown as NativeClient
    const client = createNativeCompatClient({ native, directory: "D:/work" })
    process.env.OPENCODE_SESSION_ENGINE = "kernel"
    try {
      await client.session.create({ agent: "build", directory: "D:/work" })
    } finally {
      delete process.env.OPENCODE_SESSION_ENGINE
    }
    expect(createInput).toMatchObject({ engine: "kernel", location: { directory: "D:/work" } })
  })

  test("default production env leaves the create input engine-agnostic", async () => {
    let createInput: Record<string, unknown> | undefined
    const native = {
      sessions: {
        create: async (input: Record<string, unknown>) => {
          createInput = input
          return session
        },
        update: async () => session,
      },
    } as unknown as NativeClient
    const client = createNativeCompatClient({ native, directory: "D:/work" })
    await client.session.create({ agent: "build", directory: "D:/work" })
    expect(createInput).not.toHaveProperty("engine")
    expect(createInput).toMatchObject({ location: { directory: "D:/work" } })
  })

  test("an existing tab's engine is untouched: creating a kernel session does not mutate other sessions", async () => {
    // The opt-in only configures creation; the server never rewrites an
    // existing Session's engine. This test pins the contract at the client
    // boundary: the create call carries no agent mutation and no id.
    let createInput: Record<string, unknown> | undefined
    const native = {
      sessions: {
        create: async (input: Record<string, unknown>) => {
          createInput = input
          return session
        },
        update: async () => session,
      },
    } as unknown as NativeClient
    const client = createNativeCompatClient({ native, directory: "D:/work" })
    process.env.OPENCODE_SESSION_ENGINE = "kernel"
    try {
      await client.session.create({ agent: "build", directory: "D:/work" })
    } finally {
      delete process.env.OPENCODE_SESSION_ENGINE
    }
    expect(createInput).not.toHaveProperty("id")
  })
})
