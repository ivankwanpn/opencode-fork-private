/** @jsxImportSource @opentui/solid */
import { describe, expect, test } from "bun:test"
import { tmpdir } from "../../../fixture/fixture"
import { json, mount, wait } from "./sync-fixture"
import type { GlobalEvent } from "@opencode-ai/sdk/v2"

function branchEvent(branch: string, workspace?: string): GlobalEvent {
  return {
    directory: "/tmp/other",
    project: "proj_test",
    workspace,
    payload: {
      id: `evt_vcs_${branch}`,
      type: "vcs.branch.updated",
      properties: { branch },
    },
  }
}

describe("tui sync", () => {
  test("sync preserves a native synthetic task completion before the parent resumes", async () => {
    await using tmp = await tmpdir()
    await Bun.write(`${tmp.path}/kv.json`, "{}")
    const sessionID = "ses_parent"
    const syntheticID = "msg_background_result"
    const assistantID = "msg_parent_resumed"
    const description = "Background task completed: inspect flow"
    const task = '<task id="ses_child" state="completed">\n<task_result>complete</task_result>\n</task>'
    const { app, sync, data } = await mount((url) => {
      if (url.pathname === `/api/session/${sessionID}`)
        return json({
          data: {
            id: sessionID,
            projectID: "proj_test",
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            time: { created: 0, updated: 0 },
            title: "Parent session",
            location: { directory: "/tmp/opencode/packages/opencode" },
          },
        })
      if (url.pathname === `/api/session/${sessionID}/message`)
        return json({
          data: [
            {
              id: assistantID,
              type: "assistant",
              agent: "build",
              model: { id: "model", providerID: "provider" },
              content: [{ id: "txt_parent_resumed", type: "text", text: "Parent resumed after the task completed." }],
              time: { created: 2, completed: 3 },
            },
            {
              id: syntheticID,
              type: "synthetic",
              sessionID,
              text: task,
              description,
              time: { created: 1 },
            },
          ],
          cursor: {},
        })
      if (url.pathname === `/api/session/${sessionID}/todo`) return json({ data: [] })
      return undefined
    }, tmp.path)

    try {
      await sync.session.sync(sessionID)
      const completion = data.session.message.list(sessionID)?.find((message) => message.id === syntheticID)
      expect(completion).toMatchObject({
        type: "synthetic",
        text: expect.stringContaining('<task id="ses_child"'),
        description,
      })
      if (completion?.type !== "synthetic") return
      expect(completion.text).toContain("<task_result>complete</task_result>")
      const resumed = data.session.message.list(sessionID)?.find((message) => message.id === assistantID)
      expect(resumed?.type).toBe("assistant")
      if (resumed?.type === "assistant")
        expect(resumed.content[0]).toMatchObject({ text: "Parent resumed after the task completed." })
    } finally {
      app.renderer.destroy()
    }
  })

  test("refresh scopes sessions by default and lists project sessions when disabled", async () => {
    await using tmp = await tmpdir()
    await Bun.write(`${tmp.path}/kv.json`, "{}")
    const { app, kv, sync, session } = await mount(undefined, tmp.path)

    try {
      expect(kv.get("session_directory_filter_enabled", true)).toBe(true)
      expect(session.at(-1)?.searchParams.get("project")).toBe("proj_test")
      expect(session.at(-1)?.searchParams.get("subpath")).toBe("packages/tui")

      kv.set("session_directory_filter_enabled", false)
      await sync.session.refresh()

      expect(session.at(-1)?.searchParams.get("project")).toBe("proj_test")
      expect(session.at(-1)?.searchParams.get("subpath")).toBeNull()
    } finally {
      app.renderer.destroy()
    }
  })

  test("vcs branch updates only apply for the active workspace", async () => {
    await using tmp = await tmpdir()
    await Bun.write(`${tmp.path}/kv.json`, "{}")
    const { app, emit, project, sync } = await mount(undefined, tmp.path)

    try {
      expect(sync.data.vcs?.branch).toBe("main")

      project.workspace.set("ws_a")
      emit(branchEvent("other", "ws_b"))
      await Bun.sleep(30)

      expect(sync.data.vcs?.branch).toBe("main")

      emit(branchEvent("feature", "ws_a"))
      await wait(() => sync.data.vcs?.branch === "feature")

      expect(sync.data.vcs?.branch).toBe("feature")
    } finally {
      app.renderer.destroy()
    }
  })

  test("native session status updates the synchronized session state", async () => {
    await using tmp = await tmpdir()
    await Bun.write(`${tmp.path}/kv.json`, "{}")
    const { app, emitNative, sync } = await mount(undefined, tmp.path)

    try {
      emitNative({
        id: "evt_status",
        type: "session.next.status",
        data: {
          timestamp: 1,
          sessionID: "ses_test",
          status: { type: "busy" },
        },
      })
      await wait(() => sync.data.session_status.ses_test?.type === "busy")

      expect(sync.data.session_status.ses_test).toEqual({ type: "busy" })
    } finally {
      app.renderer.destroy()
    }
  })

  test("native session diff updates the synchronized session state", async () => {
    await using tmp = await tmpdir()
    await Bun.write(`${tmp.path}/kv.json`, "{}")
    const { app, emitNative, sync } = await mount(undefined, tmp.path)

    try {
      emitNative({
        id: "evt_diff",
        type: "session.next.diff",
        data: {
          timestamp: 1,
          sessionID: "ses_test",
          diff: [{ file: "src/index.ts", additions: 3, deletions: 1, status: "modified" }],
        },
      })
      await wait(() => sync.data.session_diff.ses_test?.length === 1)

      expect(sync.data.session_diff.ses_test).toEqual([
        { file: "src/index.ts", additions: 3, deletions: 1, status: "modified" },
      ])
    } finally {
      app.renderer.destroy()
    }
  })

  test("canonical question and permission events update synchronized requests", async () => {
    await using tmp = await tmpdir()
    await Bun.write(`${tmp.path}/kv.json`, "{}")
    const { app, emitNative, sync } = await mount(undefined, tmp.path)

    try {
      emitNative({
        id: "evt_question_asked",
        type: "question.v2.asked",
        data: {
          id: "que_test",
          sessionID: "ses_test",
          questions: [{ header: "Continue", question: "Continue?", options: [] }],
        },
      })
      emitNative({
        id: "evt_permission_asked",
        type: "permission.v2.asked",
        data: {
          id: "per_test",
          sessionID: "ses_test",
          action: "edit",
          resources: ["src/index.ts"],
          save: ["src/**"],
          source: { type: "tool", messageID: "msg_test", callID: "call_test" },
        },
      })
      await wait(() => sync.data.question.ses_test?.length === 1 && sync.data.permission.ses_test?.length === 1)

      expect(sync.data.question.ses_test[0].id).toBe("que_test")
      expect(sync.data.question.ses_test[0].questions[0].question).toBe("Continue?")
      expect({ ...sync.data.permission.ses_test[0], resources: [...sync.data.permission.ses_test[0].resources] }).toEqual({
        id: "per_test",
        sessionID: "ses_test",
        action: "edit",
        resources: ["src/index.ts"],
        save: ["src/**"],
        source: { type: "tool", messageID: "msg_test", callID: "call_test" },
      })

      emitNative({
        id: "evt_question_rejected",
        type: "question.v2.rejected",
        data: { sessionID: "ses_test", requestID: "que_test" },
      })
      emitNative({
        id: "evt_permission_replied",
        type: "permission.v2.replied",
        data: { sessionID: "ses_test", requestID: "per_test", reply: "once" },
      })
      await wait(() => sync.data.question.ses_test?.length === 0 && sync.data.permission.ses_test?.length === 0)

      expect(sync.data.question.ses_test).toEqual([])
      expect(sync.data.permission.ses_test).toEqual([])
    } finally {
      app.renderer.destroy()
    }
  })
})
