import { SelectV2 } from "@opencode-ai/ui/v2/select-v2"
import { Show, For, createMemo, createSignal, type Component } from "solid-js"
import type { Config } from "@opencode-ai/sdk/v2/client"
import type { CustomProvider } from "@opencode-ai/schema/custom-provider"
import { useLanguage } from "@/context/language"
import { useModels } from "@/context/models"
import { useServerSync } from "@/context/server-sync"
import { showToast } from "@/utils/toast"
import { modelVariantsForProtocol } from "@/pages/session/composer/model-protocol-variants"
import {
  configurableAgentIDs,
  formatAgentModel,
  parseAgentModel,
  resolveAgentProtocol,
  type ConfigurableAgentID,
} from "./agent-settings"
import { SettingsListV2 } from "./parts/list"
import { SettingsRowV2 } from "./parts/row"
import "./settings-v2.css"

type AgentOverride = {
  model?: string | null
  protocol?: CustomProvider.Protocol | null
  variant?: string | null
  [key: string]: unknown
}

type ModelItem = ReturnType<ReturnType<typeof useModels>["list"]>[number]
type ModelChoice = {
  id: string
  label: string
  model?: ModelItem
}

const DEFAULT_MODEL_ID = "__agent_default_model__"

function agentOverride(config: Config, id: ConfigurableAgentID): AgentOverride {
  const value = config.agent?.[id]
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return value as AgentOverride
}

const AgentSettingRow: Component<{ id: ConfigurableAgentID }> = (props) => {
  const language = useLanguage()
  const models = useModels()
  const serverSync = useServerSync()
  const saving = createSignal(false)
  const isSaving = saving[0]
  const setSaving = saving[1]

  const override = createMemo(() => agentOverride(serverSync().data.config, props.id))
  const configuredModel = createMemo(() => parseAgentModel(override().model))
  const selectedModel = createMemo(() => {
    const value = configuredModel()
    return value ? models.find(value) : undefined
  })
  const modelChoices = createMemo<ModelChoice[]>(() => {
    const configured = override().model
    const options = [
      { id: DEFAULT_MODEL_ID, label: language.t("common.default") },
      ...models.list().map((model) => ({
        id: formatAgentModel({ providerID: model.provider.id, modelID: model.id }),
        label: `${model.provider.name} / ${model.name}`,
        model,
      })),
    ]
    if (configured && !options.some((option) => option.id === configured)) {
      options.push({ id: configured, label: configured })
    }
    return options
  })
  const currentModelChoice = createMemo(() => {
    const configured = override().model
    return modelChoices().find((option) => option.id === configured) ?? modelChoices()[0]
  })
  const protocols = createMemo(() => {
    const available = [...(selectedModel()?.protocols ?? [])]
    const saved = override().protocol
    if (saved && !available.includes(saved)) available.push(saved)
    return available
  })
  const currentProtocol = createMemo(() => resolveAgentProtocol(selectedModel(), override().protocol))
  const variants = createMemo(() => {
    const model = selectedModel()
    if (!model) return []
    return Array.from(
      new Set([
        ...Object.keys(model.variants ?? {}),
        ...modelVariantsForProtocol(Object.keys(model.variants ?? {}), currentProtocol()),
      ]),
    )
  })
  const variantChoices = createMemo(() => ["default", ...variants()])
  const currentVariant = createMemo(() => {
    const selected = override().variant
    return selected && variantChoices().includes(selected) ? selected : "default"
  })

  const update = async (patch: AgentOverride) => {
    const before = serverSync().data.config.agent?.[props.id]
    const next = { ...agentOverride(serverSync().data.config, props.id), ...patch }
    const localNext = {
      ...next,
      model: next.model ?? undefined,
      protocol: next.protocol ?? undefined,
      variant: next.variant ?? undefined,
    }
    setSaving(true)
    serverSync().set("config", "agent", props.id, localNext)
    try {
      await serverSync().updateConfig({
        agent: { [props.id]: next } as unknown as NonNullable<Config["agent"]>,
      })
    } catch (error) {
      serverSync().set("config", "agent", props.id, before)
      showToast({
        title: language.t("common.requestFailed"),
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <SettingsRowV2 title={props.id} description={language.t("settings.agents.description")}>
      <div class="settings-v2-agent-controls">
        <div class="settings-v2-agent-control">
          <span class="settings-v2-agent-control-label">{language.t("settings.models.title")}</span>
          <SelectV2
            appearance="inline"
            options={modelChoices()}
            current={currentModelChoice()}
            value={(option) => option.id}
            label={(option) => option.label}
            groupBy={(option) => option.model?.provider.name ?? ""}
            disabled={isSaving()}
            fitViewport
            onSelect={(option) => {
              if (!option) return
              if (!option.model) {
                void update({ model: null, protocol: null, variant: null })
                return
              }
              const protocol = resolveAgentProtocol(option.model, undefined)
              void update({
                model: option.id,
                protocol: protocol ?? null,
                variant: null,
              })
            }}
          />
        </div>

        <div class="settings-v2-agent-control">
          <span class="settings-v2-agent-control-label">{language.t("provider.custom.protocol.label")}</span>
          <Show when={protocols().length > 0} fallback={<span class="settings-v2-agent-control-value">Auto</span>}>
            <SelectV2
              appearance="inline"
              options={protocols()}
              current={currentProtocol()}
              value={(option) => option}
              label={(option) =>
                option === "openai-responses"
                  ? language.t("provider.custom.protocol.openaiResponses")
                  : option === "openai-compatible"
                    ? language.t("provider.custom.protocol.openaiCompatible")
                    : language.t("provider.custom.protocol.anthropicMessages")
              }
              disabled={isSaving() || !selectedModel()}
              fitViewport
              onSelect={(option) => {
                if (!option) return
                const nextVariants = modelVariantsForProtocol(Object.keys(selectedModel()?.variants ?? {}), option)
                const variant = currentVariant()
                void update({
                  protocol: option,
                  variant: nextVariants.includes(variant) && variant !== "default" ? variant : null,
                })
              }}
            />
          </Show>
        </div>

        <div class="settings-v2-agent-control">
          <span class="settings-v2-agent-control-label">{language.t("model.tooltip.reasoning")}</span>
          <SelectV2
            appearance="inline"
            options={variantChoices()}
            current={currentVariant()}
            value={(option) => option}
            label={(option) => (option === "default" ? language.t("common.default") : option)}
            disabled={isSaving() || !selectedModel() || variants().length === 0}
            fitViewport
            onSelect={(option) => option && void update({ variant: option === "default" ? null : option })}
          />
        </div>
      </div>
    </SettingsRowV2>
  )
}

export const SettingsAgentsV2: Component = () => {
  const language = useLanguage()
  return (
    <>
      <div class="settings-v2-tab-header">
        <h2 class="settings-v2-tab-title">{language.t("settings.agents.title")}</h2>
        <p class="settings-v2-tab-description">{language.t("settings.agents.description")}</p>
      </div>
      <div class="settings-v2-tab-body">
        <div class="settings-v2-section">
          <h3 class="settings-v2-section-title">{language.t("settings.agents.title")}</h3>
          <SettingsListV2>
            <For each={configurableAgentIDs}>{(id) => <AgentSettingRow id={id} />}</For>
          </SettingsListV2>
        </div>
      </div>
    </>
  )
}
