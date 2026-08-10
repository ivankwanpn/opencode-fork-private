import { describe, expect } from "bun:test"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Credential } from "@opencode-ai/core/credential"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Integration } from "@opencode-ai/schema/integration"
import { Auth } from "@/auth"
import { Effect, Layer } from "effect"
import { testEffect } from "../lib/effect"

const writes: Record<string, unknown>[] = []
let legacy: Record<string, unknown> = {
  custom: { type: "api", key: "legacy-custom" },
  openai: { type: "api", key: "stale-openai" },
}
let saved: Credential.Info | undefined = new Credential.Info({
  id: Credential.ID.create(),
  integrationID: Integration.ID.make("openai"),
  label: "default",
  value: Credential.OAuth.make({
    type: "oauth",
    methodID: Integration.MethodID.make("chatgpt-browser"),
    refresh: "refresh-old",
    access: "access-old",
    expires: 1_800_000_000_000,
    metadata: { accountID: "account-old", ignored: 1 },
  }),
})

const fs = Layer.effect(
  FSUtil.Service,
  Effect.gen(function* () {
    const service = yield* FSUtil.Service
    return FSUtil.Service.of({
      ...service,
      readJson: () => Effect.succeed(legacy),
      writeJson: (_file, value) =>
        Effect.sync(() => {
          legacy = value as Record<string, unknown>
          writes.push(legacy)
        }),
    })
  }),
).pipe(Layer.provide(AppNodeBuilder.build(FSUtil.node)))

const credential = Layer.mock(Credential.Service, {
  all: () => Effect.succeed(saved ? [saved] : []),
  update: (_id, updates) =>
    Effect.sync(() => {
      if (!saved) return
      saved = new Credential.Info({
        id: saved.id,
        integrationID: saved.integrationID,
        label: updates.label ?? saved.label,
        value: updates.value ?? saved.value,
      })
    }),
  remove: () =>
    Effect.sync(() => {
      saved = undefined
    }),
})

const it = testEffect(
  AppNodeBuilder.build(Auth.node, [
    [FSUtil.node, fs],
    [Credential.node, credential],
  ]),
)

describe("Auth V2 credential projection", () => {
  it.live("projects, refreshes, and removes a V2 OpenAI OAuth credential", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      const initial = yield* auth.all()

      expect(initial.custom).toMatchObject({ type: "api", key: "legacy-custom" })
      expect(initial.openai).toMatchObject({
        type: "oauth",
        refresh: "refresh-old",
        access: "access-old",
        accountId: "account-old",
      })

      yield* auth.set(
        "openai",
        new Auth.Oauth({
          type: "oauth",
          refresh: "refresh-new",
          access: "access-new",
          expires: 1_900_000_000_000,
          accountId: "account-new",
        }),
      )

      expect(writes).toHaveLength(0)
      expect(saved?.value).toMatchObject({
        type: "oauth",
        methodID: Integration.MethodID.make("chatgpt-browser"),
        refresh: "refresh-new",
        access: "access-new",
        metadata: { accountID: "account-new", ignored: 1 },
      })

      yield* auth.remove("openai")

      expect(saved).toBeUndefined()
      expect(writes).toHaveLength(1)
      expect(legacy.openai).toBeUndefined()
      expect(legacy.custom).toEqual({ type: "api", key: "legacy-custom" })
    }),
  )
})
