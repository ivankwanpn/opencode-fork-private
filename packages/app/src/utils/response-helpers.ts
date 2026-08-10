// Helper to safely extract an array from vendor tarball client responses.
// The client wraps responses as { data: body }, and some endpoints further
// wrap as { location: {...}, data: [...] }. This handles both cases.
export function extractArray<T>(
  result: readonly T[] | { readonly data?: readonly T[] | { readonly data?: readonly T[] } },
): T[]
export function extractArray<T = unknown>(result: unknown): T[]
export function extractArray<T>(result: unknown): T[] {
  const body = (result as { data?: unknown })?.data
  if (Array.isArray(body)) return body as T[]
  if (body && typeof body === "object" && "data" in body) {
    const inner = (body as { data?: unknown }).data
    if (Array.isArray(inner)) return inner as T[]
  }
  if (Array.isArray(result)) return result as T[]
  return []
}
