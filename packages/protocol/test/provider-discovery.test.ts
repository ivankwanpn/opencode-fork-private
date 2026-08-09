import { describe, expect, test } from "bun:test"
import { ProviderDiscovery } from "@opencode-ai/schema/provider-discovery"
import { Provider } from "@opencode-ai/schema/provider"
import { Schema } from "effect"
import { ProviderModelDiscoveryError } from "../src/errors"

describe("ProviderDiscovery", () => {
  test("decodes a discovery result without optional metadata", () => {
    const value = Schema.decodeUnknownSync(ProviderDiscovery.Result)({
      providerID: "openai",
      source: "oauth",
      models: [{ id: "runtime-model" }],
    })

    expect(value.models).toEqual([{ id: "runtime-model" }])
  })

  test("constructs a sanitized discovery error", () => {
    expect(
      new ProviderModelDiscoveryError({
        providerID: Provider.ID.make("openai"),
        kind: "authentication",
        message: "Provider authentication failed",
      }),
    ).toMatchObject({ providerID: "openai", kind: "authentication" })
  })
})
