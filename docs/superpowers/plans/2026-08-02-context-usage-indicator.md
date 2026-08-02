# Composer Context Usage Indicator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Move the session context usage control from the message header into both prompt composers and present the existing context usage as a compact percentage plus used/limit token summary.

**Architecture:** Keep getSessionContext as the only source of context totals and model limits. Extend the existing SessionContextUsage component with a composer presentation, render it in the legacy app prompt and the V2 prompt footer, and leave the context details panel and its side-panel tab indicator unchanged. Pass the V2 usage control into the generic session-ui prompt through an optional JSX footer slot so session-ui does not depend on app context or token accounting.

**Tech Stack:** SolidJS, TypeScript, Bun tests, Intl.NumberFormat compact notation, app i18n dictionaries, @opencode-ai/session-ui V2 prompt component, Tailwind utility classes.

## Global Constraints

- The existing context details view stays in its current location with its current contents and navigation behavior.
- Apply the composer presentation to both the legacy composer and the new-layout/V2 composer.
- Reuse getSessionContext; do not add a server request, token accounting algorithm, model-limit API, or compaction change.
- Move only the header-level usage button identified by the supplied screenshot.
- Keep the context-tab indicator inside the side-panel tab label unchanged.
- The visible control must remain a real accessible button, clickable to open the existing context tab, with the existing cost/usage/token tooltip preserved.
- Work only on branch 999.0.4 and do not stage or overwrite the pre-existing working-tree change in packages/sdk/openapi.json.
- Run tests from package directories, never from the repository root.

---

### Task 1: Add locale-aware compact token formatting

**Files:**
- Modify: packages/app/src/components/session/session-context-format.ts
- Create: packages/app/src/components/session/session-context-format.test.ts

**Interfaces:**
- Consumes: the existing createSessionContextFormatter(locale: string) used by session-context-tab.tsx.
- Produces: formatter.compact(value: number | null | undefined): string, returning an em dash for missing values and an Intl.NumberFormat compact representation for numeric values.

- [ ] **Step 1: Write the failing formatter tests**

Add tests that establish the exact edge behavior:

~~~ts
import { describe, expect, test } from "bun:test"
import { createSessionContextFormatter } from "./session-context-format"

describe("createSessionContextFormatter", () => {
  test("formats token counts compactly for an English locale", () => {
    const formatter = createSessionContextFormatter("en-US")

    expect(formatter.compact(31_597)).toBe("31.6K")
    expect(formatter.compact(1_000_000)).toBe("1M")
  })

  test("uses the existing missing-value marker", () => {
    const formatter = createSessionContextFormatter("en-US")

    expect(formatter.compact(undefined)).toBe("—")
    expect(formatter.compact(null)).toBe("—")
  })
})
~~~

- [ ] **Step 2: Run the new test and verify it fails**

Run from packages/app:

~~~bash
bun test --preload ./happydom.ts ./src/components/session/session-context-format.test.ts
~~~

Expected: FAIL because formatter.compact is not defined.

- [ ] **Step 3: Implement the minimal formatter method**

Create one compact formatter inside createSessionContextFormatter:

~~~ts
const compact = new Intl.NumberFormat(locale, {
  notation: "compact",
  maximumFractionDigits: 1,
})
~~~

Add compact(value) alongside the existing number, percent, and time methods.
Return "—" for undefined and null; otherwise return compact.format(value). Do
not change the existing methods used by the context details panel.

- [ ] **Step 4: Run the formatter tests and existing metrics tests**

Run from packages/app:

~~~bash
bun test --preload ./happydom.ts ./src/components/session/session-context-format.test.ts ./src/components/session/session-context-metrics.test.ts
~~~

Expected: PASS.

- [ ] **Step 5: Commit the isolated formatter change**

~~~bash
git add packages/app/src/components/session/session-context-format.ts packages/app/src/components/session/session-context-format.test.ts
git commit -m "feat(app): format context tokens compactly"
~~~

### Task 2: Add localized composer summary strings

**Files:**
- Modify: packages/app/src/i18n/en.ts
- Modify: packages/app/src/i18n/ar.ts
- Modify: packages/app/src/i18n/br.ts
- Modify: packages/app/src/i18n/bs.ts
- Modify: packages/app/src/i18n/da.ts
- Modify: packages/app/src/i18n/de.ts
- Modify: packages/app/src/i18n/es.ts
- Modify: packages/app/src/i18n/fr.ts
- Modify: packages/app/src/i18n/ja.ts
- Modify: packages/app/src/i18n/ko.ts
- Modify: packages/app/src/i18n/no.ts
- Modify: packages/app/src/i18n/pl.ts
- Modify: packages/app/src/i18n/ru.ts
- Modify: packages/app/src/i18n/th.ts
- Modify: packages/app/src/i18n/tr.ts
- Modify: packages/app/src/i18n/uk.ts
- Modify: packages/app/src/i18n/zh.ts
- Modify: packages/app/src/i18n/zht.ts
- Test: packages/app/src/i18n/parity.test.ts (run only; no source change expected)

**Interfaces:**
- Consumes: the existing language.t interpolation contract and the app locale parity test.
- Produces: context.usage.window and context.usage.used translation keys.

- [ ] **Step 1: Add the English source strings**

Add these entries beside the existing context.usage.* entries in en.ts:

~~~ts
"context.usage.window": "Context window",
"context.usage.used": "Used {{used}} / {{limit}}",
~~~

- [ ] **Step 2: Add matching placeholder keys to every app locale**

Add translated equivalents to the 17 non-English dictionaries listed above. The
Chinese dictionaries must use 上下文窗口 / 已使用 {{used}} / {{limit}} for zh.ts
and 上下文視窗 / 已使用 {{used}} / {{limit}} for zht.ts. Every locale must
contain exactly the used and limit placeholders so the existing parity test
remains valid.

- [ ] **Step 3: Run the i18n parity test**

Run from packages/app:

~~~bash
bun test --preload ./happydom.ts ./src/i18n/parity.test.ts
~~~

Expected: PASS or the existing non-CI skip behavior, with no missing or extra
keys when the parity test executes.

- [ ] **Step 4: Commit the translation change**

~~~bash
git add packages/app/src/i18n
git commit -m "feat(app): add context usage summary translations"
~~~

### Task 3: Extend SessionContextUsage with the composer presentation

**Files:**
- Modify: packages/app/src/components/session-context-usage.tsx
- Test: packages/app/src/components/session/session-context-format.test.ts (already created; extend only for pure summary formatting cases)

**Interfaces:**
- Consumes: getSessionContext, createSessionContextFormatter, the new i18n keys, and the existing openContext callback.
- Produces: SessionContextUsage variant composer with the existing buttonAppearance switch for legacy and V2 styling.

- [ ] **Step 1: Add a pure edge-case test before changing the component**

Extend the formatter test with the values the composer will display:

~~~ts
test("formats an unavailable context limit without inventing a value", () => {
  const formatter = createSessionContextFormatter("en-US")

  expect(formatter.compact(40)).toBe("40")
  expect(formatter.compact(undefined)).toBe("—")
})
~~~

Run the focused formatter test and confirm it passes before changing the UI.

- [ ] **Step 2: Add the composer variant and summary values**

Extend the variant type from button | indicator to button | indicator | composer.
Create the formatter from language.intl() and derive:

~~~ts
const usageLabel = () => formatter().percent(context()?.usage)
const usedLabel = () => formatter().compact(context()?.total)
const limitLabel = () => formatter().compact(context()?.limit)
~~~

Render the composer variant only when context() exists. Its two text lines must
call context.usage.window and context.usage.used and use the compact values above.
Keep the existing tooltip value and openContext callback shared by all variants.

- [ ] **Step 3: Use layout-appropriate button styling**

For buttonAppearance default, render the summary with the existing app Button
component and a compact, right-aligned two-line layout. For buttonAppearance v2,
render the same summary through ButtonV2 with the existing muted/ghost appearance.
Both branches must set type="button", call openContext on click, and expose
language.t("context.usage.view") as the aria label.

Use min-w-0, max-w-*, truncate, and shrink-0 classes so the summary does not
push the submit button out of the composer at narrow widths. Keep the tooltip
placement supplied by the caller, defaulting to the existing top placement.

- [ ] **Step 4: Run the component dependent tests and typecheck**

Run from packages/app:

~~~bash
bun test --preload ./happydom.ts ./src/components/session/session-context-format.test.ts ./src/components/session/session-context-metrics.test.ts
bun typecheck
~~~

Expected: PASS and no TypeScript errors.

- [ ] **Step 5: Commit the shared component change**

~~~bash
git add packages/app/src/components/session-context-usage.tsx packages/app/src/components/session/session-context-format.test.ts
git commit -m "feat(app): add composer context usage summary"
~~~

### Task 4: Move the indicator and integrate it into the legacy composer

**Files:**
- Modify: packages/app/src/pages/session/timeline/message-timeline.tsx (header usage block around line 1498)
- Modify: packages/app/src/components/prompt-input.tsx (legacy submit row around line 1540)

**Interfaces:**
- Consumes: SessionContextUsage variant composer from Task 3.
- Produces: the legacy prompt showing the context summary beside the submit button, with the message header no longer rendering the moved usage control.

- [ ] **Step 1: Remove only the header-level usage button**

Delete the SessionContextUsage JSX in the message timeline header and remove its
now-unused import. Do not touch the SessionContextUsage instances in
session-side-panel.tsx; those belong to the unchanged context tab label.

- [ ] **Step 2: Add the summary to the legacy submit control row**

Import SessionContextUsage into prompt-input.tsx. In the existing absolute
bottom-right row, render:

~~~tsx
<SessionContextUsage variant="composer" placement="top" />
<div class="flex items-center gap-1 pointer-events-auto">
  {/* existing submit tooltip and button */}
</div>
~~~

Keep the row pointer-events-none wrapper and the submit button existing
data-action, disabled state, keyboard behavior, and stop/send icon unchanged.
The composer summary must remain before the submit button so the submit target
stays at the far right.

- [ ] **Step 3: Run the legacy-focused app checks**

Run from packages/app:

~~~bash
bun typecheck
bun test --preload ./happydom.ts ./src/components/session/session-context-format.test.ts ./src/components/session/session-context-metrics.test.ts
~~~

Expected: PASS with the legacy prompt compiling and the header import removed.

- [ ] **Step 4: Commit the legacy integration**

~~~bash
git add packages/app/src/pages/session/timeline/message-timeline.tsx packages/app/src/components/prompt-input.tsx
git commit -m "feat(app): move context usage into legacy composer"
~~~

### Task 5: Add a generic footer slot to the V2 prompt and wire the V2 composer

**Files:**
- Modify: packages/session-ui/src/v2/components/prompt-input/index.tsx (PromptInputV2Props and footer row)
- Modify: packages/app/src/components/prompt-input-v2.tsx (PromptInputV2Composer)

**Interfaces:**
- Consumes: an optional footerControl?: JSX.Element slot in the generic PromptInputV2 component and the app SessionContextUsage composer variant.
- Produces: a V2 prompt footer that accepts an app-owned control without making session-ui depend on app context, SDK session state, or app translations.

- [ ] **Step 1: Add the V2 footer slot type**

Extend PromptInputV2Props with:

~~~ts
footerControl?: JSX.Element
~~~

The existing JSX type import is already available in this file.

- [ ] **Step 2: Render the slot before the submit button**

Inside the existing V2 footer flex row, after the left control group and before
PromptInputV2SubmitButton, render the optional slot in a shrink-0 wrapper:

~~~tsx
<Show when={props.footerControl}>
  <div class="shrink-0">{props.footerControl}</div>
</Show>
~~~

Do not change the submit button props, form behavior, or the generic prompt
dependency direction.

- [ ] **Step 3: Pass the app-owned context control from PromptInputV2Composer**

Import SessionContextUsage into packages/app/src/components/prompt-input-v2.tsx
and pass this prop to PromptInputV2:

~~~tsx
footerControl={<SessionContextUsage variant="composer" buttonAppearance="v2" placement="top" />}
~~~

The control is therefore inside the V2 footer and naturally reserves space before
the send/stop button instead of overlapping it.

- [ ] **Step 4: Run session-ui and app checks**

Run from packages/session-ui:

~~~bash
bun test src/v2/components/prompt-input
bun typecheck
~~~

Run from packages/app:

~~~bash
bun typecheck
bun test --preload ./happydom.ts ./src/components/session/session-context-format.test.ts ./src/components/session/session-context-metrics.test.ts
~~~

Expected: PASS and no type errors across the generic V2 package and app adapter.

- [ ] **Step 5: Commit the V2 integration**

~~~bash
git add packages/session-ui/src/v2/components/prompt-input/index.tsx packages/app/src/components/prompt-input-v2.tsx
git commit -m "feat(app): move context usage into V2 composer"
~~~

### Task 6: Run full verification and inspect the final diff

**Files:**
- Verify only: all files changed by Tasks 1-5.
- Preserve: packages/sdk/openapi.json remains unstaged and unchanged by this work.

**Interfaces:**
- Consumes: the completed legacy and V2 composer integrations.
- Produces: a verified branch-local UI change with no context-details regression.

- [ ] **Step 1: Run focused app and session-ui tests**

From packages/app:

~~~bash
bun test --preload ./happydom.ts ./src/components/session/session-context-format.test.ts ./src/components/session/session-context-metrics.test.ts
~~~

From packages/session-ui:

~~~bash
bun test src/v2/components/prompt-input
~~~

Expected: PASS. If the existing test:unit suite reports the known Bun/Solid
environment failure outside these focused files, record it separately instead
of changing unrelated code.

- [ ] **Step 2: Run package typechecks and production build**

From packages/app:

~~~bash
bun typecheck
bun run build
~~~

From packages/session-ui:

~~~bash
bun typecheck
~~~

Expected: PASS.

- [ ] **Step 3: Run formatting and inspect changed paths**

From the repository root, run formatting only as a check (not tests):

~~~bash
bunx prettier --check packages/app/src/components/session/session-context-format.ts packages/app/src/components/session/session-context-format.test.ts packages/app/src/components/session-context-usage.tsx packages/app/src/components/prompt-input.tsx packages/app/src/components/prompt-input-v2.tsx packages/app/src/pages/session/timeline/message-timeline.tsx packages/app/src/i18n packages/session-ui/src/v2/components/prompt-input/index.tsx
git diff --check
git status --short
~~~

Expected: no whitespace errors, only intended source/translation files plus the
pre-existing packages/sdk/openapi.json modification.

- [ ] **Step 4: Perform manual UI verification**

With a session that has a token-bearing assistant response, verify both layout
settings:

1. The header no longer shows the moved circular usage button.
2. The composer shows the two-line percentage and used/limit summary beside the
   submit button.
3. The summary does not cover the send/stop button at normal or narrow width.
4. Hover and keyboard focus show cost, usage, and full token details.
5. Clicking the summary opens the unchanged context details panel.
6. The side-panel context tab indicator remains unchanged.
7. A session without assistant token data does not show a misleading 0% summary.

- [ ] **Step 5: Confirm the commit boundaries and preserve unrelated work**

After all checks pass and the manual behavior is confirmed, inspect the task
commits and working tree:

~~~bash
git log -5 --oneline
git status --short
~~~

The expected feature changes are already committed by Tasks 1-5. Do not create a
catch-all commit and do not stage packages/sdk/openapi.json unless the user
separately requests that unrelated change.
