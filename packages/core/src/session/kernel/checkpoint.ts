export * as Checkpoint from "./checkpoint"

import { Duration, Effect, Ref } from "effect"

/** Flush policy: one elapsed interval or one byte threshold per open part. */
export interface CheckpointPolicy {
  readonly interval: Duration.Input
  readonly bytes: number
}

export const DefaultCheckpointPolicy: CheckpointPolicy = {
  interval: "250 millis",
  bytes: 8192,
}

export type CheckpointKind = "text" | "reasoning" | "tool-input"

/** Incremental content since the previous durable checkpoint for one part. */
export interface PendingCheckpoint {
  readonly kind: CheckpointKind
  readonly key: string
  readonly text: string
}

export interface CheckpointBuffer {
  readonly offer: (kind: CheckpointKind, key: string, chunk: string) => Effect.Effect<void>
  /** Closes a part: remaining incremental content is captured by the next drain. */
  readonly close: (key: string) => Effect.Effect<void>
  /** Returns every pending part's incremental content and clears the buffer. */
  readonly drain: () => Effect.Effect<readonly PendingCheckpoint[]>
  readonly pendingBytes: Effect.Effect<number>
}

interface Entry {
  readonly kind: CheckpointKind
  chunks: string[]
  bytes: number
}

/** Single-owner incremental buffer for text/reasoning/tool-input parts. */
export const makeBuffer = (): Effect.Effect<CheckpointBuffer> =>
  Ref.make(new Map<string, Entry>()).pipe(
    Effect.map((entries) => {
      const entryBytes = (entry: Entry | undefined) => entry?.bytes ?? 0
      return {
        offer: (kind, key, chunk) =>
          Ref.update(entries, (current) => {
            const entry = current.get(key) ?? { kind, chunks: [], bytes: 0 }
            entry.chunks.push(chunk)
            entry.bytes = entry.bytes + Buffer.byteLength(chunk, "utf8")
            current.set(key, entry)
            return current
          }),
        close: (key) =>
          Ref.update(entries, (current) => {
            current.delete(key)
            return current
          }),
        drain: () =>
          Effect.gen(function* () {
            const current = yield* Ref.getAndSet(entries, new Map<string, Entry>())
            return [...current.entries()].map(([key, entry]) => ({
              kind: entry.kind,
              key,
              text: entry.chunks.join(""),
            }))
          }),
        pendingBytes: Ref.get(entries).pipe(
          Effect.map((current) => [...current.values()].reduce((total, entry) => total + entryBytes(entry), 0)),
        ),
      }
    }),
  )
