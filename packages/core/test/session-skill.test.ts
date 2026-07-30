import path from "path"
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { AgentV2 } from "@opencode-ai/core/agent"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Database } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
import { Location } from "@opencode-ai/core/location"
import { MCP } from "@opencode-ai/core/mcp"
import { LocationServiceMap } from "@opencode-ai/core/location-service-map"
import { buildLocationServiceMap } from "@opencode-ai/core/location-services"
import { ProjectV2 } from "@opencode-ai/core/project"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionStore } from "@opencode-ai/core/session/store"
import { SkillV2 } from "@opencode-ai/core/skill"
import { testEffect } from "./lib/effect"

const location = Location.Ref.make({ directory: AbsolutePath.make(process.cwd()) })
const review = SkillV2.Info.make({
  name: "review",
  description: "Review code",
  location: AbsolutePath.make(path.join(process.cwd(), "review.md")),
  content: "# Review\n\nInspect correctness.",
})
const allowedAgent = AgentV2.Info.make({
  id: AgentV2.ID.make("build"),
  request: { headers: {}, body: {} },
  mode: "all",
  hidden: false,
  permissions: [{ action: "skill", resource: "*", effect: "allow" }],
})

let currentAgent: AgentV2.Info | undefined = allowedAgent
let currentSkills: SkillV2.Info[] = [review]
const wakes: SessionV2.ID[] = []

const projects = Layer.succeed(
  ProjectV2.Service,
  ProjectV2.Service.of({
    resolve: (directory) => Effect.succeed({ id: ProjectV2.ID.global, directory }),
    directories: () => Effect.succeed([]),
    commit: () => Effect.void,
  }),
)

const agents = Layer.succeed(
  AgentV2.Service,
  AgentV2.Service.of({
    transform: (_transform) => Effect.succeed({ dispose: Effect.void }),
    reload: () => Effect.void,
    get: (id) => Effect.succeed(currentAgent?.id === id ? currentAgent : undefined),
    default: () => Effect.succeed(currentAgent),
    resolve: (id) => Effect.succeed(id === undefined || currentAgent?.id === id ? currentAgent : undefined),
    select: (id) => {
      const selected = AgentV2.ID.make(id ?? currentAgent?.id ?? AgentV2.defaultID)
      return Effect.succeed({
        id: selected,
        info: currentAgent?.id === selected ? currentAgent : undefined,
      })
    },
    all: () => Effect.succeed(currentAgent ? [currentAgent] : []),
  }),
)

const skills = Layer.succeed(
  SkillV2.Service,
  SkillV2.Service.of({
    transform: (_transform) => Effect.succeed({ dispose: Effect.void }),
    reload: () => Effect.void,
    sources: () => Effect.succeed([]),
    list: () => Effect.succeed(currentSkills),
  }),
)

const execution = Layer.succeed(
  SessionExecution.Service,
  SessionExecution.Service.of({
    active: Effect.succeed(new Set<SessionV2.ID>()),
    resume: () => Effect.void,
    exclusive: (_sessionID, work) => work,
    wake: (sessionID) => Effect.sync(() => wakes.push(sessionID)),
    wait: () => Effect.void,
    interrupt: () => Effect.void,
  }),
)

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, EventV2.node, SessionProjector.node, SessionStore.node, SessionV2.node]),
    [
      [ProjectV2.node, projects],
      [
        LocationServiceMap.node,
        buildLocationServiceMap([
          [MCP.node, MCP.emptyLayer],
          [AgentV2.node, agents],
          [SkillV2.node, skills],
          [SessionExecution.node, SessionExecution.noopLayer],
        ]),
      ],
      [SessionExecution.node, execution],
    ],
  ),
)

const setup = Effect.gen(function* () {
  currentAgent = allowedAgent
  currentSkills = [review]
  wakes.length = 0
  const sessions = yield* SessionV2.Service
  const session = yield* sessions.create({ location, agent: allowedAgent.id })
  return { sessions, session }
})

describe("SessionV2.skill", () => {
  it.effect("injects model-facing skill content as one replayable synthetic message", () =>
    Effect.gen(function* () {
      const { sessions, session } = yield* setup
      const eventID = EventV2.ID.create()
      const text = SkillV2.toModelOutput(review, [])

      yield* sessions.skill({
        id: eventID,
        sessionID: session.id,
        skill: review.name,
        resume: false,
      })

      expect(yield* sessions.context(session.id)).toMatchObject([
        {
          type: "synthetic",
          sessionID: session.id,
          text,
        },
      ])
      expect(
        (yield* sessions.history({ sessionID: session.id, limit: 10 })).events
          .filter((event) => event.type === SessionEvent.Synthetic.type)
          .map((event) => [event.id, event.data.text]),
      ).toEqual([[eventID, text]])
      expect(wakes).toEqual([])
    }),
  )

  it.effect("schedules a non-forced drain by default", () =>
    Effect.gen(function* () {
      const { sessions, session } = yield* setup

      yield* sessions.skill({ sessionID: session.id, skill: review.name })

      expect(wakes).toEqual([session.id])
    }),
  )

  it.effect("hides skills denied by the selected agent", () =>
    Effect.gen(function* () {
      const { sessions, session } = yield* setup
      currentAgent = AgentV2.Info.make({
        ...allowedAgent,
        permissions: [{ action: "skill", resource: review.name, effect: "deny" }],
      })

      expect(yield* sessions.skill({ sessionID: session.id, skill: review.name }).pipe(Effect.flip)).toMatchObject({
        _tag: "Session.SkillNotFoundError",
        sessionID: session.id,
        skill: review.name,
        available: [],
      })
      expect(yield* sessions.context(session.id)).toEqual([])
      expect(wakes).toEqual([])
    }),
  )

  it.effect("returns the permission-filtered catalog for a missing skill", () =>
    Effect.gen(function* () {
      const { sessions, session } = yield* setup

      expect(
        yield* sessions.skill({ sessionID: session.id, skill: "missing", resume: false }).pipe(Effect.flip),
      ).toMatchObject({
        _tag: "Session.SkillNotFoundError",
        sessionID: session.id,
        skill: "missing",
        available: [review.name],
      })
      expect(yield* sessions.context(session.id)).toEqual([])
      expect(wakes).toEqual([])
    }),
  )
})
