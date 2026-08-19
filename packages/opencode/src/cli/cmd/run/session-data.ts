// Core reducer for direct interactive mode.
//
// Takes raw SDK events and produces two outputs:
//   - StreamCommit[]: append-only scrollback entries (text, tool, error, etc.)
//   - FooterOutput:   status bar patches and view transitions (permission, question)
//
// The reducer mutates SessionData in place for performance but has no
// external side effects -- no IO, no footer calls. The caller
// (stream.transport.ts) feeds events in and forwards output to the footer
// through stream.ts.
//
// Key design decisions:
//
// - Text parts buffer in `data.text` until their message role is confirmed as
//   "assistant". This prevents echoing user-role text parts. The `ready()`
//   check gates output until the canonical message lifecycle identifies its role.
//
// - Tool echo stripping: bash tools may echo their own output in the next
//   assistant text part. `stashEcho()` records completed bash output, and
//   `stripEcho()` removes it from the start of the next assistant chunk.
//
// - Permission and question requests queue in `data.permissions` and
//   `data.questions`. The footer shows whichever is first. When a reply
//   event arrives, the queue entry is removed and the footer falls back
//   to the next pending request or to the prompt view.
import type { Event, Message, Part, PermissionV2Request, QuestionV2Request, ToolPart } from "@opencode-ai/sdk/v2"
import * as Locale from "@/util/locale"
import {
  canonicalToolKey,
  removeCanonicalTool,
  updateCanonicalTool,
  type CanonicalToolEvent,
  type CanonicalToolRemovalEvent,
} from "./canonical-tool"
import { toolView } from "./tool"
import type { FooterOutput, FooterPatch, FooterView, StreamCommit } from "./types"

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
})

type Tokens = {
  input?: number
  output?: number
  reasoning?: number
  cache?: {
    read?: number
    write?: number
  }
}

type PartKind = "assistant" | "reasoning" | "user"
type MessageRole = "assistant" | "user"
type Dict = Record<string, unknown>
type SessionCommit = StreamCommit

// Mutable accumulator for the reducer. Each field tracks a different aspect
// of the stream so we can produce correct incremental output:
//
// - ids:    parts and error keys we've already committed (dedup guard)
// - tools:  tool parts we've emitted a "start" for but not yet completed
// - call:   tool call inputs, keyed by msg:call, for enriching permission views
// - role:   message ID → "assistant" | "user", learned from canonical message lifecycle events
// - msg:    part ID → message ID
// - part:   part ID → "assistant" | "reasoning" (text parts only)
// - text:   part ID → full accumulated text so far
// - sent:   part ID → byte offset of last flushed text (for incremental output)
// - visible: part ID → rendered text for an active part after display transforms
// - fragment: canonical text/reasoning fragment ID → active legacy part ID
// - end:    part IDs whose time.end has arrived (part is finished)
// - shell:  shell call ID → chosen transcript source for direct shell calls
// - echo:   message ID → bash outputs to strip from the next assistant chunk
type ShellCall = {
  source: "shell" | "tool"
  command?: string
}

export type SessionData = {
  includeUserText: boolean
  announced: boolean
  ids: Set<string>
  tools: Set<string>
  call: Map<string, Dict>
  shell: Map<string, ShellCall>
  permissions: PermissionV2Request[]
  questions: QuestionV2Request[]
  role: Map<string, MessageRole>
  model: Map<string, { providerID: string; modelID: string }>
  toolParts: Map<string, ToolPart>
  msg: Map<string, string>
  part: Map<string, PartKind>
  text: Map<string, string>
  sent: Map<string, number>
  visible: Map<string, string>
  fragment: Map<string, string>
  end: Set<string>
  echo: Map<string, Set<string>>
}

export type SessionDataInput = {
  data: SessionData
  event: Event
  sessionID: string
  thinking: boolean
  limits: Record<string, number>
}

export type SessionDataOutput = {
  data: SessionData
  commits: SessionCommit[]
  footer?: FooterOutput
}

export function createSessionData(
  input: {
    includeUserText?: boolean
  } = {},
): SessionData {
  return {
    includeUserText: input.includeUserText ?? false,
    announced: false,
    ids: new Set(),
    tools: new Set(),
    call: new Map(),
    shell: new Map(),
    permissions: [],
    questions: [],
    role: new Map(),
    model: new Map(),
    toolParts: new Map(),
    msg: new Map(),
    part: new Map(),
    text: new Map(),
    sent: new Map(),
    visible: new Map(),
    fragment: new Map(),
    end: new Set(),
    echo: new Map(),
  }
}

function modelKey(provider: string, model: string): string {
  return `${provider}/${model}`
}

function formatUsage(
  tokens: Tokens | undefined,
  limit: number | undefined,
  cost: number | undefined,
): string | undefined {
  const total =
    (tokens?.input ?? 0) +
    (tokens?.output ?? 0) +
    (tokens?.reasoning ?? 0) +
    (tokens?.cache?.read ?? 0) +
    (tokens?.cache?.write ?? 0)

  if (total <= 0) {
    if (typeof cost === "number" && cost > 0) {
      return money.format(cost)
    }
    return undefined
  }

  const text =
    limit && limit > 0 ? `${Locale.number(total)} (${Math.round((total / limit) * 100)}%)` : Locale.number(total)

  if (typeof cost === "number" && cost > 0) {
    return `${text} · ${money.format(cost)}`
  }

  return text
}

export function formatError(error: { name?: string; message?: string; data?: unknown }): string {
  if (error.data && typeof error.data === "object") {
    const message = Reflect.get(error.data, "message")
    if (typeof message === "string" && message) return message
  }

  if (error.message) {
    return error.message
  }

  if (error.name) {
    return error.name
  }

  return "unknown error"
}

function isAbort(error: { name?: string } | undefined): boolean {
  return error?.name === "MessageAbortedError"
}

function msgErr(id: string): string {
  return `msg:${id}:error`
}

function patch(patch?: FooterPatch, view?: FooterView): FooterOutput | undefined {
  if (!patch && !view) {
    return undefined
  }

  return {
    patch,
    view,
  }
}

function out(data: SessionData, commits: SessionCommit[], footer?: FooterOutput): SessionDataOutput {
  if (!footer) {
    return {
      data,
      commits,
    }
  }

  return {
    data,
    commits,
    footer,
  }
}

export function pickBlockerView(input: { permission?: PermissionV2Request; question?: QuestionV2Request }): FooterView {
  if (input.permission) {
    return { type: "permission", request: input.permission }
  }

  if (input.question) {
    return { type: "question", request: input.question }
  }

  return { type: "prompt" }
}

export function blockerStatus(view: FooterView) {
  if (view.type === "permission") {
    return "awaiting permission"
  }

  if (view.type === "question") {
    return "awaiting answer"
  }

  return ""
}

function pickSessionView(data: SessionData): FooterView {
  return pickBlockerView({
    permission: data.permissions[0],
    question: data.questions[0],
  })
}

function queueFooter(data: SessionData): FooterOutput {
  const view = pickSessionView(data)

  return {
    view,
    patch: { status: blockerStatus(view) },
  }
}

function queueOut(data: SessionData, commits: SessionCommit[]): SessionDataOutput {
  return out(data, commits, queueFooter(data))
}

function upsert<T extends { id: string }>(list: T[], item: T) {
  const idx = list.findIndex((entry) => entry.id === item.id)
  if (idx === -1) {
    list.push(item)
    return
  }

  list[idx] = item
}

function remove(list: Array<{ id: string }>, id: string): boolean {
  const idx = list.findIndex((entry) => entry.id === id)
  if (idx === -1) {
    return false
  }

  list.splice(idx, 1)
  return true
}

export function bootstrapSessionData(input: {
  data: SessionData
  messages: Array<{
    parts: Part[]
  }>
  permissions: PermissionV2Request[]
  questions: QuestionV2Request[]
}) {
  for (const message of input.messages) {
    for (const part of message.parts) {
      if (part.type !== "tool") {
        continue
      }

      input.data.call.set(key(part.messageID, part.callID), part.state.input)
      input.data.toolParts.set(canonicalToolKey(part.messageID, part.callID), part)
    }
  }

  for (const request of input.permissions.slice().sort((a, b) => a.id.localeCompare(b.id))) {
    upsert(input.data.permissions, enrichPermission(input.data, request))
  }

  for (const request of input.questions.slice().sort((a, b) => a.id.localeCompare(b.id))) {
    upsert(input.data.questions, request)
  }
}

function key(msg: string, call: string): string {
  return `${msg}:${call}`
}

function enrichPermission(data: SessionData, request: PermissionV2Request): PermissionV2Request {
  if (request.source?.type !== "tool") {
    return request
  }

  const input = data.call.get(key(request.source.messageID, request.source.callID))
  if (!input) {
    return request
  }

  const meta = request.metadata ?? {}
  if (meta.input === input) {
    return request
  }

  return {
    ...request,
    metadata: {
      ...meta,
      input,
    },
  }
}

// Updates the active permission request when the matching tool part gets
// new input (e.g., a diff). This keeps the permission UI in sync with the
// tool's evolving state. Only triggers a footer update if the currently
// displayed permission was the one that changed.
function syncPermission(data: SessionData, part: ToolPart): FooterOutput | undefined {
  data.call.set(key(part.messageID, part.callID), part.state.input)
  if (data.permissions.length === 0) {
    return undefined
  }

  let changed = false
  let active = false
  data.permissions = data.permissions.map((request, index) => {
    if (
      request.source?.type !== "tool" ||
      request.source.messageID !== part.messageID ||
      request.source.callID !== part.callID
    ) {
      return request
    }

    const next = enrichPermission(data, request)
    if (next === request) {
      return request
    }

    changed = true
    active ||= index === 0
    return next
  })

  if (!changed || !active) {
    return undefined
  }

  return {
    view: pickSessionView(data),
  }
}

// Question tool replies can complete without a matching question.v2.replied event.
// When that happens, drop the recovered pending request tied to this tool call so
// the footer can return to the next blocker or to the prompt.
function syncQuestion(data: SessionData, part: ToolPart): FooterOutput | undefined {
  if (part.tool !== "question") {
    return undefined
  }

  if (part.state.status !== "completed" && part.state.status !== "error") {
    return undefined
  }

  const next = data.questions.filter(
    (request) => request.tool?.messageID !== part.messageID || request.tool?.callID !== part.callID,
  )
  if (next.length === data.questions.length) {
    return undefined
  }

  data.questions = next
  return queueFooter(data)
}

function toolStatus(part: ToolPart): string {
  if (part.tool !== "task") {
    return `running ${part.tool}`
  }

  const state = part.state as {
    input?: {
      description?: unknown
      subagent_type?: unknown
    }
  }
  const desc = state.input?.description
  if (typeof desc === "string" && desc.trim()) {
    return `running ${desc.trim()}`
  }

  const type = state.input?.subagent_type
  if (typeof type === "string" && type.trim()) {
    return `running ${type.trim()}`
  }

  return "running task"
}

// Returns true if we can flush this part's text to scrollback.
//
// We gate on the message role being "assistant" because user-role messages
// also contain text parts (the user's own input) which we don't want to
// echo. If the message lifecycle has not identified the role yet, text stays buffered.
function ready(data: SessionData, partID: string): boolean {
  const msg = data.msg.get(partID)
  if (!msg) {
    return true
  }

  const role = data.role.get(msg)
  if (!role) {
    return false
  }

  if (role === "assistant") {
    return true
  }

  return data.includeUserText && role === "user"
}

function syncText(data: SessionData, partID: string, next: string) {
  const prev = data.text.get(partID) ?? ""
  if (!next) {
    return prev
  }

  if (!prev || next.length >= prev.length) {
    data.text.set(partID, next)
    return next
  }

  return prev
}

// Records bash tool output for echo stripping. Some models echo bash output
// verbatim at the start of their next text part. We save both the raw and
// trimmed forms so stripEcho() can match either.
function stashEcho(data: SessionData, part: ToolPart) {
  if (part.tool !== "bash") {
    return
  }

  if (typeof part.messageID !== "string" || !part.messageID) {
    return
  }

  const output = "output" in part.state ? part.state.output : undefined
  if (typeof output !== "string") {
    return
  }

  const text = output.replace(/^\n+/, "")
  if (!text.trim()) {
    return
  }

  const set = data.echo.get(part.messageID) ?? new Set<string>()
  set.add(text)
  const trim = text.replace(/\n+$/, "")
  if (trim && trim !== text) {
    set.add(trim)
  }
  data.echo.set(part.messageID, set)
}

function stripEcho(data: SessionData, msg: string | undefined, chunk: string): string {
  if (!msg) {
    return chunk
  }

  const set = data.echo.get(msg)
  if (!set || set.size === 0) {
    return chunk
  }

  data.echo.delete(msg)
  const list = [...set].sort((a, b) => b.length - a.length)
  for (const item of list) {
    if (!item || !chunk.startsWith(item)) {
      continue
    }

    return chunk.slice(item.length).replace(/^\n+/, "")
  }

  return chunk
}

function flushPart(data: SessionData, commits: SessionCommit[], partID: string, interrupted = false) {
  const kind = data.part.get(partID)
  if (!kind) {
    return
  }

  const text = data.text.get(partID) ?? ""
  const sent = data.sent.get(partID) ?? 0
  let chunk = text.slice(sent)
  const msg = data.msg.get(partID)

  if (sent === 0) {
    chunk = chunk.replace(/^\n+/, "")
    // Some models emit a standalone whitespace token before real content.
    // Keep buffering until we have visible text so scrollback doesn't get a blank row.
    if (!chunk.trim()) {
      return
    }
    if (kind === "reasoning" && chunk) {
      chunk = `Thinking: ${chunk.replace(/\[REDACTED\]/g, "")}`
    }
    if (kind === "assistant" && chunk) {
      chunk = stripEcho(data, msg, chunk)
      if (!chunk.trim()) {
        return
      }
    }
  }

  if (chunk) {
    data.sent.set(partID, text.length)
    data.visible.set(partID, (data.visible.get(partID) ?? "") + chunk)
    commits.push({
      kind,
      text: chunk,
      phase: "progress",
      source: kind === "user" ? "system" : kind,
      messageID: msg,
      partID,
    })
  }

  if (!interrupted) {
    return
  }

  commits.push({
    kind,
    text: "",
    phase: "final",
    source: kind === "user" ? "system" : kind,
    messageID: msg,
    partID,
    interrupted: true,
  })
}

function drop(data: SessionData, partID: string) {
  data.part.delete(partID)
  data.text.delete(partID)
  data.sent.delete(partID)
  data.visible.delete(partID)
  data.msg.delete(partID)
  data.end.delete(partID)
  for (const [fragmentID, activePartID] of data.fragment) {
    if (activePartID === partID) data.fragment.delete(fragmentID)
  }
}

type FragmentDelta = Extract<Event, { type: "session.next.text.delta" | "session.next.reasoning.delta" }>

function startFragment(
  data: SessionData,
  input: { messageID: string; partID: string; fragmentID: string; kind: "assistant" | "reasoning" },
) {
  data.role.set(input.messageID, "assistant")
  data.msg.set(input.partID, input.messageID)
  data.part.set(input.partID, input.kind)
  data.text.set(input.partID, data.text.get(input.partID) ?? "")
  data.fragment.set(input.fragmentID, input.partID)
}

export function fragmentPartID(data: SessionData, event: FragmentDelta) {
  const fragmentID =
    event.type === "session.next.text.delta"
      ? `text:${event.properties.textID}`
      : `reasoning:${event.properties.reasoningID}`
  const current = data.fragment.get(fragmentID)
  if (current && data.part.has(current)) return current

  const eventPartID = event.type === "session.next.text.delta" ? event.properties.textID : event.properties.reasoningID
  startFragment(data, {
    messageID: event.properties.assistantMessageID,
    partID: eventPartID,
    fragmentID,
    kind: event.type === "session.next.text.delta" ? "assistant" : "reasoning",
  })
  if (!data.ids.has(eventPartID)) return eventPartID

  const kind = event.type === "session.next.text.delta" ? "assistant" : "reasoning"
  const claimed = new Set(data.fragment.values())
  const partID = [...data.part.entries()]
    .reverse()
    .find(
      ([id, partKind]) =>
        partKind === kind &&
        data.msg.get(id) === event.properties.assistantMessageID &&
        !data.ids.has(id) &&
        !claimed.has(id),
    )?.[0]
  if (!partID) return undefined

  data.fragment.set(fragmentID, partID)
  return partID
}

// Called when we learn a message's role. Flushes any
// buffered text parts that were waiting on role confirmation. User-role
// parts are silently dropped.
function replay(data: SessionData, commits: SessionCommit[], messageID: string, role: MessageRole, thinking: boolean) {
  for (const [partID, msg] of data.msg.entries()) {
    if (msg !== messageID || data.ids.has(partID)) {
      continue
    }

    if (role === "user" && !data.includeUserText) {
      data.ids.add(partID)
      drop(data, partID)
      continue
    }

    const kind = data.part.get(partID)
    if (!kind) {
      continue
    }

    if (role === "user" && kind === "assistant") {
      data.part.set(partID, "user")
    }

    if (kind === "reasoning" && !thinking) {
      if (data.end.has(partID)) {
        data.ids.add(partID)
      }
      drop(data, partID)
      continue
    }

    flushPart(data, commits, partID)

    if (!data.end.has(partID)) {
      continue
    }

    data.ids.add(partID)
    drop(data, partID)
  }
}

function toolCommit(
  part: ToolPart,
  next: Pick<SessionCommit, "text" | "phase" | "toolState"> & { toolError?: string },
): SessionCommit {
  return {
    kind: "tool",
    source: "tool",
    messageID: part.messageID,
    partID: part.id,
    tool: part.tool,
    part,
    ...next,
  }
}

function shellPartID(callID: string): string {
  return `shell:${callID}`
}

function claimShell(data: SessionData, callID: string, source: ShellCall["source"], command?: string): ShellCall {
  const current = data.shell.get(callID)
  if (current) {
    if (command && !current.command) {
      current.command = command
    }

    return current
  }

  const next = {
    source,
    ...(command ? { command } : {}),
  } satisfies ShellCall
  data.shell.set(callID, next)
  return next
}

function bashCommand(part: ToolPart): string | undefined {
  if (part.tool !== "bash") {
    return undefined
  }

  const input = part.state.input
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return undefined
  }

  const command = Reflect.get(input, "command")
  return typeof command === "string" ? command : undefined
}

function shellCommit(
  input: {
    callID: string
    command: string
  },
  next: Pick<SessionCommit, "text" | "phase" | "toolState">,
): SessionCommit {
  return {
    kind: "tool",
    source: "tool",
    partID: shellPartID(input.callID),
    tool: "bash",
    shell: input,
    ...next,
  }
}

function startShell(callID: string, command: string): SessionCommit {
  return shellCommit(
    {
      callID,
      command,
    },
    {
      text: "running shell",
      phase: "start",
      toolState: "running",
    },
  )
}

function doneShell(callID: string, command: string, output: string): SessionCommit {
  return shellCommit(
    {
      callID,
      command,
    },
    {
      text: output,
      phase: "progress",
      toolState: "completed",
    },
  )
}

function startTool(part: ToolPart): SessionCommit {
  return toolCommit(part, {
    text: toolStatus(part),
    phase: "start",
    toolState: "running",
  })
}

function doneTool(part: ToolPart): SessionCommit {
  return toolCommit(part, {
    text: "",
    phase: "final",
    toolState: "completed",
  })
}

function failTool(part: ToolPart, text: string): SessionCommit {
  return toolCommit(part, {
    text,
    phase: "final",
    toolState: "error",
    toolError: text,
  })
}

function reduceMessageInfo(
  data: SessionData,
  info: Message,
  thinking: boolean,
  limits: Record<string, number>,
): SessionDataOutput {
  const commits: SessionCommit[] = []
  if (typeof info.id === "string") {
    data.role.set(info.id, info.role)
    replay(data, commits, info.id, info.role, thinking)
  }
  if (info.role !== "assistant") return out(data, commits)

  data.model.set(info.id, { providerID: info.providerID, modelID: info.modelID })
  let next: FooterPatch | undefined
  if (!data.announced) {
    data.announced = true
    next = { status: "assistant responding" }
  }
  const usage = formatUsage(info.tokens, limits[modelKey(info.providerID, info.modelID)], info.cost)
  if (usage) next = { ...next, usage }
  if (info.error && !isAbort(info.error) && !data.ids.has(msgErr(info.id))) {
    data.ids.add(msgErr(info.id))
    commits.push({
      kind: "error",
      text: formatError(info.error),
      phase: "start",
      source: "system",
      messageID: info.id,
    })
  }
  return out(data, commits, patch(next))
}

function reduceToolPart(data: SessionData, part: ToolPart): SessionDataOutput {
  const commits: SessionCommit[] = []
  const view = syncPermission(data, part) ?? syncQuestion(data, part)
  data.toolParts.set(canonicalToolKey(part.messageID, part.callID), part)
  if (part.tool === "bash" && part.callID) {
    if (claimShell(data, part.callID, "tool", bashCommand(part)).source === "shell") return out(data, commits, view)
  }
  if (part.state.status === "pending") return out(data, commits, view)
  if (part.state.status === "running") {
    if (data.ids.has(part.id)) return out(data, commits, view)
    if (!data.tools.has(part.id)) {
      data.tools.add(part.id)
      commits.push(startTool(part))
    }
    return out(data, commits, view ?? patch({ status: toolStatus(part) }))
  }

  const seen = data.tools.has(part.id)
  data.tools.delete(part.id)
  if (data.ids.has(part.id)) return out(data, commits, view)
  if (!seen) commits.push(startTool(part))
  data.ids.add(part.id)
  if (part.state.status === "error") {
    const text = part.state.error.trim() ? part.state.error : "unknown error"
    commits.push(failTool(part, text))
    return out(data, commits, view)
  }

  stashEcho(data, part)
  const mode = toolView(part.tool)
  if (mode.output && part.state.output.trim()) {
    commits.push({
      kind: "tool",
      text: part.state.output,
      phase: "progress",
      source: "tool",
      messageID: part.messageID,
      partID: part.id,
      tool: part.tool,
      part,
      toolState: "completed",
    })
  }
  if (mode.final) commits.push(doneTool(part))
  return out(data, commits, view)
}

function reduceTextPart(data: SessionData, part: Extract<Part, { type: "text" | "reasoning" }>, thinking: boolean) {
  const commits: SessionCommit[] = []
  if (data.ids.has(part.id)) return out(data, commits)
  const kind = part.type === "text" ? "assistant" : "reasoning"
  data.msg.set(part.id, part.messageID)
  const role = data.role.get(part.messageID)
  if (role === "user" && part.type === "text" && !data.includeUserText) {
    data.ids.add(part.id)
    drop(data, part.id)
    return out(data, commits)
  }
  if (kind === "reasoning" && !thinking) {
    if (part.time?.end) data.ids.add(part.id)
    drop(data, part.id)
    return out(data, commits)
  }
  data.part.set(part.id, role === "user" && kind === "assistant" ? "user" : kind)
  syncText(data, part.id, part.text)
  if (part.time?.end) data.end.add(part.id)
  if (!ready(data, part.id)) return out(data, commits)
  flushPart(data, commits, part.id)
  if (!part.time?.end) return out(data, commits)
  data.ids.add(part.id)
  drop(data, part.id)
  return out(data, commits)
}

export function reduceSessionMessageSnapshot(input: {
  data: SessionData
  info: Message
  thinking: boolean
  limits: Record<string, number>
}) {
  return reduceMessageInfo(input.data, input.info, input.thinking, input.limits)
}

export function reduceSessionPartSnapshot(input: { data: SessionData; part: Part; thinking: boolean }) {
  if (input.part.type === "tool") return reduceToolPart(input.data, input.part)
  if (input.part.type === "text" || input.part.type === "reasoning") {
    return reduceTextPart(input.data, input.part, input.thinking)
  }
  return out(input.data, [])
}

// Emits "interrupted" final entries for all in-flight parts. Called when a turn is aborted.
export function flushInterrupted(data: SessionData, commits: SessionCommit[]) {
  for (const partID of data.part.keys()) {
    if (data.ids.has(partID)) {
      continue
    }

    const msg = data.msg.get(partID)
    if (msg && data.role.get(msg) === "user" && !data.includeUserText) {
      data.ids.add(partID)
      drop(data, partID)
      continue
    }

    flushPart(data, commits, partID, true)
    data.ids.add(partID)
    drop(data, partID)
  }
}

// The main reducer. Takes one SDK event and returns scrollback commits and
// footer updates. Called once per event from the stream transport's watch loop.
//
// Event handling follows the SDK event types:
//   session.next.step.*  → learn assistant role, track usage and failures
//   session.next.* text  → accumulate and finalize text/reasoning
//   session.next.tool.*  → handle tool state transitions
//   permission.*         → manage the permission queue, drive footer view
//   question.*           → manage the question queue, drive footer view
//   session.next.error   → emit error scrollback entry
export function reduceSessionData(input: SessionDataInput): SessionDataOutput {
  const commits: SessionCommit[] = []
  const data = input.data
  const event = input.event

  if (event.type === "session.next.transcript.message.removed") {
    if (event.properties.sessionID !== input.sessionID) return out(data, commits)
    data.role.delete(event.properties.messageID)
    data.model.delete(event.properties.messageID)
    for (const [partID, messageID] of data.msg) {
      if (messageID !== event.properties.messageID) continue
      data.ids.add(partID)
      drop(data, partID)
    }
    return out(data, commits)
  }

  if (event.type === "session.next.transcript.user-text.updated") {
    if (event.properties.sessionID !== input.sessionID) return out(data, commits)
    data.role.set(event.properties.messageID, "user")
    return reduceTextPart(
      data,
      {
        id: event.properties.partID,
        sessionID: event.properties.sessionID,
        messageID: event.properties.messageID,
        type: "text",
        text: event.properties.text,
        time: { start: event.properties.timestamp, end: event.properties.timestamp },
      },
      input.thinking,
    )
  }

  if (event.type === "session.next.transcript.user-text.removed") {
    if (event.properties.sessionID !== input.sessionID) return out(data, commits)
    data.ids.add(event.properties.partID)
    drop(data, event.properties.partID)
    return out(data, commits)
  }

  if (event.type === "session.next.shell.started") {
    if (event.properties.sessionID !== input.sessionID) {
      return out(data, commits)
    }

    const shell = claimShell(data, event.properties.callID, "shell", event.properties.command)
    if (shell.source !== "shell") {
      return out(data, commits)
    }

    const partID = shellPartID(event.properties.callID)
    if (data.ids.has(partID) || data.tools.has(partID)) {
      return out(data, commits, patch({ status: "running shell" }))
    }

    data.tools.add(partID)
    commits.push(startShell(event.properties.callID, shell.command ?? event.properties.command))
    return out(data, commits, patch({ status: "running shell" }))
  }

  if (event.type === "session.next.shell.ended") {
    if (event.properties.sessionID !== input.sessionID) {
      return out(data, commits)
    }

    const shell = claimShell(data, event.properties.callID, "shell")
    if (shell.source !== "shell") {
      return out(data, commits)
    }

    const partID = shellPartID(event.properties.callID)
    const seen = data.tools.has(partID)
    const command = shell.command ?? ""
    data.tools.delete(partID)
    if (data.ids.has(partID)) {
      return out(data, commits)
    }

    if (!seen && command) {
      commits.push(startShell(event.properties.callID, command))
    }

    data.ids.add(partID)
    commits.push(doneShell(event.properties.callID, command, event.properties.output))
    return out(data, commits)
  }

  if (event.type === "session.next.step.started") {
    if (event.properties.sessionID !== input.sessionID) {
      return out(data, commits)
    }
    data.role.set(event.properties.assistantMessageID, "assistant")
    data.model.set(event.properties.assistantMessageID, {
      providerID: event.properties.model.providerID,
      modelID: event.properties.model.id,
    })
    replay(data, commits, event.properties.assistantMessageID, "assistant", input.thinking)
    if (!data.announced) {
      data.announced = true
      return out(data, commits, patch({ status: "assistant responding" }))
    }
    return out(data, commits)
  }

  if (event.type === "session.next.step.ended") {
    if (event.properties.sessionID !== input.sessionID) return out(data, commits)
    const model = data.model.get(event.properties.assistantMessageID)
    const usage = formatUsage(
      event.properties.tokens,
      model ? input.limits[modelKey(model.providerID, model.modelID)] : undefined,
      event.properties.cost,
    )
    return out(data, commits, usage ? patch({ usage }) : undefined)
  }

  if (event.type === "session.next.step.failed") {
    if (event.properties.sessionID !== input.sessionID) return out(data, commits)
    const id = msgErr(event.properties.assistantMessageID)
    if (data.ids.has(id) || formatError(event.properties.error) === "Provider turn interrupted")
      return out(data, commits)
    data.ids.add(id)
    commits.push({
      kind: "error",
      text: formatError(event.properties.error),
      phase: "start",
      source: "system",
      messageID: event.properties.assistantMessageID,
    })
    return out(data, commits)
  }

  if (event.type === "session.next.text.started") {
    if (event.properties.sessionID !== input.sessionID) return out(data, commits)
    startFragment(data, {
      messageID: event.properties.assistantMessageID,
      partID: event.properties.textID,
      fragmentID: `text:${event.properties.textID}`,
      kind: "assistant",
    })
    return out(data, commits)
  }

  if (event.type === "session.next.reasoning.started") {
    if (event.properties.sessionID !== input.sessionID) return out(data, commits)
    startFragment(data, {
      messageID: event.properties.assistantMessageID,
      partID: event.properties.reasoningID,
      fragmentID: `reasoning:${event.properties.reasoningID}`,
      kind: "reasoning",
    })
    return out(data, commits)
  }

  if (event.type === "session.next.tool.input.delta") {
    return out(data, commits)
  }

  if (event.type === "session.next.text.delta" || event.type === "session.next.reasoning.delta") {
    if (event.properties.sessionID !== input.sessionID) {
      return out(data, commits)
    }

    const partID = fragmentPartID(data, event)
    if (!partID || data.ids.has(partID)) return out(data, commits)

    const text = data.text.get(partID) ?? ""
    data.text.set(partID, text + event.properties.delta)

    const kind = data.part.get(partID)
    if (!kind) {
      return out(data, commits)
    }

    if (kind === "reasoning" && !input.thinking) {
      return out(data, commits)
    }

    if (!ready(data, partID)) {
      return out(data, commits)
    }

    flushPart(data, commits, partID)
    return out(data, commits)
  }

  if (event.type === "session.next.text.ended" || event.type === "session.next.reasoning.ended") {
    if (event.properties.sessionID !== input.sessionID) return out(data, commits)
    const partID = event.type === "session.next.text.ended" ? event.properties.textID : event.properties.reasoningID
    const fragmentID =
      event.type === "session.next.text.ended"
        ? `text:${event.properties.textID}`
        : `reasoning:${event.properties.reasoningID}`
    const kind = event.type === "session.next.text.ended" ? "assistant" : "reasoning"
    startFragment(data, { messageID: event.properties.assistantMessageID, partID, fragmentID, kind })
    syncText(data, partID, event.properties.text)
    data.end.add(partID)
    if (kind === "reasoning" && !input.thinking) {
      data.ids.add(partID)
      drop(data, partID)
      return out(data, commits)
    }
    flushPart(data, commits, partID)
    data.ids.add(partID)
    drop(data, partID)
    return out(data, commits)
  }

  if (event.type === "session.next.transcript.content.removed") {
    if (event.properties.sessionID !== input.sessionID) return out(data, commits)
    const part = removeCanonicalTool(data.toolParts, event as CanonicalToolRemovalEvent)
    if (part) {
      data.tools.delete(part.id)
      data.ids.add(part.id)
      drop(data, part.id)
    }
    data.ids.add(event.properties.partID)
    drop(data, event.properties.partID)
    return out(data, commits)
  }

  if (
    event.type === "session.next.tool.called" ||
    event.type === "session.next.tool.progress" ||
    event.type === "session.next.tool.success" ||
    event.type === "session.next.tool.failed" ||
    event.type === "session.next.transcript.content.updated"
  ) {
    if (event.properties.sessionID !== input.sessionID) return out(data, commits)
    const part = updateCanonicalTool(data.toolParts, event as CanonicalToolEvent)
    if (part) return reduceToolPart(data, part)
    if (event.type !== "session.next.transcript.content.updated") return out(data, commits)
    const content = event.properties.content
    if (content.type !== "text" && content.type !== "reasoning") return out(data, commits)
    data.role.set(event.properties.assistantMessageID, "assistant")
    if (content.type === "text") {
      return reduceTextPart(
        data,
        {
          id: event.properties.partID,
          sessionID: event.properties.sessionID,
          messageID: event.properties.assistantMessageID,
          type: "text",
          text: content.text,
        },
        input.thinking,
      )
    }
    return reduceTextPart(
      data,
      {
        id: event.properties.partID,
        sessionID: event.properties.sessionID,
        messageID: event.properties.assistantMessageID,
        type: "reasoning",
        text: content.text,
        time: { start: event.properties.timestamp, end: event.properties.timestamp },
      },
      input.thinking,
    )
  }

  if (event.type === "permission.v2.asked") {
    if (event.properties.sessionID !== input.sessionID) {
      return out(data, commits)
    }

    upsert(data.permissions, enrichPermission(data, event.properties))
    return queueOut(data, commits)
  }

  if (event.type === "permission.v2.replied") {
    if (event.properties.sessionID !== input.sessionID) {
      return out(data, commits)
    }

    if (!remove(data.permissions, event.properties.requestID)) {
      return out(data, commits)
    }

    return queueOut(data, commits)
  }

  if (event.type === "question.v2.asked") {
    if (event.properties.sessionID !== input.sessionID) {
      return out(data, commits)
    }

    upsert(data.questions, event.properties)
    return queueOut(data, commits)
  }

  if (event.type === "question.v2.replied" || event.type === "question.v2.rejected") {
    if (event.properties.sessionID !== input.sessionID) {
      return out(data, commits)
    }

    if (!remove(data.questions, event.properties.requestID)) {
      return out(data, commits)
    }

    return queueOut(data, commits)
  }

  if (event.type === "session.next.error") {
    if (event.properties.sessionID !== input.sessionID) {
      return out(data, commits)
    }

    commits.push({
      kind: "error",
      text: formatError(event.properties.error),
      phase: "start",
      source: "system",
    })
    return out(data, commits)
  }

  return out(data, commits)
}
