import type { Config } from "@opencode-ai/sdk/v2/client"

export function updateModelContext(config: Config, providerID: string, modelID: string, context: number | undefined) {
  const provider = config.provider?.[providerID] ?? {}
  const model = provider.models?.[modelID]
  if (!model) {
    if (context === undefined) return config
    return {
      ...config,
      provider: {
        ...config.provider,
        [providerID]: {
          ...provider,
          models: {
            ...provider.models,
            [modelID]: { limit: { context, output: 0 } },
          },
        },
      },
    }
  }

  const nextModel =
    context === undefined
      ? { ...model, limit: undefined }
      : {
          ...model,
          limit: {
            context,
            ...(model.limit?.input === undefined ? {} : { input: model.limit.input }),
            output: model.limit?.output ?? 0,
          },
        }

  return {
    ...config,
    provider: {
      ...config.provider,
      [providerID]: {
        ...provider,
        models: {
          ...provider.models,
          [modelID]: nextModel,
        },
      },
    },
  }
}
