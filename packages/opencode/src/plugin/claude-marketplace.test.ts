import fsNode from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { ClaudeMarketplaceManager, type MarketplacePaths } from "./claude-marketplace"

let temporaryDirectory: string

beforeEach(async () => {
  temporaryDirectory = await fsNode.mkdtemp(path.join(os.tmpdir(), "opencode-marketplace-test-"))
})

afterEach(async () => {
  await fsNode.rm(temporaryDirectory, { recursive: true, force: true })
})

function testPaths(): MarketplacePaths {
  return {
    stateFile: path.join(temporaryDirectory, "state", "marketplaces.json"),
    marketplaceDirectory: path.join(temporaryDirectory, "data", "marketplaces"),
    pluginDirectory: path.join(temporaryDirectory, "data", "plugins"),
    generatedSkillDirectory: path.join(temporaryDirectory, "config", "skills", "claude"),
    generatedCommandDirectory: path.join(temporaryDirectory, "config", "commands", "claude"),
  }
}

async function writeMarketplace(root: string, source: string) {
  await fsNode.mkdir(path.join(root, ".claude-plugin"), { recursive: true })
  await fsNode.mkdir(path.join(root, "plugins", "demo", ".claude-plugin"), { recursive: true })
  await fsNode.mkdir(path.join(root, "plugins", "demo", "skills", "demo"), { recursive: true })
  await fsNode.mkdir(path.join(root, "plugins", "demo", "commands"), { recursive: true })
  await fsNode.writeFile(
    path.join(root, ".claude-plugin", "marketplace.json"),
    JSON.stringify({
      name: "local-marketplace",
      plugins: [{ name: "demo", description: "Demo plugin", version: "1.0.0", source }],
    }),
  )
  await fsNode.writeFile(
    path.join(root, "plugins", "demo", ".claude-plugin", "plugin.json"),
    JSON.stringify({ name: "demo" }),
  )
  await fsNode.writeFile(
    path.join(root, "plugins", "demo", "skills", "demo", "SKILL.md"),
    "---\nname: demo\ndescription: demo skill\n---\nUse the demo skill.",
  )
  await fsNode.writeFile(
    path.join(root, "plugins", "demo", "commands", "demo.md"),
    "---\ndescription: demo command\n---\nRun the demo command.",
  )
  await fsNode.writeFile(
    path.join(root, "plugins", "demo", ".mcp.json"),
    JSON.stringify({ mcpServers: { demo: { command: "demo-server", args: ["--stdio"], env: { DEMO: "1" } } } }),
  )
}

describe("ClaudeMarketplaceManager", () => {
  test("installs and materializes a relative Claude plugin", async () => {
    const marketplace = path.join(temporaryDirectory, "source")
    await writeMarketplace(marketplace, "./plugins/demo")
    const manager = new ClaudeMarketplaceManager(testPaths())

    const added = await manager.addMarketplace(marketplace)
    expect(added.marketplaces).toHaveLength(1)
    expect(added.plugins[0]?.capabilities).toEqual(["skills", "commands", "mcp"])

    const installed = await manager.install("demo@local-marketplace")
    expect(installed.plugins[0]?.installed).toBe(true)
    expect(installed.plugins[0]?.enabled).toBe(true)
    expect(
      await fsNode.stat(path.join(testPaths().generatedSkillDirectory, "local-marketplace__demo", "demo", "SKILL.md")),
    ).toBeTruthy()
    expect(
      await fsNode.stat(path.join(testPaths().generatedCommandDirectory, "local-marketplace__demo", "demo.md")),
    ).toBeTruthy()
    expect((await manager.enabledMcpServers())["claude:local-marketplace:demo:demo"]).toEqual({
      type: "local",
      command: ["demo-server", "--stdio"],
      environment: { DEMO: "1" },
    })

    await manager.disable("demo@local-marketplace")
    await expect(
      fsNode.stat(path.join(testPaths().generatedSkillDirectory, "local-marketplace__demo")),
    ).rejects.toThrow()
    await manager.uninstall("demo@local-marketplace")
    expect((await manager.list()).plugins[0]?.installed).toBe(false)
  })

  test("rejects a relative plugin source outside the marketplace", async () => {
    const marketplace = path.join(temporaryDirectory, "source")
    await writeMarketplace(marketplace, "../outside")
    const manager = new ClaudeMarketplaceManager(testPaths())

    await manager.addMarketplace(marketplace)
    await expect(manager.install("demo@local-marketplace")).rejects.toThrow("escapes marketplace directory")
  })
})
