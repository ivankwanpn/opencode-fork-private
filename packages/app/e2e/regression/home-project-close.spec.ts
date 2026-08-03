import { expect, test } from "@playwright/test"
import { fixture, pageMessages } from "../performance/timeline/session-timeline-stress.fixture"
import { mockOpenCodeServer } from "../utils/mock-server"

test("closes a missing project without a stale read or persistence rollback", async ({ page }) => {
  const directory = "D:\\opencode-missing-project-e2e"
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))

  await mockOpenCodeServer(page, {
    project: fixture.project,
    provider: fixture.provider,
    directory: fixture.directory,
    sessions: [],
    pageMessages,
  })

  await page.addInitScript((missing) => {
    if (!localStorage.getItem("settings.v3"))
      localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
    if (!localStorage.getItem("opencode.global.dat:server"))
      localStorage.setItem(
        "opencode.global.dat:server",
        JSON.stringify({
          projects: { local: [{ worktree: missing, expanded: true }] },
          lastProject: { local: missing },
        }),
      )
    if (!localStorage.getItem("opencode.global.dat:layout"))
      localStorage.setItem(
        "opencode.global.dat:layout",
        JSON.stringify({ home: { selection: { server: "local", directory: missing } } }),
      )
  }, directory)

  await page.goto("/")

  const row = page.locator('[data-component="home-project-row"]', { hasText: "opencode-missing-project-e2e" })
  await expect(row).toBeVisible()
  await row.locator("xpath=..").locator('[data-action="home-project-menu"]').click()
  await page.getByRole("menuitem", { name: /close/i }).click()

  await expect(row).toHaveCount(0)
  expect(errors.filter((message) => message.includes("Stale read"))).toEqual([])

  await expect
    .poll(() =>
      page.evaluate(() => {
        const state = JSON.parse(localStorage.getItem("opencode.global.dat:server") ?? "{}")
        return state.projects?.local ?? []
      }),
    )
    .toEqual([])

  await page.reload()
  await expect(page.locator('[data-component="home-project-row"]', { hasText: "opencode-missing-project-e2e" })).toHaveCount(0)
})
