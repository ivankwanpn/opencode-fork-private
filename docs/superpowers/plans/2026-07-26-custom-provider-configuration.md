# Custom Provider Configuration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add official-compatible custom-provider configuration for OpenAI Responses, OpenAI Chat Completions, and Anthropic Messages across Desktop, TUI, and CLI, including server-side model discovery, model limits, credentials, and protocol-aware reasoning variants.

**Architecture:** Public request, response, and error schemas live in `packages/schema` and are exposed through two native provider endpoints. Pure normalization and config construction plus the live discovery/configuration transaction live under `packages/opencode/src/provider/custom-provider`; Desktop and TUI call the endpoints, while the CLI calls the same service directly. The persisted provider object remains V1-compatible, and explicit variants are generated with the existing `ProviderTransform.variants()` implementation so legacy and native projections expose identical effort choices.

**Tech Stack:** TypeScript, Bun, Effect 4, SolidJS, OpenTUI, `@clack/prompts`, AI SDK provider packages, JSONC config patching, Bun test.

## Global Constraints

- Work only in `D:\agent-admix\opencode-custom-fork`.
- Treat `D:\agent-admix\opencode-1.18.5` as the official baseline and `D:\agent-admix\cc-custom` as discovery-behavior reference only.
- Restore `packages/app/src/components/dialog-custom-provider.tsx` and `packages/app/src/components/dialog-custom-provider-form.ts` byte-for-byte from the official tree before making intentional feature changes. Do not revert any other custom-fork changes.
- Supported protocol IDs and packages are fixed:
  - `openai-responses` → `@ai-sdk/openai`
  - `openai-compatible` → `@ai-sdk/openai-compatible`
  - `anthropic-messages` → `@ai-sdk/anthropic`
- Persist only the per-model `reasoning` capability. Do not persist one default reasoning effort.
- Derive effort variant IDs and request bodies from the selected package and model ID with existing provider-transform logic; OpenAI and Anthropic must not share a hard-coded effort list.
- Model discovery runs in the OpenCode server process. Browser code never calls provider model endpoints directly.
- Accept literal keys and `{env:NAME}` references. Never write literal keys into `opencode.json` or include them in logs, errors, URLs, toasts, or summaries.
- Limits are either both absent or positive safe integers with `output <= context`.
- Discovery has one 15-second total deadline and at most three same-origin redirect hops. Reject cross-origin redirects before sending a credential-bearing follow-up request.
- Add English, Simplified Chinese, and Traditional Chinese translations. Add the same new keys with English text to every remaining App locale so `i18n/parity.test.ts` stays green.
- Use `apply_patch` for source edits. Run tests and typechecks from package directories, never from the repository root.
- `D:\agent-admix\.git` is currently empty, so Git commands will fail. Each task includes the intended commit command; skip that command while the repository remains invalid and record the changed paths in the execution checkpoint. Do not create or repair Git metadata without user authorization.

---

## File Structure

### New files

- `packages/schema/src/custom-provider.ts` — browser-safe custom-provider schemas and typed errors.
- `packages/opencode/src/provider/custom-provider/domain.ts` — protocol mapping, semantic validation, config construction, candidate URLs, normalization, header generation, and redaction.
- `packages/opencode/src/provider/custom-provider/discovery.ts` — bounded server-side HTTP discovery transport.
- `packages/opencode/src/provider/custom-provider/service.ts` — conflict checks, dual credential writes, rollback, cache refresh, and live adapters.
- `packages/opencode/test/provider/custom-provider-domain.test.ts` — pure domain and reasoning-variant tests.
- `packages/opencode/test/provider/custom-provider-discovery.test.ts` — in-process discovery transport tests.
- `packages/opencode/test/provider/custom-provider-service.test.ts` — transaction and rollback tests.
- `packages/opencode/src/cli/cmd/provider-configure.ts` — injectable CLI configuration wizard.
- `packages/opencode/test/cli/provider-configure.test.ts` — scripted CLI wizard tests.
- `packages/tui/src/component/custom-provider-wizard.ts` — pure TUI wizard state and transition helpers.
- `packages/tui/src/component/dialog-custom-provider.tsx` — single-dialog custom-provider wizard UI.
- `packages/tui/test/component/custom-provider-wizard.test.ts` — TUI transition and merge tests.
- `packages/app/src/utils/custom-provider-api.ts` — typed native transport adapter for the App's pinned client package.
- `packages/app/src/utils/custom-provider-api.test.ts` — request-path, payload, and error tests for that adapter.

### Existing files with focused changes

- `packages/schema/src/index.ts` — export `CustomProvider`.
- `packages/protocol/src/groups/provider.ts` — add discovery/configuration endpoints.
- `packages/client/src/contract.ts` — assign stable generated method names.
- `packages/client/src/generated/**` — regenerate from Protocol.
- `packages/client/test/promise.test.ts` — assert generated surface and wire requests.
- `packages/server/src/config-capability.ts` — add host discovery/configuration methods.
- `packages/server/src/handlers/provider.ts` — delegate both endpoints through the capability.
- `packages/core/src/location-service-map.ts` and `packages/core/src/location-services.ts` — enumerate the backing `RcMap` and invalidate all loaded native location services.
- `packages/core/test/location-layer.test.ts` — verify all-location invalidation.
- `packages/core/src/config/plugin/provider.ts` — expose generic key integrations and inject native key credentials into AI SDK options.
- `packages/core/test/config/provider.test.ts` — verify native custom-provider credentials.
- `packages/opencode/src/config/config.ts` — add an atomic exact provider-entry JSON/JSONC writer and export the selected global config path.
- `packages/opencode/test/config/config.test.ts` — verify exact replace/delete behavior and JSONC preservation.
- `packages/opencode/src/config/native-config.ts` — bind the server capability to the shared live service.
- `packages/opencode/src/cli/cmd/providers.ts` — register `providers configure [id]`.
- `packages/opencode/test/server/httpapi-provider.test.ts` — exercise public endpoints and immediate catalog visibility.
- `packages/opencode/test/provider/provider.test.ts` — verify the legacy provider loader consumes the bridged literal key.
- `packages/opencode/test/provider/transform.test.ts` — lock distinct custom OpenAI and Anthropic variant behavior.
- `packages/tui/src/component/dialog-provider.tsx` — replace the broken authentication-only Other flow.
- `packages/app/src/context/server-sync.tsx` — expose one reusable provider refresh operation.
- `packages/app/src/utils/server.ts` — attach the typed custom-provider adapter to `currentApi.providers`.
- `packages/app/src/components/dialog-custom-provider-form.ts` — form types, validation, discovery merge, and exact API payload.
- `packages/app/src/components/dialog-custom-provider.tsx` — protocol selector, discovery picker, reasoning/limit fields, and endpoint saves.
- `packages/app/src/components/dialog-custom-provider.test.ts` — form and merge tests.
- `packages/app/src/i18n/*.ts` — new labels, actions, validation, and discovery messages.
- `packages/app/src/i18n/parity.test.ts` — unchanged test used as a required gate.
- `docs/custom-providers.md` — user-facing Desktop, TUI, CLI, protocol, discovery, and credential instructions.

---

### Task 1: Restore the Official Desktop Baseline

**Files:**

- Modify: `packages/app/src/components/dialog-custom-provider-form.ts`
- Modify: `packages/app/src/components/dialog-custom-provider.tsx`
- Test: `packages/app/src/components/dialog-custom-provider.test.ts`

**Interfaces:**

- Consumes: official source files under `D:\agent-admix\opencode-1.18.5\packages\app\src\components`.
- Produces: the exact official form and dialog baseline on which later Desktop tasks build.

- [ ] **Step 1: Run the existing focused test and record the incomplete fork failure**

Run:

```powershell
bun test --preload ./happydom.ts ./src/components/dialog-custom-provider.test.ts
```

Expected: FAIL because the current result contains the fork's provider-level `api` field and incomplete reasoning/limit output.

- [ ] **Step 2: Restore the form module with a minimal exact patch**

Apply the official definitions:

```ts
export type ModelRow = {
  row: string
  id: string
  name: string
  err: ModelErr
}

export type FormState = {
  providerID: string
  name: string
  baseURL: string
  apiKey: string
  models: ModelRow[]
  headers: HeaderRow[]
  err: {
    providerID?: string
    name?: string
    baseURL?: string
  }
}
```

Restore config construction to:

```ts
const modelConfig = Object.fromEntries(input.form.models.map((m) => [m.id.trim(), { name: m.name.trim() }]))

config: {
  npm: OPENAI_COMPATIBLE,
  name,
  ...(env ? { env: [env] } : {}),
  options: {
    baseURL,
    ...(Object.keys(headerConfig).length ? { headers: headerConfig } : {}),
  },
  models: modelConfig,
}
```

Restore the row factory:

```ts
export const modelRow = (): ModelRow => ({ row: nextRow(), id: "", name: "", err: {} })
```

- [ ] **Step 3: Restore the dialog module with a minimal exact patch**

Remove `apiType`, `reasoningEffort`, `contextWindow`, and the blank fork blocks. Restore:

```ts
const setModel = (index: number, key: "id" | "name", value: string) => {
  batch(() => {
    setForm("models", index, key, value)
    setForm("models", index, "err", key, undefined)
  })
}
```

Restore the official save guard and auth payload:

```ts
if ((await serverSDK().protocol) !== "v1") throw new Error("Custom providers are unavailable on this server")

if (result.key) {
  await serverSDK().client.auth.set({
    providerID: result.providerID,
    auth: {
      type: "api",
      key: result.key,
    },
  })
}
```

- [ ] **Step 4: Prove the baseline is byte-for-byte official**

Run:

```powershell
$files = @(
  'packages/app/src/components/dialog-custom-provider-form.ts',
  'packages/app/src/components/dialog-custom-provider.tsx'
)
foreach ($file in $files) {
  $fork = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash
  $official = (Get-FileHash -LiteralPath (Join-Path 'D:\agent-admix\opencode-1.18.5' $file) -Algorithm SHA256).Hash
  if ($fork -ne $official) { throw "$file was not restored exactly" }
}
```

Expected: command exits successfully.

- [ ] **Step 5: Run the focused test**

Run:

```powershell
bun test --preload ./happydom.ts ./src/components/dialog-custom-provider.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit if Git metadata has been restored**

```powershell
git add packages/app/src/components/dialog-custom-provider-form.ts packages/app/src/components/dialog-custom-provider.tsx
git commit -m "fix(app): restore official custom provider form"
```

If `.git` is still invalid, skip only these two commands and record both paths in the checkpoint.

---

### Task 2: Define the Public Contract and Generated Client Surface

**Files:**

- Create: `packages/schema/src/custom-provider.ts`
- Modify: `packages/schema/src/index.ts`
- Modify: `packages/protocol/src/groups/provider.ts`
- Modify: `packages/client/src/contract.ts`
- Modify: `packages/client/test/promise.test.ts`
- Modify: `packages/client/src/generated/**`
- Modify: `packages/server/src/config-capability.ts`
- Modify: `packages/server/src/handlers/provider.ts`
- Modify: `packages/opencode/src/config/native-config.ts`

**Interfaces:**

- Produces:
  - `CustomProvider.Protocol`
  - `CustomProvider.DiscoverInput`
  - `CustomProvider.DiscoverResult`
  - `CustomProvider.ConfigureInput`
  - `CustomProvider.ConfigureResult`
  - `CustomProvider.ValidationError`
  - `CustomProvider.ConflictError`
  - `CustomProvider.DiscoveryError`
  - `CustomProvider.ConfigureError`
  - generated `providers.discoverCustom(input)` and `providers.configureCustom(input)`

- [ ] **Step 1: Add a failing generated-client contract test**

Extend `packages/client/test/promise.test.ts`:

```ts
expect(Object.keys(client.providers)).toEqual(["list", "get", "discoverCustom", "configureCustom"])
```

Add a wire test using an injected fetch:

```ts
test("custom provider methods use the public HTTP contract", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = []
  const client = OpenCode.make({
    baseUrl: "http://localhost:3000",
    fetch: async (input, init) => {
      requests.push({
        url: typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
        init,
      })
      return Response.json({ data: { models: [] } })
    },
  })

  await client.providers.discoverCustom({
    protocol: "openai-compatible",
    baseURL: "https://api.example.com/v1",
    headers: [],
  })

  expect(requests[0]?.url).toBe("http://localhost:3000/api/provider/custom/discover")
  expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
    protocol: "openai-compatible",
    baseURL: "https://api.example.com/v1",
    headers: [],
  })
})
```

Add `expectTypeOf` assertions that both methods accept their schema payload plus optional `location` and return `Location.response(...)`; this prevents generation from accidentally putting location inside the JSON body.

- [ ] **Step 2: Run the client test to verify it fails**

Run:

```powershell
bun test ./test/promise.test.ts
```

Expected: FAIL because both generated methods are absent.

- [ ] **Step 3: Add the schema types**

Create `packages/schema/src/custom-provider.ts` with these public shapes:

```ts
export * as CustomProvider from "./custom-provider"

import { Schema } from "effect"
import { PositiveInt } from "./schema"

export const Protocol = Schema.Literals(["openai-responses", "openai-compatible", "anthropic-messages"])
export type Protocol = typeof Protocol.Type

export const Header = Schema.Struct({
  name: Schema.String,
  value: Schema.String,
})
export type Header = typeof Header.Type

export const Model = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  reasoning: Schema.optional(Schema.Boolean),
  context: Schema.optional(PositiveInt),
  output: Schema.optional(PositiveInt),
})
export type Model = typeof Model.Type

export const DiscoveredModel = Schema.Struct({
  id: Schema.String,
  name: Schema.optional(Schema.String),
  reasoning: Schema.optional(Schema.Boolean),
  context: Schema.optional(PositiveInt),
  output: Schema.optional(PositiveInt),
})
export type DiscoveredModel = typeof DiscoveredModel.Type

export const DiscoverInput = Schema.Struct({
  protocol: Protocol,
  baseURL: Schema.String,
  apiKey: Schema.optional(Schema.String),
  headers: Schema.Array(Header),
})
export type DiscoverInput = typeof DiscoverInput.Type

export const DiscoverResult = Schema.Struct({
  endpoint: Schema.String,
  models: Schema.Array(DiscoveredModel),
})
export type DiscoverResult = typeof DiscoverResult.Type

export const ConfigureInput = Schema.Struct({
  providerID: Schema.String,
  name: Schema.String,
  protocol: Protocol,
  baseURL: Schema.String,
  apiKey: Schema.optional(Schema.String),
  headers: Schema.Array(Header),
  models: Schema.Array(Model),
})
export type ConfigureInput = typeof ConfigureInput.Type

export const ConfigureResult = Schema.Struct({
  providerID: Schema.String,
  name: Schema.String,
  protocol: Protocol,
  models: Schema.Array(Schema.String),
})
export type ConfigureResult = typeof ConfigureResult.Type
```

Add four tagged error classes. Use HTTP 400 for validation, 409 for conflict, 502 for discovery, and 500 for configure:

```ts
export class ValidationError extends Schema.TaggedErrorClass<ValidationError>()(
  "CustomProviderValidationError",
  { message: Schema.String, field: Schema.String },
  { httpApiStatus: 400 },
) {}

export class ConflictError extends Schema.TaggedErrorClass<ConflictError>()(
  "CustomProviderConflictError",
  { message: Schema.String, providerID: Schema.String },
  { httpApiStatus: 409 },
) {}

export class DiscoveryError extends Schema.TaggedErrorClass<DiscoveryError>()(
  "CustomProviderDiscoveryError",
  {
    message: Schema.String,
    endpoint: Schema.optional(Schema.String),
    status: Schema.optional(Schema.Int),
    kind: Schema.Literals(["network", "timeout", "redirect", "status", "shape", "environment"]),
  },
  { httpApiStatus: 502 },
) {}

export class ConfigureError extends Schema.TaggedErrorClass<ConfigureError>()(
  "CustomProviderConfigureError",
  {
    message: Schema.String,
    stage: Schema.Literals(["config", "legacyCredential", "nativeCredential", "catalogRefresh", "rollback"]),
    recoveryWarning: Schema.optional(Schema.String),
  },
  { httpApiStatus: 500 },
) {}
```

Export `CustomProvider` from `packages/schema/src/index.ts`.

- [ ] **Step 4: Add the Protocol endpoints**

In `ProviderGroup`, add:

```ts
HttpApiEndpoint.post("provider.custom.discover", "/api/provider/custom/discover", {
  query: LocationQuery,
  payload: CustomProvider.DiscoverInput,
  success: Location.response(CustomProvider.DiscoverResult),
  error: [CustomProvider.ValidationError, CustomProvider.DiscoveryError, ServiceUnavailableError],
})

HttpApiEndpoint.post("provider.custom.configure", "/api/provider/custom/configure", {
  query: LocationQuery,
  payload: CustomProvider.ConfigureInput,
  success: Location.response(CustomProvider.ConfigureResult),
  error: [
    CustomProvider.ValidationError,
    CustomProvider.ConflictError,
    CustomProvider.ConfigureError,
    ServiceUnavailableError,
  ],
})
```

Add exact OpenAPI identifiers `v2.provider.custom.discover` and `v2.provider.custom.configure`.
Apply `locationQueryOpenApi` to both endpoints so generated clients encode the nested location query with the same deep-object convention as the existing provider methods.

In `packages/client/src/contract.ts`, add:

```ts
"provider.custom.discover": "discoverCustom",
"provider.custom.configure": "configureCustom",
```

- [ ] **Step 5: Expand the capability and handlers without live behavior**

Add to `ConfigCapability.Interface`:

```ts
readonly discoverCustomProvider: (
  input: CustomProvider.DiscoverInput,
) => Effect.Effect<
  CustomProvider.DiscoverResult,
  CustomProvider.ValidationError | CustomProvider.DiscoveryError | ServiceUnavailableError
>

readonly configureCustomProvider: (
  input: CustomProvider.ConfigureInput,
  location: Location.Ref,
) => Effect.Effect<
  CustomProvider.ConfigureResult,
  | CustomProvider.ValidationError
  | CustomProvider.ConflictError
  | CustomProvider.ConfigureError
  | ServiceUnavailableError
>
```

The generic layer and the temporary host methods must fail with:

```ts
new ServiceUnavailableError({
  message: "Custom provider configuration is unavailable on this host",
  service: "custom-provider",
})
```

Add both handler registrations to `ProviderHandler`. For configure, read `Location.Service` and pass an explicit ref so the host can warm the same location after invalidation:

```ts
const location = yield* Location.Service
const ref = Location.Ref.make({
  directory: location.directory,
  workspaceID: location.workspaceID,
})
return yield* response(capability.configureCustomProvider(ctx.payload, ref))
```

Discovery delegates directly. Wrap both successful values with `response(...)`.

- [ ] **Step 6: Regenerate and run contract checks**

Run:

```powershell
bun run generate
bun test ./test/promise.test.ts
bun run typecheck
```

Expected: generated client contains both methods; all commands PASS.

Also run:

```powershell
bun run typecheck
```

from `packages/schema`, `packages/protocol`, and `packages/server`. Expected: PASS in each package.

- [ ] **Step 7: Commit if Git metadata has been restored**

```powershell
git add packages/schema packages/protocol packages/client packages/server/src/config-capability.ts packages/server/src/handlers/provider.ts packages/opencode/src/config/native-config.ts
git commit -m "feat(provider): define custom provider API"
```

If Git is unavailable, record these paths in the checkpoint.

---

### Task 3: Invalidate Every Loaded Native Location

**Files:**

- Modify: `packages/core/src/location-service-map.ts`
- Modify: `packages/core/src/location-services.ts`
- Modify: `packages/core/test/location-layer.test.ts`

**Interfaces:**

- Produces: optional `LocationServiceMap.Interface.invalidateAll(): Effect.Effect<void>` and static `LocationServiceMap.Service.invalidateAll`.
- Preserves: existing `get(ref)` and `invalidate(ref)` behavior and compatibility with test doubles that only implement the original `LayerMap` interface.

- [ ] **Step 1: Write a failing all-location invalidation test**

Add a test that loads two distinct `Location.Ref` values, records one boot per ref, calls `invalidateAll`, and loads both again:

```ts
expect(boots.get(first.directory)).toBe(1)
expect(boots.get(second.directory)).toBe(1)
yield* LocationServiceMap.Service.invalidateAll
yield* read(first)
yield* read(second)
expect(boots.get(first.directory)).toBe(2)
expect(boots.get(second.directory)).toBe(2)
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run:

```powershell
bun test ./test/location-layer.test.ts
```

Expected: FAIL because `invalidateAll` does not exist.

- [ ] **Step 3: Add all-key invalidation through the existing `RcMap`**

Extend the public service type without making existing test doubles invalid:

```ts
export interface Interface extends LayerMap.LayerMap<Location.Ref, LocationServices, LocationError> {
  readonly invalidateAll?: () => Effect.Effect<void>
}
```

Add the static fallback:

```ts
static invalidateAll = Effect.flatMap(Service, (locations) =>
  locations.invalidateAll ? locations.invalidateAll() : Effect.void,
)
```

In `buildLocationServiceMap`, import `RcMap`, wrap the underlying map, and enumerate the keys already retained by its public `rcMap`:

```ts
return Service.of({
  ...locations,
  invalidateAll() {
    return Effect.gen(function* () {
      const active = [...(yield* RcMap.keys(locations.rcMap))]
      yield* Effect.forEach(active, (ref) => locations.invalidate(ref), {
        discard: true,
      })
    })
  },
})
```

This avoids a second key registry and also covers entries obtained through either `get()` or `contextEffect()`.

- [ ] **Step 4: Run focused and full Core tests**

Run:

```powershell
bun test ./test/location-layer.test.ts
bun run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit if Git metadata has been restored**

```powershell
git add packages/core/src/location-service-map.ts packages/core/src/location-services.ts packages/core/test/location-layer.test.ts
git commit -m "feat(core): invalidate all native locations"
```

If Git is unavailable, record these paths in the checkpoint.

---

### Task 4: Implement the Pure Custom-Provider Domain

**Files:**

- Create: `packages/opencode/src/provider/custom-provider/domain.ts`
- Create: `packages/opencode/test/provider/custom-provider-domain.test.ts`
- Modify: `packages/opencode/test/provider/transform.test.ts`

**Interfaces:**

- Produces:

```ts
export const PACKAGE_BY_PROTOCOL: Readonly<Record<CustomProvider.Protocol, string>>
export function normalizeDiscoverInput(input: CustomProvider.DiscoverInput):
  Effect.Effect<CustomProvider.DiscoverInput, CustomProvider.ValidationError>
export function normalizeConfigureInput(input: CustomProvider.ConfigureInput):
  Effect.Effect<CustomProvider.ConfigureInput, CustomProvider.ValidationError>
export function buildProviderConfig(input: CustomProvider.ConfigureInput): ConfigProviderV1.Info
export function buildModelsURLCandidates(baseURL: string): string[]
export function buildDiscoveryHeaders(input: CustomProvider.DiscoverInput, key?: string): Headers
export function normalizeModelCatalog(value: unknown): CustomProvider.DiscoveredModel[]
export function redactHeaders(headers: Headers | Record<string, string>): Record<string, string>
export function redactURL(value: string | URL): string
export function parseCredential(value?: string): { key?: string; env?: string }
```

- Consumes: `ProviderTransform.variants()` for explicit protocol-aware variants.

- [ ] **Step 1: Write failing table-driven domain tests**

Cover the protocol map:

```ts
expect(PACKAGE_BY_PROTOCOL).toEqual({
  "openai-responses": "@ai-sdk/openai",
  "openai-compatible": "@ai-sdk/openai-compatible",
  "anthropic-messages": "@ai-sdk/anthropic",
})
```

Cover exact V1 output:

```ts
expect(buildProviderConfig(valid)).toEqual({
  npm: "@ai-sdk/openai-compatible",
  name: "Custom Provider",
  options: {
    baseURL: "https://api.example.com/v1",
    headers: { "X-Test": "enabled" },
  },
  models: {
    "gpt-5.4": {
      name: "GPT 5.4",
      reasoning: true,
      limit: { context: 200_000, output: 32_000 },
      variants: {
        low: expect.any(Object),
        medium: expect.any(Object),
        high: expect.any(Object),
      },
    },
  },
})
```

Also assert:

- no provider-level `api`;
- no fixed `options.reasoning_effort`;
- `reasoning: false` is omitted rather than persisted;
- blank limits omit `limit`;
- a partial, zero, unsafe, or reversed limit pair fails on the exact model field;
- an empty model list fails before persistence;
- duplicate model IDs fail after trimming;
- duplicate headers fail case-insensitively;
- fully blank header rows are dropped and partially blank rows fail on the missing field;
- header names reject spaces and control characters;
- header values reject CR and LF;
- URLs reject non-HTTP schemes and embedded credentials;
- redacted URLs never retain search parameters or fragments;
- literal keys and `{env:CUSTOM_PROVIDER_KEY}` normalize distinctly.
- `ConfigMigrateV1.migrate({ provider: { [id]: built } })` exposes the same variant IDs, with each native body equal to `ConfigProviderOptionsV1.get(npm).request(persistedVariant)`.
- URL candidates have exact stable order for a root URL, a `/v1` URL, another version segment, and every known Anthropic-compatible proxy suffix.
- the normalizer accepts a top-level array, `data`, `models`, `items`, and an object record, including string entries and every documented metadata alias.
- an unknown runtime protocol value fails before package lookup even when it bypasses static TypeScript types.

- [ ] **Step 2: Run the test to verify it fails**

Run:

```powershell
bun test ./test/provider/custom-provider-domain.test.ts
```

Expected: FAIL because the domain module does not exist.

- [ ] **Step 3: Implement semantic normalization**

Use:

```ts
const PROVIDER_ID = /^[a-z0-9][a-z0-9-_]*$/
const HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/
const ENV_REFERENCE = /^\{env:([A-Za-z_][A-Za-z0-9_]*)\}$/
```

Normalize all strings once, validate `Number.isSafeInteger`, and return a `CustomProvider.ValidationError` whose `field` is one of:

```ts
"providerID"
"name"
"protocol"
"baseURL"
"apiKey"
`headers.${number}.name`
`headers.${number}.value`
`models.${number}.id`
`models.${number}.name`
`models.${number}.context`
`models.${number}.output`
```

- [ ] **Step 4: Implement config construction and variants**

For each reasoning model, construct the minimal legacy model required by `ProviderTransform.variants()`:

```ts
const target: Provider.Model = {
  id: `${input.providerID}/${model.id}`,
  providerID: input.providerID,
  api: {
    id: model.id,
    npm: PACKAGE_BY_PROTOCOL[input.protocol],
    url: input.baseURL,
  },
  name: model.name,
  family: "",
  capabilities: {
    temperature: false,
    reasoning: true,
    attachment: false,
    toolcall: true,
    input: { text: true, audio: false, image: false, video: false, pdf: false },
    output: { text: true, audio: false, image: false, video: false, pdf: false },
    interleaved: false,
  },
  cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
  limit: {
    context: model.context ?? 0,
    output:
      input.protocol === "anthropic-messages" && model.output === undefined
        ? 32_000
        : model.output ?? 0,
  },
  status: "active",
  options: {},
  headers: {},
  release_date: "",
  variants: {},
}
```

Write `variants` only when the returned record is non-empty.

The synthetic `32_000` output value is used only while deriving legacy Anthropic `high`/`max` budget bodies; it is not persisted as the model limit. This prevents negative thinking budgets when the user intentionally leaves both limits blank. Add an assertion that blank Anthropic limits omit `limit` while every emitted `budgetTokens` remains positive.

- [ ] **Step 5: Implement URL candidates, response normalization, headers, and redaction**

Use the approved candidate order and known compatibility suffixes from the design. Normalize arrays and `data`, `models`, `items`, or object records. Extract:

```ts
const idKeys = ["id", "slug", "model", "name", "__recordKey"]
const nameKeys = ["display_name", "displayName", "label", "name"]
const reasoningKeys = ["reasoning", "supports_reasoning", "supportsReasoning"]
const contextKeys = ["context_window", "contextWindow", "max_context_length", "maxContextLength"]
const outputKeys = ["max_output", "maxOutput", "max_output_tokens", "maxOutputTokens"]
```

Only accept positive safe integer metadata. Deduplicate by trimmed ID and sort with `localeCompare`.

For redaction, replace values with `"[REDACTED]"` when the lower-cased header name is a known credential header or contains `token`, `secret`, or `key`.

`redactURL()` returns only protocol, host, port, and pathname. It always removes username, password, search parameters, and fragments before a URL is placed in a public error.

- [ ] **Step 6: Lock OpenAI/Anthropic effort differences**

Add focused assertions to `packages/opencode/test/provider/transform.test.ts`:

```ts
expect(Object.keys(ProviderTransform.variants(custom("@ai-sdk/openai", "gpt-5.4")))).toEqual([
  "none",
  "low",
  "medium",
  "high",
  "xhigh",
])

expect(Object.keys(ProviderTransform.variants(custom("@ai-sdk/openai-compatible", "gpt-5.4")))).toEqual([
  "low",
  "medium",
  "high",
])

expect(Object.keys(ProviderTransform.variants(custom("@ai-sdk/anthropic", "claude-sonnet-4-7")))).toEqual([
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
])

expect(Object.keys(ProviderTransform.variants(custom("@ai-sdk/anthropic", "claude-sonnet-4-6")))).toEqual([
  "low",
  "medium",
  "high",
  "max",
])

expect(Object.keys(ProviderTransform.variants(custom("@ai-sdk/anthropic", "claude-sonnet-4")))).toEqual([
  "high",
  "max",
])
```

Assert a reasoning model family that intentionally has no adjustable variants returns `{}`. These tests deliberately lock the fact that OpenAI Responses, generic OpenAI-compatible Chat Completions, modern Anthropic Messages, transitional Anthropic Messages, and legacy Anthropic Messages do not share one effort list.

- [ ] **Step 7: Run focused tests and typecheck**

Run:

```powershell
bun test ./test/provider/custom-provider-domain.test.ts ./test/provider/transform.test.ts
bun run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit if Git metadata has been restored**

```powershell
git add packages/opencode/src/provider/custom-provider/domain.ts packages/opencode/test/provider/custom-provider-domain.test.ts packages/opencode/test/provider/transform.test.ts
git commit -m "feat(provider): add custom provider domain rules"
```

If Git is unavailable, record these paths in the checkpoint.

---

### Task 5: Implement Safe Server-Side Model Discovery

**Files:**

- Create: `packages/opencode/src/provider/custom-provider/discovery.ts`
- Create: `packages/opencode/test/provider/custom-provider-discovery.test.ts`

**Interfaces:**

- Consumes: domain candidate, header, normalizer, and redaction functions.
- Produces:

```ts
export function discover(
  input: CustomProvider.DiscoverInput,
  options?: {
    readonly fetch?: typeof globalThis.fetch
    readonly env?: Readonly<Record<string, string | undefined>>
    readonly timeoutMs?: number
  },
): Effect.Effect<
  CustomProvider.DiscoverResult,
  CustomProvider.ValidationError | CustomProvider.DiscoveryError
>
```

- [ ] **Step 1: Write failing local-server discovery tests**

Use `Bun.serve({ port: 0, fetch(request) { ... } })` and close it in `afterEach`. Assert:

- OpenAI requests contain `Authorization: Bearer test-key`.
- Anthropic requests contain `x-api-key: test-key` and the fixed `anthropic-version`.
- `authorization` supplied by the user replaces the generated header case-insensitively.
- user-supplied `X-API-Key` and `Anthropic-Version` replace the Anthropic defaults case-insensitively.
- a 404 candidate proceeds to the next candidate;
- a same-origin redirect succeeds;
- three same-origin hops succeed and a fourth redirect fails;
- a cross-origin redirect returns `kind: "redirect"` and the second server receives zero requests;
- the entire candidate sequence is aborted at 15 seconds;
- `{env:MODEL_KEY}` resolves from the injected env map;
- a missing environment value returns `kind: "environment"`;
- an invalid response shape returns `kind: "shape"` without including the body;
- returned models are normalized, deduplicated, and sorted.

- [ ] **Step 2: Run the discovery test to verify it fails**

Run:

```powershell
bun test ./test/provider/custom-provider-discovery.test.ts
```

Expected: FAIL because `discovery.ts` is absent.

- [ ] **Step 3: Implement one total timeout and manual redirect handling**

Call `normalizeDiscoverInput()` before any network operation. Create one timeout signal before iterating candidates:

```ts
const timeout = AbortSignal.timeout(options.timeoutMs ?? 15_000)
```

Production callers do not override `timeoutMs`; tests use a value under 100 milliseconds rather than sleeping for 15 seconds.

For every fetch use `redirect: "manual"` and the same signal. Follow only 301, 302, 303, 307, and 308 responses. Resolve `Location` against the current URL, compare `next.origin === current.origin`, and reject the fourth hop.

Treat 404 and 405 as candidate misses. Record safe status/endpoint data for other failures and continue. Return the first non-empty valid catalog; if an endpoint returns a valid empty catalog, return it as success.

- [ ] **Step 4: Ensure errors are redacted**

Construct public errors only from:

```ts
{
  endpoint: redactURL(currentURL),
  status: response.status,
  kind,
  message: safeMessage,
}
```

Never include response text, request headers, the input key, URL search parameters, or fragments.

- [ ] **Step 5: Run focused tests and typecheck**

Run:

```powershell
bun test ./test/provider/custom-provider-discovery.test.ts
bun run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit if Git metadata has been restored**

```powershell
git add packages/opencode/src/provider/custom-provider/discovery.ts packages/opencode/test/provider/custom-provider-discovery.test.ts
git commit -m "feat(provider): discover custom provider models"
```

If Git is unavailable, record these paths in the checkpoint.

---

### Task 6: Make Native Config Providers Consume Generic Keys

**Files:**

- Modify: `packages/core/src/config/plugin/provider.ts`
- Modify: `packages/core/test/config/provider.test.ts`

**Interfaces:**

- Produces: one generic key integration method for every configured provider and `apiKey` injection through `Integration.connection.active/resolve`.
- Preserves: explicit `apiKey` in provider settings/body takes precedence over stored credentials.

- [ ] **Step 1: Write a failing native credential test**

Create a config provider using `@ai-sdk/openai-compatible`, save a `Credential.Key` for the same integration ID, boot the location services, and intercept the AI SDK hook:

```ts
expect(event.options).toMatchObject({
  name: "custom-provider",
  baseURL: "https://api.example.com/v1",
  apiKey: "native-secret",
})
```

Also assert the integration has a `key` method and one credential connection.

- [ ] **Step 2: Run the focused test to verify it fails**

Run:

```powershell
bun test ./test/config/provider.test.ts
```

Expected: FAIL because config-only providers do not create a generic key integration and native AI SDK options omit the stored key.

- [ ] **Step 3: Register generic integration methods**

At plugin boot, read the config documents once for registration and build `configuredProviderIDs` from every configured provider, including providers with no `env` field. Reuse that set in both hooks. In `ConfigProviderPlugin.Plugin`, update every configured provider integration:

```ts
integrations.update(integrationID, (integration) => {
  integration.name = item.name ?? integration.name
})
integrations.method.update({
  integrationID,
  method: { type: "key", label: "API key" },
})
```

Retain the existing env method when `item.env` is defined.

- [ ] **Step 4: Inject the active key into AI SDK options**

Capture `Integration.Service` in the plugin effect and register an AI SDK hook:

```ts
yield* ctx.aisdk.sdk(
  Effect.fn(function* (event) {
    if (event.options.apiKey !== undefined) return
    if (!configuredProviderIDs.has(event.model.providerID)) return
    const integrationID = Integration.ID.make(event.model.providerID)
    const connection = yield* integrations.connection.active(integrationID)
    if (!connection) return
    const credential = yield* integrations.connection.resolve(connection)
    if (credential?.type === "key") event.options.apiKey = credential.key
  }),
)
```

Build `configuredProviderIDs` from all loaded config documents during plugin boot.

- [ ] **Step 5: Run focused and full Core verification**

Run:

```powershell
bun test ./test/config/provider.test.ts ./test/credential.test.ts ./test/integration.test.ts
bun run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit if Git metadata has been restored**

```powershell
git add packages/core/src/config/plugin/provider.ts packages/core/test/config/provider.test.ts
git commit -m "feat(core): inject credentials for config providers"
```

If Git is unavailable, record these paths in the checkpoint.

---

### Task 7: Implement the Configuration Transaction and Rollback

**Files:**

- Modify: `packages/opencode/src/config/config.ts`
- Create: `packages/opencode/src/provider/custom-provider/service.ts`
- Modify: `packages/opencode/test/config/config.test.ts`
- Create: `packages/opencode/test/provider/custom-provider-service.test.ts`

**Interfaces:**

- Produces:

```ts
export interface GlobalProviderState {
  readonly provider?: ConfigProviderV1.Info
  readonly disabledProviders?: readonly string[]
}

export interface ConfigurePorts {
  readonly resolvedConfig: () => Effect.Effect<ConfigV1.Info>
  readonly builtInProviderIDs: () => Effect.Effect<ReadonlySet<string>>
  readonly readGlobalProvider: (providerID: string) => Effect.Effect<GlobalProviderState>
  readonly writeGlobalProvider: (
    providerID: string,
    state: GlobalProviderState,
  ) => Effect.Effect<void, unknown>
  readonly readLegacyCredential: (providerID: string) => Effect.Effect<Auth.Info | undefined, unknown>
  readonly writeLegacyCredential: (providerID: string, value?: Auth.Info) => Effect.Effect<void, unknown>
  readonly readNativeCredential: (providerID: string) => Effect.Effect<Credential.Info | undefined>
  readonly writeNativeCredential: (
    providerID: string,
    value?: Pick<Credential.Info, "label" | "value">,
  ) => Effect.Effect<void, unknown>
  readonly refresh: (
    providerID: string,
    expectedModelIDs: readonly string[] | undefined,
  ) => Effect.Effect<void, unknown>
}

export function configureWith(
  ports: ConfigurePorts,
  input: CustomProvider.ConfigureInput,
): Effect.Effect<
  CustomProvider.ConfigureResult,
  CustomProvider.ValidationError | CustomProvider.ConflictError | CustomProvider.ConfigureError
>

export const configure: (
  input: CustomProvider.ConfigureInput,
  location: Location.Ref,
) => Effect.Effect<
  CustomProvider.ConfigureResult,
  CustomProvider.ValidationError | CustomProvider.ConflictError | CustomProvider.ConfigureError,
  Config.Service | Auth.Service | Credential.Service | LocationServiceMap.Service | ModelsDev.Service
>
```

Also expose `Config.globalConfigFile()` and add:

```ts
Config.Service.updateGlobalProvider(input: {
  readonly providerID: string
  readonly provider?: ConfigProviderV1.Info
  readonly disabledProviders?: readonly string[]
}): Effect.Effect<{ info: ConfigV1.Info; changed: boolean }>
```

This focused writer replaces or deletes one provider entry atomically and replaces or deletes `disabled_providers` while preserving all unrelated JSONC text.

- [ ] **Step 1: Write failing exact-writer and transaction tests**

In `packages/opencode/test/config/config.test.ts`, use both `.json` and `.jsonc` fixtures containing comments and unrelated provider fields. Assert `updateGlobalProvider()`:

- replaces the entire target provider rather than deep-merging stale `env`, headers, models, or options;
- deletes the target provider when `provider` is absent;
- replaces/deletes `disabled_providers` exactly;
- preserves unrelated keys and JSONC comments;
- writes and invalidates at most once.

In the service test, use mutable in-memory provider/disabled/credential snapshots and stage-specific failure switches. Assert:

- success preserves unrelated config and removes the configured ID from `disabled_providers`;
- literal keys are present in both credential snapshots and absent from config;
- `{env:CUSTOM_KEY}` writes `env: ["CUSTOM_KEY"]` and removes literal credentials;
- blank credentials remove prior literal credentials;
- an active built-in ID conflicts;
- an active configured ID conflicts;
- a disabled configured custom provider can be reconnected;
- failure in config, legacy credential, native credential, or refresh restores the original provider, disabled list, and both credentials;
- rollback failure returns `stage: "rollback"` with a generic `recoveryWarning` and no secret.

The native snapshot test covers its one-credential-per-integration invariant and restores both the original label and value.

- [ ] **Step 2: Run the service test to verify it fails**

Run:

```powershell
bun test ./test/config/config.test.ts ./test/provider/custom-provider-service.test.ts
```

Expected: FAIL because the exact writer and service module do not exist.

- [ ] **Step 3: Implement the atomic provider writer**

Refactor the existing global-file read/parse/write block into a private helper reused by `updateGlobal()` and `updateGlobalProvider()`. For JSONC, use `jsonc-parser.modify()` at the exact paths `["provider", providerID]` and `["disabled_providers"]`, apply both edits in memory, validate the final document with `ConfigV1.Info`, and write once. For JSON, assign/delete those exact properties on the parsed object and serialize once.

Passing `undefined` deletes the exact path. Do not model this operation as a deep merge: reconnecting a disabled provider must not retain stale fields from its old definition.

- [ ] **Step 4: Implement the ordered transaction**

Use this exact ordering:

```ts
const normalized = yield* normalizeConfigureInput(input)
const resolved = yield* ports.resolvedConfig()
const builtIn = yield* ports.builtInProviderIDs()
const beforeGlobal = yield* ports.readGlobalProvider(normalized.providerID)

if (builtIn.has(normalized.providerID)) {
  return yield* conflict(normalized.providerID)
}
const reconnectingDisabledGlobal =
  beforeGlobal.provider !== undefined &&
  (resolved.disabled_providers ?? []).includes(normalized.providerID)
if (resolved.provider?.[normalized.providerID] !== undefined && !reconnectingDisabledGlobal) {
  return yield* conflict(normalized.providerID)
}

const beforeLegacy = yield* ports.readLegacyCredential(normalized.providerID)
const beforeNative = yield* ports.readNativeCredential(normalized.providerID)

const afterGlobal = {
  provider: buildProviderConfig(normalized),
  disabledProviders: beforeGlobal.disabledProviders?.filter((id) => id !== normalized.providerID),
}

yield* stage("config", ports.writeGlobalProvider(normalized.providerID, afterGlobal))
yield* stage("legacyCredential", writeLegacy(normalized))
yield* stage("nativeCredential", writeNative(normalized))
yield* stage(
  "catalogRefresh",
  ports.refresh(normalized.providerID, normalized.models.map((model) => model.id)),
)
```

On any failure from the config-write stage onward, assume a write may have partially completed and restore in reverse order:

```ts
yield* ports.writeNativeCredential(providerID, nativeSnapshot)
yield* ports.writeLegacyCredential(providerID, legacySnapshot)
yield* ports.writeGlobalProvider(providerID, beforeGlobal)
yield* ports.refresh(
  providerID,
  beforeGlobal.provider ? Object.keys(beforeGlobal.provider.models ?? {}) : undefined,
)
```

`stage()` and rollback must sandbox causes, not merely map typed errors, because the existing filesystem and database adapters can surface defects through `Effect.orDie`. Map every failure to the public stage enum and redact with the domain redaction helpers.

- [ ] **Step 5: Implement the live ports**

The live adapter must:

- use `Config.Service.get()` for active conflict checks;
- use `ModelsDev.Service.get()` for built-in ID conflicts; a disabled built-in still cannot be replaced by this custom-provider flow;
- use `Config.Service.getGlobal()` for snapshots and `updateGlobalProvider()` for atomic official-compatible JSONC-preserving writes;
- use `Auth.Service` for legacy keys;
- use `Credential.Service.list/create/remove` with `Integration.ID.make(providerID)` for native keys, retaining the existing label on rollback;
- call `LocationServiceMap.Service.invalidateAll`;
- warm the caller-supplied `Location.Ref` through `locations.get(location)`;
- verify `Catalog.Service.provider.get(providerID)` plus every expected model ID when the provider should exist, or verify the provider is absent during rollback when `expectedModelIDs` is `undefined`.

- [ ] **Step 6: Run service tests and typecheck**

Run:

```powershell
bun test ./test/config/config.test.ts ./test/provider/custom-provider-service.test.ts
bun run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit if Git metadata has been restored**

```powershell
git add packages/opencode/src/config/config.ts packages/opencode/src/provider/custom-provider/service.ts packages/opencode/test/config/config.test.ts packages/opencode/test/provider/custom-provider-service.test.ts
git commit -m "feat(provider): persist custom providers transactionally"
```

If Git is unavailable, record these paths in the checkpoint.

---

### Task 8: Wire the Live API and Verify Immediate Visibility

**Files:**

- Modify: `packages/opencode/src/config/native-config.ts`
- Modify: `packages/opencode/test/server/httpapi-provider.test.ts`
- Modify: `packages/opencode/test/provider/provider.test.ts`
- Modify: `packages/client/src/generated/**`

**Interfaces:**

- Consumes: `discover()` from discovery and `configure()` from service.
- Produces: live `/api/provider/custom/discover` and `/api/provider/custom/configure` behavior in the OpenCode host.

- [ ] **Step 1: Add failing HTTP integration tests**

Add an in-process provider server and call the public OpenCode app:

```ts
const discovered = yield* request("/api/provider/custom/discover", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-opencode-directory": directory,
  },
  body: JSON.stringify({
    protocol: "openai-compatible",
    baseURL,
    apiKey: "test-key",
    headers: [],
  }),
})
expect(discovered.status).toBe(200)
```

Then configure one selected model and immediately request `/api/provider` and `/api/model`. Assert the provider/model are visible without restarting the process, the runtime model has the exact context/output limits, and its record contains the protocol/model-specific variant IDs expected in Task 4. Add malformed input, conflict, discovery failure, and redacted error assertions.

In `packages/opencode/test/provider/provider.test.ts`, add a legacy-loader case with a custom provider that has no `options.apiKey` and a matching literal value supplied only by `Auth.Service`. Assert the loaded legacy provider's `key` is that value. Together with Task 7's dual-write assertion and Task 6's native hook assertion, this proves both execution paths consume the bridged credential.

- [ ] **Step 2: Run the HTTP test to verify it fails**

Run:

```powershell
bun test ./test/server/httpapi-provider.test.ts ./test/provider/provider.test.ts
```

Expected: custom endpoints return 503 from the temporary capability methods.

- [ ] **Step 3: Bind the live methods**

Replace the temporary methods in `NativeConfig.layer`:

```ts
discoverCustomProvider: (input) => discover(input),
configureCustomProvider: (input, location) =>
  Effect.gen(function* () {
    const result = yield* configure(input, location)
    const bridge = yield* EffectBridge.make()
    bridge.fork(disposeAllInstancesAndEmitGlobalDisposed({ swallowErrors: true }))
    return result
  }),
```

Keep `get()` unchanged. The background legacy disposal is scheduled only after the transaction and native catalog verification succeed, so the HTTP response is not destroyed with its own instance and failed/rolled-back writes do not emit a false global refresh.

- [ ] **Step 4: Regenerate the client and run API tests**

Run from `packages/client`:

```powershell
bun run generate
bun test
bun run typecheck
```

Run from `packages/opencode`:

```powershell
bun test ./test/server/httpapi-provider.test.ts ./test/provider/custom-provider-service.test.ts ./test/provider/provider.test.ts
bun run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit if Git metadata has been restored**

```powershell
git add packages/opencode/src/config/native-config.ts packages/opencode/test/server/httpapi-provider.test.ts packages/opencode/test/provider/provider.test.ts packages/client/src/generated packages/client/src/generated-effect
git commit -m "feat(provider): expose custom provider configuration API"
```

If Git is unavailable, record these paths in the checkpoint.

---

### Task 9: Add the CLI Configuration Wizard

**Files:**

- Create: `packages/opencode/src/cli/cmd/provider-configure.ts`
- Create: `packages/opencode/test/cli/provider-configure.test.ts`
- Modify: `packages/opencode/src/cli/cmd/providers.ts`

**Interfaces:**

- Produces:

```ts
export interface WizardIO {
  readonly text: (input: TextQuestion) => Effect.Effect<string | "back" | "cancel">
  readonly password: (input: TextQuestion) => Effect.Effect<string | "back" | "cancel">
  readonly select: <A>(input: SelectQuestion<A>) => Effect.Effect<A | "back" | "cancel">
  readonly log: (message: string) => Effect.Effect<void>
}

export function runProviderConfigureWizard(input: {
  readonly id?: string
  readonly io: WizardIO
  readonly discover: typeof discover
  readonly configure: (
    input: CustomProvider.ConfigureInput,
  ) => Effect.Effect<CustomProvider.ConfigureResult, CustomProvider.ConfigureError | CustomProvider.ValidationError | CustomProvider.ConflictError>
}): Effect.Effect<CustomProvider.ConfigureResult | undefined, CliError>
```

- [ ] **Step 1: Write failing scripted-wizard tests**

Use an IO implementation backed by an answer queue. Cover:

- supplied `[id]` skips only the ID question;
- protocol selection reaches the exact package through the saved result;
- discovery success allows selecting one model and configuring reasoning/limits;
- discovery failure supports Retry, then success;
- discovery failure supports Manual Entry;
- Back preserves earlier answers;
- Cancel calls neither discovery nor configure;
- repeated Add Another produces two models;
- the final save call receives the canonical parity fixture also asserted in the TUI and Desktop tests;
- output summary contains provider ID, protocol, model count, and global config path but not the key.

- [ ] **Step 2: Run the CLI test to verify it fails**

Run:

```powershell
bun test ./test/cli/provider-configure.test.ts
```

Expected: FAIL because the wizard module and command are absent.

- [ ] **Step 3: Implement the injectable wizard**

Use the ordered steps from the design. In the live `@clack/prompts` adapter:

- Ctrl+C maps to `cancel`;
- select prompts contain explicit Back and Cancel entries;
- text/password prompts document `:back` and map exactly that token to `back`;
- optional header entry repeats until Finish;
- discovered-model selection repeats through model configuration until Finish;
- every final value passes through `normalizeConfigureInput` before calling `configure`.

- [ ] **Step 4: Register `providers configure [id]`**

Add:

```ts
export const ProvidersConfigureCommand = effectCmd({
  command: "configure [id]",
  describe: "configure a custom AI provider",
  builder: (yargs) =>
    yargs.positional("id", {
      describe: "custom provider id",
      type: "string",
    }),
  handler: Effect.fn("Cli.providers.configure")(function* (args) {
    yield* runProviderConfigureWizard({
      id: args.id,
      io: liveWizardIO,
      discover,
      configure: (input) =>
        configure(
          input,
          Location.Ref.make({
            directory: AbsolutePath.make(process.cwd()),
          }),
        ),
    })
  }),
})
```

Register it in `ProvidersCommand.builder`.

The success summary gets its exact destination from the exported `Config.globalConfigFile()` helper introduced in Task 7; it never reconstructs or prints credential storage paths.

- [ ] **Step 5: Run CLI tests and typecheck**

Run:

```powershell
bun test ./test/cli/provider-configure.test.ts ./test/cli/plugin-auth-picker.test.ts
bun run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit if Git metadata has been restored**

```powershell
git add packages/opencode/src/cli/cmd/provider-configure.ts packages/opencode/src/cli/cmd/providers.ts packages/opencode/test/cli/provider-configure.test.ts
git commit -m "feat(cli): configure custom providers"
```

If Git is unavailable, record these paths in the checkpoint.

---

### Task 10: Replace the TUI Authentication-Only Flow

**Files:**

- Create: `packages/tui/src/component/custom-provider-wizard.ts`
- Create: `packages/tui/src/component/dialog-custom-provider.tsx`
- Create: `packages/tui/test/component/custom-provider-wizard.test.ts`
- Modify: `packages/tui/src/component/dialog-provider.tsx`
- Modify: `packages/tui/test/cli/cmd/tui/provider-options.test.ts`

**Interfaces:**

- Produces:

```ts
export type WizardStep =
  | "providerID"
  | "name"
  | "protocol"
  | "baseURL"
  | "apiKey"
  | "headers"
  | "source"
  | "modelSelect"
  | "modelName"
  | "modelReasoning"
  | "modelContext"
  | "modelOutput"
  | "modelNext"
  | "review"

export interface WizardState {
  readonly step: WizardStep
  readonly input: CustomProvider.ConfigureInput
  readonly discovered: readonly CustomProvider.DiscoveredModel[]
  readonly editingModel?: number
}

export function transition(state: WizardState, action: WizardAction): WizardState
```

- [ ] **Step 1: Write failing pure transition tests**

Assert:

- the forward step order matches the design;
- Back returns to the prior step while retaining protocol and inputs;
- Cancel has no save effect;
- discovery Retry returns to the same connection values;
- Manual Entry creates one blank model draft;
- discovered metadata fills blank fields;
- revisiting a model does not overwrite user-edited name/reasoning/limits;
- Add Another loops to model selection and Finish reaches review.
- the final save action emits the same literal `ConfigureInput` fixture expected by the CLI wizard test.

- [ ] **Step 2: Run TUI tests to verify they fail**

Run:

```powershell
bun test ./test/component/custom-provider-wizard.test.ts ./test/cli/cmd/tui/provider-options.test.ts
```

Expected: FAIL because the wizard module is absent.

- [ ] **Step 3: Implement one stateful dialog**

`DialogCustomProvider` must remain one dialog component and render `DialogPrompt` or `DialogSelect` from `state.step`; do not chain `dialog.replace()` promises.

Register priority-2 bindings:

```ts
useBindings(() => ({
  priority: 2,
  enabled: state.step !== "providerID",
  bindings: [
    {
      key: "escape",
      desc: "Back",
      group: "Dialog",
      cmd: () => dispatch({ type: "back" }),
    },
  ],
}))
```

At the first step, Escape and Ctrl+C retain the global Cancel behavior. Show `esc back` and `ctrl+c cancel` hints after the first step.

Call:

```ts
sdk.native.providers.discoverCustom({
  ...connectionFields,
  location: sdk.directory ? { directory: sdk.directory } : undefined,
})
```

On save, call `configureCustom`, then `sync.bootstrap()`, then:

```tsx
dialog.replace(() => <DialogModel providerID={result.data.providerID} />)
```

- [ ] **Step 4: Replace only the Other branch**

In `dialog-provider.tsx`, remove `promptCustomProviderID`, the custom `baseURL` props on `ApiMethod`, and the toast that instructs users to edit JSON. The custom option becomes:

```ts
async onSelect() {
  return dialog.replace(() => <DialogCustomProvider />)
}
```

Leave built-in key and OAuth flows unchanged.

- [ ] **Step 5: Run TUI tests and typecheck**

Run:

```powershell
bun test ./test/component/custom-provider-wizard.test.ts ./test/cli/cmd/tui/provider-options.test.ts
bun run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit if Git metadata has been restored**

```powershell
git add packages/tui/src/component/custom-provider-wizard.ts packages/tui/src/component/dialog-custom-provider.tsx packages/tui/src/component/dialog-provider.tsx packages/tui/test/component/custom-provider-wizard.test.ts packages/tui/test/cli/cmd/tui/provider-options.test.ts
git commit -m "feat(tui): configure custom providers"
```

If Git is unavailable, record these paths in the checkpoint.

---

### Task 11: Add the Desktop Transport Adapter and Refresh Hook

**Files:**

- Create: `packages/app/src/utils/custom-provider-api.ts`
- Create: `packages/app/src/utils/custom-provider-api.test.ts`
- Modify: `packages/app/src/utils/server.ts`
- Modify: `packages/app/src/context/server-sync.tsx`
- Modify: `packages/app/src/context/server-sync.test.ts`

**Interfaces:**

- Produces:

```ts
export interface CustomProviderApi {
  readonly discoverCustom: (
    input: CustomProvider.DiscoverInput & { location?: { directory?: string; workspace?: string } },
  ) => Promise<{ location: Location.Info; data: CustomProvider.DiscoverResult }>
  readonly configureCustom: (
    input: CustomProvider.ConfigureInput & { location?: { directory?: string; workspace?: string } },
  ) => Promise<{ location: Location.Info; data: CustomProvider.ConfigureResult }>
}

export function createCustomProviderApi(options: {
  readonly baseUrl: string
  readonly fetch?: typeof globalThis.fetch
  readonly headers?: HeadersInit
}): CustomProviderApi
```

- [ ] **Step 1: Write failing adapter tests**

Assert:

- exact paths and POST methods;
- location is encoded exactly as `location[directory]` and `location[workspace]`;
- payload excludes location;
- base authorization headers are preserved;
- typed JSON errors are thrown unchanged;
- transport failures produce an `Error` with no request body or secret text.

- [ ] **Step 2: Run the adapter test to verify it fails**

Run:

```powershell
bun test --preload ./happydom.ts ./src/utils/custom-provider-api.test.ts
```

Expected: FAIL because the adapter does not exist.

- [ ] **Step 3: Implement and attach the adapter**

Build requests with `URL`, `URLSearchParams`, `Headers`, and the injected fetch. Attach without replacing the pinned client:

```ts
const current = OpenCode.make(clientOptions)
const custom = createCustomProviderApi(clientOptions)

return {
  ...current,
  providers: {
    ...current.providers,
    ...custom,
  },
}
```

Update `ServerApi` to the resulting intersection type. Do not change `packages/app/package.json` from the pinned tarball to `workspace:*`.

- [ ] **Step 4: Extract a reusable provider refresh**

In `server-sync.tsx`, extract:

```ts
const refreshProviders = async () => {
  await bootstrap.refetch()
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: [serverSDK.scope, null, "providers"] }),
    queryClient.invalidateQueries({
      predicate: (query) => query.queryKey[0] === serverSDK.scope && query.queryKey[2] === "providers",
    }),
  ])
}
```

Use it in the existing config-update success handler and return it as `refreshProviders`.

- [ ] **Step 5: Run App transport/sync tests and typecheck**

Run:

```powershell
bun test --preload ./happydom.ts ./src/utils/custom-provider-api.test.ts ./src/context/server-sync.test.ts
bun run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit if Git metadata has been restored**

```powershell
git add packages/app/src/utils/custom-provider-api.ts packages/app/src/utils/custom-provider-api.test.ts packages/app/src/utils/server.ts packages/app/src/context/server-sync.tsx packages/app/src/context/server-sync.test.ts
git commit -m "feat(app): add custom provider API transport"
```

If Git is unavailable, record these paths in the checkpoint.

---

### Task 12: Build the Desktop Protocol, Discovery, Reasoning, and Limit UI

**Files:**

- Modify: `packages/app/src/components/dialog-custom-provider-form.ts`
- Modify: `packages/app/src/components/dialog-custom-provider.tsx`
- Modify: `packages/app/src/components/dialog-custom-provider.test.ts`
- Modify: `packages/app/src/i18n/en.ts`
- Modify: `packages/app/src/i18n/zh.ts`
- Modify: `packages/app/src/i18n/zht.ts`
- Modify: every other file in `packages/app/src/i18n/*.ts`

**Interfaces:**

- Produces:

```ts
export type ModelRow = {
  row: string
  id: string
  name: string
  reasoning: boolean
  context: string
  output: string
  err: {
    id?: string
    name?: string
    context?: string
    output?: string
  }
}

export type FormState = {
  providerID: string
  name: string
  protocol: CustomProvider.Protocol
  baseURL: string
  apiKey: string
  models: ModelRow[]
  headers: HeaderRow[]
  err: {
    providerID?: string
    name?: string
    protocol?: string
    baseURL?: string
  }
}

export function mergeDiscoveredModels(
  current: readonly ModelRow[],
  discovered: readonly CustomProvider.DiscoveredModel[],
  selected: ReadonlySet<string>,
): ModelRow[]
```

- [ ] **Step 1: Write failing form and merge tests**

Assert exact API payload for each protocol, including the canonical parity fixture used by CLI and TUI. Add cases for:

- Discover remains disabled until protocol and a valid Base URL are present;
- reasoning is boolean only;
- both limits serialize to numbers;
- both blank limits are omitted;
- partial or invalid limits mark the exact fields;
- discovery import includes only selected IDs;
- re-discovery preserves an edited display name, reasoning flag, context, and output;
- new selected models receive metadata defaults;
- manual model rows and discovered rows deduplicate by model ID;
- custom header duplicate checks remain case-insensitive;
- reconnecting a disabled custom provider remains valid.
- a discovery failure leaves manual Add Model usable and preserves every connection field.

- [ ] **Step 2: Run the focused test to verify it fails**

Run:

```powershell
bun test --preload ./happydom.ts ./src/components/dialog-custom-provider.test.ts
```

Expected: FAIL because protocol/reasoning/limits/merge fields do not exist.

- [ ] **Step 3: Implement form validation and payload construction**

`validateCustomProvider()` must return a `CustomProvider.ConfigureInput`, not a config file fragment:

```ts
result: {
  providerID,
  name,
  protocol: input.form.protocol,
  baseURL,
  apiKey: apiKey || undefined,
  headers: headerRows,
  models: modelRows,
}
```

Client validation mirrors the server rules but the endpoint remains authoritative.

- [ ] **Step 4: Add the protocol selector and discovery state**

Use `@opencode-ai/ui/select`, `@opencode-ai/ui/list`, and `@opencode-ai/ui/checkbox`.

Protocol options are:

```ts
const protocols = [
  { value: "openai-responses", label: language.t("provider.custom.protocol.openaiResponses") },
  { value: "openai-compatible", label: language.t("provider.custom.protocol.openaiCompatible") },
  { value: "anthropic-messages", label: language.t("provider.custom.protocol.anthropicMessages") },
] satisfies Array<{ value: CustomProvider.Protocol; label: string }>
```

The Discover button is enabled only when protocol and Base URL are valid and no discovery request is pending. On success, render a searchable `List` whose rows contain a `Checkbox`; maintain selected IDs separately and import only when the user activates Add Selected.

- [ ] **Step 5: Add model controls**

Each row renders:

- model ID;
- display name;
- `Checkbox` for Supports reasoning;
- numeric Context window;
- numeric Maximum output;
- remove action.

Use responsive grid utilities so the form remains usable at the existing dialog width. Keep manual Add Model available regardless of discovery state.

- [ ] **Step 6: Save through the public endpoint**

Replace legacy auth/config writes with:

```ts
const configured = await serverSDK().currentApi.providers.configureCustom({
  ...result,
  location: serverSync().data.path.directory
    ? { directory: serverSync().data.path.directory }
    : undefined,
})
await serverSync().refreshProviders()
return configured.data
```

Discovery uses `providers.discoverCustom` with the same location. Keep the form open and render a safe inline error on failure. On success, preserve the existing connected toast and close behavior.

Before discovery or save, require `serverSDK().protocol === "v2"` and show the localized unavailable message otherwise. Do not fall back to the legacy custom-provider write/auth calls, because older hosts cannot preserve the selected protocol or provide server-side discovery.

- [ ] **Step 7: Add translations and parity keys**

Add keys for:

- protocol label and three protocol names;
- Discover Models, discovering state, retry, search placeholder, Add Selected;
- reasoning support;
- context window and maximum output;
- limit-pair and output-exceeds-context errors;
- discovery empty/failure states;
- manual entry fallback.

Translate these keys in `en.ts`, `zh.ts`, and `zht.ts`. Insert the exact English values into every other App dictionary.

- [ ] **Step 8: Run focused tests, i18n parity, typecheck, and App build**

Run:

```powershell
bun test --preload ./happydom.ts ./src/components/dialog-custom-provider.test.ts ./src/i18n/parity.test.ts
bun run typecheck
bun run build
```

Expected: PASS.

- [ ] **Step 9: Commit if Git metadata has been restored**

```powershell
git add packages/app/src/components/dialog-custom-provider-form.ts packages/app/src/components/dialog-custom-provider.tsx packages/app/src/components/dialog-custom-provider.test.ts packages/app/src/i18n
git commit -m "feat(app): configure custom provider capabilities"
```

If Git is unavailable, record these paths in the checkpoint.

---

### Task 13: Document and Perform Full Cross-Surface Verification

**Files:**

- Create: `docs/custom-providers.md`
- Verify: every file changed by Tasks 1–12

**Interfaces:**

- Produces: user-facing instructions and a fresh verification record.

- [ ] **Step 1: Write the user documentation**

Document:

- the three protocols and exact transport each selects;
- Desktop discovery, multi-select, manual fallback, reasoning checkbox, and both limits;
- TUI step order and Back/Cancel keys;
- `opencode providers configure [id]`;
- literal key storage versus `{env:NAME}`;
- discovery candidate behavior and the 15-second timeout;
- why effort options differ between OpenAI and Anthropic models;
- the official-compatible `provider` JSON shape, without a real key.

- [ ] **Step 2: Run schema, protocol, server, and client verification**

Run from each package:

```powershell
# packages/schema
bun run typecheck

# packages/protocol
bun run typecheck

# packages/server
bun run typecheck

# packages/client
bun run generate
bun test
bun run typecheck
```

Expected: all commands PASS.

- [ ] **Step 3: Run Core verification**

From `packages/core`:

```powershell
bun test
bun run typecheck
```

Expected: PASS.

- [ ] **Step 4: Run OpenCode verification**

From `packages/opencode`:

```powershell
bun test
bun run typecheck
bun run build
```

Expected: PASS.

- [ ] **Step 5: Run TUI verification**

From `packages/tui`:

```powershell
bun test
bun run typecheck
```

Expected: PASS.

Perform a local smoke flow:

```powershell
bun run --cwd ..\opencode --conditions=browser src/index.ts
```

Use `/connect` → Other, exercise Back once, configure a local test provider, and confirm its selected model opens in the model dialog. Exit without sending a provider request.

- [ ] **Step 6: Run App and Desktop verification**

From `packages/app`:

```powershell
bun run test:unit
bun run test:browser
bun run typecheck
bun run build
```

From `packages/desktop`:

```powershell
bun run typecheck
bun run build
```

Expected: all non-environmental commands PASS. If Electron native-module setup blocks the Desktop build on Windows, retain the complete error output and do not convert that platform failure into a success claim.

- [ ] **Step 7: Verify generated files are current without relying on Git**

Run client generation a second time, hash the generated directories before and after, and require identical hashes:

```powershell
$paths = @('src/generated', 'src/generated-effect')
$before = $paths | ForEach-Object {
  Get-ChildItem -LiteralPath $_ -File -Recurse | Sort-Object FullName | ForEach-Object {
    "$(Resolve-Path -Relative $_.FullName):$((Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash)"
  }
}
bun run generate
$after = $paths | ForEach-Object {
  Get-ChildItem -LiteralPath $_ -File -Recurse | Sort-Object FullName | ForEach-Object {
    "$(Resolve-Path -Relative $_.FullName):$((Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash)"
  }
}
if (Compare-Object $before $after) { throw "Generated client changed on the second generation pass" }
```

- [ ] **Step 8: Audit the final scope against the official baseline**

Run:

```powershell
git diff --no-index -- D:\agent-admix\opencode-1.18.5\packages\app\src\components\dialog-custom-provider-form.ts D:\agent-admix\opencode-custom-fork\packages\app\src\components\dialog-custom-provider-form.ts
git diff --no-index -- D:\agent-admix\opencode-1.18.5\packages\app\src\components\dialog-custom-provider.tsx D:\agent-admix\opencode-custom-fork\packages\app\src\components\dialog-custom-provider.tsx
```

Expected: every final difference corresponds to protocol selection, discovery, reasoning capability, limits, endpoint persistence, or the associated safe UI states. Inspect the full workspace with `rg`/file lists and confirm no unrelated fork file was restored.

`git diff --no-index` returns exit code 1 when expected differences exist; inspect those differences rather than treating that specific code as a command failure.

- [ ] **Step 9: Run a secret-leak scan**

Each focused domain, discovery, transaction, and HTTP suite includes a leak-specific error case that reads an optional `OPENCODE_CUSTOM_PROVIDER_SENTINEL` environment value as its credential. Generate the value at runtime so it never appears literally in source or this plan, capture the test output, and scan both the capture and the workspace:

```powershell
$sentinel = "sk-test-" + [guid]::NewGuid().ToString("N")
$env:OPENCODE_CUSTOM_PROVIDER_SENTINEL = $sentinel
$log = Join-Path $env:TEMP "opencode-custom-provider-secret-scan.log"
$repo = (Resolve-Path ..\..).Path

try {
  bun test ./test/provider/custom-provider-domain.test.ts ./test/provider/custom-provider-discovery.test.ts ./test/provider/custom-provider-service.test.ts ./test/server/httpapi-provider.test.ts *>&1 |
    Tee-Object -FilePath $log

  if (Select-String -LiteralPath $log -SimpleMatch $sentinel -Quiet) {
    throw "Secret appeared in test output"
  }

  rg -n -F -- $sentinel (Join-Path $repo 'packages') (Join-Path $repo 'docs') (Join-Path $repo 'artifacts')
  if ($LASTEXITCODE -eq 0) { throw "Secret appeared in a workspace artifact" }
  if ($LASTEXITCODE -ne 1) { throw "Secret scan failed to execute" }
} finally {
  Remove-Item Env:\OPENCODE_CUSTOM_PROVIDER_SENTINEL -ErrorAction SilentlyContinue
}
```

Run this from `packages/opencode`. Expected: no matches in emitted test output, logs, snapshots, docs, config fixtures, or generated artifacts.

- [ ] **Step 10: Commit if Git metadata has been restored**

```powershell
git add docs/custom-providers.md
git commit -m "docs: explain custom provider configuration"
```

If Git is unavailable, record `docs/custom-providers.md` and the final verification outputs in the checkpoint.
