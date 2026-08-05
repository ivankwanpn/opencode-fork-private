import type { AssistantMessage, Message, SessionMessage } from "@opencode-ai/sdk/v2/client"

type Provider = {
  id: string
  name?: string
  models: Record<string, Model | undefined>
}

type Model = {
  name?: string
  limit: {
    context: number
  }
}

type Context = {
  message: ContextMessage
  provider?: Provider
  model?: Model
  providerLabel: string
  modelLabel: string
  limit: number | undefined
  input: number
  total: number
  usage: number | null
}

type ContextMessage = Pick<AssistantMessage, "id" | "time" | "providerID" | "modelID" | "tokens">

const tokenTotal = (msg: { tokens?: ContextMessage["tokens"] }) => {
  if (!msg.tokens) return 0
  return msg.tokens.input + msg.tokens.output + msg.tokens.reasoning + msg.tokens.cache.read + msg.tokens.cache.write
}

const lastAssistantWithTokens = (messages: Message[]) => {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.role !== "assistant") continue
    if (tokenTotal(msg) <= 0) continue
    return msg
  }
}

const lastV2AssistantWithTokens = (messages: readonly SessionMessage[]) => {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message.type !== "assistant" || !message.tokens) continue
    if (tokenTotal(message) <= 0) continue
    return message
  }
}

const build = (message: ContextMessage | undefined, providers: Provider[] = []): Context | undefined => {
  if (!message) return undefined

  const provider = providers.find((item) => item.id === message.providerID)
  const model = provider?.models[message.modelID]
  const limit = model?.limit.context
  const total = tokenTotal(message)

  return {
    message,
    provider,
    model,
    providerLabel: provider?.name ?? message.providerID,
    modelLabel: model?.name ?? message.modelID,
    limit,
    input: message.tokens.input,
    total,
    usage: limit ? Math.round((total / limit) * 100) : null,
  }
}

export function getSessionContext(messages: Message[] = [], providers: Provider[] = []) {
  return build(lastAssistantWithTokens(messages), providers)
}

export function getV2SessionContext(messages: readonly SessionMessage[] = [], providers: Provider[] = []) {
  const message = lastV2AssistantWithTokens(messages)
  if (!message?.tokens) return undefined
  return build(
    {
      id: message.id,
      time: message.time,
      providerID: message.model.providerID,
      modelID: message.model.id,
      tokens: message.tokens,
    },
    providers,
  )
}
