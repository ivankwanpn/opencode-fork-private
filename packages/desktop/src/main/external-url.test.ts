import { describe, expect, test } from "bun:test"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { resolveExternalURL, resolveLocalFilePath, wireNavigationPolicy, type MinimalWebContents } from "./external-url"

describe("external URLs", () => {
  test("opens web URLs externally", () => {
    expect(resolveExternalURL("https://example.com/a?b=c")).toBe("https://example.com/a?b=c")
    expect(resolveExternalURL("http://example.com")).toBe("http://example.com/")
  })

  test("opens mail links externally", () => {
    expect(resolveExternalURL("mailto:hello@opencode.ai")).toBe("mailto:hello@opencode.ai")
  })

  test("rejects file URLs and unsupported protocols", () => {
    expect(resolveExternalURL("file:///tmp/index.html")).toBeUndefined()
    expect(resolveExternalURL("javascript:alert(1)")).toBeUndefined()
    expect(resolveExternalURL("data:text/html,hello")).toBeUndefined()
    expect(resolveExternalURL("not a url")).toBeUndefined()
  })

  test("resolves only local file URLs", () => {
    const path = resolve("example.html")
    expect(resolveLocalFilePath(pathToFileURL(path).href)).toBe(path)
    expect(resolveLocalFilePath("file://example.com/share/index.html")).toBeUndefined()
    expect(resolveLocalFilePath("https://example.com/index.html")).toBeUndefined()
  })
})

describe("navigation policy", () => {
  test("denies every popup and routes only external navigations", () => {
    const opened: string[] = []
    let openHandler: ((details: { url: string }) => { action: "deny" }) | undefined
    let navListener: ((event: { preventDefault(): void }, url: string) => void) | undefined
    const webContents: MinimalWebContents = {
      setWindowOpenHandler: (handler) => {
        openHandler = handler
      },
      on: (event, listener) => {
        if (event === "will-navigate") navListener = listener
      },
    }
    const isRendererURL = (value?: string) => value === "oc://renderer/index.html"
    wireNavigationPolicy({ webContents }, (url) => opened.push(url), isRendererURL)

    expect(openHandler!({ url: "oc://renderer/index.html" })).toEqual({ action: "deny" })
    expect(opened).toEqual([])

    openHandler!({ url: "https://example.com" })
    expect(opened).toEqual(["https://example.com"])

    let prevented = false
    navListener!({ preventDefault: () => (prevented = true) }, "https://example.com")
    expect(prevented).toBe(true)
    expect(opened).toHaveLength(2)

    prevented = false
    navListener!({ preventDefault: () => (prevented = true) }, "oc://renderer/index.html")
    expect(prevented).toBe(false)
  })
})
