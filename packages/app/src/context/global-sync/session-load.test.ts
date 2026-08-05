import { describe, expect, test } from "bun:test"
import type { OpencodeClient } from "@opencode-ai/sdk/v2/client"
import { loadRootSessionsV1 } from "./session-load"

describe("loadRootSessionsV1", () => {
  test("retries without a limit when an older server rejects the limited query", async () => {
    const calls: unknown[] = []
    const list = async (input: { directory: string; roots: boolean; limit?: number }) => {
      calls.push(input)
      if (input.limit !== undefined) throw new Error("limit is unsupported")
      return { data: [{ id: "session-1" }] }
    }
    const client = { session: { list } } as unknown as OpencodeClient

    const result = await loadRootSessionsV1({ client, directory: "/repo", limit: 20 })

    expect(calls).toEqual([
      { directory: "/repo", roots: true, limit: 20 },
      { directory: "/repo", roots: true },
    ])
    expect(result.data).toHaveLength(1)
    expect(result.data[0]?.id).toBe("session-1")
    expect(result.limit).toBe(20)
    expect(result.limited).toBe(false)
  })
})
