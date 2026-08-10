import { describe, expect, test } from "bun:test"
import type { CustomProvider } from "@opencode-ai/schema/custom-provider"
import {
  canDiscoverModels,
  customProviderFormState,
  type FormState,
  mergeDiscoveredModels,
  modelRow,
  reconcileDiscoveredSelection,
  setModelReasoning,
  validateCustomProvider,
} from "./dialog-custom-provider-form"

const t = (key: string) => key

const form = (input: Partial<FormState> = {}): FormState => ({
  providerID: "custom-provider",
  name: "Custom Provider",
  baseURL: "https://api.example.com/v1",
  apiKey: "",
  models: [
    {
      row: "m0",
      id: "model-a",
      name: "Model A",
      reasoning: false,
      context: "",
      output: "",
      err: {},
    },
  ],
  headers: [{ row: "h0", key: "", value: "", err: {} }],
  err: {},
  ...input,
})

const validate = (
  value: FormState,
  disabledProviders: string[] = [],
  existingProviderIDs = new Set<string>(),
  editingProviderID?: string,
) =>
  validateCustomProvider({
    form: value,
    t,
    disabledProviders,
    existingProviderIDs,
    editingProviderID,
  })

describe("validateCustomProvider", () => {
  test("builds an exact ConfigureInput payload without a setup-time protocol", () => {
    expect(
      validate(
        form({
          name: " Custom Provider ",
          baseURL: " https://api.example.com/v1 ",
          apiKey: " secret ",
          models: [
            {
              row: "m0",
              id: " model-a ",
              name: " Model A ",
              reasoning: true,
              context: "128000",
              output: "8192",
              err: {},
            },
          ],
          headers: [
            { row: "h0", key: " X-Test ", value: " enabled ", err: {} },
            { row: "h1", key: "", value: "", err: {} },
          ],
        }),
      ).result,
    ).toEqual({
      providerID: "custom-provider",
      name: "Custom Provider",
      baseURL: "https://api.example.com/v1",
      apiKey: "secret",
      headers: [{ name: "X-Test", value: "enabled" }],
      models: [{ id: "model-a", name: "Model A", reasoning: true, context: 128000, output: 8192 }],
    } satisfies CustomProvider.ConfigureInput)
  })

  test("normalizes the canonical CLI and TUI parity fixture", () => {
    expect(
      validate(
        form({
          providerID: " parity-provider ",
          name: " Parity Provider ",
          baseURL: " https://api.example.com/v1 ",
          apiKey: " parity-secret ",
          headers: [{ row: "h0", key: " x-tenant ", value: " acme ", err: {} }],
          models: [
            {
              row: "m0",
              id: " claude-sonnet ",
              name: " Claude Sonnet ",
              reasoning: true,
              context: "200000",
              output: "8192",
              err: {},
            },
          ],
        }),
      ).result,
    ).toEqual({
      providerID: "parity-provider",
      name: "Parity Provider",
      baseURL: "https://api.example.com/v1",
      apiKey: "parity-secret",
      headers: [{ name: "x-tenant", value: "acme" }],
      models: [
        {
          id: "claude-sonnet",
          name: "Claude Sonnet",
          reasoning: true,
          context: 200000,
          output: 8192,
        },
      ],
    } satisfies CustomProvider.ConfigureInput)
  })

  test("keeps reasoning boolean and omits both blank limits", () => {
    expect(validate(form()).result?.models).toEqual([{ id: "model-a", name: "Model A", reasoning: false }])
    expect(typeof validate(form()).result?.models[0]?.reasoning).toBe("boolean")
  })

  test.each([
    ["1000", "", undefined, "provider.custom.error.limitPair"],
    ["", "100", "provider.custom.error.limitPair", undefined],
    ["1.5", "1", "provider.custom.error.limit", undefined],
    ["100", "-1", undefined, "provider.custom.error.limit"],
    ["100", "101", undefined, "provider.custom.error.outputExceedsContext"],
  ] as const)(
    "marks the exact invalid limit field for context=%s output=%s",
    (context, output, contextError, outputError) => {
      const result = validate(
        form({
          models: [{ ...modelRow({ id: "model-a", name: "Model A", context, output }) }],
        }),
      )
      expect(result.models[0]?.context).toBe(contextError)
      expect(result.models[0]?.output).toBe(outputError)
      expect(result.result).toBeUndefined()
    },
  )

  test("checks custom header duplicates case-insensitively and allows reconnecting a disabled provider", () => {
    const result = validate(
      form({
        headers: [
          { row: "h0", key: "Authorization", value: "one", err: {} },
          { row: "h1", key: "authorization", value: "two", err: {} },
        ],
      }),
      ["custom-provider"],
      new Set(["custom-provider"]),
    )
    expect(result.err.providerID).toBeUndefined()
    expect(result.headers[1]).toEqual({
      key: "provider.custom.error.duplicate",
      value: undefined,
    })
  })

  test("preloads editable custom settings without exposing or replacing the stored API key", () => {
    const state = customProviderFormState("custom-provider", {
      name: "Existing Provider",
      options: {
        baseURL: "https://existing.example/v1",
        headers: { "X-Tenant": "acme" },
      },
      models: {
        "model-a": {
          name: "Model A",
          reasoning: true,
          limit: { context: 128000, output: 8192 },
        },
      },
    })
    expect(state).toMatchObject({
      providerID: "custom-provider",
      name: "Existing Provider",
      baseURL: "https://existing.example/v1",
      apiKey: "",
      models: [{ id: "model-a", name: "Model A", reasoning: true, context: "128000", output: "8192" }],
      headers: [{ key: "X-Tenant", value: "acme" }],
    })

    const result = validate(state, [], new Set(["custom-provider"]), "custom-provider").result
    expect(result).toMatchObject({
      providerID: "custom-provider",
      update: true,
      name: "Existing Provider",
      baseURL: "https://existing.example/v1",
    })
    expect(result).not.toHaveProperty("apiKey")
  })
})

describe("model discovery", () => {
  test("stays disabled until a valid HTTP(S) Base URL is present", () => {
    expect(canDiscoverModels("")).toBe(false)
    expect(canDiscoverModels("api.example.com")).toBe(false)
    expect(canDiscoverModels("ftp://api.example.com")).toBe(false)
    expect(canDiscoverModels("https://api.example.com")).toBe(true)
  })

  test("imports only selected IDs and gives new rows metadata defaults", () => {
    const discovered = [
      { id: "model-b", name: "Model B", reasoning: true, context: 64000, output: 4096 },
      { id: "model-c", name: "Model C" },
    ] satisfies CustomProvider.DiscoveredModel[]
    const result = mergeDiscoveredModels(form().models, discovered, new Set(["model-b"]))
    expect(result.map((model) => model.id)).toEqual(["model-a", "model-b"])
    expect(result[1]).toMatchObject({
      id: "model-b",
      name: "Model B",
      reasoning: true,
      context: "64000",
      output: "4096",
    })
  })

  test("leaves the first discovery unselected and preserves only still-available selections", () => {
    const discovered = [{ id: "model-a" }, { id: "model-b" }] satisfies CustomProvider.DiscoveredModel[]

    expect(reconcileDiscoveredSelection([], discovered)).toEqual([])
    expect(reconcileDiscoveredSelection(["model-a", "model-c"], discovered)).toEqual(["model-a"])
  })

  test("re-discovery preserves all user edits", () => {
    const edited = modelRow({
      id: "model-a",
      name: "My Model",
      reasoning: false,
      context: "32000",
      output: "2000",
    })
    const result = mergeDiscoveredModels(
      [edited],
      [{ id: "model-a", name: "Server Name", reasoning: true, context: 128000, output: 8192 }],
      new Set(["model-a"]),
    )
    expect(result).toEqual([edited])
  })

  test("updates reasoning by replacing only the selected model row", () => {
    const models = [modelRow({ id: "model-a", reasoning: false }), modelRow({ id: "model-b", reasoning: false })]
    const result = setModelReasoning(models, 1, true)

    expect(result).not.toBe(models)
    expect(result[0]).toBe(models[0])
    expect(result[1]).not.toBe(models[1])
    expect(result.map((model) => model.reasoning)).toEqual([false, true])
  })

  test("deduplicates manual and discovered rows by model ID", () => {
    const manual = modelRow({ id: "same-model", name: "Manual" })
    const duplicate = modelRow({ id: "same-model", name: "Duplicate" })
    const result = mergeDiscoveredModels(
      [manual, duplicate],
      [{ id: "same-model", name: "Discovered" }],
      new Set(["same-model"]),
    )
    expect(result).toEqual([manual])
  })

  test("a discovery failure can preserve every connection field and leaves manual rows constructible", () => {
    const before = form({
      apiKey: "secret",
      headers: [{ row: "h0", key: "x-tenant", value: "acme", err: {} }],
    })
    const snapshot = structuredClone(before)
    const manual = modelRow()
    expect(before).toEqual(snapshot)
    expect(manual).toMatchObject({ id: "", name: "", reasoning: false, context: "", output: "" })
  })
})
