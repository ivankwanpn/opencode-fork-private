# V2 Host Capability Boundary

## Goal

Move the remaining host-owned TUI operations onto the V2 protocol without
making the generic server depend on the legacy OpenCode runtime.

## Shape

- Schema owns transport DTOs.
- Protocol owns `/api` routes.
- Server handlers depend on narrow injectable capability services.
- The generic server supplies unavailable or empty defaults.
- The OpenCode host supplies adapters backed by its current runtime until those
  domains have native Core implementations.

## Slices

1. VCS info/status.
2. TUI config, formatter status, and host console state.
3. Workspace lifecycle and session relocation.
4. Upgrade and project-copy naming.
5. Switch worker/serve to the V2 route host, then delete the legacy route tree
   once no consumers remain.

## Verification gate

Defer tests, typecheck, and build until the complete Phase 8 implementation is
finished, per the agreed workflow.
