import { describe, expect } from "bun:test"
import { Auth } from "@/auth"
import { AuthCredentialMigration } from "@/auth/credential-migration"
import { Credential } from "@opencode-ai/core/credential"
import { Integration } from "@opencode-ai/schema/integration"
import { Effect, Layer } from "effect"
import { testEffect } from "../lib/effect"

function testLayer(input: {
  legacy: Record<string, Auth.Info>
  existing?: Credential.Info[]
  created: Credential.Info[]
}) {
  return Layer.mergeAll(
    Layer.mock(Auth.Service, {
      all: () => Effect.succeed(input.legacy),
    }),
    Layer.mock(Credential.Service, {
      all: () => Effect.succeed(input.existing ?? []),
      create: (value) =>
        Effect.sync(() => {
          const credential = new Credential.Info({
            id: Credential.ID.create(),
            label: value.label ?? "default",
            ...value,
          })
          input.created.push(credential)
          return credential
        }),
    }),
  )
}

describe("AuthCredentialMigration", () => {
  const created: Credential.Info[] = []
  const it = testEffect(
    testLayer({
      legacy: {
        custom: new Auth.Api({ type: "api", key: "legacy-secret", metadata: { tenant: "acme" } }),
        oauth: new Auth.Oauth({ type: "oauth", refresh: "refresh", access: "access", expires: 1 }),
      },
      created,
    }),
  )

  it.live("migrates legacy API keys and ignores unsupported credential shapes", () =>
    Effect.gen(function* () {
      yield* AuthCredentialMigration.migrate()
      expect(created).toHaveLength(1)
      expect(created[0]?.integrationID).toBe(Integration.ID.make("custom"))
      expect(created[0]?.label).toBe("custom")
      expect(created[0]?.value).toEqual({
        type: "key",
        key: "legacy-secret",
        metadata: { tenant: "acme" },
      })
    }),
  )

  const preserved: Credential.Info[] = []
  const existing = new Credential.Info({
    id: Credential.ID.create(),
    integrationID: Integration.ID.make("custom"),
    label: "native",
    value: Credential.Key.make({ type: "key", key: "native-secret" }),
  })
  const preserve = testEffect(
    testLayer({
      legacy: { custom: new Auth.Api({ type: "api", key: "legacy-secret" }) },
      existing: [existing],
      created: preserved,
    }),
  )

  preserve.live("does not overwrite an existing V2 credential", () =>
    Effect.gen(function* () {
      yield* AuthCredentialMigration.migrate()
      expect(preserved).toEqual([])
    }),
  )
})
