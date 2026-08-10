import type { CustomProvider } from "@opencode-ai/schema/custom-provider"

const PROVIDER_ID = /^[a-z0-9][a-z0-9-_]*$/
const HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/

type Translator = (key: string, vars?: Record<string, string | number | boolean>) => string

export type ModelErr = {
  id?: string
  name?: string
  context?: string
  output?: string
}

export type HeaderErr = {
  key?: string
  value?: string
}

export type ModelRow = {
  row: string
  id: string
  name: string
  reasoning: boolean
  context: string
  output: string
  err: ModelErr
}

export type HeaderRow = {
  row: string
  key: string
  value: string
  err: HeaderErr
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

type ValidateArgs = {
  form: FormState
  t: Translator
  disabledProviders: string[]
  existingProviderIDs: Set<string>
  editingProviderID?: string
}

export function validateCustomProvider(input: ValidateArgs): {
  err: FormState["err"]
  models: ModelErr[]
  headers: HeaderErr[]
  result?: CustomProvider.ConfigureInput
} {
  const providerID = input.form.providerID.trim()
  const name = input.form.name.trim()
  const baseURL = input.form.baseURL.trim()
  const apiKey = input.form.apiKey.trim()

  const idError = !providerID
    ? input.t("provider.custom.error.providerID.required")
    : !PROVIDER_ID.test(providerID)
      ? input.t("provider.custom.error.providerID.format")
      : undefined
  const nameError = !name ? input.t("provider.custom.error.name.required") : undefined
  const urlError = validBaseURL(baseURL)
    ? undefined
    : !baseURL
      ? input.t("provider.custom.error.baseURL.required")
      : input.t("provider.custom.error.baseURL.format")

  const disabled = input.disabledProviders.includes(providerID)
  const existsError = idError
    ? undefined
    : input.existingProviderIDs.has(providerID) && !disabled && providerID !== input.editingProviderID
      ? input.t("provider.custom.error.providerID.exists")
      : undefined

  const seenModels = new Set<string>()
  const modelValues: CustomProvider.Model[] = []
  const models = input.form.models.map((model) => {
    const id = model.id.trim()
    const modelName = model.name.trim()
    const idError = !id
      ? input.t("provider.custom.error.required")
      : seenModels.has(id)
        ? input.t("provider.custom.error.duplicate")
        : undefined
    if (id && !seenModels.has(id)) seenModels.add(id)

    const nameError = !modelName ? input.t("provider.custom.error.required") : undefined
    const context = positiveInteger(model.context)
    const output = positiveInteger(model.output)
    const contextBlank = !model.context.trim()
    const outputBlank = !model.output.trim()
    const contextError = !contextBlank && context === undefined ? input.t("provider.custom.error.limit") : undefined
    const outputError = !outputBlank && output === undefined ? input.t("provider.custom.error.limit") : undefined
    const pairError = input.t("provider.custom.error.limitPair")
    const pairedContextError = contextBlank && !outputBlank ? pairError : contextError
    const pairedOutputError = outputBlank && !contextBlank ? pairError : outputError
    const rangeOutputError =
      context !== undefined && output !== undefined && output > context
        ? input.t("provider.custom.error.outputExceedsContext")
        : pairedOutputError
    if (!idError && !nameError && !pairedContextError && !rangeOutputError) {
      modelValues.push({
        id,
        name: modelName,
        reasoning: model.reasoning,
        ...(context === undefined || output === undefined ? {} : { context, output }),
      })
    }
    return {
      id: idError,
      name: nameError,
      context: pairedContextError,
      output: rangeOutputError,
    }
  })

  const seenHeaders = new Set<string>()
  const headerValues: CustomProvider.Header[] = []
  const headers = input.form.headers.map((header) => {
    const key = header.key.trim()
    const value = header.value.trim()
    if (!key && !value) return {}

    const normalized = key.toLowerCase()
    const keyError = !key
      ? input.t("provider.custom.error.required")
      : !HEADER_NAME.test(key)
        ? input.t("provider.custom.error.header.format")
        : seenHeaders.has(normalized)
          ? input.t("provider.custom.error.duplicate")
          : undefined
    if (key && !seenHeaders.has(normalized)) seenHeaders.add(normalized)
    const valueError = !value ? input.t("provider.custom.error.required") : undefined
    if (!keyError && !valueError) headerValues.push({ name: key, value })
    return { key: keyError, value: valueError }
  })

  const err = {
    providerID: idError ?? existsError,
    name: nameError,
    baseURL: urlError,
  }
  const modelsValid = models.every((model) => !model.id && !model.name && !model.context && !model.output)
  const headersValid = headers.every((header) => !header.key && !header.value)
  if (Object.values(err).some(Boolean) || !modelsValid || !headersValid) return { err, models, headers }

  return {
    err,
    models,
    headers,
    result: {
      providerID,
      name,
      ...(input.editingProviderID === providerID ? { update: true } : {}),
      baseURL,
      ...(apiKey ? { apiKey } : {}),
      headers: headerValues,
      models: modelValues,
    },
  }
}

export function canDiscoverModels(baseURL: string) {
  return validBaseURL(baseURL.trim())
}

export function mergeDiscoveredModels(
  current: readonly ModelRow[],
  discovered: readonly CustomProvider.DiscoveredModel[],
  selected: ReadonlySet<string>,
): ModelRow[] {
  const ids = new Set<string>()
  const existing = current.filter((model) => {
    const id = model.id.trim()
    if (!id || !ids.has(id)) {
      if (id) ids.add(id)
      return true
    }
    return false
  })
  const additions = discovered.flatMap((model) => {
    const id = model.id.trim()
    if (!selected.has(model.id) || !id || ids.has(id)) return []
    ids.add(id)
    return [
      modelRow({
        id,
        name: model.name?.trim() || id,
        reasoning: model.reasoning ?? false,
        context: model.context?.toString() ?? "",
        output: model.output?.toString() ?? "",
      }),
    ]
  })
  return [...existing, ...additions]
}

export function reconcileDiscoveredSelection(
  selected: readonly string[],
  discovered: readonly CustomProvider.DiscoveredModel[],
) {
  const available = new Set(discovered.map((model) => model.id))
  return selected.filter((id) => available.has(id))
}

export function setModelReasoning(models: readonly ModelRow[], index: number, reasoning: boolean): ModelRow[] {
  return models.map((model, current) => (current === index ? { ...model, reasoning } : model))
}

function validBaseURL(value: string) {
  if (!URL.canParse(value)) return false
  const parsed = new URL(value)
  return ["http:", "https:"].includes(parsed.protocol) && !parsed.username && !parsed.password
}

function positiveInteger(value: string) {
  const trimmed = value.trim()
  if (!trimmed || !/^\d+$/.test(trimmed)) return undefined
  const number = Number(trimmed)
  return Number.isSafeInteger(number) && number > 0 ? number : undefined
}

let row = 0

const nextRow = () => `row-${row++}`

export const modelRow = (input: Partial<Omit<ModelRow, "row" | "err">> = {}): ModelRow => ({
  row: nextRow(),
  id: input.id ?? "",
  name: input.name ?? "",
  reasoning: input.reasoning ?? false,
  context: input.context ?? "",
  output: input.output ?? "",
  err: {},
})
export const headerRow = (input: Partial<Pick<HeaderRow, "key" | "value">> = {}): HeaderRow => ({
  row: nextRow(),
  key: input.key ?? "",
  value: input.value ?? "",
  err: {},
})

export function customProviderFormState(
  providerID?: string,
  provider?: {
    name?: string
    options?: {
      baseURL?: unknown
      headers?: unknown
    }
    models?: Record<
      string,
      {
        name?: string
        reasoning?: boolean
        limit?: { context?: number; output?: number }
      }
    >
  },
): FormState {
  const models = Object.entries(provider?.models ?? {}).map(([id, model]) =>
    modelRow({
      id,
      name: model.name ?? id,
      reasoning: model.reasoning ?? false,
      context: model.limit?.context?.toString() ?? "",
      output: model.limit?.output?.toString() ?? "",
    }),
  )
  const headers =
    provider?.options?.headers && typeof provider.options.headers === "object" && !Array.isArray(provider.options.headers)
      ? Object.entries(provider.options.headers).flatMap(([key, value]) =>
          typeof value === "string" ? [headerRow({ key, value })] : [],
        )
      : []
  return {
    providerID: providerID ?? "",
    name: provider?.name ?? "",
    baseURL: typeof provider?.options?.baseURL === "string" ? provider.options.baseURL : "",
    apiKey: "",
    models: models.length ? models : [modelRow()],
    headers: headers.length ? headers : [headerRow()],
    err: {},
  }
}
