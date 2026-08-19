export * as EventManifest from "./event-manifest"

import { Catalog } from "./catalog"
import { Command } from "./command"
import { Durable } from "./durable-event-manifest"
import { Event } from "./event"
import { FileSystem } from "./filesystem"
import { FileSystemWatcher } from "./filesystem-watcher"
import { Integration } from "./integration"
import { LspEvent } from "./lsp-event"
import { McpEvent } from "./mcp-event"
import { ModelsDev } from "./models-dev"
import { Permission } from "./permission"
import { Plugin } from "./plugin"
import { Project } from "./project"
import { ProjectDirectories } from "./project-directories"
import { Pty } from "./pty"
import { Question } from "./question"
import { Reference } from "./reference"
import { ServerEvent } from "./server-event"
import { SessionEvent } from "./session-event"
import { SessionTodo } from "./session-todo"
import { TuiEvent } from "./tui-event"
import { VcsEvent } from "./vcs-event"
import { WorkspaceEvent } from "./workspace-event"
import { WorktreeEvent } from "./worktree-event"

const coreDefinitions = Event.inventory(...SessionEvent.Definitions)

const foundationDefinitions = Event.inventory(
  ...ModelsDev.Event.Definitions,
  ...Integration.Event.Definitions,
  ...Catalog.Event.Definitions,
  ...Command.Event.Definitions,
  ...LspEvent.Definitions,
  ...VcsEvent.Definitions,
  ...coreDefinitions,
)

const featureDefinitions = Event.inventory(
  ...FileSystem.Event.Definitions,
  ...Reference.Event.Definitions,
  ...Permission.Event.Definitions,
  ...Plugin.Event.Definitions,
  ...ProjectDirectories.Event.Definitions,
  ...FileSystemWatcher.Event.Definitions,
  ...Pty.Event.Definitions,
  ...Question.Event.Definitions,
)

const compatibilityDefinitions = Event.inventory(
  ...TuiEvent.Definitions,
  ...McpEvent.Definitions,
  ...Project.Event.Definitions,
  ...WorkspaceEvent.Definitions,
  ...WorktreeEvent.Definitions,
  ...ServerEvent.Definitions,
)

export const ServerDefinitions = Event.inventory(
  ...foundationDefinitions,
  ...featureDefinitions,
  ...SessionTodo.Event.Definitions,
  ...compatibilityDefinitions,
)

export const Definitions = ServerDefinitions
export const Latest = Event.latest(Definitions)
export { Durable }
