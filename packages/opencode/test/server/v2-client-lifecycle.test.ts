import { afterEach, describe, test } from "bun:test"
import { Server } from "../../src/server/server"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"
import {
  createGeneratedLifecycleClient,
  createNativeLifecycleClient,
  runV2LifecycleContract,
} from "./v2-lifecycle-contract"

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

type ServerGraph = "default" | "native"

function serverFetch(graph: ServerGraph, input: RequestInfo | URL, init?: RequestInit) {
  const app = graph === "native" ? Server.Native().app : Server.Default().app
  return app.fetch(new Request(input, init))
}

describe("shared V2 client lifecycle contract", () => {
  test("covers the generated client used by Desktop and CLI", async () => {
    for (const graph of ["default", "native"] as const) {
      await using directory = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
      await runV2LifecycleContract(
        createGeneratedLifecycleClient({
          baseUrl: "http://opencode.test",
          directory: directory.path,
          fetch: ((input, init) => serverFetch(graph, input, init)) as typeof fetch,
        }),
        directory.path,
        `${graph}-generated`,
      )
    }
  }, 60_000)

  test("covers the native client used by TUI", async () => {
    for (const graph of ["default", "native"] as const) {
      await using directory = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
      await runV2LifecycleContract(
        createNativeLifecycleClient({
          baseUrl: "http://opencode.test",
          fetch: ((input, init) => serverFetch(graph, input, init)) as typeof fetch,
        }),
        directory.path,
        `${graph}-tui`,
      )
    }
  }, 60_000)
})
