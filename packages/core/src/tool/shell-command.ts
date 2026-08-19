export * as ShellCommand from "./shell-command.ts"

import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { Effect, Schema } from "effect"
import type { Node } from "web-tree-sitter"
import { lazy } from "../util/lazy.ts"
import { BashArity } from "./bash-arity.ts"

export type Kind = "bash" | "powershell" | "cmd"

export interface PathCandidate {
  readonly value: string
  readonly kind: "file" | "directory"
}

export interface Analysis {
  readonly resources: ReadonlyArray<string>
  readonly save: ReadonlyArray<string>
  /**
   * Opportunistic literal path hints discovered by this parser. This is not an
   * exhaustive filesystem-access model: a future BashTool integration must
   * union these hints with its existing conservative scanner before asking for
   * permission, and must never treat this list as the sole authority.
   */
  readonly pathHints: ReadonlyArray<PathCandidate>
}

export class AnalysisError extends Schema.TaggedErrorClass<AnalysisError>()("ShellCommand.AnalysisError", {
  command: Schema.String,
  kind: Schema.Literals(["bash", "powershell", "cmd"]),
  reason: Schema.Literals(["load", "parse", "syntax", "unsupported", "size"]),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message() {
    return `Unable to safely analyze ${this.kind} command (${this.reason})`
  }
}

export interface AnalyzeInput {
  readonly command: string
  readonly kind: Kind
}

type Part = {
  readonly type: string
  readonly text: string
  readonly node: Node
}

type Entry = {
  readonly type: "command" | "redirect"
  readonly node: Node
}

const MAX_COMMAND_BYTES = 64 * 1024
const CWD = new Set(["cd", "chdir", "set-location"])
const CWD_FLAGS = new Set(["-literalpath", "-path"])
const UNSUPPORTED_CWD = new Set(["popd", "pop-location", "pushd", "push-location"])
const EXECUTION_WRAPPERS = new Set([
  "bash",
  "cmd",
  "command",
  "env",
  "eval",
  "exec",
  "iex",
  "invoke-expression",
  "nice",
  "nohup",
  "powershell",
  "pwsh",
  "sh",
  "source",
  "sudo",
  "time",
  "xargs",
  "zsh",
])
const FILES = new Set([
  ...CWD,
  "rm",
  "cp",
  "mv",
  "mkdir",
  "touch",
  "chmod",
  "chown",
  "cat",
  "get-content",
  "set-content",
  "add-content",
  "copy-item",
  "move-item",
  "remove-item",
  "new-item",
  "rename-item",
])
const FLAGS = new Set(["-destination", "-literalpath", "-path"])
const SWITCHES = new Set(["-confirm", "-debug", "-force", "-nonewline", "-recurse", "-verbose", "-whatif"])
const NESTED = new Set(["command_substitution", "process_substitution", "sub_expression", "subshell"])
const DYNAMIC = [
  "arithmetic_expansion",
  "command_substitution",
  "process_substitution",
  "simple_expansion",
  "sub_expression",
  "variable",
]
const resolvePackage = createRequire(import.meta.url)

const resolveWasm = (asset: string) => {
  if (asset.startsWith("file://")) return fileURLToPath(asset)
  if (path.isAbsolute(asset) || /^[a-z]:/i.test(asset)) return asset
  return fileURLToPath(new URL(asset, import.meta.url))
}

async function wasmAsset(load: () => Promise<{ readonly default: unknown }>, specifier: string) {
  const imported = await load().then(
    (module) => (typeof module.default === "string" ? module.default : undefined),
    () => undefined,
  )
  if (imported) return resolveWasm(imported)
  return resolvePackage.resolve(specifier)
}

// Integration blocker: Parser.init owns module-global state also initialized by V1 ShellTool.
// Do not connect this analyzer until shell parsing has one shared runtime owner or V1 is removed.
const runtime = lazy(async () => {
  const { Parser, Language } = await import("web-tree-sitter")
  const treeWasm = await wasmAsset(() => import("web-tree-sitter/tree-sitter.wasm"), "web-tree-sitter/tree-sitter.wasm")
  await Parser.init({ wasmBinary: await readFile(treeWasm) })
  return { Parser, Language }
})

const bashLanguage = lazy(async () => {
  const { Language } = await runtime()
  const wasm = await wasmAsset(
    () => import("tree-sitter-bash/tree-sitter-bash.wasm"),
    "tree-sitter-bash/tree-sitter-bash.wasm",
  )
  return Language.load(await readFile(wasm))
})

const powershellLanguage = lazy(async () => {
  const { Language } = await runtime()
  const wasm = await wasmAsset(
    () => import("tree-sitter-powershell/tree-sitter-powershell.wasm"),
    "tree-sitter-powershell/tree-sitter-powershell.wasm",
  )
  return Language.load(await readFile(wasm))
})

export const analyze = Effect.fn("ShellCommand.analyze")(function* (input: AnalyzeInput) {
  if (new TextEncoder().encode(input.command).byteLength > MAX_COMMAND_BYTES)
    return yield* Effect.fail(new AnalysisError({ ...input, reason: "size" }))
  if (input.kind === "cmd") return yield* Effect.fail(new AnalysisError({ ...input, reason: "unsupported" }))
  if (missingCwdTarget(input)) return yield* Effect.fail(unsupported(input))

  const loaded = yield* Effect.tryPromise({
    try: async () => ({
      ...(await runtime()),
      language: await (input.kind === "powershell" ? powershellLanguage() : bashLanguage()),
    }),
    catch: (cause) => new AnalysisError({ ...input, reason: "load", cause }),
  })

  return yield* Effect.acquireUseRelease(
    Effect.try({
      try: () => new loaded.Parser(),
      catch: (cause) => new AnalysisError({ ...input, reason: "parse", cause }),
    }),
    (parser) =>
      Effect.gen(function* () {
        const tree = yield* Effect.try({
          try: () => {
            parser.setLanguage(loaded.language)
            return parser.parse(input.command)
          },
          catch: (cause) => new AnalysisError({ ...input, reason: "parse", cause }),
        })
        if (!tree) return yield* Effect.fail(new AnalysisError({ ...input, reason: "parse" }))

        return yield* Effect.acquireUseRelease(
          Effect.succeed(tree),
          (current) =>
            Effect.gen(function* () {
              if (current.rootNode.hasError)
                return yield* Effect.fail(new AnalysisError({ ...input, reason: "syntax" }))
              const result = yield* Effect.sync(() => {
                try {
                  return { value: scan(current.rootNode, input) } as const
                } catch (cause) {
                  if (cause instanceof AnalysisError) return { error: cause } as const
                  throw cause
                }
              })
              if ("error" in result) return yield* Effect.fail(result.error)
              return result.value
            }),
          (current) => Effect.sync(() => current.delete()),
        )
      }),
    (parser) => Effect.sync(() => parser.delete()),
  )
})

function scan(root: Node, input: AnalyzeInput): Analysis {
  if (root.descendantsOfType(["heredoc_redirect", "herestring_redirect"]).length > 0) throw unsupported(input)
  if (
    input.kind === "bash" &&
    root
      .descendantsOfType("variable_assignment")
      .filter((node): node is Node => node !== null)
      .some((node) => !commandAssignment(node))
  )
    throw unsupported(input)
  if (
    input.kind === "powershell" &&
    root.descendantsOfType(["assignment_expression", "command_invokation_operator", "invokation_expression"]).length > 0
  )
    throw unsupported(input)

  const resources = new Set<string>()
  const save = new Set<string>()
  const pathHints = new Map<string, PathCandidate>()
  const commandNodes = commands(root)
  const entries: Entry[] = [
    ...commandNodes.map((node) => ({ type: "command" as const, node })),
    ...redirections(root, input.kind).map((node) => ({ type: "redirect" as const, node })),
  ].sort((left, right) => left.node.startIndex - right.node.startIndex || (left.type === "command" ? -1 : 1))
  let recognized = 0
  let cwdCommands = 0
  let unrecognized = false

  for (const entry of entries) {
    if (entry.type === "redirect") {
      const item = redirect(entry.node, input)
      resources.add(item.resource)
      addPath(pathHints, item.path)
      continue
    }

    const command = parts(entry.node)
    if (command.length === 0) {
      unrecognized = true
      continue
    }
    const name = literal(command[0].node, input)
    const lookup = input.kind === "powershell" ? name.toLowerCase() : name
    const assigned = direct(entry.node, "variable_assignment")
    if (UNSUPPORTED_CWD.has(lookup)) throw unsupported(input)
    if (EXECUTION_WRAPPERS.has(lookup)) throw unsupported(input)
    const cwd = CWD.has(lookup)
    if (cwd && assigned) throw unsupported(input)
    recognized++

    if (cwd) {
      cwdCommands++
      addPath(pathHints, cwdPath(command, input))
      continue
    }

    const resource = commandSource(entry.node, input.kind)
    if (!resource) throw unsupported(input)
    resources.add(resource)
    if (reusable(entry.node, command)) {
      const pattern = BashArity.savePattern(
        command.map((item) => item.text),
        { caseInsensitive: input.kind === "powershell" },
      )
      if (pattern) save.add(pattern)
    }

    if (!FILES.has(lookup)) continue
    for (const candidate of commandPaths(command, lookup, false, input)) addPath(pathHints, candidate)
  }

  if (unrecognized) throw unsupported(input)
  if (cwdCommands > 0) {
    if (
      cwdCommands !== 1 ||
      recognized !== 1 ||
      commandNodes.length !== 1 ||
      resources.size > 0 ||
      !onlyCwd(root, commandNodes, input.kind)
    )
      throw unsupported(input)
    return { resources: [], save: [], pathHints: [...pathHints.values()] }
  }
  if (resources.size === 0) throw unsupported(input)
  return { resources: [...resources], save: [...save], pathHints: [...pathHints.values()] }
}

function parts(node: Node) {
  const result: Part[] = []
  for (let index = 0; index < node.childCount; index++) {
    const child = node.child(index)
    if (!child) continue
    if (child.type === "command_elements") {
      for (let itemIndex = 0; itemIndex < child.childCount; itemIndex++) {
        const item = child.child(itemIndex)
        if (!item || item.type === "command_argument_sep" || item.type === "redirection") continue
        result.push({ type: item.type, text: item.text, node: item })
      }
      continue
    }
    const field = node.fieldNameForChild(index)
    if (field !== "name" && field !== "command_name" && field !== "argument") continue
    result.push({ type: child.type, text: child.text, node: child })
  }
  return result
}

function commands(root: Node) {
  return root.descendantsOfType("command").filter((node): node is Node => node !== null)
}

function redirections(root: Node, kind: Kind) {
  return root
    .descendantsOfType(kind === "powershell" ? "redirection" : "file_redirect")
    .filter((node): node is Node => node !== null)
}

function redirect(node: Node, input: AnalyzeInput) {
  const target = redirectTarget(node, input.kind)
  if (!target || target.type === "number") throw unsupported(input)
  const operator =
    input.kind === "bash"
      ? prefix(node, target)
      : Array.from({ length: node.childCount }, (_, index) => node.child(index)).find(
          (child) => child?.type === "file_redirection_operator",
        )?.text
  if (!operator) throw unsupported(input)
  const value = literal(target, input)
  return {
    resource: `redirect ${operator.trim()} ${value}`,
    path: { value, kind: "file" as const },
  }
}

function redirectTarget(node: Node, kind: Kind) {
  if (kind === "bash") return node.childForFieldName("destination")
  const wrapper = Array.from({ length: node.childCount }, (_, index) => node.child(index)).find(
    (child) => child?.type === "redirected_file_name",
  )
  if (!wrapper) return
  return Array.from({ length: wrapper.childCount }, (_, index) => wrapper.child(index)).find(
    (child) => child?.type !== "command_argument_sep",
  )
}

function cwdPath(command: ReadonlyArray<Part>, input: AnalyzeInput): PathCandidate {
  const target =
    input.kind === "bash"
      ? command.length === 2 && !command[1].text.startsWith("-")
        ? command[1]
        : undefined
      : command.length === 2 && command[1].type !== "command_parameter"
        ? command[1]
        : command.length === 3 &&
            command[1].type === "command_parameter" &&
            CWD_FLAGS.has(command[1].text.toLowerCase())
          ? command[2]
          : undefined
  if (!target) throw unsupported(input)
  const value = literal(target.node, input)
  if (value === "-") throw unsupported(input)
  return { value, kind: "directory" }
}

function commandPaths(command: ReadonlyArray<Part>, name: string, cwd: boolean, input: AnalyzeInput) {
  if (input.kind === "bash")
    return command.slice(1).flatMap((item): PathCandidate[] => {
      const attached = item.text.match(/^--target-directory=(.+)$/)
      if (attached) return [{ value: literalText(attached[1], input), kind: "directory" }]
      if (item.text.startsWith("-") || (name === "chmod" && item.text.startsWith("+"))) return []
      return [{ value: literal(item.node, input), kind: cwd ? "directory" : "file" }]
    })

  const result: PathCandidate[] = []
  let pathKind: PathCandidate["kind"] | undefined
  for (const item of command.slice(1)) {
    if (pathKind) {
      result.push({ value: literal(item.node, input), kind: pathKind })
      pathKind = undefined
      continue
    }
    if (item.type === "command_parameter") {
      const flag = item.text.toLowerCase()
      if (SWITCHES.has(flag)) continue
      pathKind = FLAGS.has(flag) ? (cwd ? "directory" : "file") : undefined
      continue
    }
    result.push({ value: literal(item.node, input), kind: cwd ? "directory" : "file" })
  }
  return result
}

function literal(node: Node, input: AnalyzeInput) {
  if (node.descendantsOfType(DYNAMIC).length > 0) throw unsupported(input)
  return literalText(node.text, input)
}

function literalText(text: string, input: AnalyzeInput) {
  const raw = text.trim()
  const quote = raw.length > 1 && (raw[0] === '"' || raw[0] === "'") && raw[0] === raw.at(-1) ? raw[0] : undefined
  const value = quote ? raw.slice(1, -1) : raw
  if (!value || /[\0\r\n?*\[]/.test(value)) throw unsupported(input)
  if (/[`$|&;<>{}]/.test(value) || value.startsWith("~")) throw unsupported(input)
  if (/%[^%]+%/.test(value) || /![^!]+!/.test(value)) throw unsupported(input)
  if (!quote && /\s/.test(value)) throw unsupported(input)
  return input.kind === "bash" && !quote ? value.replace(/\\(.)/g, "$1") : value
}

function commandSource(node: Node, kind: Kind) {
  const omitted = node
    .descendantsOfType(kind === "powershell" ? "redirection" : "file_redirect")
    .filter((child): child is Node => child !== null)
  return omit(node, omitted).trim()
}

function onlyCwd(root: Node, commandNodes: ReadonlyArray<Node>, kind: Kind) {
  const remaining = omit(root, commandNodes)
  return kind === "bash" ? /^(?:\s|;|&&|\|\|)*$/.test(remaining) : /^(?:\s|;)*$/.test(remaining)
}

function omit(node: Node, omitted: ReadonlyArray<Node>) {
  if (omitted.length === 0) return node.text
  const bytes = Buffer.from(node.text)
  const chunks: Buffer[] = []
  let cursor = 0
  for (const child of [...omitted].sort((left, right) => left.startIndex - right.startIndex)) {
    let start = child.startIndex - node.startIndex
    while (start > cursor && (bytes[start - 1] === 32 || bytes[start - 1] === 9)) start--
    chunks.push(bytes.subarray(cursor, start))
    cursor = child.endIndex - node.startIndex
  }
  chunks.push(bytes.subarray(cursor))
  return Buffer.concat(chunks).toString("utf8").trim()
}

function prefix(node: Node, target: Node) {
  return Buffer.from(node.text)
    .subarray(0, target.startIndex - node.startIndex)
    .toString("utf8")
    .trim()
}

function reusable(node: Node, command: ReadonlyArray<Part>) {
  if (direct(node, "variable_assignment")) return false
  if (command.some((item) => item.node.descendantsOfType(DYNAMIC).length > 0)) return false
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (NESTED.has(parent.type)) return false
  }
  return true
}

function direct(node: Node, type: string) {
  return Array.from({ length: node.childCount }, (_, index) => node.child(index)).some((child) => child?.type === type)
}

function commandAssignment(node: Node) {
  if (node.parent?.type !== "command") return false
  const name = node.parent.childForFieldName("name")
  return name !== null && node.endIndex <= name.startIndex
}

function missingCwdTarget(input: AnalyzeInput) {
  const command = input.command.trim()
  if (input.kind === "bash") return /^(?:cd|chdir)(?:\s+-)?$/.test(command)
  return /^(?:cd|chdir|set-location)(?:\s+-)?$/i.test(command)
}

function addPath(pathHints: Map<string, PathCandidate>, candidate: PathCandidate) {
  pathHints.set(`${candidate.kind}\0${candidate.value}`, candidate)
}

function unsupported(input: AnalyzeInput) {
  return new AnalysisError({ ...input, reason: "unsupported" })
}
