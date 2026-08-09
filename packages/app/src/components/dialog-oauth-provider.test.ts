import { describe, expect, test } from "bun:test"
import { oauthModelRows } from "./dialog-oauth-provider"

describe("oauthModelRows", () => {
  test("uses arbitrary catalog model IDs", () => {
    const rows = oauthModelRows({
      providerID: "openai",
      models: [
        { id: "runtime-only-model", name: "Runtime", provider: { id: "openai" } },
        { id: "other-model", name: "Other", provider: { id: "other" } },
      ],
    })

    expect(rows.map((row) => ({ id: row.id, name: row.name }))).toEqual([
      { id: "runtime-only-model", name: "Runtime" },
    ])
  })
})
