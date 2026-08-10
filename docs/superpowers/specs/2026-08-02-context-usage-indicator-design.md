# Composer Context Usage Indicator

## Status

Approved design for implementation on branch `999.0.4`.

## Goal

Make the session context usage indicator easier to read at a glance by moving the
small circular indicator from the session header into the prompt composer, using
the compact percentage and used/limit presentation shown in Codex.

The existing context details view must remain in its current location and retain
its current contents and navigation behavior.

## Scope

### In scope

- Move the header-level `SessionContextUsage` control into the prompt composer.
- Support both the legacy composer and the new-layout/V2 composer.
- Display the context percentage and compact used/limit token counts in the
  composer.
- Keep the control clickable so it opens the existing context details tab.
- Keep the existing hover/focus details for cost, percentage, and total tokens.
- Preserve localized text and accessible button labels.

### Out of scope

- Moving or redesigning the context details panel.
- Changing token accounting, model context limits, compaction, or server APIs.
- Adding a new context estimation algorithm before the first assistant response.
- Changing the context-tab indicator used inside the side-panel tab label.

## Existing implementation

`packages/app/src/components/session-context-usage.tsx` already owns the context
usage calculation view, the tooltip, and the action that opens the context tab.
It obtains the last assistant message and model limit through
`getSessionContext` in `packages/app/src/components/session/session-context-metrics.ts`.
The total is the same value currently shown as Token in the tooltip and includes
input, output, reasoning, and cache tokens.

The header usage button is rendered by the message timeline. The prompt is
rendered through `SessionComposerRegion`, with either the legacy `PromptInput` or
the V2 `PromptInputV2Composer` selected by the session layout setting.

## Proposed design

### Placement

Remove only the header-level usage control identified in the supplied screenshot.
Render a new composer presentation in the bottom-right control area of both
prompt implementations. The existing context-tab button in the side panel and
the context details panel remain where they are.

The composer presentation must not cover the submit button or the model controls.
It should use the existing responsive composer layout and remain usable at narrow
widths; the token line may truncate while the full values remain available through
the tooltip.

### Content

The visible presentation is a compact two-part summary:

```text
Context window: 3%
Used: 31.6k / 1M
```

The wording is localized through the app translation tables. Token counts use a
compact locale-aware format (`k`, `M`, or the locale equivalent where supported),
while the tooltip keeps the existing full locale-formatted token count and cost.

The percentage and used/limit values come from the existing `getSessionContext`
result. No new server request or token calculation is introduced. If there is no
assistant token record yet, the composer summary is omitted rather than showing a
misleading zero. If the model context limit is unavailable, the indicator may
show the percentage as unavailable and display the known token count without
inventing a limit.

### Interaction and accessibility

- Clicking the summary invokes the existing `openContext` behavior.
- Hovering or keyboard focusing the control shows the existing cost, usage, and
  total-token tooltip.
- The control remains a real button with the localized context-usage aria label.
- The full token counts remain discoverable in the tooltip for users who need
  precise values.

## Data flow

```text
session messages + provider model limit
              |
      getSessionContext
              |
     SessionContextUsage
       /             \\
  tooltip        composer summary
                       |
                open existing context tab
```

The placement changes, but the data source and context-details navigation do not.
This keeps the legacy and V2 composers visually consistent without duplicating
context accounting logic.

## Error and edge handling

- No session or no token-bearing assistant message: do not render the composer
  summary.
- Missing context limit: avoid division by zero and show an unavailable percentage
  rather than `0%` or `Infinity%`.
- Usage above the limit: show the actual token count, cap only the visual progress
  treatment at 100%, and use the existing tooltip data.
- Small composer width: keep the summary compact and allow the text portion to
  truncate without disabling the click target or submit action.

## Verification plan

- Add or update focused tests for compact token formatting and missing/over-limit
  context values.
- Run the app focused unit tests covering context metrics and the composer usage
  control.
- Run `bun typecheck` from `packages/app`.
- Run the app production build and `git diff --check`.
- Manually verify both legacy and V2 composers: placement, tooltip, click-through
  to the unchanged context details panel, narrow-width behavior, and accessible
  labels.
