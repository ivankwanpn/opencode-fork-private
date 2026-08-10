export * as Path from "./path"

import { Schema } from "effect"
import { AbsolutePath } from "./schema"

export const Info = Schema.Struct({
  home: AbsolutePath,
  state: AbsolutePath,
  config: AbsolutePath,
  worktree: AbsolutePath,
  directory: AbsolutePath,
}).annotate({ identifier: "Path" })
export interface Info extends Schema.Schema.Type<typeof Info> {}
