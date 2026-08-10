import type { ACPClient } from "@/acp/client"

export type ClientOverrides = {
  readonly session?: Partial<ACPClient.Interface["session"]>
  readonly events?: Partial<ACPClient.Interface["events"]>
  readonly permission?: Partial<ACPClient.Interface["permission"]>
  readonly catalog?: Partial<ACPClient.Interface["catalog"]>
  readonly config?: Partial<ACPClient.Interface["config"]>
  readonly mcp?: Partial<ACPClient.Interface["mcp"]>
}

function unexpectedCall<T extends (...args: never[]) => Promise<unknown>>(operation: string): T {
  return (() => Promise.reject(new Error(`Unexpected ACP client call: ${operation}`))) as T
}

function unexpectedSubscription(operation: string): ACPClient.Interface["events"]["subscribe"] {
  return () => ({
    async *[Symbol.asyncIterator]() {
      throw new Error(`Unexpected ACP client call: ${operation}`)
    },
  })
}

export function makeClient(overrides: ClientOverrides = {}): ACPClient.Interface {
  return {
    session: {
      create: unexpectedCall<ACPClient.Interface["session"]["create"]>("session.create"),
      get: unexpectedCall<ACPClient.Interface["session"]["get"]>("session.get"),
      list: unexpectedCall<ACPClient.Interface["session"]["list"]>("session.list"),
      messages: unexpectedCall<ACPClient.Interface["session"]["messages"]>("session.messages"),
      message: unexpectedCall<ACPClient.Interface["session"]["message"]>("session.message"),
      fork: unexpectedCall<ACPClient.Interface["session"]["fork"]>("session.fork"),
      interrupt: unexpectedCall<ACPClient.Interface["session"]["interrupt"]>("session.interrupt"),
      prompt: unexpectedCall<ACPClient.Interface["session"]["prompt"]>("session.prompt"),
      command: unexpectedCall<ACPClient.Interface["session"]["command"]>("session.command"),
      compact: unexpectedCall<ACPClient.Interface["session"]["compact"]>("session.compact"),
      ...overrides.session,
    },
    events: {
      subscribe: unexpectedSubscription("events.subscribe"),
      ...overrides.events,
    },
    permission: {
      reply: unexpectedCall<ACPClient.Interface["permission"]["reply"]>("permission.reply"),
      ...overrides.permission,
    },
    catalog: {
      load: unexpectedCall<ACPClient.Interface["catalog"]["load"]>("catalog.load"),
      ...overrides.catalog,
    },
    config: {
      get: unexpectedCall<ACPClient.Interface["config"]["get"]>("config.get"),
      ...overrides.config,
    },
    mcp: {
      add: unexpectedCall<ACPClient.Interface["mcp"]["add"]>("mcp.add"),
      ...overrides.mcp,
    },
  }
}

export type RecordedRequest = {
  readonly method: string
  readonly url: URL
  readonly headers: Headers
  readonly body: unknown
  readonly fetchID: symbol
}

export const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  })

export const empty = (status = 204) => new Response(null, { status })

export const eventStream = (events: readonly unknown[]) =>
  new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), {
    headers: { "content-type": "text/event-stream" },
  })

export function recorder(respond: (request: RecordedRequest) => Response | Promise<Response>) {
  const requests: RecordedRequest[] = []
  const fetchID = Symbol("acp-recording-fetch")
  const fetch = Object.assign(
    async (input: Parameters<typeof globalThis.fetch>[0], init?: Parameters<typeof globalThis.fetch>[1]) => {
      const request = new Request(input, init)
      const item = {
        method: request.method,
        url: new URL(request.url),
        headers: request.headers,
        body: request.body ? await request.clone().json() : undefined,
        fetchID,
      }
      requests.push(item)
      return respond(item)
    },
    { preconnect: globalThis.fetch.preconnect },
  ) satisfies typeof globalThis.fetch
  return { fetch, fetchID, requests }
}
