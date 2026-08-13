import { afterEach, describe, expect, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import { render } from "solid-js/web"
import { Part } from "./message-part"
import type { MessagePartProps } from "./message-part"
import { DataProvider } from "../context"
import { MarkedProvider } from "@opencode-ai/ui/context/marked"
import { I18nProvider, type UiI18n } from "@opencode-ai/ui/context/i18n"
import type { AssistantMessage, Message, ReasoningPart, TextPart } from "@opencode-ai/sdk/v2"

const i18n: UiI18n = { locale: () => "en", t: (key) => key }

const host = (part: () => MessagePartProps["part"], message: () => Message) => {
  const data = {
    session: [],
    session_status: {},
    session_diff: {},
    message: {},
    part: {},
    part_text_accum_delta: {},
  }
  return (
    <DataProvider data={data} directory="/repo">
      <MarkedProvider>
        <I18nProvider value={i18n}>
          <Part part={part()} message={message()} />
        </I18nProvider>
      </MarkedProvider>
    </DataProvider>
  )
}

describe("message-part remount regression", () => {
  let dispose: () => void

  afterEach(() => dispose?.())

  test("keeps the rendered markdown node across the streaming → completed transition", async () => {
    const [completed, setCompleted] = createSignal<number | undefined>(undefined)
    const part = () =>
      ({
        id: "prt_1",
        sessionID: "ses_1",
        messageID: "msg_1",
        type: "text",
        text: "**bold** tail",
      }) satisfies TextPart
    const message = () =>
      ({
        id: "msg_1",
        sessionID: "ses_1",
        role: "assistant",
        time: { created: 1, completed: completed() },
        parentID: "msg_user",
        modelID: "model",
        providerID: "provider",
        mode: "build",
        agent: "build",
        path: { cwd: "/repo", root: "/repo" },
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      }) satisfies AssistantMessage

    dispose = createRoot((disposeRoot) => {
      const cleanup = render(() => host(part, message), document.body)
      return () => {
        cleanup()
        disposeRoot()
      }
    })

    const markdownBefore = document.querySelector('[data-component="markdown"]')
    expect(markdownBefore).toBeTruthy()

    setCompleted(2)

    // 確定性 barrier：Markdown 的 createResource 非同步解析，用 expect.poll 等到解析落地。
    await expect
      .poll(() => document.querySelector('[data-component="markdown"]')?.innerHTML.includes("<strong>bold</strong>"))
      .toBe(true)

    expect(document.querySelector('[data-component="markdown"]')).toBe(markdownBefore)
    expect(document.querySelector('[data-component="markdown"]')?.innerHTML).not.toContain("**bold**")
  })

  test("renders the reasoning heading row for reasoning parts", async () => {
    const part = () =>
      ({
        id: "prt_2",
        sessionID: "ses_1",
        messageID: "msg_2",
        type: "reasoning",
        text: "thinking",
        time: { start: 1 },
      }) satisfies ReasoningPart
    const message = () =>
      ({
        id: "msg_2",
        sessionID: "ses_1",
        role: "assistant",
        time: { created: 1, completed: 2 },
        parentID: "msg_user",
        modelID: "model",
        providerID: "provider",
        mode: "build",
        agent: "build",
        path: { cwd: "/repo", root: "/repo" },
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      }) satisfies AssistantMessage

    dispose = createRoot((disposeRoot) => {
      const cleanup = render(() => host(part, message), document.body)
      return () => {
        cleanup()
        disposeRoot()
      }
    })

    await expect.poll(() => document.querySelector('[data-slot="reasoning-part-heading"]')).toBeTruthy()
  })
})
