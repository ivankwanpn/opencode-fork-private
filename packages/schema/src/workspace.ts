export * as Workspace from "./workspace"

import { WorkspaceEvent } from "./workspace-event"
import { WorkspaceID } from "./workspace-id"
import { ProjectID } from "./project-id"
import { SessionID } from "./session-id"
import { Schema } from "effect"
import { optional } from "./schema"

export const ID = WorkspaceID
export type ID = WorkspaceID

export const Event = WorkspaceEvent

export const Info = Schema.Struct({
  id: ID,
  type: Schema.String,
  name: Schema.String,
  branch: optional(Schema.NullOr(Schema.String)),
  directory: optional(Schema.NullOr(Schema.String)),
  extra: optional(Schema.NullOr(Schema.Unknown)),
  projectID: ProjectID,
  timeUsed: Schema.Number,
}).annotate({ identifier: "Workspace" })
export type Info = typeof Info.Type

export const Adapter = Schema.Struct({
  type: Schema.String,
  name: Schema.String,
  description: Schema.String,
}).annotate({ identifier: "Workspace.Adapter" })
export type Adapter = typeof Adapter.Type

export const Create = Schema.Struct({
  id: optional(ID),
  type: Schema.String,
  branch: optional(Schema.NullOr(Schema.String)),
  extra: optional(Schema.NullOr(Schema.Unknown)),
}).annotate({ identifier: "Workspace.Create" })
export type Create = typeof Create.Type

export const Warp = Schema.Struct({
  workspaceID: Schema.NullOr(ID),
  sessionID: SessionID,
  copyChanges: optional(Schema.Boolean),
}).annotate({ identifier: "Workspace.Warp" })
export type Warp = typeof Warp.Type
