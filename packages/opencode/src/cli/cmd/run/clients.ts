import { OpenCode } from "@opencode-ai/client"
import { createNativeCompatClient } from "./native-compat"

type AttachClientsInput = {
  baseUrl: string
  directory?: string
  headers?: Record<string, string>
  fetch?: typeof globalThis.fetch
}

function timeoutSafeFetch(upstream: typeof globalThis.fetch) {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request && init === undefined ? input : new Request(input, init)
    ;(request as Request & { timeout?: boolean }).timeout = false
    return upstream(request)
  }) as typeof globalThis.fetch
}

export function createAttachClients(input: AttachClientsInput) {
  const fetch = timeoutSafeFetch(input.fetch ?? globalThis.fetch)
  const native = OpenCode.make({
    baseUrl: input.baseUrl,
    headers: input.headers,
    fetch,
  })
  return {
    sdk: createNativeCompatClient({ native, directory: input.directory }),
    native,
  }
}

// Directory rebinding must replace the pair atomically so runtime never mixes
// an SDK client with a native client backed by a different fetch closure.
export function rebindAttachClients(_current: ReturnType<typeof createAttachClients>, input: AttachClientsInput) {
  return createAttachClients(input)
}
