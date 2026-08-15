import fsNode from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import type { Marketplace, Plugin } from "@opencode-ai/protocol/groups/plugin"
import { Global } from "@opencode-ai/core/global"
import { Plugin as PluginSchema } from "@opencode-ai/schema/plugin"
import { Process } from "@/util/process"

type RecordValue = Record<string, unknown>

type MarketplacePlugin = {
  name: string
  description?: string
  version?: string
  category?: string
  tags: string[]
  source: string | RecordValue
}

type MarketplaceManifest = {
  name: string
  plugins: MarketplacePlugin[]
}

type PluginSource =
  | {
      kind: "local"
      source: string
    }
  | {
      kind: "git"
      source: string
      path?: string
      ref?: string
      sha?: string
    }

type ManagedMcpServer =
  | {
      type: "local"
      command: string[]
      cwd?: string
      environment?: Record<string, string>
    }
  | {
      type: "remote"
      url: string
      headers?: Record<string, string>
    }

type GeneratedArtifacts = {
  skillDirectory?: string
  commandDirectory?: string
}

type PluginState = {
  id: string
  name: string
  marketplace: string
  installPath: string
  installed: boolean
  enabled: boolean
  artifacts?: GeneratedArtifacts
  mcp: Record<string, ManagedMcpServer>
}

type MarketplaceState = {
  name: string
  source: string
  cachePath: string
  lastUpdated: string
}

type State = {
  version: 1
  marketplaces: Record<string, MarketplaceState>
  plugins: Record<string, PluginState>
}

export type MarketplacePaths = {
  stateFile: string
  marketplaceDirectory: string
  pluginDirectory: string
  generatedSkillDirectory: string
  generatedCommandDirectory: string
}

export type RuntimeDescriptor = {
  readonly id: string
  readonly enabled: boolean
  readonly capabilities: readonly PluginSchema.RuntimeCapabilityName[]
  readonly skillDirectory?: string
  readonly commandNames: readonly string[]
  readonly mcpServers: readonly string[]
  readonly pluginRuntimeID?: string
}

const defaultPaths: MarketplacePaths = {
  stateFile: path.join(Global.Path.state, "claude-marketplaces.json"),
  marketplaceDirectory: path.join(Global.Path.data, "claude-marketplaces"),
  pluginDirectory: path.join(Global.Path.data, "claude-plugins"),
  generatedSkillDirectory: path.join(Global.Path.config, "skills", "claude"),
  generatedCommandDirectory: path.join(Global.Path.config, "commands", "claude"),
}

function isRecord(input: unknown): input is RecordValue {
  return typeof input === "object" && input !== null && !Array.isArray(input)
}

function stringValue(input: unknown) {
  return typeof input === "string" && input.trim() ? input.trim() : undefined
}

function safeSegment(input: string, label: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(input) || input.includes("..")) {
    throw new Error(`${label} contains unsupported path characters: ${input}`)
  }
  return input
}

function parsePluginEntry(input: unknown): MarketplacePlugin {
  if (!isRecord(input)) throw new Error("Marketplace plugin entry must be an object")
  const name = stringValue(input.name)
  if (!name) throw new Error("Marketplace plugin is missing a name")
  safeSegment(name, "Plugin name")

  const source = typeof input.source === "string" ? input.source.trim() : input.source
  if (typeof source !== "string" && !isRecord(source)) {
    throw new Error(`Plugin ${name} is missing a source`)
  }

  const tags = Array.isArray(input.tags) ? input.tags.filter((tag): tag is string => typeof tag === "string") : []
  return {
    name,
    description: stringValue(input.description),
    version: stringValue(input.version),
    category: stringValue(input.category),
    tags,
    source,
  }
}

function parseMarketplaceManifest(input: unknown): MarketplaceManifest {
  if (!isRecord(input)) throw new Error("Marketplace manifest must be an object")
  const name = stringValue(input.name)
  if (!name) throw new Error("Marketplace manifest is missing a name")
  safeSegment(name, "Marketplace name")
  if (!Array.isArray(input.plugins)) throw new Error(`Marketplace ${name} is missing a plugins array`)
  return {
    name,
    plugins: input.plugins.map(parsePluginEntry),
  }
}

async function readJson(file: string) {
  return JSON.parse(await fsNode.readFile(file, "utf8")) as unknown
}

async function isDirectory(input: string) {
  try {
    return (await fsNode.stat(input)).isDirectory()
  } catch {
    return false
  }
}

async function isFile(input: string) {
  try {
    return (await fsNode.stat(input)).isFile()
  } catch {
    return false
  }
}

async function marketplaceManifestPath(root: string) {
  for (const candidate of [
    path.join(root, ".claude-plugin", "marketplace.json"),
    path.join(root, "marketplace.json"),
  ]) {
    if (await isFile(candidate)) return candidate
  }
  throw new Error(`Marketplace manifest not found in ${root}`)
}

async function runGitClone(
  source: string,
  destination: string,
  options: { ref?: string; sha?: string; subdirectory?: string } = {},
) {
  const cloneArgs = [
    "git",
    "clone",
    "--depth",
    "1",
    ...(options.subdirectory ? ["--filter=tree:0", "--no-checkout"] : options.sha ? ["--no-checkout"] : []),
    ...(options.ref ? ["--branch", options.ref] : []),
    source,
    destination,
  ]
  await Process.run(cloneArgs, {
    env: { GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "" },
  })
  if (options.subdirectory) {
    await Process.run(["git", "sparse-checkout", "set", "--cone", "--", options.subdirectory], { cwd: destination })
  }
  if (options.sha) {
    await Process.run(["git", "fetch", "--depth", "1", "origin", options.sha], { cwd: destination }).catch(() =>
      Process.run(["git", "fetch", "--unshallow"], { cwd: destination }),
    )
    await Process.run(["git", "checkout", options.sha], { cwd: destination })
  } else if (options.subdirectory) {
    await Process.run(["git", "checkout", "HEAD"], { cwd: destination })
  }
}

function githubUrl(source: string) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(source)) return
  if (source.split("/").some((part) => part === "." || part === "..")) return
  return `https://github.com/${source}.git`
}

function gitSource(source: string) {
  if (githubUrl(source)) return githubUrl(source)
  if (source.startsWith("git@") || source.startsWith("ssh://")) return source
  try {
    const url = new URL(source)
    if (url.protocol === "http:" || url.protocol === "https:") {
      if (url.hostname === "github.com" && url.pathname.split("/").filter(Boolean).length === 2) {
        return `${source.replace(/\/$/, "")}.git`
      }
      return source
    }
  } catch {
    return
  }
}

function isJsonUrl(source: string) {
  try {
    return new URL(source).pathname.toLowerCase().endsWith(".json")
  } catch {
    return false
  }
}

function localSource(source: string) {
  if (source.startsWith("file://")) return fileURLToPath(source)
  if (source.startsWith("http://") || source.startsWith("https://") || source.startsWith("git@")) return
  return path.resolve(source)
}

function persistedSource(source: string) {
  if (githubUrl(source) || source.startsWith("git@") || source.startsWith("ssh://")) return source
  if (source.startsWith("http://") || source.startsWith("https://")) return source
  return localSource(source) ?? source
}

async function prepareMarketplace(source: string, marketplaceDirectory: string) {
  await fsNode.mkdir(marketplaceDirectory, { recursive: true })
  const staging = await fsNode.mkdtemp(path.join(marketplaceDirectory, ".staging-"))
  const root = path.join(staging, "root")

  try {
    const local = localSource(source)
    if (local && (await isDirectory(local))) {
      await fsNode.cp(local, root, { recursive: true })
    } else if (local && (await isFile(local))) {
      const sourceRoot =
        path.basename(path.dirname(local)) === ".claude-plugin"
          ? path.dirname(path.dirname(local))
          : path.dirname(local)
      await fsNode.cp(sourceRoot, root, { recursive: true })
    } else {
      const git = gitSource(source)
      if (git && !isJsonUrl(source) && !(await isDirectory(root))) {
        await runGitClone(git, root)
      } else if (source.startsWith("http://") || source.startsWith("https://")) {
        const response = await fetch(source)
        if (!response.ok) throw new Error(`Could not fetch marketplace ${source}: ${response.status}`)
        await fsNode.mkdir(path.join(root, ".claude-plugin"), { recursive: true })
        await fsNode.writeFile(path.join(root, ".claude-plugin", "marketplace.json"), await response.text())
      } else {
        throw new Error(`Marketplace source does not exist: ${source}`)
      }
    }

    const manifest = parseMarketplaceManifest(await readJson(await marketplaceManifestPath(root)))
    const cachePath = path.join(marketplaceDirectory, manifest.name)
    await fsNode.rm(cachePath, { recursive: true, force: true })
    await fsNode.rename(root, cachePath)
    return { manifest, cachePath }
  } finally {
    await fsNode.rm(staging, { recursive: true, force: true })
  }
}

function pluginID(marketplace: string, name: string) {
  return `${name}@${marketplace}`
}

function parsePluginID(id: string) {
  const separator = id.lastIndexOf("@")
  if (separator <= 0 || separator === id.length - 1) throw new Error(`Invalid plugin id: ${id}`)
  const name = id.slice(0, separator)
  const marketplace = id.slice(separator + 1)
  safeSegment(name, "Plugin name")
  safeSegment(marketplace, "Marketplace name")
  return { name, marketplace }
}

function pathInside(root: string, input: string) {
  const resolved = path.resolve(root, input)
  const relative = path.relative(root, resolved)
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Plugin source escapes marketplace directory: ${input}`)
  }
  return resolved
}

function sourceValue(source: string | RecordValue, key: string) {
  if (typeof source === "string") return
  return stringValue(source[key])
}

function gitPluginSource(source: RecordValue, kind: string, url = sourceValue(source, "url")): PluginSource {
  if (!url) throw new Error(`Claude plugin source ${kind} is missing url`)
  const subdirectory = sourceValue(source, "path")
  if (kind === "git-subdir" && !subdirectory) {
    throw new Error("Claude plugin source git-subdir is missing path")
  }
  const ref = sourceValue(source, "ref")
  const sha = sourceValue(source, "sha")
  return {
    kind: "git",
    source: githubUrl(url) ?? url,
    ...(subdirectory ? { path: subdirectory } : {}),
    ...(ref ? { ref } : {}),
    ...(sha ? { sha } : {}),
  }
}

function pluginSource(source: string | RecordValue, marketplaceRoot: string): PluginSource {
  if (typeof source === "string") {
    const git = gitSource(source)
    if (git) return { kind: "git" as const, source: git }
    if (source.startsWith("http://") || source.startsWith("https://")) return { kind: "git" as const, source }
    return { kind: "local" as const, source: pathInside(marketplaceRoot, source) }
  }

  const kind = sourceValue(source, "source")
  if (kind === "github") {
    const repo = sourceValue(source, "repo")
    if (!repo) throw new Error("GitHub plugin source is missing repo")
    return gitPluginSource(source, "github", `https://github.com/${repo}.git`)
  }
  if (kind === "git" || kind === "git-subdir" || kind === "url") return gitPluginSource(source, kind)
  if (kind === "directory" || kind === "file") {
    const localPath = sourceValue(source, "path")
    if (!localPath) throw new Error(`Plugin source ${kind} is missing path`)
    return { kind: "local" as const, source: pathInside(marketplaceRoot, localPath) }
  }
  throw new Error(`Unsupported Claude plugin source: ${kind ?? "unknown"}`)
}

function mcpServer(input: unknown): ManagedMcpServer | undefined {
  if (!isRecord(input)) return
  const command =
    typeof input.command === "string" ? [input.command] : Array.isArray(input.command) ? input.command : undefined
  if (command && command.every((item) => typeof item === "string")) {
    const args = Array.isArray(input.args) ? input.args.filter((item): item is string => typeof item === "string") : []
    const environment = isRecord(input.env)
      ? Object.fromEntries(
          Object.entries(input.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
        )
      : undefined
    return {
      type: "local",
      command: [...command, ...args],
      ...(stringValue(input.cwd) ? { cwd: stringValue(input.cwd) } : {}),
      ...(environment && Object.keys(environment).length ? { environment } : {}),
    }
  }

  const url = stringValue(input.url)
  if (!url) return
  const headers = isRecord(input.headers)
    ? Object.fromEntries(
        Object.entries(input.headers).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
      )
    : undefined
  return {
    type: "remote",
    url,
    ...(headers && Object.keys(headers).length ? { headers } : {}),
  }
}

async function readPluginMcp(root: string, marketplace: string, plugin: string) {
  const file = path.join(root, ".mcp.json")
  if (!(await isFile(file))) return {}
  const raw = await readJson(file)
  if (!isRecord(raw)) return {}
  const servers = isRecord(raw.mcpServers) ? raw.mcpServers : raw
  const entries = Object.entries(servers).flatMap(([name, value]) => {
    const server = mcpServer(value)
    return server ? [[`claude:${marketplace}:${plugin}:${name}`, server] as const] : []
  })
  return Object.fromEntries(entries)
}

async function copyDirectory(source: string, destination: string) {
  if (!(await isDirectory(source))) return false
  await fsNode.rm(destination, { recursive: true, force: true })
  await fsNode.mkdir(path.dirname(destination), { recursive: true })
  await fsNode.cp(source, destination, { recursive: true })
  return true
}

export class ClaudeMarketplaceManager {
  private readonly paths: MarketplacePaths

  constructor(paths: MarketplacePaths = defaultPaths) {
    this.paths = paths
  }

  async list() {
    const state = await this.loadState()
    const marketplaces: Marketplace[] = []
    const plugins: Plugin[] = []

    for (const marketplace of Object.values(state.marketplaces)) {
      try {
        const manifest = parseMarketplaceManifest(await readJson(await marketplaceManifestPath(marketplace.cachePath)))
        marketplaces.push({
          name: marketplace.name,
          source: marketplace.source,
          lastUpdated: marketplace.lastUpdated,
          pluginCount: manifest.plugins.length,
        })
        for (const entry of manifest.plugins) {
          const id = pluginID(marketplace.name, entry.name)
          const installed = state.plugins[id]
          plugins.push({
            id,
            name: entry.name,
            marketplace: marketplace.name,
            ...(entry.description ? { description: entry.description } : {}),
            ...(entry.version ? { version: entry.version } : {}),
            ...(entry.category ? { category: entry.category } : {}),
            tags: entry.tags,
            capabilities: await this.capabilities(marketplace.cachePath, entry).catch(() => ["plugin"]),
            mcpServers: Object.keys(installed?.mcp ?? {}).toSorted(),
            installed: installed?.installed === true,
            enabled: installed?.enabled === true,
          })
        }
      } catch (error) {
        marketplaces.push({
          name: marketplace.name,
          source: marketplace.source,
          lastUpdated: marketplace.lastUpdated,
          pluginCount: 0,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    return { marketplaces, plugins }
  }

  async addMarketplace(source: string) {
    const value = source.trim()
    if (!value) throw new Error("Marketplace source cannot be empty")
    const prepared = await prepareMarketplace(value, this.paths.marketplaceDirectory)
    const state = await this.loadState()
    state.marketplaces[prepared.manifest.name] = {
      name: prepared.manifest.name,
      source: persistedSource(value),
      cachePath: prepared.cachePath,
      lastUpdated: new Date().toISOString(),
    }
    await this.saveState(state)
    return this.list()
  }

  async refreshMarketplace(name: string) {
    const state = await this.loadState()
    const marketplace = state.marketplaces[name]
    if (!marketplace) throw new Error(`Marketplace not found: ${name}`)
    const prepared = await prepareMarketplace(marketplace.source, this.paths.marketplaceDirectory)
    if (prepared.manifest.name !== name)
      throw new Error(`Marketplace name changed from ${name} to ${prepared.manifest.name}`)

    for (const plugin of Object.values(state.plugins).filter((item) => item.marketplace === name && item.installed)) {
      await this.installPluginFiles(plugin, prepared.cachePath)
      if (plugin.enabled) await this.enablePluginArtifacts(plugin)
    }
    marketplace.cachePath = prepared.cachePath
    marketplace.lastUpdated = new Date().toISOString()
    await this.saveState(state)
    return this.list()
  }

  async removeMarketplace(name: string) {
    const state = await this.loadState()
    const marketplace = state.marketplaces[name]
    if (!marketplace) throw new Error(`Marketplace not found: ${name}`)
    for (const plugin of Object.values(state.plugins).filter((item) => item.marketplace === name)) {
      await this.removePluginArtifacts(plugin)
      await fsNode.rm(plugin.installPath, { recursive: true, force: true })
      delete state.plugins[plugin.id]
    }
    await fsNode.rm(marketplace.cachePath, { recursive: true, force: true })
    delete state.marketplaces[name]
    await this.saveState(state)
    return this.list()
  }

  async install(id: string) {
    const state = await this.loadState()
    const { marketplace: marketplaceName, name } = parsePluginID(id)
    const marketplace = state.marketplaces[marketplaceName]
    if (!marketplace) throw new Error(`Marketplace not found: ${marketplaceName}`)
    const manifest = parseMarketplaceManifest(await readJson(await marketplaceManifestPath(marketplace.cachePath)))
    const entry = manifest.plugins.find((item) => item.name === name)
    if (!entry) throw new Error(`Plugin not found: ${id}`)
    const plugin = state.plugins[id] ?? {
      id,
      name,
      marketplace: marketplaceName,
      installPath: path.join(this.paths.pluginDirectory, `${marketplaceName}__${name}`),
      installed: false,
      enabled: false,
      mcp: {},
    }
    await this.removePluginArtifacts(plugin)
    await this.installPluginFiles(plugin, marketplace.cachePath, entry)
    await this.enablePluginArtifacts(plugin)
    plugin.installed = true
    plugin.enabled = true
    state.plugins[id] = plugin
    await this.saveState(state)
    return this.list()
  }

  async uninstall(id: string) {
    const state = await this.loadState()
    const plugin = state.plugins[id]
    if (!plugin) throw new Error(`Plugin is not installed: ${id}`)
    await this.removePluginArtifacts(plugin)
    await fsNode.rm(plugin.installPath, { recursive: true, force: true })
    delete state.plugins[id]
    await this.saveState(state)
    return this.list()
  }

  async enable(id: string) {
    const state = await this.loadState()
    const plugin = state.plugins[id]
    if (!plugin?.installed) throw new Error(`Plugin is not installed: ${id}`)
    const marketplace = state.marketplaces[plugin.marketplace]
    if (!marketplace) throw new Error(`Marketplace not found: ${plugin.marketplace}`)
    await this.enablePluginArtifacts(plugin)
    plugin.enabled = true
    await this.saveState(state)
    return this.list()
  }

  async disable(id: string) {
    const state = await this.loadState()
    const plugin = state.plugins[id]
    if (!plugin) throw new Error(`Plugin is not installed: ${id}`)
    await this.removePluginArtifacts(plugin)
    plugin.enabled = false
    plugin.mcp = {}
    await this.saveState(state)
    return this.list()
  }

  async managedMcpKeys() {
    const state = await this.loadState()
    return Object.values(state.plugins).flatMap((plugin) => Object.keys(plugin.mcp))
  }

  async enabledMcpServers() {
    const state = await this.loadState()
    return Object.fromEntries(Object.values(state.plugins).flatMap((plugin) => Object.entries(plugin.mcp)))
  }

  async runtimeDescriptors(): Promise<RuntimeDescriptor[]> {
    const state = await this.loadState()
    const catalog = await this.list()
    const items = new Map(catalog.plugins.map((plugin) => [plugin.id, plugin]))
    return Promise.all(
      Object.values(state.plugins)
        .filter((plugin) => plugin.installed)
        .toSorted((left, right) => left.id.localeCompare(right.id))
        .map(async (plugin) => {
          const capabilities = (items.get(plugin.id)?.capabilities ?? ["plugin"]).filter(
            (capability): capability is PluginSchema.RuntimeCapabilityName =>
              PluginSchema.RuntimeCapabilityName.literals.includes(capability as PluginSchema.RuntimeCapabilityName),
          )
          if (!plugin.enabled) {
            return {
              id: plugin.id,
              enabled: false,
              capabilities,
              commandNames: [],
              mcpServers: [],
            }
          }

          const skillDirectory =
            plugin.artifacts?.skillDirectory && (await isDirectory(plugin.artifacts.skillDirectory))
              ? plugin.artifacts.skillDirectory
              : undefined
          const commandNames = plugin.artifacts?.commandDirectory
            ? await this.commandNames(plugin.artifacts.commandDirectory)
            : []
          return {
            id: plugin.id,
            enabled: true,
            capabilities,
            ...(skillDirectory ? { skillDirectory } : {}),
            commandNames,
            mcpServers: Object.keys(plugin.mcp).toSorted(),
            ...(capabilities.includes("plugin")
              ? { pluginRuntimeID: `claude-marketplace/${plugin.marketplace}/${plugin.name}` }
              : {}),
          }
        }),
    )
  }

  private async commandNames(directory: string) {
    if (!(await isDirectory(directory))) return []
    const root = path.dirname(this.paths.generatedCommandDirectory)
    const files = await Array.fromAsync(
      new Bun.Glob("**/*.md").scan({ cwd: directory, absolute: true, onlyFiles: true }),
    )
    return files
      .map((file) => path.relative(root, file).replaceAll("\\", "/").replace(/\.md$/, ""))
      .toSorted()
  }

  private async capabilities(root: string, entry: MarketplacePlugin) {
    const source = pluginSource(entry.source, root)
    if (source.kind === "git") return ["plugin"]
    const capabilities = []
    if (await isDirectory(path.join(source.source, "skills"))) capabilities.push("skills")
    if (await isDirectory(path.join(source.source, "commands"))) capabilities.push("commands")
    if (await isFile(path.join(source.source, ".mcp.json"))) capabilities.push("mcp")
    return capabilities.length ? capabilities : ["plugin"]
  }

  private async installPluginFiles(plugin: PluginState, marketplaceRoot: string, entry?: MarketplacePlugin) {
    const manifest = entry ?? (await this.pluginEntry(plugin, marketplaceRoot))
    const source = pluginSource(manifest.source, marketplaceRoot)
    await fsNode.rm(plugin.installPath, { recursive: true, force: true })
    await fsNode.mkdir(path.dirname(plugin.installPath), { recursive: true })
    if (source.kind === "local") {
      if (!(await isDirectory(source.source))) throw new Error(`Plugin source directory not found: ${source.source}`)
      await fsNode.cp(source.source, plugin.installPath, { recursive: true })
      return
    }
    const clonePath = source.path ? `${plugin.installPath}.clone` : plugin.installPath
    await fsNode.rm(clonePath, { recursive: true, force: true })
    try {
      await runGitClone(source.source, clonePath, {
        ref: source.ref,
        sha: source.sha,
        subdirectory: source.path,
      })
      if (!source.path) return
      const subdirectory = pathInside(clonePath, source.path)
      if (!(await isDirectory(subdirectory))) {
        throw new Error(`Plugin subdirectory not found: ${source.path}`)
      }
      await fsNode.cp(subdirectory, plugin.installPath, { recursive: true })
    } finally {
      if (source.path) await fsNode.rm(clonePath, { recursive: true, force: true })
    }
  }

  private async pluginEntry(plugin: PluginState, marketplaceRoot: string) {
    const manifest = parseMarketplaceManifest(await readJson(await marketplaceManifestPath(marketplaceRoot)))
    const entry = manifest.plugins.find((item) => item.name === plugin.name)
    if (!entry) throw new Error(`Plugin not found in marketplace: ${plugin.id}`)
    return entry
  }

  private async enablePluginArtifacts(plugin: PluginState) {
    await this.removePluginArtifacts(plugin)
    const skillDirectory = path.join(this.paths.generatedSkillDirectory, `${plugin.marketplace}__${plugin.name}`)
    const commandDirectory = path.join(this.paths.generatedCommandDirectory, `${plugin.marketplace}__${plugin.name}`)
    const skills = await copyDirectory(path.join(plugin.installPath, "skills"), skillDirectory)
    const commands = await copyDirectory(path.join(plugin.installPath, "commands"), commandDirectory)
    const mcp = await readPluginMcp(plugin.installPath, plugin.marketplace, plugin.name)
    plugin.artifacts = {
      ...(skills ? { skillDirectory } : {}),
      ...(commands ? { commandDirectory } : {}),
    }
    plugin.mcp = mcp
  }

  private async removePluginArtifacts(plugin: PluginState) {
    if (plugin.artifacts?.skillDirectory)
      await fsNode.rm(plugin.artifacts.skillDirectory, { recursive: true, force: true })
    if (plugin.artifacts?.commandDirectory)
      await fsNode.rm(plugin.artifacts.commandDirectory, { recursive: true, force: true })
    plugin.artifacts = undefined
    plugin.mcp = {}
  }

  private async loadState(): Promise<State> {
    try {
      const value = await readJson(this.paths.stateFile)
      if (!isRecord(value) || value.version !== 1 || !isRecord(value.marketplaces) || !isRecord(value.plugins)) {
        throw new Error(`Invalid Claude marketplace state file: ${this.paths.stateFile}`)
      }
      const state = value as unknown as State
      return {
        ...state,
        marketplaces: Object.fromEntries(Object.values(state.marketplaces).map((item) => [item.name, item])),
      }
    } catch (error) {
      if (isNodeError(error, "ENOENT")) return { version: 1, marketplaces: {}, plugins: {} }
      throw error
    }
  }

  private async saveState(state: State) {
    await fsNode.mkdir(path.dirname(this.paths.stateFile), { recursive: true })
    await fsNode.writeFile(this.paths.stateFile, JSON.stringify(state, null, 2))
  }
}

function isNodeError(input: unknown, code: string) {
  return input instanceof Error && "code" in input && input.code === code
}

export type { ManagedMcpServer }
