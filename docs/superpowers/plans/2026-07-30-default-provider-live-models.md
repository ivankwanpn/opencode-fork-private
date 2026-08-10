# Default provider live model discovery implementation plan

## Step 1: Shared discovery primitive

- Add a core helper for URL candidate construction, authorization/header handling, timeout, response parsing, and normalized live model records.
- Reuse the existing custom-provider candidate rules and the CC Switch reference behavior without copying Rust/UI-specific code.
- Add unit tests for candidate ordering, suffix stripping, supported response shapes, deduplication, and failure on empty catalogs.

## Step 2: V2 catalog integration

- Add a core plugin that reads each available provider's resolved API and connection credential.
- Probe only OpenAI-compatible provider APIs and avoid native/provider-specific packages.
- Maintain per-provider last-successful snapshots in process memory.
- On refresh, update existing catalog models in place, add unknown live IDs with conservative OpenAI-compatible defaults, and hide stale models only after a successful non-empty response.
- Subscribe to connection and `models.dev` refresh events; serialize refreshes per provider.
- Add focused tests around the pure projection behavior and live refresh failure retention.

## Step 3: V1 listing integration

- Apply the same shared helper to compatible providers in the V1 provider state initialization.
- Preserve explicit provider and model configuration while adding live-only IDs.
- Keep existing provider-specific `discoverModels` behavior, including GitLab, and do not probe native providers.
- Add tests for V1 model merge and static fallback.

## Step 4: Verification

- Run focused core/opencode tests from their package directories.
- Run `bun typecheck` from every changed package.
- Run Prettier checks and `bun turbo typecheck`.
- Review the diff for credential leakage, stale-model over-filtering, generated-file edits, and dependency-direction violations.
