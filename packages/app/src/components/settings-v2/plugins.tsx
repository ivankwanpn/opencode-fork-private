import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { Switch } from "@opencode-ai/ui/v2/switch-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { type Component, For, Show, createMemo, createSignal, onMount } from "solid-js"
import { useServerSDK } from "@/context/server-sdk"
import type { ServerApi } from "@/utils/server"
import { SettingsListV2 } from "./parts/list"
import { SettingsRowV2 } from "./parts/row"
import "./settings-v2.css"

type Catalog = Awaited<ReturnType<ServerApi["plugins"]["list"]>>
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
  const [catalog, setCatalog] = createSignal<Catalog>({ marketplaces: [], plugins: [] })
  const [view, setView] = createSignal<"plugins" | "marketplaces">("plugins")
  const [filter, setFilter] = createSignal("")
  const [source, setSource] = createSignal(DEFAULT_MARKETPLACE_SOURCE)
  const [busy, setBusy] = createSignal<string>()
  const [error, setError] = createSignal<string>()

  const run = async (key: string, action: () => Promise<Catalog>) => {
    setBusy(key)
    setError(undefined)
    try {
      setCatalog(await action())
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setBusy(undefined)
    }
  }

  const load = () => run("load", () => sdk().currentApi.plugins.list())

  const filtered = createMemo(() => {
    const query = filter().trim().toLowerCase()
    if (!query) return catalog().plugins
    return catalog().plugins.filter((item) =>
      [item.name, item.marketplace, item.description, ...(item.tags ?? [])]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLowerCase().includes(query)),
    )
  })

  const installed = createMemo(() => filtered().filter((item) => item.installed))
  const available = createMemo(() => filtered().filter((item) => !item.installed))

  const addMarketplace = () => {
    const value = source().trim()
    if (!value) return
    void run("add-marketplace", () =>
      sdk()
        .currentApi.plugins.add({ source: value })
        .then((result) => {
          setSource("")
          return result
        }),
    )
  }

  const install = (item: PluginItem) =>
    void run(`install:${item.id}`, () => sdk().currentApi.plugins.install({ id: item.id }))

  const toggle = (item: PluginItem, enabled: boolean) =>
    void run(`${enabled ? "enable" : "disable"}:${item.id}`, () =>
      enabled ? sdk().currentApi.plugins.enable({ id: item.id }) : sdk().currentApi.plugins.disable({ id: item.id }),
    )

  const uninstall = (item: PluginItem) =>
    void run(`uninstall:${item.id}`, () => sdk().currentApi.plugins.uninstall({ id: item.id }))

  onMount(() => void load())

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
              <Show
                when={catalog().marketplaces.length > 0}
                fallback={<div class="settings-v2-plugins-status">No marketplaces added</div>}
              >
                <SettingsListV2>
                  <For each={catalog().marketplaces}>
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
                              void run(`refresh:${marketplace.name}`, () =>
                                sdk().currentApi.plugins.refresh({ name: marketplace.name }),
                              )
                            }
                          />
                          <ButtonV2
                            variant="ghost-muted"
                            size="small"
                            icon="close"
                            disabled={Boolean(busy())}
                            onClick={() =>
                              void run(`remove:${marketplace.name}`, () =>
                                sdk().currentApi.plugins.remove({ name: marketplace.name }),
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
            </>
          }
        >
          <Show when={installed().length > 0}>
            <div class="settings-v2-section">
              <h3 class="settings-v2-section-title">Installed</h3>
              <SettingsListV2>
                <For each={installed()}>
                  {(item) => <PluginRow item={item} busy={busy()} onToggle={toggle} onUninstall={uninstall} />}
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
              {filter().trim() ? `No plugins match "${filter().trim()}"` : "No plugins available"}
            </div>
          </Show>
        </Show>
      </div>
    </>
  )
}

const PluginRow: Component<{
  item: PluginItem
  busy?: string
  onToggle: (item: PluginItem, enabled: boolean) => void
  onUninstall: (item: PluginItem) => void
}> = (props) => {
  return (
    <SettingsRowV2
      title={props.item.name}
      description={`${props.item.marketplace}${props.item.description ? ` - ${props.item.description}` : ""}`}
    >
      <div class="settings-v2-plugins-actions">
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
