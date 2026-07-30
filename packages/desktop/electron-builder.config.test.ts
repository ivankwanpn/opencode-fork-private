import { expect, test } from "bun:test"
import type { Configuration } from "electron-builder"

const legacyDesktopEntry = "resources/linux/opencode-desktop.desktop"

test("uses one production desktop identity", async () => {
  const module = await import("./electron-builder.config.ts?identity")
  const config = module.default as Configuration

  expect(config.appId).toBe("ai.opencode.desktop")
  expect(config.extraMetadata?.desktopName).toBe("ai.opencode.desktop.desktop")
  expect(config.linux?.executableName).toBe("ai.opencode.desktop")
  expect(config.linux?.desktop?.entry?.StartupWMClass).toBe("ai.opencode.desktop")
})

test("does not emit updater metadata", async () => {
  const module = await import("./electron-builder.config.ts?updater")
  const config = module.default as Configuration

  expect(config.publish).toBeNull()
  expect(config.nsis?.differentialPackage).toBe(false)
  expect(config.win?.verifyUpdateCodeSignature).toBeUndefined()
})

test("keeps a hidden prod launcher for old Linux pins", async () => {
  const module = await import("./electron-builder.config.ts?compat")
  const config = module.default as Configuration

  expect(config.deb?.fpm?.[0]?.replaceAll("\\", "/")).toEndWith(
    `${legacyDesktopEntry}=/usr/share/applications/opencode-desktop.desktop`,
  )
  expect(config.rpm?.fpm?.[0]?.replaceAll("\\", "/")).toEndWith(
    `${legacyDesktopEntry}=/usr/share/applications/opencode-desktop.desktop`,
  )

  const desktop = await Bun.file(legacyDesktopEntry).text()
  expect(desktop).toContain("Exec=/opt/OpenCode/ai.opencode.desktop %U")
  expect(desktop).toContain("Icon=ai.opencode.desktop")
  expect(desktop).toContain("StartupWMClass=ai.opencode.desktop")
  expect(desktop).toContain("NoDisplay=true")
})
