import { createSignal, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useSDK } from "../context/sdk"
import { useSync } from "../context/sync"
import { useBindings } from "../keymap"
import { DialogPrompt } from "../ui/dialog-prompt"
import { DialogSelect } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"
import { useToast } from "../ui/toast"
import { useTheme } from "../context/theme"
import { DialogModel } from "./dialog-model"
import {
  initialWizardState,
  transition,
  type CustomProviderDiscoveredModel,
  type CustomProviderHeader,
  type CustomProviderProtocol,
  type WizardAction,
} from "./custom-provider-wizard"

export function DialogCustomProvider() {
  const sdk = useSDK()
  const sync = useSync()
  const dialog = useDialog()
  const toast = useToast()
  const { theme } = useTheme()
  const [state, setState] = createStore(initialWizardState())
  const [busy, setBusy] = createSignal(false)
  const [discoveryError, setDiscoveryError] = createSignal<string>()

  function dispatch(action: WizardAction) {
    setState(transition(state, action))
  }

  useBindings(() => ({
    priority: 2,
    enabled: state.step !== "providerID",
    bindings: [
      {
        key: "escape",
        desc: "Back",
        group: "Dialog",
        cmd: () => dispatch({ type: "back" }),
      },
    ],
  }))

  const hints = () => (
    <Show when={state.step !== "providerID"}>
      <text fg={theme.textMuted}>esc back · ctrl+c cancel</text>
    </Show>
  )

  const description = (text: string) => () => (
    <box gap={1}>
      <text fg={theme.textMuted}>{text}</text>
      {hints()}
    </box>
  )

  const footerHints = () =>
    state.step === "providerID"
      ? []
      : [
          { title: "esc", label: "back" },
          { title: "ctrl+c", label: "cancel" },
        ]

  async function discover() {
    setBusy(true)
    setDiscoveryError(undefined)
    await sdk.native.providers
      .discoverCustom({
        protocol: state.input.protocol,
        baseURL: state.input.baseURL,
        apiKey: state.input.apiKey,
        headers: state.input.headers,
        location: sdk.directory ? { directory: sdk.directory } : undefined,
      })
      .then((result) => dispatch({ type: "discovered", value: result.data.models }))
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error)
        setDiscoveryError(message)
        toast.show({ variant: "error", message })
      })
      .finally(() => setBusy(false))
  }

  async function save() {
    setBusy(true)
    await sdk.native.providers
      .configureCustom({
        ...state.input,
        location: sdk.directory ? { directory: sdk.directory } : undefined,
      })
      .then(async (result) => {
        await sync.bootstrap()
        dialog.replace(() => <DialogModel providerID={result.data.providerID} />)
      })
      .catch((error) => {
        toast.show({
          variant: "error",
          message: error instanceof Error ? error.message : String(error),
        })
      })
      .finally(() => setBusy(false))
  }

  function content() {
    if (state.step === "providerID")
      return (
        <DialogPrompt
          title="Custom provider ID"
          placeholder="parity-provider"
          value={state.input.providerID}
          onConfirm={(value) => value.trim() && dispatch({ type: "setProviderID", value })}
        />
      )
    if (state.step === "name")
      return (
        <DialogPrompt
          title="Provider name"
          placeholder="Parity Provider"
          value={state.input.name}
          description={description("The display name shown in provider and model lists.")}
          onConfirm={(value) => value.trim() && dispatch({ type: "setName", value })}
        />
      )
    if (state.step === "protocol")
      return (
        <DialogSelect<CustomProviderProtocol>
          title="Provider protocol"
          renderFilter={false}
          footerHints={footerHints()}
          options={[
            { title: "OpenAI Responses", value: "openai-responses" },
            { title: "OpenAI compatible", value: "openai-compatible" },
            { title: "Anthropic Messages", value: "anthropic-messages" },
          ]}
          onSelect={(option) => dispatch({ type: "setProtocol", value: option.value })}
        />
      )
    if (state.step === "baseURL")
      return (
        <DialogPrompt
          title="Base URL"
          placeholder="https://api.example.com/v1"
          value={state.input.baseURL}
          description={description("The API root for this provider.")}
          onConfirm={(value) => value.trim() && dispatch({ type: "setBaseURL", value })}
        />
      )
    if (state.step === "apiKey")
      return (
        <DialogPrompt
          title="API key"
          placeholder="Optional"
          value={state.input.apiKey}
          description={description("Leave blank when the endpoint does not require a key.")}
          onConfirm={(value) => dispatch({ type: "setApiKey", value })}
        />
      )
    if (state.step === "headers")
      return (
        <DialogPrompt
          title="Custom headers"
          placeholder={"x-tenant: acme\nOne header per line"}
          value={state.input.headers.map((header) => `${header.name}: ${header.value}`).join("\n")}
          description={description("Optional headers, one name: value pair per line.")}
          onConfirm={(value) => {
            const headers = parseHeaders(value)
            if (!headers) {
              toast.show({ variant: "error", message: "Each header must use name: value format." })
              return
            }
            dispatch({ type: "setHeaders", value: headers })
          }}
        />
      )
    if (state.step === "source")
      return (
        <DialogSelect<"discover" | "retry" | "manual">
          title="Add models"
          renderFilter={false}
          locked={busy()}
          footerHints={footerHints()}
          options={[
            ...(discoveryError()
              ? [{ title: "Retry discovery", description: discoveryError(), value: "retry" as const }]
              : [{ title: "Discover models", description: "Query the provider catalog", value: "discover" as const }]),
            { title: "Manual entry", description: "Enter a model ID yourself", value: "manual" as const },
          ]}
          onSelect={(option) => {
            if (option.value === "manual") return dispatch({ type: "manual" })
            dispatch({ type: "retry" })
            void discover()
          }}
        />
      )
    if (state.step === "modelSelect" && state.editingModel !== undefined && !state.input.models[state.editingModel]?.id)
      return (
        <DialogPrompt
          title="Model ID"
          placeholder="claude-sonnet"
          description={description("Enter the model identifier accepted by the provider.")}
          onConfirm={(value) => value.trim() && dispatch({ type: "setModelID", value })}
        />
      )
    if (state.step === "modelSelect")
      return (
        <DialogSelect<CustomProviderDiscoveredModel | "manual">
          title="Select a model"
          footerHints={footerHints()}
          options={[
            ...state.discovered.map((model) => ({
              title: model.name ?? model.id,
              description: model.id,
              value: model,
            })),
            { title: "Manual entry", description: "Enter a model ID yourself", value: "manual" as const },
          ]}
          onSelect={(option) =>
            option.value === "manual"
              ? dispatch({ type: "manual" })
              : dispatch({ type: "selectModel", value: option.value })
          }
        />
      )
    const model = state.editingModel === undefined ? undefined : state.input.models[state.editingModel]
    if (state.step === "modelName")
      return (
        <DialogPrompt
          title="Model name"
          placeholder={model?.id}
          value={model?.name}
          description={description(`Display name for ${model?.id ?? "this model"}.`)}
          onConfirm={(value) => value.trim() && dispatch({ type: "setModelName", value })}
        />
      )
    if (state.step === "modelReasoning")
      return (
        <DialogSelect<boolean>
          title="Reasoning model"
          renderFilter={false}
          footerHints={footerHints()}
          options={[
            { title: "Yes", value: true },
            { title: "No", value: false },
          ]}
          onSelect={(option) => dispatch({ type: "setModelReasoning", value: option.value })}
        />
      )
    if (state.step === "modelContext")
      return (
        <DialogPrompt
          title="Context limit"
          placeholder="Optional token count"
          value={model?.context?.toString()}
          description={description("Maximum context tokens; leave blank when unknown.")}
          onConfirm={(value) => dispatch({ type: "setModelContext", value: positiveInteger(value) })}
        />
      )
    if (state.step === "modelOutput")
      return (
        <DialogPrompt
          title="Output limit"
          placeholder="Optional token count"
          value={model?.output?.toString()}
          description={description("Maximum output tokens; leave blank when unknown.")}
          onConfirm={(value) => dispatch({ type: "setModelOutput", value: positiveInteger(value) })}
        />
      )
    if (state.step === "modelNext")
      return (
        <DialogSelect<"add" | "finish">
          title="Models"
          renderFilter={false}
          footerHints={footerHints()}
          options={[
            { title: "Add another", value: "add" },
            { title: "Finish", value: "finish" },
          ]}
          onSelect={(option) => dispatch({ type: option.value === "add" ? "addAnother" : "finish" })}
        />
      )
    return (
      <DialogSelect<"save" | "cancel" | number>
        title="Review custom provider"
        renderFilter={false}
        locked={busy()}
        footerHints={footerHints()}
        options={[
          {
            title: "Save provider",
            description: `${state.input.protocol} · ${state.input.models.length} model${state.input.models.length === 1 ? "" : "s"}`,
            value: "save",
          },
          ...state.input.models.map((item, index) => ({
            title: item.name,
            description: `Edit ${item.id}`,
            value: index,
          })),
          { title: "Cancel", value: "cancel" },
        ]}
        onSelect={(option) => {
          if (option.value === "cancel") return dialog.clear()
          if (option.value === "save") return void save()
          dispatch({ type: "editModel", index: option.value })
        }}
      />
    )
  }

  return content()
}

function parseHeaders(value: string): readonly CustomProviderHeader[] | undefined {
  const lines = value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
  const headers = lines.map((line) => {
    const separator = line.indexOf(":")
    if (separator < 1) return
    const name = line.slice(0, separator).trim()
    const value = line.slice(separator + 1).trim()
    if (!name || !value) return
    return { name, value }
  })
  if (headers.some((header) => !header)) return
  return headers as CustomProviderHeader[]
}

function positiveInteger(value: string) {
  if (!value.trim()) return
  const number = Number(value)
  if (!Number.isInteger(number) || number <= 0) return
  return number
}
