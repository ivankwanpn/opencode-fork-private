import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { Switch } from "@opencode-ai/ui/v2/switch-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import type { Plugin } from "@opencode-ai/schema/plugin"
import { type Component, For, Show, createEffect, createMemo, createSignal } from "solid-js"
import { useLanguage } from "@/context/language"
import { useServerSDK } from "@/context/server-sdk"
import { useServerSync } from "@/context/server-sync"
import type { ServerApi } from "@/utils/server"
import { SettingsListV2 } from "./parts/list"
import { SettingsRowV2 } from "./parts/row"
import {
  beginPluginLoad,
  pluginLoadContextCurrent,
  rejectPluginLoad,
  resolvePluginLoad,
  type PluginLoadState,
} from "./plugin-load-state"
import { pluginRuntimePresentation } from "./plugin-runtime-status"
import "./settings-v2.css"

type Catalog = Awaited<ReturnType<ServerApi["plugins"]["list"]>>
type Runtime = Awaited<ReturnType<ServerApi["plugins"]["runtime"]>>
type PluginItem = Catalog["plugins"][number]

const DEFAULT_MARKETPLACE_SOURCE = "anthropics/claude-plugins-official"

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string") {
    return error.message
  }
  return String(error)
}

export const SettingsPluginsV2: Component = () => {
  const sdk = useServerSDK()
  const serverSync = useServerSync()
  const directorySync = createMemo(() => {
    const directory = serverSync().data.path.directory
    if (!directory) return
    return serverSync().ensureDirSyncContext(directory)
  })
  const language = useLanguage()
  const [catalogState, setCatalogState] = createSignal<PluginLoadState<Catalog>>({ state: "idle" })
  const [runtimeState, setRuntimeState] = createSignal<PluginLoadState<Runtime>>({ state: "idle" })
  const [view, setView] = createSignal<"plugins" | "marketplaces">("plugins")
  const [filter, setFilter] = createSignal("")
  const [source, setSource] = createSignal(DEFAULT_MARKETPLACE_SOURCE)
  const [busy, setBusy] = createSignal<string>()
  const [error, setError] = createSignal<string>()
  let catalogRequest = 0
  let runtimeRequest = 0

  const currentServer = (target: ReturnType<typeof sdk>, generation: number) =>
    target === sdk() && generation === target.protocolGeneration()

  const loadCatalog = async (target = sdk()) => {
    const request = ++catalogRequest
    const generation = target.protocolGeneration()
    const context = { request, server: target, generation }
    setCatalogState((current) => beginPluginLoad(current, request))
    try {
      const value = await target.apiForGeneration().then((api) => api.plugins.list())
      if (
        !pluginLoadContextCurrent(context, {
          request: catalogRequest,
          server: sdk(),
          generation: target.protocolGeneration(),
        })
      )
        return
      setCatalogState((current) => resolvePluginLoad(current, request, value))
    } catch (reason) {
      if (
        !pluginLoadContextCurrent(context, {
          request: catalogRequest,
          server: sdk(),
          generation: target.protocolGeneration(),
        })
      )
        return
      setCatalogState((current) => rejectPluginLoad(current, request, errorMessage(reason)))
    }
  }

  const loadRuntime = async (target: ReturnType<typeof sdk>, directory: string) => {
    const request = ++runtimeRequest
    const generation = target.protocolGeneration()
    const context = { request, server: target, generation, directory }
    setRuntimeState((current) => beginPluginLoad(current, request))
    try {
      const value = await target
        .apiForGeneration()
        .then((api) => api.plugins.runtime({ location: { directory } }))
      if (
        !pluginLoadContextCurrent(context, {
          request: runtimeRequest,
          server: sdk(),
          generation: target.protocolGeneration(),
          directory: serverSync().data.path.directory,
        })
      )
        return
      setRuntimeState((current) => resolvePluginLoad(current, request, value))
    } catch (reason) {
      if (
        !pluginLoadContextCurrent(context, {
          request: runtimeRequest,
          server: sdk(),
          generation: target.protocolGeneration(),
          directory: serverSync().data.path.directory,
        })
      )
        return
      setRuntimeState((current) => rejectPluginLoad(current, request, errorMessage(reason)))
    }
  }

  const run = async (
    key: string,
    action: (target: ReturnType<typeof sdk>) => Promise<Catalog>,
    refreshRuntime = false,
  ) => {
    const target = sdk()
    const generation = target.protocolGeneration()
    setBusy(key)
    setError(undefined)
    try {
      const value = await action(target)
      if (!currentServer(target, generation)) return
      setCatalogState({ state: "ready", request: ++catalogRequest, value })
      if (refreshRuntime) {
        const directory = directorySync()
        if (directory) await Promise.all([directory.mcp.refresh(), directory.commands.refresh()])
        const path = serverSync().data.path.directory
        if (path) await loadRuntime(target, path)
      }
    } catch (reason) {
      if (currentServer(target, generation)) setError(errorMessage(reason))
    } finally {
      setBusy(undefined)
    }
  }

  const catalog = createMemo(() => {
    const current = catalogState()
    if (current.state === "ready" || current.state === "refreshing" || current.state === "stale") {
      return current.value
    }
  })

  const filtered = createMemo(() => {
    const query = filter().trim().toLowerCase()
    const plugins = catalog()?.plugins ?? []
    if (!query) return plugins
    return plugins.filter((item) =>
      [item.name, item.marketplace, item.description, ...(item.tags ?? [])]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLowerCase().includes(query)),
    )
  })

  const installed = createMemo(() => filtered().filter((item) => item.installed))
  const available = createMemo(() => filtered().filter((item) => !item.installed))
  const catalogLoading = createMemo(() => {
    const state = catalogState().state
    return state === "idle" || state === "loading" || state === "refreshing"
  })
  const catalogFailure = createMemo(() => {
    const state = catalogState()
    if (state.state === "failed") return state.error
  })
  const catalogStale = createMemo(() => {
    const state = catalogState()
    if (state.state === "stale") return state.error
  })
  const runtimeLabels = createMemo<Record<Plugin.RuntimeState, string>>(() => ({
    disabled: language.t("plugin.status.disabled"),
    initializing: language.t("plugin.runtime.initializing"),
    ready: language.t("plugin.runtime.ready"),
    degraded: language.t("plugin.runtime.degraded"),
    failed: language.t("plugin.runtime.failed"),
  }))
  const capabilityLabels = createMemo<Record<Plugin.RuntimeCapabilityName, string>>(() => ({
    skills: language.t("plugin.capability.skills"),
    commands: language.t("plugin.capability.commands"),
    mcp: language.t("plugin.capability.mcp"),
    plugin: language.t("plugin.capability.plugin"),
    tools: language.t("plugin.capability.tools"),
  }))
  const capabilityStateLabels = createMemo<Record<Plugin.RuntimeCapabilityState, string>>(() => ({
    disabled: language.t("plugin.status.disabled"),
    pending: language.t("plugin.runtime.initializing"),
    ready: language.t("plugin.runtime.ready"),
    failed: language.t("plugin.runtime.failed"),
  }))

  const addMarketplace = () => {
    const value = source().trim()
    if (!value) return
    void run(
      "add-marketplace",
      (target) =>
        target
          .apiForGeneration()
          .then((api) => api.plugins.add({ source: value }))
          .then((result) => {
            setSource("")
            return result
          }),
      true,
    )
  }

  const install = (item: PluginItem) =>
    void run(
      `install:${item.id}`,
      (target) => target.apiForGeneration().then((api) => api.plugins.install({ id: item.id })),
      true,
    )

  const toggle = (item: PluginItem, enabled: boolean) =>
    void run(
      `${enabled ? "enable" : "disable"}:${item.id}`,
      (target) =>
        target
          .apiForGeneration()
          .then((api) => (enabled ? api.plugins.enable({ id: item.id }) : api.plugins.disable({ id: item.id }))),
      true,
    )

  const uninstall = (item: PluginItem) =>
    void run(
      `uninstall:${item.id}`,
      (target) => target.apiForGeneration().then((api) => api.plugins.uninstall({ id: item.id })),
      true,
    )

  createEffect(() => {
    const target = sdk()
    target.protocolKind()
    void loadCatalog(target)
  })

  createEffect(() => {
    const target = sdk()
    target.protocolKind()
    const directory = serverSync().data.path.directory
    if (directory) {
      void loadRuntime(target, directory)
      return
    }
    runtimeRequest += 1
    setRuntimeState({ state: "idle" })
  })

  return (
    <>
      <div class="settings-v2-tab-header settings-v2-tab-header--stacked settings-v2-plugins-header">
        <div class="settings-v2-tab-header-row">
          <h2 class="settings-v2-tab-title">Plugins</h2>
          <div class="settings-v2-plugins-tabs">
            <ButtonV2
              size="small"
              variant={view() === "plugins" ? "contrast" : "ghost-muted"}
              onClick={() => setView("plugins")}
            >
              Plugins
            </ButtonV2>
            <ButtonV2
              size="small"
              variant={view() === "marketplaces" ? "contrast" : "ghost-muted"}
              onClick={() => setView("marketplaces")}
            >
              Marketplaces
            </ButtonV2>
          </div>
        </div>
        <Show when={view() === "plugins"}>
          <div class="settings-v2-tab-search">
            <TextInputV2
              type="search"
              appearance="base"
              value={filter()}
              onInput={(event) => setFilter(event.currentTarget.value)}
              placeholder="Search plugins"
              spellcheck={false}
              autocorrect="off"
              autocomplete="off"
              autocapitalize="off"
              aria-label="Search plugins"
              showClearButton={Boolean(filter())}
              clearLabel="Clear search"
              onClearClick={() => setFilter("")}
            />
          </div>
        </Show>
      </div>

      <div class="settings-v2-tab-body settings-v2-plugins">
        <Show when={error()}>{(message) => <div class="settings-v2-plugins-error">{message()}</div>}</Show>
        <Show when={catalogLoading()}>
          <div class="settings-v2-plugins-status" aria-live="polite">
            {language.t("plugin.catalog.loading")}
          </div>
        </Show>
        <Show when={catalogFailure()}>
          {(message) => (
            <div class="settings-v2-plugins-error" aria-live="polite">
              <span>{language.t("plugin.catalog.failed")}</span>
              <span>{message()}</span>
              <ButtonV2 variant="neutral" size="small" onClick={() => void loadCatalog()}>
                {language.t("plugin.catalog.retry")}
              </ButtonV2>
            </div>
          )}
        </Show>
        <Show when={catalogStale()}>
          {(message) => (
            <div class="settings-v2-plugins-status settings-v2-plugins-status--stale" aria-live="polite">
              {language.t("plugin.catalog.stale")}: {message()}
            </div>
          )}
        </Show>

        <Show
          when={view() === "plugins"}
          fallback={
            <>
              <div class="settings-v2-plugins-add">
                <TextInputV2
                  value={source()}
                  onInput={(event) => setSource(event.currentTarget.value)}
                  placeholder="GitHub, Git URL, marketplace JSON, or local path"
                  spellcheck={false}
                  autocorrect="off"
                  autocomplete="off"
                  autocapitalize="off"
                  aria-label="Marketplace source"
                  onKeyDown={(event) => {
                    if (event.key === "Enter") addMarketplace()
                  }}
                />
                <ButtonV2
                  variant="contrast"
                  size="small"
                  icon="plus"
                  disabled={!source().trim() || Boolean(busy())}
                  onClick={addMarketplace}
                >
                  Add marketplace
                </ButtonV2>
              </div>
              <Show when={catalog()}>
                <Show
                  when={(catalog()?.marketplaces.length ?? 0) > 0}
                  fallback={<div class="settings-v2-plugins-status">No marketplaces added</div>}
                >
                  <SettingsListV2>
                    <For each={catalog()?.marketplaces ?? []}>
                      {(marketplace) => (
                        <SettingsRowV2
                          title={marketplace.name}
                          description={marketplace.error ?? `${marketplace.pluginCount} plugins - ${marketplace.source}`}
                        >
                          <div class="settings-v2-plugins-actions">
                            <IconButtonV2
                              type="button"
                              variant="ghost-muted"
                              size="small"
                              aria-label={`Refresh ${marketplace.name}`}
                              icon={<IconV2 name="reset" size="small" />}
                              disabled={Boolean(busy())}
                              onClick={() =>
                                void run(
                                  `refresh:${marketplace.name}`,
                                  (target) =>
                                    target
                                      .apiForGeneration()
                                      .then((api) => api.plugins.refresh({ name: marketplace.name })),
                                  true,
                                )
                              }
                            />
                            <ButtonV2
                              variant="ghost-muted"
                              size="small"
                              icon="close"
                              disabled={Boolean(busy())}
                              onClick={() =>
                                void run(
                                  `remove:${marketplace.name}`,
                                  (target) =>
                                    target
                                      .apiForGeneration()
                                      .then((api) => api.plugins.remove({ name: marketplace.name })),
                                  true,
                                )
                              }
                            >
                              Remove
                            </ButtonV2>
                          </div>
                        </SettingsRowV2>
                      )}
                    </For>
                  </SettingsListV2>
                </Show>
              </Show>
            </>
          }
        >
          <Show when={catalog()}>
            <Show when={installed().length > 0}>
              <div class="settings-v2-section">
                <h3 class="settings-v2-section-title">Installed</h3>
                <SettingsListV2>
                  <For each={installed()}>
                    {(item) => (
                      <PluginRow
                        item={item}
                        busy={busy()}
                        runtime={runtimeState()}
                        runtimeLabels={runtimeLabels()}
                        capabilityLabels={capabilityLabels()}
                        capabilityStateLabels={capabilityStateLabels()}
                        staleLabel={language.t("plugin.runtime.stale")}
                        enabledLabel={language.t("plugin.status.enabled")}
                        disabledLabel={language.t("plugin.status.disabled")}
                        onToggle={toggle}
                        onUninstall={uninstall}
                      />
                    )}
                  </For>
                </SettingsListV2>
              </div>
            </Show>
            <Show when={available().length > 0}>
              <div class="settings-v2-section">
                <h3 class="settings-v2-section-title">Available</h3>
                <SettingsListV2>
                  <For each={available()}>
                    {(item) => (
                      <SettingsRowV2
                        title={item.name}
                        description={`${item.marketplace}${item.description ? ` - ${item.description}` : ""}`}
                      >
                        <ButtonV2
                          variant="neutral"
                          size="small"
                          icon="plus"
                          disabled={Boolean(busy())}
                          onClick={() => install(item)}
                        >
                          Install
                        </ButtonV2>
                      </SettingsRowV2>
                    )}
                  </For>
                </SettingsListV2>
              </div>
            </Show>
            <Show when={!installed().length && !available().length}>
              <div class="settings-v2-plugins-status">
                {filter().trim() && (catalog()?.plugins.length ?? 0) > 0
                  ? language.t("plugin.catalog.filteredEmpty")
                  : language.t("plugin.catalog.empty")}
              </div>
            </Show>
          </Show>
        </Show>
      </div>
    </>
  )
}

const PluginRow: Component<{
  item: PluginItem
  busy?: string
  runtime: PluginLoadState<Runtime>
  runtimeLabels: Readonly<Record<Plugin.RuntimeState, string>>
  capabilityLabels: Readonly<Record<Plugin.RuntimeCapabilityName, string>>
  capabilityStateLabels: Readonly<Record<Plugin.RuntimeCapabilityState, string>>
  staleLabel: string
  enabledLabel: string
  disabledLabel: string
  onToggle: (item: PluginItem, enabled: boolean) => void
  onUninstall: (item: PluginItem) => void
}> = (props) => {
  const runtime = createMemo(() => pluginRuntimePresentation(props.item.id, props.runtime))
  return (
    <SettingsRowV2
      title={props.item.name}
      description={
        <span class="settings-v2-plugin-description">
          <span>{`${props.item.marketplace}${props.item.description ? ` - ${props.item.description}` : ""}`}</span>
          <span class="settings-v2-plugin-runtime-summary" title={runtime().message}>
            <span
              class="settings-v2-plugin-status-dot"
              classList={{
                "settings-v2-plugin-status-dot--connected": runtime().state === "ready",
                "settings-v2-plugin-status-dot--pending": runtime().state === "initializing",
                "settings-v2-plugin-status-dot--failed": runtime().state === "failed",
                "settings-v2-plugin-status-dot--degraded": runtime().state === "degraded",
              }}
            />
            {props.runtimeLabels[runtime().state]}
            <Show when={runtime().stale}> · {props.staleLabel}</Show>
          </span>
          <Show when={runtime().capabilities.length > 0}>
            <span class="settings-v2-plugin-capabilities">
              <For each={runtime().capabilities}>
                {(capability) => (
                  <span class="settings-v2-plugin-runtime" title={capability.message}>
                    <span
                      class="settings-v2-plugin-status-dot"
                      classList={{
                        "settings-v2-plugin-status-dot--connected": capability.state === "ready",
                        "settings-v2-plugin-status-dot--pending": capability.state === "pending",
                        "settings-v2-plugin-status-dot--failed": capability.state === "failed",
                      }}
                    />
                    {props.capabilityLabels[capability.name]} {props.capabilityStateLabels[capability.state]}
                  </span>
                )}
              </For>
            </span>
          </Show>
        </span>
      }
    >
      <div class="settings-v2-plugins-actions">
        <span class="settings-v2-plugin-state">
          <span
            class="settings-v2-plugin-status-dot"
            classList={{ "settings-v2-plugin-status-dot--connected": props.item.enabled }}
          />
          {props.item.enabled ? props.enabledLabel : props.disabledLabel}
        </span>
        <Switch
          checked={props.item.enabled}
          disabled={Boolean(props.busy)}
          hideLabel
          onChange={(enabled) => props.onToggle(props.item, enabled)}
        >
          {props.item.name}
        </Switch>
        <ButtonV2
          variant="ghost-muted"
          size="small"
          icon="close"
          disabled={Boolean(props.busy)}
          onClick={() => props.onUninstall(props.item)}
        >
          Uninstall
        </ButtonV2>
      </div>
    </SettingsRowV2>
  )
}
