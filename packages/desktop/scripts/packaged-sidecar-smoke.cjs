const fs = require("node:fs")
const http = require("node:http")
const net = require("node:net")
const os = require("node:os")
const path = require("node:path")
const { app, utilityProcess } = require("electron")

const asarArgument =
  process.env.OPENCODE_PACKAGED_SMOKE_ASAR ??
  process.argv.find((value) => value.startsWith("--asar="))?.slice("--asar=".length)
const asarPath = asarArgument
  ? path.resolve(asarArgument)
  : path.resolve(path.dirname(__filename), "../dist/win-unpacked/resources/app.asar")
const sidecarPath = path.join(asarPath, "out/main/sidecar.js")
const reportPath = process.env.OPENCODE_PACKAGED_SMOKE_REPORT ?? path.join(os.tmpdir(), "opencode-packaged-sidecar-smoke.json")
const password = `smoke-${Date.now()}`
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-packaged-sidecar-"))
const workspace = path.join(tempRoot, "workspace")
const marketplaceRoot = path.join(tempRoot, "marketplace")
const marketplacePlugin = path.join(marketplaceRoot, "plugins", "demo")
fs.mkdirSync(workspace)
fs.mkdirSync(path.join(marketplaceRoot, ".claude-plugin"), { recursive: true })
fs.mkdirSync(path.join(marketplacePlugin, "skills", "demo"), { recursive: true })
fs.mkdirSync(path.join(marketplacePlugin, "commands"), { recursive: true })
fs.mkdirSync(path.join(tempRoot, "user-data"))
fs.writeFileSync(
  path.join(marketplaceRoot, ".claude-plugin", "marketplace.json"),
  JSON.stringify({
    name: "local-smoke",
    plugins: [{ name: "demo", description: "Packaged smoke plugin", version: "1.0.0", source: "./plugins/demo" }],
  }),
)
fs.writeFileSync(
  path.join(marketplacePlugin, "skills", "demo", "SKILL.md"),
  "---\nname: demo\ndescription: packaged smoke skill\n---\nUse the packaged smoke skill.",
)
fs.writeFileSync(
  path.join(marketplacePlugin, "commands", "demo.md"),
  "---\ndescription: packaged smoke command\n---\nRun the packaged smoke command.",
)
fs.writeFileSync(
  path.join(marketplacePlugin, ".mcp.json"),
  JSON.stringify({ mcpServers: { demo: { command: "demo-server", args: ["--stdio"], env: { DEMO: "1" } } } }),
)

app.commandLine.appendSwitch("no-sandbox")
app.setPath("userData", path.join(tempRoot, "user-data"))

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function cleanupTemp() {
  try {
    await fs.promises.rm(tempRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  } catch {
    console.warn(`Could not remove smoke-test directory: ${tempRoot}`)
  }
}

function getPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (!address || typeof address === "string") {
        server.close()
        reject(new Error("Could not allocate a local port"))
        return
      }
      server.close(() => resolve(address.port))
    })
  })
}

function authHeader() {
  return `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`
}

async function startFakeLlm() {
  const requests = []
  const server = http.createServer((request, response) => {
    if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
      response.writeHead(404)
      response.end()
      return
    }

    const chunks = []
    request.on("data", (chunk) => chunks.push(chunk))
    request.on("end", () => {
      let body = {}
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"))
      } catch {
        response.writeHead(400, { "content-type": "application/json" })
        response.end(JSON.stringify({ error: { message: "invalid JSON" } }))
        return
      }

      requests.push(body)
      const model = typeof body.model === "string" ? body.model : "test-model"
      const id = `chatcmpl-packaged-smoke-${requests.length}`
      const created = Math.floor(Date.now() / 1000)
      const chunk = (delta, finishReason = null) => ({
        id,
        object: "chat.completion.chunk",
        created,
        model,
        choices: [{ index: 0, delta, finish_reason: finishReason }],
      })

      response.writeHead(200, {
        "cache-control": "no-cache",
        connection: "keep-alive",
        "content-type": "text/event-stream",
      })
      response.write(`data: ${JSON.stringify(chunk({ role: "assistant" }))}\n\n`)
      response.write(`data: ${JSON.stringify(chunk({ content: "Packaged smoke response" }))}\n\n`)
      response.write(
        `data: ${JSON.stringify({
          ...chunk({}, "stop"),
          usage: { prompt_tokens: 32, completion_tokens: 4, total_tokens: 36 },
        })}\n\n`,
      )
      response.end("data: [DONE]\n\n")
    })
  })

  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const address = server.address()
  assert(address && typeof address !== "string", "fake LLM did not bind to a TCP address")

  return {
    url: `http://127.0.0.1:${address.port}/v1`,
    requests,
    async stop() {
      if (!server.listening) return
      await new Promise((resolve) => server.close(() => resolve()))
    },
  }
}

async function waitFor(predicate, label, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`Timed out waiting for ${label}`)
}

async function request(base, pathname, init = {}) {
  return fetch(new URL(pathname, base), {
    ...init,
    headers: {
      authorization: authHeader(),
      ...(init.headers ?? {}),
    },
  })
}

function locationPath(pathname, workspace) {
  const url = new URL(pathname, "http://localhost")
  url.searchParams.set("location[directory]", workspace)
  return `${url.pathname}${url.search}`
}

async function json(requestPromise, label) {
  const response = await requestPromise
  const text = await response.text()
  let body
  try {
    body = text ? JSON.parse(text) : undefined
  } catch {
    body = text
  }
  assert(response.ok, `${label} failed with ${response.status}: ${text.slice(0, 500)}`)
  return body
}

function createEventReader(response) {
  assert(response.ok, `event subscription failed with ${response.status}`)
  assert(response.body, "event subscription did not return a body")
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const events = []
  const waiters = []
  let buffer = ""
  let stopped = false

  const settle = () => {
    for (let index = waiters.length - 1; index >= 0; index--) {
      const waiter = waiters[index]
      const event = events.find(waiter.predicate)
      if (!event) continue
      waiters.splice(index, 1)
      clearTimeout(waiter.timeout)
      waiter.resolve(event)
    }
  }

  const pump = (async () => {
    while (!stopped) {
      const result = await reader.read()
      if (result.done) return
      buffer += decoder.decode(result.value, { stream: true })
      const records = buffer.split(/\r?\n\r?\n/)
      buffer = records.pop() ?? ""
      for (const record of records) {
        const data = record
          .split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n")
        if (!data) continue
        try {
          events.push(JSON.parse(data))
          settle()
        } catch {
          // Ignore heartbeat or incomplete non-JSON frames.
        }
      }
    }
  })()

  return {
    waitFor(predicate, timeoutMs = 15_000) {
      const found = events.find(predicate)
      if (found) return Promise.resolve(found)
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          const position = waiters.findIndex((item) => item.resolve === resolve)
          if (position >= 0) waiters.splice(position, 1)
          reject(new Error(`Timed out waiting for packaged sidecar event; received ${events.length} events`))
        }, timeoutMs)
        waiters.push({ predicate, resolve, reject, timeout })
      })
    },
    async stop() {
      stopped = true
      await reader.cancel()
      await pump.catch(() => undefined)
    },
  }
}

async function startSidecar(port, configContent) {
  const child = utilityProcess.fork(sidecarPath, [], {
    cwd: workspace,
    env: {
      ...process.env,
      OPENCODE_CHANNEL: "prod",
      OPENCODE_SERVER_USERNAME: "opencode",
      OPENCODE_SERVER_PASSWORD: password,
      OPENCODE_DISABLE_CHANNEL_DB: "1",
      XDG_DATA_HOME: path.join(tempRoot, "data"),
      XDG_CACHE_HOME: path.join(tempRoot, "cache"),
      XDG_CONFIG_HOME: path.join(tempRoot, "config"),
      XDG_STATE_HOME: path.join(tempRoot, "state"),
      OPENCODE_CONFIG_CONTENT: configContent,
      NO_PROXY: "127.0.0.1,localhost,::1",
      no_proxy: "127.0.0.1,localhost,::1",
    },
    serviceName: "packaged sidecar smoke test",
    stdio: "pipe",
  })
  const logs = []
  child.stdout?.on("data", (chunk) => logs.push(`stdout: ${chunk.toString().trimEnd()}`))
  child.stderr?.on("data", (chunk) => logs.push(`stderr: ${chunk.toString().trimEnd()}`))

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Packaged sidecar did not become ready within 60 seconds")), 60_000)
    const onMessage = (message) => {
      if (message?.type === "ready") {
        clearTimeout(timeout)
        child.off("exit", onExit)
        resolve()
      }
      if (message?.type === "error") {
        clearTimeout(timeout)
        child.off("exit", onExit)
        reject(new Error(message.error?.message ?? "Packaged sidecar failed to start"))
      }
    }
    const onExit = (code) => {
      clearTimeout(timeout)
      child.off("message", onMessage)
      reject(new Error(`Packaged sidecar exited before ready with code ${code}`))
    }
    child.on("message", onMessage)
    child.once("exit", onExit)
    child.postMessage({
      type: "start",
      hostname: "127.0.0.1",
      port,
      password,
      userDataPath: path.join(tempRoot, "user-data"),
    })
  }).catch((error) => {
    child.kill()
    throw Object.assign(error, { logs })
  })

  return {
    child,
    async stop() {
      if (child.killed) return
      await new Promise((resolve) => {
        const timeout = setTimeout(() => {
          child.kill()
          resolve()
        }, 6_000)
        child.once("exit", () => {
          clearTimeout(timeout)
          resolve()
        })
        child.postMessage({ type: "stop" })
      })
    },
    logs,
  }
}

async function run() {
  assert(fs.existsSync(sidecarPath), `Packaged sidecar not found: ${sidecarPath}`)
  const packagedMetadata = JSON.parse(fs.readFileSync(path.join(asarPath, "package.json"), "utf8"))
  assert(packagedMetadata.version === "999.0.11", `Packaged Desktop version is ${packagedMetadata.version}, expected 999.0.11`)
  const port = await getPort()
  const base = `http://127.0.0.1:${port}`
  const llm = await startFakeLlm()
  let sidecar
  try {
    sidecar = await startSidecar(
      port,
      JSON.stringify({
        formatter: false,
        lsp: false,
        provider: {
          test: {
            name: "Packaged Smoke Test",
            id: "test",
            env: [],
            npm: "@ai-sdk/openai-compatible",
            models: {
              "test-model": {
                id: "test-model",
                name: "Packaged Smoke Model",
                attachment: false,
                reasoning: false,
                temperature: false,
                tool_call: true,
                release_date: "2025-01-01",
                limit: { context: 100_000, output: 10_000 },
                cost: { input: 0, output: 0 },
                options: {},
              },
            },
            options: { apiKey: "test-key", baseURL: llm.url },
          },
        },
      }),
    )
  } catch (error) {
    await llm.stop()
    throw error
  }
  let events
  let reconnect
  let ptyID
  try {
    const health = await json(request(base, "/api/health"), "health")
    assert(health.healthy === true && typeof health.pid === "number", "health contract is not V2")

    const capability = await json(request(base, "/api/capability"), "capability")
    assert(typeof capability.backgroundSubagents === "boolean", "capability contract is incomplete")

    const openapi = await json(request(base, "/doc"), "OpenAPI")
    assert(openapi.paths?.["/api/session"]?.post, "OpenAPI does not expose V2 session.create")
    assert(openapi.paths?.["/api/event"]?.get, "OpenAPI does not expose V2 event.subscribe")

    const eventResponse = await request(base, "/api/event")
    events = createEventReader(eventResponse)
    await events.waitFor((event) => event.type === "server.connected")

    const created = await json(
      request(base, "/api/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ location: { directory: workspace } }),
      }),
      "session.create",
    )
    const sessionID = created.data?.id
    assert(typeof sessionID === "string" && sessionID.startsWith("ses"), "session.create returned no V2 session")
    await events.waitFor((event) => event.type === "session.created" && event.data?.sessionID === sessionID)

    const permissionID = `per_smoke_${Date.now()}`
    const permission = await json(
      request(base, `/api/session/${sessionID}/permission`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: permissionID,
          action: "external_directory",
          resources: ["packaged-sidecar"],
          save: [],
          metadata: { source: "packaged-sidecar-smoke" },
        }),
      }),
      "session.permission.create",
    )
    assert(permission.data?.id === permissionID && permission.data?.effect === "ask", "permission was not queued")
    await events.waitFor((event) => event.type === "permission.v2.asked" && event.data?.id === permissionID)
    const sessionPermissions = await json(request(base, `/api/session/${sessionID}/permission`), "session.permission.list")
    assert(sessionPermissions.data?.some((item) => item.id === permissionID), "permission was not session-owned")
    const permissionDetail = await json(
      request(base, `/api/session/${sessionID}/permission/${permissionID}`),
      "session.permission.get",
    )
    assert(permissionDetail.data?.id === permissionID, "permission lookup returned the wrong request")
    const permissionReply = await request(base, `/api/session/${sessionID}/permission/${permissionID}/reply`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reply: "reject", message: "packaged smoke cleanup" }),
    })
    assert(permissionReply.status === 204, `permission reply returned ${permissionReply.status}`)
    await events.waitFor((event) => event.type === "permission.v2.replied" && event.data?.requestID === permissionID)

    const questions = await json(request(base, `/api/session/${sessionID}/question`), "session.question.list")
    assert(Array.isArray(questions.data) && questions.data.length === 0, "unexpected pending question in a new session")

    const mcp = await json(request(base, locationPath("/api/mcp", workspace)), "mcp.status")
    assert(mcp.location?.directory === workspace && mcp.data && typeof mcp.data === "object", "MCP status is not location-scoped")
    const mcpResources = await json(request(base, locationPath("/api/mcp/resource", workspace)), "mcp.resources")
    assert(mcpResources.location?.directory === workspace && mcpResources.data && typeof mcpResources.data === "object", "MCP resources are not location-scoped")

    const plugins = await json(request(base, "/api/plugins"), "plugins.list")
    assert(Array.isArray(plugins.marketplaces) && Array.isArray(plugins.plugins), "plugin catalog shape is invalid")
    const addedMarketplace = await json(
      request(base, "/api/plugins/marketplace", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source: marketplaceRoot }),
      }),
      "plugins.marketplace.add",
    )
    const marketplace = addedMarketplace.marketplaces?.find((item) => item.name === "local-smoke")
    const pluginID = "demo@local-smoke"
    const addedPlugin = addedMarketplace.plugins?.find((item) => item.id === pluginID)
    assert(marketplace?.pluginCount === 1, "local marketplace was not added")
    assert(addedPlugin?.installed === false && addedPlugin.capabilities?.includes("mcp"), "local plugin was not cataloged")

    const installedPlugin = await json(
      request(base, "/api/plugins/install", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: pluginID }),
      }),
      "plugins.install",
    )
    assert(
      installedPlugin.plugins?.find((item) => item.id === pluginID)?.installed === true,
      "local plugin was not installed",
    )
    const refreshedMarketplace = await json(
      request(base, "/api/plugins/marketplace/refresh", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "local-smoke" }),
      }),
      "plugins.marketplace.refresh",
    )
    assert(
      refreshedMarketplace.plugins?.find((item) => item.id === pluginID)?.installed === true,
      "refresh did not preserve the installed plugin",
    )
    const disabledPlugin = await json(
      request(base, "/api/plugins/disable", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: pluginID }),
      }),
      "plugins.disable",
    )
    assert(
      disabledPlugin.plugins?.find((item) => item.id === pluginID)?.enabled === false,
      "local plugin was not disabled",
    )
    const enabledPlugin = await json(
      request(base, "/api/plugins/enable", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: pluginID }),
      }),
      "plugins.enable",
    )
    assert(
      enabledPlugin.plugins?.find((item) => item.id === pluginID)?.enabled === true,
      "local plugin was not enabled",
    )
    const uninstalledPlugin = await json(
      request(base, "/api/plugins/uninstall", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: pluginID }),
      }),
      "plugins.uninstall",
    )
    assert(
      uninstalledPlugin.plugins?.find((item) => item.id === pluginID)?.installed === false,
      "local plugin was not uninstalled",
    )
    const removedMarketplace = await json(
      request(base, "/api/plugins/marketplace", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "local-smoke" }),
      }),
      "plugins.marketplace.remove",
    )
    assert(!removedMarketplace.marketplaces?.some((item) => item.name === "local-smoke"), "local marketplace was not removed")

    const shells = await json(request(base, locationPath("/api/pty/shells", workspace)), "pty.shells")
    assert(shells.location?.directory === workspace && Array.isArray(shells.data), "PTY shell discovery is not location-scoped")
    const pty = await json(
      request(base, locationPath("/api/pty", workspace), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ command: "cmd.exe", args: ["/c", "exit", "0"], cwd: workspace, title: "Smoke PTY" }),
      }),
      "pty.create",
    )
    ptyID = pty.data?.id
    assert(typeof ptyID === "string" && ptyID.startsWith("pty"), "PTY create returned no session")
    const updatedPty = await json(
      request(base, locationPath(`/api/pty/${ptyID}`, workspace), {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Updated Smoke PTY", size: { rows: 24, cols: 80 } }),
      }),
      "pty.update",
    )
    assert(updatedPty.data?.id === ptyID && updatedPty.data?.title === "Updated Smoke PTY", "PTY update was not applied")
    const token = await json(
      request(base, locationPath(`/api/pty/${ptyID}/connect-token`, workspace), {
        method: "POST",
        headers: { origin: "oc://renderer", "x-opencode-ticket": "1" },
      }),
      "pty.connect-token",
    )
    assert(typeof token.data?.ticket === "string" && token.data.expires_in > 0, "PTY connect token is invalid")
    const ptyEnd = Date.now() + 10_000
    let ptyInfo
    while (Date.now() < ptyEnd) {
      ptyInfo = await json(request(base, locationPath(`/api/pty/${ptyID}`, workspace)), "pty.get")
      if (ptyInfo.data?.status === "exited") break
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    assert(ptyInfo?.data?.status === "exited", "short-lived PTY did not exit")
    const ptyRemove = await request(base, locationPath(`/api/pty/${ptyID}`, workspace), { method: "DELETE" })
    assert(ptyRemove.status === 204, `pty.remove returned ${ptyRemove.status}`)
    ptyID = undefined

    const executionCreated = await json(
      request(base, "/api/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          location: { directory: workspace },
          model: { providerID: "test", id: "test-model" },
        }),
      }),
      "session.create.execution",
    )
    const executionSessionID = executionCreated.data?.id
    assert(
      typeof executionSessionID === "string" && executionSessionID.startsWith("ses"),
      "execution session.create returned no V2 session",
    )
    await events.waitFor((event) => event.type === "session.created" && event.data?.sessionID === executionSessionID)

    const executionMessageID = `msg_execution_${Date.now()}`
    const executionPrompt = await json(
      request(base, `/api/session/${executionSessionID}/prompt`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: executionMessageID,
          model: { providerID: "test", id: "test-model" },
          prompt: { text: "packaged sidecar smoke provider execution" },
          resume: true,
        }),
      }),
      "session.prompt.execution",
    )
    assert(
      executionPrompt.data?.id === executionMessageID && executionPrompt.data?.sessionID === executionSessionID,
      "execution prompt was not durably admitted",
    )
    await events.waitFor(
      (event) => event.type === "session.next.prompt.admitted" && event.data?.sessionID === executionSessionID,
    )
    await waitFor(() => llm.requests.length > 0, "fake LLM provider request")
    await events.waitFor(
      (event) =>
        event.type === "session.status" &&
        event.data?.sessionID === executionSessionID &&
        event.data?.status?.type === "busy",
    )
    await events.waitFor(
      (event) =>
        event.type === "session.status" &&
        event.data?.sessionID === executionSessionID &&
        event.data?.status?.type === "idle",
    )

    const executionContext = await json(
      request(base, `/api/session/${executionSessionID}/context`),
      "session.context.execution",
    )
    assert(
      executionContext.data?.some((message) => message.id === executionMessageID),
      "provider execution did not project the user prompt into V2 context",
    )

    const compactResponse = await request(base, `/api/session/${executionSessionID}/compact`, { method: "POST" })
    assert(compactResponse.status === 204, `session.compact returned ${compactResponse.status}`)
    const compactionStarted = await events.waitFor(
      (event) => event.type === "session.next.compaction.started" && event.data?.sessionID === executionSessionID,
    )
    const compactionDelta = await events.waitFor(
      (event) => event.type === "session.next.compaction.delta" && event.data?.sessionID === executionSessionID,
    )
    const compactionEnded = await events.waitFor(
      (event) => event.type === "session.next.compaction.ended" && event.data?.sessionID === executionSessionID,
    )
    assert(typeof compactionStarted.data?.messageID === "string", "compaction.started has no message ID")
    assert(typeof compactionDelta.data?.text === "string" && compactionDelta.data.text.length > 0, "compaction.delta is empty")
    assert(
      typeof compactionEnded.data?.text === "string" && compactionEnded.data.text.length > 0,
      "compaction.ended has no summary",
    )

    const activeAfterCompaction = await json(request(base, "/api/session/active"), "session.active.after-compaction")
    assert(!activeAfterCompaction.data?.[executionSessionID], "session remained active after compaction completed")

    const messageID = `msg_smoke_${Date.now()}`
    const admitted = await json(
      request(base, `/api/session/${sessionID}/prompt`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: messageID, prompt: { text: "packaged sidecar smoke admission" }, resume: false }),
      }),
      "session.prompt",
    )
    assert(admitted.data?.id === messageID && admitted.data?.sessionID === sessionID, "prompt was not durably admitted")
    await events.waitFor((event) => event.type === "session.next.prompt.admitted" && event.data?.sessionID === sessionID)

    const retried = await json(
      request(base, `/api/session/${sessionID}/prompt`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: messageID, prompt: { text: "packaged sidecar smoke admission" }, resume: false }),
      }),
      "session.prompt.retry",
    )
    assert(retried.data?.id === messageID && retried.data?.sessionID === sessionID, "exact prompt retry was not idempotent")

    const cancelledMessageID = `msg_smoke_cancelled_${Date.now()}`
    const queued = await json(
      request(base, `/api/session/${sessionID}/prompt`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: cancelledMessageID,
          prompt: { text: "packaged sidecar smoke cancellation" },
          delivery: "queue",
          resume: false,
        }),
      }),
      "session.prompt.queue",
    )
    assert(queued.data?.id === cancelledMessageID && queued.data?.delivery === "queue", "queue prompt was not admitted")

    const cancelled = await request(base, `/api/session/${sessionID}/input/${cancelledMessageID}`, { method: "DELETE" })
    assert(cancelled.status === 204, `session.input.cancel returned ${cancelled.status}`)
    const afterCancel = await json(request(base, `/api/session/${sessionID}/input`), "session.input.after-cancel")
    assert(
      !afterCancel.data?.some((input) => input.id === cancelledMessageID),
      "cancelled queue input remained pending",
    )

    const pending = await json(request(base, `/api/session/${sessionID}/input`), "session.input.list")
    assert(pending.data?.some((input) => input.id === messageID), "admitted prompt was not recoverable from input state")

    const interrupt = await request(base, `/api/session/${sessionID}/interrupt`, { method: "POST" })
    assert(interrupt.status === 204, `session.interrupt returned ${interrupt.status}`)

    await events.stop()
    const reconnectResponse = await request(base, "/api/event")
    reconnect = createEventReader(reconnectResponse)
    await reconnect.waitFor((event) => event.type === "server.connected")
    const restored = await json(request(base, `/api/session/${sessionID}`), "session.restore")
    assert(restored.data?.id === sessionID, "session restore returned the wrong session")
    const restoredPending = await json(request(base, `/api/session/${sessionID}/input`), "session.input.restore")
    assert(restoredPending.data?.some((input) => input.id === messageID), "prompt was lost after reconnect")
    const activeAfterReconnect = await json(request(base, "/api/session/active"), "session.active.after-reconnect")
    assert(!activeAfterReconnect.data?.[executionSessionID], "compacted session became active after reconnect")

    const report = {
        asarPath,
        sidecarPath,
        protocol: "v2",
        version: packagedMetadata.version,
        sessionID,
        messageID,
        executionSessionID,
        executionMessageID,
        llmRequestCount: llm.requests.length,
        checks: [
          "health",
          "capability",
          "openapi",
          "sse",
          "session.create",
          "permission",
          "question",
          "mcp",
          "plugins.catalog",
          "plugins.marketplace.add",
          "plugins.install",
          "plugins.marketplace.refresh",
          "plugins.disable",
          "plugins.enable",
          "plugins.uninstall",
          "plugins.marketplace.remove",
          "pty",
          "session.prompt.execution",
          "session.compaction",
          "session.prompt",
          "session.prompt.retry",
          "session.prompt.queue",
          "session.input.cancel",
          "interrupt",
          "reconnect",
          "session.compaction.reconnect",
        ],
      }
    fs.writeFileSync(reportPath, JSON.stringify(report))
    process.stderr.write(JSON.stringify(report) + "\n")
  } finally {
    await reconnect?.stop().catch(() => undefined)
    await events?.stop().catch(() => undefined)
    if (ptyID) await request(base, locationPath(`/api/pty/${ptyID}`, workspace), { method: "DELETE" }).catch(() => undefined)
    await sidecar.stop().catch(() => undefined)
    await llm.stop().catch(() => undefined)
    await cleanupTemp()
  }
}

app.whenReady().then(run).then(
  () => app.quit(),
  (error) => {
    console.error(error?.stack ?? error)
    fs.writeFileSync(
      reportPath,
      JSON.stringify({
        asarPath,
        sidecarPath,
        protocol: "unknown",
        error: String(error),
        argv: process.argv,
        filename: __filename,
        dirname: __dirname,
        asarArgument,
      }),
    )
    cleanupTemp().finally(() => {
      app.quit()
      process.exitCode = 1
    })
  },
)
