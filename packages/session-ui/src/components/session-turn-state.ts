export function shouldShowThinking(input: {
  working: boolean
  error: boolean
  retry: boolean
  visible: number
}) {
  if (!input.working || input.error || input.retry) return false
  return input.visible === 0
}
