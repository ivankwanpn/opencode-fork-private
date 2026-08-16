import { SelectV2 } from "@opencode-ai/ui/v2/select-v2"
import { For, createMemo, createSignal, type Component } from "solid-js"
import type { CustomProvider } from "@opencode-ai/schema/custom-provider"
import { useLanguage } from "@/context/language"
import { useModels } from "@/context/models"
import { useServerSync } from "@/context/server-sync"
import { showToast } from "@/utils/toast"
import { modelVariantsForProtocol } from "@/pages/session/composer/model-protocol-variants"
import { agentOverride, type AgentOverride } from "@/context/agent-config"
import {
  agentRoleMetadata,
  agentModelProtocols,
  formatAgentModel,
  parseAgentModel,
  primaryAgentIDs,
  resolveAgentProtocol,
  subagentAgentIDs,
  type ConfigurableAgentID,
} from "./agent-settings"
import { SettingsListV2 } from "./parts/list"
import { SettingsRowV2 } from "./parts/row"
import "./settings-v2.css"

type ModelItem = ReturnType<ReturnType<typeof useModels>["list"]>[number]
type ModelChoice = {
  id: string
  label: string
  model?: ModelItem
}

const DEFAULT_MODEL_ID = "__agent_default_model__"

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
      ...models
        .list()
        .filter((model) => models.visible({ providerID: model.provider.id, modelID: model.id }))
        .map((model) => ({
          id: formatAgentModel({ providerID: model.provider.id, modelID: model.id }),
          label: `${model.provider.name} / ${model.name}`,
          model,
        })),
    ]
    const configuredKey = configured ? parseAgentModel(configured) : undefined
    const configuredEntry = configuredKey ? models.find(configuredKey) : undefined
    if (
      configured &&
      configuredEntry &&
      models.visible({ providerID: configuredEntry.provider.id, modelID: configuredEntry.id }) &&
      !options.some((option) => option.id === configured)
    ) {
      options.push({
        id: configured,
        label: `${configuredEntry.provider.name} / ${configuredEntry.name}`,
        model: configuredEntry,
      })
    }
    return options
  })
  const currentModelChoice = createMemo(() => {
    const configured = override().model
    return modelChoices().find((option) => option.id === configured) ?? modelChoices()[0]
  })
  const protocols = createMemo(() => agentModelProtocols(selectedModel()))
  const currentProtocol = createMemo(() => resolveAgentProtocol(selectedModel(), override().protocol))
  const variantOptions = (model: ModelItem | undefined, protocol: CustomProvider.Protocol | undefined) => {
    if (!model) return []
    const variants = Object.keys(model.variants ?? {})
    return Array.from(new Set([...variants, ...modelVariantsForProtocol(variants, protocol)]))
  }
  const variants = createMemo(() => {
    return variantOptions(selectedModel(), currentProtocol())
  })
  const variantChoices = createMemo(() => ["default", ...variants()])
  const currentVariant = createMemo(() => {
    const selected = override().variant
    return selected && variantChoices().includes(selected) ? selected : "default"
  })

  const update = async (patch: AgentOverride) => {
    setSaving(true)
    try {
      await serverSync().agents.update(props.id, patch)
    } catch (error) {
      showToast({
        title: language.t("common.requestFailed"),
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <SettingsRowV2 title={props.id} description={language.t(agentRoleMetadata[props.id].descriptionKey)}>
      <div class="settings-v2-agent-controls">
        <div class="settings-v2-agent-control">
          <span class="settings-v2-agent-control-label">{language.t("settings.models.title")}</span>
          <SelectV2
            appearance="base"
            class="settings-v2-agent-select"
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
              const protocol = resolveAgentProtocol(option.model, override().protocol)
              const configuredVariant = override().variant
              const nextVariants = variantOptions(option.model, protocol)
              void update({
                model: option.id,
                protocol: protocol ?? null,
                variant:
                  configuredVariant && configuredVariant !== "default" && nextVariants.includes(configuredVariant)
                    ? configuredVariant
                    : null,
              })
            }}
          />
        </div>

        <div class="settings-v2-agent-control">
          <span class="settings-v2-agent-control-label">{language.t("provider.custom.protocol.label")}</span>
          <SelectV2
            appearance="base"
            class="settings-v2-agent-select"
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
            disabled={isSaving() || !selectedModel() || protocols().length === 0}
            placeholder={language.t("common.default")}
            fitViewport
            onSelect={(option) => {
              if (!option) return
              const model = selectedModel()
              if (!model) return
              const configuredVariant = override().variant
              const nextVariants = variantOptions(model, option)
              void update({
                protocol: option,
                variant:
                  configuredVariant && configuredVariant !== "default" && nextVariants.includes(configuredVariant)
                    ? configuredVariant
                    : null,
              })
            }}
          />
        </div>

        <div class="settings-v2-agent-control">
          <span class="settings-v2-agent-control-label">{language.t("model.tooltip.reasoning")}</span>
          <SelectV2
            appearance="base"
            class="settings-v2-agent-select"
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

const AgentSettingsSection: Component<{ title: string; ids: readonly ConfigurableAgentID[] }> = (props) => (
  <div class="settings-v2-section">
    <h3 class="settings-v2-section-title">{props.title}</h3>
    <For each={props.ids}>
      {(id) => (
        <SettingsListV2>
          <AgentSettingRow id={id} />
        </SettingsListV2>
      )}
    </For>
  </div>
)

export const SettingsAgentsV2: Component = () => {
  const language = useLanguage()
  return (
    <>
      <div class="settings-v2-tab-header">
        <h2 class="settings-v2-tab-title">{language.t("settings.agents.title")}</h2>
        <p class="settings-v2-tab-description">{language.t("settings.agents.description")}</p>
      </div>
      <div class="settings-v2-tab-body settings-v2-agents">
        <AgentSettingsSection
          title={language.t("settings.agents.section.coordinators")}
          ids={primaryAgentIDs}
        />
        <AgentSettingsSection title={language.t("settings.agents.section.subagents")} ids={subagentAgentIDs} />
      </div>
    </>
  )
}
