import { NodeHttpServer } from "@effect/platform-node"
import { describe, expect } from "bun:test"
import { Context, Effect, Layer, Option, Ref } from "effect"
import { HttpBody, HttpClient, HttpClientRequest, HttpRouter } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { MoveSession } from "@opencode-ai/core/control-plane/move-session"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { Credential } from "@opencode-ai/core/credential"
import { Integration } from "@opencode-ai/core/integration"
import { Config } from "../../src/config/config"
import { ServerAuth } from "../../src/server/auth"
import { RootHttpApi } from "../../src/server/routes/instance/httpapi/api"
import { controlHandlers } from "../../src/server/routes/instance/httpapi/handlers/control"
import { controlPlaneHandlers } from "../../src/server/routes/instance/httpapi/handlers/control-plane"
import { globalHandlers } from "../../src/server/routes/instance/httpapi/handlers/global"
import { authorizationLayer } from "../../src/server/routes/instance/httpapi/middleware/authorization"
import { schemaErrorLayer } from "../../src/server/routes/instance/httpapi/middleware/schema-error"
import { testEffect } from "../lib/effect"

const input = MoveSession.Input.make({
  sessionID: SessionV2.ID.make("ses_move"),
  destination: { directory: AbsolutePath.make("/destination") },
  moveChanges: true,
})
const called = Ref.makeUnsafe<MoveSession.Input | undefined>(undefined)
const credentialState = Ref.makeUnsafe<Credential.Info[]>([])

const credentialLayer = Layer.mock(Credential.Service)({
  list: (integrationID) =>
    Ref.get(credentialState).pipe(
      Effect.map((credentials) => credentials.filter((credential) => credential.integrationID === integrationID)),
    ),
  create: (input) =>
    Effect.gen(function* () {
      const credential = new Credential.Info({
        id: Credential.ID.create(),
        integrationID: input.integrationID,
        label: input.label ?? "default",
        value: input.value,
      })
      yield* Ref.set(credentialState, [credential])
      return credential
    }),
  remove: (credentialID) =>
    Ref.update(credentialState, (credentials) =>
      credentials.filter((credential) => credential.id !== credentialID),
    ),
})

const apiLayer = HttpRouter.serve(
  HttpApiBuilder.layer(RootHttpApi).pipe(
    Layer.provide([controlHandlers, controlPlaneHandlers, globalHandlers]),
    Layer.provide([authorizationLayer, schemaErrorLayer]),
    // Raw HttpApi routes expose an opaque handler context at the request boundary.
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
    HttpRouter.provideRequest(Layer.succeedContext(Context.empty() as Context.Context<unknown>)),
  ),
  { disableListenLog: true, disableLogger: true },
).pipe(
  Layer.provideMerge(NodeHttpServer.layerTest),
  Layer.provide(credentialLayer),
  Layer.provide(Layer.mock(Config.Service)({})),
  Layer.provide(
    Layer.mock(MoveSession.Service)({
      moveSession: (value) => Ref.set(called, value),
    }),
  ),
  Layer.provide(ServerAuth.Config.configLayer({ password: Option.none(), username: "opencode" })),
)
const it = testEffect(apiLayer)

describe("control-plane HttpApi", () => {
  it.live("moves a session through the root control-plane route", () =>
    Effect.gen(function* () {
      const response = yield* HttpClientRequest.post("/experimental/control-plane/move-session").pipe(
        HttpClientRequest.setBody(HttpBody.jsonUnsafe(input)),
        HttpClient.execute,
      )

      expect(response.status).toBe(204)
      expect(yield* Ref.get(called)).toEqual(input)
    }),
  )

  it.live("updates a legacy OAuth wire payload without losing the V2 method identity", () =>
    Effect.gen(function* () {
      const methodID = Integration.MethodID.make("browser")
      yield* Ref.set(credentialState, [
        new Credential.Info({
          id: Credential.ID.create(),
          integrationID: Integration.ID.make("openai"),
          label: "default",
          value: Credential.OAuth.make({
            type: "oauth",
            methodID,
            refresh: "old-refresh",
            access: "old-access",
            expires: 1,
          }),
        }),
      ])

      const response = yield* HttpClientRequest.put("/auth/openai").pipe(
        HttpClientRequest.setBody(
          HttpBody.jsonUnsafe({
            type: "oauth",
            refresh: "new-refresh",
            access: "new-access",
            expires: 2,
          }),
        ),
        HttpClient.execute,
      )

      expect(response.status).toBe(200)
      expect((yield* Ref.get(credentialState))[0]?.value).toEqual(
        Credential.OAuth.make({
          type: "oauth",
          methodID,
          refresh: "new-refresh",
          access: "new-access",
          expires: 2,
        }),
      )
    }),
  )
})
