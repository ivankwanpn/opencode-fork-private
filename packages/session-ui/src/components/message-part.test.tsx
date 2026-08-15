import { afterEach, describe, expect, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import { render } from "solid-js/web"
import { Part } from "./message-part"
import type { MessagePartProps } from "./message-part"
import { readPartText } from "./message-part-text"
import { DataProvider } from "../context"
import { MarkedProvider } from "@opencode-ai/ui/context/marked"
import { I18nProvider, type UiI18n } from "@opencode-ai/ui/context/i18n"
import type { AssistantMessage, Message, ReasoningPart, TextPart, ToolPart } from "@opencode-ai/sdk/v2"

// bun 1.3.14 types ship no expect.poll; the package preload (happydom.ts)
// polyfills it at runtime with this exact matcher surface.
declare module "bun:test" {
  interface Expect {
    poll<T>(producer: () => T, options?: { timeout?: number; interval?: number }): {
      toBe(expected: unknown): Promise<void>
      toEqual(expected: unknown): Promise<void>
      toBeTruthy(): Promise<void>
      toBeFalsy(): Promise<void>
      toBeNull(): Promise<void>
      toBeUndefined(): Promise<void>
      toContain(expected: unknown): Promise<void>
    }
  }
}

const i18n: UiI18n = { locale: () => "en", t: (key) => key }

const host = (
  part: () => MessagePartProps["part"],
  message: () => Message,
  props: Pick<MessagePartProps, "defaultOpen" | "onToolBackground"> = {},
) => {
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
          <Part part={part()} message={message()} {...props} />
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

describe("readPartText", () => {
  test("returns empty string when accum is undefined and part text is undefined", () => {
    expect(readPartText(undefined, { id: "part_1" })).toBe("")
  })

  test("returns trimmed part text when accum is undefined", () => {
    expect(readPartText(undefined, { id: "part_1", text: "  hello  " })).toBe("hello")
  })

  test("prefers accum value over part text when accum has a hit", () => {
    expect(readPartText({ part_1: "  from accum  " }, { id: "part_1", text: "from part" })).toBe("from accum")
  })

  test("falls back to part text when accum misses", () => {
    expect(readPartText({ other_part: "ignored" }, { id: "part_1", text: "  from part  " })).toBe("from part")
  })

  test("returns empty string for whitespace-only text", () => {
    expect(readPartText(undefined, { id: "part_1", text: "   \n\t  " })).toBe("")
  })

  test("trims leading and trailing whitespace", () => {
    expect(readPartText(undefined, { id: "part_1", text: "\n  body  \n" })).toBe("body")
  })
})

describe("shell background action", () => {
  let dispose: () => void

  afterEach(() => dispose?.())

  test("backgrounds a running shell once and hides the action after completion", async () => {
    const [status, setStatus] = createSignal<"running" | "completed">("running")
    const calls: Array<{ sessionID: string; callID: string }> = []
    let release = () => {}
    const request = new Promise<void>((resolve) => {
      release = resolve
    })
    const part = () =>
      ({
        id: "prt_shell",
        sessionID: "ses_shell",
        messageID: "msg_shell",
        type: "tool",
        callID: "call_shell",
        tool: "bash",
        state:
          status() === "running"
            ? { status: "running", input: { command: "bun test" }, time: { start: 1 } }
            : {
                status: "completed",
                input: { command: "bun test" },
                output: "done",
                title: "Shell",
                metadata: {},
                time: { start: 1, end: 2 },
              },
      }) satisfies ToolPart
    const message = () =>
      ({
        id: "msg_shell",
        sessionID: "ses_shell",
        role: "assistant",
        time: { created: 1 },
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
      const cleanup = render(
        () =>
          host(part, message, {
            defaultOpen: true,
            onToolBackground: (input) => {
              calls.push(input)
              return request
            },
          }),
        document.body,
      )
      return () => {
        cleanup()
        disposeRoot()
      }
    })

    const button = document.querySelector<HTMLButtonElement>('button[data-slot="bash-background"]')
    expect(button).toBeTruthy()
    button!.click()
    button!.click()
    await Promise.resolve()
    expect(calls).toEqual([{ sessionID: "ses_shell", callID: "call_shell" }])
    expect(button!.disabled).toBe(true)

    release()
    await expect.poll(() => button!.disabled).toBe(false)
    setStatus("completed")
    await expect.poll(() => document.querySelector('button[data-slot="bash-background"]')).toBeNull()
  })
})
