# OAuth Provider Model Discovery and Editing

## Problem

The provider settings page treats every OAuth connection as disconnect-only. That prevents a user with a subscription connection (especially OpenAI/ChatGPT) from correcting a model context window or refreshing the provider's available model list. The model-management UI also appears to rely on the catalog that was present at startup, which makes a static provider catalog look like a hard-coded OpenAI model list.

The reference implementation in `D:\opencode-bugfix\cc-switch-3.19.2` keeps an edit entry for OAuth providers, hides credential and endpoint fields, and obtains models through an explicit provider-aware discovery operation. It uses dedicated OAuth endpoints where an ordinary `/v1/models` request is not valid (Codex, Copilot, and xAI), and a bounded OpenAI-compatible probe for ordinary providers. The fetched list is runtime data; context-window overrides remain a separate persisted setting.

## Goals

- Show an Edit action for every connected OAuth provider.
- Keep OAuth credentials, login methods, endpoint URLs, and account identity outside the edit form.
- Make model discovery explicit, provider-aware, and available through the v2 API.
- Use discovered model IDs and metadata as the source for the OAuth edit view; do not embed an OpenAI/GPT model array in the app.
- Allow the user to override each model's context window manually and persist that override in the existing provider model configuration.
- Preserve the current catalog when discovery fails, without presenting a failed or stale request as a fresh live catalog.
- Make the discovery boundary reusable for OpenAI/Codex first and other OAuth integrations later.

## Non-goals

- Editing or replacing OAuth credentials, refresh tokens, account IDs, provider URLs, or authentication methods.
- Inferring context limits, pricing, capabilities, or reasoning support from a model ID.
- Replacing the existing global model visibility preferences with a new server-side allow-list.
- Removing the static models.dev catalog used as an operational fallback for providers whose live endpoint is unavailable. The OAuth edit view must label such data as cached/static and must not add new hard-coded model IDs.
- Changing v1 compatibility routes or the provider connection flow.

## User experience

### Connected provider row

`SettingsProviders` and `SettingsProvidersV2` show Edit for `auth === "oauth"` in addition to key, environment, config, and custom providers. The existing `canEditConnectedProvider` helper must no longer reject OAuth. Environment-only providers remain disconnect-disabled as they are today.

For a custom provider, Edit continues to open `DialogCustomProvider`. For an OAuth provider, Edit opens a dedicated `DialogOAuthProvider` instead of the API-key connection dialog.

### OAuth model editor

The dialog contains:

1. Provider name and an authentication note indicating that credentials are managed by the connection flow.
2. A `Discover models` action with loading, success count, last-source, and error states.
3. A searchable list of the provider's current catalog models. Each row shows the discovered/cached model ID and display name, has the existing local model-visibility switch, and has an Edit action for its context window.
4. The context editor uses `DialogEditModelContext` and the existing `updateModelContext` config merge. It accepts a positive safe integer, allows clearing an override, and never writes an API key or endpoint.

The list is populated from the refreshed provider catalog. It must not contain a frontend constant for OpenAI, GPT, Codex, or any other provider model. When discovery has not succeeded in the current process, the dialog may show the existing catalog as `cached/static` and explain that the displayed IDs are not a fresh discovery result.

The discovery button is safe to press repeatedly. The client associates a monotonically increasing request sequence with each dialog/provider so an older response cannot replace a newer result. The server serializes discovery for the same provider.

## Architecture

### v2 discovery capability

Add a provider-model discovery capability in the v2 server/core boundary rather than putting provider-specific HTTP calls in the Solid app. The capability accepts a provider ID and location, resolves the active integration connection and credential, chooses a strategy, and returns a normalized list:

```ts
type DiscoveredModel = {
  id: string
  name?: string
  context?: number
  input?: number
  output?: number
}

type DiscoveryResult = {
  providerID: string
  source: "oauth" | "compatible" | "provider"
  models: readonly DiscoveredModel[]
}
```

The result contains no credential, authorization header, account token, or raw upstream error body. The endpoint also applies the result to the v2 catalog using the existing live-model projection rules, preserving model metadata and user configuration overrides for IDs that already exist, then publishes the normal catalog update event.

Expose the capability with a new v2 endpoint:

```text
POST /api/provider/:providerID/models/discover?directory=...
```

The endpoint returns `DiscoveryResult` on a non-empty successful discovery. It returns a structured provider-discovery error for an unavailable strategy, rejected credential, timeout, invalid catalog, or empty catalog. The error response never includes a token or URL query containing a secret.

### Strategy selection

Strategies are provider-owned and ordered as follows:

1. A dedicated OAuth/provider strategy registered by the provider plugin. OpenAI OAuth uses the existing Codex models endpoint and account header logic; it shares the existing `fetchCodexModels` parser and token refresh behavior rather than duplicating a model list.
2. A generic OAuth-compatible strategy for providers that expose an OpenAI-compatible model endpoint. It uses the resolved OAuth access token as a bearer credential, bounded timeout, candidate `/v1/models`/`/models` URL derivation, and the existing normalized provider-model parser.
3. The existing generic API-key/header strategy for non-OAuth providers that explicitly support live discovery.

A provider with no applicable strategy still has an OAuth Edit entry. Its dialog can edit cached catalog context values, while the discovery action returns a clear unsupported message.

The strategy registry is a core/server boundary. UI code only sends a provider ID; it never branches on `openai`, `gpt`, or another model name. Adding Copilot or xAI discovery later consists of registering a strategy and tests, not adding another settings-page hard-coded list.

### Catalog and persistence

Successful discovery is a runtime snapshot. Existing live-model bookkeeping continues to hide stale live IDs and add newly discovered IDs with conservative defaults, while retaining models.dev/config metadata for matching IDs. The snapshot is refreshed on the explicit endpoint call and by the existing connection/startup hooks.

Context overrides remain durable config at:

```text
provider.<providerID>.models.<modelID>.limit.context
```

`updateModelContext` remains the single app-side merge function. After saving, the app refreshes provider queries; it does not silently run a second model discovery request. A subsequent discovery must reapply the durable context override over upstream context metadata.

## Failure and concurrency behavior

- Missing OAuth credentials, expired/refresh-rejected tokens, 401/403 responses, 404/405 endpoint misses, timeouts, invalid JSON, and empty catalogs are discovery failures.
- A failed discovery leaves the last successful live snapshot or current catalog untouched. It never replaces the catalog with an empty list.
- The server uses a keyed single-flight/mutex per provider so two simultaneous clicks cannot interleave catalog projections.
- The client ignores stale responses using a request sequence and keeps the latest successful list visible while a new request is pending.
- The dialog remains usable when discovery is unavailable: cached models and context editing continue to work, and the error is localized and actionable.
- Secrets are never serialized into `DiscoveryResult`, logs, toast messages, or error payloads.

## Files and boundaries

Expected implementation boundaries (the implementation plan may choose the exact file names):

- `packages/schema` or `packages/protocol`: discovery input/result/error schemas and the v2 endpoint declaration.
- `packages/core`: strategy interface/registry, normalized discovery result, provider-specific live projection reuse, and keyed discovery coordination.
- `packages/server`: endpoint handler and location/credential resolution wiring.
- `packages/app`: OAuth edit dialog, provider-row routing, discovery mutation/refresh, localized states, and regression tests.
- `packages/client`: generated client/types regenerated with `bun run generate` after the public HttpApi change.

The implementation must preserve the dependency direction from Schema to Core/Protocol to Server and must not make Client depend on Core or Server.

## Testing strategy

### Core/server

- Parse and normalize dedicated OAuth and generic compatible discovery responses, including deduplication and context metadata.
- Select dedicated strategy before generic fallback.
- Apply successful live results while preserving configured model context/output, capabilities, costs, variants, and request settings for matching IDs.
- Keep the existing catalog after every discovery failure and after an empty response.
- Serialize concurrent discovery for one provider and allow independent providers to proceed.
- Verify no result/error/logging path contains credential material.

### Protocol/client/server

- Validate the new endpoint payload, success result, and structured errors.
- Exercise the HTTP route with a fake provider strategy and with unsupported/failed discovery.
- Regenerate the client and verify generated output is stable.

### App

- `canEditConnectedProvider` returns true for OAuth and existing provider classes.
- OAuth rows open `DialogOAuthProvider`; custom rows still open `DialogCustomProvider`; API-key rows still open the connection editor.
- The OAuth dialog renders only catalog/discovered models and never renders API-key or endpoint controls.
- Discovery loading/result/error states are request-sequence safe.
- Context validation and persistence use `updateModelContext`, including clearing an override and preserving unrelated provider config.
- The model list contains no hard-coded OpenAI/GPT IDs.

Focused package tests must run from their package directories. Browser tests, if added, use an isolated Playwright port and never restart the user's running application/server.

## Acceptance criteria

1. Every connected OAuth provider has a working Edit entry that cannot alter credentials or endpoint settings.
2. OpenAI OAuth's model list comes from the Codex models endpoint after an explicit discovery action or the existing live snapshot; no OpenAI model array exists in the app.
3. A user can manually set or clear a model context window, restart, rediscover, and still see the override applied.
4. Discovery failures leave usable cached models and context editing intact, with a clear localized error.
5. Dedicated provider strategies and generic compatible fallback share one v2 contract and can be tested without UI/network mocks that duplicate production parsing.
6. Focused tests, package typechecks, generated-client stability, and `git diff --check` pass without staging existing runtime artifacts.
