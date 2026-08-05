# Specialized Subagents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add explicit `research` and `worker` task subagents so the primary coordinator can choose a high-quality research model or a strong coding model by task, while preserving the existing `general` and `explore` behavior.

**Architecture:** `build` and `plan` remain primary coordinator permission modes and are not task targets. The task-targetable built-ins become `general`, `explore`, `research`, and `worker`; `general-purpose` remains an alias for `general`. `research` is read-only and optimized for deep analysis, while `worker` is write-capable and optimized for capable, reliable implementation at an acceptable cost. Existing agent-level model, protocol, and variant overrides remain the source of truth; no provider or model ID is hard-coded.

**Tech Stack:** TypeScript, Effect, Bun tests, SolidJS settings UI, V1 and V2 agent/task runtimes.

## Global Constraints

- Work only on branch `999.0.11`.
- Preserve existing `general` and `explore` IDs, prompts, permissions, model overrides, protocol overrides, variants, and historical session compatibility.
- Keep `general-purpose` normalization as `general`; do not map it to `research` or `worker`.
- Do not hard-code `gpt 5.6 sol`, `gpt 5.6 luna`, or any provider ID. These are user-selectable examples in the settings UI.
- `worker` means strong coding capability, good performance, and acceptable cost. It must not be described as a low-cost or low-capability role.
- Only agents with `mode: "subagent"` or `mode: "all"` may be task targets. Primary and hidden agents must be rejected by the task runtime.
- Keep V1 and V2 task descriptions and runtime validation behavior equivalent.
- TUI consumes the server task definition; do not add a separate TUI role registry.
- Do not edit generated SDK files directly. Run the required generation command if a public API changes.
- Run tests from package directories, never from the repository root.
- Keep the existing untracked test databases, temporary directories, and `packages/opencode/config.json` out of commits.

---

### Task 1: Add V2 built-in research and worker role contracts

**Files:**
- Modify: `packages/core/src/plugin/agent.ts`
- Modify: `packages/core/test/agent.test.ts`

**Interfaces:**
- Produces built-in V2 agents named `research` and `worker` with `mode: "subagent"`.
- `research` uses read-only search/read/web permissions and a dedicated deep-research system prompt.
- `worker` uses the existing full execution defaults, denies `todowrite` like `general`, and receives a bounded implementation system prompt.
- `general` and `explore` remain behaviorally unchanged.

- [x] **Step 1: Write failing V2 role tests.**

  Extend `packages/core/test/agent.test.ts` so the built-in ID assertion includes `research` and `worker`. Add assertions that:

  - `research` has `mode: "subagent"`, allows `read`, `grep`, `glob`, `webfetch`, and `websearch`, and has no non-deny edit permission.
  - `worker` has `mode: "subagent"`, allows the normal execution tools, and denies `todowrite`.
  - `general` still has its existing description and `subagent` mode.
  - `build`, `plan`, `compaction`, `title`, and `summary` remain primary or hidden as before.

- [x] **Step 2: Run the focused V2 agent test and verify it fails.**

  Run from `packages/core`:

  ```powershell
  bun test test/agent.test.ts
  ```

  Expected result: failure because `research` and `worker` are not registered yet.

- [x] **Step 3: Add the two V2 built-in definitions.**

  In `packages/core/src/plugin/agent.ts`:

  - Add `PROMPT_RESEARCH` explaining that the role performs deep, evidence-based, read-only investigation and must return paths, evidence, hypotheses, and remaining risks without editing files.
  - Add `PROMPT_WORKER` explaining that the role owns a bounded implementation scope, must inspect existing changes, modify only assigned files, run targeted tests, and report changed files and verification results.
  - Register `research` after `explore` with the read-only permission rules used by the V2 explorer role.
  - Register `worker` with the normal execution defaults and the same `todowrite` denial used by `general`.
  - Do not add a model field to either built-in. The existing configured model override will resolve the selected model, otherwise the child inherits its parent model.

- [x] **Step 4: Run the focused V2 agent test and verify it passes.**

  ```powershell
  bun test test/agent.test.ts
  ```

- [x] **Step 5: Commit the self-contained V2 role contract.**

  ```powershell
  git add packages/core/src/plugin/agent.ts packages/core/test/agent.test.ts
  git commit -m "feat(core): add research and worker subagents"
  ```

---

### Task 2: Mirror the role contracts in the V1 runtime

**Files:**
- Modify: `packages/opencode/src/agent/agent.ts`
- Create: `packages/opencode/src/agent/prompt/research.txt`
- Create: `packages/opencode/src/agent/prompt/worker.txt`
- Modify: `packages/opencode/test/agent/agent.test.ts`

**Interfaces:**
- Produces the same `research` and `worker` agent IDs, modes, permission boundaries, and descriptions as V2.
- Uses V1 prompt files for the two new system prompts.
- Preserves the existing `general`, `explore`, `build`, `plan`, and internal agent behavior.

- [x] **Step 1: Write failing V1 role tests.**

  Extend `packages/opencode/test/agent/agent.test.ts` to assert that the service lists `research` and `worker` as subagents, that `research` cannot edit, and that `worker` can use the existing execution permissions. Assert that `general` and `explore` retain their current modes.

- [x] **Step 2: Run the focused V1 agent tests and verify they fail.**

  Run from `packages/opencode`:

  ```powershell
  bun test test/agent/agent.test.ts
  ```

  Expected result: failure because the two V1 built-ins are not registered.

- [x] **Step 3: Add the V1 prompts and registrations.**

  - Create `research.txt` with the same read-only deep-research contract as V2.
  - Create `worker.txt` with the same bounded implementation contract as V2.
  - Import both prompts in `packages/opencode/src/agent/agent.ts`.
  - Add `research` with the explorer-style read-only permission set and `mode: "subagent"`.
  - Add `worker` with the standard execution permission set, `todowrite: "deny"`, and `mode: "subagent"`.
  - Do not set a hard-coded model in either definition.

- [x] **Step 4: Run the focused V1 agent tests and verify they pass.**

  ```powershell
  bun test test/agent/agent.test.ts
  ```

- [x] **Step 5: Commit the V1 role contract.**

  ```powershell
  git add packages/opencode/src/agent/agent.ts packages/opencode/src/agent/prompt/research.txt packages/opencode/src/agent/prompt/worker.txt packages/opencode/test/agent/agent.test.ts
  git commit -m "feat(opencode): mirror specialized subagents"
  ```

---

### Task 3: Make task delegation advertise and enforce subagent roles

**Files:**
- Modify: `packages/core/src/tool/registry.ts`
- Modify: `packages/core/src/tool/task.ts`
- Modify: `packages/opencode/src/tool/task.ts`
- Modify: `packages/opencode/src/tool/task.txt`
- Modify: `packages/core/test/tool-task.test.ts`
- Modify: `packages/opencode/test/tool/task.test.ts`

**Interfaces:**
- Task descriptions explicitly explain `explore`, `research`, `worker`, and `general` selection.
- V2 and V1 accept all four task subagents and reject primary or hidden agents before child creation.
- Configured agents with `mode: "subagent"` or `mode: "all"` remain advertised and callable.

- [x] **Step 1: Write failing advertisement and validation tests.**

  Add or extend tests so that:

  - The V2 task definition contains `explore`, `research`, `worker`, and `general`, describes `research` as deep read-only analysis, and describes `worker` as capable implementation work.
  - The V1 task definition contains the same built-in guidance.
  - A V2 task call using `research` creates a child with agent `research`.
  - A V2 task call using `worker` creates a child with agent `worker`.
  - V1 task calls using `research` and `worker` resolve the corresponding agents.
  - V1 and V2 task calls using `build`, `plan`, `compaction`, `title`, or `summary` fail with a task-target validation error and create no child.
  - `general-purpose` still normalizes to `general` and keeps the existing permission metadata.
  - Existing configured `mode: "all"` task agents remain accepted.

- [x] **Step 2: Run the focused task tests and verify the new assertions fail.**

  ```powershell
  cd D:\opencode-bugfix\opencode-fork-private-dev\packages\core
  bun test test/tool-task.test.ts
  cd D:\opencode-bugfix\opencode-fork-private-dev\packages\opencode
  bun test test/tool/task.test.ts
  ```

- [x] **Step 3: Update the V2 task advertisement.**

  - Change `BUILTIN_TASK_AGENT_TYPES` in `packages/core/src/tool/registry.ts` to `general`, `explore`, `research`, and `worker`.
  - Remove `build` and `plan` from the V2 task description.
  - Add concise role-selection guidance to `packages/core/src/tool/task.ts`.
  - Keep configured non-primary, non-hidden agent IDs appended dynamically.

- [x] **Step 4: Add the V1 task guidance and runtime mode guard.**

  - Update `packages/opencode/src/tool/task.txt` and the V1 schema description to list the four built-in task roles and their intended use.
  - After resolving the target agent in both runtimes, reject `mode: "primary"` and hidden agents before creating or resuming a child. Permit `mode: "subagent"` and `mode: "all"` so existing configurable agents do not regress.
  - Keep the existing `general-purpose` normalization before permission checks, lookup, metadata, and validation.

- [x] **Step 5: Run the focused task tests and verify they pass.**

  ```powershell
  cd D:\opencode-bugfix\opencode-fork-private-dev\packages\core
  bun test test/tool-task.test.ts
  cd D:\opencode-bugfix\opencode-fork-private-dev\packages\opencode
  bun test test/tool/task.test.ts
  ```

- [x] **Step 6: Commit the task contract.**

  ```powershell
  git add packages/core/src/tool/registry.ts packages/core/src/tool/task.ts packages/opencode/src/tool/task.ts packages/opencode/src/tool/task.txt packages/core/test/tool-task.test.ts packages/opencode/test/tool/task.test.ts
  git commit -m "fix(task): advertise and validate specialized subagents"
  ```

---

### Task 4: Add primary/subagent sections to the Desktop settings UI

**Files:**
- Modify: `packages/app/src/components/settings-v2/agent-settings.ts`
- Modify: `packages/app/src/components/settings-v2/agents.tsx`
- Modify: `packages/app/src/components/settings-v2/agent-settings.test.ts`
- Modify: `packages/app/src/i18n/en.ts`
- Modify: `packages/app/src/i18n/zh.ts`
- Modify: `packages/app/src/i18n/zht.ts`

**Interfaces:**
- The settings page shows `build` and `plan` under a primary coordinator section.
- The settings page shows `general`, `explore`, `research`, and `worker` under a subagent section.
- Every card uses the existing model, protocol, and reasoning/variant controls.
- The existing `general` card reads and writes the same config keys as before.

- [x] **Step 1: Write failing settings metadata tests.**

  Extend `packages/app/src/components/settings-v2/agent-settings.test.ts` to assert that:

  - `primaryAgentIDs` equals `build`, `plan`.
  - `subagentAgentIDs` equals `general`, `explore`, `research`, `worker`.
  - `configurableAgentIDs` contains all six IDs without duplicates.
  - Role metadata describes `research` as deep read-only research and `worker` as strong implementation work rather than low-cost work.

- [x] **Step 2: Run the focused app unit test and verify it fails.**

  Run from `packages/app`:

  ```powershell
  bun test --conditions=browser --preload ./happydom.ts ./src/components/settings-v2/agent-settings.test.ts
  ```

- [x] **Step 3: Implement the split role metadata and UI sections.**

  - Export separate primary and subagent ID tuples from `agent-settings.ts`.
  - Add stable role metadata for display descriptions and localization keys.
  - Add `research` and `worker` to the configurable IDs.
  - Render separate settings sections in `agents.tsx` while reusing `AgentSettingRow` and the existing model/protocol/variant update path.
  - Keep model choices restricted to currently visible/enabled models.
  - Preserve the current protocol validation and variant reset behavior when changing models.

- [x] **Step 4: Add English, Simplified Chinese, and Traditional Chinese labels.**

  Add keys for the two section titles and the four subagent role descriptions in the three locale files. Other locales continue to use the existing fallback behavior through `Partial<Record<Keys, string>>`.

- [x] **Step 5: Run the focused app unit test and typecheck.**

  ```powershell
  bun test --conditions=browser --preload ./happydom.ts ./src/components/settings-v2/agent-settings.test.ts
  bun typecheck
  ```

- [x] **Step 6: Commit the settings UI.**

  ```powershell
  git add packages/app/src/components/settings-v2/agent-settings.ts packages/app/src/components/settings-v2/agents.tsx packages/app/src/components/settings-v2/agent-settings.test.ts packages/app/src/i18n/en.ts packages/app/src/i18n/zh.ts packages/app/src/i18n/zht.ts
  git commit -m "feat(app): split coordinator and subagent settings"
  ```

---

### Task 5: Verify TUI integration and cross-runtime behavior

**Files:**
- Modify only if a regression is found: `packages/tui/src/routes/session/index.tsx`
- Modify only if a regression is found: `packages/tui/src/context/local.tsx`
- Test: `packages/tui/test/cli/ui/inline-tool-wrap-snapshot.test.tsx`
- Test: `packages/tui/test/fixture/tui-sdk.ts`

**Interfaces:**
- TUI receives the same server-provided task role names and descriptions as Desktop.
- TUI continues to expose only primary agents in its main composer selector.
- TUI renders `Research`, `Worker`, `Explore`, and `General` task activity titles without changing task execution semantics.

- [x] **Step 1: Run the focused TUI tests before changing TUI code.**

  Run from `packages/tui`:

  ```powershell
  bun test ./test/cli/tui/inline-tool-wrap-snapshot.test.tsx
  ```

- [x] **Step 2: Verify server-provided role behavior.**

  Confirm the TUI fixture exposes agent data through `/api/agent` and does not maintain a hard-coded task-role allowlist. Add a fixture assertion only if the new server roles are currently filtered out.

- [x] **Step 3: Add only necessary TUI regression coverage.**

  If task rendering has a hard-coded label path, add cases for `research` and `worker` to the existing task title formatter. Do not create a second role configuration system in TUI.

- [x] **Step 4: Run TUI typecheck and focused tests.**

  ```powershell
  bun test ./test/cli/tui/inline-tool-wrap-snapshot.test.tsx
  bun typecheck
  ```

- [x] **Step 5: No TUI-only compatibility fix was required.**

  ```powershell
  git add packages/tui
  git commit -m "fix(tui): render specialized subagent roles"
  ```

---

### Task 6: Bump the fork version to 999.0.11

**Files:**
- Modify every tracked file returned by `rg -l '999\.0\.10'` that contains the fork package version or packaged smoke expectation, including package manifests, `packages/script/src/index.ts`, and `packages/desktop/scripts/packaged-sidecar-smoke.cjs`.

**Interfaces:**
- All published/workspace package versions and the Desktop packaged-sidecar expectation agree on `999.0.11`.
- No historical plan/report documentation is rewritten merely because it mentions an older branch.

- [x] **Step 1: Write a version consistency check.**

  Use the existing version-bearing files as the source set and verify that package manifests, the script version constant, and the packaged smoke expectation all contain `999.0.11` after the update. Historical plan/report files are excluded from the update.

- [x] **Step 2: Update the version-bearing files.**

  Replace only the current fork version values from `999.0.10` to `999.0.11` in the tracked package manifests and runtime packaging constants discovered by:

  ```powershell
  rg -l '999\.0\.10' packages sdks
  ```

- [x] **Step 3: Verify version consistency.**

  ```powershell
  rg -n '999\.0\.10|999\.0\.11' packages sdks
  git diff --stat
  ```

  Expected result: no active package/runtime version remains at `999.0.10`; historical documentation is unchanged.

- [x] **Step 4: Commit the version bump.**

  ```powershell
  git add packages sdks
  git commit -m "chore: bump fork version to 999.0.11"
  ```

---

### Task 7: Cross-package verification and delivery checkpoint

**Files:**
- Test: `packages/core/test/agent.test.ts`
- Test: `packages/core/test/tool-task.test.ts`
- Test: `packages/opencode/test/agent/agent.test.ts`
- Test: `packages/opencode/test/tool/task.test.ts`
- Test: `packages/app/src/components/settings-v2/agent-settings.test.ts`
- Test: `packages/tui/test/cli/ui/inline-tool-wrap-snapshot.test.tsx`

- [x] **Step 1: Run focused tests for all changed behavior.**

  ```powershell
  cd D:\opencode-bugfix\opencode-fork-private-dev\packages\core
  bun test test/agent.test.ts test/tool-task.test.ts
  cd D:\opencode-bugfix\opencode-fork-private-dev\packages\opencode
  bun test test/agent/agent.test.ts test/tool/task.test.ts
  cd D:\opencode-bugfix\opencode-fork-private-dev\packages\app
  bun test --conditions=browser --preload ./happydom.ts ./src/components/settings-v2/agent-settings.test.ts
  cd D:\opencode-bugfix\opencode-fork-private-dev\packages\tui
  bun test test/cli/ui/inline-tool-wrap-snapshot.test.tsx
  ```

- [x] **Step 2: Run required package typechecks.**

  ```powershell
  cd D:\opencode-bugfix\opencode-fork-private-dev\packages\core
  bun typecheck
  cd D:\opencode-bugfix\opencode-fork-private-dev\packages\opencode
  bun typecheck
  cd D:\opencode-bugfix\opencode-fork-private-dev\packages\app
  bun typecheck
  cd D:\opencode-bugfix\opencode-fork-private-dev\packages\tui
  bun typecheck
  ```

- [x] **Step 3: Review the final diff and worktree scope.**

  Confirm that the diff contains only specialized-agent code, tests, UI/localization, version-bearing files, and the plan. Confirm that all pre-existing untracked test databases, temporary directories, and `packages/opencode/config.json` remain unstaged.

- [x] **Step 4: Commit the final verification state if needed.**

  ```powershell
  git status --short
  git diff --check
  git log --oneline -n 8
  ```

- [x] **Step 5: Push branch `999.0.11` only after all verification succeeds.**

  ```powershell
  git push -u origin 999.0.11
  ```

## Self-review checklist

- The plan preserves `general` instead of replacing or remapping it.
- The plan separates coordinator permission modes from task subagent roles.
- The plan gives `research` a deep-analysis contract and `worker` a strong implementation contract.
- The plan does not hard-code a model or provider.
- V1, V2, Desktop, and TUI behavior are covered.
- Primary/hidden task-target validation is covered.
- Existing configured `mode: "all"` agents remain compatible.
- Version bump and push are isolated to `999.0.11`.
