import { describe, expect, test } from "bun:test"
import { fetchCodexModels, parseCodexModels } from "../../src/plugin/provider/codex-models"
import { InstallationVersion } from "@opencode-ai/core/installation/version"

describe("codex model discovery", () => {
  test("accepts supported response envelopes and uses safe name fallback", () => {
    expect(
      parseCodexModels({
        data: [
          { id: "gpt-data", contextWindow: 256_000 },
          { slug: "gpt-slug", name: "GPT Slug", context_window: 128_000 },
          { name: "missing id" },
          null,
        ],
      }),
    ).toEqual([
      { id: "gpt-data", context: 256_000 },
      { id: "gpt-slug", name: "GPT Slug", context: 128_000 },
      { id: "missing id", name: "missing id" },
    ])
  })

  test("accepts cc-switch response shapes and display names", () => {
    expect(
      parseCodexModels({
        items: [
          "gpt-string",
          { slug: "gpt-slug", display_name: "GPT Slug" },
          { model: "gpt-model" },
        ],
      }),
    ).toEqual([
      { id: "gpt-model" },
      { id: "gpt-slug", name: "GPT Slug" },
      { id: "gpt-string" },
    ])
  })

  test("accepts a cc-switch model map and de-duplicates ids", () => {
    expect(
      parseCodexModels({
        models: {
          "gpt-map": { display_name: "GPT Map" },
          duplicate: { id: "gpt-map" },
        },
      }),
    ).toEqual([{ id: "gpt-map", name: "GPT Map" }])
  })

  test("adds the OpenCode client version, originator, account header, and timeout", async () => {
    let request: { url: string; init?: RequestInit } | undefined
    const response = await fetchCodexModels(
      { access: "access-token", accountId: "account-123" },
      {
        endpoint: "https://chatgpt.com/backend-api/codex/models?existing=true",
        timeoutMs: 15_000,
        fetch: (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
          request = { url: String(input), init }
          return Response.json({ models: [{ slug: "gpt-live" }] })
        }) as unknown as typeof fetch,
      },
    )

    expect(response).toEqual([{ id: "gpt-live" }])
    expect(new URL(request?.url ?? "https://invalid").searchParams.get("existing")).toBe("true")
    expect(new URL(request?.url ?? "https://invalid").searchParams.get("client_version")).toBe(InstallationVersion)
    expect(new Headers(request?.init?.headers).get("originator")).toBe("opencode")
    expect(new Headers(request?.init?.headers).get("ChatGPT-Account-Id")).toBe("account-123")
    expect(request?.init?.signal).toBeInstanceOf(AbortSignal)
  })

  test("derives the ChatGPT account header from a JWT access token", async () => {
    const payload = Buffer.from(JSON.stringify({ chatgpt_account_id: "account-from-token" })).toString("base64url")
    const access = `header.${payload}.signature`
    let headers: Headers | undefined

    await fetchCodexModels(
      { access },
      {
        fetch: (async (_input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
          headers = new Headers(init?.headers)
          return Response.json({ models: [{ id: "gpt-live" }] })
        }) as unknown as typeof fetch,
      },
    )

    expect(headers?.get("ChatGPT-Account-Id")).toBe("account-from-token")
  })
})
