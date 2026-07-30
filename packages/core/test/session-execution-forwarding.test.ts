import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionSchema } from "@opencode-ai/core/session/schema"
import { testEffect } from "./lib/effect"

const sessionID = SessionSchema.ID.make("ses_forwarding")

describe("SessionExecution forwarding", () => {
  const calls: string[] = []
  const target = SessionExecution.Service.of({
    active: Effect.succeed(new Set([sessionID])),
    resume: (id) => Effect.sync(() => calls.push(`resume:${id}`)),
    exclusive: (id, work) => Effect.sync(() => calls.push(`exclusive:${id}`)).pipe(Effect.andThen(work)),
    wake: (id) => Effect.sync(() => calls.push(`wake:${id}`)),
    wait: (id) => Effect.sync(() => calls.push(`wait:${id}`)),
    interrupt: (id) => Effect.sync(() => calls.push(`interrupt:${id}`)),
  })
  const it = testEffect(SessionExecution.forwardingLayer)

  it.effect("delegates every operation through the active V2 drain", () =>
    Effect.gen(function* () {
      calls.length = 0
      const service = yield* SessionExecution.Service
      expect(yield* service.active).toEqual(new Set([sessionID]))
      yield* service.resume(sessionID)
      yield* service.exclusive(sessionID, Effect.void)
      yield* service.wake(sessionID)
      yield* service.wait(sessionID)
      yield* service.interrupt(sessionID)
      expect(calls).toEqual([
        `resume:${sessionID}`,
        `exclusive:${sessionID}`,
        `wake:${sessionID}`,
        `wait:${sessionID}`,
        `interrupt:${sessionID}`,
      ])
    }).pipe(Effect.provideService(SessionExecution.Current, target)),
  )
})
