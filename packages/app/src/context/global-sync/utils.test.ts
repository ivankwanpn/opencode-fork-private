import { describe, expect, test } from "bun:test"
import type { AgentListOutput } from "@opencode-ai/client/promise"
import type { ProviderCatalog } from "@opencode-ai/schema/provider-catalog"
import { directoryKey, normalizeAgentList, normalizePermissionRequest, normalizeProviderList } from "./utils"

describe("normalizeAgentList", () => {
  test("adapts current agents to the app agent shape", () => {
    const result = normalizeAgentList([
      {
        id: "build",
        name: "Build",
        mode: "primary",
        hidden: false,
        color: "primary",
        model: { id: "gpt-5", providerID: "openai", variant: "high", protocol: "openai-responses" },
        request: { settings: { temperature: 0.2, topP: 0.9 }, headers: {}, body: {} },
        system: "Build software",
        permissions: [{ action: "read", resource: "*", effect: "allow" }],
      },
    ] as unknown as AgentListOutput["data"])

    expect(result).toEqual([
      {
        name: "build",
        description: undefined,
        mode: "primary",
        hidden: false,
        temperature: 0.2,
        topP: 0.9,
        color: "primary",
        permission: [{ permission: "read", pattern: "*", action: "allow" }],
        model: { providerID: "openai", modelID: "gpt-5", protocol: "openai-responses" },
        variant: "high",
        prompt: "Build software",
        options: { temperature: 0.2, topP: 0.9 },
        steps: undefined,
      },
    ])
  })

  test("does not throw when the v2 server omits request.settings", () => {
    // v2 伺服器實際回傳的 request 可能只有 {headers, body} 而沒有 settings。
    const result = normalizeAgentList([
      {
        id: "build",
        name: "Build",
        mode: "primary",
        hidden: false,
        model: { id: "gpt-5", providerID: "openai" },
        request: { headers: {}, body: {} },
        system: "Build software",
        permissions: [],
      },
      // 伺服器實際回應的 request 結構與型別宣告不一致(缺 settings),先轉 unknown 再轉目標型別。
    ] as unknown as AgentListOutput["data"])

    expect(result).toEqual([
      {
        name: "build",
        description: undefined,
        mode: "primary",
        hidden: false,
        temperature: undefined,
        topP: undefined,
        color: undefined,
        permission: [],
        model: { providerID: "openai", modelID: "gpt-5" },
        variant: undefined,
        prompt: "Build software",
        options: {},
        steps: undefined,
      },
    ])
  })
})

describe("normalizePermissionRequest", () => {
  test("adapts the current permission request to app state", () => {
    expect(
      normalizePermissionRequest({
        id: "permission-1",
        sessionID: "session-1",
        action: "read",
        resources: ["README.md"],
        save: ["*.md"],
        metadata: { path: "README.md" },
        source: { type: "tool", messageID: "message-1", callID: "call-1" },
      }),
    ).toEqual({
      id: "permission-1",
      sessionID: "session-1",
      permission: "read",
      patterns: ["README.md"],
      always: ["*.md"],
      metadata: { path: "README.md" },
      tool: { messageID: "message-1", callID: "call-1" },
    })
  })
})

describe("normalizeProviderList", () => {
  test("normalizes the native v2 provider catalog", () => {
    const result = normalizeProviderList({
      providers: [
        {
          info: {
            id: "openai",
            name: "OpenAI",
            api: {
              type: "aisdk",
              package: "@ai-sdk/openai",
              url: "https://api.openai.com/v1",
              settings: { compatibility: "strict" },
            },
            request: { headers: { "x-provider": "openai" }, body: { providerOption: true } },
          },
          source: "api",
          env: ["OPENAI_API_KEY"],
        },
      ],
      models: [
        {
          id: "gpt-5",
          providerID: "openai",
          name: "GPT-5",
          api: {
            id: "gpt-5",
            type: "aisdk",
            package: "@ai-sdk/openai",
            settings: { modelOption: true },
          },
          capabilities: { tools: true, input: ["text", "image"], output: ["text"], reasoning: true },
          request: { headers: { "x-model": "gpt-5" }, body: { requestOption: true } },
          variants: [{ id: "high", headers: {}, body: { reasoningEffort: "high" } }],
          time: { released: 1 },
          cost: [{ input: 1, output: 2, cache: { read: 0.1, write: 0.2 } }],
          status: "active",
          enabled: true,
          limit: { context: 128_000, output: 8_192 },
        },
        {
          id: "gpt-old",
          providerID: "openai",
          name: "GPT Old",
          api: { id: "gpt-old", type: "aisdk", package: "@ai-sdk/openai", settings: {} },
          capabilities: { tools: false, input: ["text"], output: ["text"] },
          request: { headers: {}, body: {} },
          variants: [],
          time: { released: 0 },
          cost: [],
          status: "deprecated",
          enabled: true,
          limit: { context: 1, output: 1 },
        },
      ],
      connected: ["openai"],
      default: { openai: "gpt-5" },
    } as unknown as ProviderCatalog.Info)

    expect(result.connected).toEqual(["openai"])
    expect(result.default).toEqual({ openai: "gpt-5" })
    expect(result.all.get("openai")?.models["gpt-old"]).toBeUndefined()
    expect(result.all.get("openai")).toMatchObject({
      source: "api",
      env: ["OPENAI_API_KEY"],
      options: { compatibility: "strict", providerOption: true },
    })
    expect(result.all.get("openai")?.models["gpt-5"]).toMatchObject({
      id: "gpt-5",
      providerID: "openai",
      api: { url: "https://api.openai.com/v1", npm: "@ai-sdk/openai" },
      capabilities: { toolcall: true, attachment: true, reasoning: true },
      cost: { input: 1, output: 2 },
      options: { modelOption: true, requestOption: true },
      headers: { "x-model": "gpt-5" },
      variants: { high: { reasoningEffort: "high" } },
    })
  })
})

describe("directoryKey", () => {
  test("normalizes slashes", () => {
    expect(String(directoryKey("C:\\Repos\\sst\\opencode"))).toBe("C:/Repos/sst/opencode")
    expect(String(directoryKey("C:/Repos/sst/opencode"))).toBe("C:/Repos/sst/opencode")
  })

  test("preserves backslashes in posix paths", () => {
    expect(String(directoryKey("/tmp/foo\\bar"))).toBe("/tmp/foo\\bar")
  })

  test("trims trailing slashes without breaking roots", () => {
    expect(String(directoryKey("C:/Repos/sst/opencode/"))).toBe("C:/Repos/sst/opencode")
    expect(String(directoryKey("C:/"))).toBe("C:/")
    expect(String(directoryKey("/"))).toBe("/")
  })
})
