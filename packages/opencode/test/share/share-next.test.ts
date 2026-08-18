import { beforeEach, describe, expect } from "bun:test"
import { DateTime, Deferred, Effect, Exit, Fiber, Layer, Option } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { httpClient } from "@opencode-ai/core/effect/app-node-platform"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionEvent } from "@opencode-ai/schema/session-event"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"

import { AccessToken, AccountID, OrgID, RefreshToken } from "../../src/account/schema"
import { AccountRepo } from "../../src/account/repo"
import { EventV2Bridge } from "../../src/event-v2-bridge"
import { Session } from "@/session/session"
import type { SessionID } from "../../src/session/schema"
import { ShareNext } from "@/share/share-next"
import { SessionShareRemovalTable, SessionShareRevocationTable, SessionShareTable } from "@opencode-ai/core/share/sql"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { Database } from "@opencode-ai/core/database/database"
import { eq } from "drizzle-orm"
import { provideTmpdirInstance } from "../fixture/fixture"
import { resetDatabase } from "../fixture/db"
import { pollWithTimeout, testEffect } from "../lib/effect"
import { locationServiceMapReplacement } from "../lib/location-service-map"

const env = LayerNode.compile(LayerNode.group([CrossSpawnSpawner.node]))
const it = testEffect(env)

const json = (req: Parameters<typeof HttpClientResponse.fromWeb>[0], body: unknown, status = 200) =>
  HttpClientResponse.fromWeb(
    req,
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  )

const none = HttpClient.make(() => Effect.die("unexpected http call"))

function requestLayer(client: HttpClient.HttpClient) {
  const replacement = [httpClient, Layer.succeed(HttpClient.HttpClient, client)] as const
  return LayerNode.compile(LayerNode.group([ShareNext.node, AccountRepo.node]), [
    replacement,
    [SessionExecution.node, SessionExecution.noopLayer],
    locationServiceMapReplacement,
  ])
}

function integrationLayer(client: HttpClient.HttpClient) {
  const replacement = [httpClient, Layer.succeed(HttpClient.HttpClient, client)] as const
  return LayerNode.compile(
    LayerNode.group([
      ShareNext.node,
      EventV2Bridge.node,
      Session.node,
      SessionProjector.node,
      AccountRepo.node,
      Database.node,
    ]),
    [replacement, [SessionExecution.node, SessionExecution.noopLayer], locationServiceMapReplacement],
  )
}

const share = (id: SessionID) =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    return yield* db
      .select()
      .from(SessionShareTable)
      .where(eq(SessionShareTable.session_id, id))
      .get()
      .pipe(Effect.orDie)
  })

const revocation = (id: SessionID) =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    return yield* db
      .select()
      .from(SessionShareRevocationTable)
      .where(eq(SessionShareRevocationTable.session_id, id))
      .get()
      .pipe(Effect.orDie)
  })

const removal = (id: SessionID) =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    return yield* db
      .select()
      .from(SessionShareRemovalTable)
      .where(eq(SessionShareRemovalTable.session_id, id))
      .get()
      .pipe(Effect.orDie)
  })

const seed = (url: string, org?: string) =>
  AccountRepo.Service.use((repo) =>
    repo.persistAccount({
      id: AccountID.make("account-1"),
      email: "user@example.com",
      url,
      accessToken: AccessToken.make("st_test_token"),
      refreshToken: RefreshToken.make("rt_test_token"),
      expiry: Date.now() + 10 * 60_000,
      orgID: org ? Option.some(OrgID.make(org)) : Option.none(),
    }),
  )

beforeEach(async () => {
  await resetDatabase()
})

describe("ShareNext", () => {
  it.live("request uses legacy share API without active org account", () =>
    provideTmpdirInstance(
      () =>
        ShareNext.Service.use((svc) =>
          Effect.gen(function* () {
            const req = yield* svc.request()

            expect(req.api.create).toBe("/api/share")
            expect(req.api.sync("shr_123")).toBe("/api/share/shr_123/sync")
            expect(req.api.remove("shr_123")).toBe("/api/share/shr_123")
            expect(req.api.data("shr_123")).toBe("/api/share/shr_123/data")
            expect(req.baseUrl).toBe("https://legacy-share.example.com")
            expect(req.headers).toEqual({})
          }),
        ).pipe(Effect.provide(requestLayer(none))),
      { config: { enterprise: { url: "https://legacy-share.example.com" } } },
    ),
  )

  it.live("request uses default URL when no enterprise config", () =>
    provideTmpdirInstance(() =>
      ShareNext.Service.use((svc) =>
        Effect.gen(function* () {
          const req = yield* svc.request()

          expect(req.baseUrl).toBe("https://opncd.ai")
          expect(req.api.create).toBe("/api/share")
          expect(req.headers).toEqual({})
        }),
      ).pipe(Effect.provide(requestLayer(none))),
    ),
  )

  it.live("request uses org share API with auth headers when account is active", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        yield* seed("https://control.example.com", "org-1")

        const req = yield* ShareNext.use.request()

        expect(req.api.create).toBe("/api/shares")
        expect(req.api.sync("shr_123")).toBe("/api/shares/shr_123/sync")
        expect(req.api.remove("shr_123")).toBe("/api/shares/shr_123")
        expect(req.api.data("shr_123")).toBe("/api/shares/shr_123/data")
        expect(req.baseUrl).toBe("https://control.example.com")
        expect(req.headers).toEqual({
          authorization: "Bearer st_test_token",
          "x-org-id": "org-1",
        })
      }).pipe(Effect.provide(requestLayer(none))),
    ),
  )

  it.live("create posts share, persists it, and returns the result", () =>
    provideTmpdirInstance(
      () => {
        const createRequests: HttpClientRequest.HttpClientRequest[] = []
        const client = HttpClient.make((req) => {
          if (req.url.endsWith("/api/share")) {
            createRequests.push(req)
            return Effect.succeed(
              json(req, {
                id: "shr_abc",
                url: "https://legacy-share.example.com/share/abc",
                secret: "sec_123",
              }),
            )
          }
          return Effect.succeed(json(req, { ok: true }))
        })
        return Effect.gen(function* () {
          const session = yield* (yield* Session.Service).create({ title: "test" })

          const result = yield* (yield* ShareNext.Service).create(session.id)

          expect(result.id).toBe("shr_abc")
          expect(result.url).toBe("https://legacy-share.example.com/share/abc")
          expect(result.secret).toBe("sec_123")

          const row = yield* share(session.id)
          expect(row?.id).toBe("shr_abc")
          expect(row?.url).toBe("https://legacy-share.example.com/share/abc")
          expect(row?.secret).toBe("sec_123")

          expect(createRequests).toHaveLength(1)
          expect(createRequests[0].method).toBe("POST")
          expect(createRequests[0].url).toBe("https://legacy-share.example.com/api/share")
        }).pipe(Effect.provide(integrationLayer(client)))
      },
      { config: { enterprise: { url: "https://legacy-share.example.com" } } },
    ),
  )

  it.live("remove deletes the persisted share and calls the delete endpoint", () =>
    provideTmpdirInstance(
      () => {
        const seen: HttpClientRequest.HttpClientRequest[] = []
        const client = HttpClient.make((req) => {
          seen.push(req)
          if (req.method === "POST") {
            return Effect.succeed(
              json(req, {
                id: "shr_abc",
                url: "https://legacy-share.example.com/share/abc",
                secret: "sec_123",
              }),
            )
          }
          return Effect.succeed(HttpClientResponse.fromWeb(req, new Response(null, { status: 200 })))
        })
        return Effect.gen(function* () {
          const session = yield* (yield* Session.Service).create({ title: "test" })
          const service = yield* ShareNext.Service

          yield* service.create(session.id)
          yield* service.remove(session.id)

          expect(yield* share(session.id)).toBeUndefined()
          expect(seen.map((req) => [req.method, req.url])).toEqual([
            ["POST", "https://legacy-share.example.com/api/share"],
            ["DELETE", "https://legacy-share.example.com/api/share/shr_abc"],
          ])
        }).pipe(Effect.provide(integrationLayer(client)))
      },
      { config: { enterprise: { url: "https://legacy-share.example.com" } } },
    ),
  )

  it.live("keeps failed revocations durable and retries success and not-found responses", () =>
    provideTmpdirInstance(
      () => {
        let deletes = 0
        let creates = 0
        const client = HttpClient.make((req) => {
          if (req.method === "POST" && req.url.endsWith("/api/share")) {
            creates += 1
            return Effect.succeed(
              json(req, {
                id: `shr_${creates}`,
                url: `https://legacy-share.example.com/share/${creates}`,
                secret: `sec_${creates}`,
              }),
            )
          }
          if (req.method === "POST") return Effect.succeed(json(req, { ok: true }))
          deletes += 1
          const status = deletes === 1 ? 500 : deletes === 2 ? 200 : 404
          return Effect.succeed(HttpClientResponse.fromWeb(req, new Response(null, { status })))
        })
        return Effect.gen(function* () {
          const sessions = yield* Session.Service
          const service = yield* ShareNext.Service
          const { db } = yield* Database.Service
          const first = yield* sessions.create({ title: "retry revocation" })

          yield* service.create(first.id)
          yield* service.stageRemovals([first.id])
          yield* service.revokePending({ sessionIDs: [first.id] })
          expect(yield* revocation(first.id)).toMatchObject({ id: "shr_1", secret: "sec_1" })
          expect(deletes).toBe(0)

          yield* db.delete(SessionTable).where(eq(SessionTable.id, first.id)).run().pipe(Effect.orDie)
          yield* service.revokePending({ sessionIDs: [first.id] })

          expect(yield* share(first.id)).toBeUndefined()
          expect(yield* revocation(first.id)).toMatchObject({
            session_id: first.id,
            id: "shr_1",
            secret: "sec_1",
            attempt_count: 1,
          })

          yield* service.revokePending({ sessionIDs: [first.id] })
          expect(yield* revocation(first.id)).toBeUndefined()
          expect(yield* removal(first.id)).toBeUndefined()

          const second = yield* sessions.create({ title: "not found revocation" })
          yield* service.create(second.id)
          yield* service.stageRemovals([second.id])
          yield* db.delete(SessionTable).where(eq(SessionTable.id, second.id)).run().pipe(Effect.orDie)
          yield* service.init()

          expect(yield* share(second.id)).toBeUndefined()
          expect(yield* revocation(second.id)).toBeUndefined()
          expect(deletes).toBe(3)
        }).pipe(Effect.provide(integrationLayer(client)))
      },
      { config: { enterprise: { url: "https://legacy-share.example.com" } } },
    ),
  )

  it.live("retains a share created while Session removal is staged and revokes it after the race", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const posted = yield* Deferred.make<void>()
          const release = yield* Deferred.make<void>()
          const deletes: string[] = []
          const client = HttpClient.make((req) => {
            if (req.method === "POST" && req.url.endsWith("/api/share"))
              return Deferred.succeed(posted, undefined).pipe(
                Effect.andThen(Deferred.await(release)),
                Effect.as(
                  json(req, {
                    id: "shr_race",
                    url: "https://legacy-share.example.com/share/race",
                    secret: "sec_race",
                  }),
                ),
              )
            if (req.method === "DELETE") {
              deletes.push(req.url)
              return Effect.succeed(HttpClientResponse.fromWeb(req, new Response(null, { status: 200 })))
            }
            return Effect.succeed(json(req, { ok: true }))
          })

          yield* Effect.gen(function* () {
            const sessions = yield* Session.Service
            const service = yield* ShareNext.Service
            const { db } = yield* Database.Service
            const session = yield* sessions.create({ title: "create removal race" })
            const created = yield* service.create(session.id).pipe(Effect.exit, Effect.forkScoped)

            yield* Deferred.await(posted)
            yield* service.stageRemovals([session.id])
            yield* db.delete(SessionTable).where(eq(SessionTable.id, session.id)).run().pipe(Effect.orDie)
            yield* Deferred.succeed(release, undefined)

            expect(Exit.isFailure(yield* Fiber.join(created))).toBe(true)
            expect(yield* share(session.id)).toBeUndefined()
            expect(yield* revocation(session.id)).toBeUndefined()
            expect(yield* removal(session.id)).toBeUndefined()
            expect(deletes).toEqual(["https://legacy-share.example.com/api/share/shr_race"])
          }).pipe(Effect.provide(integrationLayer(client)))
        }),
      { config: { enterprise: { url: "https://legacy-share.example.com" } } },
    ),
  )

  it.live("retries a failed revocation during the same process lifetime", () =>
    provideTmpdirInstance(
      () => {
        let deletes = 0
        const client = HttpClient.make((req) => {
          if (req.method === "POST" && req.url.endsWith("/api/share"))
            return Effect.succeed(
              json(req, {
                id: "shr_retry",
                url: "https://legacy-share.example.com/share/retry",
                secret: "sec_retry",
              }),
            )
          if (req.method === "DELETE") {
            deletes += 1
            return Effect.succeed(
              HttpClientResponse.fromWeb(req, new Response(null, { status: deletes === 1 ? 500 : 200 })),
            )
          }
          return Effect.succeed(json(req, { ok: true }))
        })
        return Effect.gen(function* () {
          const sessions = yield* Session.Service
          const service = yield* ShareNext.Service
          const { db } = yield* Database.Service
          const session = yield* sessions.create({ title: "bounded retry" })
          yield* service.create(session.id)
          yield* service.stageRemovals([session.id])
          yield* db.delete(SessionTable).where(eq(SessionTable.id, session.id)).run().pipe(Effect.orDie)

          yield* service.revokePending({ sessionIDs: [session.id] })
          expect(yield* revocation(session.id)).toMatchObject({ attempt_count: 1 })
          yield* pollWithTimeout(
            Effect.gen(function* () {
              if (deletes !== 2) return
              return (yield* revocation(session.id)) === undefined ? true : undefined
            }),
            "timed out waiting for the in-process share revocation retry",
            "5 seconds",
          )
          expect(yield* removal(session.id)).toBeUndefined()
        }).pipe(Effect.provide(integrationLayer(client)))
      },
      { config: { enterprise: { url: "https://legacy-share.example.com" } } },
    ),
  )

  it.live("create fails on a non-ok response and does not persist a share", () =>
    provideTmpdirInstance(() => {
      const client = HttpClient.make((req) => Effect.succeed(json(req, { error: "bad" }, 500)))
      return Effect.gen(function* () {
        const session = yield* (yield* Session.Service).create({ title: "test" })

        const exit = yield* ShareNext.Service.use((svc) => Effect.exit(svc.create(session.id)))

        expect(Exit.isFailure(exit)).toBe(true)
        expect(yield* share(session.id)).toBeUndefined()
      }).pipe(Effect.provide(integrationLayer(client)))
    }),
  )

  it.live("ShareNext coalesces rapid diff events into one delayed sync with latest data", () =>
    provideTmpdirInstance(
      () => {
        const seen: Array<{ url: string; body: string }> = []
        const client = HttpClient.make((req) => {
          if (req.url.endsWith("/sync") && req.body._tag === "Uint8Array") {
            seen.push({ url: req.url, body: new TextDecoder().decode(req.body.body) })
          }
          return Effect.succeed(json(req, { ok: true }))
        })

        return Effect.gen(function* () {
          const events = yield* EventV2Bridge.Service
          const share = yield* ShareNext.Service
          const session = yield* Session.Service

          const info = yield* session.create({ title: "first" })
          yield* share.init()
          yield* Effect.sleep(50)
          const { db } = yield* Database.Service
          yield* db
            .insert(SessionShareTable)
            .values({
              session_id: info.id,
              id: "shr_abc",
              url: "https://legacy-share.example.com/share/abc",
              secret: "sec_123",
            })
            .run()
            .pipe(Effect.orDie)

          yield* events.publish(SessionEvent.Diff, {
            timestamp: yield* DateTime.now,
            sessionID: info.id,
            diff: [
              {
                file: "a.ts",
                patch:
                  "Index: a.ts\n===================================================================\n--- a.ts\t\n+++ a.ts\t\n@@ -1,1 +1,1 @@\n-one\n\\ No newline at end of file\n+two\n\\ No newline at end of file\n",
                additions: 1,
                deletions: 1,
                status: "modified",
              },
            ],
          })
          yield* events.publish(SessionEvent.Diff, {
            timestamp: yield* DateTime.now,
            sessionID: info.id,
            diff: [
              {
                file: "b.ts",
                patch:
                  "Index: b.ts\n===================================================================\n--- b.ts\t\n+++ b.ts\t\n@@ -1,1 +1,1 @@\n-old\n\\ No newline at end of file\n+new\n\\ No newline at end of file\n",
                additions: 2,
                deletions: 0,
                status: "modified",
              },
            ],
          })
          yield* pollWithTimeout(
            Effect.sync(() => (seen.length === 1 ? true : undefined)),
            "timed out waiting for share sync",
            "5 seconds",
          )

          expect(seen).toHaveLength(1)
          expect(seen[0].url).toBe("https://legacy-share.example.com/api/share/shr_abc/sync")

          const body = JSON.parse(seen[0].body) as {
            secret: string
            data: Array<{
              type: string
              data: Array<{
                file: string
                patch: string
                additions: number
                deletions: number
                status?: string
              }>
            }>
          }
          expect(body.secret).toBe("sec_123")
          expect(body.data).toHaveLength(1)
          expect(body.data[0].type).toBe("session_diff")
          expect(body.data[0].data).toEqual([
            {
              file: "b.ts",
              patch:
                "Index: b.ts\n===================================================================\n--- b.ts\t\n+++ b.ts\t\n@@ -1,1 +1,1 @@\n-old\n\\ No newline at end of file\n+new\n\\ No newline at end of file\n",
              additions: 2,
              deletions: 0,
              status: "modified",
            },
          ])
        }).pipe(Effect.provide(integrationLayer(client)))
      },
      { config: { enterprise: { url: "https://legacy-share.example.com" } } },
    ),
  )

  it.live("ShareNext syncs canonical imported messages and projected parts", () =>
    provideTmpdirInstance(
      () => {
        const seen: string[] = []
        const client = HttpClient.make((req) => {
          if (req.url.endsWith("/sync") && req.body._tag === "Uint8Array") {
            seen.push(new TextDecoder().decode(req.body.body))
          }
          return Effect.succeed(json(req, { ok: true }))
        })

        return Effect.gen(function* () {
          const events = yield* EventV2Bridge.Service
          const share = yield* ShareNext.Service
          const session = yield* Session.Service
          const info = yield* session.create({ title: "canonical share" })
          yield* share.init()
          const { db } = yield* Database.Service
          yield* db
            .insert(SessionShareTable)
            .values({
              session_id: info.id,
              id: "shr_canonical",
              url: "https://legacy-share.example.com/share/canonical",
              secret: "sec_canonical",
            })
            .run()
            .pipe(Effect.orDie)

          yield* events.publish(SessionEvent.MessageImported, {
            sessionID: info.id,
            timestamp: DateTime.makeUnsafe(1),
            message: SessionMessage.Assistant.make({
              id: SessionMessage.ID.make("msg_canonical_share"),
              type: "assistant",
              agent: "build",
              model: {
                providerID: ProviderV2.ID.make("test"),
                id: ModelV2.ID.make("test"),
                variant: ModelV2.VariantID.make("default"),
              },
              content: [SessionMessage.AssistantText.make({ type: "text", id: "text_share", text: "shared" })],
              time: { created: DateTime.makeUnsafe(1), completed: DateTime.makeUnsafe(2) },
            }),
          })

          yield* pollWithTimeout(
            Effect.sync(() => (seen.length === 1 ? true : undefined)),
            "timed out waiting for canonical transcript share sync",
            "5 seconds",
          )
          const body = JSON.parse(seen[0]) as { data: Array<{ type: string; data: Record<string, unknown> }> }
          expect(body.data).toContainEqual({
            type: "message",
            data: expect.objectContaining({ id: "msg_canonical_share", role: "assistant" }),
          })
          expect(body.data).toContainEqual({
            type: "part",
            data: expect.objectContaining({ messageID: "msg_canonical_share", type: "text", text: "shared" }),
          })
        }).pipe(Effect.provide(integrationLayer(client)))
      },
      { config: { enterprise: { url: "https://legacy-share.example.com" } } },
    ),
  )

  it.live("ShareNext syncs canonical user transcript when model lookup fails", () =>
    provideTmpdirInstance(
      () => {
        const seen: string[] = []
        const client = HttpClient.make((req) => {
          if (req.url.endsWith("/sync") && req.body._tag === "Uint8Array") {
            seen.push(new TextDecoder().decode(req.body.body))
          }
          return Effect.succeed(json(req, { ok: true }))
        })

        return Effect.gen(function* () {
          const events = yield* EventV2Bridge.Service
          const share = yield* ShareNext.Service
          const session = yield* Session.Service
          const info = yield* session.create({ title: "canonical user share" })
          yield* share.init()
          const { db } = yield* Database.Service
          yield* db
            .insert(SessionShareTable)
            .values({
              session_id: info.id,
              id: "shr_canonical_user",
              url: "https://legacy-share.example.com/share/canonical-user",
              secret: "sec_canonical_user",
            })
            .run()
            .pipe(Effect.orDie)

          yield* events.publish(SessionEvent.MessageImported, {
            sessionID: info.id,
            timestamp: DateTime.makeUnsafe(1),
            message: SessionMessage.User.make({
              id: SessionMessage.ID.make("msg_canonical_user_share"),
              type: "user",
              text: "share without a model",
              time: { created: DateTime.makeUnsafe(1) },
            }),
          })

          yield* pollWithTimeout(
            Effect.sync(() => (seen.length === 1 ? true : undefined)),
            "timed out waiting for canonical user transcript share sync",
            "5 seconds",
          )
          const body = JSON.parse(seen[0]) as { data: Array<{ type: string; data: Record<string, unknown> }> }
          expect(body.data).toContainEqual({
            type: "message",
            data: expect.objectContaining({ id: "msg_canonical_user_share", role: "user" }),
          })
          expect(body.data).toContainEqual({
            type: "part",
            data: expect.objectContaining({
              messageID: "msg_canonical_user_share",
              type: "text",
              text: "share without a model",
            }),
          })
        }).pipe(Effect.provide(integrationLayer(client)))
      },
      { config: { enterprise: { url: "https://legacy-share.example.com" } } },
    ),
  )
})
