import { describe, expect, test } from "bun:test"
import { disconnectProviderCredentials } from "./provider-disconnect"

describe("disconnectProviderCredentials", () => {
  test("removes every credential connection and preserves the location", async () => {
    const removed: { credentialID: string; location?: { directory?: string; workspace?: string } }[] = []
    const location = { directory: "D:\\repo" }
    const count = await disconnectProviderCredentials(
      {
        integration: {
          get: async () => ({
            data: {
              connections: [
                { type: "credential", id: "credential-1", label: "Primary" },
                { type: "env", name: "PROVIDER_KEY" },
                { type: "credential", id: "credential-2", label: "Backup" },
              ],
            },
          }),
        },
        credential: {
          remove: async (input) => {
            removed.push(input)
          },
        },
      },
      "provider",
      location,
    )

    expect(count).toBe(2)
    expect(removed).toEqual([
      { credentialID: "credential-1", location },
      { credentialID: "credential-2", location },
    ])
  })

  test("does nothing when an integration has no removable credential", async () => {
    let removed = false
    const count = await disconnectProviderCredentials(
      {
        integration: {
          get: async () => ({ data: { connections: [{ type: "env", name: "PROVIDER_KEY" }] } }),
        },
        credential: {
          remove: async () => {
            removed = true
          },
        },
      },
      "provider",
    )

    expect(count).toBe(0)
    expect(removed).toBe(false)
  })
})
