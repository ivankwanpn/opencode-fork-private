import { describe, expect, test } from "bun:test"
import type { PermissionV2Request } from "@opencode-ai/sdk/v2"
import {
  createPermissionBodyState,
  permissionAlwaysLines,
  permissionCancel,
  permissionEscape,
  permissionHover,
  permissionInfo,
  permissionOptions,
  permissionReject,
  permissionRun,
  permissionShift,
  syncPermissionBodyState,
} from "@/cli/cmd/run/permission.shared"

function req(input: Partial<PermissionV2Request> = {}): PermissionV2Request {
  return {
    id: "perm-1",
    sessionID: "session-1",
    action: "read",
    resources: [],
    metadata: {},
    save: [],
    ...input,
  }
}

describe("run permission shared", () => {
  test("replies immediately for allow once", () => {
    const out = permissionRun(createPermissionBodyState(req()), "perm-1", "once")

    expect(out.reply).toEqual({
      requestID: "perm-1",
      reply: "once",
    })
  })

  test("requires confirmation for allow always", () => {
    const initial = createPermissionBodyState(req({ save: ["*"] }))
    expect(initial.canSave).toBe(true)

    const next = permissionRun(initial, "perm-1", "always")
    expect(next.state.stage).toBe("always")
    expect(next.state.selected).toBe("confirm")
    expect(next.reply).toBeUndefined()

    expect(permissionRun(next.state, "perm-1", "confirm").reply).toEqual({
      requestID: "perm-1",
      reply: "always",
    })

    expect(permissionRun(next.state, "perm-1", "cancel").state).toMatchObject({
      stage: "permission",
      selected: "always",
    })
  })

  test("builds trimmed reject replies and stage transitions", () => {
    const next = permissionRun(createPermissionBodyState(req()), "perm-1", "reject")
    expect(next.state.stage).toBe("reject")

    const out = permissionReject({ ...next.state, message: "  use rg  " }, "perm-1")
    expect(out).toEqual({
      requestID: "perm-1",
      reply: "reject",
      message: "use rg",
    })

    expect(permissionCancel(next.state)).toMatchObject({
      stage: "permission",
      selected: "reject",
    })

    expect(permissionEscape(createPermissionBodyState(req()))).toMatchObject({
      stage: "reject",
      selected: "reject",
    })

    expect(permissionEscape({ ...next.state, stage: "always", selected: "confirm" })).toMatchObject({
      stage: "permission",
      selected: "always",
    })
  })

  test("cannot select or enter always without save patterns", () => {
    for (const request of [req({ save: undefined }), req({ save: [] })]) {
      const state = createPermissionBodyState(request)

      expect(state.canSave).toBe(false)
      expect(permissionOptions(state)).toEqual(["once", "reject"])
      expect(permissionShift(state, 1).selected).toBe("reject")
      expect(permissionShift(permissionShift(state, 1), 1).selected).toBe("once")
      expect(permissionRun(state, request.id, "always")).toEqual({ state })
    }
  })

  test("resets navigation when the permission request or save capability changes", () => {
    const always = permissionRun(createPermissionBodyState(req({ save: ["*"] })), "perm-1", "always").state

    expect(syncPermissionBodyState(always, req({ id: "perm-2", save: [] }))).toEqual({
      requestID: "perm-2",
      canSave: false,
      stage: "permission",
      selected: "once",
      message: "",
      submitting: false,
    })
    expect(syncPermissionBodyState(always, req({ save: [] }))).toMatchObject({
      requestID: "perm-1",
      canSave: false,
      stage: "permission",
      selected: "once",
    })
    expect(syncPermissionBodyState(always, req({ save: ["git *"] }))).toBe(always)
  })

  test("ignores stale requests and options unavailable in the current stage", () => {
    const permission = createPermissionBodyState(req({ save: ["*"] }))
    const always = permissionRun(permission, permission.requestID, "always").state
    const reject = permissionRun(permission, permission.requestID, "reject").state

    for (const option of ["once", "always", "reject", "confirm", "cancel"] as const) {
      const stale = permissionRun(permission, "perm-stale", option)
      expect(stale.state).toBe(permission)
      expect(stale.reply).toBeUndefined()
    }

    for (const [state, invalid] of [
      [permission, ["confirm", "cancel"]],
      [always, ["once", "always", "reject"]],
      [reject, ["once", "always", "reject", "confirm", "cancel"]],
    ] as const) {
      for (const option of invalid) {
        const result = permissionRun(state, state.requestID, option)
        expect(result.state).toBe(state)
        expect(result.reply).toBeUndefined()
      }
    }

    expect(permissionHover(permission, "confirm")).toBe(permission)
    expect(permissionHover(always, "reject")).toBe(always)
    expect(permissionHover(permission, "always")).toMatchObject({ selected: "always" })
  })

  test("maps supported permission types into display info", () => {
    expect(
      permissionInfo(
        req({
          action: "bash",
          metadata: {
            input: {
              command: "git status --short",
            },
          },
        }),
      ),
    ).toMatchObject({
      title: "Shell command",
      lines: ["$ git status --short"],
    })

    expect(
      permissionInfo(
        req({
          action: "task",
          metadata: {
            description: "investigate stream",
            subagent_type: "general",
          },
        }),
      ),
    ).toMatchObject({
      title: "General Task",
      lines: ["◉ investigate stream"],
    })

    expect(
      permissionInfo(
        req({
          action: "external_directory",
          resources: ["/tmp/work/**/*.ts", "/tmp/work/**/*.tsx"],
        }),
      ),
    ).toMatchObject({
      title: "Access external directory /tmp/work",
      lines: ["- /tmp/work/**/*.ts", "- /tmp/work/**/*.tsx"],
    })

    expect(permissionInfo(req({ action: "doom_loop" }))).toMatchObject({
      title: "Continue after repeated failures",
    })

    expect(permissionInfo(req({ action: "custom_tool" }))).toMatchObject({
      title: "Call tool custom_tool",
      lines: ["Tool: custom_tool"],
    })
  })

  test("formats always-allow copy for wildcard and explicit patterns", () => {
    expect(permissionAlwaysLines(req({ action: "bash", save: ["*"] }))).toEqual([
      "This will allow bash until OpenCode is restarted.",
    ])

    expect(permissionAlwaysLines(req({ save: ["src/**/*.ts", "src/**/*.tsx"] }))).toEqual([
      "This will allow the following patterns until OpenCode is restarted.",
      "- src/**/*.ts",
      "- src/**/*.tsx",
    ])
  })
})
