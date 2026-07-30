import { describe, expect } from "bun:test"
import { BackgroundJob } from "@opencode-ai/core/background-job"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Deferred, Effect, Exit, Fiber, Scope } from "effect"
import { it } from "./lib/effect"

const jobsLayer = LayerNode.compile(BackgroundJob.node)

describe("BackgroundJob", () => {
  it.live("returns a discriminated missing outcome for an unknown job", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      expect(yield* jobs.wait({ id: "missing-job" })).toEqual({ outcome: "missing", timedOut: false })
    }).pipe(Effect.provide(jobsLayer)),
  )

  it.live("returns a missing outcome for an unknown promotion wait instead of hanging forever", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      expect(yield* jobs.waitForPromotion("missing-job")).toBeUndefined()
    }).pipe(Effect.provide(jobsLayer)),
  )

  it.live("returns undefined for completed jobs instead of hanging on promotion", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const job = yield* jobs.start({
        type: "test",
        run: Effect.succeed("done"),
      })

      yield* jobs.wait({ id: job.id })
      expect(yield* jobs.waitForPromotion(job.id)).toBeUndefined()
    }).pipe(Effect.provide(jobsLayer)),
  )

  it.live("returns the running snapshot immediately for background jobs", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const job = yield* jobs.start({
        type: "test",
        metadata: { background: true },
        run: Effect.never,
      })

      expect(yield* jobs.waitForPromotion(job.id)).toMatchObject({
        id: job.id,
        status: "running",
        metadata: { background: true },
      })
      yield* jobs.cancel(job.id)
    }).pipe(Effect.provide(jobsLayer)),
  )

  it.live("waits for foreground jobs to promote before resolving", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const ready = yield* Deferred.make<void>()
      const job = yield* jobs.start({
        type: "test",
        run: Deferred.await(ready).pipe(Effect.as("done")),
      })
      const waiting = yield* jobs.waitForPromotion(job.id).pipe(Effect.forkChild)

      yield* Effect.yieldNow
      expect(yield* jobs.promote(job.id)).toMatchObject({
        id: job.id,
        status: "running",
        metadata: { background: true },
      })
      expect(yield* Fiber.join(waiting)).toMatchObject({
        id: job.id,
        status: "running",
        metadata: { background: true },
      })

      yield* Deferred.succeed(ready, undefined)
      yield* jobs.wait({ id: job.id })
    }).pipe(Effect.provide(jobsLayer)),
  )

  it.live("tracks process-local work through explicit observation", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const latch = yield* Deferred.make<void>()
      const job = yield* jobs.start({
        type: "test",
        metadata: { durable: false },
        run: Deferred.await(latch).pipe(Effect.as("done")),
      })

      expect(job).toMatchObject({ type: "test", status: "running", metadata: { durable: false } })
      expect(yield* jobs.wait({ id: job.id, timeout: 0 })).toMatchObject({
        timedOut: true,
        info: { status: "running" },
      })

      yield* Deferred.succeed(latch, undefined)
      expect(yield* jobs.wait({ id: job.id })).toMatchObject({
        timedOut: false,
        info: { status: "completed", output: "done" },
      })
    }).pipe(Effect.provide(jobsLayer)),
  )

  it.live("publishes jobs before starting immediately settling work", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service

      yield* Effect.forEach(Array.from({ length: 100 }), (_, index) => {
        const id = `job_immediate_start_${index}`
        return Effect.gen(function* () {
          const job = yield* jobs.start({
            id,
            type: "test",
            run: jobs
              .get(id)
              .pipe(
                Effect.flatMap((info) =>
                  info?.status === "running"
                    ? Effect.succeed(`done-${index}`)
                    : Effect.fail("job started before publish"),
                ),
              ),
          })

          expect(yield* jobs.wait({ id: job.id })).toMatchObject({
            timedOut: false,
            info: { status: "completed", output: `done-${index}` },
          })
        })
      })
    }).pipe(Effect.provide(jobsLayer)),
  )

  it.live("increments pending work before starting immediately settling extensions", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service

      yield* Effect.forEach(Array.from({ length: 100 }), (_, index) =>
        Effect.gen(function* () {
          const first = yield* Deferred.make<void>()
          const job = yield* jobs.start({
            type: "test",
            run: Deferred.await(first).pipe(Effect.as(`first-${index}`)),
          })

          expect(yield* jobs.extend({ id: job.id, run: Effect.succeed(`second-${index}`) })).toBe(true)
          expect((yield* jobs.get(job.id))?.status).toBe("running")

          yield* Deferred.succeed(first, undefined)
          expect(yield* jobs.wait({ id: job.id })).toMatchObject({
            timedOut: false,
            info: { status: "completed", output: `second-${index}` },
          })
        }),
      )
    }).pipe(Effect.provide(jobsLayer)),
  )

  it.live("keeps later accepted runs alive after an earlier queued run fails", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const first = yield* Deferred.make<void>()
      const job = yield* jobs.start({
        id: "failed-queued-run",
        type: "test",
        run: Deferred.await(first).pipe(Effect.andThen(Effect.fail("first failed"))),
      })

      expect(yield* jobs.extend({ id: job.id, run: Effect.succeed("second") })).toBe(true)
      yield* Deferred.succeed(first, undefined)

      expect(yield* jobs.wait({ id: job.id })).toMatchObject({
        timedOut: false,
        info: { status: "completed", output: "second" },
      })
    }).pipe(Effect.provide(jobsLayer)),
  )

  it.live("queues a later start for an already running job instead of dropping it", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const first = yield* Deferred.make<void>()
      const job = yield* jobs.start({ id: "same-running-job", type: "test", run: Deferred.await(first).pipe(Effect.as("first")) })

      expect(
        yield* jobs.start({ id: job.id, type: "test", run: Effect.succeed("second") }),
      ).toMatchObject({ id: job.id, status: "running" })
      yield* Deferred.succeed(first, undefined)

      expect((yield* jobs.wait({ id: job.id })).info?.output).toBe("second")
    }).pipe(Effect.provide(jobsLayer)),
  )

  it.live("does not lose a later start when the existing run settles during admission", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      yield* Effect.forEach(Array.from({ length: 1_000 }), (_, index) =>
        Effect.gen(function* () {
          const id = `settling-start-race-${index}`
          const first = yield* Deferred.make<void>()
          const job = yield* jobs.start({
            id,
            type: "test",
            run: Deferred.await(first).pipe(Effect.as("first")),
          })

          const second = yield* jobs
            .start({ id: job.id, type: "test", run: Effect.succeed("second") })
            .pipe(Effect.forkChild)
          yield* Deferred.succeed(first, undefined)
          yield* Fiber.join(second)

          expect((yield* jobs.wait({ id: job.id })).info?.output).toBe("second")
        }),
      )
    }).pipe(Effect.provide(jobsLayer)),
  )

  it.live("interrupts live work without promising settlement after the owning process-local scope closes", () =>
    Effect.gen(function* () {
      const scope = yield* Scope.make()
      const interrupted = yield* Deferred.make<void>()
      const jobs = yield* BackgroundJob.make.pipe(Scope.provide(scope))
      const job = yield* jobs.start({
        type: "test",
        run: Effect.never.pipe(Effect.ensuring(Deferred.succeed(interrupted, undefined))),
      })

      yield* Scope.close(scope, Exit.void)

      yield* Deferred.await(interrupted).pipe(Effect.timeout("1 second"))
      // The abandoned in-memory registry is not a durable observation channel.
      expect((yield* jobs.get(job.id))?.status).toBe("running")
    }),
  )
})
