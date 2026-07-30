import { describe, expect, test } from "bun:test"
import {
  initialWizardState,
  transition,
  type CustomProviderDiscoveredModel,
  type CustomProviderInput,
  type WizardAction,
  type WizardState,
} from "../../src/component/custom-provider-wizard"

const discovered = {
  id: "claude-sonnet",
  name: "Discovered Sonnet",
  reasoning: true,
  context: 200_000,
  output: 8_192,
} satisfies CustomProviderDiscoveredModel

function run(actions: readonly WizardAction[], state = initialWizardState()) {
  return actions.reduce(transition, state)
}

describe("custom provider wizard", () => {
  test("uses the designed forward step order", () => {
    const steps = [initialWizardState().step]
    const actions: readonly WizardAction[] = [
      ...actionsToConnection(),
      { type: "manual" },
      { type: "setModelID", value: "claude-sonnet" },
      { type: "setModelName", value: "Claude Sonnet" },
      { type: "setModelReasoning", value: true },
      { type: "setModelContext", value: 200_000 },
      { type: "setModelOutput", value: 8_192 },
      { type: "finish" },
    ]
    const state = actions.reduce((current, action) => {
      const next = transition(current, action)
      steps.push(next.step)
      return next
    }, initialWizardState() as WizardState)
    expect(steps).toEqual([
      "providerID",
      "name",
      "protocol",
      "baseURL",
      "apiKey",
      "headers",
      "source",
      "modelSelect",
      "modelName",
      "modelReasoning",
      "modelContext",
      "modelOutput",
      "modelNext",
      "review",
    ])
    expect(state.step).toBe("review")
  })

  test("Back returns to the previous step without losing protocol or inputs", () => {
    const connected = run(actionsToConnection())
    const backed = transition(transition(connected, { type: "back" }), { type: "back" })
    expect(backed.step).toBe("apiKey")
    expect(backed.input).toEqual(connected.input)
    expect(backed.input.protocol).toBe("anthropic-messages")
  })

  test("Cancel has no save effect", () => {
    const state = run(actionsToConnection())
    expect(transition(state, { type: "cancel" })).toBe(state)
  })

  test("Retry retains the same connection values", () => {
    const state = run(actionsToConnection())
    const retry = transition(state, { type: "retry" })
    expect(retry.step).toBe("source")
    expect(retry.input).toEqual(state.input)
  })

  test("Manual Entry creates exactly one blank model draft", () => {
    const state = transition(run(actionsToConnection()), { type: "manual" })
    expect(state.step).toBe("modelSelect")
    expect(state.editingModel).toBe(0)
    expect(state.input.models).toEqual([{ id: "", name: "" }])
  })

  test("discovered metadata fills blank model fields", () => {
    const state: WizardState = {
      ...initialWizardState(),
      step: "modelSelect",
      discovered: [discovered],
      input: {
        ...initialWizardState().input,
        models: [{ id: discovered.id, name: "" }],
      },
    }
    expect(transition(state, { type: "selectModel", value: discovered }).input.models[0]).toEqual({
      id: "claude-sonnet",
      name: "Discovered Sonnet",
      reasoning: true,
      context: 200_000,
      output: 8_192,
    })
  })

  test("revisiting a model does not overwrite user-edited metadata", () => {
    const state: WizardState = {
      ...initialWizardState(),
      step: "modelSelect",
      discovered: [discovered],
      input: {
        ...initialWizardState().input,
        models: [
          {
            id: discovered.id,
            name: "My Sonnet",
            reasoning: false,
            context: 100_000,
            output: 4_096,
          },
        ],
      },
    }
    expect(transition(state, { type: "selectModel", value: discovered }).input.models[0]).toEqual(state.input.models[0])
  })

  test("Add Another loops to model selection and Finish reaches review", () => {
    const modelNext = run([
      ...actionsToConnection(),
      { type: "manual" },
      { type: "setModelID", value: "claude-sonnet" },
      { type: "setModelName", value: "Claude Sonnet" },
      { type: "setModelReasoning", value: true },
      { type: "setModelContext", value: 200_000 },
      { type: "setModelOutput", value: 8_192 },
    ])
    expect(transition(modelNext, { type: "addAnother" }).step).toBe("modelSelect")
    expect(transition(modelNext, { type: "finish" }).step).toBe("review")
  })

  test("save exposes the canonical cross-surface parity fixture", () => {
    const state = run([
      ...actionsToConnection(),
      { type: "manual" },
      { type: "setModelID", value: " claude-sonnet " },
      { type: "setModelName", value: " Claude Sonnet " },
      { type: "setModelReasoning", value: true },
      { type: "setModelContext", value: 200_000 },
      { type: "setModelOutput", value: 8_192 },
      { type: "finish" },
      { type: "save" },
    ])
    expect(state.input).toEqual({
      providerID: "parity-provider",
      name: "Parity Provider",
      protocol: "anthropic-messages",
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
    } satisfies CustomProviderInput)
  })
})

function actionsToConnection(): readonly WizardAction[] {
  return [
    { type: "setProviderID", value: " parity-provider " },
    { type: "setName", value: " Parity Provider " },
    { type: "setProtocol", value: "anthropic-messages" },
    { type: "setBaseURL", value: " https://api.example.com/v1 " },
    { type: "setApiKey", value: " parity-secret " },
    { type: "setHeaders", value: [{ name: "x-tenant", value: "acme" }] },
  ]
}
