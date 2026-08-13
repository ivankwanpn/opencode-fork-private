import { describe, expect } from "bun:test"
import { AgentV2 } from "@opencode-ai/core/agent"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { Location } from "@opencode-ai/core/location"
import { LocationServiceMap } from "@opencode-ai/core/location-service-map"
import type { LocationServices } from "@opencode-ai/core/location-services"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { PermissionSaved } from "@opencode-ai/core/permission/saved"
import { PluginRuntime } from "@opencode-ai/core/plugin/runtime"
import { Project } from "@opencode-ai/core/project"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionStore } from "@opencode-ai/core/session/store"
import { DateTime, Deferred, Effect, Fiber, Layer, LayerMap, Stream } from "effect"
import { requestWorkflowApproval } from "@/session/llm"
import { testEffect } from "../lib/effect"

const directory = AbsolutePath.make("/project")
const sessionID = "ses_workflow"
let sessionPermissions: PermissionV2.Ruleset = []
const locationRef = Location.Ref.make({ directory })

const sessions = new Map<string, SessionV2.Info>()
sessions.set(
  sessionID,
  SessionV2.Info.make({
    id: SessionV2.ID.make(sessionID),
    projectID: Project.ID.global,
    title: "test",
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: DateTime.makeUnsafe(0), updated: DateTime.makeUnsafe(0) },
    location: locationRef,
  }),
)

const sharedSessions = Layer.mock(
  SessionStore.Service,
  {
    get: (id) => Effect.sync(() => sessions.get(id)),
    permissions: () => Effect.sync(() => [...sessionPermissions]),
    latestPrompt: () => Effect.succeed(undefined),
  },
)

const eventLayer = Layer.sync(EventV2.Service, () => {
  const listeners = new Set<EventV2.Subscriber>()
  return EventV2.Service.of({
    publish: (definition, data) =>
      Effect.gen(function* () {
        const event = {
          id: EventV2.ID.create(),
          type: definition.type,
          data,
        } as EventV2.Payload<typeof definition>
        yield* Effect.forEach(listeners, (listener) => listener(event), { discard: true })
        return event
      }),
    subscribe: () => Stream.empty,
    all: () => Stream.empty,
    durable: () => Stream.empty,
    listen: (listener) =>
      Effect.sync(() => {
        listeners.add(listener)
        return Effect.sync(() => void listeners.delete(listener))
      }),
    project: () => Effect.void,
    replay: () => Effect.void,
    replayAll: () => Effect.succeed(undefined),
    remove: () => Effect.void,
    claim: () => Effect.void,
  })
})

function focusedLocationLayer(
  ref: Location.Ref,
  events: EventV2.Interface,
  sessionStore: SessionStore.Interface,
): Layer.Layer<LocationServices> {
  const agent = AgentV2.Info.empty(AgentV2.ID.make("test"))
  const layer = AppNodeBuilder.build(
    LayerNode.group([Location.node, PermissionV2.node]),
    [
      [
        Location.node,
        Layer.succeed(
          Location.Service,
          Location.Service.of({
            directory: ref.directory,
            workspaceID: ref.workspaceID,
            project: { id: Project.ID.global, directory: ref.directory },
          }),
        ),
      ],
      [EventV2.node, Layer.succeed(EventV2.Service, events)],
      [SessionStore.node, Layer.succeed(SessionStore.Service, sessionStore)],
      [
        AgentV2.node,
        Layer.mock(AgentV2.Service, {
          resolve: () => Effect.succeed(agent),
        }),
      ],
      [
        PermissionSaved.node,
        Layer.mock(PermissionSaved.Service, {
          list: () => Effect.succeed([]),
          add: () => Effect.void,
          remove: () => Effect.void,
        }),
      ],
      [
        PluginRuntime.node,
        Layer.mock(PluginRuntime.Service, {
          run: (_name, event) => Effect.succeed(event),
        }),
      ],
    ],
  )

  // LayerMap requires the complete LocationServices output. This focused graph
  // intentionally exposes only Location + PermissionV2; all of PermissionV2's
  // own dependencies were compiled and validated above.
  return layer as unknown as Layer.Layer<LocationServices>
}

const locationMapLayer = Layer.effect(
  LocationServiceMap.Service,
  Effect.gen(function* () {
    const events = yield* EventV2.Service
    const sessionStore = yield* SessionStore.Service
    return yield* LayerMap.make(
      (ref: Location.Ref) => focusedLocationLayer(ref, events, sessionStore),
      { idleTimeToLive: "1 minute" },
    )
  }),
)

const globals = Layer.mergeAll(eventLayer, sharedSessions)
const it = testEffect(locationMapLayer.pipe(Layer.provideMerge(globals)))

const inLocation = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    return yield* effect
  }).pipe(Effect.provide(LocationServiceMap.Service.get(locationRef)))

const startApproval = (message = "{}") =>
  Effect.gen(function* () {
    const events = yield* EventV2.Service
    const asked = yield* Deferred.make<PermissionV2.Request>()
    const unsubscribe = yield* events.listen((event) =>
      event.type === PermissionV2.Event.Asked.type
        ? Deferred.succeed(asked, event.data as PermissionV2.Request).pipe(Effect.asVoid)
        : Effect.void,
    )
    yield* Effect.addFinalizer(() => unsubscribe)
    const fiber = yield* requestWorkflowApproval({
      sessionID,
      approvalTools: [{ name: "deploy", args: message }],
    }).pipe(Effect.forkScoped)
    const request = yield* Deferred.await(asked)
    return { fiber, request }
  })

const reply = (request: PermissionV2.Request, input: Omit<PermissionV2.ReplyInput, "requestID">) =>
  inLocation(
    Effect.gen(function* () {
      const permission = yield* PermissionV2.Service
      yield* permission.reply({ requestID: request.id, ...input })
    }),
  )

describe("workflow tool approval", () => {
  it.effect("approves after the V2 reply arrives", () =>
    Effect.gen(function* () {
      sessionPermissions = []
      const approval = yield* startApproval()
      yield* reply(approval.request, { reply: "once" })
      const result = yield* Fiber.join(approval.fiber)
      expect(result.approved).toBe(true)
    }),
  )

  it.effect("rejects when the user declines", () =>
    Effect.gen(function* () {
      sessionPermissions = []
      const approval = yield* startApproval()
      yield* reply(approval.request, { reply: "reject" })
      const result = yield* Fiber.join(approval.fiber)
      expect(result.approved).toBe(false)
    }),
  )

  it.effect("returns false when the user replies with corrected feedback", () =>
    Effect.gen(function* () {
      sessionPermissions = []
      const approval = yield* startApproval()
      yield* reply(approval.request, { reply: "reject", message: "please scope it" })
      const result = yield* Fiber.join(approval.fiber)
      expect(result.approved).toBe(false)
    }),
  )

  it.effect("returns false when session rules block the action", () =>
    Effect.gen(function* () {
      sessionPermissions = [{ action: "workflow_tool_approval", resource: "*", effect: "deny" }]
      const result = yield* requestWorkflowApproval({
        sessionID,
        approvalTools: [{ name: "deploy", args: "{}" }],
      })
      expect(result.approved).toBe(false)
      yield* inLocation(
        Effect.gen(function* () {
          const permission = yield* PermissionV2.Service
          expect(yield* permission.list()).toEqual([])
        }),
      )
    }),
  )

  it.effect("returns false for a missing session", () =>
    Effect.gen(function* () {
      const result = yield* requestWorkflowApproval({
        sessionID: "ses_missing",
        approvalTools: [],
      })
      expect(result.approved).toBe(false)
    }),
  )
})
