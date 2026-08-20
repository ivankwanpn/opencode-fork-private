import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Credential } from "@opencode-ai/core/credential"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Integration } from "@opencode-ai/core/integration"
import { testEffect } from "./lib/effect"

const it = testEffect(LayerNode.compile(Credential.node))

describe("Credential", () => {
  it.effect("stores, updates, lists, and removes credentials", () =>
    Effect.gen(function* () {
      const credentials = yield* Credential.Service
      const integrationID = Integration.ID.make("openai")
      const created = yield* credentials.create({
        integrationID,
        label: "Work",
        value: Credential.Key.make({ type: "key", key: "secret" }),
      })

      expect(yield* credentials.list(integrationID)).toEqual([created])
      yield* credentials.update(created.id, { label: "Personal" })
      expect((yield* credentials.list(integrationID))[0]?.label).toBe("Personal")

      const replacement = yield* credentials.create({
        integrationID,
        label: "Replacement",
        value: Credential.Key.make({ type: "key", key: "replacement" }),
      })
      expect(yield* credentials.list(integrationID)).toEqual([replacement])

      yield* credentials.remove(replacement.id)
      expect(yield* credentials.list(integrationID)).toEqual([])
    }),
  )

  it.effect("uses canonical transient credentials without persisting them", () =>
    Effect.gen(function* () {
      const credentials = yield* Credential.Service
      const previous = process.env[Credential.CONTENT_ENV]
      const integrationID = Integration.ID.make("https://example.com")
      const transient = new Credential.Info({
        id: Credential.ID.create(),
        integrationID,
        label: "Remote",
        value: Credential.WellKnown.make({ type: "wellknown", key: "TOKEN", token: "secret" }),
      })
      process.env[Credential.CONTENT_ENV] = JSON.stringify([transient])

      yield* Effect.gen(function* () {
        expect(yield* credentials.all()).toEqual([transient])
        expect(yield* credentials.list(integrationID)).toEqual([transient])
        expect(yield* credentials.get(transient.id)).toEqual(transient)
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            if (previous === undefined) delete process.env[Credential.CONTENT_ENV]
            else process.env[Credential.CONTENT_ENV] = previous
          }),
        ),
      )
    }),
  )

  it.effect("fails closed when canonical transient credential content is malformed", () =>
    Effect.gen(function* () {
      const credentials = yield* Credential.Service
      const integrationID = Integration.ID.make("openai")
      const saved = yield* credentials.create({
        integrationID,
        value: Credential.Key.make({ type: "key", key: "persisted-secret" }),
      })
      const previous = process.env[Credential.CONTENT_ENV]
      process.env[Credential.CONTENT_ENV] = "{invalid"

      yield* Effect.gen(function* () {
        expect(yield* credentials.all()).toEqual([])
        expect(yield* credentials.list(integrationID)).toEqual([])
        expect(yield* credentials.get(saved.id)).toBeUndefined()
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            if (previous === undefined) delete process.env[Credential.CONTENT_ENV]
            else process.env[Credential.CONTENT_ENV] = previous
          }),
        ),
      )
    }),
  )
})
