// Snapshots of the real `@/context/language` and `@/context/platform` modules,
// captured at preload time (happydom.ts imports this module before any test
// file runs). bun's `mock.module` replacements are process-global and
// permanent: test files such as `prompt-input/submit.test.ts` replace these
// modules for every later importer, and bun offers no way to un-mock. Tests
// that need the real providers (e.g. session-permission-dock) re-register
// these snapshots with `mock.module` to restore the real modules.
import * as language from "@/context/language"
import * as platform from "@/context/platform"

export const realLanguageModule = { ...language }
export const realPlatformModule = { ...platform }
