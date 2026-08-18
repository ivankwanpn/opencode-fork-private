import { afterEach, describe, expect, mock, test } from "bun:test"
import { createRoot } from "solid-js"
import { render } from "solid-js/web"
import type { PermissionV2Request } from "@opencode-ai/sdk/v2"
import { LanguageProvider } from "@/context/language"
import { PlatformProvider, type Platform } from "@/context/platform"
import { realLanguageModule, realPlatformModule } from "@/test-module-snapshots"
import { SessionPermissionDock } from "./session-permission-dock"

// bun's mock.module replacements are process-global and permanent: test files
// that run earlier in the suite (e.g. prompt-input/submit.test.ts) replace
// `@/context/language` and `@/context/platform` for every later importer.
// Restore the real modules (snapshotted by the preload before any test file
// ran) so this test renders through the real providers.
mock.module("@/context/language", () => realLanguageModule)
mock.module("@/context/platform", () => realPlatformModule)

const platform: Platform = {
  platform: "web",
  openLink: () => {},
  back: () => {},
  forward: () => {},
  restart: async () => {},
  notify: async () => {},
}

const request: PermissionV2Request = {
  id: "prm_1",
  sessionID: "ses_1",
  action: "execute:bash",
  resources: [],
  metadata: {},
  save: [],
}

describe("SessionPermissionDock", () => {
  let dispose: () => void

  afterEach(() => dispose?.())

  test("shows the raw permission action when no translation exists for it", () => {
    dispose = createRoot((disposeRoot) => {
      const cleanup = render(
        () => (
          <PlatformProvider value={platform}>
            <LanguageProvider>
              <SessionPermissionDock request={request} responding={false} onDecide={() => {}} />
            </LanguageProvider>
          </PlatformProvider>
        ),
        document.body,
      )
      return () => {
        cleanup()
        disposeRoot()
      }
    })

    const hint = document.querySelector('[data-slot="permission-hint"]')
    expect(hint?.textContent).toBe("execute:bash")
  })

  test("keeps the translated description when the action has a translation", () => {
    const translated = { ...request, action: "bash" }

    dispose = createRoot((disposeRoot) => {
      const cleanup = render(
        () => (
          <PlatformProvider value={platform}>
            <LanguageProvider>
              <SessionPermissionDock request={translated} responding={false} onDecide={() => {}} />
            </LanguageProvider>
          </PlatformProvider>
        ),
        document.body,
      )
      return () => {
        cleanup()
        disposeRoot()
      }
    })

    const hint = document.querySelector('[data-slot="permission-hint"]')
    expect(hint?.textContent).toBe("Run shell commands")
  })
})
