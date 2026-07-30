type Location = {
  directory?: string
  workspace?: string
}

type ProviderConnectionApi = {
  integration: {
    get: (input: {
      integrationID: string
      location?: Location
    }) => Promise<{
      data:
        | {
            connections: ReadonlyArray<
              { type: "credential"; id: string; label: string } | { type: "env"; name: string }
            >
          }
        | null
    }>
  }
  credential: {
    remove: (input: { credentialID: string; location?: Location }) => Promise<unknown>
  }
}

export async function disconnectProviderCredentials(
  api: ProviderConnectionApi,
  providerID: string,
  location?: Location,
) {
  const integration = await api.integration.get({ integrationID: providerID, location })
  const credentials = integration.data?.connections.filter((connection) => connection.type === "credential") ?? []
  await Promise.all(
    credentials.map((connection) => api.credential.remove({ credentialID: connection.id, location })),
  )
  return credentials.length
}
