/** One opaque UUID per server process; an active lease from another incarnation is ownership-lost evidence. */
export const processIncarnation = crypto.randomUUID()
