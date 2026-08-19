import { Effect } from "effect"
import { ShellCommand } from "../../src/tool/shell-command.ts"

const result = await Effect.runPromise(
  Effect.all({
    bash: ShellCommand.analyze({ command: "echo test > output.txt", kind: "bash" }),
    powershell: ShellCommand.analyze({ command: "Write-Host test > output.txt", kind: "powershell" }),
  }),
)

process.stdout.write(JSON.stringify(result))
