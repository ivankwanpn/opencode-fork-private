import type { Page } from "@playwright/test"

export async function holdIdleCallbacks(page: Page) {
  await page.addInitScript(() => {
    const callbacks = new Map<number, IdleRequestCallback>()
    let next = 0
    window.requestIdleCallback = (callback) => {
      const id = ++next
      callbacks.set(id, callback)
      return id
    }
    window.cancelIdleCallback = (id) => callbacks.delete(id)
    Object.assign(window, {
      __releaseIdleCallback() {
        const entry = callbacks.entries().next().value as [number, IdleRequestCallback] | undefined
        if (!entry) return false
        callbacks.delete(entry[0])
        entry[1]({ didTimeout: false, timeRemaining: () => 50 })
        return true
      },
      __pendingIdleCallbacks() {
        return callbacks.size
      },
    })
  })
}

export function releaseIdleCallback(page: Page) {
  return page.evaluate(() =>
    (window as Window & { __releaseIdleCallback(): boolean }).__releaseIdleCallback(),
  )
}

export function pendingIdleCallbacks(page: Page) {
  return page.evaluate(() =>
    (window as Window & { __pendingIdleCallbacks(): number }).__pendingIdleCallbacks(),
  )
}
