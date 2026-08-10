import { createMemo } from "solid-js"
import { useData } from "../../context/data"
import { DialogSelect } from "../../ui/dialog-select"
import { useSDK } from "../../context/sdk"
import { useRoute } from "../../context/route"
import { useClipboard } from "../../context/clipboard"
import { promptInfo } from "../../util/native-transcript"
import type { PromptInfo } from "../../prompt/history"
import type { SessionMessageUser } from "@opencode-ai/sdk/v2"

export function DialogMessage(props: {
  messageID: string
  sessionID: string
  setPrompt?: (prompt: PromptInfo) => void
}) {
  const data = useData()
  const sdk = useSDK()
  const message = createMemo(() =>
    data.session.message
      .list(props.sessionID)
      ?.find((item): item is SessionMessageUser => item.id === props.messageID && item.type === "user"),
  )
  const route = useRoute()
  const clipboard = useClipboard()

  return (
    <DialogSelect
      title="Message Actions"
      options={[
        {
          title: "Revert",
          value: "session.revert",
          description: "undo messages and file changes",
          onSelect: (dialog) => {
            const msg = message()
            if (!msg) return

            void sdk.native.sessions.stage({
              sessionID: props.sessionID,
              messageID: msg.id,
            })

            props.setPrompt?.(promptInfo(msg))

            dialog.clear()
          },
        },
        {
          title: "Copy",
          value: "message.copy",
          description: "message text to clipboard",
          onSelect: async (dialog) => {
            const msg = message()
            if (!msg) return

            await clipboard.write?.(msg.text)
            dialog.clear()
          },
        },
        {
          title: "Fork",
          value: "session.fork",
          description: "create a new session",
          onSelect: async (dialog) => {
            const forked = await sdk.native.sessions.fork({
              sessionID: props.sessionID,
              messageID: props.messageID,
            })
            const msg = message()
            const prompt = msg ? promptInfo(msg) : undefined
            route.navigate({
              sessionID: forked.id,
              type: "session",
              prompt,
            })
            dialog.clear()
          },
        },
      ]}
    />
  )
}
