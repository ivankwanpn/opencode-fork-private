# Custom Provider Configuration Design

**Date:** 2026-07-26

## Objective

Bring custom-provider configuration in `opencode-custom-fork` to feature parity across Desktop, TUI, and CLI while preserving compatibility with the official `opencode-1.18.5` configuration format.

The completed feature must support:

- OpenAI Responses
- OpenAI Chat Completions / OpenAI-compatible
- Anthropic Messages
- Server-side model discovery
- Manual model entry when discovery is unavailable
- Per-model reasoning capability
- Per-model context-window and maximum-output limits
- Protocol- and model-aware reasoning effort selection through OpenCode's existing model variants

## Baselines and Existing State

Three trees define the design:

- `opencode-1.18.5` is the official behavioral and configuration baseline.
- `opencode-custom-fork` is the implementation target.
- `cc-custom` is a functional reference for runtime provider selection and resilient model discovery, not a source tree to copy directly.

The current fork contains an incomplete earlier attempt:

- `packages/app/src/components/dialog-custom-provider.tsx` declares hidden protocol and model fields but does not render them.
- `packages/app/src/components/dialog-custom-provider-form.ts` emits incomplete model limits, writes a fixed reasoning effort, and adds a provider-level `api` field that does not match the intended official form output.
- The existing Desktop tests were not updated for the changed form state.
- The TUI asks for a Base URL but only mentions it in a toast; it does not persist a usable provider configuration.

Before feature implementation, the two modified Desktop form files above will be restored byte-for-byte from `opencode-1.18.5`. No other custom-fork changes will be reverted.

## Scope

### In scope

- A shared custom-provider domain implementation.
- Public native API endpoints for discovery and configuration.
- Desktop custom-provider form changes.
- A keyboard-oriented TUI configuration wizard.
- A `providers configure [id]` CLI flow that uses the same domain rules.
- Transitional credential support for both legacy and native execution paths.
- Immediate provider/model catalog refresh after configuration.
- English, Simplified Chinese, and Traditional Chinese translations for new Desktop controls. The same keys are added to every other locale dictionary with English text so i18n parity remains intact and runtime fallback remains deterministic.
- Focused documentation and automated tests.

### Out of scope

- Deleting custom providers.
- A full visual editor for an already-active provider.
- Automatic pricing or capability inference that is not returned by the provider.
- Arbitrary custom protocol packages entered by the user.
- OAuth setup for custom providers.
- Changes to reasoning behavior for built-in providers.
- Refactoring unrelated native/V2 migration code.

The configuration operation is allowed to reconnect a disabled custom provider, matching the official form behavior. A provider ID that collides with an active built-in or active configured provider remains an error.

## Architecture

Use one shared backend capability rather than separate Desktop and TUI implementations.

### Shared domain

A focused custom-provider module will own:

- protocol identifiers and npm-package mapping;
- validation and normalization;
- model-discovery URL generation;
- model-list response normalization;
- official-compatible provider configuration construction;
- credential and header redaction helpers.

The protocol mapping is fixed:

| Protocol ID | User-facing label | AI SDK package |
| --- | --- | --- |
| `openai-responses` | OpenAI Responses | `@ai-sdk/openai` |
| `openai-compatible` | OpenAI Chat Completions | `@ai-sdk/openai-compatible` |
| `anthropic-messages` | Anthropic Messages | `@ai-sdk/anthropic` |

The module will use small explicit types and pure functions for all behavior that does not require network, filesystem, or credential access.

### Public API

The native provider API will add:

- `POST /api/provider/custom/discover`
- `POST /api/provider/custom/configure`

Browser-safe request, response, and typed error contracts belong in `packages/schema`. Protocol endpoints belong in `packages/protocol`; handlers belong in `packages/server`. After changing the public Protocol, the generated clients must be regenerated from `packages/client`.

The discovery endpoint performs network access in the OpenCode process, avoiding browser CORS restrictions and keeping protocol-specific request construction out of Desktop and TUI.

The configure endpoint delegates host persistence through an expanded configuration capability. The OpenCode host implementation uses the existing legacy global-config writer so the persisted file remains compatible with official `1.18.5`, then refreshes native location services so current clients see the result.

### Persisted configuration

The persisted global configuration remains the official V1-compatible shape:

```jsonc
{
  "provider": {
    "my-provider": {
      "npm": "@ai-sdk/openai",
      "name": "My Provider",
      "options": {
        "baseURL": "https://api.example.com/v1",
        "headers": {
          "X-Custom": "value"
        }
      },
      "models": {
        "model-id": {
          "name": "Model Name",
          "reasoning": true,
          "limit": {
            "context": 200000,
            "output": 32000
          }
        }
      }
    }
  }
}
```

Rules:

- `npm` comes only from the selected protocol mapping.
- The Base URL is written as `options.baseURL`.
- A provider-level `api` field is not added by the form.
- `reasoning` is written only when explicitly enabled.
- `limit` is omitted when both values are blank.
- When a limit is present, both `context` and `output` are written.
- Empty headers are omitted.
- An API key is never written into `opencode.json`.

The existing V1-to-current configuration migration projects this shape into native `providers`, APIs, capabilities, limits, and variants.

### Credentials

Literal keys are stored through a transitional credential bridge that makes the same provider credential available to:

- the legacy `Auth` path used by official/V1-compatible execution; and
- the native `Credential` / `Integration` path used by the current TUI and native session execution.

Both stores continue to use their existing storage APIs and lifecycle. The bridge is the only dual-write location and is covered by rollback tests.

An API-key input of `{env:NAME}` stores only `NAME` in the provider's `env` array. Discovery resolves the variable only when it is present in the OpenCode server environment.

Native config providers receive a generic key integration and generic AI SDK credential injection. This prevents custom providers from depending on provider-specific built-in plugins merely to pass `apiKey` to the selected AI SDK factory.

## Model Discovery

Discovery receives:

- Base URL
- protocol
- optional literal API key or environment reference
- custom headers

No configuration is written during discovery.

### URL candidates

Candidate construction follows the resilient behavior proven in `cc-custom`:

1. Trim whitespace and trailing slashes.
2. If the Base URL ends in a version segment such as `/v1` or `/v4`, try `{base}/models`.
3. Otherwise try `{base}/v1/models`.
4. For a non-`v1` version segment, also try `{base}/v1/models`.
5. When the Base URL ends in a known Anthropic-compatible proxy suffix, also try the stripped root's `/v1/models` and `/models`.
6. Remove duplicate candidates while preserving order.

Only `http://` and `https://` URLs are accepted. Embedded URL credentials are rejected. Localhost and private-network endpoints remain allowed because local and self-hosted providers are valid use cases.

### Authentication

- OpenAI Responses and OpenAI-compatible discovery use `Authorization: Bearer <key>`.
- Anthropic Messages discovery uses `x-api-key: <key>` and an `anthropic-version` header.
- User-supplied custom headers override generated defaults by case-insensitive header name.
- Requests use a 15-second total timeout.
- Redirects are followed only when the destination has the same origin as the current candidate, with a maximum of three hops. Cross-origin redirects fail before any credential-bearing request is sent to the new origin.

### Response normalization

The normalizer accepts model collections found in:

- a top-level array;
- `data`;
- `models`;
- `items`;
- an object record keyed by model ID.

Each entry may be a string or an object. Model IDs are read, in order, from `id`, `slug`, `model`, `name`, or a record key. Common optional metadata fields may prefill:

- display name;
- reasoning support;
- context window;
- maximum output.

Invalid entries are ignored. Results are deduplicated by ID and sorted by ID. Provider metadata is advisory: it fills blank UI values but never overwrites user edits.

## Desktop Experience

The official custom-provider form remains the visual base.

Provider fields:

- Provider ID
- Display name
- Protocol dropdown
- Base URL
- API key
- Optional custom headers

The model section adds a Discover Models action. A successful response opens a searchable multi-select list. Only selected models are added to the configuration table, preventing large catalogs such as OpenRouter from inflating the config file.

Each model row contains:

- Model ID
- Display name
- Supports reasoning checkbox
- Context window
- Maximum output
- Remove action

Manual model creation remains available. Re-running discovery merges by model ID, keeps all existing edits, and adds only newly selected models.

The form stays open while discovery or save errors are displayed. A successful save closes the dialog, refreshes provider queries for every open directory, and shows the existing connected toast.

## TUI Experience

The TUI uses a sequential keyboard-oriented wizard:

1. Provider ID
2. Display name
3. Protocol
4. Base URL
5. API key or environment reference
6. Optional custom headers
7. Discover models or enter a model manually
8. Select a discovered model
9. Configure display name, reasoning support, context, and maximum output
10. Add another model or finish
11. Review and save

Every step supports Back and Cancel. Cancel performs no writes. Discovery failure offers Retry and Manual Entry without discarding previous values.

The wizard is used by the TUI's existing Other/custom-provider path. TUI authentication-only behavior is removed for this path; Base URL and models are persisted before the model chooser opens.

## CLI Experience

`opencode providers configure [id]` exposes the same wizard semantics in the regular CLI prompt system.

- Supplying `id` skips only the provider-ID prompt.
- Non-interactive flags are not introduced in this iteration.
- The command uses the shared validation, discovery, config builder, and persistence service.
- Successful completion prints the provider ID, protocol, number of configured models, and global config path without printing credentials.

## Reasoning Variants

The configuration form records only whether a model supports reasoning. It does not persist a single default effort.

OpenCode's existing provider transform remains authoritative for selectable variants. Variant generation receives the custom model's selected npm package and model ID, so option sets remain protocol- and model-specific:

- OpenAI families may expose subsets containing `none`, `minimal`, `low`, `medium`, `high`, and `xhigh`.
- Anthropic models may expose legacy budget-based `high`/`max` variants or adaptive `low`/`medium`/`high`/`xhigh`/`max` variants.
- Models whose transports do not support adjustable effort may expose no effort picker even when they produce reasoning content.

Desktop, TUI, legacy execution, and native execution must agree on the available variant IDs for the same configured model.

## Validation

Provider validation:

- ID matches `^[a-z0-9][a-z0-9-_]*$`.
- ID does not collide with an active built-in or active configured provider.
- Display name is non-empty.
- Base URL is an HTTP or HTTPS URL with no embedded credentials.
- Protocol is one of the three closed protocol IDs.

Model validation:

- At least one model is configured.
- IDs and display names are non-empty.
- IDs are unique after trimming.
- Context and output are either both blank or both positive safe integers.
- Maximum output does not exceed context.

Header validation:

- A row is either fully blank or has both name and value.
- Header names are unique case-insensitively.
- Header names are valid HTTP token names.

Validation runs identically in Desktop, TUI, CLI, and the server endpoint. Client validation improves feedback; server validation is authoritative.

## Configuration Transaction

Configuration is treated as one application-level transaction:

1. Validate the complete request.
2. Read and retain the previous target-provider config.
3. Read and retain previous legacy and native credentials.
4. Write the provider config patch while preserving unrelated JSONC content.
5. Write or remove the transitional credentials as requested.
6. Refresh Config, Integration, and Catalog for the active location.
7. Return the normalized configured provider and model list.

If steps 4 through 6 fail, the service restores the saved provider entry and both credential states before returning an error. Rollback failures are logged with redacted fields and included as a generic recovery warning, never with secret values.

## Errors and Security

Typed errors distinguish:

- validation failure;
- provider-ID conflict;
- model discovery failure;
- configuration write failure;
- credential write failure;
- catalog refresh failure.

Discovery errors report safe endpoint URLs, status codes, timeouts, and response-shape problems. They do not include response bodies that may echo credentials.

Redaction covers:

- API-key form values;
- `Authorization`;
- `x-api-key`;
- `api-key`;
- case variants of sensitive headers;
- user headers whose names contain `token`, `secret`, or `key`.

Secrets are not placed in query strings, telemetry, toast details, or CLI summaries.

## Testing Strategy

All behavior changes follow red-green-refactor TDD.

### Shared domain tests

- Each protocol maps to the intended npm package.
- Unknown protocol values fail validation.
- Whitespace normalization produces literal expected config objects.
- Limits are omitted, accepted as a valid pair, or rejected as an invalid pair.
- Reasoning writes a capability flag and never a fixed effort.
- Duplicate models and case-insensitive duplicate headers fail.
- Config output does not contain the incomplete attempt's provider-level `api` field.

### Reasoning tests

- A representative OpenAI Responses model produces its expected OpenAI effort IDs.
- A representative OpenAI-compatible model uses OpenAI-compatible effort options.
- Legacy and adaptive Anthropic model IDs produce their distinct expected effort sets.
- A non-adjustable reasoning model does not receive fabricated effort variants.
- Legacy and native projections agree on variant IDs.

### Discovery tests

- URL candidate ordering for versioned, unversioned, and compatibility-suffix URLs.
- Protocol-specific default headers.
- Case-insensitive user-header override.
- Environment-reference resolution.
- Timeout and abort behavior.
- Same-origin redirect handling and rejection of credential-bearing cross-origin redirects.
- Normalization of every accepted collection and entry shape.
- Metadata extraction, deduplication, and stable sorting.
- Redaction of request and error data.

Tests use an in-process local HTTP server and never require live provider credentials.

### Persistence and API tests

- The public endpoint decodes valid inputs and rejects malformed inputs.
- Updating one provider preserves unrelated config and JSONC comments.
- Literal keys reach both legacy and native credential consumers.
- Environment references never write a secret value.
- A simulated failure at each transaction step restores prior state.
- A successful configure call makes the provider and models visible without process restart.
- Public client generation exposes both endpoints with exact input/output types.

### Desktop tests

- Official form behavior remains intact after the clean restore.
- Discover remains disabled until required connection fields are valid.
- Search and multi-select import only selected models.
- Re-discovery merges without replacing edits.
- Manual fallback works after discovery failure.
- Protocol, reasoning, and limits produce exact literal config results.
- Saving and failure states keep the expected dialog behavior.

### TUI and CLI tests

- Wizard forward, back, cancel, retry, and manual-fallback transitions.
- Protocol selection is retained through Back navigation.
- Model configuration repeats until Finish.
- Cancel produces no config or credential writes.
- TUI and CLI inputs produce identical persisted provider objects.
- A successful TUI configuration opens the provider's model selection flow.

### Final verification

Run from package directories, never from the repository root:

- focused tests during each TDD cycle;
- full tests for every changed package;
- `bun typecheck` for every changed package;
- client generation after public Protocol changes;
- Desktop production build;
- TUI launch/configuration smoke test;
- a no-index diff against `opencode-1.18.5` confirming the two form files were restored before intentional changes and all final differences are explained by this feature.

## Acceptance Criteria

The feature is accepted when:

1. Desktop and TUI can configure a new provider using any of the three protocols.
2. Discovery runs server-side and selected models populate the form or wizard.
3. Manual model entry works when discovery is unavailable.
4. Context and output limits persist and affect the runtime model record.
5. Reasoning-enabled custom models expose only the effort variants valid for their protocol and model family.
6. A literal API key works in both legacy and native execution paths without appearing in `opencode.json`.
7. Configured models become selectable without restarting OpenCode.
8. CLI configuration produces the same persisted shape as Desktop and TUI.
9. Tests, typechecks, generated clients, Desktop build, and TUI smoke verification pass.
10. No unrelated official or custom-fork behavior is reverted.

## Repository Constraint

`D:\agent-admix` and `D:\agent-admix\opencode-custom-fork` do not currently contain a valid Git repository. `D:\agent-admix\.git` is an empty directory. The design and implementation can be saved and verified in place, but the required design commit cannot be created unless the workspace is later attached to valid Git metadata.
