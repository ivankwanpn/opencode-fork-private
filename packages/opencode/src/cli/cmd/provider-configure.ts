import * as prompts from "@clack/prompts"
import { Config } from "@/config/config"
import { CliError } from "@/cli/effect-cmd"
import { discover } from "@/provider/custom-provider/discovery"
import { normalizeConfigureInput } from "@/provider/custom-provider/domain"
import { CustomProvider } from "@opencode-ai/schema/custom-provider"
import { Effect, Exit } from "effect"

export interface TextQuestion {
  readonly message: string
  readonly placeholder?: string
  readonly initialValue?: string
}

export interface SelectQuestion<A> {
  readonly message: string
  readonly options: ReadonlyArray<{
    readonly label: string
    readonly value: A
    readonly hint?: string
  }>
}

export interface WizardIO {
  readonly text: (input: TextQuestion) => Effect.Effect<string | "back" | "cancel">
  readonly password: (input: TextQuestion) => Effect.Effect<string | "back" | "cancel">
  readonly select: <A>(input: SelectQuestion<A>) => Effect.Effect<A | "back" | "cancel">
  readonly log: (message: string) => Effect.Effect<void>
}

const BACK = -1
const CANCEL = -2

function textResult(value: string | symbol): string | "back" | "cancel" {
  if (prompts.isCancel(value)) return "cancel"
  if (value === ":back") return "back"
  if (value === ":cancel") return "cancel"
  return value
}

export const liveWizardIO: WizardIO = {
  text: (input) =>
    Effect.promise(() =>
      prompts.text({
        message: `${input.message} (type :back to go back)`,
        placeholder: input.placeholder,
        initialValue: input.initialValue,
      }),
    ).pipe(Effect.map(textResult)),
  password: (input) =>
    Effect.promise(() =>
      prompts.password({
        message: `${input.message} (type :back to go back)`,
      }),
    ).pipe(Effect.map(textResult)),
  select: <A>(input: SelectQuestion<A>) =>
    Effect.promise(() =>
      prompts.select<number>({
        message: input.message,
        options: [
          ...input.options.map((option, index) => ({ ...option, value: index })),
          { label: "Back", value: BACK },
          { label: "Cancel", value: CANCEL },
        ],
      }),
    ).pipe(
      Effect.map((value) => {
        if (prompts.isCancel(value) || value === CANCEL) return "cancel" as const
        if (value === BACK) return "back" as const
        return input.options[value]!.value
      }),
    ),
  log: (message) => Effect.sync(() => prompts.log.info(message)),
}

type Step =
  | "id"
  | "name"
  | "baseURL"
  | "apiKey"
  | "headers"
  | "headerName"
  | "headerValue"
  | "modelSource"
  | "discover"
  | "discoveryFailure"
  | "discoveredModel"
  | "manualModel"
  | "modelName"
  | "modelReasoning"
  | "modelContext"
  | "modelOutput"
  | "modelNext"
  | "review"

interface WizardState {
  readonly step: Step
  readonly providerID: string
  readonly name: string
  readonly baseURL: string
  readonly apiKey: string
  readonly headers: CustomProvider.Header[]
  readonly models: CustomProvider.Model[]
  readonly discovered: readonly CustomProvider.DiscoveredModel[]
  readonly source?: "discover" | "manual"
  readonly header?: CustomProvider.Header
  readonly model?: CustomProvider.Model
}

function cliError(error: { readonly message: string }) {
  return new CliError({ message: error.message })
}

function optionalInteger(value: string) {
  const trimmed = value.trim()
  return trimmed ? Number(trimmed) : undefined
}

function saveModel(state: WizardState) {
  const model = state.model
  if (!model) return state
  return {
    ...state,
    models: [...state.models.filter((item) => item.id !== model.id), model],
  }
}

export function runProviderConfigureWizard(input: {
  readonly id?: string
  readonly io: WizardIO
  readonly discover: typeof discover
  readonly configure: (
    input: CustomProvider.ConfigureInput,
  ) => Effect.Effect<
    CustomProvider.ConfigureResult,
    CustomProvider.ConfigureError | CustomProvider.ValidationError | CustomProvider.ConflictError
  >
}): Effect.Effect<CustomProvider.ConfigureResult | undefined, CliError> {
  return Effect.gen(function* () {
    let state: WizardState = {
      step: input.id === undefined ? "id" : "name",
      providerID: input.id ?? "",
      name: "",
      baseURL: "",
      apiKey: "",
      headers: [],
      models: [],
      discovered: [],
    }
    const history: WizardState[] = []
    const advance = (next: WizardState, previous: WizardState = { ...next, step: state.step }) => {
      history.push(structuredClone(previous))
      state = next
    }
    const back = () => {
      const previous = history.pop()
      if (previous) state = previous
    }

    while (true) {
      if (state.step === "id") {
        const answer = yield* input.io.text({
          message: "Provider ID",
          placeholder: "custom-provider",
          initialValue: state.providerID,
        })
        if (answer === "cancel") return undefined
        if (answer === "back") {
          back()
          continue
        }
        advance({ ...state, providerID: answer, step: "name" })
        continue
      }

      if (state.step === "name") {
        const answer = yield* input.io.text({
          message: "Display name",
          placeholder: "Custom Provider",
          initialValue: state.name,
        })
        if (answer === "cancel") return undefined
        if (answer === "back") {
          back()
          continue
        }
        advance({ ...state, name: answer, step: "baseURL" })
        continue
      }

      if (state.step === "baseURL") {
        const answer = yield* input.io.text({
          message: "Base URL",
          placeholder: "https://api.example.com/v1",
          initialValue: state.baseURL,
        })
        if (answer === "cancel") return undefined
        if (answer === "back") {
          back()
          continue
        }
        advance({ ...state, baseURL: answer, step: "apiKey" })
        continue
      }

      if (state.step === "apiKey") {
        const answer = yield* input.io.password({
          message: "API key or {env:NAME} (optional)",
        })
        if (answer === "cancel") return undefined
        if (answer === "back") {
          back()
          continue
        }
        advance({ ...state, apiKey: answer, step: "headers" })
        continue
      }

      if (state.step === "headers") {
        const answer = yield* input.io.select({
          message: "Custom headers",
          options: [
            { label: "Add header", value: "add" as const },
            { label: "Finish", value: "finish" as const },
          ],
        })
        if (answer === "cancel") return undefined
        if (answer === "back") {
          back()
          continue
        }
        if (answer === "finish") {
          advance({ ...state, header: undefined, step: "modelSource" })
          continue
        }
        advance({ ...state, header: { name: "", value: "" }, step: "headerName" })
        continue
      }

      if (state.step === "headerName") {
        const answer = yield* input.io.text({
          message: "Header name",
          initialValue: state.header?.name,
        })
        if (answer === "cancel") return undefined
        if (answer === "back") {
          back()
          continue
        }
        advance({ ...state, header: { name: answer, value: state.header?.value ?? "" }, step: "headerValue" })
        continue
      }

      if (state.step === "headerValue") {
        const answer = yield* input.io.password({
          message: "Header value",
        })
        if (answer === "cancel") return undefined
        if (answer === "back") {
          back()
          continue
        }
        const header = { name: state.header?.name ?? "", value: answer }
        advance(
          { ...state, header, headers: [...state.headers, header], step: "headers" },
          { ...state, header, step: "headerValue" },
        )
        continue
      }

      if (state.step === "modelSource") {
        const answer = yield* input.io.select({
          message: "Models",
          options: [
            { label: "Discover models", value: "discover" as const },
            { label: "Manual entry", value: "manual" as const },
          ],
        })
        if (answer === "cancel") return undefined
        if (answer === "back") {
          back()
          continue
        }
        advance({
          ...state,
          source: answer,
          model: answer === "manual" ? { id: "", name: "" } : undefined,
          step: answer === "discover" ? "discover" : "manualModel",
        })
        continue
      }

      if (state.step === "discover") {
        const outcome = yield* input
          .discover({
            baseURL: state.baseURL,
            ...(state.apiKey.trim() ? { apiKey: state.apiKey } : {}),
            headers: state.headers,
          })
          .pipe(Effect.exit)
        if (Exit.isFailure(outcome)) {
          yield* input.io.log("Model discovery failed.")
          state = { ...state, step: "discoveryFailure" }
          continue
        }
        state = { ...state, discovered: outcome.value.models, step: "discoveredModel" }
        continue
      }

      if (state.step === "discoveryFailure") {
        const answer = yield* input.io.select({
          message: "Model discovery failed",
          options: [
            { label: "Retry", value: "retry" as const },
            { label: "Manual entry", value: "manual" as const },
          ],
        })
        if (answer === "cancel") return undefined
        if (answer === "back") {
          back()
          continue
        }
        if (answer === "retry") {
          state = { ...state, step: "discover" }
          continue
        }
        advance({ ...state, source: "manual", model: { id: "", name: "" }, step: "manualModel" })
        continue
      }

      if (state.step === "discoveredModel") {
        const available = state.discovered.filter(
          (candidate) => !state.models.some((model) => model.id === candidate.id),
        )
        const answer = yield* input.io.select({
          message: "Select a model",
          options: [
            ...available.map((model) => ({
              label: model.name ?? model.id,
              value: `model:${model.id}`,
            })),
            { label: "Finish", value: "finish" },
          ],
        })
        if (answer === "cancel") return undefined
        if (answer === "back") {
          back()
          continue
        }
        if (answer === "finish") {
          if (!state.models.length) {
            yield* input.io.log("Configure at least one model.")
            continue
          }
          advance({ ...state, step: "review" })
          continue
        }
        const selected = state.discovered.find((model) => `model:${model.id}` === answer)!
        advance({
          ...state,
          model: {
            id: selected.id,
            name: selected.name ?? selected.id,
            ...(selected.reasoning === undefined ? {} : { reasoning: selected.reasoning }),
            ...(selected.context === undefined ? {} : { context: selected.context }),
            ...(selected.output === undefined ? {} : { output: selected.output }),
          },
          step: "modelName",
        })
        continue
      }

      if (state.step === "manualModel") {
        const answer = yield* input.io.text({
          message: "Model ID",
          initialValue: state.model?.id,
        })
        if (answer === "cancel") return undefined
        if (answer === "back") {
          back()
          continue
        }
        advance({ ...state, model: { ...state.model, id: answer, name: state.model?.name ?? "" }, step: "modelName" })
        continue
      }

      if (state.step === "modelName") {
        const answer = yield* input.io.text({
          message: "Model display name",
          initialValue: state.model?.name,
        })
        if (answer === "cancel") return undefined
        if (answer === "back") {
          back()
          continue
        }
        advance({ ...state, model: { ...state.model!, name: answer }, step: "modelReasoning" })
        continue
      }

      if (state.step === "modelReasoning") {
        const answer = yield* input.io.select({
          message: "Supports reasoning",
          options: [
            { label: "Yes", value: true },
            { label: "No", value: false },
          ],
        })
        if (answer === "cancel") return undefined
        if (answer === "back") {
          back()
          continue
        }
        advance({ ...state, model: { ...state.model!, reasoning: answer }, step: "modelContext" })
        continue
      }

      if (state.step === "modelContext") {
        const answer = yield* input.io.text({
          message: "Context limit (optional)",
          initialValue: state.model?.context?.toString(),
        })
        if (answer === "cancel") return undefined
        if (answer === "back") {
          back()
          continue
        }
        advance({ ...state, model: { ...state.model!, context: optionalInteger(answer) }, step: "modelOutput" })
        continue
      }

      if (state.step === "modelOutput") {
        const answer = yield* input.io.text({
          message: "Maximum output tokens (optional)",
          initialValue: state.model?.output?.toString(),
        })
        if (answer === "cancel") return undefined
        if (answer === "back") {
          back()
          continue
        }
        advance({
          ...saveModel({ ...state, model: { ...state.model!, output: optionalInteger(answer) } }),
          step: "modelNext",
        })
        continue
      }

      if (state.step === "modelNext") {
        const answer = yield* input.io.select({
          message: "Models",
          options: [
            { label: "Add another", value: "add" as const },
            { label: "Finish", value: "finish" as const },
          ],
        })
        if (answer === "cancel") return undefined
        if (answer === "back") {
          back()
          continue
        }
        if (answer === "finish") {
          advance({ ...state, step: "review" })
          continue
        }
        advance({
          ...state,
          model: state.source === "manual" ? { id: "", name: "" } : undefined,
          step: state.source === "manual" ? "manualModel" : "discoveredModel",
        })
        continue
      }

      const answer = yield* input.io.select({
        message: "Review configuration",
        options: [{ label: "Save", value: "save" as const }],
      })
      if (answer === "cancel") return undefined
      if (answer === "back") {
        back()
        continue
      }
      const normalized = yield* normalizeConfigureInput({
        providerID: state.providerID,
        name: state.name,
        baseURL: state.baseURL,
        ...(state.apiKey.trim() ? { apiKey: state.apiKey } : {}),
        headers: state.headers,
        models: state.models,
      }).pipe(Effect.mapError(cliError))
      const result = yield* input.configure(normalized).pipe(Effect.mapError(cliError))
      yield* input.io.log(
        `Configured ${result.providerID} (${result.protocol}) with ${result.models.length} model${result.models.length === 1 ? "" : "s"} in ${Config.globalConfigFile()}`,
      )
      return result
    }
  })
}
