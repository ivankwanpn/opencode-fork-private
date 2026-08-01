import { $ } from "bun"
import { resolveChannel } from "./utils"

await $`bun ./scripts/copy-icons.ts ${resolveChannel()}`

await $`cd ../opencode && bun script/build-node.ts`
