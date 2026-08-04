import { createStore } from "solid-js/store"
import type { FilePartSource } from "@opencode-ai/sdk/v2/client"
import type { ServerApi } from "@/utils/server"
import { decodeFilePath, stripQueryAndHash } from "@/context/file/path"
import type { ContextItem, FileAttachmentPart, Prompt } from "@/context/prompt"
import { readCommentMetadata } from "@/utils/comment-note"

type SessionFollowupApi = Pick<
  ServerApi["session"],
  "inputList" | "inputGet" | "inputPromote" | "inputCancel"
>

export type SessionFollowupItem = Awaited<ReturnType<SessionFollowupApi["inputList"]>>[number]

export type SessionFollowupEdit = {
  id: string
  prompt: Prompt
  context: (ContextItem & { key: string })[]
}

export function createSessionFollowupState(input: {
  sessionID: () => string | undefined
  api: () => SessionFollowupApi
  mutate?: (sessionID: string, task: (api: SessionFollowupApi) => Promise<unknown>) => Promise<unknown>
  enabled?: () => boolean
}) {
  const [store, setStore] = createStore({
    items: [] as SessionFollowupItem[],
    loading: false,
    sending: undefined as string | undefined,
  })
  let request = 0

  const currentSession = () => input.sessionID()
  const enabled = () => input.enabled?.() ?? true

  const pending = (sessionID: string, items: readonly SessionFollowupItem[]) =>
    items
      .filter(
        (item) =>
          item.sessionID === sessionID && item.delivery === "queue" && item.promotedSeq === undefined,
      )
      .slice()
      .sort((left, right) => left.admittedSeq - right.admittedSeq)

  const refresh = async () => {
    const sessionID = currentSession()
    if (!sessionID || !enabled()) {
      request++
      setStore("items", [])
      setStore("loading", false)
      return
    }

    const ticket = ++request
    const api = input.api()
    setStore("items", [])
    setStore("loading", true)
    try {
      const items = await api.inputList({ sessionID, delivery: "queue" })
      if (ticket !== request || currentSession() !== sessionID) return
      setStore("items", pending(sessionID, items))
    } finally {
      if (ticket === request) setStore("loading", false)
    }
  }

  const reconcile = async (inputID: string) => {
    const sessionID = currentSession()
    if (!sessionID || !enabled()) return

    const item = await input.api().inputGet({ sessionID, inputID })
    if (currentSession() !== sessionID) return item

    setStore("items", (items) => pending(sessionID, [...items.filter((entry) => entry.id !== item.id), item]))
    return item
  }

  const promote = async (inputID: string) => {
    const sessionID = currentSession()
    if (!sessionID || !enabled() || store.sending) return false

    const api = input.api()
    setStore("sending", inputID)
    try {
      if (input.mutate) await input.mutate(sessionID, (current) => current.inputPromote({ sessionID, inputID }))
      else await api.inputPromote({ sessionID, inputID })
      await refresh()
      return true
    } catch (error) {
      const item = await api.inputGet({ sessionID, inputID }).catch(() => undefined)
      if (item?.promotedSeq === undefined) throw error
      await refresh()
      return true
    } finally {
      setStore("sending", (current) => (current === inputID ? undefined : current))
    }
  }

  const cancel = async (inputID: string) => {
    const sessionID = currentSession()
    if (!sessionID || !enabled() || store.sending) return false

    const api = input.api()
    setStore("sending", inputID)
    try {
      if (input.mutate) await input.mutate(sessionID, (current) => current.inputCancel({ sessionID, inputID }))
      else await api.inputCancel({ sessionID, inputID })
      await refresh()
      return true
    } finally {
      setStore("sending", (current) => (current === inputID ? undefined : current))
    }
  }

  const edit = async (inputID: string) => {
    const item = store.items.find((entry) => entry.id === inputID) ?? (await reconcile(inputID))
    if (!item) return
    await cancel(inputID)
    return item
  }

  const remove = (inputID: string) => cancel(inputID)

  return {
    items: () => store.items,
    loading: () => store.loading,
    sending: () => store.sending,
    refresh,
    reconcile,
    promote,
    edit,
    remove,
  }
}

export function toSessionFollowupEdit(item: SessionFollowupItem): SessionFollowupEdit {
  const text = item.prompt.text
  const prompt: Prompt = [
    { type: "text", content: text, start: 0, end: text.length },
    ...(item.prompt.files ?? []).map((file) => toFilePart(file)),
    ...(item.prompt.agents ?? []).map((agent) => ({
      type: "agent" as const,
      name: agent.name,
      content: agent.source?.text ?? `@${agent.name}`,
      start: agent.source?.start ?? 0,
      end: agent.source?.end ?? agent.source?.text.length ?? agent.name.length + 1,
    })),
  ]
  const context = (item.prompt.context ?? []).flatMap((entry, index) => {
    const comment = readCommentMetadata(entry.metadata)
    if (!comment) return []
    return [{ ...comment, type: "file" as const, key: `${item.id}:context:${index}` }]
  })

  return { id: item.id, prompt, context }
}

function toFilePart(file: NonNullable<SessionFollowupItem["prompt"]["files"]>[number]): FileAttachmentPart {
  const source = toFileSource(file)
  return {
    type: "file",
    path: source?.type === "file" ? source.path : (file.name ?? file.uri),
    content: file.source?.text ?? "",
    start: file.source?.start ?? 0,
    end: file.source?.end ?? file.source?.text.length ?? 0,
    mime: file.mime,
    filename: file.name,
    url: file.uri,
    source,
  }
}

function toFileSource(file: NonNullable<SessionFollowupItem["prompt"]["files"]>[number]): FilePartSource | undefined {
  const source = file.source
  if (!source) return
  const text = { value: source.text, start: source.start, end: source.end }
  if (file.resource) return { type: "resource", clientName: file.resource.clientName, uri: file.resource.uri, text }
  return { type: "file", path: filePath(file.uri), text }
}

function filePath(uri: string) {
  const value = stripQueryAndHash(uri)
  if (!value.startsWith("file://")) return value
  return decodeFilePath(value.slice("file://".length))
}
