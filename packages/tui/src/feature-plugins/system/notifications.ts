import type { TuiAttentionSoundName, TuiNativeEvent, TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"

const id = "internal:notifications"

type SessionError = Extract<TuiNativeEvent, { type: "session.next.error" }>["data"]["error"]

function notify(api: TuiPluginApi, sessionID: string | undefined, message: string, sound: TuiAttentionSoundName) {
  const session = sessionID ? api.state.session.get(sessionID) : undefined
  const isSubagent = session?.parentID !== undefined
  void api.attention.notify({
    title: session?.title,
    message,
    notification: isSubagent ? false : { when: "blurred" },
    sound: { name: sound, when: "always" },
  })
}

function sessionErrorMessage(error: SessionError) {
  if (error?.name === "MessageAbortedError") return "Session aborted"
  const data = error?.data
  if (data && typeof data === "object" && "message" in data && data.message === "SSE read timed out") {
    return "Model stopped responding"
  }
  return "Session error"
}

const tui: TuiPlugin = async (api) => {
  const active = new Set<string>()
  const errored = new Set<string>()
  const questions = new Set<string>()
  const permissions = new Set<string>()

  api.nativeEvent.on("question.v2.asked", (event) => {
    if (questions.has(event.data.id)) return
    questions.add(event.data.id)
    notify(api, event.data.sessionID, "Question needs input", "question")
  })

  api.nativeEvent.on("question.v2.replied", (event) => {
    questions.delete(event.data.requestID)
  })

  api.nativeEvent.on("question.v2.rejected", (event) => {
    questions.delete(event.data.requestID)
  })

  api.nativeEvent.on("permission.v2.asked", (event) => {
    if (permissions.has(event.data.id)) return
    permissions.add(event.data.id)
    notify(api, event.data.sessionID, "Permission needs input", "permission")
  })

  api.nativeEvent.on("permission.v2.replied", (event) => {
    permissions.delete(event.data.requestID)
  })

  api.nativeEvent.on("session.next.status", (event) => {
    const sessionID = event.data.sessionID
    if (event.data.status.type === "busy" || event.data.status.type === "retry") {
      active.add(sessionID)
      errored.delete(sessionID)
      return
    }

    if (event.data.status.type !== "idle") return
    if (!active.has(sessionID)) return
    active.delete(sessionID)

    if (errored.has(sessionID)) {
      errored.delete(sessionID)
      return
    }

    const session = api.state.session.get(sessionID)
    notify(api, sessionID, "Session done", session?.parentID ? "subagent_done" : "done")
  })

  api.nativeEvent.on("session.next.error", (event) => {
    const sessionID = event.data.sessionID
    if (!sessionID) return
    if (!active.has(sessionID)) return
    errored.add(sessionID)
    notify(api, sessionID, sessionErrorMessage(event.data.error), "error")
  })
}

const plugin: BuiltinTuiPlugin = {
  id,
  tui,
}

export default plugin
