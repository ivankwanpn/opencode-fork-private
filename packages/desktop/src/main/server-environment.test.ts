import { describe, expect, test } from "bun:test"
import { createDesktopServerEnvironment, createSidecarEnvironment } from "./server-environment"

describe("desktop server environment", () => {
  test("does not invent a Desktop-private XDG state directory", () => {
    const environment = createDesktopServerEnvironment({ PATH: "C:\\Windows" })

    expect(environment.XDG_STATE_HOME).toBeUndefined()
    expect(environment.OPENCODE_CLIENT).toBe("desktop")
  })

  test("preserves an explicit shared XDG state directory and mirrors server logs to stderr", () => {
    const environment = createSidecarEnvironment(
      { XDG_STATE_HOME: "D:\\shared-state", DEBUG: "discard", KEEP: "value" },
      { packaged: true, platform: "win32" },
    )

    expect(environment.XDG_STATE_HOME).toBe("D:\\shared-state")
    expect(environment.OPENCODE_PRINT_LOGS).toBe("1")
    expect(environment.DEBUG).toBeUndefined()
    expect(environment.KEEP).toBe("value")
  })
})
