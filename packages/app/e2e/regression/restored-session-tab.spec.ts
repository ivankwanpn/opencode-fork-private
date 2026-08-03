import { expect, test, type Route } from "@playwright/test"
import { fixture } from "../performance/timeline/session-timeline-stress.fixture"
import {
  installStressSessionTabs,
  installTimelineSettings,
  mockStressTimeline,
  stressSessionHref,
} from "../performance/timeline/timeline-test-helpers"
import { holdIdleCallbacks, pendingIdleCallbacks } from "../utils/idle-callback"

test("renders persisted tabs without background messages and foregrounds a clicked tab", async ({ page }) => {
  const requests: string[] = []
  const sourceSession = fixture.sessions.find((session) => session.id === fixture.sourceID)
  const targetSession = fixture.sessions.find((session) => session.id === fixture.targetID)
  if (!sourceSession || !targetSession) throw new Error("Missing stress fixture sessions")
  await holdIdleCallbacks(page)
  await mockStressTimeline(page, {
    onMessages: (input) => {
      if (!input.before && input.phase === "start") requests.push(input.sessionID)
    },
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
  await installStressSessionTabs(page, {
    sessionIDs: [fixture.sourceID, fixture.targetID],
  })
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
  await expect(source.locator("[data-titlebar-tab-title]")).toHaveText(fixture.expected.sourceTitle)
  await expect(target.locator("[data-titlebar-tab-title]")).toHaveText(fixture.expected.targetTitle)
  const homePending = await pendingIdleCallbacks(page)
  expect(requests).toEqual([])
  expect(homePending).toBeGreaterThan(0)

  await target.click()
  await expect(page).toHaveURL(new RegExp(`/session/${fixture.targetID}$`))
  await expect.poll(() => requests).toContain(fixture.targetID)
  expect(requests.filter((id) => id === fixture.sourceID)).toHaveLength(0)
})

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    headers: { "access-control-allow-origin": "*" },
    body: JSON.stringify(body),
  })
}
