export * as SessionRunCoordinator from "./run-coordinator"

import { Deferred, Effect, Exit, Fiber, FiberSet, Schema, Scope } from "effect"

export class Busy extends Schema.TaggedErrorClass<Busy>()("SessionRunCoordinator.Busy", {}) {}

/** Serializes execution for each key while allowing different keys to run concurrently. */
export interface Coordinator<Key, E> {
  /** Snapshots keys with an execution owned by this coordinator. */
  readonly active: Effect.Effect<ReadonlySet<Key>>
  /** Starts execution while idle or joins the active execution. */
  readonly run: (key: Key) => Effect.Effect<void, E>
  /** Runs non-drain work only while idle, sharing ownership and interruption with the drain. */
  readonly exclusive: <E2>(key: Key, work: Effect.Effect<void, E2>) => Effect.Effect<void, E2 | Busy>
  /** Registers one coalesced follow-up after newly recorded work. */
  readonly wake: (key: Key) => Effect.Effect<void>
  /** Waits for current ownership and all registered successors without starting execution. */
  readonly wait: (key: Key) => Effect.Effect<void>
  /** Stops active execution and waits for its cleanup. */
  readonly interrupt: (key: Key) => Effect.Effect<void>
}

type Entry<E> = {
  readonly done: Deferred.Deferred<void, E>
  owner?: Fiber.Fiber<void, never>
  pendingWake: boolean
  stopping: boolean
}

export const make = <Key, E>(options: {
  readonly drain: (key: Key, force: boolean) => Effect.Effect<void, E>
}): Effect.Effect<Coordinator<Key, E>, never, Scope.Scope> =>
  Effect.gen(function* () {
    const active = new Map<Key, Entry<E>>()
    const fork = yield* FiberSet.makeRuntime<never, void, never>()

    const makeEntry = (): Entry<E> => ({
      done: Deferred.makeUnsafe<void, E>(),
      pendingWake: false,
      stopping: false,
    })

    const startEffect = (
      key: Key,
      entry: Entry<E>,
      work: Effect.Effect<void, E>,
      successor = false,
    ) => {
      const ready = Deferred.makeUnsafe<void>()
      const owner = fork(
        (successor ? Effect.yieldNow : Deferred.await(ready)).pipe(
          Effect.andThen(work),
          Effect.onExit((exit) => Effect.sync(() => settle(key, entry, exit))),
          Effect.exit,
          Effect.asVoid,
        ),
      )
      entry.owner = owner
      if (!successor) Deferred.doneUnsafe(ready, Effect.void)
    }

    const start = (key: Key, entry: Entry<E>, force: boolean, successor = false) =>
      startEffect(key, entry, Effect.suspend(() => options.drain(key, force)), successor)

    const settle = (key: Key, entry: Entry<E>, exit: Exit.Exit<void, E>) => {
      if (Exit.isSuccess(exit) && !entry.stopping && entry.pendingWake) {
        entry.pendingWake = false
        start(key, entry, false, true)
        return
      }

      const successor = entry.pendingWake ? makeEntry() : undefined
      if (successor === undefined) active.delete(key)
      else {
        active.set(key, successor)
        start(key, successor, false, true)
      }
      Deferred.doneUnsafe(entry.done, exit)
    }

    const run = (key: Key): Effect.Effect<void, E> =>
      Effect.uninterruptibleMask((restore) => {
        const entry = active.get(key)
        if (entry !== undefined) {
          if (entry.stopping) return restore(Deferred.await(entry.done).pipe(Effect.andThen(run(key))))
          return restore(Deferred.await(entry.done))
        }

        const next = makeEntry()
        active.set(key, next)
        start(key, next, true)
        return restore(Deferred.await(next.done))
      })

    const exclusive = <E2>(key: Key, work: Effect.Effect<void, E2>): Effect.Effect<void, E2 | Busy> =>
      Effect.uninterruptibleMask((restore): Effect.Effect<void, E2 | Busy> => {
        if (active.has(key)) return Effect.fail(new Busy())

        const entry = makeEntry()
        const completed = Deferred.makeUnsafe<void, E2>()
        const ready = Deferred.makeUnsafe<void>()
        active.set(key, entry)
        entry.owner = fork(
          Deferred.await(ready).pipe(
            Effect.andThen(work),
            Effect.onExit((exit) =>
              Effect.sync(() => {
                settle(key, entry, Exit.void)
                Deferred.doneUnsafe(completed, exit)
              }),
            ),
            Effect.exit,
            Effect.asVoid,
          ),
        )
        Deferred.doneUnsafe(ready, Effect.void)
        return restore(Deferred.await(completed))
      })

    const wake = (key: Key) =>
      Effect.sync(() => {
        const entry = active.get(key)
        if (entry !== undefined) {
          entry.pendingWake = true
          return
        }

        const next = makeEntry()
        active.set(key, next)
        start(key, next, false)
      })

    const wait = (key: Key): Effect.Effect<void> =>
      Effect.uninterruptibleMask((restore) => {
        const entry = active.get(key)
        if (entry === undefined) return Effect.void
        return restore(Deferred.await(entry.done)).pipe(
          Effect.exit,
          Effect.andThen(Effect.suspend(() => wait(key))),
        )
      })

    const interrupt = (key: Key): Effect.Effect<void> =>
      Effect.suspend(() => {
        const entry = active.get(key)
        if (entry?.owner === undefined) return Effect.void
        entry.stopping = true
        entry.pendingWake = false
        return Fiber.interrupt(entry.owner)
      })

    return { active: Effect.sync(() => new Set(active.keys())), run, exclusive, wake, wait, interrupt }
  })
