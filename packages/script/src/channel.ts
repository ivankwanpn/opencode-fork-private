export type Channel = "dev" | "beta" | "prod"

export function resolveChannel(value = process.env.OPENCODE_CHANNEL): Channel {
  if (value === "dev" || value === "beta" || value === "prod") return value
  return "dev"
}
