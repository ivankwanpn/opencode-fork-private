import path from "path"
import { applyEdits, modify, parse, printParseErrorCode, type ParseError } from "jsonc-parser"
import { ConfigMCP } from "@opencode-ai/core/config/mcp"
import { ConfigMigrateV1 } from "@opencode-ai/core/v1/config/migrate"
import { Global } from "@opencode-ai/core/global"
import { Flock } from "@opencode-ai/core/util/flock"
import type {
  DirectCapability,
  DirectPlugin,
  DirectPluginInspection,
  ManagedMcp,
  McpConfig,
} from "@opencode-ai/protocol/groups/plugin"
import { ConfigPaths } from "@/config/paths"
import { errorMessage } from "@/util/error"
import { Filesystem } from "@/util/filesystem"
import { isRecord } from "@/util/record"
import {
  installPlugin,
  patchPluginConfig,
  readPluginManifest,
  removePluginConfig,
  type PatchItem,
  type Target,
} from "./install"

type DirectPluginState = {
  id: string
  name: string
  source: string
  description?: string
  version?: string
  api?: string
  targets: Target[]
  requestedCapabilities: readonly DirectCapability[]
  approvedCapabilities: readonly string[]
  enabled: boolean
  installedAt: string
  entries: Array<Pick<PatchItem, "kind" | "field" | "file">>
}

type ManagedMcpState = {
  name: string
  config: typeof ConfigMCP.Server.Type
  enabled: boolean
  file: string
}

type State = {
  version: 2
  plugins: Record<string, DirectPluginState>
  mcp: Record<string, ManagedMcpState>
}

export type DirectExtensionPaths = {
  stateFile: string
  configDirectory: string
}

const defaultPaths: DirectExtensionPaths = {
  stateFile: path.join(Global.Path.state, "direct-extensions.json"),
  configDirectory: Global.Path.config,
}

const declarativeCapabilities = new Set(["skills", "commands", "mcp", "themes"])
const runtimeCapabilities = new Set([
  "plugin.runtime",
  "agent.transform",
  "catalog.transform",
  "command.transform",
  "integration.transform",
  "reference.transform",
  "skill.transform",
])

function capability(name: string): DirectCapability {
  if (declarativeCapabilities.has(name)) return { name, tier: "declarative" }
  if (runtimeCapabilities.has(name)) return { name, tier: "runtime" }
  return { name, tier: "trusted-runtime" }
}

function emptyState(): State {
  return { version: 2, plugins: {}, mcp: {} }
}

function isNodeError(input: unknown, code: string) {
  return input instanceof Error && "code" in input && input.code === code
}

function parseConfig(file: string, text: string) {
  const errors: ParseError[] = []
  const value = parse(text, errors, { allowTrailingComma: true })
  const first = errors[0]
  if (!first) return value
  const lines = text.substring(0, first.offset).split("\n")
  throw new Error(
    `Invalid JSON in ${file} (${printParseErrorCode(first.error)} at line ${lines.length}, column ${lines.at(-1)!.length + 1})`,
  )
}

function same(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function directPlugin(item: DirectPluginState): DirectPlugin {
  return {
    id: item.id,
    name: item.name,
    source: item.source,
    ...(item.description ? { description: item.description } : {}),
    ...(item.version ? { version: item.version } : {}),
    ...(item.api ? { api: item.api } : {}),
    targets: item.targets.map((target) => target.kind),
    requestedCapabilities: item.requestedCapabilities,
    approvedCapabilities: item.approvedCapabilities,
    enabled: item.enabled,
    installedAt: item.installedAt,
  }
}

function managedMcp(item: ManagedMcpState): ManagedMcp {
  return { name: item.name, type: item.config.type, enabled: item.enabled }
}

export class DirectExtensionManager {
  private readonly paths: DirectExtensionPaths

  constructor(paths: DirectExtensionPaths = defaultPaths) {
    this.paths = paths
  }

  async list() {
    return Flock.withLock(`direct-extensions:${this.paths.stateFile}`, async () => {
      const state = await this.loadState()
      return {
        directPlugins: Object.values(state.plugins)
          .map(directPlugin)
          .toSorted((a, b) => a.name.localeCompare(b.name)),
        mcpServers: Object.values(state.mcp)
          .map(managedMcp)
          .toSorted((a, b) => a.name.localeCompare(b.name)),
      }
    })
  }

  async inspectPlugin(source: string): Promise<DirectPluginInspection> {
    const value = source.trim()
    if (!value) throw new Error("Plugin source cannot be empty")
    const installed = await installPlugin(value)
    if (!installed.ok) throw new Error(`Could not resolve plugin ${value}: ${errorMessage(installed.error)}`)
    const manifest = await readPluginManifest(installed.target)
    if (!manifest.ok) {
      if (manifest.code === "manifest_no_targets") {
        throw new Error(`Plugin ${value} does not expose a server, TUI, or theme target`)
      }
      throw new Error(`Could not read plugin manifest ${manifest.file}: ${errorMessage(manifest.error)}`)
    }
    if (manifest.targets.some((target) => target.kind === "server") && manifest.api !== "v2") {
      throw new Error(`Direct server plugin ${manifest.name} must declare opencode.api as v2`)
    }
    return {
      source: value,
      name: manifest.name,
      ...(manifest.description ? { description: manifest.description } : {}),
      ...(manifest.version ? { version: manifest.version } : {}),
      ...(manifest.api ? { api: manifest.api } : {}),
      targets: manifest.targets.map((target) => target.kind),
      requestedCapabilities: manifest.capabilities.map(capability),
    }
  }

  async installDirectPlugin(source: string, trusted: boolean, approvedCapabilities: readonly string[]) {
    return Flock.withLock(`direct-extensions:${this.paths.stateFile}`, async () => {
      const inspection = await this.inspectPlugin(source)
      if (!trusted) throw new Error(`Direct plugin source requires explicit trust: ${inspection.name}`)
      const approved = Array.from(new Set(approvedCapabilities)).filter((name) =>
        inspection.requestedCapabilities.some((item) => item.name === name),
      )
      const missing = inspection.requestedCapabilities.filter((item) => !approved.includes(item.name))
      if (missing.length)
        throw new Error(`Capabilities require approval: ${missing.map((item) => item.name).join(", ")}`)

      const state = await this.loadState()
      const id = `direct:${inspection.name}`
      const existing = state.plugins[id]
      if (existing && existing.source !== inspection.source) {
        throw new Error(`Direct plugin name is already managed from another source: ${inspection.name}`)
      }

      const installed = await installPlugin(inspection.source)
      if (!installed.ok) {
        throw new Error(`Could not resolve plugin ${inspection.source}: ${errorMessage(installed.error)}`)
      }
      const manifest = await readPluginManifest(installed.target)
      if (!manifest.ok) throw new Error(`Plugin manifest changed during installation: ${inspection.source}`)
      const patched = await patchPluginConfig({
        spec: inspection.source,
        targets: manifest.targets,
        api: inspection.api,
        global: true,
        worktree: "/",
        directory: this.paths.configDirectory,
        config: this.paths.configDirectory,
      })
      if (!patched.ok) {
        const rollback = await removePluginConfig({
          spec: inspection.source,
          items: patched.items.filter((item) => item.mode !== "noop"),
        })
        if (!rollback.ok) {
          throw new Error(`Could not update plugin config: ${patched.code}; rollback failed: ${rollback.code}`)
        }
        throw new Error(`Could not update plugin config: ${patched.code}`)
      }

      const foreign = patched.items.filter((item) => item.mode === "noop")
      if (foreign.length && !existing?.enabled) {
        await removePluginConfig({
          spec: inspection.source,
          items: patched.items.filter((item) => item.mode !== "noop"),
        })
        throw new Error(`Plugin is already configured outside the direct extension manager: ${inspection.name}`)
      }

      state.plugins[id] = {
        id,
        name: inspection.name,
        source: inspection.source,
        ...(inspection.description ? { description: inspection.description } : {}),
        ...(inspection.version ? { version: inspection.version } : {}),
        ...(inspection.api ? { api: inspection.api } : {}),
        targets: manifest.targets,
        requestedCapabilities: [...inspection.requestedCapabilities],
        approvedCapabilities: approved,
        enabled: true,
        installedAt: existing?.installedAt ?? new Date().toISOString(),
        entries: patched.items.map((item) => ({ kind: item.kind, field: item.field, file: item.file })),
      }
      await this.saveState(state)
      return this.catalog(state)
    })
  }

  async disableDirectPlugin(id: string) {
    return this.updatePlugin(id, async (state, item) => {
      if (!item.enabled) return
      const removed = await removePluginConfig({ spec: item.source, items: item.entries })
      if (!removed.ok) throw new Error(`Could not disable plugin ${item.name}: ${removed.code}`)
      item.enabled = false
      await this.saveState(state)
    })
  }

  async enableDirectPlugin(id: string) {
    return this.updatePlugin(id, async (state, item) => {
      if (item.enabled) return
      const patched = await patchPluginConfig({
        spec: item.source,
        targets: item.targets,
        api: item.api,
        global: true,
        worktree: "/",
        directory: this.paths.configDirectory,
        config: this.paths.configDirectory,
      })
      if (!patched.ok) {
        const rollback = await removePluginConfig({
          spec: item.source,
          items: patched.items.filter((entry) => entry.mode !== "noop"),
        })
        if (!rollback.ok) {
          throw new Error(`Could not enable plugin ${item.name}: ${patched.code}; rollback failed: ${rollback.code}`)
        }
        throw new Error(`Could not enable plugin ${item.name}: ${patched.code}`)
      }
      if (patched.items.some((entry) => entry.mode === "noop")) {
        await removePluginConfig({
          spec: item.source,
          items: patched.items.filter((entry) => entry.mode !== "noop"),
        })
        throw new Error(`Plugin config is now owned outside the direct extension manager: ${item.name}`)
      }
      item.entries = patched.items.map((entry) => ({ kind: entry.kind, field: entry.field, file: entry.file }))
      item.enabled = true
      await this.saveState(state)
    })
  }

  async uninstallDirectPlugin(id: string) {
    return this.updatePlugin(id, async (state, item) => {
      if (item.enabled) {
        const removed = await removePluginConfig({ spec: item.source, items: item.entries })
        if (!removed.ok) throw new Error(`Could not uninstall plugin ${item.name}: ${removed.code}`)
      }
      delete state.plugins[id]
      await this.saveState(state)
    })
  }

  async installMcp(name: string, config: McpConfig) {
    return Flock.withLock(`direct-extensions:${this.paths.stateFile}`, async () => {
      const value = name.trim()
      if (!value) throw new Error("MCP server name cannot be empty")
      if (config.type === "local" && config.command.length === 0) throw new Error("Local MCP command cannot be empty")
      if (config.type === "remote" && !URL.canParse(config.url)) throw new Error(`Invalid MCP URL: ${config.url}`)

      const state = await this.loadState()
      const current = state.mcp[value]
      const next: typeof ConfigMCP.Server.Type =
        config.type === "local"
          ? {
              type: "local",
              command: [...config.command],
              ...(config.cwd ? { cwd: config.cwd } : {}),
              ...(config.environment ? { environment: { ...config.environment } } : {}),
              ...(config.timeout ? { timeout: { ...config.timeout } } : {}),
              disabled: false,
            }
          : {
              type: "remote",
              url: config.url,
              ...(config.headers ? { headers: { ...config.headers } } : {}),
              ...(config.oauth === false ? { oauth: false as const } : {}),
              ...(config.timeout ? { timeout: { ...config.timeout } } : {}),
              disabled: false,
            }
      const file = current?.file ?? (await this.configFile())
      await this.patchMcp(file, value, next, current?.config)
      state.mcp[value] = { name: value, config: next, enabled: true, file }
      await this.saveState(state)
      return this.catalog(state)
    })
  }

  async disableMcp(name: string) {
    return this.updateMcp(name, async (state, item) => {
      if (!item.enabled) return
      const config = { ...item.config, disabled: true }
      await this.patchMcp(item.file, item.name, config, item.config)
      item.config = config
      item.enabled = false
      await this.saveState(state)
    })
  }

  async enableMcp(name: string) {
    return this.updateMcp(name, async (state, item) => {
      if (item.enabled) return
      const config = { ...item.config, disabled: false }
      await this.patchMcp(item.file, item.name, config, item.config)
      item.config = config
      item.enabled = true
      await this.saveState(state)
    })
  }

  async removeMcp(name: string) {
    return this.updateMcp(name, async (state, item) => {
      await this.patchMcp(item.file, item.name, undefined, item.config)
      delete state.mcp[item.name]
      await this.saveState(state)
    })
  }

  private async updatePlugin(id: string, update: (state: State, item: DirectPluginState) => Promise<void>) {
    return Flock.withLock(`direct-extensions:${this.paths.stateFile}`, async () => {
      const state = await this.loadState()
      const item = state.plugins[id]
      if (!item) throw new Error(`Direct plugin not found: ${id}`)
      await update(state, item)
      return this.catalog(state)
    })
  }

  private async updateMcp(name: string, update: (state: State, item: ManagedMcpState) => Promise<void>) {
    return Flock.withLock(`direct-extensions:${this.paths.stateFile}`, async () => {
      const state = await this.loadState()
      const item = state.mcp[name]
      if (!item) throw new Error(`Managed MCP server not found: ${name}`)
      await update(state, item)
      return this.catalog(state)
    })
  }

  private catalog(state: State) {
    return {
      directPlugins: Object.values(state.plugins)
        .map(directPlugin)
        .toSorted((a, b) => a.name.localeCompare(b.name)),
      mcpServers: Object.values(state.mcp)
        .map(managedMcp)
        .toSorted((a, b) => a.name.localeCompare(b.name)),
    }
  }

  private async configFile() {
    const files = ConfigPaths.fileInDirectory(this.paths.configDirectory, "opencode")
    const missing: string[] = []
    for (const file of files) {
      if (!(await Filesystem.exists(file))) {
        missing.push(file)
        continue
      }
      const text = await Filesystem.readText(file)
      const data = parseConfig(file, text)
      if (!ConfigMigrateV1.isV1(data)) return file
    }
    if (missing[0]) return missing[0]
    throw new Error(`No V2 config file is available in ${this.paths.configDirectory}`)
  }

  private async patchMcp(
    file: string,
    name: string,
    value: typeof ConfigMCP.Server.Type | undefined,
    owned: typeof ConfigMCP.Server.Type | undefined,
  ) {
    await using _ = await Flock.acquire(`direct-mcp-config:${Filesystem.resolve(file)}`)
    const text = (await Filesystem.exists(file)) ? await Filesystem.readText(file) : "{}"
    const data = parseConfig(file, text)
    const mcp = isRecord(data) && isRecord(data.mcp) ? data.mcp : {}
    const servers = isRecord(mcp.servers) ? mcp.servers : {}
    const current = servers[name]
    if (owned === undefined && current !== undefined) throw new Error(`MCP server is already configured: ${name}`)
    if (owned !== undefined && !same(current, owned)) {
      throw new Error(`Managed MCP config was modified outside the extension manager: ${name}`)
    }
    await Filesystem.write(
      file,
      applyEdits(
        text,
        modify(text, ["mcp", "servers", name], value, {
          formattingOptions: { tabSize: 2, insertSpaces: true },
        }),
      ),
    )
  }

  private async loadState(): Promise<State> {
    const value = await Filesystem.readJson<unknown>(this.paths.stateFile).catch((error: unknown) => {
      if (isNodeError(error, "ENOENT")) return emptyState()
      throw error
    })
    if (!isRecord(value) || value.version !== 2 || !isRecord(value.plugins) || !isRecord(value.mcp)) {
      throw new Error(`Invalid direct extension state file: ${this.paths.stateFile}`)
    }
    return value as State
  }

  private async saveState(state: State) {
    await Filesystem.writeJson(this.paths.stateFile, state)
  }
}

export * as DirectExtension from "./direct-extension"
