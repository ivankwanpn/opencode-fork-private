/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { tmpdir } from "../../../fixture/fixture"
import { directory, json, mount, wait } from "./sync-fixture"

const sessionID = "ses_hydration_race"
const messageID = "msg_hydration_race"
const location = { directory }
const nativeSession = {
  id: sessionID,
  projectID: "proj_test",
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 0, updated: 0 },
  title: "race",
  location,
}

function messages(content: string) {
  return json({
    data: [
      {
        id: messageID,
        type: "assistant",
        agent: "build",
        model: { id: "model", providerID: "test" },
        content: [{ id: "text_1", type: "text", text: content }],
        time: { created: 1 },
      },
    ],
    cursor: {},
  })
}

function delayedMount(response: Promise<Response>, state: string) {
  let requested = false
  return {
    requested: () => requested,
    mounted: mount((url) => {
      if (url.pathname === `/api/session/${sessionID}`) return json({ data: nativeSession })
      if (url.pathname === `/api/session/${sessionID}/message`) {
        requested = true
        return response
      }
      if (url.pathname === `/api/session/${sessionID}/todo`) return json({ data: [] })
      return undefined
    }, state),
  }
}

test("stale native hydration does not overwrite text streamed while the request is pending", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  let resolveMessages!: (response: Response) => void
  const response = new Promise<Response>((resolve) => {
    resolveMessages = resolve
  })
  const pending = delayedMount(response, tmp.path)
  const { app, data, emitNative, sync } = await pending.mounted

  try {
    const hydrate = sync.session.sync(sessionID)
    await wait(pending.requested)
    emitNative({
      id: "evt_step",
      type: "session.next.step.started",
      data: {
        sessionID,
        assistantMessageID: messageID,
        timestamp: 1,
        agent: "build",
        model: { id: "model", providerID: "test" },
      },
      location,
    })
    emitNative({
      id: "evt_text_started",
      type: "session.next.text.started",
      data: { sessionID, assistantMessageID: messageID, textID: "text_1", timestamp: 2 },
      location,
    })
    emitNative({
      id: "evt_text_delta",
      type: "session.next.text.delta",
      data: {
        sessionID,
        assistantMessageID: messageID,
        textID: "text_1",
        delta: "visible live content",
        timestamp: 3,
      },
      location,
    })
    await wait(() => {
      const message = data.session.message.list(sessionID)?.find((item) => item.id === messageID)
      return message?.type === "assistant" && message.content[0]?.type === "text" && message.content[0].text.length > 0
    })

    resolveMessages(messages(""))
    await hydrate

    const message = data.session.message.list(sessionID)?.find((item) => item.id === messageID)
    expect(message?.type).toBe("assistant")
    if (message?.type !== "assistant") return
    expect(message.content[0]).toMatchObject({ type: "text", text: "visible live content" })
  } finally {
    app.renderer.destroy()
  }
})

test("hydration retains a native message received before refresh starts", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  let requests = 0
  const { app, data } = await mount((url) => {
    if (url.pathname === `/api/session/${sessionID}`) return json({ data: nativeSession })
    if (url.pathname === `/api/session/${sessionID}/message`) {
      requests++
      if (requests > 1) return messages("hydrated assistant")
      return json({
        data: [{ id: "msg_live_user", type: "user", text: "live prompt", time: { created: 2 } }],
        cursor: {},
      })
    }
    if (url.pathname === `/api/session/${sessionID}/todo`) return json({ data: [] })
    return undefined
  }, tmp.path)

  try {
    await data.session.message.refresh(sessionID)
    await data.session.message.refresh(sessionID)

    expect(requests).toBe(2)
    expect(data.session.message.list(sessionID)?.map((message) => message.id)).toEqual([messageID, "msg_live_user"])
  } finally {
    app.renderer.destroy()
  }
})

test("concurrent session sync calls share one native message request", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  let requests = 0
  const { app, data, sync } = await mount((url) => {
    if (url.pathname === `/api/session/${sessionID}`) return json({ data: nativeSession })
    if (url.pathname === `/api/session/${sessionID}/message`) {
      requests++
      return messages("hydrated")
    }
    if (url.pathname === `/api/session/${sessionID}/todo`) return json({ data: [] })
    return undefined
  }, tmp.path)

  try {
    await Promise.all([sync.session.sync(sessionID), sync.session.sync(sessionID)])
    expect(requests).toBe(1)
    expect(data.session.message.list(sessionID)?.[0]).toMatchObject({ id: messageID, type: "assistant" })
  } finally {
    app.renderer.destroy()
  }
})
