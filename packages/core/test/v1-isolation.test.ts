import { expect, test } from "bun:test"
import { fileURLToPath } from "node:url"
import path from "node:path"

// V1→V2 migration gate: packages/core/src must not grow new direct imports of
// the V1 subtree (`./v1/*`). The migration is in progress, so a fixed allowlist
// of files that legitimately still consume V1 compat assets (storage format,
// compatibility events, config migration) is tolerated. The gate enforces:
//
//   1. No file outside the allowlist may import `./v1/`.
//   2. Allowlisted files are the *only* tolerated consumers; new files must go
//      through V2 types instead.
//
// As migration batches land, entries must be *removed* from this allowlist —
// never added. Deleting the last entry means `core/src` no longer imports V1.

// Current legitimate V1 consumers (see V1-to-V2-migration.md §3.1).
// Each entry is a path relative to packages/core/src.
const allowed = new Set([
  // V2 session → V1 storage format / compatibility events
  "session.ts",
  "session/command.ts",
  "session/info.ts",
  "session/projector.ts",
  "session/sql.ts",
  // Config loading / migration chain
  "config.ts",
  "config/plugin/agent.ts",
  "config/plugin/provider.ts",
  "plugin/provider/opencode.ts",
])

test("core/src does not grow new V1 imports beyond the migration allowlist", async () => {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src")
  const files = [...new Bun.Glob("**/*.ts").scanSync(root)].filter(
    (file) => !file.endsWith(".test.ts") && !file.endsWith(".test-d.ts"),
  )
  const offenders = await Promise.all(
    files.map(async (file) => ({
      file,
      source: await Bun.file(path.join(root, file)).text(),
    })),
  ).then((values) =>
    values
      .filter(
        (value) =>
          value.source.includes('from "./v1/') ||
          value.source.includes('from "../v1/') ||
          value.source.includes('from "../../v1/'),
      )
      .filter((value) => !allowed.has(value.file.replace(/\\/g, "/"))),
  )

  expect(offenders).toEqual([])
})

test("every allowlisted V1 consumer still exists", () => {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src")
  for (const file of allowed) {
    const filePath = path.join(root, file)
    expect(Bun.file(filePath).size, file).toBeGreaterThan(0)
  }
})
