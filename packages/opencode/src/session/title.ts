export * as SessionTitle from "./title"

const parentPrefix = "New session - "
export const childPrefix = "Child session - "

export function isDefault(title: string) {
  return new RegExp(`^(${parentPrefix}|${childPrefix})\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$`).test(title)
}
