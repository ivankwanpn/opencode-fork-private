import { BackgroundJob } from "@/background/job"
import { ShareNext } from "@/share/share-next"
import { SessionID } from "@/session/schema"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionV2 } from "@opencode-ai/core/session"
import { Context, Effect, Layer } from "effect"

export interface Interface {
  readonly remove: (sessionID: SessionV2.ID) => Effect.Effect<void, SessionV2.NotFoundError>
  readonly removeDurable: (sessionID: SessionV2.ID) => Effect.Effect<void, SessionV2.NotFoundError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionRemoval") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const background = yield* BackgroundJob.Service
    const session = yield* SessionV2.Service
    const share = yield* ShareNext.Service

    const descendants = Effect.fnUntraced(function* (
      sessionID: SessionV2.ID,
    ): Effect.fn.Return<SessionV2.ID[], SessionV2.NotFoundError> {
      const children = yield* session.children(sessionID)
      const nested = yield* Effect.forEach(children, (child) => descendants(child.id), {
        concurrency: "unbounded",
      })
      return [...children.map((child) => child.id), ...nested.flat()]
    })

    const stage = Effect.fnUntraced(function* (sessionID: SessionV2.ID) {
      const sessionIDs = [sessionID, ...(yield* descendants(sessionID))]
      // Fail closed: without durable credentials, deleting the local Session
      // could permanently orphan a remote share.
      yield* share.stageRemovals(sessionIDs.map((id) => SessionID.make(id)))
      return sessionIDs
    })

    const removeDurable = Effect.fn("SessionRemoval.removeDurable")(function* (sessionID: SessionV2.ID) {
      yield* stage(sessionID)
      yield* session.remove(sessionID)
    })

    const remove = Effect.fn("SessionRemoval.remove")(function* (sessionID: SessionV2.ID) {
      const sessionIDs = yield* stage(sessionID)
      yield* Effect.forEach(sessionIDs, (id) => cancelJobs(background, SessionID.make(id)), {
        concurrency: "unbounded",
        discard: true,
      })
      yield* session.remove(sessionID)
      yield* share.revokePending({ sessionIDs: sessionIDs.map((id) => SessionID.make(id)) })
    })

    return Service.of({ remove, removeDurable })
  }),
)

const cancelJobs = Effect.fn("SessionRemoval.cancelJobs")(function* (
  background: BackgroundJob.Interface,
  sessionID: SessionID,
) {
  const jobs = yield* background.list()
  yield* Effect.forEach(
    jobs.filter((job) => {
      if (job.status !== "running") return false
      if (job.id === sessionID) return true
      if (job.metadata?.sessionId === sessionID) return true
      return job.metadata?.parentSessionId === sessionID
    }),
    (job) => background.cancel(job.id),
    { concurrency: "unbounded", discard: true },
  )
})

export const node = LayerNode.make({
  service: Service,
  layer,
  deps: [BackgroundJob.node, SessionV2.node, ShareNext.node],
})

export * as SessionRemoval from "./removal"
