import { expect, type Page } from "@playwright/test"

export function trackPageErrors(page: Page) {
  const errors: string[] = []
  page.on("console", (message) => {
    if (message.type() !== "error") return
    if (message.text().startsWith("Failed to load resource")) return
    errors.push(message.text())
  })
  page.on("pageerror", (error) => errors.push(error.stack ?? error.message))
  page.on("response", (response) => {
    if (response.status() < 400) return
    errors.push(`${response.request().method()} ${response.status()} ${response.url()}`)
  })
  return errors
}

export function expectNoSmokeErrors(consoleErrors: string[], toastErrors: string[], forbiddenText: string[]) {
  expect({ consoleErrors, toastErrors, forbiddenText }).toEqual({
    consoleErrors: [],
    toastErrors: [],
    forbiddenText: [],
  })
}
