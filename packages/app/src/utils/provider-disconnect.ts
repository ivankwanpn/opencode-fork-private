export async function disconnectProviderAndRefresh(input: {
  disconnect: () => Promise<unknown>
  refresh: () => Promise<unknown>
  onSuccess: () => void
  onError: (error: unknown) => void
}) {
  try {
    await input.disconnect()
  } catch (error) {
    input.onError(error)
    return
  }

  input.onSuccess()
  // Provider refresh may wait on a location disposal; it must not hold the disconnect action open.
  void Promise.resolve()
    .then(() => input.refresh())
    .catch(() => undefined)
}
