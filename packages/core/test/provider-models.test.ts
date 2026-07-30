import { describe, expect, test } from "bun:test"
import {
  buildModelURLCandidates,
  fetchProviderModels,
  parseProviderModels,
  supportsProviderModelDiscovery,
} from "../src/provider-models"

describe("provider model discovery", () => {
  test("allows compatible OpenCode and API-key OpenAI providers while preserving native exclusions", () => {
    expect(
      supportsProviderModelDiscovery({
        providerID: "opencode",
        packageName: "@ai-sdk/openai-compatible",
        baseURL: "https://opencode.ai/zen/v1",
      }),
    ).toBe(true)
    expect(
      supportsProviderModelDiscovery({
        providerID: "openai",
        packageName: "@ai-sdk/openai",
        baseURL: "https://api.openai.com/v1",
      }),
    ).toBe(true)
    expect(
      supportsProviderModelDiscovery({
        providerID: "google-vertex",
        packageName: "@ai-sdk/google-vertex",
        baseURL: "https://aiplatform.googleapis.com/v1",
      }),
    ).toBe(false)
  })

  test("builds compatible model endpoint candidates", () => {
    expect(buildModelURLCandidates("https://api.example.com")).toEqual(["https://api.example.com/v1/models"])
    expect(buildModelURLCandidates("https://api.example.com/v4")).toEqual([
      "https://api.example.com/v4/models",
      "https://api.example.com/v4/v1/models",
    ])
    expect(buildModelURLCandidates("https://api.example.com/api/anthropic")).toEqual([
      "https://api.example.com/api/anthropic/v1/models",
      "https://api.example.com/v1/models",
      "https://api.example.com/models",
    ])
  })

  test("parses common provider catalog envelopes and normalizes model names", () => {
    expect(
      parseProviderModels({
        data: [
          { id: "gpt-live", owned_by: "openai", context_length: 256_000 },
          { name: "models/gemini-live", display_name: "Gemini Live", inputTokenLimit: 128_000 },
          { id: "gpt-live" },
          { display_name: "missing id" },
        ],
      }),
    ).toEqual([
      { id: "gpt-live", ownedBy: "openai", context: 256_000 },
      { id: "gemini-live", name: "Gemini Live", context: 128_000 },
    ])

    expect(parseProviderModels({ models: ["claude-live"] })).toEqual([{ id: "claude-live" }])
  })

  test("tries endpoint fallbacks and applies provider authentication", async () => {
    const calls: string[] = []
    const result = await fetchProviderModels({
      baseURL: "https://api.example.com/api/anthropic",
      packageName: "@ai-sdk/anthropic",
      apiKey: "secret",
      fetch: async (input, init) => {
        calls.push(String(input))
        expect(new Headers(init?.headers).get("x-api-key")).toBe("secret")
        expect(new Headers(init?.headers).get("authorization")).toBeNull()
        if (calls.length === 1) return new Response("missing", { status: 404 })
        return Response.json({ data: [{ id: "claude-live" }] })
      },
    })

    expect(calls).toEqual(["https://api.example.com/api/anthropic/v1/models", "https://api.example.com/v1/models"])
    expect(result.models).toEqual([{ id: "claude-live" }])
  })

  test("does not treat an empty catalog as a successful snapshot", async () => {
    await expect(
      fetchProviderModels({
        baseURL: "https://api.example.com/v1",
        apiKey: "secret",
        fetch: async () => Response.json({ data: [] }),
      }),
    ).rejects.toThrow("empty")
  })
})
