export * as ProjectV2 from "./project"
export * as Project from "./project"

import { Context, Effect, Layer, Schema } from "effect"
import path from "path"
import { Database } from "./database/database"
import { AbsolutePath } from "./schema"
import { FSUtil } from "./fs-util"
import { Git } from "./git"
import { makeGlobalNode } from "./effect/app-node"
import { Hash } from "./util/hash"
import { ProjectDirectories } from "./project/directories"
import { ProjectSchema } from "./project/schema"
import { ProjectTable } from "./project/sql"
import { Project } from "@opencode-ai/schema/project"
import { EventV2 } from "./event"
import { eq } from "drizzle-orm"

export const ID = ProjectSchema.ID
export type ID = ProjectSchema.ID

export const Vcs = ProjectSchema.Vcs
export type Vcs = ProjectSchema.Vcs

export class Info extends Schema.Class<Info>("Project.Info")({
  id: ID,
}) {}

export const DirectoriesInput = ProjectDirectories.ListInput
export type DirectoriesInput = typeof DirectoriesInput.Type

export const Directories = ProjectDirectories.ListOutput
export type Directories = typeof Directories.Type

export const UpdateInput = Schema.Struct({
  projectID: ID,
  ...Project.Update.fields,
})
export type UpdateInput = typeof UpdateInput.Type

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("Project.NotFoundError", {
  projectID: ID,
}) {}

export interface Resolved {
  readonly previous?: ID
  readonly id: ID
  readonly directory: AbsolutePath
  readonly vcs?: Vcs
}

export interface Interface {
  readonly directories: (input: DirectoriesInput) => Effect.Effect<Directories>
  readonly resolve: (input: AbsolutePath) => Effect.Effect<Resolved>
  /**
   * Temporary bridge method for writing the resolved project ID to the repo-local cache.
   *
   * This exists while the old opencode project service and this core project
   * service work together: core resolves the ID, while the old service still owns
   * database migration and persistence. The old service should call this after it
   * finishes migrating from `resolve().previous` to `resolve().id`; once project
   * persistence moves into core, this separate bridge method can go away.
   */
  readonly commit: (input: { store: AbsolutePath; id: ID }) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ProjectV2") {}

type Row = typeof ProjectTable.$inferSelect

function fromRow(row: Row): Project.Info {
  return {
    id: row.id,
    worktree: row.worktree,
    vcs: row.vcs ? Schema.decodeUnknownSync(Project.Vcs)(row.vcs) : undefined,
    name: row.name ?? undefined,
    icon:
      row.icon_url || row.icon_url_override || row.icon_color
        ? {
            url: row.icon_url ?? undefined,
            override: row.icon_url_override ?? undefined,
            color: row.icon_color ?? undefined,
          }
        : undefined,
    commands: row.commands ?? undefined,
    time: {
      created: row.time_created,
      updated: row.time_updated,
      initialized: row.time_initialized ?? undefined,
    },
    sandboxes: row.sandboxes,
  }
}

export const list = Effect.fn("Project.list")(function* () {
  const db = (yield* Database.Service).db
  const rows = yield* db.select().from(ProjectTable).all().pipe(Effect.orDie)
  return rows.map(fromRow)
})

export const update = Effect.fn("Project.update")(function* (input: UpdateInput) {
  const db = (yield* Database.Service).db
  const result = yield* db
    .update(ProjectTable)
    .set({
      name: input.name,
      icon_url: input.icon?.url,
      icon_url_override: input.icon?.override,
      icon_color: input.icon?.color,
      commands: input.commands,
      time_updated: Date.now(),
    })
    .where(eq(ProjectTable.id, input.projectID))
    .returning()
    .get()
    .pipe(Effect.orDie)
  if (!result) return yield* new NotFoundError({ projectID: input.projectID })
  const project = fromRow(result)
  yield* (yield* EventV2.Service).publish(Project.Event.Updated, project)
  return project
})

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const git = yield* Git.Service
    const projectDirectories = yield* ProjectDirectories.Service

    const directories = Effect.fn("Project.directories")(function* (input: DirectoriesInput) {
      return yield* projectDirectories.list(input.projectID)
    })

    const cached = Effect.fnUntraced(function* (dir: string) {
      return yield* fs.readFileString(path.join(dir, "opencode")).pipe(
        Effect.map((value) => value.trim()),
        Effect.map((value) => (value ? ID.make(value) : undefined)),
        Effect.catch(() => Effect.succeed(undefined)),
      )
    })

    const remote = Effect.fnUntraced(function* (repo: Git.Repository) {
      const origin = yield* git.remote.get(repo)
      if (!origin) return undefined
      const normalized = url(origin)
      if (!normalized) return undefined
      return ID.make(Hash.fast(`git-remote:${normalized}`))
    })

    function url(input: string) {
      const value = input.trim()
      if (!value) return undefined

      try {
        const parsed = new URL(value)
        if (parsed.protocol === "file:") return undefined
        return parts(parsed.hostname, parsed.pathname)
      } catch {
        const scp = value.match(/^([^@/:]+@)?([^/:]+):(.+)$/)
        if (scp) return parts(scp[2], scp[3])
        return undefined
      }
    }

    function parts(host: string, name: string) {
      const pathname = name
        .replace(/^\/+/, "")
        .replace(/\.git\/?$/, "")
        .replace(/\/+$/, "")
      if (!host || !pathname) return undefined
      return `${host.toLowerCase()}/${pathname}`
    }

    const root = Effect.fnUntraced(function* (repo: Git.Repository) {
      const root = (yield* git.history.rootCommits(repo))[0]
      return root ? ID.make(root) : undefined
    })

    const resolve = Effect.fn("Project.resolve")(function* (input: AbsolutePath) {
      const repo = yield* git.repo.discover(input)
      if (!repo) return { id: ID.global, directory: AbsolutePath.make(path.parse(input).root), vcs: undefined }

      const previous = yield* cached(repo.commonDirectory)
      const id = (yield* remote(repo)) ?? previous ?? (yield* root(repo))
      return {
        previous,
        id: id ?? ID.global,
        directory: repo.worktree,
        vcs: { type: "git" as const, store: repo.commonDirectory },
      }
    })

    const commit = Effect.fn("Project.commit")(function* (input: { store: AbsolutePath; id: ID }) {
      yield* fs.writeFileString(path.join(input.store, "opencode"), input.id).pipe(Effect.ignore)
    })

    return Service.of({ directories, resolve, commit })
  }),
)

export const node = makeGlobalNode({
  service: Service,
  layer: layer,
  deps: [FSUtil.node, Git.node, ProjectDirectories.node],
})
