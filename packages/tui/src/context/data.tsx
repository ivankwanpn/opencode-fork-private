import type {
  AgentV2Info,
  CommandV2Info,
  IntegrationInfo,
  LocationRef,
  ModelV2Info,
  PermissionSavedInfo,
  PermissionV2Request,
  ProviderV2Info,
  QuestionV2Request,
  ReferenceInfo,
  SessionMessage,
  SessionMessageAssistant,
  SessionMessageAssistantReasoning,
  SessionMessageAssistantText,
  SessionMessageAssistantTool,
  SessionV2Info,
  SkillV2Info,
} from "@opencode-ai/sdk/v2"
import type { OpenCodeEvent as V2Event } from "@opencode-ai/client"
import { createStore, produce } from "solid-js/store"
import { useNativeEvent } from "./event"
import { createSimpleContext } from "./helper"
import { useSDK } from "./sdk"
import { createSignal, onCleanup, onMount } from "solid-js"
import { createNativeEventRecovery } from "./native-event-recovery"

type LocationData = {
  agent?: AgentV2Info[]
  command?: CommandV2Info[]
  integration?: IntegrationInfo[]
  model?: ModelV2Info[]
  provider?: ProviderV2Info[]
  reference?: ReferenceInfo[]
  skill?: SkillV2Info[]
}

type Data = {
  session: {
    info: Record<string, SessionV2Info>
    message: Record<string, SessionMessage[]>
    permission: Record<string, PermissionV2Request[]>
    question: Record<string, QuestionV2Request[]>
  }
  project: {
    permission: Record<string, PermissionSavedInfo[]>
  }
  location: Record<string, LocationData>
}

function locationKey(location: LocationRef) {
  return JSON.stringify([location.directory, location.workspaceID])
}

function locationQuery(ref?: LocationRef) {
  return ref ? { directory: ref.directory, workspace: ref.workspaceID } : undefined
}

function locationFromKey(key: string): LocationRef {
  const [directory, workspaceID] = JSON.parse(key) as [string, string | undefined]
  return { directory, workspaceID }
}

const mutable = <T,>(value: unknown): T => structuredClone(value) as T

export const { use: useData, provider: DataProvider } = createSimpleContext({
  name: "Data",
  init: () => {
    const [store, setStore] = createStore<Data>({
      session: {
        info: {},
        message: {},
        permission: {},
        question: {},
      },
      project: {
        permission: {},
      },
      location: {},
    })

    const sdk = useSDK()
    const nativeEvent = useNativeEvent()
    const [defaultLocation, setDefaultLocation] = createSignal<LocationRef>({
      directory: sdk.directory ?? process.cwd(),
    })

    const message = {
      update(sessionID: string, fn: (messages: SessionMessage[]) => void) {
        setStore(
          "session",
          "message",
          produce((draft) => {
            fn((draft[sessionID] ??= []))
          }),
        )
      },
      prepend(messages: SessionMessage[], item: SessionMessage) {
        if (messages.some((existing) => existing.id === item.id)) return
        messages.unshift(item)
      },
      activeAssistant(messages: SessionMessage[]) {
        const item = messages.find((item) => item.type === "assistant" && !item.time.completed)
        return item?.type === "assistant" ? item : undefined
      },
      assistant(messages: SessionMessage[], messageID: string) {
        const item = messages.find((item) => item.type === "assistant" && item.id === messageID)
        return item?.type === "assistant" ? item : undefined
      },
      activeShell(messages: SessionMessage[], callID: string) {
        const item = messages.find((item) => item.type === "shell" && item.callID === callID)
        return item?.type === "shell" ? item : undefined
      },
      latestTool(assistant: SessionMessageAssistant | undefined, callID?: string) {
        return assistant?.content.findLast(
          (item): item is SessionMessageAssistantTool =>
            item.type === "tool" && (callID === undefined || item.id === callID),
        )
      },
      latestText(assistant: SessionMessageAssistant | undefined, textID: string) {
        return assistant?.content.findLast(
          (item): item is SessionMessageAssistantText => item.type === "text" && item.id === textID,
        )
      },
      latestReasoning(assistant: SessionMessageAssistant | undefined, reasoningID: string) {
        return assistant?.content.findLast(
          (item): item is SessionMessageAssistantReasoning => item.type === "reasoning" && item.id === reasoningID,
        )
      },
    }

    function handleEvent(event: V2Event) {
      switch (event.type) {
        case "catalog.updated":
          void Promise.all([
            result.location.model.refresh(event.location),
            result.location.provider.refresh(event.location),
          ])
          break
        case "session.next.agent.switched":
          message.update(event.data.sessionID, (draft) => {
            message.prepend(draft, {
              id: event.data.messageID,
              type: "agent-switched",
              agent: event.data.agent,
              time: { created: event.data.timestamp },
            })
          })
          break
        case "session.next.model.switched":
          message.update(event.data.sessionID, (draft) => {
            message.prepend(draft, {
              id: event.data.messageID,
              type: "model-switched",
              model: event.data.model,
              time: { created: event.data.timestamp },
            })
          })
          break
        case "session.next.prompted": {
          message.update(event.data.sessionID, (draft) => {
            message.prepend(
              draft,
              mutable<SessionMessage>({
                id: event.data.messageID,
                type: "user",
                text: event.data.prompt.text,
                context: event.data.prompt.context,
                files: event.data.prompt.files,
                agents: event.data.prompt.agents,
                time: { created: event.data.timestamp },
              }),
            )
          })
          break
        }
        case "session.next.prompt.admitted":
          break
        case "session.next.context.updated":
          message.update(event.data.sessionID, (draft) => {
            message.prepend(draft, {
              id: event.data.messageID,
              type: "system",
              text: event.data.text,
              time: { created: event.data.timestamp },
            })
          })
          break
        case "session.next.synthetic":
          message.update(event.data.sessionID, (draft) => {
            message.prepend(draft, {
              id: event.data.messageID,
              type: "synthetic",
              sessionID: event.data.sessionID,
              text: event.data.text,
              time: { created: event.data.timestamp },
            })
          })
          break
        case "session.next.shell.started":
          message.update(event.data.sessionID, (draft) => {
            message.prepend(draft, {
              id: event.data.messageID,
              type: "shell",
              callID: event.data.callID,
              command: event.data.command,
              output: "",
              time: { created: event.data.timestamp },
            })
          })
          break
        case "session.next.shell.ended":
          message.update(event.data.sessionID, (draft) => {
            const match = message.activeShell(draft, event.data.callID)
            if (!match) return
            match.output = event.data.output
            match.time.completed = event.data.timestamp
          })
          break
        case "session.next.step.started":
          message.update(event.data.sessionID, (draft) => {
            if (draft.some((message) => message.id === event.data.assistantMessageID)) return
            const currentAssistant = message.activeAssistant(draft)
            if (currentAssistant) currentAssistant.time.completed = event.data.timestamp
            message.prepend(draft, {
              id: event.data.assistantMessageID,
              type: "assistant",
              agent: event.data.agent,
              model: event.data.model,
              content: [],
              snapshot: event.data.snapshot ? { start: event.data.snapshot } : undefined,
              time: { created: event.data.timestamp },
            })
          })
          break
        case "session.next.step.ended":
          message.update(event.data.sessionID, (draft) => {
            const currentAssistant = message.assistant(draft, event.data.assistantMessageID)
            if (!currentAssistant) return
            currentAssistant.time.completed = event.data.timestamp
            currentAssistant.finish = event.data.finish
            currentAssistant.cost = event.data.cost
            currentAssistant.tokens = event.data.tokens
            if (event.data.snapshot)
              currentAssistant.snapshot = { ...currentAssistant.snapshot, end: event.data.snapshot }
          })
          break
        case "session.next.step.failed":
          message.update(event.data.sessionID, (draft) => {
            const currentAssistant = message.assistant(draft, event.data.assistantMessageID)
            if (!currentAssistant) return
            currentAssistant.time.completed = event.data.timestamp
            currentAssistant.finish = "error"
            currentAssistant.error = event.data.error
          })
          break
        case "session.next.text.started":
          message.update(event.data.sessionID, (draft) => {
            const assistant = message.assistant(draft, event.data.assistantMessageID)
            if (!assistant || message.latestText(assistant, event.data.textID)) return
            assistant.content.push({
              type: "text",
              id: event.data.textID,
              text: "",
            })
          })
          break
        case "session.next.text.delta":
          message.update(event.data.sessionID, (draft) => {
            const match = message.latestText(message.assistant(draft, event.data.assistantMessageID), event.data.textID)
            if (match) match.text += event.data.delta
          })
          break
        case "session.next.text.ended":
          message.update(event.data.sessionID, (draft) => {
            const match = message.latestText(message.assistant(draft, event.data.assistantMessageID), event.data.textID)
            if (match) match.text = event.data.text
          })
          break
        case "session.next.tool.input.started":
          message.update(event.data.sessionID, (draft) => {
            const assistant = message.assistant(draft, event.data.assistantMessageID)
            if (!assistant || message.latestTool(assistant, event.data.callID)) return
            assistant.content.push({
              type: "tool",
              id: event.data.callID,
              name: event.data.name,
              time: { created: event.data.timestamp },
              state: { status: "pending", input: "" },
            })
          })
          break
        case "session.next.tool.input.delta":
          message.update(event.data.sessionID, (draft) => {
            const match = message.latestTool(message.assistant(draft, event.data.assistantMessageID), event.data.callID)
            if (match?.state.status === "pending") match.state.input += event.data.delta
          })
          break
        case "session.next.tool.input.ended":
          message.update(event.data.sessionID, (draft) => {
            const match = message.latestTool(message.assistant(draft, event.data.assistantMessageID), event.data.callID)
            if (match?.state.status === "pending") match.state.input = event.data.text
          })
          break
        case "session.next.tool.called":
          message.update(event.data.sessionID, (draft) => {
            const match = message.latestTool(message.assistant(draft, event.data.assistantMessageID), event.data.callID)
            if (!match || match.state.status === "completed" || match.state.status === "error") return
            match.time.ran = event.data.timestamp
            match.provider = event.data.provider
            match.state = { status: "running", input: event.data.input, structured: {}, content: [] }
          })
          break
        case "session.next.tool.progress":
          message.update(event.data.sessionID, (draft) => {
            const match = message.latestTool(message.assistant(draft, event.data.assistantMessageID), event.data.callID)
            if (match?.state.status !== "running") return
            match.state.structured = event.data.structured
            match.state.content = [...event.data.content]
          })
          break
        case "session.next.tool.success":
          message.update(event.data.sessionID, (draft) => {
            const match = message.latestTool(message.assistant(draft, event.data.assistantMessageID), event.data.callID)
            if (!match) return
            const state = match.state
            match.state = {
              status: "completed",
              input: typeof state.input === "string" ? {} : state.input,
              structured: event.data.structured,
              content: [...event.data.content],
              result: event.data.result,
            }
            match.provider = {
              executed: event.data.provider.executed || match.provider?.executed === true,
              metadata: match.provider?.metadata,
              resultMetadata: event.data.provider.metadata,
            }
            match.time.completed = event.data.timestamp
          })
          break
        case "session.next.tool.failed":
          message.update(event.data.sessionID, (draft) => {
            const match = message.latestTool(message.assistant(draft, event.data.assistantMessageID), event.data.callID)
            if (!match) return
            const state = match.state
            match.state = {
              status: "error",
              error: event.data.error,
              input: typeof state.input === "string" ? {} : state.input,
              structured: state.status === "pending" ? {} : state.structured,
              content: state.status === "pending" ? [] : state.content,
              result: event.data.result,
            }
            match.provider = {
              executed: event.data.provider.executed || match.provider?.executed === true,
              metadata: match.provider?.metadata,
              resultMetadata: event.data.provider.metadata,
            }
            match.time.completed = event.data.timestamp
          })
          break
        case "session.next.reasoning.started":
          message.update(event.data.sessionID, (draft) => {
            const assistant = message.assistant(draft, event.data.assistantMessageID)
            if (!assistant || message.latestReasoning(assistant, event.data.reasoningID)) return
            assistant.content.push({
              type: "reasoning",
              id: event.data.reasoningID,
              text: "",
              providerMetadata: event.data.providerMetadata,
            })
          })
          break
        case "session.next.reasoning.delta":
          message.update(event.data.sessionID, (draft) => {
            const match = message.latestReasoning(
              message.assistant(draft, event.data.assistantMessageID),
              event.data.reasoningID,
            )
            if (match) match.text += event.data.delta
          })
          break
        case "session.next.reasoning.ended":
          message.update(event.data.sessionID, (draft) => {
            const match = message.latestReasoning(
              message.assistant(draft, event.data.assistantMessageID),
              event.data.reasoningID,
            )
            if (match) {
              match.text = event.data.text
              if (event.data.providerMetadata !== undefined) match.providerMetadata = event.data.providerMetadata
            }
          })
          break
        case "session.next.retried":
        case "session.next.compaction.started":
        case "session.next.compaction.delta":
          break
        case "session.next.compaction.ended":
          message.update(event.data.sessionID, (draft) => {
            message.prepend(draft, {
              id: event.data.messageID,
              type: "compaction",
              reason: event.data.reason,
              summary: event.data.text,
              recent: event.data.recent,
              time: { created: event.data.timestamp },
            })
          })
          break
        case "reference.updated":
          void result.location.reference.refresh()
          break
        case "integration.updated":
          void Promise.all([
            result.location.integration.refresh(event.location),
            result.location.model.refresh(event.location),
            result.location.provider.refresh(event.location),
          ])
          break
      }
    }

    const result = {
      session: {
        get(sessionID: string) {
          return store.session.info[sessionID]
        },
        async refresh(sessionID: string) {
          const session = await sdk.native.sessions.get({ sessionID })
          setStore("session", "info", sessionID, mutable<SessionV2Info>(session))
        },
        message: {
          list(sessionID: string) {
            return store.session.message[sessionID]
          },
          async refresh(sessionID: string) {
            const result = await sdk.native.messages.list({ sessionID })
            setStore("session", "message", sessionID, mutable<SessionMessage[]>(result.data))
          },
        },
        permission: {
          list(sessionID: string) {
            return store.session.permission[sessionID]
          },
          async refresh(sessionID: string) {
            const permissions = await sdk.native.permissions.list({ sessionID })
            setStore("session", "permission", sessionID, mutable<PermissionV2Request[]>(permissions))
          },
        },
        question: {
          list(sessionID: string) {
            return store.session.question[sessionID]
          },
          async refresh(sessionID: string) {
            const questions = await sdk.native.questions.list({ sessionID })
            setStore("session", "question", sessionID, mutable<QuestionV2Request[]>(questions))
          },
        },
      },
      project: {
        permission: {
          list(projectID: string) {
            return store.project.permission[projectID]
          },
          async refresh(projectID: string) {
            const permissions = await sdk.native.permissions.listSaved({ projectID })
            setStore("project", "permission", projectID, mutable<PermissionSavedInfo[]>(permissions))
          },
        },
      },
      location: {
        default() {
          return defaultLocation()
        },
        async refresh(ref?: LocationRef) {
          const location = await sdk.native.location.get({ location: locationQuery(ref) })
          const key = locationKey(location)
          if (!store.location[key]) setStore("location", key, {})
          if (!ref) setDefaultLocation({ directory: location.directory, workspaceID: location.workspaceID })
        },
        agent: {
          list(location?: LocationRef) {
            return store.location[locationKey(location ?? defaultLocation())]?.agent
          },
          async refresh(ref?: LocationRef) {
            const result = await sdk.native.agents.list({ location: locationQuery(ref) })
            const key = locationKey(result.location)
            setStore("location", key, "agent", mutable<AgentV2Info[]>(result.data))
          },
        },
        command: {
          list(location?: LocationRef) {
            return store.location[locationKey(location ?? defaultLocation())]?.command
          },
          async refresh(ref?: LocationRef) {
            const result = await sdk.native.commands.list({ location: locationQuery(ref) })
            const key = locationKey(result.location)
            setStore("location", key, "command", mutable<CommandV2Info[]>(result.data))
          },
        },
        integration: {
          list(location?: LocationRef) {
            return store.location[locationKey(location ?? defaultLocation())]?.integration
          },
          async refresh(ref?: LocationRef) {
            const result = await sdk.native.integrations.list({ location: locationQuery(ref) })
            const key = locationKey(result.location)
            setStore("location", key, "integration", mutable<IntegrationInfo[]>(result.data))
          },
        },
        model: {
          list(location?: LocationRef) {
            return store.location[locationKey(location ?? defaultLocation())]?.model
          },
          async refresh(ref?: LocationRef) {
            const result = await sdk.native.models.list({ location: locationQuery(ref) })
            const key = locationKey(result.location)
            setStore("location", key, "model", mutable<ModelV2Info[]>(result.data))
          },
        },
        provider: {
          list(location?: LocationRef) {
            return store.location[locationKey(location ?? defaultLocation())]?.provider
          },
          async refresh(ref?: LocationRef) {
            const result = await sdk.native.providers.list({ location: locationQuery(ref) })
            const key = locationKey(result.location)
            setStore("location", key, "provider", mutable<ProviderV2Info[]>(result.data))
          },
        },
        reference: {
          list(location?: LocationRef) {
            return store.location[locationKey(location ?? defaultLocation())]?.reference
          },
          async refresh(ref?: LocationRef) {
            const result = await sdk.native.references.list({ location: locationQuery(ref) })
            const key = locationKey(result.location)
            setStore("location", key, "reference", mutable<ReferenceInfo[]>(result.data))
          },
        },
        skill: {
          list(location?: LocationRef) {
            return store.location[locationKey(location ?? defaultLocation())]?.skill
          },
          async refresh(ref?: LocationRef) {
            const result = await sdk.native.skills.list({ location: locationQuery(ref) })
            const key = locationKey(result.location)
            setStore("location", key, "skill", mutable<SkillV2Info[]>(result.data))
          },
        },
      },
    }

    const loadedSessions = () => [
      ...new Set([
        ...Object.keys(store.session.info),
        ...Object.keys(store.session.message),
        ...Object.keys(store.session.permission),
        ...Object.keys(store.session.question),
      ]),
    ]

    const rebuild = async () => {
      const tasks: Array<{ resource: string; promise: Promise<unknown> }> = []
      for (const sessionID of loadedSessions()) {
        if (store.session.info[sessionID])
          tasks.push({ resource: `Session info (${sessionID})`, promise: result.session.refresh(sessionID) })
        if (store.session.message[sessionID])
          tasks.push({ resource: `Session messages (${sessionID})`, promise: result.session.message.refresh(sessionID) })
        if (store.session.permission[sessionID])
          tasks.push({
            resource: `Session permissions (${sessionID})`,
            promise: result.session.permission.refresh(sessionID),
          })
        if (store.session.question[sessionID])
          tasks.push({
            resource: `Session questions (${sessionID})`,
            promise: result.session.question.refresh(sessionID),
          })
      }
      for (const projectID of Object.keys(store.project.permission))
        tasks.push({
          resource: `Project permissions (${projectID})`,
          promise: result.project.permission.refresh(projectID),
        })
      for (const [key, data] of Object.entries(store.location)) {
        const location = locationFromKey(key)
        tasks.push({ resource: `Location catalog (${key})`, promise: result.location.refresh(location) })
        if (data.agent)
          tasks.push({ resource: `Location agent catalog (${key})`, promise: result.location.agent.refresh(location) })
        if (data.command)
          tasks.push({
            resource: `Location command catalog (${key})`,
            promise: result.location.command.refresh(location),
          })
        if (data.integration)
          tasks.push({
            resource: `Location integration catalog (${key})`,
            promise: result.location.integration.refresh(location),
          })
        if (data.model)
          tasks.push({ resource: `Location model catalog (${key})`, promise: result.location.model.refresh(location) })
        if (data.provider)
          tasks.push({
            resource: `Location provider catalog (${key})`,
            promise: result.location.provider.refresh(location),
          })
        if (data.reference)
          tasks.push({
            resource: `Location reference catalog (${key})`,
            promise: result.location.reference.refresh(location),
          })
        if (data.skill)
          tasks.push({ resource: `Location skill catalog (${key})`, promise: result.location.skill.refresh(location) })
      }
      const failures = (await Promise.allSettled(tasks.map((task) => task.promise))).flatMap((item, index) =>
        item.status === "rejected"
          ? [new Error(`Failed to rebuild ${tasks[index]!.resource}`, { cause: item.reason })]
          : [],
      )
      if (failures.length > 0)
        throw new AggregateError(failures, "Failed to rebuild native TUI state")
    }

    const recovery = createNativeEventRecovery({
      dispatch: handleEvent,
      sessions: loadedSessions,
      async replay(sessionID, after) {
        const page = await sdk.native.sessions.history({ sessionID, after, limit: 100 })
        return { data: page.data.map((event) => mutable<V2Event>(event)), hasMore: page.hasMore }
      },
      rebuild,
      onError(error) {
        console.error("Failed to recover native event state", error)
      },
    })

    onMount(() => {
      const unsub = nativeEvent.subscribe((event) => recovery.accept(mutable<V2Event>(event)))
      onCleanup(() => {
        unsub()
        recovery.dispose()
      })
    })

    onMount(() => {
      void Promise.allSettled([
        result.location.refresh(),
        result.location.agent.refresh(),
        result.location.integration.refresh(),
        result.location.model.refresh(),
        result.location.provider.refresh(),
        result.location.reference.refresh(),
        result.location.command.refresh(),
        result.location.skill.refresh(),
      ]).then((settled) => {
        for (const failure of settled.filter((item) => item.status === "rejected"))
          console.error("Failed to refresh default location data", failure.reason)
      })
    })

    return result
  },
})
