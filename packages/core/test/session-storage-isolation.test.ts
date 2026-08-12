import { expect, test } from "bun:test"
import path from "node:path"
import { fileURLToPath } from "node:url"

const symbols = /\b(?:MessageTable|PartTable|SessionMessageTombstoneTable)\b/

test("runtime source does not expose legacy transcript tables", async () => {
  const packages = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
  const roots = [path.join(packages, "core", "src"), path.join(packages, "opencode", "src")]
  const offenders = (
    await Promise.all(
      roots.flatMap((root) =>
        [...new Bun.Glob("**/*.ts").scanSync(root)]
          .filter((file) => !file.replaceAll("\\", "/").startsWith("database/migration/"))
          .map(async (file) => ({
            file: path.relative(packages, path.join(root, file)).replaceAll("\\", "/"),
            source: await Bun.file(path.join(root, file)).text(),
          })),
      ),
    )
  )
    .filter((file) => symbols.test(file.source))
    .map((file) => file.file)
    .sort()

  expect(offenders).toEqual([])
})
