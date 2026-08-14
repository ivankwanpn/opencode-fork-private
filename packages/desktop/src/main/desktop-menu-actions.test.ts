import { describe, expect, test } from "bun:test"
import { runDesktopMenuAction, type DesktopMenuWindow } from "./desktop-menu-actions"

function setup() {
  const sent: Array<[string, unknown]> = []
  const win: DesktopMenuWindow = {
    close() {},
    minimize() {},
    isMaximized() {
      return false
    },
    unmaximize() {},
    maximize() {},
    reload() {},
    webContents: {
      send(channel: string, ...args: unknown[]) {
        sent.push([channel, args[0]])
      },
      toggleDevTools() {},
      undo() {},
      redo() {},
      cut() {},
      copy() {},
      paste() {},
      delete() {},
      selectAll() {},
    },
    setFullScreen() {},
    isFullScreen() {
      return false
    },
  }
  return { win, sent }
}

describe("desktop menu actions", () => {
  test("forwards reset zoom to the renderer", () => {
    const { win, sent } = setup()
    runDesktopMenuAction(win, "view.resetZoom")
    expect(sent).toEqual([["zoom-command", "reset"]])
  })

  test("forwards zoom in to the renderer", () => {
    const { win, sent } = setup()
    runDesktopMenuAction(win, "view.zoomIn")
    expect(sent).toEqual([["zoom-command", "in"]])
  })

  test("forwards zoom out to the renderer", () => {
    const { win, sent } = setup()
    runDesktopMenuAction(win, "view.zoomOut")
    expect(sent).toEqual([["zoom-command", "out"]])
  })
})
