import { describe, expect, test } from "bun:test"
import { isZoomAction } from "./menu-zoom"

describe("isZoomAction", () => {
  test("recognizes the three zoom actions", () => {
    expect(isZoomAction("view.resetZoom")).toBe(true)
    expect(isZoomAction("view.zoomIn")).toBe(true)
    expect(isZoomAction("view.zoomOut")).toBe(true)
  })

  test("rejects other action+role entries and undefined", () => {
    expect(isZoomAction("view.reload")).toBe(false)
    expect(isZoomAction("view.toggleDevTools")).toBe(false)
    expect(isZoomAction("view.toggleFullscreen")).toBe(false)
    expect(isZoomAction("edit.undo")).toBe(false)
    expect(isZoomAction(undefined)).toBe(false)
  })
})
