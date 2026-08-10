# Default provider live model discovery

## Goal

Default providers should reflect the models exposed by the configured upstream endpoint instead of showing only a stale `models.dev` snapshot. The discovery path must be shared by V1 and V2, preserve the metadata already known locally, and never make a provider unusable merely because its model-list endpoint is unavailable.

## Scope

- Probe OpenAI-compatible model endpoints for providers whose resolved API is compatible with `@ai-sdk/openai-compatible` or an equivalent OpenAI-compatible endpoint.
- Derive `/v1/models` and `/models` candidates, including versioned and common compatibility suffix paths used by gateways.
- Send the resolved provider credential and configured request headers, with a bounded timeout.
- Parse OpenAI `{ data: [...] }`, `{ models: [...] }`, arrays, and simple string/object catalogs.
- On a successful non-empty response, hide catalog models that are not present upstream and add newly returned IDs using conservative defaults.
- Preserve `models.dev` and user configuration metadata for IDs that already exist: context/output limits, capabilities, costs, variants, request settings, and model display names.
- Keep the last successful live snapshot during transient failures; if no snapshot exists, keep the static catalog.
- Refresh at startup, after connection changes, and after a `models.dev` refresh.
- Keep provider-specific native integrations (Bedrock, Vertex native, Azure deployment APIs, Copilot, and OpenAI OAuth Codex) on their existing discovery paths unless they already expose a dedicated live loader. OpenAI API-key and OpenCode-compatible endpoints remain eligible for the generic probe.

## Non-goals

- Do not infer context windows, pricing, tool support, or modalities from a model ID.
- Do not replace provider-native model loaders with a generic probe.
- Do not retry an ambiguous provider request; model discovery is read-only and bounded.
- Do not edit generated protocol/client files.

## Failure and safety behavior

- Missing credentials, non-compatible APIs, 401/403/404/405, invalid JSON, empty catalogs, and timeouts are discovery misses and leave the previous catalog visible.
- A live response only becomes authoritative after it parses to at least one non-empty model ID.
- Model IDs are treated as opaque strings and deduplicated.
- Authorization values are never persisted in the catalog or included in errors.

## Acceptance criteria

1. Shared URL candidate generation matches the configured base URL without duplicate candidates.
2. Shared parsing accepts the supported response shapes and rejects empty/invalid catalogs as unsuccessful discovery.
3. V2 filters stale models, adds live-only models, and preserves existing metadata.
4. V1 uses the same discovery semantics when listing compatible default providers.
5. Discovery failures retain the last successful snapshot or static catalog.
6. Focused tests, package typechecks, formatting, and the repository turbo typecheck pass.
