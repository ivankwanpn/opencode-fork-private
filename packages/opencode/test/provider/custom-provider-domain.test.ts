import { describe, expect, test } from "bun:test"
import { ConfigMigrateV1 } from "@opencode-ai/core/v1/config/migrate"
import { ConfigProviderOptionsV1 } from "@opencode-ai/core/v1/config/provider-options"
import { CustomProvider } from "@opencode-ai/schema/custom-provider"
import { Effect } from "effect"
import {
  PACKAGE_BY_PROTOCOL,
  buildDiscoveryHeaders,
  buildModelsURLCandidates,
  buildProviderConfig,
  normalizeConfigureInput,
  normalizeDiscoverInput,
  normalizeModelCatalog,
  parseCredential,
  redactHeaders,
  redactURL,
} from "@/provider/custom-provider/domain"

const valid = {
  providerID: "custom-provider",
  name: "Custom Provider",
  protocol: "openai-compatible" as const,
  baseURL: "https://api.example.com/v1",
  apiKey: "secret",
  headers: [{ name: "X-Test", value: "enabled" }],
  models: [
    {
      id: "gpt-5.4",
      name: "GPT 5.4",
      reasoning: true,
      context: 200_000,
      output: 32_000,
    },
  ],
}

async function configureError(input: CustomProvider.ConfigureInput) {
  return Effect.runPromise(Effect.flip(normalizeConfigureInput(input)))
}

describe("custom provider validation", () => {
  test("locks the protocol package map", () => {
    expect(PACKAGE_BY_PROTOCOL).toEqual({
      "openai-responses": "@ai-sdk/openai",
      "openai-compatible": "@ai-sdk/openai-compatible",
      "anthropic-messages": "@ai-sdk/anthropic",
    })
  })

  test("normalizes strings once, drops blank header rows, and distinguishes credential forms", async () => {
    const result = await Effect.runPromise(
      normalizeConfigureInput({
        ...valid,
        providerID: " custom-provider ",
        name: " Custom Provider ",
        baseURL: " https://api.example.com/v1 ",
        apiKey: " {env:CUSTOM_PROVIDER_KEY} ",
        headers: [
          { name: " X-Test ", value: " enabled " },
          { name: " ", value: " " },
        ],
        models: [{ ...valid.models[0], id: " gpt-5.4 ", name: " GPT 5.4 " }],
      }),
    )
    expect(result).toEqual({
      ...valid,
      apiKey: "{env:CUSTOM_PROVIDER_KEY}",
    })
    expect(parseCredential(" literal-key ")).toEqual({ key: "literal-key" })
    expect(parseCredential(" {env:CUSTOM_PROVIDER_KEY} ")).toEqual({ env: "CUSTOM_PROVIDER_KEY" })
    expect(parseCredential("   ")).toEqual({})
  })

  test.each([
    ["providerID", { providerID: "Bad Provider" }],
    ["name", { name: " " }],
    ["baseURL", { baseURL: "ftp://api.example.com/v1" }],
    ["baseURL", { baseURL: "https://user:password@api.example.com/v1" }],
    ["apiKey", { apiKey: "{env:bad-name}" }],
  ] as const)("rejects invalid %s input", async (field, patch) => {
    expect((await configureError({ ...valid, ...patch })).field).toBe(field)
  })

  test("rejects unknown runtime protocols before package lookup", async () => {
    const input = { ...valid, protocol: "future-protocol" } as unknown as CustomProvider.ConfigureInput
    expect((await configureError(input)).field).toBe("protocol")
  })

  test("requires at least one model and unique trimmed model IDs", async () => {
    expect((await configureError({ ...valid, models: [] })).field).toBe("models.0.id")
    expect(
      (
        await configureError({
          ...valid,
          models: [valid.models[0], { ...valid.models[0], id: " gpt-5.4 " }],
        })
      ).field,
    ).toBe("models.1.id")
  })

  test.each([
    ["models.0.id", { id: " " }],
    ["models.0.name", { name: " " }],
  ] as const)("rejects blank model strings on %s", async (field, patch) => {
    expect((await configureError({ ...valid, models: [{ ...valid.models[0], ...patch }] })).field).toBe(field)
  })

  test.each([
    ["models.0.output", { context: 200_000, output: undefined }],
    ["models.0.context", { context: undefined, output: 32_000 }],
    ["models.0.context", { context: 0, output: 32_000 }],
    ["models.0.output", { context: 200_000, output: 0 }],
    ["models.0.context", { context: Number.MAX_SAFE_INTEGER + 1, output: 32_000 }],
    ["models.0.output", { context: 200_000, output: Number.MAX_SAFE_INTEGER + 1 }],
    ["models.0.output", { context: 32_000, output: 32_001 }],
  ] as const)("rejects invalid limit pairs on %s", async (field, limits) => {
    expect(
      (
        await configureError({
          ...valid,
          models: [{ ...valid.models[0], ...limits }],
        })
      ).field,
    ).toBe(field)
  })

  test("does not apply protocol-specific budget limits during setup", async () => {
    const input = await Effect.runPromise(
      normalizeConfigureInput({
        ...valid,
        protocol: "anthropic-messages",
        models: [{ ...valid.models[0], id: "claude-sonnet-4", context: 4, output: 1 }],
      }),
    )
    const variants = buildProviderConfig(input).models?.["claude-sonnet-4"]?.variants
    expect(input.models[0]?.output).toBe(1)
    expect(variants).toEqual({ none: {}, low: {}, medium: {}, high: {}, xhigh: {}, max: {} })
  })

  test.each([
    [
      "headers.1.name",
      [
        { name: "X-Test", value: "one" },
        { name: "x-test", value: "two" },
      ],
    ],
    ["headers.0.value", [{ name: "X-Test", value: "" }]],
    ["headers.0.name", [{ name: "", value: "enabled" }]],
    ["headers.0.name", [{ name: "Bad Header", value: "enabled" }]],
    ["headers.0.name", [{ name: "Bad\u0007Header", value: "enabled" }]],
    ["headers.0.value", [{ name: "X-Test", value: "bad\rvalue" }]],
    ["headers.0.value", [{ name: "X-Test", value: "bad\nvalue" }]],
    ["headers.0.value", [{ name: "X-Test", value: "\rbad" }]],
    ["headers.0.value", [{ name: "X-Test", value: "\nbad" }]],
    ["headers.0.value", [{ name: "X-Test", value: "bad\r" }]],
    ["headers.0.value", [{ name: "X-Test", value: "bad\n" }]],
  ] as const)("rejects invalid headers on %s", async (field, headers) => {
    expect((await configureError({ ...valid, headers: [...headers] })).field).toBe(field)
  })
})

describe("custom provider persistence", () => {
  test("builds the exact V1 provider shape without provider API or fixed effort", () => {
    const result = buildProviderConfig(valid)
    expect(result).toEqual({
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
          protocols: ["openai-responses", "openai-compatible", "anthropic-messages"],
          limit: { context: 200_000, output: 32_000 },
          variants: {
            none: {},
            low: {},
            medium: {},
            high: {},
            xhigh: {},
            max: {},
          },
        },
      },
    })
    expect(result).not.toHaveProperty("api")
    expect(result.options).not.toHaveProperty("reasoning_effort")
  })

  test("omits false reasoning, blank limits, empty headers, and empty variants", () => {
    const result = buildProviderConfig({
      ...valid,
      headers: [],
      models: [{ id: "deepseek-r1", name: "DeepSeek R1", reasoning: false }],
    })
    expect(result.options).toEqual({ baseURL: valid.baseURL })
    expect(result.models?.["deepseek-r1"]).toEqual({
      name: "DeepSeek R1",
      protocols: ["openai-responses", "openai-compatible", "anthropic-messages"],
    })
  })

  test("selects the AI SDK package matching the chosen protocol", () => {
    expect(buildProviderConfig({ ...valid, protocol: "anthropic-messages" }).npm).toBe("@ai-sdk/anthropic")
    expect(buildProviderConfig({ ...valid, protocol: "openai-responses" }).npm).toBe("@ai-sdk/openai")
    expect(buildProviderConfig({ ...valid, protocol: "openai-compatible" }).npm).toBe("@ai-sdk/openai-compatible")
    expect(buildProviderConfig({ ...valid, protocol: undefined }).npm).toBe("@ai-sdk/openai-compatible")
  })

  test("persists only the environment name for an environment credential", () => {
    expect(buildProviderConfig({ ...valid, apiKey: "{env:CUSTOM_PROVIDER_KEY}" }).env).toEqual(["CUSTOM_PROVIDER_KEY"])
    expect(JSON.stringify(buildProviderConfig(valid))).not.toContain("secret")
  })

  test("keeps reasoning variants protocol-neutral when limits are omitted", () => {
    const result = buildProviderConfig({
      ...valid,
      protocol: "anthropic-messages",
      models: [{ id: "claude-sonnet-4", name: "Claude Sonnet 4", reasoning: true }],
    })
    const model = result.models?.["claude-sonnet-4"]
    expect(model).not.toHaveProperty("limit")
    expect(model?.variants).toEqual({ none: {}, low: {}, medium: {}, high: {}, xhigh: {}, max: {} })
  })

  test("keeps DeepSeek variants neutral through V1 migration", () => {
    const input = {
      ...valid,
      protocol: "anthropic-messages" as const,
      baseURL: "https://api.deepseek.com/anthropic",
      models: [
        {
          id: "deepseek-v4-pro",
          name: "DeepSeek V4 Pro",
          reasoning: true,
          context: 1_000_000,
          output: 384_000,
        },
      ],
    }
    const built = buildProviderConfig(input)
    expect(built.models?.["deepseek-v4-pro"]?.variants).toEqual({
      none: {},
      low: {},
      medium: {},
      high: {},
      xhigh: {},
      max: {},
    })

    const migrated = ConfigMigrateV1.migrate({ provider: { [input.providerID]: built } })
    expect(migrated.providers?.[input.providerID]?.models?.["deepseek-v4-pro"]?.variants).toEqual([
      { id: "none", body: {} },
      { id: "low", body: {} },
      { id: "medium", body: {} },
      { id: "high", body: {} },
      { id: "xhigh", body: {} },
      { id: "max", body: {} },
    ])
  })

  test("migration preserves variant IDs and lowers every native body", () => {
    const built = buildProviderConfig(valid)
    const persisted = built.models?.["gpt-5.4"]?.variants ?? {}
    const migrated = ConfigMigrateV1.migrate({ provider: { [valid.providerID]: built } })
    const native = migrated.providers?.[valid.providerID]?.models?.["gpt-5.4"]?.variants ?? []
    expect(native.map((variant) => variant.id)).toEqual(Object.keys(persisted))
    for (const variant of native) {
      expect(variant.body).toEqual(ConfigProviderOptionsV1.get(built.npm).request(persisted[variant.id] ?? {}))
    }
  })
})

describe("custom provider discovery helpers", () => {
  test.each([
    ["https://api.example.com", ["https://api.example.com/v1/models"]],
    ["https://api.example.com/v1/", ["https://api.example.com/v1/models"]],
    [
      "https://api.example.com/paas/v4",
      ["https://api.example.com/paas/v4/models", "https://api.example.com/paas/v4/v1/models"],
    ],
  ] as const)("builds stable candidates for %s", (baseURL, expected) => {
    expect(buildModelsURLCandidates(baseURL)).toEqual([...expected])
  })

  test.each([
    "/api/claudecode",
    "/api/anthropic",
    "/apps/anthropic",
    "/api/coding",
    "/claudecode",
    "/anthropic",
    "/step_plan",
    "/coding",
    "/claude",
  ])("strips known compatibility suffix %s after trying it directly", (suffix) => {
    expect(buildModelsURLCandidates(`https://api.example.com${suffix}`)).toEqual([
      `https://api.example.com${suffix}/v1/models`,
      "https://api.example.com/v1/models",
      "https://api.example.com/models",
    ])
  })

  test("builds protocol authentication and lets custom headers override defaults case-insensitively", () => {
    expect(
      Object.fromEntries(
        buildDiscoveryHeaders({ protocol: "openai-compatible", baseURL: valid.baseURL, headers: [] }, "secret"),
      ),
    ).toEqual({ authorization: "Bearer secret" })
    expect(
      Object.fromEntries(
        buildDiscoveryHeaders(
          {
            protocol: "anthropic-messages",
            baseURL: valid.baseURL,
            headers: [
              { name: "X-API-Key", value: "override" },
              { name: "Anthropic-Version", value: "custom" },
            ],
          },
          "secret",
        ),
      ),
    ).toEqual({ "anthropic-version": "custom", "x-api-key": "override" })
  })

  test.each([
    [["model-a"], [{ id: "model-a" }]],
    [
      { data: [{ id: "model-b", display_name: "Model B", reasoning: true, context_window: 10, max_output: 5 }] },
      [{ id: "model-b", name: "Model B", reasoning: true, context: 10, output: 5 }],
    ],
    [
      {
        models: [
          { slug: "model-c", displayName: "Model C", supports_reasoning: false, contextWindow: 20, maxOutput: 10 },
        ],
      },
      [{ id: "model-c", name: "Model C", reasoning: false, context: 20, output: 10 }],
    ],
    [
      {
        items: [
          {
            model: "model-d",
            label: "Model D",
            supportsReasoning: true,
            max_context_length: 30,
            max_output_tokens: 15,
          },
        ],
      },
      [{ id: "model-d", name: "Model D", reasoning: true, context: 30, output: 15 }],
    ],
    [{ items: [{ name: "model-g" }] }, [{ id: "model-g", name: "model-g" }]],
    [
      { "model-e": { maxContextLength: 40, maxOutputTokens: 20 }, "model-f": "ignored display value" },
      [{ id: "model-e", context: 40, output: 20 }, { id: "model-f" }],
    ],
  ] as const)("normalizes a documented catalog shape", (input, expected) => {
    expect(normalizeModelCatalog(input)).toEqual([...expected])
  })

  test("ignores unsupported object-record values while retaining string and object key fallback", () => {
    expect(
      normalizeModelCatalog({
        objectModel: { display_name: "Object Model" },
        stringModel: "advisory display value",
        nullish: null,
        numeric: 42,
        boolean: false,
        array: [],
      }),
    ).toEqual([{ id: "objectModel", name: "Object Model" }, { id: "stringModel" }])
  })

  test("deduplicates trimmed IDs, sorts them, and ignores invalid metadata", () => {
    expect(
      normalizeModelCatalog([
        { id: " z ", context_window: 0, max_output: Number.MAX_SAFE_INTEGER + 1 },
        { id: "a", name: " A " },
        { id: "z", display_name: "Last duplicate wins" },
        { id: " " },
        42,
      ]),
    ).toEqual([
      { id: "a", name: "A" },
      { id: "z", name: "Last duplicate wins" },
    ])
  })
})

describe("custom provider redaction", () => {
  test("redacts credential-like headers case-insensitively", () => {
    expect(
      redactHeaders({
        Authorization: "Bearer secret",
        "X-API-Key": "secret",
        "X-Session-Token": "secret",
        "Client-Secret": "secret",
        "X-Custom": "visible",
      }),
    ).toEqual({
      Authorization: "[REDACTED]",
      "X-API-Key": "[REDACTED]",
      "X-Session-Token": "[REDACTED]",
      "Client-Secret": "[REDACTED]",
      "X-Custom": "visible",
    })
  })

  test("redacted URLs retain only protocol, host, port, and pathname", () => {
    expect(redactURL("https://user:password@example.com:8443/v1/models?api_key=secret#token")).toBe(
      "https://example.com:8443/v1/models",
    )
  })
})
