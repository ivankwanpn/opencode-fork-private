import { benchmark, expect } from "../benchmark"
import type { Route } from "@playwright/test"
import { expectSessionTitle } from "../../utils/waits"
import { holdIdleCallbacks, pendingIdleCallbacks, releaseIdleCallback } from "../../utils/idle-callback"
import { fixture } from "./session-timeline-stress.fixture"
import {
  collectCachedRepaintTrace,
  compressCachedRepaintTrace,
  installCachedRepaintProbe,
  waitForCachedRepaintWindow,
} from "./session-tab-repaint-probe"
import { waitForStableTimeline } from "./session-tab-switch-probe"
import {
  installStressSessionTabs,
  installTimelineSettings,
  mockStressTimeline,
  stressSessionHref,
} from "./timeline-test-helpers"

benchmark("samples cached session repaint after the click", async ({ page, report }) => {
  benchmark.setTimeout(120_000)
  await mockStressTimeline(page)
  await installStressSessionTabs(page)
  await installTimelineSettings(page)
  await page.goto(stressSessionHref(fixture.targetID))
  await expectSessionTitle(page, fixture.expected.targetTitle)
  await waitForStableTimeline(page, fixture.expected.targetMessageIDs.at(-1)!)
  await page
    .locator(`[data-slot="titlebar-tabs"] a[href="${stressSessionHref(fixture.sourceID)}"]`)
    .first()
    .click()
  await expectSessionTitle(page, fixture.expected.sourceTitle)
  await waitForStableTimeline(page, fixture.expected.sourceMessageIDs.at(-1)!)

  await installCachedRepaintProbe(page, {
    targetHref: stressSessionHref(fixture.targetID),
    destination: fixture.messages[fixture.targetID].map((message) => message.info.id),
    source: fixture.messages[fixture.sourceID].map((message) => message.info.id),
    last: fixture.expected.targetMessageIDs.at(-1)!,
    windowMs: 1_000,
  })

  await page
    .locator(`[data-slot="titlebar-tabs"] a[href="${stressSessionHref(fixture.targetID)}"]`)
    .first()
    .click()
  await Promise.all([expectSessionTitle(page, fixture.expected.targetTitle), waitForCachedRepaintWindow(page, 1_000)])
  const result = await collectCachedRepaintTrace(page)
  report(compressCachedRepaintTrace(result))
  expect(result.samples.length).toBeGreaterThan(0)
})

benchmark("stages restored session tabs after paint with one request in flight", async ({ page, report }) => {
  const started: string[] = []
  const completed: string[] = []
  let activeMessages = 0
  let maxConcurrentMessages = 0
  let releaseFirstResponse = () => {}
  const firstResponse = new Promise<void>((resolve) => {
    releaseFirstResponse = resolve
  })
  let firstResponseSessionID: string | undefined
  const expectedRestoreOrder = [fixture.sourceID, fixture.targetID, fixture.childID]

  const sourceSession = fixture.sessions.find((session) => session.id === fixture.sourceID)
  const targetSession = fixture.sessions.find((session) => session.id === fixture.targetID)
  const childSession = fixture.sessions.find((session) => session.id === fixture.childID)
  if (!sourceSession || !targetSession || !childSession) throw new Error("Missing stress fixture sessions")

  await holdIdleCallbacks(page)
  await mockStressTimeline(page, {
    onMessages: (input) => {
      if (input.before) return
      if (input.phase === "start") {
        started.push(input.sessionID)
        activeMessages += 1
        maxConcurrentMessages = Math.max(maxConcurrentMessages, activeMessages)
        return
      }
      completed.push(input.sessionID)
      activeMessages -= 1
    },
    beforeMessagesResponse: async (input) => {
      if (input.before || firstResponseSessionID) return
      firstResponseSessionID = input.sessionID
      await firstResponse
    },
  })
  await installStressSessionTabs(page, {
    sessionIDs: [fixture.sourceID, fixture.targetID, fixture.childID],
  })
  await page.route("**/session", (route) => {
    if (new URL(route.request().url()).pathname !== "/session") return route.fallback()
    return json(route, [])
  })
  await page.route("**/api/session", (route) => {
    if (new URL(route.request().url()).pathname !== "/api/session") return route.fallback()
    return json(route, { data: [], cursor: {} })
  })
  await page.route(`**/session/${fixture.sourceID}`, (route) => json(route, sourceSession))
  await page.route(`**/session/${fixture.targetID}`, (route) => json(route, targetSession))
  await page.route(`**/session/${fixture.childID}`, (route) => json(route, childSession))
  await page.addInitScript(() => {
    const directory = "C:/OpenCode/UnrelatedHomeProject"
    localStorage.setItem(
      "opencode.global.dat:server",
      JSON.stringify({
        projects: { local: [{ worktree: directory, expanded: true }] },
        lastProject: { local: directory },
      }),
    )
    localStorage.setItem(
      "opencode.global.dat:layout",
      JSON.stringify({ home: { selection: { server: "local", directory } } }),
    )
  })
  await installTimelineSettings(page)
  await page.goto("/")
  await expect(page).toHaveURL("/")

  const source = page.locator(
    `[data-titlebar-tab-slot]:has(a[href="${stressSessionHref(fixture.sourceID)}"])`,
  )
  const target = page.locator(
    `[data-titlebar-tab-slot]:has(a[href="${stressSessionHref(fixture.targetID)}"])`,
  )
  const child = page.locator(
    `[data-titlebar-tab-slot]:has(a[href="${stressSessionHref(fixture.childID)}"])`,
  )
  await expect(source.locator("[data-titlebar-tab-title]")).toHaveText(fixture.expected.sourceTitle)
  await expect(target.locator("[data-titlebar-tab-title]")).toHaveText(fixture.expected.targetTitle)
  await expect(child.locator("[data-titlebar-tab-title]")).toHaveText(fixture.expected.childTitle)

  const requestsBeforeIdle = started.length
  expect(requestsBeforeIdle).toBe(0)
  await expect.poll(() => pendingIdleCallbacks(page)).toBeGreaterThan(0)

  expect(await releaseIdleCallback(page)).toBe(true)
  await expect.poll(() => started).toEqual([expectedRestoreOrder[0]])
  expect(await releaseIdleCallback(page)).toBe(false)
  expect(started).toEqual([expectedRestoreOrder[0]])

  releaseFirstResponse()
  await expect.poll(() => completed).toEqual([expectedRestoreOrder[0]])

  await expect.poll(() => pendingIdleCallbacks(page)).toBeGreaterThan(0)
  expect(await releaseIdleCallback(page)).toBe(true)
  await expect.poll(() => started).toEqual(expectedRestoreOrder.slice(0, 2))
  await expect.poll(() => completed).toEqual(expectedRestoreOrder.slice(0, 2))

  await expect.poll(() => pendingIdleCallbacks(page)).toBeGreaterThan(0)
  expect(await releaseIdleCallback(page)).toBe(true)
  await expect.poll(() => started).toEqual(expectedRestoreOrder)
  await expect.poll(() => completed).toEqual(expectedRestoreOrder)

  expect(started).toHaveLength(3)
  expect(completed).toHaveLength(3)
  expect(maxConcurrentMessages).toBe(1)
  report({
    requestCount: started.length,
    maxConcurrentMessages,
    requestsBeforeIdle,
  })
})

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    headers: { "access-control-allow-origin": "*" },
    body: JSON.stringify(body),
  })
}
