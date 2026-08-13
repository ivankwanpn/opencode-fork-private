import { fileURLToPath } from "node:url"

export function resolveExternalURL(value: string) {
  if (!URL.canParse(value)) return undefined
  const url = new URL(value)
  if (url.protocol === "http:" || url.protocol === "https:" || url.protocol === "mailto:") return url.href
  return undefined
}

export function resolveLocalFilePath(value: string) {
  if (!URL.canParse(value)) return undefined
  const url = new URL(value)
  if (url.protocol !== "file:" || url.hostname) return undefined
  try {
    return fileURLToPath(url)
  } catch {
    return undefined
  }
}

export interface MinimalWebContents {
  setWindowOpenHandler(handler: (details: { url: string }) => { action: "deny" }): void
  on(event: "will-navigate", listener: (event: { preventDefault(): void }, url: string) => void): void
}

export function wireNavigationPolicy(
  win: { webContents: MinimalWebContents },
  openExternal: (url: string) => void,
  isRendererURL: (value?: string) => boolean,
) {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!isRendererURL(url)) openExternal(url)
    return { action: "deny" }
  })
  win.webContents.on("will-navigate", (event, url) => {
    if (isRendererURL(url)) return
    event.preventDefault()
    openExternal(url)
  })
}
