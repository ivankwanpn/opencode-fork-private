export * as BashArity from "./bash-arity.ts"

const SINGLE = new Set(["cat", "echo", "grep", "ls", "ps", "pwd", "sleep", "tail", "which"])
const SUBCOMMAND = new Set(["git log", "git status"])
const SCRIPT = new Set(["bun run", "npm run", "pnpm run", "yarn run"])
const WRAPPERS = new Set(["bash", "cmd", "env", "powershell", "pwsh", "sh", "source", "sudo", "zsh"])

export function savePattern(tokens: ReadonlyArray<string>, options?: { readonly caseInsensitive?: boolean }) {
  if (tokens.length === 0 || tokens.some(unsafeToken)) return
  const lookup = options?.caseInsensitive ? tokens.map((token) => token.toLowerCase()) : tokens
  if (WRAPPERS.has(lookup[0]) || assignment(lookup[0])) return
  if (SINGLE.has(lookup[0])) return `${tokens[0]} *`

  const command = lookup.slice(0, 2).join(" ")
  if (SUBCOMMAND.has(command)) return `${tokens.slice(0, 2).join(" ")} *`
  if (!SCRIPT.has(command) || tokens.length < 3 || option(tokens[2])) return
  return `${tokens.slice(0, 3).join(" ")} *`
}

function assignment(token: string) {
  return /^[A-Za-z_][A-Za-z0-9_]*=/.test(token)
}

function option(token: string) {
  return token.startsWith("-") || token.startsWith("/")
}

function unsafeToken(token: string) {
  if (/[?*\[\]()]/.test(token)) return true
  if (/[`$|&;<>^]/.test(token)) return true
  if (/[{}]/.test(token) || token.startsWith("~")) return true
  if (token.includes("%") || /![^!]+!/.test(token)) return true
  return false
}
