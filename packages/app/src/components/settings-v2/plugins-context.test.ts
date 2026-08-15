import { describe, expect, test } from "bun:test"
import { ServerConnection } from "@/context/server"

describe("SettingsPluginsV2 context boundary", () => {
  test("keeps the shared server connection helpers intact", () => {
    expect(
      ServerConnection.local({ type: "sidecar", variant: "base", http: { url: "http://localhost:4096" } }),
    ).toBe(true)
  })

  test("runs the server-scoped settings regression in an isolated Bun process", async () => {
    await runSmoke("./src/components/settings-v2/plugins-context.smoke.tsx")
  })

  test("runs the first-load rendering regression in an isolated Bun process", async () => {
    await runSmoke("./src/components/settings-v2/plugins-loading.smoke.tsx")
  })
})

async function runSmoke(file: string) {
  const child = Bun.spawn(
    [process.execPath, "test", "--conditions=browser", "--preload", "./happydom.ts", file],
    { cwd: process.cwd(), stderr: "pipe" },
  )
  const exitCode = await child.exited
  if (exitCode === 0) return
  throw new Error(await new Response(child.stderr).text())
}
