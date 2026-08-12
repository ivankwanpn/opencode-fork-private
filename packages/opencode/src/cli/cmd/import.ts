import { AbsolutePath } from "@opencode-ai/core/schema"
import { Location } from "@opencode-ai/core/location"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Effect } from "effect"
import { EOL } from "os"
import { InstanceRef } from "@/effect/instance-ref"
import { ShareNext } from "@/share/share-next"
import { CliError, effectCmd } from "../effect-cmd"
import { SessionArchive } from "./session-archive"

export function parseShareUrl(url: string): string | null {
  const match = url.match(/^https?:\/\/[^/]+\/share\/([a-zA-Z0-9_-]+)$/)
  return match ? match[1] : null
}

export function shouldAttachShareAuthHeaders(shareUrl: string, accountBaseUrl: string): boolean {
  try {
    return new URL(shareUrl).origin === new URL(accountBaseUrl).origin
  } catch {
    return false
  }
}

export function formatImportFileError(file: string, error: FSUtil.Error) {
  if (error._tag === "PlatformError") {
    if (error.reason._tag === "NotFound") return `File not found: ${file}`
    if (error.reason._tag === "PermissionDenied") return "Failed to read file: Permission denied"
    return `Failed to read file: ${error.message}`
  }
  const detail = error.cause instanceof Error ? error.cause.message : error.message
  return `Invalid JSON in ${file}: ${detail}`
}

export const ImportCommand = effectCmd({
  command: "import <file>",
  describe: "import session data from JSON file or URL",
  builder: (yargs) =>
    yargs.positional("file", {
      describe: "path to JSON file or share URL",
      type: "string",
      demandOption: true,
    }),
  handler: Effect.fn("Cli.import")(function* (args) {
    const ctx = yield* InstanceRef
    if (!ctx) return yield* Effect.die("InstanceRef not provided")
    const archive = yield* read(args.file)
    const imported = yield* SessionArchive.write(
      archive,
      Location.Ref.make({ directory: AbsolutePath.make(ctx.directory) }),
    ).pipe(Effect.mapError(() => new CliError({ message: `Failed to import session: ${archive.session.id}` })))
    process.stdout.write(`Imported session: ${imported.id}`)
    process.stdout.write(EOL)
  }),
})

const read = Effect.fn("Cli.import.read")(function* (file: string) {
  const raw = file.startsWith("http://") || file.startsWith("https://") ? yield* readShare(file) : yield* readFile(file)
  return yield* SessionArchive.decode(raw).pipe(
    Effect.mapError(() => new CliError({ message: "Invalid session archive: expected version 2 canonical data" })),
  )
})

const readFile = Effect.fn("Cli.import.readFile")(function* (file: string) {
  const fs = yield* FSUtil.Service
  return yield* fs
    .readJson(file)
    .pipe(Effect.mapError((error) => new CliError({ message: formatImportFileError(file, error) })))
})

const readShare = Effect.fn("Cli.import.readShare")(function* (file: string) {
  const share = yield* ShareNext.Service
  const slug = parseShareUrl(file)
  if (!slug) {
    return yield* share.url().pipe(
      Effect.orDie,
      Effect.flatMap((baseUrl) =>
        Effect.fail(new CliError({ message: `Invalid URL format. Expected: ${baseUrl}/share/<slug>` })),
      ),
    )
  }
  const req = yield* Effect.orDie(share.request())
  const headers = shouldAttachShareAuthHeaders(file, req.baseUrl) ? req.headers : {}
  const request = (url: string) =>
    Effect.tryPromise({
      try: () => fetch(url, { headers }),
      catch: (error) =>
        new CliError({
          message: `Failed to fetch share data: ${error instanceof Error ? error.message : String(error)}`,
        }),
    })
  const baseUrl = new URL(file).origin
  const dataPath = req.api.data(slug)
  const first = yield* request(`${baseUrl}${dataPath}`)
  const response =
    !first.ok && dataPath !== `/api/share/${slug}/data` ? yield* request(`${baseUrl}/api/share/${slug}/data`) : first
  if (!response.ok) return yield* new CliError({ message: `Failed to fetch share data: ${response.statusText}` })
  return yield* Effect.tryPromise({
    try: () => response.json() as Promise<unknown>,
    catch: () => new CliError({ message: "Share data was not valid JSON" }),
  })
})
