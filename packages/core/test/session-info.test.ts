import { describe, expect, test } from "bun:test"
import { DateTime } from "effect"
import { fromRow } from "../src/session/info"

describe("fromRow", () => {
  test("reads an archived timestamp of epoch zero", () => {
    const row = {
      id: "sess_x",
      project_id: "prj_global",
      workspace_id: null,
      parent_id: null,
      slug: "slug",
      directory: "/project",
      path: null,
      title: "t",
      version: "v",
      share_url: null,
      summary_additions: null,
      summary_deletions: null,
      summary_files: null,
      summary_diffs: null,
      metadata: null,
      cost: 0,
      tokens_input: 0,
      tokens_output: 0,
      tokens_reasoning: 0,
      tokens_cache_read: 0,
      tokens_cache_write: 0,
      revert: null,
      permission: null,
      agent: null,
      model: null,
      time_created: 1000,
      time_updated: 1000,
      time_compacting: null,
      time_archived: 0,
    }
    const info = fromRow(row as Parameters<typeof fromRow>[0])
    expect(info.time.archived).toEqual(DateTime.makeUnsafe(0))
  })
})
