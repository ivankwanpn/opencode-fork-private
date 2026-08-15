import path from "path"
import {
  type ParseError as JsoncParseError,
  applyEdits,
  modify,
  parse as parseJsonc,
  printParseErrorCode,
} from "jsonc-parser"

import * as ConfigPaths from "@/config/paths"
import { Global } from "@opencode-ai/core/global"
import { ConfigMigrateV1 } from "@opencode-ai/core/v1/config/migrate"
import { Filesystem } from "@/util/filesystem"
import { Flock } from "@opencode-ai/core/util/flock"
import { isRecord } from "@/util/record"

import { parsePluginSpecifier, readPackageThemes, readPluginPackage, resolvePluginTarget } from "./shared"

type Mode = "noop" | "add" | "replace"
export type Kind = "server" | "tui"
export type ConfigField = "plugin" | "plugins"

export type Target = {
  kind: Kind
  opts?: Record<string, unknown>
}

export type InstallDeps = {
  resolve: (spec: string) => Promise<string>
}

export type PatchDeps = {
  readText: (file: string) => Promise<string>
  write: (file: string, text: string) => Promise<void>
  exists: (file: string) => Promise<boolean>
  files: (dir: string, name: "opencode" | "tui") => string[]
}

export type PatchInput = {
  spec: string
  targets: Target[]
  api?: string
  force?: boolean
  global?: boolean
  vcs?: string
  worktree: string
  directory: string
  config?: string
}

type Ok<T> = {
  ok: true
} & T

type Err<C extends string, T> = {
  ok: false
  code: C
} & T

export type InstallResult = Ok<{ target: string }> | Err<"install_failed", { error: unknown }>

export type ManifestResult =
  | Ok<{
      name: string
      version?: string
      description?: string
      api?: string
      capabilities: string[]
      targets: Target[]
    }>
  | Err<"manifest_read_failed", { file: string; error: unknown }>
  | Err<"manifest_no_targets", { file: string }>

export type PatchItem = {
  kind: Kind
  field: ConfigField
  mode: Mode
  file: string
}

type PatchErr =
  | Err<"invalid_json", { kind: Kind; file: string; line: number; col: number; parse: string }>
  | Err<"patch_failed", { kind: Kind; error: unknown }>

type PatchOne = Ok<{ item: PatchItem }> | PatchErr

export type PatchResult = Ok<{ dir: string; items: PatchItem[] }> | (PatchErr & { dir: string; items: PatchItem[] })

export type RemoveInput = {
  spec: string
  items: Array<Pick<PatchItem, "kind" | "field" | "file">>
}

export type RemoveItem = {
  kind: Kind
  file: string
  removed: boolean
}

export type RemoveResult = Ok<{ items: RemoveItem[] }> | PatchErr

const defaultInstallDeps: InstallDeps = {
  resolve: (spec) => resolvePluginTarget(spec),
}

const defaultPatchDeps: PatchDeps = {
  readText: (file) => Filesystem.readText(file),
  write: async (file, text) => {
    await Filesystem.write(file, text)
  },
  exists: (file) => Filesystem.exists(file),
  files: (dir, name) => ConfigPaths.fileInDirectory(dir, name),
}

function pluginSpec(item: unknown) {
  if (typeof item === "string") return item
  if (isRecord(item) && typeof item.package === "string") return item.package
  if (!Array.isArray(item)) return
  if (typeof item[0] !== "string") return
  return item[0]
}

function pluginList(data: unknown, field: ConfigField) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return
  const value = (data as Record<string, unknown>)[field]
  if (!Array.isArray(value)) return
  return value
}

function exportValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    const next = value.trim()
    if (next) return next
    return
  }
  if (!isRecord(value)) return
  for (const key of ["import", "default"]) {
    const next = value[key]
    if (typeof next !== "string") continue
    const hit = next.trim()
    if (!hit) continue
    return hit
  }
}

function exportOptions(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return
  const config = value.config
  if (!isRecord(config)) return
  return config
}

function exportTarget(pkg: Record<string, unknown>, kind: Kind) {
  const exports = pkg.exports
  if (!isRecord(exports)) return
  const value = exports[`./${kind}`]
  const entry = exportValue(value)
  if (!entry) return
  return {
    opts: exportOptions(value),
  }
}

function hasMainTarget(pkg: Record<string, unknown>) {
  const main = pkg.main
  if (typeof main !== "string") return false
  return Boolean(main.trim())
}

function packageTargets(pkg: { json: Record<string, unknown>; dir: string; pkg: string }) {
  const spec =
    typeof pkg.json.name === "string" && pkg.json.name.trim().length > 0 ? pkg.json.name.trim() : path.basename(pkg.dir)
  const targets: Target[] = []
  const server = exportTarget(pkg.json, "server")
  if (server) {
    targets.push({ kind: "server", opts: server.opts })
  } else if (hasMainTarget(pkg.json)) {
    targets.push({ kind: "server" })
  }

  const tui = exportTarget(pkg.json, "tui")
  if (tui) {
    targets.push({ kind: "tui", opts: tui.opts })
  }

  if (!targets.some((item) => item.kind === "tui") && readPackageThemes(spec, pkg).length) {
    targets.push({ kind: "tui" })
  }

  return targets
}

function packageManifest(pkg: { json: Record<string, unknown>; dir: string; pkg: string }) {
  const name = typeof pkg.json.name === "string" ? pkg.json.name.trim() : ""
  if (!name) throw new TypeError(`Plugin package ${pkg.pkg} is missing name`)

  const opencode = pkg.json.opencode
  if (opencode !== undefined && !isRecord(opencode)) {
    throw new TypeError(`Plugin package ${pkg.pkg} has an invalid opencode manifest`)
  }
  const api = opencode?.api
  if (api !== undefined && typeof api !== "string") {
    throw new TypeError(`Plugin package ${pkg.pkg} has an invalid opencode.api value`)
  }
  const requested = opencode?.capabilities
  if (requested !== undefined && !Array.isArray(requested)) {
    throw new TypeError(`Plugin package ${pkg.pkg} has an invalid opencode.capabilities value`)
  }
  const capabilities = (requested ?? []).map((item) => {
    if (typeof item !== "string" || !item.trim()) {
      throw new TypeError(`Plugin package ${pkg.pkg} has an invalid capability declaration`)
    }
    return item.trim()
  })
  const version = typeof pkg.json.version === "string" && pkg.json.version.trim() ? pkg.json.version.trim() : undefined
  const description =
    typeof pkg.json.description === "string" && pkg.json.description.trim() ? pkg.json.description.trim() : undefined

  return {
    name,
    ...(version ? { version } : {}),
    ...(description ? { description } : {}),
    ...(typeof api === "string" && api.trim() ? { api: api.trim() } : {}),
    capabilities: Array.from(new Set(capabilities)),
    targets: packageTargets(pkg),
  }
}

function patch(text: string, path: Array<string | number>, value: unknown, insert = false) {
  return applyEdits(
    text,
    modify(text, path, value, {
      formattingOptions: {
        tabSize: 2,
        insertSpaces: true,
      },
      isArrayInsertion: insert,
    }),
  )
}

function patchPluginList(
  text: string,
  list: unknown[] | undefined,
  field: ConfigField,
  spec: string,
  next: unknown,
  force = false,
): { mode: Mode; text: string } {
  const pkg = parsePluginSpecifier(spec).pkg
  const rows = (list ?? []).map((item, i) => ({
    item,
    i,
    spec: pluginSpec(item),
  }))
  const dup = rows.filter((item) => {
    if (!item.spec) return false
    return samePluginSpec(item.spec, spec, pkg)
  })

  if (!dup.length) {
    if (!list) {
      return {
        mode: "add",
        text: patch(text, [field], [next]),
      }
    }
    return {
      mode: "add",
      text: patch(text, [field, list.length], next, true),
    }
  }

  if (!force) {
    return {
      mode: "noop",
      text,
    }
  }

  const keep = dup[0]
  if (!keep) {
    return {
      mode: "noop",
      text,
    }
  }

  if (dup.length === 1 && keep.spec === spec) {
    return {
      mode: "noop",
      text,
    }
  }

  let out = text
  if (typeof keep.item === "string") {
    out = patch(out, [field, keep.i], next)
  }
  if (Array.isArray(keep.item) && typeof keep.item[0] === "string") {
    out = patch(out, [field, keep.i, 0], spec)
  }

  const del = dup
    .map((item) => item.i)
    .filter((i) => i !== keep.i)
    .sort((a, b) => b - a)

  for (const i of del) {
    out = patch(out, [field, i], undefined)
  }

  return {
    mode: "replace",
    text: out,
  }
}

function samePluginSpec(current: string, spec: string, pkg = parsePluginSpecifier(spec).pkg) {
  if (current === spec) return true
  if (current.startsWith("file://")) return false
  return parsePluginSpecifier(current).pkg === pkg
}

export async function installPlugin(spec: string, dep: InstallDeps = defaultInstallDeps): Promise<InstallResult> {
  const target = await dep.resolve(spec).then(
    (item) => ({
      ok: true as const,
      item,
    }),
    (error: unknown) => ({
      ok: false as const,
      error,
    }),
  )
  if (!target.ok) {
    return {
      ok: false,
      code: "install_failed",
      error: target.error,
    }
  }
  return {
    ok: true,
    target: target.item,
  }
}

export async function readPluginManifest(target: string): Promise<ManifestResult> {
  const pkg = await readPluginPackage(target).then(
    (item) => ({
      ok: true as const,
      item,
    }),
    (error: unknown) => ({
      ok: false as const,
      error,
    }),
  )
  if (!pkg.ok) {
    return {
      ok: false,
      code: "manifest_read_failed",
      file: target,
      error: pkg.error,
    }
  }

  const manifest = await Promise.resolve()
    .then(() => packageManifest(pkg.item))
    .then(
      (item) => ({ ok: true as const, item }),
      (error: unknown) => ({ ok: false as const, error }),
    )

  if (!manifest.ok) {
    return {
      ok: false,
      code: "manifest_read_failed",
      file: pkg.item.pkg,
      error: manifest.error,
    }
  }

  if (!manifest.item.targets.length) {
    return {
      ok: false,
      code: "manifest_no_targets",
      file: pkg.item.pkg,
    }
  }

  return {
    ok: true,
    ...manifest.item,
  }
}

function patchDir(input: PatchInput) {
  if (input.global) return input.config ?? Global.Path.config
  const git = input.vcs === "git" && input.worktree !== "/"
  const root = git ? input.worktree : input.directory
  return path.join(root, ".opencode")
}

function patchName(kind: Kind): "opencode" | "tui" {
  if (kind === "server") return "opencode"
  return "tui"
}

function patchField(target: Target, api?: string): ConfigField {
  if (target.kind === "server" && api === "v2") return "plugins"
  return "plugin"
}

async function v2ConfigFile(files: string[], dep: PatchDeps) {
  const missing: string[] = []
  for (const file of files) {
    if (!(await dep.exists(file))) {
      missing.push(file)
      continue
    }
    const text = await dep.readText(file)
    const errors: JsoncParseError[] = []
    const data = parseJsonc(text, errors, { allowTrailingComma: true })
    if (errors.length) return file
    if (!ConfigMigrateV1.isV1(data)) return file
  }
  return missing[0]
}

async function configuredPlugin(files: string[], spec: string, dep: PatchDeps) {
  const pkg = parsePluginSpecifier(spec).pkg
  for (const file of files) {
    if (!(await dep.exists(file))) continue
    const text = await dep.readText(file)
    const errors: JsoncParseError[] = []
    const data = parseJsonc(text, errors, { allowTrailingComma: true })
    if (errors.length) continue
    for (const field of ["plugin", "plugins"] as const) {
      if (
        (pluginList(data, field) ?? []).some((item) => {
          const current = pluginSpec(item)
          return current ? samePluginSpec(current, spec, pkg) : false
        })
      ) {
        return { field, file }
      }
    }
  }
}

async function patchOne(
  dir: string,
  target: Target,
  spec: string,
  force: boolean,
  api: string | undefined,
  dep: PatchDeps,
): Promise<PatchOne> {
  const name = patchName(target.kind)
  await using _ = await Flock.acquire(`plug-config:${Filesystem.resolve(path.join(dir, name))}`)

  const files = dep.files(dir, name)
  const field = patchField(target, api)
  const existing = field === "plugins" ? await configuredPlugin(files, spec, dep) : undefined
  if (existing) {
    return {
      ok: true,
      item: {
        kind: target.kind,
        field: existing.field,
        mode: "noop",
        file: existing.file,
      },
    }
  }
  const cfg =
    field === "plugins"
      ? await v2ConfigFile(files, dep)
      : await files.reduce<Promise<string | undefined>>(
          async (result, file) => (await result) ?? ((await dep.exists(file)) ? file : undefined),
          Promise.resolve(undefined),
        )
  if (cfg === undefined && field === "plugins") {
    return {
      ok: false,
      code: "patch_failed",
      kind: target.kind,
      error: new Error(`No V2 config file is available in ${dir}; both opencode config files use V1 syntax`),
    }
  }
  const file = cfg ?? files[0]

  const src = await dep.readText(file).catch((err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT") return "{}"
    return err
  })
  if (src instanceof Error) {
    return {
      ok: false,
      code: "patch_failed",
      kind: target.kind,
      error: src,
    }
  }
  const text = src.trim() ? src : "{}"

  const errs: JsoncParseError[] = []
  const data = parseJsonc(text, errs, { allowTrailingComma: true })
  if (errs.length) {
    const err = errs[0]
    const lines = text.substring(0, err.offset).split("\n")
    return {
      ok: false,
      code: "invalid_json",
      kind: target.kind,
      file,
      line: lines.length,
      col: lines[lines.length - 1].length + 1,
      parse: printParseErrorCode(err.error),
    }
  }

  const list = pluginList(data, field)
  const item =
    field === "plugins"
      ? target.opts
        ? { package: spec, options: target.opts }
        : spec
      : target.opts
        ? [spec, target.opts]
        : spec
  const out = patchPluginList(text, list, field, spec, item, force)
  if (out.mode === "noop") {
    return {
      ok: true,
      item: {
        kind: target.kind,
        field,
        mode: out.mode,
        file,
      },
    }
  }

  const write = await dep.write(file, out.text).catch((error: unknown) => error)
  if (write instanceof Error) {
    return {
      ok: false,
      code: "patch_failed",
      kind: target.kind,
      error: write,
    }
  }

  return {
    ok: true,
    item: {
      kind: target.kind,
      field,
      mode: out.mode,
      file,
    },
  }
}

export async function patchPluginConfig(input: PatchInput, dep: PatchDeps = defaultPatchDeps): Promise<PatchResult> {
  const dir = patchDir(input)
  const items: PatchItem[] = []
  for (const target of input.targets) {
    const hit = await patchOne(dir, target, input.spec, Boolean(input.force), input.api, dep)
    if (!hit.ok) {
      return {
        ...hit,
        dir,
        items,
      }
    }
    items.push(hit.item)
  }
  return {
    ok: true,
    dir,
    items,
  }
}

export async function removePluginConfig(
  input: RemoveInput,
  dep: Pick<PatchDeps, "readText" | "write" | "exists"> = defaultPatchDeps,
): Promise<RemoveResult> {
  const items: RemoveItem[] = []
  for (const item of input.items) {
    await using _ = await Flock.acquire(`plug-config:${Filesystem.resolve(item.file)}`)
    if (!(await dep.exists(item.file))) {
      items.push({ ...item, removed: false })
      continue
    }

    const text = await dep.readText(item.file)
    const errs: JsoncParseError[] = []
    const data = parseJsonc(text, errs, { allowTrailingComma: true })
    if (errs.length) {
      const err = errs[0]
      const lines = text.substring(0, err.offset).split("\n")
      return {
        ok: false,
        code: "invalid_json",
        kind: item.kind,
        file: item.file,
        line: lines.length,
        col: lines[lines.length - 1].length + 1,
        parse: printParseErrorCode(err.error),
      }
    }

    const indexes = (pluginList(data, item.field) ?? [])
      .map((entry, index) => ({ index, spec: pluginSpec(entry) }))
      .filter((entry) => entry.spec === input.spec)
      .map((entry) => entry.index)
      .toSorted((a, b) => b - a)
    const next = indexes.reduce((result, index) => patch(result, [item.field, index], undefined), text)
    if (next !== text) {
      const write = await dep.write(item.file, next).catch((error: unknown) => error)
      if (write instanceof Error) {
        return {
          ok: false,
          code: "patch_failed",
          kind: item.kind,
          error: write,
        }
      }
    }
    items.push({ ...item, removed: indexes.length > 0 })
  }
  return { ok: true, items }
}
