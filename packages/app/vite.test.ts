import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import viteConfig from "./vite"

interface ThemePreloadPlugin {
  name: string
  transformIndexHtml: (html: string) => string
}

const themePreload = (viteConfig as unknown as ThemePreloadPlugin[]).find(
  (plugin) => plugin.name === "opencode-desktop:theme-preload",
)

if (!themePreload) throw new Error("opencode-desktop:theme-preload plugin not found")

const inlineSource = readFileSync(new URL("./public/oc-theme-preload.js", import.meta.url), "utf8")
const inlineScript = `<script id="oc-theme-preload-script">${inlineSource}</script>`

describe("theme preload vite plugin", () => {
  test("inlines /oc-theme-preload.js", () => {
    const html = '<script id="oc-theme-preload-script" src="/oc-theme-preload.js"></script>'

    const out = themePreload.transformIndexHtml(html)

    expect(out).toContain(inlineScript)
    expect(out).not.toContain('src="/oc-theme-preload.js"')
  })

  test("inlines ./oc-theme-preload.js", () => {
    const html = '<script id="oc-theme-preload-script" src="./oc-theme-preload.js"></script>'

    const out = themePreload.transformIndexHtml(html)

    expect(out).toContain(inlineScript)
    expect(out).not.toContain('src="./oc-theme-preload.js"')
  })
})
