import { describe, expect, test } from "bun:test"
import {
  beginPermissionSubmission,
  createPermissionPromptNavigationState,
  createPermissionPromptState,
  failPermissionSubmission,
  permissionPromptKeys,
  permissionPromptIdentity,
  permissionPromptOptions,
  permissionStageForSelection,
  syncPermissionPromptSelection,
  syncPermissionPromptNavigationState,
  syncPermissionPromptState,
} from "../../../src/routes/session/permission.shared"

describe("session permission prompt", () => {
  test("does not offer or enter always without save patterns", () => {
    for (const save of [undefined, []]) {
      expect(permissionPromptOptions(save)).toEqual({ once: "Allow once", reject: "Reject" })
      expect(permissionStageForSelection("always", save, false)).toBe("permission")
    }
  })

  test("preserves always confirmation when save patterns exist", () => {
    expect(permissionPromptOptions(["git status *"])).toEqual({
      once: "Allow once",
      always: "Allow always",
      reject: "Reject",
    })
    expect(permissionStageForSelection("always", ["git status *"], false)).toBe("always")
  })

  test("keeps keys and selection current as save capability changes in one prompt", () => {
    const withSave = permissionPromptKeys(permissionPromptOptions(["git status *"]))
    expect(withSave).toEqual(["once", "always", "reject"])
    expect(syncPermissionPromptSelection(withSave, "always")).toBe("always")

    const withoutSave = permissionPromptKeys(permissionPromptOptions([]))
    expect(withoutSave).toEqual(["once", "reject"])
    expect(syncPermissionPromptSelection(withoutSave, "always")).toBe("once")
    expect(withoutSave.includes("always")).toBe(false)

    const restored = permissionPromptKeys(permissionPromptOptions(["git status *"]))
    expect(restored).toEqual(["once", "always", "reject"])
    expect(syncPermissionPromptSelection(restored, "reject")).toBe("reject")
  })

  test("allows one in-flight reply, retries failures, and resets on request switch", () => {
    const initial = createPermissionPromptState("perm-1")
    const started = beginPermissionSubmission(initial, "perm-1")
    expect(started).toMatchObject({ requestID: "perm-1", submitting: true })
    expect(beginPermissionSubmission(started!, "perm-1")).toBeUndefined()
    expect(beginPermissionSubmission(initial, "perm-stale")).toBeUndefined()

    const failed = failPermissionSubmission(started!, "perm-1")
    expect(failed).toMatchObject({ requestID: "perm-1", submitting: false })
    expect(beginPermissionSubmission(failed!, "perm-1")).toMatchObject({ submitting: true })
    expect(failPermissionSubmission(started!, "perm-stale")).toBeUndefined()

    const switched = syncPermissionPromptState({ ...started!, stage: "always" }, "perm-2", true)
    expect(switched).toEqual({ requestID: "perm-2", stage: "permission", submitting: false })
    expect(syncPermissionPromptState({ ...started!, stage: "always" }, "perm-1", false)).toEqual({
      requestID: "perm-1",
      stage: "permission",
      submitting: true,
    })
  })

  test("resets prompt navigation on request or capability identity changes", () => {
    const saveKeys = permissionPromptKeys(permissionPromptOptions(["git status *"]))
    const firstIdentity = permissionPromptIdentity("perm-a", "permission", true)
    const secondIdentity = permissionPromptIdentity("perm-b", "permission", true)
    const selectedReject = {
      ...createPermissionPromptNavigationState(firstIdentity, saveKeys),
      selected: "reject",
      expanded: true,
    }

    expect(syncPermissionPromptNavigationState(selectedReject, secondIdentity, saveKeys)).toEqual({
      identity: secondIdentity,
      selected: "once",
      expanded: false,
    })
    expect(
      syncPermissionPromptNavigationState({ ...selectedReject, selected: "once" }, secondIdentity, saveKeys),
    ).toEqual({
      identity: secondIdentity,
      selected: "once",
      expanded: false,
    })

    const noSaveIdentity = permissionPromptIdentity("perm-b", "permission", false)
    const noSaveKeys = permissionPromptKeys(permissionPromptOptions([]))
    const secondWithSave = {
      ...createPermissionPromptNavigationState(secondIdentity, saveKeys),
      selected: "reject",
      expanded: true,
    }
    expect(syncPermissionPromptNavigationState(secondWithSave, noSaveIdentity, noSaveKeys)).toEqual({
      identity: noSaveIdentity,
      selected: "once",
      expanded: false,
    })

    const restoredIdentity = permissionPromptIdentity("perm-b", "permission", true)
    const noSaveSelectedReject = {
      ...createPermissionPromptNavigationState(noSaveIdentity, noSaveKeys),
      selected: "reject",
      expanded: true,
    }
    expect(syncPermissionPromptNavigationState(noSaveSelectedReject, restoredIdentity, saveKeys)).toEqual({
      identity: restoredIdentity,
      selected: "once",
      expanded: false,
    })

    expect(
      syncPermissionPromptNavigationState(
        { ...createPermissionPromptNavigationState(noSaveIdentity, noSaveKeys), selected: "always", expanded: true },
        noSaveIdentity,
        noSaveKeys,
      ),
    ).toEqual({
      identity: noSaveIdentity,
      selected: "once",
      expanded: true,
    })
  })
})
