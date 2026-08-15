import { describe, expect, test } from "bun:test"
import { DateTime } from "effect"
import { fromRow } from "../src/session/info"
import { ModelV2 } from "../src/model"

const row = (model: { id: string; providerID: string; variant?: string } | null = null) => ({
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
  model,
  time_created: 1000,
  time_updated: 1000,
  time_compacting: null,
  time_archived: null,
})

describe("fromRow", () => {
  test("reads an archived timestamp of epoch zero", () => {
    const info = fromRow({ ...row(), time_archived: 0 } as Parameters<typeof fromRow>[0])
    expect(info.time.archived).toEqual(DateTime.makeUnsafe(0))
  })

  test("preserves an omitted model variant", () => {
    const info = fromRow(row({ id: "model", providerID: "provider" }) as Parameters<typeof fromRow>[0])
    expect(info.model?.variant).toBeUndefined()
  })

  test("preserves an explicit default model variant", () => {
    const info = fromRow(
      row({ id: "model", providerID: "provider", variant: "default" }) as Parameters<typeof fromRow>[0],
    )
    expect(info.model?.variant).toBe(ModelV2.VariantID.make("default"))
  })

  test("preserves a non-default model variant", () => {
    const info = fromRow(
      row({ id: "model", providerID: "provider", variant: "high" }) as Parameters<typeof fromRow>[0],
    )
    expect(info.model?.variant).toBe(ModelV2.VariantID.make("high"))
  })
})
