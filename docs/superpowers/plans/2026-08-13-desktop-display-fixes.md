# Desktop Display Fixes Implementation Plan（修訂版 v7）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> 本版所有代碼片段均為完整可貼入版本；行號與型別取自逐字收集素材（`.superpowers/sdd/2026-08-13-desktop-display-fixes/ui-fix-materials-v4.md` 與 `ui-fix-materials-v5.md`）。本文件是唯一規格——不引用其他版本的計劃內容。

**Goal:** Fix the fork-specific desktop display bugs and their adjacent dead ends: markdown flicker, disappearing/out-of-order messages, missing `session.next.*` consumers, silent title updates, the V1-permission reply dead end, the removed navigation policy, and the reasoning display — with reasoning enabled by default, aligned with the TUI.

**Architecture:** Restore upstream behaviors where the fork diverged (unconditional `PacedMarkdown`, time-based message ordering across ALL insertion paths, identity-preserving `sliceAtBoundary`, `external-url.ts` + injected-predicate `wireNavigationPolicy` with `openExternalURL` owned by `windows.ts`); port the TUI's V2→V1 lifecycle/status mapping into the app's event layer with a number-typed snapshot projector; route the background title update through the canonical mutation boundary; migrate the last V1 permission ask producer to a blocking, exported `requestWorkflowApproval` Effect.

**Tech Stack:** SolidJS 1.9 (solid-js + solid-js/web, NO testing-library), session-ui/app/ui packages (Bun), Effect 4.0.0-beta.83 (core), Electron (desktop), bun test, tsgo typecheck.

**Spec:**
- `D:\agent-complete\fork桌面版顯示bug定位報告.md`（範圍見下）
- Upstream reference checkout: `D:\agent-complete\opencode-1.18.15` (read-only)

## Scope and finding accounting

本批修復 **8 個獨立缺陷**，覆蓋 10 個識別碼：A1+A2（Task 1/2）、C1（Task 1）、C2（症狀，根因 = A1 渲染層 + A3 投影層）、A3（Task 3）、A4+A5（Task 4）、A6（Task 5）、A7（Task 6）、A8（Task 7）。明確排除 A9-A12 與 B 類。

## Execution batches

四批序列執行：Batch 1（渲染）Task 1-2；Batch 2（timeline/事件）Task 3-4；Batch 3（core/opencode）Task 5-6；Batch 4（desktop）Task 7。

## Global Constraints

- Continue only in `D:\agent-complete\opencode-fork-private-999.0.15`; branch `999.0.17`; do not rewrite existing commits.
- Do not modify, stage, or commit `docs/superpowers/specs/2026-08-11-provider-native-tool-search-design.md` or `docs/superpowers/handoffs/`.
- Product decision (user-approved): `showReasoningSummaries` default becomes `true`.
- Repo rules (AGENTS.md): never use star imports; never alias imports; avoid `any`/`as never`（唯二例外：既有 repo fixture 自身的 `as unknown as` 慣例照抄——素材 D1 的 makeLocationLayer 與素材 C3 的 setup client cast 屬此類）; avoid `else`, prefer early returns.
- Tests are colocated in `src/` for packages that colocate (session-ui/app/desktop); `packages/core` and `packages/opencode` keep their `test/` layout.
- TDD red→green; deterministic only (barrier-based waiting: `expect.poll`、`Deferred`、`execution.wait`、既有 `requested(count)`/`flush()` helper——不用裸 sleep); run from package directories.
- Commits: stage explicit paths only; `git -c core.hooksPath=.git/hooks commit -m "type(scope): summary"`.
- Do not change Protocol, Server `HttpApi`, or `packages/schema`. Do not run `bun run generate`.

---

## Batch 1

### Task 1: Restore unconditional PacedMarkdown + reasoning on by default with a visual heading (A1 render root, C1)

**Files:**
- Modify: `packages/session-ui/src/components/message-part.tsx` (~1715-1789: remove both `Show when={streaming()}` wrappers; add the reasoning heading row)
- Modify: `packages/session-ui/src/components/message-part.css` (reasoning-part rules + heading slot)
- Create: `packages/session-ui/happydom.ts` (copy `packages/app/happydom.ts` verbatim — 素材 A9)
- Modify: `packages/session-ui/package.json` + `bun.lock` (`bun add -d @happy-dom/global-registrator@20.0.11` in `packages/session-ui`)
- Create: `packages/session-ui/src/components/message-part.test.tsx`
- Modify: `packages/app/src/context/settings.tsx:185` (`showReasoningSummaries: false` → `true`)
- Modify: `packages/app/src/context/settings.test.ts` (default regression via `SettingsProvider`/`useSettings` seam)
- Modify: `packages/ui/src/i18n/en.ts` + `ar.ts, br.ts, bs.ts, da.ts, de.ts, es.ts, fr.ts, ja.ts, ko.ts, no.ts, pl.ts, ru.ts, th.ts, tr.ts, uk.ts, zh.ts, zht.ts` — flat key `"ui.message.reasoningHeading": "Thought"` in every one.

**Interfaces:**
- Consumes（素材 v4 A1-A14 + v5 §1-2）: `I18nProvider`（props: `{ value: UiI18n }`，`UiI18n = { locale: Accessor<string>; t: (key: UiI18nKey, params?) => string }`）; `DataProvider`（init: `{ data, directory }`）; `MarkedProvider`（init: `{ nativeParser? }`）; `Part`（props: `part: PartType; message: MessageType`）; `createRoot` from `"solid-js"`; `render` from `"solid-js/web"`; sdk/v2 型別：`TextPart` 必填 `id/sessionID/messageID/type/text`，`ReasoningPart` 必填 `id/sessionID/messageID/type/text/time.start`，`AssistantMessage` 必填 `id/sessionID/role/time.created/parentID/modelID/providerID/mode/agent/path.cwd/path.root/cost/tokens`。
- Produces: `TextPartDisplay`/`ReasoningPartDisplay` render `<PacedMarkdown .../>` unconditionally; reasoning parts carry `data-slot="reasoning-part-heading"`.

- [ ] **Step 0: Read context**
  - 素材 v4 A1-A14、v5 §1-2。另讀 `packages/session-ui/src/components/message-part.tsx` 的 i18n hook 實際用法（素材 A13 證實 `const i18n = useI18n()` + `i18n.t(...)`）。

- [ ] **Step 1: Write the failing tests**

`packages/session-ui/src/components/message-part.test.tsx`：

```tsx
import { afterEach, describe, expect, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import { render } from "solid-js/web"
import { Part } from "./message-part"
import type { MessagePartProps } from "./message-part"
import { DataProvider } from "../context"
import { MarkedProvider } from "@opencode-ai/ui/context/marked"
import { I18nProvider, type UiI18n } from "@opencode-ai/ui/context/i18n"
import type { AssistantMessage, Message, ReasoningPart, TextPart } from "@opencode-ai/sdk/v2"

const i18n: UiI18n = { locale: () => "en", t: (key) => key }

const host = (part: () => MessagePartProps["part"], message: () => Message) => {
  const data = {
    session: [],
    session_status: {},
    session_diff: {},
    message: {},
    part: {},
    part_text_accum_delta: {},
  }
  return (
    <DataProvider data={data} directory="/repo">
      <MarkedProvider>
        <I18nProvider value={i18n}>
          <Part part={part()} message={message()} />
        </I18nProvider>
      </MarkedProvider>
    </DataProvider>
  )
}

describe("message-part remount regression", () => {
  let dispose: () => void

  afterEach(() => dispose?.())

  test("keeps the rendered markdown node across the streaming → completed transition", async () => {
    const [completed, setCompleted] = createSignal<number | undefined>(undefined)
    const part = () =>
      ({
        id: "prt_1",
        sessionID: "ses_1",
        messageID: "msg_1",
        type: "text",
        text: "**bold** tail",
      }) satisfies TextPart
    const message = () =>
      ({
        id: "msg_1",
        sessionID: "ses_1",
        role: "assistant",
        time: { created: 1, completed: completed() },
        parentID: "msg_user",
        modelID: "model",
        providerID: "provider",
        mode: "build",
        agent: "build",
        path: { cwd: "/repo", root: "/repo" },
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      }) satisfies AssistantMessage

    dispose = createRoot((disposeRoot) => {
      const cleanup = render(() => host(part, message), document.body)
      return () => {
        cleanup()
        disposeRoot()
      }
    })

    const markdownBefore = document.querySelector('[data-component="markdown"]')
    expect(markdownBefore).toBeTruthy()

    setCompleted(2)

    // 確定性 barrier：Markdown 的 createResource 非同步解析，用 expect.poll 等到解析落地。
    await expect
      .poll(() => document.querySelector('[data-component="markdown"]')?.innerHTML.includes("<strong>bold</strong>"))
      .toBe(true)

    expect(document.querySelector('[data-component="markdown"]')).toBe(markdownBefore)
    expect(document.querySelector('[data-component="markdown"]')?.innerHTML).not.toContain("**bold**")
  })

  test("renders the reasoning heading row for reasoning parts", async () => {
    const part = () =>
      ({
        id: "prt_2",
        sessionID: "ses_1",
        messageID: "msg_2",
        type: "reasoning",
        text: "thinking",
        time: { start: 1 },
      }) satisfies ReasoningPart
    const message = () =>
      ({
        id: "msg_2",
        sessionID: "ses_1",
        role: "assistant",
        time: { created: 1, completed: 2 },
        parentID: "msg_user",
        modelID: "model",
        providerID: "provider",
        mode: "build",
        agent: "build",
        path: { cwd: "/repo", root: "/repo" },
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      }) satisfies AssistantMessage

    dispose = createRoot((disposeRoot) => {
      const cleanup = render(() => host(part, message), document.body)
      return () => {
        cleanup()
        disposeRoot()
      }
    })

    await expect.poll(() => document.querySelector('[data-slot="reasoning-part-heading"]')).toBeTruthy()
  })
})
```

`packages/app/src/context/settings.test.ts` 新增（沿用素材 A12 的 mock.module 設定與 provider seam）：

```ts
test("reasoning summaries default to enabled", async () => {
  let settings: ReturnType<typeof useSettings> | undefined
  let dispose: VoidFunction | undefined
  createRoot((disposeRoot) => {
    dispose = disposeRoot
    SettingsProvider({
      get children() {
        settings = useSettings()
        return undefined
      },
    })
  })

  if (!settings) throw new Error("settings provider did not initialize")
  await settings.ready.promise

  expect(settings.general.showReasoningSummaries()).toBe(true)
  dispose?.()
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/session-ui && bun test src/components/message-part.test.tsx --preload ./happydom.ts`（devDep 安裝先完成）與 `cd packages/app && bun test src/context/settings.test.ts`。Expected: FAIL——transition 後節點被替換、heading 缺失、預設 false。

- [ ] **Step 3: Remove the Show flip (both displays)**

In `packages/session-ui/src/components/message-part.tsx` — `TextPartDisplay` 的

```tsx
        <div data-slot="text-part-body">
          <Show when={streaming()} fallback={<Markdown text={text()} cacheKey={part().id} streaming={false} />}>
            <PacedMarkdown text={text()} cacheKey={part().id} streaming={streaming()} />
          </Show>
        </div>
```

改為

```tsx
        <div data-slot="text-part-body">
          <PacedMarkdown text={text()} cacheKey={part().id} streaming={streaming()} />
        </div>
```

`ReasoningPartDisplay` 的

```tsx
    <Show when={text()}>
      <div data-component="reasoning-part" data-timeline-part-id={part().id}>
        <Show when={streaming()} fallback={<Markdown text={text()} cacheKey={part().id} streaming={false} />}>
          <PacedMarkdown text={text()} cacheKey={part().id} streaming={streaming()} />
        </Show>
      </div>
    </Show>
```

改為

```tsx
    <Show when={text()}>
      <div data-component="reasoning-part" data-timeline-part-id={part().id}>
        <div data-slot="reasoning-part-heading">
          <span class="text-12-regular">{i18n.t("ui.message.reasoningHeading")}</span>
        </div>
        <PacedMarkdown text={text()} cacheKey={part().id} streaming={streaming()} />
      </div>
    </Show>
```

- [ ] **Step 4: Reasoning visual + default + i18n**

(a) `message-part.css`：`[data-component="reasoning-part"]` 加 `border-left: 2px solid var(--v2-grey-600)`（若 token 不存在，用檔內最近的 muted token）+ `padding-left`；`[data-slot="reasoning-part-heading"]` muted small-caps（沿用檔內慣例）。
(b) `packages/app/src/context/settings.tsx:185`：`showReasoningSummaries: false` → `true`。
(c) 上述 18 個 locale 檔（`en.ts` + 17 個翻譯）各加 flat key。

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/session-ui && bun test src/components/message-part.test.tsx --preload ./happydom.ts` + `cd packages/app && bun test src/context/settings.test.ts src/i18n/parity.test.ts` + typecheck `packages/ui`、`packages/session-ui`、`packages/app`。

- [ ] **Step 6: Commit**

```powershell
git add packages/session-ui/src/components/message-part.tsx packages/session-ui/src/components/message-part.css packages/session-ui/src/components/message-part.test.tsx packages/session-ui/happydom.ts packages/session-ui/package.json bun.lock packages/app/src/context/settings.tsx packages/app/src/context/settings.test.ts packages/ui/src/i18n
git -c core.hooksPath=.git/hooks commit -m "fix(session-ui): render completed parts without remount and enable reasoning summaries by default"
```

### Task 2: Reuse the live tail block during streaming (A2)

**Files:**
- Modify: `packages/session-ui/src/components/markdown-stream.ts:589-593`
- Modify: `packages/session-ui/src/components/markdown-stream.test.ts`（**現有 colocated 檔——擴充**）

- [ ] **Step 1: Write the failing assertions**

Extend the existing `packages/session-ui/src/components/markdown-stream.test.ts`（先讀現有 case；`Block` 需要 `src`）：

```ts
test("reuses the live tail block when the raw text is a prefix of the next raw", () => {
  expect(
    canReusePendingBlock(
      { mode: "live", raw: "hello", src: "hello" },
      { mode: "live", raw: "hello wor", src: "hello wor" },
    ),
  ).toBe(true)
  expect(
    canReusePendingBlock(
      { mode: "live", raw: "hello", src: "hello" },
      { mode: "live", raw: "he", src: "he" },
    ),
  ).toBe(false)
  expect(
    canReusePendingBlock({ mode: "full", raw: "a", src: "a" }, { mode: "full", raw: "a", src: "a" }),
  ).toBe(true)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/session-ui && bun test src/components/markdown-stream.test.ts`。Expected: live-prefix case FAIL。

- [ ] **Step 3: Fix**

```ts
export function canReusePendingBlock(current: Pick<Block, "mode" | "raw"> | undefined, next: Block) {
  if (!current || current.mode !== next.mode) return false
  if (next.mode === "code" || next.mode === "live") return next.raw.startsWith(current.raw)
  return current.raw === next.raw
}
```

- [ ] **Step 4: Run tests to verify they pass**（現有 case 保持綠）

- [ ] **Step 5: Commit**

```powershell
git add packages/session-ui/src/components/markdown-stream.ts packages/session-ui/src/components/markdown-stream.test.ts
git -c core.hooksPath=.git/hooks commit -m "fix(session-ui): reuse the live markdown tail block while streaming"
```

---

## Batch 2

### Task 3: Restore time-based message ordering across ALL insertion paths (A3, C2 projection root)

**Files:**
- Modify: `packages/app/src/utils/session-message.ts`（新增 helpers）
- Modify: `packages/app/src/utils/session-message.test.ts`（擴充）
- Modify: `packages/app/src/context/server-session.ts`（六個排序入口）
- Modify: `packages/app/src/context/server-session.test.ts`（四個排序回歸）
- Modify: `packages/app/src/pages/session/timeline/rows.ts`（~958-965）
- Modify: `packages/app/src/pages/session/timeline/message-timeline.tsx`（boundary → `sliceAtBoundary`）
- Modify: `packages/app/src/pages/session/timeline/rows-current.test.ts`（擴充）

**Interfaces:**
- Produces（`@/utils/session-message`）：
  ```ts
  export type MessageOrderable = { id: string; time: { created: number } }
  export function compareMessages(a: MessageOrderable, b: MessageOrderable): number
  export function sliceAtBoundary(messages: SessionMessageInfo[], boundary: string | undefined): SessionMessageInfo[]
  ```
  `compareMessages` 為**數值時間比較**：`time.created` 差為 0 時以 `id` 字典序決勝——不做字串串接（`"10msg" < "2msg"` 的字典序陷阱）。

- [ ] **Step 1: Write the failing tests**

`packages/app/src/utils/session-message.test.ts` 擴充（`SessionMessageInfo` 的 discriminator 是 `type`）：

```ts
import { compareMessages, sliceAtBoundary } from "./session-message"
import type { SessionMessageInfo } from "@opencode-ai/client/promise"

const msg = (id: string, created: number) =>
  ({ id, type: "system", text: "", time: { created } }) satisfies SessionMessageInfo

test("compareMessages orders numerically by time.created then by id", () => {
  expect(compareMessages(msg("a", 10), msg("b", 2))).toBeGreaterThan(0)
  expect(compareMessages(msg("a", 2), msg("b", 10))).toBeLessThan(0)
  expect(compareMessages(msg("a", 1), msg("b", 1))).toBeLessThan(0)
  expect(compareMessages(msg("b", 1), msg("a", 1))).toBeGreaterThan(0)
})

test("sliceAtBoundary slices by array position and preserves identity without a boundary", () => {
  const messages: SessionMessageInfo[] = [msg("z_shell", 1), msg("a", 2), msg("b", 3)]
  expect(sliceAtBoundary(messages, undefined)).toBe(messages)
  expect(sliceAtBoundary(messages, "missing")).toBe(messages)
  expect(sliceAtBoundary(messages, "b")).toEqual([msg("z_shell", 1), msg("a", 2)])
})
```

`rows-current.test.ts` 擴充（沿用現有 fixture）：projected user 訊息 id 字串序大於最新 turn 時仍被插入而非丟棄；早於最新 turn 的 projected user 插到前面；現有「keeps a projected parent missing from the source page before newer turns」保持綠。

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/app && bun test src/utils/session-message.test.ts src/pages/session/timeline/rows-current.test.ts`。Expected: helper 不存在；插入 case FAIL。

- [ ] **Step 3: Add the helpers**

`packages/app/src/utils/session-message.ts` 檔尾新增：

```ts
export type MessageOrderable = { id: string; time: { created: number } }

export function compareMessages(a: MessageOrderable, b: MessageOrderable) {
  const created = a.time.created - b.time.created
  if (created !== 0) return created
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

export function sliceAtBoundary(
  messages: SessionMessageInfo[],
  boundary: string | undefined,
): SessionMessageInfo[] {
  if (!boundary) return messages
  const index = messages.findIndex((message) => message.id === boundary)
  return index < 0 ? messages : messages.slice(0, index)
}
```

- [ ] **Step 4: Rewire all six ordering entries in server-session.ts**（行號以素材 B0-B5 為準）

1. `legacyMessageSource`（素材 B1）：
   `.sort((a, b) => cmp(a.info.id, b.info.id))` → `.sort((a, b) => compareMessages(a.info, b.info))`
2. `mergeOptimisticPage`（素材 B2 的 fork 現況 + 上游語意 v5 §4——**found 時保留 server message，不覆寫**）整段改為：

   ```ts
   function mergeOptimisticPage(page: MessagePage, items: OptimisticItem[]) {
     if (items.length === 0) return { ...page, observed: [] as { messageID: string; parts: Part[] }[] }
     const session = [...page.session]
     const part = new Map(page.part.map((item) => [item.id, item.part]))
     const observed: { messageID: string; parts: Part[] }[] = []
     for (const item of items) {
       const foundIndex = session.findIndex((message) => message.id === item.message.id)
       const found = foundIndex >= 0
       if (!found) {
         const insertIndex = session.findIndex((message) => compareMessages(item.message, message) < 0)
         if (insertIndex < 0) session.push(item.message)
         else session.splice(insertIndex, 0, item.message)
       }
       const current = part.get(item.message.id)
       const confirmed = found ? item.parts.filter((part) => current?.some((value) => value.id === part.id)) : []
       if (found) observed.push({ messageID: item.message.id, parts: confirmed })
       part.set(
         item.message.id,
         mergeInOrder(
           found ? (current ?? []) : mergeInOrder(item.confirmedParts ?? [], current ?? []),
           item.parts.filter((part) => !confirmed.includes(part)),
         ),
       )
     }
     return {
       ...page,
       session,
       part: [...part.entries()]
         .sort((a, b) => cmp(a[0], b[0]))
         .map(([id, parts]) => ({ id, part: parts })),
       observed,
     }
   }
   ```

   （parts 尾部**保留 fork 原始的 id 排序**——`cmp` 為該檔現有 helper；變更僅限 session 陣列的插入邏輯與 found 語意。）
3. 初始頁 V2（素材 B3 :961）與 reprojection（素材 B4 :1007）：`normalized.messages.sort((a, b) => cmp(a.id, b.id))` → `normalized.messages.sort(compareMessages)`（part 陣列維持 id 序——parts 無 time 欄位）。
4. 初始頁 legacy（素材 B3 :977）：`items.map((item) => cleanMessage(item.info)).sort((a, b) => cmp(a.id, b.id))` → `.sort(compareMessages)`。
5. live update 插入（素材 B5 的 `message.updated` handler——素材 v6 §2 證實該 case 名為 `message.updated`，不存在 `message.created`）：

   ```ts
        const messages = data.message[info.sessionID]
        if (!messages) {
          setData("message", info.sessionID, [info])
          return
        }
        const foundIndex = messages.findIndex((message) => message.id === info.id)
        if (foundIndex >= 0) {
          setData("message", info.sessionID, foundIndex, reconcile(info))
          return
        }
        const insertIndex = messages.findIndex((message) => compareMessages(info, message) < 0)
        setData("message", info.sessionID, (value = []) => {
          const next = value.slice()
          next.splice(insertIndex < 0 ? next.length : insertIndex, 0, info)
          return next
        })
        return
   ```

6. `hydrateV2Message`（素材 B3 註的 `.sort((a, b) => cmp(a.id, b.id))` 處）：→ `.sort(compareMessages)`。

`import { compareMessages } from "@/utils/session-message"` 加進 server-session.ts；若 `cmp` 無其他使用則移除。`Binary` import 若無其他使用（grep 素材 B5 註的其他使用處：502/526/534/1405/1418/1559/1576 仍在用）則保留。

- [ ] **Step 5: rows.ts + message-timeline.tsx**

rows.ts 的 fork 丟棄區塊 → 上游插入區塊（素材 v4 3.3，`compareMessages` import 自 `@/utils/session-message`）。message-timeline.tsx 的 boundary filter → `sliceAtBoundary(messages, boundary)`。

- [ ] **Step 6: Ordering regression tests in `packages/app/src/context/server-session.test.ts`**（用素材 v6 §1 的真實 fixture：`currentMessageApi(...pages)` 收 `SessionMessageInfo[][]`、`optimistic.add({ sessionID, message, parts })`、live handler case 名為 `message.updated`、`SessionApi.message` 回傳 raw `SessionMessageInfo` 不包 `{data}`）

```ts
const userInfo = (id: string, created: number) =>
  ({ id, type: "user", text: id, time: { created } }) satisfies Extract<SessionMessageInfo, { type: "user" }>

test("orders an out-of-order initial V2 page by creation time", async () => {
  // Current API pages are descending. These IDs deliberately conflict with
  // creation order so the old ID comparator is guaranteed to fail RED.
  const api = currentMessageApi([userInfo("msg_a_late", 10), userInfo("msg_z_early", 1)])
  const store = createServerSession({} as OpencodeClient, {} as SessionApi, api, {
    retry: retryImmediately,
  })
  await store.sync("child")
  // session_message is the raw current-API source; message is the sorted SDK projection.
  expect(store.data.message.child?.map((message) => message.id)).toEqual(["msg_z_early", "msg_a_late"])
})

test("merges an older optimistic message before newer server messages", async () => {
  const api = currentMessageApi([userInfo("msg_a_server", 10)])
  const store = createServerSession({} as OpencodeClient, {} as SessionApi, api, {
    retry: retryImmediately,
  })
  store.optimistic.add({
    sessionID: "child",
    message: {
      id: "msg_z_optimistic",
      sessionID: "child",
      role: "user",
      time: { created: 1 },
      agent: "build",
      model: { providerID: "provider", modelID: "model" },
    },
    parts: [],
  })
  await store.sync("child")
  expect(store.data.message.child?.map((message) => message.id)).toEqual(["msg_z_optimistic", "msg_a_server"])
})

test("inserts live updated messages by creation time", () => {
  const ctx = setup({ child: session("child") })
  ctx.store.remember(session("child"))
  ctx.store.set("message", "child", [
    {
      id: "msg_a_server",
      sessionID: "child",
      role: "user",
      time: { created: 10 },
      agent: "build",
      model: { providerID: "provider", modelID: "model" },
    },
  ])
  ctx.store.apply({
    type: "message.updated",
    properties: {
      info: {
        id: "msg_z_older",
        sessionID: "child",
        role: "user",
        time: { created: 1 },
        agent: "build",
        model: { providerID: "provider", modelID: "model" },
      },
    },
  })
  expect(ctx.store.data.message.child?.map((message) => message.id)).toEqual(["msg_z_older", "msg_a_server"])
})

test("sorts hydrated messages by creation time", async () => {
  const sessionApi = {
    get: async () => ({ data: session("child") }),
    message: async () => userInfo("msg_z_hydrated", 1),
  } as unknown as SessionApi
  const store = createServerSession(
    {} as OpencodeClient,
    sessionApi,
    currentMessageApi([userInfo("msg_a_existing", 10)]),
    { retry: retryImmediately },
  )
  await store.sync("child")
  store.applyV2({
    id: "evt_imported",
    created: 1,
    type: "session.next.message.imported",
    metadata: {},
    location: { directory: "/repo" },
    data: {
      timestamp: 1,
      sessionID: "child",
      message: { id: "msg_z_hydrated", type: "user", text: "hydrated", time: { created: 1 } },
    },
  } as unknown as V2Event)
  await expect
    .poll(() => store.data.session_message.child?.map((message) => message.id))
    .toEqual(["msg_z_hydrated", "msg_a_existing"])
})
```

（四個回歸都故意使用「較早訊息 ID 字典序較大」的 fixture，確保舊 ID 排序必定 RED。initial-page 必須斷言 `data.message`，因為 `data.session_message` 是保留 API 順序的 raw source。`expect.poll` 是 hydration 的確定性 barrier，不用 `setTimeout`。）

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd packages/app && bun test src/utils/session-message.test.ts src/pages/session/timeline/rows-current.test.ts src/context/server-session.test.ts` + `bun typecheck`。

- [ ] **Step 8: Commit**

```powershell
git add packages/app/src/utils/session-message.ts packages/app/src/utils/session-message.test.ts packages/app/src/context/server-session.ts packages/app/src/context/server-session.test.ts packages/app/src/pages/session/timeline/rows.ts packages/app/src/pages/session/timeline/message-timeline.tsx packages/app/src/pages/session/timeline/rows-current.test.ts
git -c core.hooksPath=.git/hooks commit -m "fix(app): order messages by creation time across all insertion paths"
```

### Task 4: Consume session.next.* lifecycle/status events across the app (A4, A5)

**Files:**
- Create: `packages/app/src/utils/session-snapshot.ts`（**單一共享 projector**：`projectSessionInfo` + `toHomeSessionEvent`——transcript store 與首頁索引共用同一份 snapshot→legacy `Session` 投影；tab cleanup 只判讀 `event.current` 的 lifecycle/archived 欄位，不另做 Session 投影）
- Create: `packages/app/src/utils/session-snapshot.test.ts`（驗證 adapted `ServerEvent.current` → home-index event routing）
- Modify: `packages/app/src/context/server-session.ts`（`applyV2` 完整 handler 正文 + 尾塊條件；projector 改 import 自 `@/utils/session-snapshot`）
- Modify: `packages/app/src/context/server-sync.tsx`（~645：`session.next.created/updated/deleted` 經 `toHomeSessionEvent` 路由進 `homeSessions.apply`）
- Modify: `packages/app/src/components/titlebar-session-events.ts`（`sessionTabsRemovedFromServerEvent` 的 `event.current` 分支辨認 `session.next.deleted` 與帶 archived 的 `session.next.updated`——素材 v6 §3 現況）
- Modify: `packages/app/src/context/server-session.test.ts`（擴充）
- Modify: `packages/app/src/components/titlebar-session-events.test.ts`（colocated）

**Interfaces:**
- Consumes（素材 v4 C1-C5、v5 §3）：`session.next.updated` 的 `data.info`（`time` 全 number）；app `Session` 型別；`setup()` 回傳 `{ get, messages, store }`；既有 `createServerSession` + `flush`（`setTimeout(0)`）+ `requests` 慣例（素材 v5 §3 的 2171-2220 測試）。

- [ ] **Step 1: Write the failing tests**

`packages/app/src/context/server-session.test.ts` 擴充（snapshot 依素材 C1 型別完整給出）：

```ts
const snapshot = (over: Partial<Extract<OpenCodeEvent, { type: "session.next.updated" }>["data"]["info"]> = {}) =>
  ({
    id: "child",
    projectID: "project",
    slug: "slug",
    version: "1",
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 1, updated: 2 },
    title: "Title",
    location: { directory: "/repo" },
    ...over,
  }) satisfies Extract<OpenCodeEvent, { type: "session.next.updated" }>["data"]["info"]

test("projects session.next.created into the session store", () => {
  const ctx = setup({})
  ctx.store.applyV2({
    id: "evt_created",
    type: "session.next.created",
    data: { timestamp: 1, sessionID: "child", info: snapshot() },
  } as V2Event)
  expect(ctx.store.data.info.child?.title).toBe("Title")
  expect(ctx.store.data.info.child?.directory).toBe("/repo")
  expect(ctx.store.data.info.child?.slug).toBe("slug")
})

test("projects session.next.updated and evicts archived sessions", () => {
  const ctx = setup({ child: session("child") })
  ctx.store.remember(session("child"))
  ctx.store.applyV2({
    id: "evt_updated",
    type: "session.next.updated",
    data: { timestamp: 2, sessionID: "child", info: snapshot({ title: "New Title" }) },
  } as V2Event)
  expect(ctx.store.data.info.child?.title).toBe("New Title")

  ctx.store.applyV2({
    id: "evt_archived",
    type: "session.next.updated",
    data: { timestamp: 3, sessionID: "child", info: snapshot({ time: { created: 1, updated: 3, archived: 3 } }) },
  } as V2Event)
  expect(ctx.store.data.info.child).toBeUndefined()
})

test("removes deleted sessions from the store", () => {
  const ctx = setup({ child: session("child") })
  ctx.store.remember(session("child"))
  ctx.store.applyV2({
    id: "evt_deleted",
    type: "session.next.deleted",
    data: { timestamp: 2, sessionID: "child", info: snapshot() },
  } as V2Event)
  expect(ctx.store.data.info.child).toBeUndefined()
})

test("maps session.next.status busy and retry shapes", () => {
  const ctx = setup({})
  ctx.store.remember(session("root"))
  ctx.store.applyV2({
    id: "evt_busy",
    type: "session.next.status",
    data: { timestamp: 1, sessionID: "root", status: { type: "busy" } },
  } as V2Event)
  expect(ctx.store.data.session_status.root).toEqual({ type: "busy" })

  ctx.store.applyV2({
    id: "evt_retry",
    type: "session.next.status",
    data: { timestamp: 2, sessionID: "root", status: { type: "retry", attempt: 2, message: "quota", next: 3 } },
  } as V2Event)
  expect(ctx.store.data.session_status.root).toEqual({ type: "retry", attempt: 2, message: "quota", next: 3 })
})

test("refreshes context only when session.next.status goes idle", async () => {
  const requests: string[] = []
  const client = {} as unknown as OpencodeClient
  const sessionApi = {
    context: async (input: { sessionID: string }) => {
      requests.push(input.sessionID)
      return []
    },
  } as unknown as SessionApi
  const store = createServerSession(client, sessionApi, {} as MessageApi, {
    retry: retryImmediately,
  })
  const current = { id: "evt_status", metadata: {}, location: { directory: "/repo" } }
  const applyStatus = (status: object) =>
    store.applyV2({ ...current, type: "session.next.status", data: { timestamp: 1, sessionID: "child", status } } as unknown as V2Event)
  const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

  store.remember(session("child"))
  applyStatus({ type: "busy" })
  await flush()
  expect(requests).toEqual([])

  applyStatus({ type: "retry", attempt: 2, message: "quota", next: 3 })
  await flush()
  expect(requests).toEqual([])

  applyStatus({ type: "idle" })
  await flush()
  expect(requests).toEqual(["child"])
  expect(store.data.session_status.child).toEqual({ type: "idle" })
})
```

新增 `packages/app/src/utils/session-snapshot.test.ts`，直接用真實 `adaptServerEvent()` 形狀驗證 routing seam；這個測試必須在 `server-sync.tsx` 接線前先 RED：

```ts
import { describe, expect, test } from "bun:test"
import type { OpenCodeEvent } from "@opencode-ai/client/promise"
import { adaptServerEvent } from "@/context/server-sdk"
import { toHomeSessionEvent } from "./session-snapshot"

const snapshot = (title = "Title") =>
  ({
    id: "child",
    projectID: "project",
    slug: "slug",
    version: "1",
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 1, updated: 2 },
    title,
    location: { directory: "/repo" },
  }) satisfies Extract<OpenCodeEvent, { type: "session.next.updated" }>["data"]["info"]

const current = <Type extends "session.next.created" | "session.next.updated" | "session.next.deleted">(
  type: Type,
) =>
  ({
    id: `evt_${type}`,
    type,
    data: { timestamp: 2, sessionID: "child", info: snapshot() },
  }) as Extract<OpenCodeEvent, { type: Type }>

describe("toHomeSessionEvent", () => {
  test("reads lifecycle payloads from ServerEvent.current", () => {
    const event = adaptServerEvent(current("session.next.updated"))
    expect("data" in event).toBe(false)
    expect(toHomeSessionEvent(event)).toEqual({
      type: "session.updated",
      properties: { sessionID: "child", info: expect.objectContaining({ id: "child", title: "Title" }) },
    })
  })

  test("maps created and deleted lifecycle types", () => {
    expect(toHomeSessionEvent(adaptServerEvent(current("session.next.created")))?.type).toBe("session.created")
    expect(toHomeSessionEvent(adaptServerEvent(current("session.next.deleted")))?.type).toBe("session.deleted")
  })

  test("ignores events without a current V2 lifecycle payload", () => {
    expect(
      toHomeSessionEvent({ type: "server.connected", properties: {} } as ReturnType<typeof adaptServerEvent>),
    ).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/app && bun test src/context/server-session.test.ts src/utils/session-snapshot.test.ts`。Expected: 新 case FAIL（projector/routing helper 與 lifecycle handler 尚不存在）。

- [ ] **Step 3: Implement the shared projector**

Create `packages/app/src/utils/session-snapshot.ts`：

```ts
import type { OpenCodeEvent, Session } from "@opencode-ai/client/promise"
import type { ServerEvent } from "@/context/server-sdk"
import type { HomeSessionEvent } from "@/context/global-sync/home-session-index"

export type SessionSnapshotInfo = Extract<OpenCodeEvent, { type: "session.next.updated" }>["data"]["info"]

export function projectSessionInfo(info: SessionSnapshotInfo): Session {
  return {
    id: info.id,
    slug: info.slug,
    projectID: info.projectID,
    workspaceID: info.location.workspaceID,
    directory: info.location.directory,
    path: info.subpath,
    parentID: info.parentID,
    title: info.title,
    agent: info.agent,
    model: info.model,
    version: info.version,
    cost: info.cost,
    tokens: info.tokens,
    share: info.share,
    metadata: info.metadata,
    permission: info.permission?.map((rule) => ({
      permission: rule.action,
      pattern: rule.resource,
      action: rule.effect,
    })),
    revert: info.revert,
    time: {
      created: info.time.created,
      updated: info.time.updated,
      ...(info.time.compacting !== undefined ? { compacting: info.time.compacting } : {}),
      ...(info.time.archived !== undefined ? { archived: info.time.archived } : {}),
    },
  }
}

export function toHomeSessionEvent(
  event: ServerEvent,
): HomeSessionEvent | undefined {
  const current = event.current
  if (
    current?.type !== "session.next.created" &&
    current?.type !== "session.next.updated" &&
    current?.type !== "session.next.deleted"
  )
    return
  const projected = projectSessionInfo(current.data.info)
  const legacy =
    current.type === "session.next.created"
      ? "session.created"
      : current.type === "session.next.deleted"
        ? "session.deleted"
        : "session.updated"
  return { type: legacy, properties: { sessionID: projected.id, info: projected } }
}
```

- [ ] **Step 4: Implement the handlers in `server-session.ts`**（projector import 自 `@/utils/session-snapshot`；移除本地版本）

```ts
    if (event.type === "session.next.created" || event.type === "session.next.updated") {
      const info = projectSessionInfo(event.data.info)
      remember(info)
      if (info.time.archived) evict([info.id])
      return
    }
    if (event.type === "session.next.deleted") {
      const info = projectSessionInfo(event.data.info)
      infoSeen.delete(info.id)
      setData(
        "info",
        produce((draft) => void delete draft[info.id]),
      )
      evict([info.id])
      return
    }
    if (event.type === "session.next.status") {
      const status = event.data.status
      if (status.type === "busy") setData("session_status", sessionID, reconcile({ type: "busy" }))
      if (status.type === "idle") setData("session_status", sessionID, reconcile({ type: "idle" }))
      if (status.type === "retry")
        setData(
          "session_status",
          sessionID,
          reconcile({ type: "retry", attempt: status.attempt, message: status.message, next: status.next }),
        )
      // 不 return——讓尾塊的 settled/refresh 條件處理 idle。
    }
```

尾塊（素材 6.2 的 `settled` 計算與 context-refresh 條件清單）各加一條、且**只認 idle**：

```ts
    const settled =
      hasCurrentApi &&
      ((event.type === "session.status" && event.data.status.type === "idle") ||
        (event.type === "session.next.status" && event.data.status.type === "idle") ||
        eventType === "session.idle" ||
        eventType === "session.execution.succeeded" ||
        eventType === "session.execution.failed" ||
        eventType === "session.execution.interrupted")
```

context-refresh 條件清單加：

```ts
      (event.type === "session.next.status" && event.data.status.type === "idle") ||
```

- [ ] **Step 5: Route home-session index + tab cleanup**

(a) `packages/app/src/context/server-sync.tsx`（~645 的 routing，素材 v4 6.4 現況）：

```ts
    if (event.type === "session.created" || event.type === "session.updated" || event.type === "session.deleted") {
      homeSessions.apply(event)
    }
```

改為：

```ts
    if (event.type === "session.created" || event.type === "session.updated" || event.type === "session.deleted") {
      homeSessions.apply(event)
    }
    const homeSessionEvent = toHomeSessionEvent(event)
    if (homeSessionEvent) homeSessions.apply(homeSessionEvent)
```

（`import { toHomeSessionEvent } from "@/utils/session-snapshot"`。adapter 把 current V2 payload 保存在 `event.current.data`，頂層只有 legacy-compatible `event.properties`，不存在 `event.data`；routing 必須透過上述已測純函式讀 `event.current`。）

(b) `packages/app/src/components/titlebar-session-events.ts`（素材 v6 §3 現況的 `event.current` 分支）：

```ts
    const archived = type === "session.deleted" || type === "session.archived" || (type === "session.updated" && time?.archived !== undefined)
```

改為：

```ts
    const archived =
      type === "session.deleted" ||
      type === "session.next.deleted" ||
      type === "session.archived" ||
      (type === "session.updated" && time?.archived !== undefined) ||
      (type === "session.next.updated" && time?.archived !== undefined)
```

（`event.current` 分支的 `data.sessionID` 取用不變——`session.next.*` 的 data 同形。）

- [ ] **Step 6: Tests for home routing + tab cleanup**

(a) 修改既有的 `packages/app/src/components/titlebar-session-events.test.ts`（colocated；純函式測試無需 DOM），擴充 V2 lifecycle 覆蓋：

```ts
import { describe, expect, test } from "bun:test"
import { sessionTabsRemovedFromServerEvent } from "./titlebar-session-events"
import type { ServerConnection } from "@/context/server"
import type { ServerEvent } from "@/context/server-sdk"

const server = "https://server" as ServerConnection.Key

const currentEvent = (type: string, data: Record<string, unknown>): ServerEvent =>
  ({
    current: {
      type,
      data: { sessionID: "ses_x", ...data },
    },
  }) as ServerEvent

test("closes tabs for session.next.deleted", () => {
  const result = sessionTabsRemovedFromServerEvent({
    server,
    directory: "/repo",
    event: currentEvent("session.next.deleted", {}),
  })
  expect(result?.sessionIDs).toEqual(["ses_x"])
})

test("closes tabs for archived session.next.updated snapshots", () => {
  const result = sessionTabsRemovedFromServerEvent({
    server,
    directory: "/repo",
    event: currentEvent("session.next.updated", { info: { time: { archived: 3 } } }),
  })
  expect(result?.sessionIDs).toEqual(["ses_x"])
})

test("keeps tabs for non-archived session.next.updated snapshots", () => {
  const result = sessionTabsRemovedFromServerEvent({
    server,
    directory: "/repo",
    event: currentEvent("session.next.updated", { info: { time: {} } }),
  })
  expect(result).toBeUndefined()
})
```

（`ServerEvent`/`current` 的型別形狀以素材 v6 §3 的實際判讀邏輯為準——`record(current.data)` 取 `data.sessionID` 與 `data.info.time`；測試物件用 `as ServerEvent` 的 cast 屬既有測試慣例。）

(b) `packages/app/src/utils/session-snapshot.test.ts` 的三個 routing 測試保持綠；它們是 `server-sync.tsx` 接線的純函式 seam，證明 adapted event 從 `event.current` 投影成 `HomeSessionEvent`。`applyHomeSessionEvent` 本身不改，既有 `global-sync/home-session-index.test.ts` 繼續覆蓋 cache reducer。

- [ ] **Step 7: Run tests + typecheck**

Run: `cd packages/app && bun test src/context/server-session.test.ts src/utils/session-snapshot.test.ts src/components/titlebar-session-events.test.ts src/context/global-sync/home-session-index.test.ts` + `bun typecheck`。

- [ ] **Step 8: Commit**

```powershell
git add packages/app/src/utils/session-snapshot.ts packages/app/src/utils/session-snapshot.test.ts packages/app/src/context/server-session.ts packages/app/src/context/server-session.test.ts packages/app/src/context/server-sync.tsx packages/app/src/components/titlebar-session-events.ts packages/app/src/components/titlebar-session-events.test.ts
git -c core.hooksPath=.git/hooks commit -m "fix(app): consume session.next lifecycle and status events"
```

---

## Batch 3

### Task 5: Route the background title update through the canonical mutation boundary (A6)

**Files:**
- Create: `packages/core/src/session/mutation.ts`（完整實作見 Step 3）
- Modify: `packages/core/src/session.ts`（改用共用模組；wrapper 命名 `mutate`；三個 call site）
- Modify: `packages/core/src/session/execution/local.ts`（`updateSessionTitle` 走 boundary）
- Modify: `packages/core/test/session-execution-recovery.test.ts`（真實 drain 觸發 title 路徑）

**Interfaces:**
- Produces（named exports）：
  ```ts
  export type SnapshotTransform = (snapshot: SessionEvent.SessionSnapshot, timestamp: DateTime.Utc) => SessionEvent.SessionSnapshot
  export function rowToSnapshot(row: typeof SessionTable.$inferSelect): SessionEvent.SessionSnapshot
  export function mutateSession(db: Database.Interface["db"], events: EventV2.Interface, sessionID: SessionSchema.ID, next: SnapshotTransform): Effect.Effect<SessionSchema.Info, NotFoundError>
  ```

- [ ] **Step 1: Write the failing tests**（真實 drain 路徑：`execution.wake` → `execution.wait` barrier——素材 D1/D2 的 fixture）

`packages/core/test/session-execution-recovery.test.ts` 新增（imports 補 `and`（drizzle-orm）、`EventTable`（`@opencode-ai/core/event/sql`）；`commandLayer`/`makeLocationLayer`/`setupProject` 為現有 fixture）：

```ts
const titleSessionID = SessionSchema.ID.make("ses_title_update")
const titleUserID = SessionMessage.ID.make("msg_title_user")
const titleAssistantID = SessionMessage.ID.make("msg_title_assistant")

const withExecution = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const database = yield* Database.Service
    const events = yield* EventV2.Service
    return yield* effect.pipe(
      Effect.provide(
        LayerNode.compile(SessionExecutionLocal.node, [
          [Database.node, Layer.succeed(Database.Service, database)],
          [EventV2.node, Layer.succeed(EventV2.Service, events)],
          [LocationServiceMap.node, makeLocationLayer({ count: 0 })],
          [SessionCommand.node, commandLayer],
        ]),
      ),
    )
  })

const seedTitleSession = (title: string) =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const events = yield* EventV2.Service
    yield* setupProject([{ id: titleSessionID }])
    yield* db.update(SessionTable).set({ title }).where(eq(SessionTable.id, titleSessionID)).run().pipe(Effect.orDie)
    yield* events.publish(SessionEvent.PromptAdmitted, {
      sessionID: titleSessionID,
      messageID: titleUserID,
      timestamp: DateTime.makeUnsafe(1),
      prompt: Prompt.make({ text: "Summarize the plan document" }),
      delivery: "steer",
      intent: { type: "start" },
    })
    yield* SessionInput.promote(db, events, titleSessionID, titleUserID)
    yield* SessionTurn.start(events, { sessionID: titleSessionID, turnID: titleUserID, timestamp: DateTime.makeUnsafe(2) })
  })

const updatedCount = () =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const rows = yield* db
      .select({ seq: EventTable.seq })
      .from(EventTable)
      .where(and(eq(EventTable.aggregate_id, titleSessionID), eq(EventTable.type, "session.next.updated.1")))
      .all()
      .pipe(Effect.orDie)
    return rows.length
  })

it.effect("background title update publishes exactly one session.next.updated.1 through a real drain", () =>
  Effect.gen(function* () {
    yield* seedTitleSession("New session - title")
    const before = yield* updatedCount()
    yield* withExecution(
      Effect.gen(function* () {
        const execution = yield* SessionExecution.Service
        yield* execution.wake(titleSessionID)
        yield* execution.wait(titleSessionID)
      }),
    )
    const { db } = yield* Database.Service
    const row = yield* db.select().from(SessionTable).where(eq(SessionTable.id, titleSessionID)).get().pipe(Effect.orDie)
    expect(row?.title).toBe("Summarize the plan document")
    expect(yield* updatedCount()).toBe(before + 1)
  }),
)

it.effect("background title update leaves non-default titles untouched", () =>
  Effect.gen(function* () {
    yield* seedTitleSession("Keep Me")
    const before = yield* updatedCount()
    yield* withExecution(
      Effect.gen(function* () {
        const execution = yield* SessionExecution.Service
        yield* execution.wake(titleSessionID)
        yield* execution.wait(titleSessionID)
      }),
    )
    const { db } = yield* Database.Service
    const row = yield* db.select().from(SessionTable).where(eq(SessionTable.id, titleSessionID)).get().pipe(Effect.orDie)
    expect(row?.title).toBe("Keep Me")
    expect(yield* updatedCount()).toBe(before)
  }),
)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/core && bun test test/session-execution-recovery.test.ts`。Expected: 事件計數 test FAIL（修復前 title 直接寫 DB、零事件）；guard test 綠（修復前後都該過）。

- [ ] **Step 3: Create `packages/core/src/session/mutation.ts`**（完整實作）

```ts
import { DateTime, Effect } from "effect"
import { eq } from "drizzle-orm"
import { Database } from "../database/database"
import { EventV2 } from "../event"
import { SessionEvent } from "./event"
import { fromRow } from "./info"
import { SessionSchema } from "./schema"
import { SessionTable } from "./sql"
import { NotFoundError } from "./command"

export type SnapshotTransform = (
  snapshot: SessionEvent.SessionSnapshot,
  timestamp: DateTime.Utc,
) => SessionEvent.SessionSnapshot

export function rowToSnapshot(row: typeof SessionTable.$inferSelect): SessionEvent.SessionSnapshot {
  const info = fromRow(row)
  return SessionEvent.SessionSnapshot.make({
    id: info.id,
    parentID: info.parentID,
    projectID: info.projectID,
    slug: row.slug,
    version: row.version,
    agent: info.agent,
    model: info.model,
    cost: info.cost,
    tokens: info.tokens,
    time: info.time,
    title: info.title,
    metadata: row.metadata ?? undefined,
    share: info.share,
    permission: row.permission ? [...row.permission] : undefined,
    location: info.location,
    subpath: info.subpath,
    revert: info.revert,
  })
}

export function mutateSession(
  db: Database.Interface["db"],
  events: EventV2.Interface,
  sessionID: SessionSchema.ID,
  next: SnapshotTransform,
) {
  const attempt = Effect.gen(function* () {
    // Invariant: the aggregate sequence must be read before the session row.
    // Any commit between the two reads makes expectedSeq stale and the publish
    // conflicts, so the retry re-reads both; reading the row first would let an
    // old snapshot pair with a fresh sequence and pass the CAS, silently
    // overwriting the newer mutation's projection.
    const expectedSeq = yield* EventV2.latestSequence(db, sessionID)
    const row = yield* db
      .select()
      .from(SessionTable)
      .where(eq(SessionTable.id, sessionID))
      .get()
      .pipe(Effect.orDie)
    if (!row) return yield* new NotFoundError({ sessionID })
    const timestamp = yield* DateTime.now
    const info = next(rowToSnapshot(row), timestamp)
    yield* events.publish(
      SessionEvent.Updated,
      { timestamp, sessionID, info },
      { location: fromRow(row).location, expectedSeq },
    )
    const fresh = yield* db
      .select()
      .from(SessionTable)
      .where(eq(SessionTable.id, sessionID))
      .get()
      .pipe(Effect.orDie)
    if (!fresh) return yield* new NotFoundError({ sessionID })
    return fromRow(fresh)
  })
  const retry = (remaining: number): Effect.Effect<SessionSchema.Info, NotFoundError> =>
    attempt.pipe(
      Effect.catchDefect((defect) =>
        defect instanceof EventV2.ConflictError && remaining > 0 ? retry(remaining - 1) : Effect.die(defect),
      ),
    )
  return retry(32)
}
```

（本檔的 `rowToSnapshot` 逐字對應 session.ts 現行 layer-local 版本——建立後先 diff 兩者確保一致。）

- [ ] **Step 4: Rewire session.ts and local.ts**

(a) `packages/core/src/session.ts`：
```ts
import { mutateSession, rowToSnapshot, type SnapshotTransform } from "./session/mutation"
```
刪除 layer-local 的 `rowToSnapshot` 與 `mutateSession`。加 wrapper：
```ts
    const mutate = (sessionID: SessionSchema.ID, next: SnapshotTransform) => mutateSession(db, events, sessionID, next)
```
三個 call site 改為 `mutate(...)`：`publishCompatibilityUpdate`（~476）、`update`（~537）、`setPermissions`（~567）。立即跑既有 mutateSession 相關測試，零斷言改動必須綠。

(b) `packages/core/src/session/execution/local.ts` `updateSessionTitle`（242-259）：保留 heuristic guard；直接寫 DB 段改為：

```ts
      yield* mutateSession(db, events, sessionID, (snapshot, timestamp) =>
        SessionEvent.SessionSnapshot.make({
          ...snapshot,
          title,
          time: { ...snapshot.time, updated: timestamp },
        }),
      ).pipe(
        Effect.catchTag("Session.NotFoundError", () => Effect.void),
      )
```

`import { mutateSession } from "../mutation"`（named，無 alias）。`SessionTable` 的直接寫入引用若不再使用則移除對應 import。

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/core && bun test test/session-execution-recovery.test.ts test/session-create.test.ts test/session-projector.test.ts` + `bun typecheck`；`cd packages/server && bun typecheck`；`cd packages/opencode && bun typecheck`。

- [ ] **Step 6: Commit**

```powershell
git add packages/core/src/session/mutation.ts packages/core/src/session.ts packages/core/src/session/execution/local.ts packages/core/test/session-execution-recovery.test.ts
git -c core.hooksPath=.git/hooks commit -m "fix(core): publish session updates for background title changes"
```

### Task 6: Migrate the workflow permission ask to blocking PermissionV2.assert (A7)

**Files:**
- Modify: `packages/opencode/src/session/llm.ts`（唯一生產檔）
- Create: `packages/opencode/test/session/workflow-approval.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const requestWorkflowApproval = Effect.fn("LLM.requestWorkflowApproval")(function* (input: {
    sessionID: string
    approvalTools: ReadonlyArray<{ name: string; args: string }>
  }): Effect.Effect<{ approved: boolean }, never> { ... })
  ```

- [ ] **Step 1: Implementation spec**

`packages/opencode/src/session/llm.ts`——新增 `SessionStore`（`@opencode-ai/core/session/store`）、`LocationServiceMap`（`@opencode-ai/core/location-service-map`）、`PermissionV2`（`@opencode-ai/core/permission`），並把現有 `import { Context, Effect, Layer } from "effect"` 擴充為 `import { Context, Effect, Layer, Option, Schema } from "effect"`；同時移除既有的 `import * as Option from "effect/Option"`，避免違反本計劃的 no-star-import 約束。module-level：

```ts
export const requestWorkflowApproval = Effect.fn("LLM.requestWorkflowApproval")(function* (input: {
  sessionID: string
  approvalTools: ReadonlyArray<{ name: string; args: string }>
}) {
  const sessions = yield* SessionStore.Service
  const locations = yield* LocationServiceMap.Service
  const session = yield* sessions.get(SessionID.make(input.sessionID))
  if (!session) return { approved: false as const }
  const decode = Schema.decodeUnknownOption(Schema.UnknownFromJsonString)
  const uniquePatterns = [
    ...new Set(
      input.approvalTools.map((tool) => {
        const parsed = decode(tool.args)
        if (Option.isNone(parsed)) return tool.name
        const value = parsed.value
        if (typeof value !== "object" || value === null) return tool.name
        const record = value as Record<string, unknown>
        const title =
          typeof record.title === "string" && record.title
            ? record.title
            : typeof record.name === "string" && record.name
              ? record.name
              : ""
        return title ? `${tool.name}: ${title}` : tool.name
      }),
    ),
  ]
  return yield* Effect.gen(function* () {
    const permission = yield* PermissionV2.Service
    yield* permission.assert({
      sessionID: SessionID.make(input.sessionID),
      action: "workflow_tool_approval",
      resources: uniquePatterns,
      save: uniquePatterns,
      metadata: { tools: input.approvalTools },
      // source 省略：唯一合法 Source 為 {type:"tool", messageID, callID}，多工具 workflow 無法真實提供。
    })
    return { approved: true as const }
  }).pipe(
    Effect.provide(locations.get(session.location)),
    Effect.catchTag("PermissionV2.BlockedError", () => Effect.succeed({ approved: false as const })),
    Effect.catchTag("PermissionV2.CorrectedError", (error) =>
      Effect.logDebug("workflow tool approval corrected", { feedback: error.feedback }).pipe(
        Effect.as({ approved: false as const }),
      ),
    ),
    Effect.catchTag("Session.NotFoundError", () => Effect.succeed({ approved: false as const })),
    Effect.catchDefect((defect) =>
      defect instanceof PermissionV2.DeclinedError ? Effect.succeed({ approved: false as const }) : Effect.die(defect),
    ),
  )
})
```

handler 改寫（素材 E2 的 auto-approve cache 保留；async callback 內無 `yield*`）：

```ts
        workflowModel.approvalHandler = bridge.bind(async (approvalTools) => {
          const uniqueNames = [...new Set(approvalTools.map((t: { name: string }) => t.name))] as string[]
          if (uniqueNames.every((name) => approvedToolsForSession.has(name))) {
            return { approved: true }
          }
          const result = await bridge.promise(
            requestWorkflowApproval({ sessionID: input.sessionID, approvalTools }),
          )
          if (!result.approved) return { approved: false }
          for (const name of uniqueNames) approvedToolsForSession.add(name)
          workflowModel.sessionPreapprovedTools = [...(workflowModel.sessionPreapprovedTools ?? []), ...uniqueNames]
          return { approved: true }
        })
```

layer 清潔（素材 E4）：移除 `const perm = yield* Permission.Service`、`const events = yield* EventV2Bridge.Service`、`live` 型別中的 `| Permission.Service | EventV2Bridge.Service`、node deps 的 `Permission.node`、`EventV2Bridge.node`；移除不再使用的 imports（`PermissionV1`、`EventV2Bridge`、`EventV2`）；`Permission` import 保留（:149 的 pure `merge`）。

- [ ] **Step 2: Write the failing tests**

`packages/opencode/test/session/workflow-approval.test.ts`——**scoped LayerMap + compiled PermissionV2 node 模式**。`testEffect` 已包 `Effect.scoped`，`forkScoped` 可直接使用；`requestWorkflowApproval` 與測試內的 `reply()` 從同一個 scope、同一個記憶化 location layer 取得同一個真實 `PermissionV2` 實例。`PermissionV2.node` 的 dependencies 全部用 `AppNodeBuilder.build(..., replacements)` 明確替換，不能直接組 `PermissionV2.locationLayer` 或用 cast 隱藏缺失依賴：

```ts
import { describe, expect } from "bun:test"
import { AgentV2 } from "@opencode-ai/core/agent"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { Location } from "@opencode-ai/core/location"
import { LocationServiceMap } from "@opencode-ai/core/location-service-map"
import type { LocationServices } from "@opencode-ai/core/location-services"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { PermissionSaved } from "@opencode-ai/core/permission/saved"
import { PluginRuntime } from "@opencode-ai/core/plugin/runtime"
import { Project } from "@opencode-ai/core/project"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionStore } from "@opencode-ai/core/session/store"
import { DateTime, Deferred, Effect, Fiber, Layer, LayerMap, Stream } from "effect"
import { requestWorkflowApproval } from "@/session/llm"
import { testEffect } from "../lib/effect"

const directory = AbsolutePath.make("/project")
const sessionID = "ses_workflow"
let sessionPermissions: PermissionV2.Ruleset = []
const locationRef = Location.Ref.make({ directory })

const sessions = new Map<string, SessionV2.Info>()
sessions.set(
  sessionID,
  SessionV2.Info.make({
    id: SessionV2.ID.make(sessionID),
    projectID: Project.ID.global,
    title: "test",
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: DateTime.makeUnsafe(0), updated: DateTime.makeUnsafe(0) },
    location: locationRef,
  }),
)

const sharedSessions = Layer.mock(
  SessionStore.Service,
  {
    get: (id) => Effect.sync(() => sessions.get(id)),
    permissions: () => Effect.sync(() => [...sessionPermissions]),
    latestPrompt: () => Effect.succeed(undefined),
  },
)

const eventLayer = Layer.sync(EventV2.Service, () => {
  const listeners = new Set<EventV2.Subscriber>()
  return EventV2.Service.of({
    publish: (definition, data) =>
      Effect.gen(function* () {
        const event = {
          id: EventV2.ID.create(),
          type: definition.type,
          data,
        } as EventV2.Payload<typeof definition>
        yield* Effect.forEach(listeners, (listener) => listener(event), { discard: true })
        return event
      }),
    subscribe: () => Stream.empty,
    all: () => Stream.empty,
    durable: () => Stream.empty,
    listen: (listener) =>
      Effect.sync(() => {
        listeners.add(listener)
        return Effect.sync(() => void listeners.delete(listener))
      }),
    project: () => Effect.void,
    replay: () => Effect.void,
    replayAll: () => Effect.succeed(undefined),
    remove: () => Effect.void,
    claim: () => Effect.void,
  })
})

function focusedLocationLayer(
  ref: Location.Ref,
  events: EventV2.Interface,
  sessionStore: SessionStore.Interface,
): Layer.Layer<LocationServices> {
  const agent = AgentV2.Info.empty(AgentV2.ID.make("test"))
  const layer = AppNodeBuilder.build(
    LayerNode.group([Location.node, PermissionV2.node]),
    [
      [
        Location.node,
        Layer.succeed(
          Location.Service,
          Location.Service.of({
            directory: ref.directory,
            workspaceID: ref.workspaceID,
            project: { id: Project.ID.global, directory: ref.directory },
          }),
        ),
      ],
      [EventV2.node, Layer.succeed(EventV2.Service, events)],
      [SessionStore.node, Layer.succeed(SessionStore.Service, sessionStore)],
      [
        AgentV2.node,
        Layer.mock(AgentV2.Service, {
          resolve: () => Effect.succeed(agent),
        }),
      ],
      [
        PermissionSaved.node,
        Layer.mock(PermissionSaved.Service, {
          list: () => Effect.succeed([]),
          add: () => Effect.void,
          remove: () => Effect.void,
        }),
      ],
      [
        PluginRuntime.node,
        Layer.mock(PluginRuntime.Service, {
          run: (_name, event) => Effect.succeed(event),
        }),
      ],
    ],
  )

  // LayerMap requires the complete LocationServices output. This focused graph
  // intentionally exposes only Location + PermissionV2; all of PermissionV2's
  // own dependencies were compiled and validated above.
  return layer as unknown as Layer.Layer<LocationServices>
}

const locationMapLayer = Layer.effect(
  LocationServiceMap.Service,
  Effect.gen(function* () {
    const events = yield* EventV2.Service
    const sessionStore = yield* SessionStore.Service
    return yield* LayerMap.make(
      (ref: Location.Ref) => focusedLocationLayer(ref, events, sessionStore),
      { idleTimeToLive: "1 minute" },
    )
  }),
)

const globals = Layer.mergeAll(eventLayer, sharedSessions)
const it = testEffect(locationMapLayer.pipe(Layer.provideMerge(globals)))

const inLocation = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    return yield* effect
  }).pipe(Effect.provide(LocationServiceMap.Service.get(locationRef)))

const startApproval = (message = "{}") =>
  Effect.gen(function* () {
    const events = yield* EventV2.Service
    const asked = yield* Deferred.make<PermissionV2.Request>()
    const unsubscribe = yield* events.listen((event) =>
      event.type === PermissionV2.Event.Asked.type
        ? Deferred.succeed(asked, event.data as PermissionV2.Request).pipe(Effect.asVoid)
        : Effect.void,
    )
    yield* Effect.addFinalizer(() => unsubscribe)
    const fiber = yield* requestWorkflowApproval({
      sessionID,
      approvalTools: [{ name: "deploy", args: message }],
    }).pipe(Effect.forkScoped)
    const request = yield* Deferred.await(asked)
    return { fiber, request }
  })

const reply = (request: PermissionV2.Request, input: Omit<PermissionV2.ReplyInput, "requestID">) =>
  inLocation(
    Effect.gen(function* () {
      const permission = yield* PermissionV2.Service
      yield* permission.reply({ requestID: request.id, ...input })
    }),
  )

describe("workflow tool approval", () => {
  it.effect("approves after the V2 reply arrives", () =>
    Effect.gen(function* () {
      sessionPermissions = []
      const approval = yield* startApproval()
      yield* reply(approval.request, { reply: "once" })
      const result = yield* Fiber.join(approval.fiber)
      expect(result.approved).toBe(true)
    }),
  )

  it.effect("rejects when the user declines", () =>
    Effect.gen(function* () {
      sessionPermissions = []
      const approval = yield* startApproval()
      yield* reply(approval.request, { reply: "reject" })
      const result = yield* Fiber.join(approval.fiber)
      expect(result.approved).toBe(false)
    }),
  )

  it.effect("returns false when the user replies with corrected feedback", () =>
    Effect.gen(function* () {
      sessionPermissions = []
      const approval = yield* startApproval()
      yield* reply(approval.request, { reply: "reject", message: "please scope it" })
      const result = yield* Fiber.join(approval.fiber)
      expect(result.approved).toBe(false)
    }),
  )

  it.effect("returns false when session rules block the action", () =>
    Effect.gen(function* () {
      sessionPermissions = [{ action: "workflow_tool_approval", resource: "*", effect: "deny" }]
      const result = yield* requestWorkflowApproval({
        sessionID,
        approvalTools: [{ name: "deploy", args: "{}" }],
      })
      expect(result.approved).toBe(false)
      yield* inLocation(
        Effect.gen(function* () {
          const permission = yield* PermissionV2.Service
          expect(yield* permission.list()).toEqual([])
        }),
      )
    }),
  )

  it.effect("returns false for a missing session", () =>
    Effect.gen(function* () {
      const result = yield* requestWorkflowApproval({
        sessionID: "ses_missing",
        approvalTools: [],
      })
      expect(result.approved).toBe(false)
    }),
  )
})
```

（唯一的 `as unknown as Layer.Layer<LocationServices>` 位於 repo 既有的 focused LayerMap seam；它只宣告這個測試 map 不輸出其餘未使用的 location services。`PermissionV2.node` 自身的 `EventV2`、`Location`、`AgentV2`、`SessionStore`、`PermissionSaved`、`PluginRuntime` 依賴全部由 `AppNodeBuilder` 驗證，不能以 cast 取代。Asked event 的 `Deferred` 是確定性 barrier；不得改回 `yieldNow()` 或 sleep。）

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd packages/opencode && bun test test/session/workflow-approval.test.ts`。Expected: `requestWorkflowApproval` 不存在 → FAIL。

- [ ] **Step 4: Implement**（Step 1 的代碼）

- [ ] **Step 5: Run tests + typechecks**

Run: `cd packages/opencode && bun test test/session/workflow-approval.test.ts` + `bun typecheck`；`cd packages/server && bun typecheck`。

- [ ] **Step 6: Commit**

```powershell
git add packages/opencode/src/session/llm.ts packages/opencode/test/session/workflow-approval.test.ts
git -c core.hooksPath=.git/hooks commit -m "fix(opencode): migrate the workflow permission ask to PermissionV2"
```

---

## Batch 4

### Task 7: Restore the desktop navigation policy with the upstream external-url module (A8)

**Files:**
- Create: `packages/desktop/src/main/external-url.ts`（上游 resolve 函式 + `MinimalWebContents` + 注入式 `wireNavigationPolicy`）
- Create: `packages/desktop/src/main/external-url.test.ts`（colocated）
- Modify: `packages/desktop/src/main/windows.ts`（`openExternalURL`/`openLocalFileURL` **定義於此**——上游 parity；`createMainWindow` 接線 `wireNavigationPolicy(win, openExternalURL, isRendererUrl)`）
- Modify: `packages/desktop/src/main/ipc.ts`（`open-link` → `openExternalURL`，**import 自 `./windows`**）
- Modify: `packages/desktop/src/main/menu.ts`（`entry.href` → `openExternalURL`，**import 自 `./windows`**）

**Interfaces:**
- `external-url.ts`：
  ```ts
  export function resolveExternalURL(value: string): string | undefined
  export function resolveLocalFilePath(value: string): string | undefined
  export interface MinimalWebContents {
    setWindowOpenHandler(handler: (details: { url: string }) => { action: "deny" }): void
    on(event: "will-navigate", listener: (event: { preventDefault(): void }, url: string) => void): void
  }
  export function wireNavigationPolicy(
    win: { webContents: MinimalWebContents },
    openExternal: (url: string) => void,
    isRendererURL: (value?: string) => boolean,
  ): void
  ```
- `windows.ts` exports：`openExternalURL(value: string): void`、`openLocalFileURL(value: string): void`。

- [ ] **Step 1: Write the failing tests**

`packages/desktop/src/main/external-url.test.ts`：

```ts
import { describe, expect, test } from "bun:test"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { resolveExternalURL, resolveLocalFilePath, wireNavigationPolicy, type MinimalWebContents } from "./external-url"

describe("external URLs", () => {
  test("opens web URLs externally", () => {
    expect(resolveExternalURL("https://example.com/a?b=c")).toBe("https://example.com/a?b=c")
    expect(resolveExternalURL("http://example.com")).toBe("http://example.com/")
  })

  test("opens mail links externally", () => {
    expect(resolveExternalURL("mailto:hello@opencode.ai")).toBe("mailto:hello@opencode.ai")
  })

  test("rejects file URLs and unsupported protocols", () => {
    expect(resolveExternalURL("file:///tmp/index.html")).toBeUndefined()
    expect(resolveExternalURL("javascript:alert(1)")).toBeUndefined()
    expect(resolveExternalURL("data:text/html,hello")).toBeUndefined()
    expect(resolveExternalURL("not a url")).toBeUndefined()
  })

  test("resolves only local file URLs", () => {
    const path = resolve("example.html")
    expect(resolveLocalFilePath(pathToFileURL(path).href)).toBe(path)
    expect(resolveLocalFilePath("file://example.com/share/index.html")).toBeUndefined()
    expect(resolveLocalFilePath("https://example.com/index.html")).toBeUndefined()
  })
})

describe("navigation policy", () => {
  test("denies every popup and routes only external navigations", () => {
    const opened: string[] = []
    let openHandler: ((details: { url: string }) => { action: "deny" }) | undefined
    let navListener: ((event: { preventDefault(): void }, url: string) => void) | undefined
    const webContents: MinimalWebContents = {
      setWindowOpenHandler: (handler) => {
        openHandler = handler
      },
      on: (event, listener) => {
        if (event === "will-navigate") navListener = listener
      },
    }
    const isRendererURL = (value?: string) => value === "oc://renderer/index.html"
    wireNavigationPolicy({ webContents }, (url) => opened.push(url), isRendererURL)

    expect(openHandler!({ url: "oc://renderer/index.html" })).toEqual({ action: "deny" })
    expect(opened).toEqual([])

    openHandler!({ url: "https://example.com" })
    expect(opened).toEqual(["https://example.com"])

    let prevented = false
    navListener!({ preventDefault: () => (prevented = true) }, "https://example.com")
    expect(prevented).toBe(true)
    expect(opened).toHaveLength(2)

    prevented = false
    navListener!({ preventDefault: () => (prevented = true) }, "oc://renderer/index.html")
    expect(prevented).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/desktop && bun test src/main/external-url.test.ts`。Expected: module 不存在 → FAIL。

- [ ] **Step 3: Implement `external-url.ts`**

```ts
import { fileURLToPath } from "node:url"

export function resolveExternalURL(value: string) {
  if (!URL.canParse(value)) return undefined
  const url = new URL(value)
  if (url.protocol === "http:" || url.protocol === "https:" || url.protocol === "mailto:") return url.href
  return undefined
}

export function resolveLocalFilePath(value: string) {
  if (!URL.canParse(value)) return undefined
  const url = new URL(value)
  if (url.protocol !== "file:" || url.hostname) return undefined
  try {
    return fileURLToPath(url)
  } catch {
    return undefined
  }
}

export interface MinimalWebContents {
  setWindowOpenHandler(handler: (details: { url: string }) => { action: "deny" }): void
  on(event: "will-navigate", listener: (event: { preventDefault(): void }, url: string) => void): void
}

export function wireNavigationPolicy(
  win: { webContents: MinimalWebContents },
  openExternal: (url: string) => void,
  isRendererURL: (value?: string) => boolean,
) {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!isRendererURL(url)) openExternal(url)
    return { action: "deny" }
  })
  win.webContents.on("will-navigate", (event, url) => {
    if (isRendererURL(url)) return
    event.preventDefault()
    openExternal(url)
  })
}
```

- [ ] **Step 4: Wire the three consumers**

`windows.ts`（`shell` 在 electron import 中或補上；`import { resolveExternalURL, resolveLocalFilePath, wireNavigationPolicy } from "./external-url"`）：

```ts
export function openExternalURL(value: string) {
  const url = resolveExternalURL(value)
  if (!url) {
    writeLog("window", "blocked external target", { url: value }, "warn")
    return
  }
  void shell.openExternal(url)
}

export function openLocalFileURL(value: string) {
  const path = resolveLocalFilePath(value)
  if (!path) {
    writeLog("window", "blocked local file target", { url: value }, "warn")
    return
  }
  void shell.openPath(path).then((error) => {
    if (error) writeLog("window", "failed to open local file", { path, error }, "error")
  })
}
```

`createMainWindow` 中 `wireWindowRecovery(win, id)` 後加 `wireNavigationPolicy(win, openExternalURL, isRendererUrl)`。

`ipc.ts`（素材 F2 的 `open-link` handler；`import { openExternalURL } from "./windows"`）：

```ts
  ipcMain.on("open-link", (_event: IpcMainEvent, url: string) => {
    openExternalURL(url)
  })
```

`menu.ts`（素材 F3；`import { openExternalURL } from "./windows"`）：

```ts
  if (entry.href) {
    const href = entry.href
    item.click = () => openExternalURL(href)
  }
```

- [ ] **Step 5: Run tests + typecheck**

Run: `cd packages/desktop && bun test src/main/external-url.test.ts` + `bun typecheck`。

- [ ] **Step 6: Commit**

```powershell
git add packages/desktop/src/main/external-url.ts packages/desktop/src/main/external-url.test.ts packages/desktop/src/main/windows.ts packages/desktop/src/main/ipc.ts packages/desktop/src/main/menu.ts
git -c core.hooksPath=.git/hooks commit -m "fix(desktop): restore the renderer navigation policy"
```

---

## Post-Task Verification (all tasks complete)

- [ ] `cd packages/core && bun test test/session-execution-recovery.test.ts test/session-create.test.ts test/session-projector.test.ts && bun typecheck`
- [ ] `cd packages/session-ui && bun test src/components/message-part.test.tsx --preload ./happydom.ts && bun test src/components/markdown-stream.test.ts && bun typecheck`
- [ ] `cd packages/ui && bun typecheck`
- [ ] `cd packages/app && bun test src/utils/session-message.test.ts src/pages/session/timeline/rows-current.test.ts src/context/server-session.test.ts src/utils/session-snapshot.test.ts src/components/titlebar-session-events.test.ts src/context/global-sync/home-session-index.test.ts src/context/settings.test.ts src/i18n/parity.test.ts && bun typecheck`
- [ ] `cd packages/server && bun typecheck`
- [ ] `cd packages/opencode && bun test test/session/workflow-approval.test.ts && bun typecheck`
- [ ] `cd packages/desktop && bun test src/main/external-url.test.ts && bun typecheck`
- [ ] `git diff --check` + explicit staged-file audit (protected untracked files untouched)
- [ ] Update the ledger `.superpowers/sdd/2026-08-13-desktop-display-fixes/progress.md`
- [ ] Update `D:\agent-complete\fork桌面版顯示bug定位報告.md`'s fix-status — outside the repo, no commit needed
- [ ] Do not push unless the user explicitly asks
