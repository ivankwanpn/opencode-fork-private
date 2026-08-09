import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { List } from "@opencode-ai/ui/list"
import { ProviderIcon } from "@opencode-ai/ui/provider-icon"
import { Switch } from "@opencode-ai/ui/switch"
import { batch, createMemo, Show, type Component } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { useModels } from "@/context/models"
import { useServerSDK } from "@/context/server-sdk"
import { useServerSync } from "@/context/server-sync"
import { formatServerError } from "@/utils/server-errors"
import { DialogEditModelContext } from "./dialog-edit-model-context"

type ModelRow = ReturnType<ReturnType<typeof useModels>["list"]>[number]

export function oauthModelRows<T extends { provider: { id: string } }>(input: {
  providerID: string
  models: readonly T[]
}) {
  return input.models.filter((model) => model.provider.id === input.providerID)
}

export const DialogOAuthProvider: Component<{
  providerID: string
  providerName: string
  onBack: () => void
}> = (props) => {
  const dialog = useDialog()
  const language = useLanguage()
  const models = useModels()
  const serverSDK = useServerSDK()
  const serverSync = useServerSync()
  const [discovery, setDiscovery] = createStore<{
    attempted: boolean
    loading: boolean
    source?: string
    count?: number
    error?: string
  }>({ attempted: false, loading: false })
  let requestSequence = 0

  const rows = createMemo<ModelRow[]>(() => oauthModelRows({ providerID: props.providerID, models: models.list() }))

  const discover = async () => {
    const sequence = ++requestSequence
    batch(() => {
      setDiscovery("loading", true)
      setDiscovery("error", undefined)
    })

    try {
      const api = await serverSDK().apiForGeneration()
      const result = await api.providers.discoverModels({
        providerID: props.providerID,
        location: { directory: serverSync().data.path.directory },
      })
      if (sequence !== requestSequence) return
      batch(() => {
        setDiscovery("attempted", true)
        setDiscovery("source", result.data.source)
        setDiscovery("count", result.data.models.length)
      })
      await serverSync().refreshProviders()
    } catch (error) {
      if (sequence !== requestSequence) return
      batch(() => {
        setDiscovery("attempted", true)
        setDiscovery("error", formatServerError(error, language.t, language.t("provider.oauth.discovery.failure")))
      })
    } finally {
      if (sequence === requestSequence) setDiscovery("loading", false)
    }
  }

  const toggle = (row: ModelRow, visible: boolean) => {
    models.setVisibility({ providerID: props.providerID, modelID: row.id }, visible)
  }

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
      <div class="flex max-h-[60vh] flex-col gap-5 overflow-y-auto px-5 pb-6">
        <div class="flex items-center gap-3">
          <ProviderIcon id={props.providerID} class="size-5 shrink-0 icon-strong-base" />
          <div class="text-16-medium text-text-strong">{props.providerName}</div>
        </div>

        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="flex flex-col gap-1">
            <span class="text-12-medium text-text-weak">{language.t("provider.custom.discovery.title")}</span>
            <Show
              when={discovery.attempted && !discovery.error}
              fallback={<span class="text-12-regular text-text-weak">{language.t("provider.oauth.discovery.catalog")}</span>}
            >
              <span class="text-12-regular text-text-weak">
                {language.t("provider.oauth.discovery.result", { source: discovery.source ?? "", count: discovery.count ?? 0 })}
              </span>
            </Show>
          </div>
          <Button type="button" size="small" variant="secondary" onClick={() => void discover()} disabled={discovery.loading}>
            {discovery.loading
              ? language.t("provider.custom.discovery.discovering")
              : discovery.error
                ? language.t("provider.custom.discovery.retry")
                : language.t("provider.custom.discovery.discover")}
          </Button>
        </div>

        <Show when={discovery.error}>
          <div class="text-13-regular text-icon-critical-base">{discovery.error}</div>
        </Show>

        <List
          class="px-1 max-h-72"
          search={{ placeholder: language.t("provider.custom.discovery.search"), autofocus: false }}
          items={rows()}
          key={(row) => row.id}
          filterKeys={["id", "name"]}
          emptyMessage={language.t("provider.custom.discovery.empty")}
          onSelect={(row) => {
            if (!row) return
            const key = { providerID: props.providerID, modelID: row.id }
            models.setVisibility(key, !models.visible(key))
          }}
        >
          {(row) => (
            <div class="flex w-full items-center gap-3">
              <div class="flex min-w-0 flex-1 flex-col">
                <span class="truncate text-14-medium text-text-strong">{row.name}</span>
                <span class="truncate text-12-regular text-text-weak">{row.id}</span>
              </div>
              <div class="flex shrink-0 items-center gap-2" onClick={(event) => event.stopPropagation()}>
                <Button
                  type="button"
                  variant="ghost"
                  size="small"
                  onClick={() =>
                    void dialog.show(() => (
                      <DialogEditModelContext
                        providerID={props.providerID}
                        modelID={row.id}
                        modelName={row.name}
                        context={row.limit.context}
                      />
                    ))
                  }
                >
                  {language.t("common.edit")}
                </Button>
                <Switch
                  checked={models.visible({ providerID: props.providerID, modelID: row.id })}
                  onChange={(visible) => toggle(row, visible)}
                  hideLabel
                >
                  {row.name}
                </Switch>
              </div>
            </div>
          )}
        </List>
      </div>
    </Dialog>
  )
}
