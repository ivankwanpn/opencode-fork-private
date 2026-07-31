import { describe, expect, test } from "bun:test"
import { createSessionFollowupState, toSessionFollowupEdit } from "./session-followup-state"

type Row = {
  admittedSeq: number
  id: string
  sessionID: string
  prompt: { text: string }
  delivery: "queue" | "steer"
  timeCreated: number
  promotedSeq?: number
}

function createFixture(initial: Row[]) {
  const rows = initial.slice()
  const calls = {
    list: [] as string[],
    get: [] as string[],
    promote: [] as string[],
    cancel: [] as string[],
  }
  const api = {
    inputList: async (input: { sessionID: string; delivery?: "queue" | "steer" }) => {
      calls.list.push(`${input.sessionID}:${input.delivery ?? "all"}`)
      return rows.filter((row) => row.sessionID === input.sessionID && (!input.delivery || row.delivery === input.delivery))
    },
    inputGet: async (input: { sessionID: string; inputID: string }) => {
      calls.get.push(input.inputID)
      const row = rows.find((item) => item.sessionID === input.sessionID && item.id === input.inputID)
      if (!row) throw new Error("missing")
      return row
    },
    inputPromote: async (input: { sessionID: string; inputID: string }) => {
      calls.promote.push(input.inputID)
      const row = rows.find((item) => item.sessionID === input.sessionID && item.id === input.inputID)
      if (!row) throw new Error("missing")
      row.promotedSeq ??= 99
      return row
    },
    inputCancel: async (input: { sessionID: string; inputID: string }) => {
      calls.cancel.push(input.inputID)
      const index = rows.findIndex((item) => item.sessionID === input.sessionID && item.id === input.inputID)
      if (index === -1) throw new Error("missing")
      rows.splice(index, 1)
    },
  }
  return { rows, calls, api }
}

const row = (input: Partial<Row> & Pick<Row, "id" | "delivery">): Row => ({
  admittedSeq: 1,
  sessionID: "ses_1",
  prompt: { text: input.id },
  timeCreated: 1,
  ...input,
})

describe("session follow-up state", () => {
  test("hydrates only pending queue inputs and promotes by exact id", async () => {
    const fixture = createFixture([
      row({ id: "msg_queue_1", delivery: "queue" }),
      row({ id: "msg_steer_1", delivery: "steer" }),
      row({ id: "msg_promoted", delivery: "queue", promotedSeq: 2 }),
    ])
    const state = createSessionFollowupState({ sessionID: () => "ses_1", api: () => fixture.api as never })

    await state.refresh()
    expect(state.items().map((item) => item.id)).toEqual(["msg_queue_1"])

    await state.promote("msg_queue_1")
    expect(fixture.calls.promote).toEqual(["msg_queue_1"])
    expect(state.items()).toEqual([])
  })

  test("reconciles an exact input after a lost list response", async () => {
    const fixture = createFixture([row({ id: "msg_lost", delivery: "queue" })])
    const state = createSessionFollowupState({ sessionID: () => "ses_1", api: () => fixture.api as never })

    const item = await state.reconcile("msg_lost")

    expect(item?.id).toBe("msg_lost")
    expect(fixture.calls.get).toEqual(["msg_lost"])
    expect(state.items().map((entry) => entry.id)).toEqual(["msg_lost"])
  })

  test("cancels before returning the canonical item for edit", async () => {
    const fixture = createFixture([row({ id: "msg_edit", delivery: "queue", prompt: { text: "canonical" } })])
    const state = createSessionFollowupState({ sessionID: () => "ses_1", api: () => fixture.api as never })
    await state.refresh()

    const item = await state.edit("msg_edit")

    expect(fixture.calls.cancel).toEqual(["msg_edit"])
    expect(item?.prompt.text).toBe("canonical")
    expect(state.items()).toEqual([])
  })

  test("does not leak a previous session into a switched session", async () => {
    let sessionID = "ses_1"
    const fixture = createFixture([row({ id: "msg_one", delivery: "queue" }), row({ id: "msg_two", delivery: "queue", sessionID: "ses_2" })])
    const state = createSessionFollowupState({ sessionID: () => sessionID, api: () => fixture.api as never })
    await state.refresh()
    sessionID = "ses_2"
    await state.refresh()

    expect(state.items().map((item) => item.id)).toEqual(["msg_two"])
  })

  test("treats a lost promote response as success after the server already promoted the exact input", async () => {
    const fixture = createFixture([row({ id: "msg_replay", delivery: "queue" })])
    let promoteCalls = 0
    const api = {
      ...fixture.api,
      inputPromote: async (input: { sessionID: string; inputID: string }) => {
        promoteCalls += 1
        await fixture.api.inputPromote(input)
        throw new Error("response lost")
      },
    }
    const state = createSessionFollowupState({ sessionID: () => "ses_1", api: () => api as never })
    await state.refresh()

    expect(await state.promote("msg_replay")).toBe(true)
    expect(promoteCalls).toBe(1)
    expect(state.items()).toEqual([])
  })

  test("restores the canonical prompt attachments for editing", () => {
    const edit = toSessionFollowupEdit({
      ...row({ id: "msg_edit_prompt", delivery: "queue" }),
      prompt: {
        text: "inspect",
        files: [
          {
            uri: "file:///repo/app.ts",
            mime: "text/plain",
            name: "app.ts",
            source: {
              text: "@app.ts",
              start: 0,
              end: 7,
            },
          },
        ],
        agents: [
          {
            name: "reviewer",
            source: { text: "@reviewer", start: 8, end: 17 },
          },
        ],
      },
    } as never)

    expect(edit.prompt).toEqual([
      { type: "text", content: "inspect", start: 0, end: 7 },
      {
        type: "file",
        path: "/repo/app.ts",
        content: "@app.ts",
        start: 0,
        end: 7,
        mime: "text/plain",
        filename: "app.ts",
        url: "file:///repo/app.ts",
        source: {
          type: "file",
          path: "/repo/app.ts",
          text: { value: "@app.ts", start: 0, end: 7 },
        },
      },
      { type: "agent", name: "reviewer", content: "@reviewer", start: 8, end: 17 },
    ])
  })
})
