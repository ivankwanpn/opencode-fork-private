# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository

OpenCode is an open-source AI coding agent. It provides a terminal UI (TUI), web app, desktop app (Electron), and headless API server.

- **Runtime**: Bun 1.3+ with TypeScript
- **Package manager**: bun workspaces (lockfile: `bun.lock`)
- **Default branch**: `dev` (local `main` may not exist; use `dev` or `origin/dev`)

## Common Commands

```bash
bun install                     # install dependencies (run postinstall for node-pty fix)
bun dev                         # run CLI/TUI in packages/opencode dir
bun dev <directory>             # run CLI/TUI against another directory
bun dev serve                   # start headless API server (default port 4096)
bun dev serve --port 8080       # start server on custom port
bun run --cwd packages/app dev  # web app dev server
bun run --cwd packages/desktop dev    # Electron desktop app
bun lint                        # oxlint from root
bun typecheck                   # run from ROOT (turborepo), NOT individual packages
```

### Testing

**Do not run tests from repo root** (guarded by `do-not-run-tests-from-root`). Run from package directories:

```bash
bun run --cwd packages/opencode test          # opencode tests
bun run --cwd packages/opencode test:httpapi   # HTTP API exercise tests
bun run --cwd packages/core test              # core tests
bun run --cwd packages/opencode run script/bench-test-suite.ts  # benchmark suite
```

### Type Checking

Run from package directories using `tsgo` (TypeScript native preview). Most packages have:

```bash
bun run --cwd packages/<name> typecheck   # runs tsgo --noEmit
```

### Building

```bash
./packages/opencode/script/build.ts --single   # compile standalone executable
bun run --cwd packages/desktop build           # build desktop app
bun run --cwd packages/desktop package         # package desktop app for distribution
```

### Code Generation

After changing the public Protocol or Server `HttpApi`:

```bash
bun run --cwd packages/client generate
```

Do not edit `packages/client/src/generated` or `packages/client/src/generated-effect` directly.

To regenerate the legacy JavaScript SDK:

```bash
./packages/sdk/js/script/build.ts
```

## Architecture

### Package Dependency Direction

```
Schema (lightweight shared types)
  ↑
Core (business logic, sessions, tools, filesystem, PTY)
  ↑                        ↑
Protocol (HTTP API paths, payloads, codecs)   Server (Hono router, middleware, handlers)
  ↑                        ↑
Client (generated Promise + Effect APIs)      SDK-next (in-process host: Client + Core + Server)
```

- **Schema** (`@opencode-ai/schema`): Pure data types, `Schema.Struct` definitions, no runtime dependencies on DB/Drizzle/execution/providers.
- **Protocol** (`@opencode-ai/protocol`): HTTP API surface — paths, payloads, envelopes, errors, cursors, SSE streams. Composes Schema values.
- **Core** (`@opencode-ai/core`): Session execution, tool registry, filesystem, PTY, permissions, provider catalog, MCP, git, plugins, system-context. Uses Drizzle + SQLite.
- **LLM** (`@opencode-ai/llm`): Provider abstraction — one `llm.stream(request)` per provider turn. Provider protocol adapters.
- **Server** (`@opencode-ai/server`): Concrete Hono router, location middleware keys, auth, CORS, SSE handlers. Imports Core + Protocol.
- **Client** (`@opencode-ai/client`): Generated from Protocol. Root export is zero-Effect Promise API; `/effect` export is Effect-native with runtime schema decoding. Depends on Schema + Protocol, never Core or Server.
- **SDK-next** (`@opencode-ai/sdk-next`): Composes Client, Core, Server into an in-process embedded host with shared `HttpClient`.
- **OpenCode** (`opencode`): CLI entry point, commands (TUI, serve, web, attach), and binary build scripts.
- **Plugin** (`@opencode-ai/plugin`): Public plugin SDK with tool, TUI, and Effect v2 APIs.

### Key Subsystems

**V2 Session Core** (`packages/core/src/session/`):
- Durable prompt admission via `SessionV2.prompt(...)` creates a `session_input` row, then advises `SessionExecution.wake(sessionID)`.
- `SessionExecution` is process-global and Session-ID-based. Drain is process-local coordination — no durable identity.
- Prompts promote at safe provider-turn boundaries. Steering prompts promote while the drain requires continuation; queued prompts promote when idle.
- `SessionRunner`, model resolution, tool registry, permissions, and filesystem are Location-scoped.

**System Context** (`packages/core/src/system-context/`):
- Composed from ordered, keyed `ContextSource` producers that observe typed values.
- At each safe provider-turn boundary, context is reconciled: unchanged, updated, or replacement-ready.
- Changed sources produce `Mid-Conversation System Messages` (durable chronological context updates).
- A `Context Epoch` spans one immutable baseline system context until compaction, Session move, or incompatible transition.

**Tool Execution & Output**:
- Tools produce validated structured results. Textual output is bounded by line or byte limits.
- Oversized output moves to managed output files; the bounded preview stays in Session history.
- Tool Registry enforces size limits after tool-specific shaping.

**Client Codegen** (`packages/httpapi-codegen/`):
- Compiles Server's `HttpApi` into an SDK Contract IR.
- Separate emitters produce Promise (zero-Effect) and Effect (decoded types) clients.

### Source Layout

- `packages/opencode/src/cli/cmd/tui/` — Terminal UI (SolidJS + OpenTUI)
- `packages/opencode/src/cli/cmd/` — CLI commands (serve, web, attach, etc.)
- `packages/opencode/src/server/` — Server bootstrap, API routes
- `packages/core/src/session/` — V2 session execution and coordination
- `packages/core/src/tool/` — Tool registry, execution, output storage
- `packages/core/src/provider/` — Provider catalog and resolution
- `packages/core/src/system-context/` — System context algebra and built-in sources
- `packages/core/src/config/` — Configuration modules (follow self-export pattern)
- `packages/app/` — Web UI components (SolidJS)
- `packages/web/` — Web-specific assets and lander
- `packages/desktop/` — Electron wrapper (`packages/desktop/src/`)

### Technology Stack

- **Effect** 4.0-beta.83 — functional effect system used throughout Core, Server, and Client
- **Drizzle ORM** rc.2 + `@effect/sql-sqlite-bun` — database layer (SQLite via Bun)
- **Hono** 4.x — HTTP framework with OpenAPI support
- **SolidJS** 1.9 — UI framework for TUI, web app, and desktop
- **OpenTUI** 0.4 — terminal UI component library
- **SST** 4.x — infrastructure deployment
- **Vite** 7.x + Tailwind CSS 4.x — web build tooling

## Conventions

### Git
- Branch names: short, hyphenated, no slashes or type prefixes (e.g., `session-recovery`, not `feat/session-recovery`)
- Commits: conventional commit style `type(scope): summary` — types: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`
- PRs reference an existing issue (`Fixes #123`)

### Code Style
- Use `const` over `let`; ternaries/early returns instead of reassignment
- Avoid `else` — prefer early returns
- Avoid `try`/`catch` where possible
- Avoid the `any` type; rely on type inference
- Use Bun APIs when available (e.g., `Bun.file()`)
- Prefer functional array methods (`flatMap`, `filter`, `map`) over `for` loops
- Never alias imports; never use star imports
- In `packages/core/src/config/`, follow the self-export pattern (`export * as ConfigAgent from "./agent"`)
- Drizzle schema fields use `snake_case` so column names are auto-derived (no need for string name overrides)
- Do not return `Effect` from helpers unless they perform effectful work
- Keep helpers close to call sites; extract only when naming a real concept

### Testing
- Avoid mocks; test actual implementations
- Do not duplicate logic into tests
- Run tests from package directories, never from root

### Imports
- Prefer dynamic imports for heavy modules in startup-sensitive paths
- Destructure dynamic import bindings near the top of the narrowest scope

### Destructuring
- Avoid unnecessary destructuring; use dot notation to preserve context (e.g., `obj.a` over `const { a } = obj`)
