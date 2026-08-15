import fsNode from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { parse } from "jsonc-parser"
import { DirectExtensionManager, type DirectExtensionPaths } from "./direct-extension"

let temporaryDirectory: string

beforeEach(async () => {
  temporaryDirectory = await fsNode.mkdtemp(path.join(os.tmpdir(), "opencode-direct-extension-test-"))
})

afterEach(async () => {
  await fsNode.rm(temporaryDirectory, { recursive: true, force: true })
})

function paths(): DirectExtensionPaths {
  return {
    stateFile: path.join(temporaryDirectory, "state", "extensions.json"),
    configDirectory: path.join(temporaryDirectory, "config"),
  }
}

async function plugin(capabilities: string[] = []) {
  const root = path.join(temporaryDirectory, "plugin")
  await fsNode.mkdir(root, { recursive: true })
  await fsNode.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({
      name: "direct-demo",
      version: "1.2.3",
      description: "Direct demo",
      main: "./server.js",
      exports: { "./server": "./server.js", "./tui": "./tui.js" },
      opencode: { api: "v2", capabilities },
    }),
  )
  await fsNode.writeFile(path.join(root, "server.js"), "export default {}")
  await fsNode.writeFile(path.join(root, "tui.js"), "export default {}")
  return root
}

async function config(name: "opencode" | "tui") {
  return parse(await fsNode.readFile(path.join(paths().configDirectory, `${name}.json`), "utf8")) as {
    plugin?: unknown[]
    plugins?: unknown[]
    mcp?: { servers?: Record<string, unknown> }
  }
}

describe("DirectExtensionManager", () => {
  test("inspects capabilities and owns plugin lifecycle entries", async () => {
    const source = await plugin(["catalog.transform", "tool.exposure"])
    const manager = new DirectExtensionManager(paths())

    const inspection = await manager.inspectPlugin(source)
    expect(inspection).toMatchObject({
      source,
      name: "direct-demo",
      version: "1.2.3",
      api: "v2",
      targets: ["server", "tui"],
      requestedCapabilities: [
        { name: "catalog.transform", tier: "runtime" },
        { name: "tool.exposure", tier: "trusted-runtime" },
      ],
    })

    await manager.installDirectPlugin(source, true, ["catalog.transform", "tool.exposure"])
    expect((await manager.list()).directPlugins[0]).toMatchObject({
      id: "direct:direct-demo",
      enabled: true,
      approvedCapabilities: ["catalog.transform", "tool.exposure"],
    })
    expect((await config("opencode")).plugins).toEqual([source])
    expect((await config("tui")).plugin).toEqual([source])

    await manager.disableDirectPlugin("direct:direct-demo")
    expect((await manager.list()).directPlugins[0]?.enabled).toBe(false)
    expect((await config("opencode")).plugins).toEqual([])
    expect((await config("tui")).plugin).toEqual([])

    await manager.enableDirectPlugin("direct:direct-demo")
    expect((await manager.list()).directPlugins[0]?.enabled).toBe(true)
    expect((await config("opencode")).plugins).toEqual([source])
    expect((await config("tui")).plugin).toEqual([source])

    await manager.uninstallDirectPlugin("direct:direct-demo")
    expect((await manager.list()).directPlugins).toEqual([])
    expect((await config("opencode")).plugins).toEqual([])
    expect((await config("tui")).plugin).toEqual([])
  })

  test("requires every declared capability approval", async () => {
    const source = await plugin(["session.history.read"])
    const manager = new DirectExtensionManager(paths())

    await expect(manager.installDirectPlugin(source, true, [])).rejects.toThrow("session.history.read")
    expect((await manager.list()).directPlugins).toEqual([])
  })

  test("requires explicit trust even when the manifest requests no capabilities", async () => {
    const source = await plugin()
    const manager = new DirectExtensionManager(paths())

    await expect(manager.installDirectPlugin(source, false, [])).rejects.toThrow("requires explicit trust")
    expect((await manager.list()).directPlugins).toEqual([])
  })

  test("requires direct server plugins to declare the V2 API", async () => {
    const source = await plugin()
    const file = path.join(source, "package.json")
    const manifest = JSON.parse(await fsNode.readFile(file, "utf8")) as { opencode: { api?: string } }
    delete manifest.opencode.api
    await fsNode.writeFile(file, JSON.stringify(manifest))

    await expect(new DirectExtensionManager(paths()).inspectPlugin(source)).rejects.toThrow(
      "must declare opencode.api as v2",
    )
  })

  test("keeps managed V2 config separate from an existing V1 config", async () => {
    const source = await plugin()
    await fsNode.mkdir(paths().configDirectory, { recursive: true })
    await fsNode.writeFile(path.join(paths().configDirectory, "opencode.json"), JSON.stringify({ plugin: ["manual"] }))
    const manager = new DirectExtensionManager(paths())

    await manager.installDirectPlugin(source, true, [])
    expect(parse(await fsNode.readFile(path.join(paths().configDirectory, "opencode.jsonc"), "utf8"))).toMatchObject({
      plugins: [source],
    })
    expect(parse(await fsNode.readFile(path.join(paths().configDirectory, "opencode.json"), "utf8"))).toEqual({
      plugin: ["manual"],
    })
  })

  test("does not take ownership of a manually configured plugin", async () => {
    const source = await plugin()
    await fsNode.mkdir(paths().configDirectory, { recursive: true })
    await fsNode.writeFile(
      path.join(paths().configDirectory, "opencode.json"),
      `{\n  // keep manual ownership\n  "plugin": [${JSON.stringify(source)}]\n}`,
    )
    const manager = new DirectExtensionManager(paths())

    await expect(manager.installDirectPlugin(source, true, [])).rejects.toThrow("outside the direct extension manager")
    expect(await fsNode.readFile(path.join(paths().configDirectory, "opencode.json"), "utf8")).toContain(
      "// keep manual ownership",
    )
    expect((await manager.list()).directPlugins).toEqual([])
  })

  test("rolls back an earlier target when a later config patch fails", async () => {
    const source = await plugin()
    await fsNode.mkdir(paths().configDirectory, { recursive: true })
    await fsNode.writeFile(path.join(paths().configDirectory, "tui.json"), "{")
    const manager = new DirectExtensionManager(paths())

    await expect(manager.installDirectPlugin(source, true, [])).rejects.toThrow("Could not update plugin config")
    expect((await config("opencode")).plugins).toEqual([])
    expect((await manager.list()).directPlugins).toEqual([])
  })

  test("manages local and remote MCP config without removing unrelated JSONC", async () => {
    await fsNode.mkdir(paths().configDirectory, { recursive: true })
    await fsNode.writeFile(
      path.join(paths().configDirectory, "opencode.json"),
      `{
  // keep this setting
  "model": "provider/model"
}`,
    )
    const manager = new DirectExtensionManager(paths())

    await manager.installMcp("local-demo", {
      type: "local",
      command: ["bun", "run", "server.ts"],
      environment: { MODE: "test" },
    })
    await manager.installMcp("remote-demo", {
      type: "remote",
      url: "https://example.com/mcp",
      headers: { Authorization: "Bearer test" },
    })
    expect((await manager.list()).mcpServers).toEqual([
      { name: "local-demo", type: "local", enabled: true },
      { name: "remote-demo", type: "remote", enabled: true },
    ])

    await manager.disableMcp("local-demo")
    expect((await config("opencode")).mcp?.servers?.["local-demo"]).toMatchObject({ disabled: true })
    await manager.enableMcp("local-demo")
    expect((await config("opencode")).mcp?.servers?.["local-demo"]).toMatchObject({ disabled: false })
    await manager.removeMcp("local-demo")
    await manager.removeMcp("remote-demo")

    const text = await fsNode.readFile(path.join(paths().configDirectory, "opencode.json"), "utf8")
    expect(text).toContain("// keep this setting")
    expect((await config("opencode")).mcp?.servers).toEqual({})
  })

  test("rejects an MCP name already configured outside the manager", async () => {
    await fsNode.mkdir(paths().configDirectory, { recursive: true })
    await fsNode.writeFile(
      path.join(paths().configDirectory, "opencode.json"),
      JSON.stringify({ mcp: { servers: { existing: { type: "remote", url: "https://example.com/mcp" } } } }),
    )
    const manager = new DirectExtensionManager(paths())

    await expect(
      manager.installMcp("existing", { type: "remote", url: "https://other.example.com/mcp" }),
    ).rejects.toThrow("already configured")
    expect((await manager.list()).mcpServers).toEqual([])
  })
})
