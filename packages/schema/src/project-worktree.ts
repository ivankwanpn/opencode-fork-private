export * as ProjectWorktree from "./project-worktree"

import { Schema } from "effect"
import { AbsolutePath, optional } from "./schema"

export const Info = Schema.Struct({
  name: Schema.String,
  branch: optional(Schema.String),
  directory: AbsolutePath,
}).annotate({ identifier: "ProjectWorktree.Info" })
export interface Info extends Schema.Schema.Type<typeof Info> {}

export const Create = Schema.Struct({
  name: optional(Schema.String),
  startCommand: optional(Schema.String),
}).annotate({ identifier: "ProjectWorktree.Create" })
export interface Create extends Schema.Schema.Type<typeof Create> {}

export const Remove = Schema.Struct({
  directory: AbsolutePath,
}).annotate({ identifier: "ProjectWorktree.Remove" })
export interface Remove extends Schema.Schema.Type<typeof Remove> {}

export const Reset = Schema.Struct({
  directory: AbsolutePath,
}).annotate({ identifier: "ProjectWorktree.Reset" })
export interface Reset extends Schema.Schema.Type<typeof Reset> {}
