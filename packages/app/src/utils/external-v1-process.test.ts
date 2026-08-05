import { describe, expect, test } from "bun:test"
import type { ServerConnection } from "@/context/server"
import { request } from "node:http"
import { createApiForServer, createSdkForServer } from "./server"
import { createExternalCompatibleApi } from "./server-compat"
import { detectServerProtocolDetails } from "./server-protocol"

const url = process.env.OPENCODE_EXTERNAL_V1_URL
const directory = process.env.OPENCODE_EXTERNAL_V1_DIRECTORY ?? "D:\\agent-comper\\opencode-1.18.10-v1-project"
const enabled = !!url
const requests: string[] = []

async function externalFetch(input: RequestInfo | URL, init?: RequestInit) {
  const requestInput = input instanceof Request ? input : undefined
  const target = requestInput?.url ?? String(input)
  const method = requestInput?.method ?? init?.method ?? "GET"
  const headers = Object.fromEntries(new Headers(requestInput?.headers ?? init?.headers).entries())
  const body = requestInput ? await requestInput.clone().text() : typeof init?.body === "string" ? init.body : undefined
  requests.push(`${method} ${target}`)

  return new Promise<Response>((resolve, reject) => {
    const client = request(target, { method, headers }, (response) => {
      const chunks: Buffer[] = []
      response.on("data", (chunk: Buffer) => chunks.push(chunk))
      response.on("end", () => {
        const responseHeaders = Object.fromEntries(
          Object.entries(response.headers).flatMap(([key, value]) => {
            if (value === undefined) return []
            return [[key, Array.isArray(value) ? value.join(", ") : value]]
          }),
        )
        resolve(
          new Response(Buffer.concat(chunks), {
            status: response.statusCode ?? 500,
            headers: responseHeaders,
          }),
        )
      })
    })
    client.on("error", reject)
    if (body) client.write(body)
    client.end()
  })
}

const externalFetchForSdk = externalFetch as typeof globalThis.fetch

describe.skipIf(!enabled)("external V1 server process compatibility", () => {
  test("keeps the V1 boundary explicit across session lifecycle operations", async () => {
    requests.length = 0
    const server = { url } as ServerConnection.HttpBase
    const details = await detectServerProtocolDetails(server, externalFetchForSdk)
    expect(details.protocol).toBe("v1")
    expect(details.pid).toBeUndefined()

    const api = createExternalCompatibleApi({
      protocol: Promise.resolve("v1"),
      current: createApiForServer({ server, fetch: externalFetchForSdk }),
      directory,
      legacy: (target) =>
        createSdkForServer({ server, directory: target, fetch: externalFetchForSdk, throwOnError: true }),
    })
    let sessionID: string | undefined
    try {
      const session = await api.session.create({ location: { directory } })
      sessionID = session.id
      const listed = await api.session.list({ directory, parentID: null })
      const restored = await api.session.get({ sessionID: session.id })
      const legacy = createSdkForServer({ server, directory, fetch: externalFetchForSdk, throwOnError: true })
      const messageID = `msg_external_v1_${crypto.randomUUID().replaceAll("-", "")}`
      const location = { directory }

      expect(listed.data.some((item) => item.id === session.id)).toBe(true)
      expect(restored.id).toBe(session.id)

      const active = await api.session.active()
      const todos = await api.session.todo({ sessionID: session.id })
      const project = await api.project.current({ location })
      const projects = await api.project.list()
      const directories = await api.project.directories({ location, projectID: project.id })
      const pathInfo = await api.path.get({ location })
      const vcs = await api.vcs.get({ location })
      const vcsStatus = await api.vcs.status({ location })
      const lsp = await api.lsp.status({ location })
      const files = await api.file.list({ location, path: "" })
      const found = await api.file.find({ location, query: "external-v1-no-match", type: "file", limit: 5 })
      const config = await api.config.get({ location })
      const mcp = await api.mcp.list({ location })
      const resources = await api.mcp.resource.catalog({ location })
      const permissions = await api.permission.request.list({ location })
      const questions = await api.question.request.list({ location })
      const shells = await api.pty.shells({ location })
      const ptys = await api.pty.list({ location })

      expect(active).toEqual({})
      expect(todos).toEqual([])
      expect(project.id).toBeDefined()
      expect(projects.length).toBeGreaterThan(0)
      expect(directories).toEqual([])
      expect(pathInfo.directory).toBe(directory)
      expect(vcs.data).toMatchObject({ branch: null, defaultBranch: null })
      expect(vcsStatus.data).toEqual([])
      expect(lsp.data).toEqual([])
      expect(files.data).toEqual([])
      expect(found.data).toEqual([])
      expect(config.data).toBeDefined()
      expect(mcp.data).toEqual([])
      expect(resources.data).toMatchObject({ resources: [], templates: [] })
      expect(permissions.data).toEqual([])
      expect(questions.data).toEqual([])
      expect(shells.data.length).toBeGreaterThan(0)
      expect(ptys.data).toEqual([])

      await api.session.rename({ sessionID: session.id, title: "external V1 compatibility" })
      expect((await api.session.get({ sessionID: session.id })).title).toBe("external V1 compatibility")

      await expect(api.session.inputList({ sessionID: session.id, delivery: "queue" })).rejects.toThrow(
        "Durable session follow-up inputs is unavailable on a V1 server",
      )
      const prompt = await legacy.session.promptAsync({
        sessionID: session.id,
        messageID,
        agent: "build",
        noReply: true,
        parts: [{ type: "text", text: "external V1 compatibility prompt" }],
      })
      expect(prompt.error).toBeUndefined()

      const pty = await api.pty.create({
        location,
        command: "powershell.exe",
        args: ["-NoProfile", "-Command", "Start-Sleep -Seconds 5"],
        cwd: directory,
        title: "External V1 PTY",
      })
      const ptyID = pty.data.id
      try {
        expect((await api.pty.get({ location, ptyID })).data.id).toBe(ptyID)
        expect((await api.pty.update({ location, ptyID, title: "Updated External V1 PTY" })).data.title).toBe(
          "Updated External V1 PTY",
        )
        expect((await api.pty.connectToken({ location, ptyID })).data.ticket).toBeDefined()
      } finally {
        await api.pty.remove({ location, ptyID })
      }

      await api.session.interrupt({ sessionID: session.id })
      await api.session.remove({ sessionID: session.id, directory })
      await expect(api.session.get({ sessionID: session.id })).rejects.toThrow()
      sessionID = undefined

      for (const path of [
        "/session",
        "/project",
        "/path",
        "/vcs",
        "/lsp",
        "/file",
        "/find",
        "/mcp",
        "/permission",
        "/question",
        "/pty",
      ]) {
        expect(requests.some((request) => request.includes(path))).toBe(true)
      }
      expect(requests.some((request) => request.includes("prompt_async"))).toBe(true)
    } finally {
      if (sessionID) await api.session.remove({ sessionID, directory }).catch(() => undefined)
    }
  }, 60_000)
})
