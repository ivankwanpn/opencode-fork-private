import { describe, expect } from "bun:test"
import { BackgroundJob } from "@opencode-ai/core/background-job"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Deferred, Effect, Exit, Fiber } from "effect"
import { it } from "./lib/effect"

const jobsLayer = LayerNode.compile(BackgroundJob.node)

describe("Kernel shell ownership", () => {
  it.live("transfers a long-running foreground shell without killing it", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const started = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const job = yield* jobs.start({
        type: "shell",
        metadata: { callID: "call_shell" },
        run: Deferred.succeed(started, undefined).pipe(Effect.andThen(Deferred.await(release)), Effect.as("output")),
      })
      yield* Deferred.await(started)
      // The turn waiter sees it as foreground; promotion keeps the process.
      const promoted = yield* jobs.promote(job.id)
      expect(promoted).toMatchObject({ id: job.id, status: "running" })
      expect((yield* jobs.get(job.id))?.id).toBe(job.id)
      // The own process keeps the long command; the waiter is done.
      yield* jobs.cancel(job.id)
      expect((yield* jobs.get(job.id))?.status).toBe("cancelled")
    }).pipe(Effect.provide(jobsLayer)),
  )

  it.live("turn interruption cancels only the un-promoted foreground waiter", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const started = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const job = yield* jobs.start({
        type: "shell",
        run: Deferred.succeed(started, undefined).pipe(Effect.andThen(Deferred.await(release)), Effect.as("output")),
      })
      yield* Deferred.await(started)
      const waiting = yield* jobs.waitForPromotion(job.id).pipe(Effect.forkChild)
      yield* Effect.yieldNow
      // Turn interruption kills the foreground waiter only; the owned OS
      // process (job) must survive because the transfer never ran. The bash
      // tool owns the cancel-on-interrupt for the un-promoted case.
      yield* Fiber.interrupt(waiting)
      expect((yield* jobs.get(job.id))?.status).toBe("running")
      yield* jobs.cancel(job.id)
      expect((yield* jobs.get(job.id))?.status).toBe("cancelled")
    }).pipe(Effect.provide(jobsLayer)),
  )
})
