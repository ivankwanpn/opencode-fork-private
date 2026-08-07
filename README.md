<p align="center">
  <picture>
    <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
    <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
    <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="OpenCode logo">
  </picture>
</p>
<p align="center">The open source AI coding agent — enhanced fork.</p>

<p align="center">
  <a href="README.md">English</a> |
  <a href="README.zh.md">简体中文</a> |
  <a href="README.zht.md">繁體中文</a>
</p>

---

This repository is a **feature fork of [OpenCode](https://opencode.ai)** (MIT-licensed), forked from upstream `1.18.3` and built forward as `999.0.13`. It keeps the upstream terminal UI (TUI), desktop app, web app, headless API server, and SDK, while reworking the core agent loop into an **event-driven, durable, asynchronous** architecture and adding a wide range of reliability, compatibility, and developer-experience improvements.

> **Note:** This project is not built by, and is not affiliated with, the OpenCode team. "OpenCode" is a trademark of its respective owners; this fork is distributed under the MIT license.

---

## Why this fork?

Upstream OpenCode is already excellent. This fork goes further in four directions:

1. **An event-driven, durable subagent loop.** Native V2 sessions run background subagents asynchronously by default. The V1 compatibility path enables the same behavior when `OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true`. Child sessions are admitted through a SQLite-backed durable task protocol, and the parent is *woken* by a completion notification instead of blocking its provider turn. There is a first-class `get_task_output` tool for explicit snapshots and bounded waits.
2. **Durable task submission and notification lifecycle.** `task_submission`, child-input terminal projection, and the parent notification outbox survive process restarts. Active provider work is not automatically resumed; ambiguous attempts are marked `recovery-required` instead of being resent. Recursive cancellation-tree semantics remain durable.
3. **Native V2/V1 coexistence with compatibility preserved.** A plugin compatibility layer lets legacy `.opencode/tool/*` tools and `hooks.tool` plugins appear in V2 sessions; legacy SDK/API paths remain available for external servers; the ACP (Agent Client Protocol) server runs on the native `/api`.
4. **Productivity features across the surface.** Custom providers (OpenAI Responses / OpenAI-compatible / Anthropic Messages) with server-side model discovery, live model discovery for default providers, LSP support, MCP resource provenance and helper tools, a composer context-usage indicator, durable Queue/Steer follow-up inputs, and much more.

---

## Highlights

### Event-driven subagent loop

- In native V2 sessions, the `task` tool launches subagents **asynchronously by default**. The V1 compatibility path requires `OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true`: the tool call then settles immediately with a running handle, and the child keeps working outside the provider turn.
- When a child finishes, a durable notification is admitted as a synthetic parent input and the parent session is woken — the coordinator can react to completed work and schedule follow-ups without waiting for a whole batch.
- `get_task_output` returns durable status snapshots for 1–20 owned task IDs, with an optional bounded wait for live process-local jobs. After a restart it returns the persisted state instead of waiting for a lost in-memory job; unknown or non-owned IDs fail identically so it cannot be used as a session-ID oracle.
- `background: false` remains the explicit escape hatch for a genuine immediate dependency. Never batch multiple foreground `task` calls in one assistant message.
- Built-in task agents: `general`, `explore`, `research`, and `worker`. `research` is a read-only deep-analysis specialist; `worker` is a focused implementation specialist. `general-purpose` remains an alias of `general`.

### Durable task lifecycle

- Every task invocation is identified by `(parentSessionID, assistantMessageID, toolCallID)`. Exact retries adopt the existing submission; conflicting reuse fails.
- A `task_submission` table records status (`accepted → running → completed / error / cancelled / recovery-required`), agent path, model, result, and timestamps.
- Child settlement and the parent notification outbox row are written in **one transaction**; the outbox is replayed idempotently after a crash, so retries do not create duplicate durable parent inputs.
- `completion_delivery` distinguishes `"tool"` (foreground, direct result) from `"parent"` (background, notification channel), with an atomic promotion path.
- Recursive `cancelTree(rootSessionID)` cancels the complete ownership tree durably and waits for descendant quiescence before reporting done.
- `subagent_max_concurrency` and `subagent_depth` configuration bounds runaway fan-out.

### Durable follow-up inputs (Queue / Steer)

- Prompts and commands carry an explicit delivery mode. `queue` inputs stay durably pending while the session is busy and are promoted in order when it becomes idle; `steer` inputs are promoted at the next safe provider-turn boundary.
- New V2 endpoints: list / exact-get / promote / cancel pending inputs. Pending queue items survive client reloads and server restarts and reconcile idempotently by deterministic message ID.
- `Enter` uses the configured default (default `steer`, matching upstream); `Ctrl+Enter` (platform equivalent) always forces Steer.

### Custom providers

- Configure providers for **OpenAI Responses**, **OpenAI Chat Completions / OpenAI-compatible**, or **Anthropic Messages** from Desktop, TUI, or CLI (`opencode providers configure [id]`).
- **Server-side model discovery** probes compatible `/models` endpoints (with a 15s total timeout and same-origin redirect safety), normalizes common catalog shapes, and merges results into the form without overwriting your edits.
- Per-model reasoning capability, context window, and output limits. The config file stays official-V1-compatible; API keys never land in `opencode.json` (literal keys go through credential storage, `{env:NAME}` references stay as env references).
- Reasoning effort options are protocol- and model-aware through OpenCode's model variants.

### Live model discovery for default providers

- Default providers reflect the models exposed by their configured upstream endpoint instead of a stale `models.dev` snapshot.
- Existing metadata (limits, capabilities, costs, variants) is preserved; transient failures keep the last good snapshot or the static catalog.
- Refreshed at startup, after connection changes, and after a `models.dev` refresh. OAuth and provider-native integrations keep their dedicated loaders.

### Plugin compatibility layer

- Legacy `.opencode/{tool,tools}/*` config tools and plugin `hooks.tool` definitions are discovered once and registered into the **V2 Core ToolRegistry** with scoped cleanup, so V1 and V2 sessions advertise identical tools.
- A full V1 plugin hook bridge (`v1-compat.ts`) maps `chat.message`, `chat.params`, `chat.headers`, `permission.ask`, `tool.execute.before/after`, `experimental.chat.messages/system.transform`, `experimental.text.complete`, `experimental.provider.small_model`, and more onto the V2 plugin runtime.
- Existing plugins keep working unchanged; no public plugin ABI was broken.

### MCP enhancements

- **Resource provenance**: MCP embedded resources and resource links now carry typed provenance (server, URI, MIME, name, description, annotations, `_meta`) through settlement, durable storage, and plugin round-trips without losing identity.
- New V2 resource helper tools: `list_mcp_resources`, `list_mcp_resource_templates`, and `read_mcp_resource`, registered through the canonical V2 registry with V2 permissions and output bounding.
- MCP is now a first-class Core subsystem (`packages/core/src/mcp/`) with catalog, runtime, browser, OAuth, callback, and resource-tool modules, unified behind `packages/core/src/mcp.ts`.

### LSP support

- A new Language Server Protocol subsystem (`packages/core/src/lsp/`) provides an LSP client runtime, language detection, diagnostics, and a `lsp` tool family wired into the V2 tool registry.

### Codex-inspired agent-loop hardening

- **Stop hooks**: `session.stop` / `session.subagent.stop` plugin hooks decide whether a turn ends or continues (with a bounded block counter), failing open so a broken hook cannot hang the turn.
- **Transaction-safe steer targeting**: an optional `expectedActiveAttemptID` in the EventV2 commit transaction rejects stale steers with a typed error.
- **Turn-scoped Responses WebSocket sessions**: one Responses WebSocket connection is reused across the inner continuation loop instead of being re-established per turn.
- **Durable agent paths**: `task_submission` records the full agent ancestry path; **projection-repair tooling** rebuilds read models from the durable event log.
- **Plan/build reminders**: the runner injects plan-mode / build-switch context when the session agent changes mode.

### Model-specific prompts

- Per-model system prompts for OpenAI GPT/Codex, Anthropic Claude, Gemini, Kimi, Meta (muse-spark), Trinity, and a "beast" variant for reasoning-heavy models — selected automatically by model ID, with a default fallback.

### Desktop / App

- **Composer context-usage indicator** shows `Context window: 3% · Used: 31.6k / 1M` right in the prompt composer (both legacy and V2 composers) and opens the context details tab.
- **Safe project close**: closing a stale/missing project row no longer crashes with a stale-read error.
- **Staged session-tab restore**: restored inactive tabs render from persisted tab info immediately; full session sync runs through a cancellable, single-concurrency idle queue with hover/focus priority.
- **OpenAI OAuth attempt lifecycle**: cancelling a browser-OAuth attempt properly releases `localhost:1455`, so retrying the flow no longer fails with `EADDRINUSE`.
- **Provider management** utilities: edit, disconnect, and mutation helpers with optimistic state reconciliation; settings-v2 agent/plugin panels.
- **System proxy + global proxy** support in the Electron main process, plus server health checks.

### TUI

- **Custom-provider wizard** — a keyboard-driven, step-by-step configuration flow with Back/Cancel/Retry/Manual-entry.
- **Native event recovery**: SSE disconnect and durable-sequence-gap recovery that replays missing events and rebuilds canonical read models without duplicating text, reasoning, or tool entries.
- Native V2 session/transcript/catalog compatibility adapters.

### ACP (Agent Client Protocol)

- The ACP server now runs through a **native client facade** (`packages/opencode/src/acp/client.ts`): sessions, transcripts, events, permissions, catalog, and config all use the native `/api` client; dynamic MCP `add` remains the single legacy fallback.

---

## Installation

We recommend **building the installer package yourself and then installing from the generated installer**, instead of running from source. This is the verified flow on **Windows**; the macOS and Linux packaging targets are configured but have not yet been verified by us.

### Prerequisites

- [Bun](https://bun.sh) 1.3+ — the monorepo is managed with bun workspaces
- Git — to clone the repository

```bash
git clone <your-repository-url>
cd <repository-directory>
bun install
```

### Windows — build the installer (verified)

```bash
bun run --cwd packages/desktop package:win
```

When the command finishes, a one-click NSIS installer is generated in `packages/desktop/dist/`:

```
opencode-desktop-win-x64.exe
```

Double-click the installer and follow the prompts to install the desktop app. An unpacked build is also written to `packages/desktop/dist/win-unpacked/` for inspection.

#### NSIS requirement

Building the Windows installer uses **NSIS**. In most cases electron-builder downloads NSIS automatically on the first build (this requires internet access and is cached in `%LOCALAPPDATA%\electron-builder\Cache\nsis`), so **no manual install is needed**. If NSIS is not available in your environment — for example the automatic download fails or you are offline — install and configure it manually:

1. Install NSIS with any of these:
   ```powershell
   winget install NSIS.NSIS
   # or: choco install nsis
   # or download from https://nsis.sourceforge.io/Download
   ```
2. Verify it is installed and on `PATH`:
   ```powershell
   makensis /VERSION
   ```
3. If electron-builder still cannot find it, point it at your NSIS installation (the folder containing `makensis.exe`) with the `NSIS_PATH` environment variable:
   ```powershell
   setx NSIS_PATH "C:\Program Files (x86)\NSIS"
   # reopen the terminal afterwards so the new value takes effect
   ```
4. If the automatic download fails because GitHub is unreachable (e.g., a corporate proxy), point electron-builder at a mirror of its binaries:
   ```powershell
   setx ELECTRON_BUILDER_BINARIES_MIRROR "https://npmmirror.com/mirrors/electron-builder-binaries/"
   ```
5. Retry `bun run --cwd packages/desktop package:win`.

### macOS / Linux — not yet verified

The packaging targets exist in `packages/desktop/electron-builder.config.ts`, but we have **not** verified them on real machines:

```bash
# macOS — produces .dmg / .zip in packages/desktop/dist/
bun run --cwd packages/desktop package:mac

# Linux — produces .AppImage / .deb / .rpm in packages/desktop/dist/
bun run --cwd packages/desktop package:linux
```

> [!NOTE]
> We have only verified the build-and-install flow on **Windows**. The macOS and Linux commands above are provided as-is; please report any issues you hit.

### Run from source (for developers)

```bash
bun dev                 # TUI in the current directory
bun dev serve           # headless API server (default port 4096)
bun run --cwd packages/app dev          # web app
bun run --cwd packages/desktop dev      # desktop app (Electron)
```

The built `opencode` binary supports the same commands as upstream: `opencode [directory]`, `opencode serve`, `opencode run`, `opencode acp`, `opencode providers configure`, and more.

---

## VS Code extension

The fork includes a VS Code extension in [`sdks/vscode/`](./sdks/vscode/) that integrates `opencode` into your editor. Install it by packaging a `.vsix` yourself and installing it locally.

> **Prerequisite**: the extension launches the `opencode` CLI in a terminal, so make sure the fork's `opencode` binary is available on your `PATH` first (build it from source or install it as described in [Installation](#installation)).

### 1. Build the `.vsix`

```bash
cd sdks/vscode
bun install
bun install -g @vscode/vsce     # install vsce once (or use `bunx @vscode/vsce` below)
vsce package --no-dependencies --skip-license
```

`vsce` automatically runs the `vscode:prepublish` hook (type-check + lint + esbuild production build) and produces **`opencode-999.0.13.vsix`** in `sdks/vscode/`.

If `vsce` complains about the repository or version metadata, you can pass the same flags the release pipeline uses:

```bash
vsce package --no-dependencies --skip-license --no-git-tag-version --no-update-package-json
```

### 2. Install the `.vsix`

From the command line:

```bash
code --install-extension opencode-999.0.13.vsix
```

Or from the VS Code UI:

1. Open the **Extensions** panel (`Ctrl+Shift+X` / `Cmd+Shift+X`)
2. Click the **...** (More Actions) menu
3. Choose **Install from VSIX...**
4. Select `opencode-999.0.13.vsix`

Reload the window if the extension does not activate immediately.

### Usage

| Shortcut (Windows / Linux / macOS) | Action |
| --- | --- |
| `Ctrl+Esc` / `Cmd+Esc` | Open the `opencode` terminal, or focus it if it is already running |
| `Ctrl+Shift+Esc` / `Cmd+Shift+Esc` | Open a new `opencode` terminal session |
| `Ctrl+Alt+K` / `Cmd+Alt+K` | Insert a file reference (e.g. `@File#L37-42`) |

---

## Documentation

- [Custom providers](./docs/custom-providers.md) — configuring a provider from Desktop, TUI, or CLI.
- Design documents for the fork's major changes live under [`docs/superpowers/`](./docs/superpowers/).
- Upstream documentation: https://opencode.ai/docs

---

## Building on this project

If you build a project named after or derived from this repository (for example `opencode-dashboard` or `opencode-mobile`), please add a note to your README clarifying that it is not built by the OpenCode team and is not affiliated with it.

---

## Contributing

Contributions are welcome. Please read [`CONTRIBUTING.md`](./CONTRIBUTING.md) before opening a pull request.

- Branch names: short, hyphenated, no `feat/` prefixes.
- Commits: conventional style `type(scope): summary`.
- Tests: run from package directories (`bun run --cwd packages/core test`), never from the repository root.

---

## License

[MIT](./LICENSE)
