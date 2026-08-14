// Snapshots of the real `@/context/language` and `@/context/platform` modules,
// captured at preload time (happydom.ts imports this module before any test
// file runs). bun's `mock.module` replacements are process-global and
// permanent: test files such as `prompt-input/submit.test.ts` replace these
// modules for every later importer, and bun offers no way to un-mock. Tests
// that need the real providers (e.g. session-permission-dock) re-register
// these snapshots with `mock.module` to restore the real modules.
// Correction: the star imports below are a deliberate, documented exception
// to the AGENTS.md no-star-imports rule — a namespace spread is the only
// faithful way to restore a module bun's mock.module replaced (bun 1.3.14
// has no un-mock API), and a named enumeration would silently drop future
// exports from the snapshot.
import * as language from "@/context/language" // AGENTS.md exception: snapshot must carry every export faithfully
import * as platform from "@/context/platform" // AGENTS.md exception: snapshot must carry every export faithfully

export const realLanguageModule = { ...language }
export const realPlatformModule = { ...platform }
