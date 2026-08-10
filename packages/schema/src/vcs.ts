export * as Vcs from "./vcs"

import { Schema } from "effect"
import { optional } from "./schema"
import { FileDiff } from "./file-diff"

export const Info = Schema.Struct({
  branch: optional(Schema.String),
  default_branch: optional(Schema.String),
}).annotate({ identifier: "VcsInfo" })
export type Info = typeof Info.Type

export const FileStatus = Schema.Struct({
  file: Schema.String,
  additions: Schema.Finite,
  deletions: Schema.Finite,
  status: Schema.Literals(["added", "deleted", "modified"]),
}).annotate({ identifier: "VcsFileStatus" })
export type FileStatus = typeof FileStatus.Type

export const DiffMode = Schema.Literals(["git", "branch"])
export type DiffMode = typeof DiffMode.Type

export const Diff = FileDiff.Info
export type Diff = FileDiff.Info
