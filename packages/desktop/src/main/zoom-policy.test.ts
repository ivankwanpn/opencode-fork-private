import { describe, expect, test } from "bun:test"
import { decideZoomAction } from "./zoom-policy"

describe("decideZoomAction", () => {
  test("renderer owns the zoom change while pinch zoom is enabled, at any factor", () => {
    expect(decideZoomAction(true, 1)).toBe("renderer-owns")
    expect(decideZoomAction(true, 0.4)).toBe("renderer-owns")
    expect(decideZoomAction(true, 1.4)).toBe("renderer-owns")
    expect(decideZoomAction(true, 10)).toBe("renderer-owns")
  })

  test("ignores the gesture when pinch zoom is disabled and the factor is already 1", () => {
    expect(decideZoomAction(false, 1)).toBe("ignore")
  })

  test("resets to 1 when pinch zoom is disabled and the factor drifted", () => {
    expect(decideZoomAction(false, 1.2)).toBe("reset")
    expect(decideZoomAction(false, 0.6)).toBe("reset")
  })
})
