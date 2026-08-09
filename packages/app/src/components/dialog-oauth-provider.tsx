import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { List } from "@opencode-ai/ui/list"
import { ProviderIcon } from "@opencode-ai/ui/provider-icon"
import { Switch } from "@opencode-ai/ui/switch"
import { createMemo, Show, type Component } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { useModels } from "@/context/models"
import { useServerSDK } from "@/context/server-sdk"
import { useServerSync } from "@/context/server-sync"
import { DialogEditModelContext } from "./dialog-edit-model-context"

type ModelRow = ReturnType<ReturnType<typeof useModels>["list"]>[number]

export type OAuthDiscoveryState = {
  attempted: boolean
  loading: boolean
  source?: string
  count?: number
  error?: string
}

type OAuthDiscoveryResponse = {
  data: {
    source: string
    models: readonly unknown[]
  }
}

type OAuthDiscoveryError = {
  _tag: "ProviderModelDiscoveryError"
  kind?: unknown
}

export function oauthDiscoveryErrorKey(error: unknown) {
  const candidate = discoveryError(error)
  if (candidate?.kind === "unsupported") return "provider.oauth.discovery.unsupported"
  if (candidate?.kind === "empty") return "provider.oauth.discovery.empty"
  return "provider.oauth.discovery.failure"
}

export function createOAuthDiscoveryController(input: {
  providerID: string
  directory: () => string
  discoverModels: (input: { providerID: string; location: { directory: string } }) => Promise<OAuthDiscoveryResponse>
  refreshProviders: () => Promise<void>
  update: (patch: Partial<OAuthDiscoveryState>) => void
}) {
  let requestSequence = 0

  const discover = async () => {
    const sequence = ++requestSequence
    input.update({ loading: true, error: undefined })

    let result: OAuthDiscoveryResponse
    try {
      result = await input.discoverModels({
        providerID: input.providerID,
        location: { directory: input.directory() },
      })
    } catch (error) {
      if (sequence !== requestSequence) return
      input.update({ attempted: true, error: oauthDiscoveryErrorKey(error) })
      if (sequence === requestSequence) input.update({ loading: false })
      return
    }

    if (sequence !== requestSequence) return
    input.update({
      attempted: true,
      source: result.data.source,
      count: result.data.models.length,
      error: undefined,
    })
    try {
      await input.refreshProviders()
    } catch {}
    if (sequence === requestSequence) input.update({ loading: false })
  }

  return { discover }
}

function discoveryError(error: unknown): OAuthDiscoveryError | undefined {
  if (isOAuthDiscoveryError(error)) return error
  if (!(error instanceof Error) || !isRecord(error.cause) || !("body" in error.cause)) return
  return isOAuthDiscoveryError(error.cause.body) ? error.cause.body : undefined
}

function isOAuthDiscoveryError(error: unknown): error is OAuthDiscoveryError {
  return isRecord(error) && error._tag === "ProviderModelDiscoveryError"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

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
  const [discovery, setDiscovery] = createStore<OAuthDiscoveryState>({ attempted: false, loading: false })
  const discoveryController = createOAuthDiscoveryController({
    providerID: props.providerID,
    directory: () => serverSync().data.path.directory,
    discoverModels: async (input) => {
      const api = await serverSDK().apiForGeneration()
      return api.providers.discoverModels(input)
    },
    refreshProviders: () => serverSync().refreshProviders(),
    update: (patch) => setDiscovery(patch),
  })

  const rows = createMemo<ModelRow[]>(() => oauthModelRows({ providerID: props.providerID, models: models.list() }))

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
            <span class="text-12-medium text-text-weak">{language.t("provider.oauth.title")}</span>
            <Show
              when={discovery.attempted && !discovery.error}
              fallback={<span class="text-12-regular text-text-weak">{language.t("provider.oauth.discovery.cached")}</span>}
            >
              <span class="text-12-regular text-text-weak">
                {language.t("provider.oauth.discovery.success")} {discovery.count ?? 0} · {discovery.source ?? ""}
              </span>
            </Show>
          </div>
          <Button
            type="button"
            size="small"
            variant="secondary"
            onClick={() => void discoveryController.discover()}
            disabled={discovery.loading}
          >
            {discovery.loading
              ? language.t("provider.oauth.discovery.discovering")
              : language.t("provider.oauth.discovery.discover")}
          </Button>
        </div>

        <Show when={discovery.error}>
          <div class="text-13-regular text-icon-critical-base">{language.t(discovery.error!)}</div>
        </Show>

        <List
          class="px-1 max-h-72"
          search={{ placeholder: language.t("provider.oauth.models.search"), autofocus: false }}
          items={rows()}
          key={(row) => row.id}
          filterKeys={["id", "name"]}
          emptyMessage={language.t("provider.oauth.models.empty")}
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
