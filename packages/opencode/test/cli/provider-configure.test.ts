import { describe, expect, test } from "bun:test"
import { Config } from "@/config/config"
import {
  runProviderConfigureWizard,
  type SelectQuestion,
  type TextQuestion,
  type WizardIO,
} from "@/cli/cmd/provider-configure"
import { buildProviderConfig } from "@/provider/custom-provider/domain"
import { discover } from "@/provider/custom-provider/discovery"
import { CustomProvider } from "@opencode-ai/schema/custom-provider"
import { Effect } from "effect"

type Answer = string | boolean
type Configure = Parameters<typeof runProviderConfigureWizard>[0]["configure"]

const discovered = {
  endpoint: "https://api.example.com/v1/models",
  models: [
    {
      id: "model-a",
      name: "Discovered A",
      reasoning: true,
      context: 128_000,
      output: 8_192,
    },
    { id: "model-b", name: "Discovered B" },
  ],
} satisfies CustomProvider.DiscoverResult

const parityInput = {
  providerID: "parity-provider",
  name: "Parity Provider",
  protocol: "openai-compatible",
  baseURL: "https://api.example.com/v1",
  apiKey: "parity-secret",
  headers: [{ name: "x-tenant", value: "acme" }],
  models: [
    {
      id: "claude-sonnet",
      name: "Claude Sonnet",
      reasoning: true,
      context: 200_000,
      output: 8_192,
    },
  ],
} satisfies CustomProvider.ConfigureInput

function scripted(queued: readonly Answer[]) {
  const answers = [...queued]
  const questions: Array<TextQuestion | SelectQuestion<unknown>> = []
  const logs: string[] = []
  const next = () =>
    Effect.sync(() => {
      const value = answers.shift()
      if (value === undefined) throw new Error("scripted wizard ran out of answers")
      return value
    })
  const text = (input: TextQuestion) => {
    questions.push(input)
    return next().pipe(
      Effect.map((value) => {
        if (typeof value !== "string") throw new Error("text prompt received a non-text answer")
        return value
      }),
    )
  }
  const io: WizardIO = {
    text,
    password: text,
    select: <A>(input: SelectQuestion<A>) => {
      questions.push(input)
      return next().pipe(Effect.map((value) => value as A | "back" | "cancel"))
    },
    log: (message) =>
      Effect.sync(() => {
        logs.push(message)
      }),
  }
  return { io, questions, logs, answers }
}

function recorder() {
  const configured: CustomProvider.ConfigureInput[] = []
  const configure: Configure = (input) => {
    configured.push(input)
    return Effect.succeed({
      providerID: input.providerID,
      name: input.name,
      protocol: input.protocol ?? "openai-compatible",
      models: input.models.map((model) => model.id),
    })
  }
  return { configured, configure }
}

const noDiscovery: typeof discover = () => Effect.die(new Error("discovery should not be called"))

function manualAnswers(input: {
  readonly id?: string
  readonly name?: string
  readonly modelID?: string
  readonly modelName?: string
  readonly reasoning?: boolean
  readonly context?: string
  readonly output?: string
}) {
  return [
    ...(input.id === undefined ? [] : [input.id]),
    input.name ?? "Custom Provider",
    "https://api.example.com/v1",
    "secret",
    "finish",
    "manual",
    input.modelID ?? "model-a",
    input.modelName ?? "Model A",
    input.reasoning ?? false,
    input.context ?? "",
    input.output ?? "",
    "finish",
    "save",
  ] satisfies Answer[]
}

describe("provider configure wizard", () => {
  test("a supplied id skips only the provider ID question", async () => {
    const script = scripted(manualAnswers({}))
    const saved = recorder()
    await Effect.runPromise(
      runProviderConfigureWizard({
        id: "from-argument",
        io: script.io,
        discover: noDiscovery,
        configure: saved.configure,
      }),
    )

    expect(script.questions[0]?.message).toBe("Display name")
    expect(script.questions.some((question) => question.message === "Provider ID")).toBe(false)
    expect(saved.configured[0]?.providerID).toBe("from-argument")
    expect(script.answers).toEqual([])
  })

  test("persists a protocol-neutral provider package", async () => {
    const script = scripted(manualAnswers({ id: "provider-neutral" }))
    let configuredPackage: string | undefined
    const configure: Configure = (input) => {
      configuredPackage = buildProviderConfig(input).npm
      return Effect.succeed({
        providerID: input.providerID,
        name: input.name,
        protocol: input.protocol ?? "openai-compatible",
        models: input.models.map((model) => model.id),
      })
    }

    await Effect.runPromise(
      runProviderConfigureWizard({ io: script.io, discover: noDiscovery, configure }),
    )
    expect(configuredPackage).toBe("@ai-sdk/openai-compatible")
  })

  test("selects a discovered model and edits reasoning and limits", async () => {
    const script = scripted([
      "discovered-provider",
      "Discovered Provider",
      "https://api.example.com/v1",
      "{env:DISCOVERY_KEY}",
      "finish",
      "discover",
      "model:model-a",
      "Edited Model A",
      false,
      "64000",
      "4096",
      "finish",
      "save",
    ])
    const saved = recorder()
    await Effect.runPromise(
      runProviderConfigureWizard({
        io: script.io,
        discover: () => Effect.succeed(discovered),
        configure: saved.configure,
      }),
    )

    expect(saved.configured[0]?.models).toEqual([
      {
        id: "model-a",
        name: "Edited Model A",
        reasoning: false,
        context: 64_000,
        output: 4_096,
      },
    ])
  })

  test("retries discovery with the same connection values", async () => {
    const script = scripted([
      "retry-provider",
      "Retry Provider",
      "https://api.example.com/v1",
      "secret",
      "finish",
      "discover",
      "retry",
      "model:model-a",
      "Model A",
      true,
      "128000",
      "8192",
      "finish",
      "save",
    ])
    const calls: CustomProvider.DiscoverInput[] = []
    const retrying: typeof discover = (input) => {
      calls.push(input)
      if (calls.length === 1) {
        return Effect.fail(
          new CustomProvider.DiscoveryError({
            kind: "network",
            message: "Model discovery request failed",
          }),
        )
      }
      return Effect.succeed(discovered)
    }

    await Effect.runPromise(
      runProviderConfigureWizard({
        io: script.io,
        discover: retrying,
        configure: recorder().configure,
      }),
    )
    expect(calls).toHaveLength(2)
    expect(calls[1]).toEqual(calls[0])
  })

  test("falls back to manual entry after discovery failure", async () => {
    const script = scripted([
      "manual-fallback",
      "Manual Fallback",
      "https://api.example.com/v1",
      "",
      "finish",
      "discover",
      "manual",
      "manual-model",
      "Manual Model",
      false,
      "",
      "",
      "finish",
      "save",
    ])
    const saved = recorder()
    await Effect.runPromise(
      runProviderConfigureWizard({
        io: script.io,
        discover: () =>
          Effect.fail(
            new CustomProvider.DiscoveryError({
              kind: "status",
              status: 404,
              message: "Model discovery endpoint returned an unsuccessful status",
            }),
          ),
        configure: saved.configure,
      }),
    )
    expect(saved.configured[0]?.models).toEqual([
      { id: "manual-model", name: "Manual Model", reasoning: false },
    ])
  })

  test("Back restores the previous draft and preserves earlier answers", async () => {
    const script = scripted([
      "back-provider",
      "Original Name",
      "back",
      "Edited Name",
      "https://api.example.com/v1",
      "",
      "finish",
      "manual",
      "model-a",
      "Model A",
      false,
      "",
      "",
      "finish",
      "save",
    ])
    const saved = recorder()
    await Effect.runPromise(
      runProviderConfigureWizard({ io: script.io, discover: noDiscovery, configure: saved.configure }),
    )

    const nameQuestions = script.questions.filter((question) => question.message === "Display name") as TextQuestion[]
    expect(nameQuestions[1]?.initialValue).toBe("Original Name")
    expect(saved.configured[0]).toMatchObject({
      providerID: "back-provider",
      name: "Edited Name",
    })
  })

  test("Cancel is side-effect-free", async () => {
    const script = scripted(["cancel"])
    let discoveries = 0
    let configurations = 0
    const result = await Effect.runPromise(
      runProviderConfigureWizard({
        io: script.io,
        discover: (input) => {
          discoveries++
          return discover(input)
        },
        configure: (input) => {
          configurations++
          return recorder().configure(input)
        },
      }),
    )
    expect(result).toBeUndefined()
    expect(discoveries).toBe(0)
    expect(configurations).toBe(0)
  })

  test("Add another repeats manual model entry and saves two models", async () => {
    const script = scripted([
      "two-models",
      "Two Models",
      "https://api.example.com/v1",
      "",
      "finish",
      "manual",
      "model-a",
      "Model A",
      false,
      "",
      "",
      "add",
      "model-b",
      "Model B",
      true,
      "32000",
      "4000",
      "finish",
      "save",
    ])
    const saved = recorder()
    await Effect.runPromise(
      runProviderConfigureWizard({ io: script.io, discover: noDiscovery, configure: saved.configure }),
    )
    expect(saved.configured[0]?.models.map((model) => model.id)).toEqual(["model-a", "model-b"])
  })

  test("normalizes and saves the canonical cross-surface parity fixture", async () => {
    const script = scripted([
      " parity-provider ",
      " Parity Provider ",
      " https://api.example.com/v1 ",
      " parity-secret ",
      "add",
      " x-tenant ",
      " acme ",
      "finish",
      "manual",
      " claude-sonnet ",
      " Claude Sonnet ",
      true,
      "200000",
      "8192",
      "finish",
      "save",
    ])
    const saved = recorder()
    await Effect.runPromise(
      runProviderConfigureWizard({ io: script.io, discover: noDiscovery, configure: saved.configure }),
    )
    expect(saved.configured).toEqual([parityInput])
  })

  test("prints a secret-free success summary with the exact global config destination", async () => {
    const script = scripted(manualAnswers({ id: "summary-provider" }))
    await Effect.runPromise(
      runProviderConfigureWizard({
        io: script.io,
        discover: noDiscovery,
        configure: recorder().configure,
      }),
    )
    const summary = script.logs.join("\n")
    expect(summary).toContain("summary-provider")
    expect(summary).toContain("openai-compatible")
    expect(summary).toContain("1 model")
    expect(summary).toContain(Config.globalConfigFile())
    expect(summary).not.toContain("secret")
  })
})
