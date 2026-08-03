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
    const { app, sync } = await mount((url) => {
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
      const completion = sync.data.part[syntheticID]?.[0]
      expect(completion).toMatchObject({
        type: "text",
        synthetic: true,
        text: expect.stringContaining('<task id="ses_child"'),
      })
      if (completion?.type !== "text") return
      expect(completion.text).toContain(description)
      const resumed = sync.data.message[sessionID]?.find((message) => message.id === assistantID)
      expect(resumed?.role).toBe("assistant")
      if (resumed?.role === "assistant") expect(resumed.parentID).toBe(syntheticID)
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
})
