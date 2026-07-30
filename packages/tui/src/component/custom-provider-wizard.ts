import type { ProvidersConfigureCustomInput, ProvidersDiscoverCustomOutput } from "@opencode-ai/client"

export type CustomProviderInput = Omit<ProvidersConfigureCustomInput, "location">
export type CustomProviderProtocol = CustomProviderInput["protocol"]
export type CustomProviderHeader = CustomProviderInput["headers"][number]
export type CustomProviderModel = CustomProviderInput["models"][number]
export type CustomProviderDiscoveredModel = ProvidersDiscoverCustomOutput["data"]["models"][number]

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
  readonly input: CustomProviderInput
  readonly discovered: readonly CustomProviderDiscoveredModel[]
  readonly editingModel?: number
}

export type WizardAction =
  | { readonly type: "next" }
  | { readonly type: "back" }
  | { readonly type: "cancel" }
  | { readonly type: "save" }
  | { readonly type: "setProviderID"; readonly value: string }
  | { readonly type: "setName"; readonly value: string }
  | { readonly type: "setProtocol"; readonly value: CustomProviderProtocol }
  | { readonly type: "setBaseURL"; readonly value: string }
  | { readonly type: "setApiKey"; readonly value: string }
  | { readonly type: "setHeaders"; readonly value: readonly CustomProviderHeader[] }
  | { readonly type: "retry" }
  | { readonly type: "discovered"; readonly value: readonly CustomProviderDiscoveredModel[] }
  | { readonly type: "manual" }
  | { readonly type: "selectModel"; readonly value: CustomProviderDiscoveredModel }
  | { readonly type: "setModelID"; readonly value: string }
  | { readonly type: "setModelName"; readonly value: string }
  | { readonly type: "setModelReasoning"; readonly value: boolean }
  | { readonly type: "setModelContext"; readonly value?: number }
  | { readonly type: "setModelOutput"; readonly value?: number }
  | { readonly type: "editModel"; readonly index: number }
  | { readonly type: "addAnother" }
  | { readonly type: "finish" }

const NEXT: Partial<Record<WizardStep, WizardStep>> = {
  providerID: "name",
  name: "protocol",
  protocol: "baseURL",
  baseURL: "apiKey",
  apiKey: "headers",
  headers: "source",
  modelName: "modelReasoning",
  modelReasoning: "modelContext",
  modelContext: "modelOutput",
  modelOutput: "modelNext",
}

const PREVIOUS: Partial<Record<WizardStep, WizardStep>> = {
  name: "providerID",
  protocol: "name",
  baseURL: "protocol",
  apiKey: "baseURL",
  headers: "apiKey",
  source: "headers",
  modelSelect: "source",
  modelName: "modelSelect",
  modelReasoning: "modelName",
  modelContext: "modelReasoning",
  modelOutput: "modelContext",
  modelNext: "modelOutput",
  review: "modelNext",
}

export function initialWizardState(): WizardState {
  return {
    step: "providerID",
    input: {
      providerID: "",
      name: "",
      protocol: "openai-compatible",
      baseURL: "",
      headers: [],
      models: [],
    },
    discovered: [],
  }
}

export function transition(state: WizardState, action: WizardAction): WizardState {
  if (action.type === "next") {
    const step = NEXT[state.step]
    return step ? { ...state, step } : state
  }
  if (action.type === "back") {
    const step = PREVIOUS[state.step]
    return step ? { ...state, step } : state
  }
  if (action.type === "cancel" || action.type === "save") return state
  if (action.type === "setProviderID") return updateInput(state, { providerID: action.value.trim() }, "name")
  if (action.type === "setName") return updateInput(state, { name: action.value.trim() }, "protocol")
  if (action.type === "setProtocol") return updateInput(state, { protocol: action.value }, "baseURL")
  if (action.type === "setBaseURL") return updateInput(state, { baseURL: action.value.trim() }, "apiKey")
  if (action.type === "setApiKey") return updateInput(state, { apiKey: action.value.trim() || undefined }, "headers")
  if (action.type === "setHeaders") return updateInput(state, { headers: action.value }, "source")
  if (action.type === "retry") return { ...state, step: "source" }
  if (action.type === "discovered")
    return { ...state, step: "modelSelect", discovered: action.value, editingModel: undefined }
  if (action.type === "manual") {
    return {
      ...state,
      step: "modelSelect",
      editingModel: state.input.models.length,
      input: {
        ...state.input,
        models: [...state.input.models, { id: "", name: "" }],
      },
    }
  }
  if (action.type === "selectModel") return selectModel(state, action.value)
  if (action.type === "editModel") {
    if (!state.input.models[action.index]) return state
    return { ...state, step: "modelName", editingModel: action.index }
  }
  if (action.type === "setModelID") return updateModel(state, { id: action.value.trim() }, "modelName")
  if (action.type === "setModelName") return updateModel(state, { name: action.value.trim() }, "modelReasoning")
  if (action.type === "setModelReasoning") return updateModel(state, { reasoning: action.value }, "modelContext")
  if (action.type === "setModelContext") return updateModel(state, { context: action.value }, "modelOutput")
  if (action.type === "setModelOutput") return updateModel(state, { output: action.value }, "modelNext")
  if (action.type === "addAnother") return { ...state, step: "modelSelect", editingModel: undefined }
  if (action.type === "finish") return { ...state, step: "review", editingModel: undefined }
  return action satisfies never
}

function updateInput(state: WizardState, value: Partial<CustomProviderInput>, step: WizardStep): WizardState {
  return {
    ...state,
    step,
    input: {
      ...state.input,
      ...value,
    },
  }
}

function selectModel(state: WizardState, discovered: CustomProviderDiscoveredModel): WizardState {
  const index = state.input.models.findIndex((model) => model.id === discovered.id)
  if (index === -1) {
    return {
      ...state,
      step: "modelName",
      editingModel: state.input.models.length,
      input: {
        ...state.input,
        models: [
          ...state.input.models,
          {
            id: discovered.id,
            name: discovered.name ?? discovered.id,
            reasoning: discovered.reasoning,
            context: discovered.context,
            output: discovered.output,
          },
        ],
      },
    }
  }
  const current = state.input.models[index]!
  const models = [...state.input.models]
  models[index] = {
    id: current.id,
    name: current.name || discovered.name || discovered.id,
    reasoning: current.reasoning ?? discovered.reasoning,
    context: current.context ?? discovered.context,
    output: current.output ?? discovered.output,
  }
  return {
    ...state,
    step: "modelName",
    editingModel: index,
    input: { ...state.input, models },
  }
}

function updateModel(state: WizardState, value: Partial<CustomProviderModel>, step: WizardStep): WizardState {
  if (state.editingModel === undefined) return state
  if (!state.input.models[state.editingModel]) return state
  const models = [...state.input.models]
  models[state.editingModel] = {
    ...models[state.editingModel]!,
    ...value,
  }
  return {
    ...state,
    step,
    input: { ...state.input, models },
  }
}
