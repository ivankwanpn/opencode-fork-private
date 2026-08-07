import { describe, expect, test } from "bun:test"
import type { ServerApi } from "@/utils/server"
import { loadRootSessions } from "./session-load"

describe("loadRootSessions", () => {
  test("loads one limited page of root sessions from the V2 API", async () => {
    const calls: unknown[] = []
    const api = {
      list: async (input: unknown) => {
        calls.push(input)
        return {
          data: [
            {
              id: "session-1",
              projectID: "project",
              title: "Session 1",
              location: { directory: "/repo" },
              cost: 0,
              tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
              time: { created: 1, updated: 1 },
            },
          ],
          cursor: {},
        }
      },
    } as unknown as Pick<ServerApi["session"], "list">

    const result = await loadRootSessions({ api, directory: "/repo", limit: 20 })

    expect(calls).toEqual([{ directory: "/repo", parentID: null, limit: 20, order: "desc" }])
    expect(result.data).toEqual([expect.objectContaining({ id: "session-1", directory: "/repo" })])
    expect(result.limit).toBe(20)
    expect(result.limited).toBe(true)
  })
})
