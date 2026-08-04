import type { CustomProvider } from "@opencode-ai/schema/custom-provider"
import { Button } from "@opencode-ai/ui/button"
import { Checkbox } from "@opencode-ai/ui/checkbox"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { List } from "@opencode-ai/ui/list"
import { ProviderIcon } from "@opencode-ai/ui/provider-icon"
import { TextField } from "@opencode-ai/ui/text-field"
import { useMutation } from "@tanstack/solid-query"
import { batch, For, Show } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { Link } from "@/components/link"
import { useLanguage } from "@/context/language"
import { useServerSDK } from "@/context/server-sdk"
import { useServerSync } from "@/context/server-sync"
import { showToast } from "@/utils/toast"
import {
  canDiscoverModels,
  customProviderFormState,
  type FormState,
  headerRow,
  mergeDiscoveredModels,
  modelRow,
  reconcileDiscoveredSelection,
  setModelReasoning,
  validateCustomProvider,
} from "./dialog-custom-provider-form"

type Props = {
  onBack: () => void
  providerID?: string
}

export function DialogCustomProvider(props: Props) {
  const language = useLanguage()

  return (
    <Dialog
      class="h-full"
      title={
        <IconButton
          tabIndex={-1}
          icon="arrow-left"
          variant="ghost"
          onClick={props.onBack}
          aria-label={language.t("common.goBack")}
        />
      }
      transition
    >
      <CustomProviderForm providerID={props.providerID} />
    </Dialog>
  )
}

export function CustomProviderForm(props: { autofocus?: boolean; providerID?: string } = {}) {
  const dialog = useDialog()
  const serverSync = useServerSync()
  const serverSDK = useServerSDK()
  const language = useLanguage()
  const configured = () => (props.providerID ? serverSync().data.config.provider?.[props.providerID] : undefined)
  const [form, setForm] = createStore<FormState>(customProviderFormState(props.providerID, configured()))
  const [discovery, setDiscovery] = createStore<{
    models: CustomProvider.DiscoveredModel[]
    selected: string[]
    attempted: boolean
    error?: string
    saveError?: string
  }>({
    models: [],
    selected: [],
    attempted: false,
  })

  const addModel = () => {
    setForm(
      "models",
      produce((rows) => {
        rows.push(modelRow())
      }),
    )
  }

  const removeModel = (index: number) => {
    setForm(
      "models",
      produce((rows) => {
        rows.splice(index, 1)
        if (!rows.length) rows.push(modelRow())
      }),
    )
  }

  const addHeader = () => {
    setForm(
      "headers",
      produce((rows) => {
        rows.push(headerRow())
      }),
    )
  }

  const removeHeader = (index: number) => {
    if (form.headers.length <= 1) return
    setForm(
      "headers",
      produce((rows) => {
        rows.splice(index, 1)
      }),
    )
  }

  const setField = (key: "providerID" | "name" | "baseURL" | "apiKey", value: string) => {
    setForm(key, value)
    if (key === "apiKey") return
    setForm("err", key, undefined)
  }

  const setModel = (index: number, key: "id" | "name" | "context" | "output", value: string) => {
    batch(() => {
      setForm("models", index, key, value)
      setForm("models", index, "err", key, undefined)
    })
  }

  const setHeader = (index: number, key: "key" | "value", value: string) => {
    batch(() => {
      setForm("headers", index, key, value)
      setForm("headers", index, "err", key, undefined)
    })
  }

  const headers = () =>
    form.headers.flatMap((header) => {
      const name = header.key.trim()
      const value = header.value.trim()
      return name && value ? [{ name, value }] : []
    })

  const location = () => {
    const directory = serverSync().data.path.directory
    return directory ? { directory } : undefined
  }

  const available = async () => {
    const target = serverSDK()
    if ((await target.protocolForGeneration()) === "v2") return target.apiForGeneration()
    setDiscovery("saveError", language.t("provider.custom.unavailable"))
  }

  const discoverMutation = useMutation(() => ({
    mutationFn: async () => {
      const api = await available()
      if (!api) return
      return api.providers.discoverCustom({
        baseURL: form.baseURL.trim(),
        apiKey: form.apiKey.trim() || undefined,
        headers: headers(),
        location: location(),
      })
    },
    onSuccess: (result) => {
      if (!result) return
      const models = result.data.models
      batch(() => {
        setDiscovery("attempted", true)
        setDiscovery("error", undefined)
        setDiscovery("models", models)
        setDiscovery("selected", reconcileDiscoveredSelection(discovery.selected, models))
      })
    },
    onError: (error) => {
      batch(() => {
        setDiscovery("attempted", true)
        setDiscovery("error", safeError(error, language.t("provider.custom.discovery.failure")))
      })
    },
  }))

  const discover = () => {
    if (!canDiscoverModels(form.baseURL) || discoverMutation.isPending) return
    batch(() => {
      setDiscovery("error", undefined)
      setDiscovery("saveError", undefined)
    })
    discoverMutation.mutate()
  }

  const selected = (id: string) => discovery.selected.includes(id)
  const select = (id: string, checked: boolean) => {
    setDiscovery(
      "selected",
      produce((ids) => {
        const index = ids.indexOf(id)
        if (checked && index === -1) ids.push(id)
        if (!checked && index !== -1) ids.splice(index, 1)
      }),
    )
  }
  const addSelected = () => {
    setForm("models", mergeDiscoveredModels(form.models, discovery.models, new Set(discovery.selected)))
  }

  const validate = () => {
    const output = validateCustomProvider({
      form,
      t: language.t,
      disabledProviders: serverSync().data.config.disabled_providers ?? [],
      existingProviderIDs: new Set(serverSync().data.provider.all.keys()),
      editingProviderID: props.providerID,
    })
    batch(() => {
      setForm("err", output.err)
      output.models.forEach((err, index) => setForm("models", index, "err", err))
      output.headers.forEach((err, index) => setForm("headers", index, "err", err))
    })
    return output.result
  }

  const saveMutation = useMutation(() => ({
    mutationFn: async (result: CustomProvider.ConfigureInput) => {
      const api = await available()
      if (!api) return
      const configured = await api.providers.configureCustom({
        ...result,
        location: location(),
      })
      await serverSync().refreshProviders()
      return configured.data
    },
    onSuccess: (result) => {
      if (!result) return
      dialog.close()
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("provider.connect.toast.connected.title", { provider: result.name }),
        description: language.t("provider.connect.toast.connected.description", { provider: result.name }),
      })
    },
    onError: (error) => {
      setDiscovery("saveError", safeError(error, language.t("common.requestFailed")))
    },
  }))

  const save = (event: SubmitEvent) => {
    event.preventDefault()
    if (saveMutation.isPending) return
    setDiscovery("saveError", undefined)
    const result = validate()
    if (!result) return
    saveMutation.mutate(result)
  }

  return (
    <div class="flex flex-col gap-6 px-2.5 pb-3 overflow-y-auto max-h-[60vh]">
      <div class="px-2.5 flex gap-4 items-center">
        <ProviderIcon id={props.providerID ?? "synthetic"} class="size-5 shrink-0 icon-strong-base" />
        <div class="text-16-medium text-text-strong">{language.t("provider.custom.title")}</div>
      </div>

      <form onSubmit={save} class="px-2.5 pb-6 flex flex-col gap-6">
        <p class="text-14-regular text-text-base">
          {language.t("provider.custom.description.prefix")}
          <Link href="https://opencode.ai/docs/providers/#custom-provider" tabIndex={-1}>
            {language.t("provider.custom.description.link")}
          </Link>
          {language.t("provider.custom.description.suffix")}
        </p>

        <div class="flex flex-col gap-4">
          <TextField
            autofocus={props.autofocus ?? true}
            label={language.t("provider.custom.field.providerID.label")}
            placeholder={language.t("provider.custom.field.providerID.placeholder")}
            description={language.t("provider.custom.field.providerID.description")}
            value={form.providerID}
            onChange={(value) => setField("providerID", value)}
            disabled={props.providerID !== undefined}
            validationState={form.err.providerID ? "invalid" : undefined}
            error={form.err.providerID}
          />
          <TextField
            label={language.t("provider.custom.field.name.label")}
            placeholder={language.t("provider.custom.field.name.placeholder")}
            value={form.name}
            onChange={(value) => setField("name", value)}
            validationState={form.err.name ? "invalid" : undefined}
            error={form.err.name}
          />
          <TextField
            label={language.t("provider.custom.field.baseURL.label")}
            placeholder={language.t("provider.custom.field.baseURL.placeholder")}
            value={form.baseURL}
            onChange={(value) => setField("baseURL", value)}
            validationState={form.err.baseURL ? "invalid" : undefined}
            error={form.err.baseURL}
          />
          <TextField
            label={language.t("provider.custom.field.apiKey.label")}
            placeholder={language.t("provider.custom.field.apiKey.placeholder")}
            description={language.t(
              props.providerID
                ? "provider.custom.field.apiKey.editDescription"
                : "provider.custom.field.apiKey.description",
            )}
            value={form.apiKey}
            onChange={(value) => setField("apiKey", value)}
          />
        </div>

        <div class="flex flex-col gap-3">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <label class="text-12-medium text-text-weak">{language.t("provider.custom.discovery.title")}</label>
            <Button
              type="button"
              size="small"
              variant="secondary"
              onClick={discover}
              disabled={!canDiscoverModels(form.baseURL) || discoverMutation.isPending}
            >
              {discoverMutation.isPending
                ? language.t("provider.custom.discovery.discovering")
                : language.t("provider.custom.discovery.discover")}
            </Button>
          </div>

          <Show when={discovery.error}>
            <div class="flex flex-col items-start gap-2 rounded-md border border-border-weak-base p-3">
              <div class="text-13-regular text-icon-critical-base">{discovery.error}</div>
              <div class="text-12-regular text-text-weak">{language.t("provider.custom.discovery.manualFallback")}</div>
              <Button type="button" size="small" variant="ghost" onClick={discover}>
                {language.t("provider.custom.discovery.retry")}
              </Button>
            </div>
          </Show>

          <Show when={discovery.models.length > 0}>
            <List
              class="px-1 max-h-52"
              search={{ placeholder: language.t("provider.custom.discovery.search"), autofocus: false }}
              items={discovery.models}
              key={(model) => model.id}
              filterKeys={["id", "name"]}
              emptyMessage={language.t("provider.custom.discovery.empty")}
              onSelect={(model) => model && select(model.id, !selected(model.id))}
            >
              {(model) => (
                <div class="w-full flex items-center gap-2">
                  <div onClick={(event) => event.stopPropagation()}>
                    <Checkbox checked={selected(model.id)} onChange={(checked) => select(model.id, checked)}>
                      <span class="sr-only">{model.name ?? model.id}</span>
                    </Checkbox>
                  </div>
                  <span class="min-w-0 truncate">{model.name ?? model.id}</span>
                  <span class="ml-auto min-w-0 truncate text-12-regular text-text-weak">{model.id}</span>
                </div>
              )}
            </List>
            <Button
              type="button"
              size="small"
              variant="secondary"
              onClick={addSelected}
              disabled={!discovery.selected.length}
              class="self-start"
            >
              {language.t("provider.custom.discovery.addSelected")}
            </Button>
          </Show>
          <Show when={discovery.attempted && !discovery.error && discovery.models.length === 0}>
            <div class="text-13-regular text-text-weak">{language.t("provider.custom.discovery.empty")}</div>
            <div class="text-12-regular text-text-weak">{language.t("provider.custom.discovery.manualFallback")}</div>
          </Show>
        </div>

        <div class="flex flex-col gap-3">
          <label class="text-12-medium text-text-weak">{language.t("provider.custom.models.label")}</label>
          <For each={form.models}>
            {(model, index) => (
              <div
                class="grid grid-cols-1 sm:grid-cols-2 gap-2 rounded-md border border-border-weak-base p-3"
                data-row={model.row}
              >
                <TextField
                  label={language.t("provider.custom.models.id.label")}
                  placeholder={language.t("provider.custom.models.id.placeholder")}
                  value={model.id}
                  onChange={(value) => setModel(index(), "id", value)}
                  validationState={model.err.id ? "invalid" : undefined}
                  error={model.err.id}
                />
                <TextField
                  label={language.t("provider.custom.models.name.label")}
                  placeholder={language.t("provider.custom.models.name.placeholder")}
                  value={model.name}
                  onChange={(value) => setModel(index(), "name", value)}
                  validationState={model.err.name ? "invalid" : undefined}
                  error={model.err.name}
                />
                <TextField
                  type="number"
                  label={language.t("provider.custom.models.context.label")}
                  placeholder={language.t("provider.custom.models.context.placeholder")}
                  value={model.context}
                  onChange={(value) => setModel(index(), "context", value)}
                  validationState={model.err.context ? "invalid" : undefined}
                  error={model.err.context}
                />
                <TextField
                  type="number"
                  label={language.t("provider.custom.models.output.label")}
                  placeholder={language.t("provider.custom.models.output.placeholder")}
                  value={model.output}
                  onChange={(value) => setModel(index(), "output", value)}
                  validationState={model.err.output ? "invalid" : undefined}
                  error={model.err.output}
                />
                <div class="sm:col-span-2 flex items-center justify-between gap-3">
                  <div class="flex items-center gap-2">
                    <Checkbox
                      aria-label={language.t("provider.custom.models.reasoning")}
                      checked={model.reasoning}
                      onChange={(checked) => setForm("models", setModelReasoning(form.models, index(), checked))}
                    />
                    <button
                      type="button"
                      class="text-12-regular text-text-base hover:text-text-strong"
                      aria-pressed={model.reasoning}
                      onClick={() => setForm("models", setModelReasoning(form.models, index(), !model.reasoning))}
                    >
                      {language.t("provider.custom.models.reasoning")}
                    </button>
                  </div>
                  <IconButton
                    type="button"
                    icon="trash"
                    variant="ghost"
                    onClick={() => removeModel(index())}
                    aria-label={language.t("provider.custom.models.remove")}
                  />
                </div>
              </div>
            )}
          </For>
          <div class="text-12-regular text-text-weak">{language.t("provider.custom.discovery.manualFallback")}</div>
          <Button type="button" size="small" variant="ghost" icon="plus-small" onClick={addModel} class="self-start">
            {language.t("provider.custom.models.add")}
          </Button>
        </div>

        <div class="flex flex-col gap-3">
          <label class="text-12-medium text-text-weak">{language.t("provider.custom.headers.label")}</label>
          <For each={form.headers}>
            {(header, index) => (
              <div class="flex flex-col sm:flex-row gap-2 items-start" data-row={header.row}>
                <div class="flex-1 w-full">
                  <TextField
                    label={language.t("provider.custom.headers.key.label")}
                    hideLabel
                    placeholder={language.t("provider.custom.headers.key.placeholder")}
                    value={header.key}
                    onChange={(value) => setHeader(index(), "key", value)}
                    validationState={header.err.key ? "invalid" : undefined}
                    error={header.err.key}
                  />
                </div>
                <div class="flex-1 w-full">
                  <TextField
                    label={language.t("provider.custom.headers.value.label")}
                    hideLabel
                    placeholder={language.t("provider.custom.headers.value.placeholder")}
                    value={header.value}
                    onChange={(value) => setHeader(index(), "value", value)}
                    validationState={header.err.value ? "invalid" : undefined}
                    error={header.err.value}
                  />
                </div>
                <IconButton
                  type="button"
                  icon="trash"
                  variant="ghost"
                  class="mt-1.5"
                  onClick={() => removeHeader(index())}
                  disabled={form.headers.length <= 1}
                  aria-label={language.t("provider.custom.headers.remove")}
                />
              </div>
            )}
          </For>
          <Button type="button" size="small" variant="ghost" icon="plus-small" onClick={addHeader} class="self-start">
            {language.t("provider.custom.headers.add")}
          </Button>
        </div>

        <Show when={discovery.saveError}>
          <div class="text-13-regular text-icon-critical-base">{discovery.saveError}</div>
        </Show>
        <Button
          class="w-auto self-start"
          type="submit"
          size="large"
          variant="primary"
          disabled={saveMutation.isPending}
        >
          {saveMutation.isPending ? language.t("common.saving") : language.t("common.submit")}
        </Button>
      </form>
    </div>
  )
}

function safeError(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) return error.message
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string" &&
    error.message.trim()
  ) {
    return error.message
  }
  return fallback
}
