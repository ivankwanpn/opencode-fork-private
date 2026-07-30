import { Credential } from "@opencode-ai/core/credential"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Integration } from "@opencode-ai/schema/integration"
import { Effect, Layer } from "effect"
import { Auth } from "."

export const migrate = Effect.fn("AuthCredentialMigration.migrate")(function* () {
  const auth = yield* Auth.Service
  const credentials = yield* Credential.Service
  const existing = new Set((yield* credentials.all()).map((item) => item.integrationID))
  const legacy = yield* auth.all()

  yield* Effect.forEach(
    Object.entries(legacy).filter(
      (entry): entry is [string, Auth.Api] =>
        entry[1].type === "api" && !existing.has(Integration.ID.make(entry[0])),
    ),
    ([providerID, value]) =>
      credentials
        .create({
          integrationID: Integration.ID.make(providerID),
          label: providerID,
          value: Credential.Key.make({
            type: "key",
            key: value.key,
            ...(value.metadata === undefined ? {} : { metadata: value.metadata }),
          }),
        })
        .pipe(Effect.asVoid),
  )
})

const layer = Layer.effectDiscard(
  migrate().pipe(Effect.catch(() => Effect.logWarning("failed to migrate legacy API credentials"))),
)

export const node = LayerNode.make({
  name: "auth-credential-migration",
  layer,
  deps: [Auth.node, Credential.node],
})

export * as AuthCredentialMigration from "./credential-migration"
