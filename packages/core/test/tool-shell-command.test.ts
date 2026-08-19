import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { ShellCommand } from "@opencode-ai/core/tool/shell-command"

const analyze = (command: string, kind: ShellCommand.Kind) => Effect.runPromise(ShellCommand.analyze({ command, kind }))

const failure = async (command: string, kind: ShellCommand.Kind) => {
  const error = await Effect.runPromise(Effect.flip(ShellCommand.analyze({ command, kind })))
  if (!error) throw new Error("Expected shell analysis to fail")
  return error
}

describe("ShellCommand bash analysis", () => {
  test("splits compound commands into independent approval resources", async () => {
    expect(await analyze("echo foo && git status", "bash")).toEqual({
      resources: ["echo foo", "git status"],
      save: ["echo *", "git status *"],
      pathHints: [],
    })
  })

  test("finds nested commands and unquoted literal file arguments without reusable dynamic approval", async () => {
    expect(await analyze('echo $(cat "/tmp/outside.txt")', "bash")).toEqual({
      resources: ['echo $(cat "/tmp/outside.txt")', 'cat "/tmp/outside.txt"'],
      save: [],
      pathHints: [{ value: "/tmp/outside.txt", kind: "file" }],
    })
  })

  test("separates redirects from reusable command resources", async () => {
    expect(await analyze("echo test > output.txt", "bash")).toEqual({
      resources: ["echo test", "redirect > output.txt"],
      save: ["echo *"],
      pathHints: [{ value: "output.txt", kind: "file" }],
    })
  })

  test("finds redirects attached to pipelines, groups, and conditionals", async () => {
    expect(
      await analyze(
        "echo a | cat > pipeline.txt; { echo b; } > group.txt; if true; then echo c; fi > conditional.txt",
        "bash",
      ),
    ).toEqual({
      resources: [
        "echo a",
        "cat",
        "redirect > pipeline.txt",
        "echo b",
        "redirect > group.txt",
        "true",
        "echo c",
        "redirect > conditional.txt",
      ],
      save: ["echo *", "cat *"],
      pathHints: [
        { value: "pipeline.txt", kind: "file" },
        { value: "group.txt", kind: "file" },
        { value: "conditional.txt", kind: "file" },
      ],
    })
  })

  test("does not return an empty analysis for redirect-only input", async () => {
    expect(await analyze("> only.txt", "bash")).toEqual({
      resources: ["redirect > only.txt"],
      save: [],
      pathHints: [{ value: "only.txt", kind: "file" }],
    })
  })

  test("fails closed for dynamic, globbed, and non-file redirects", async () => {
    for (const command of ['echo > "$OUT"', "echo > release/*.txt", "echo hi 2>&1", "echo <<< word"]) {
      const error = await failure(command, "bash")
      expect(error).toBeInstanceOf(ShellCommand.AnalysisError)
      expect(error.reason).toBe("unsupported")
    }
  })

  test("extracts unquoted and option-attached literal command paths", async () => {
    expect(await analyze('cat "/tmp/a b"; cp --target-directory=/outside a.txt', "bash")).toEqual({
      resources: ['cat "/tmp/a b"', "cp --target-directory=/outside a.txt"],
      save: ["cat *"],
      pathHints: [
        { value: "/tmp/a b", kind: "file" },
        { value: "/outside", kind: "directory" },
        { value: "a.txt", kind: "file" },
      ],
    })
  })

  test("extracts cwd paths without requiring a shell approval resource", async () => {
    expect(await analyze("cd ../outside", "bash")).toEqual({
      resources: [],
      save: [],
      pathHints: [{ value: "../outside", kind: "directory" }],
    })
  })

  test("rejects cwd commands without one static target or mixed execution", async () => {
    for (const command of ["cd", "cd -", "popd", "pushd sub", "cd one; cd two", "cd sub && cat ../x"]) {
      const error = await failure(command, "bash")
      expect(error).toBeInstanceOf(ShellCommand.AnalysisError)
      expect(error.reason).toBe("unsupported")
    }
  })

  test("fails closed for valid input without an executable resource", async () => {
    for (const command of [
      "MODE=test",
      "cd /tmp; MODE=test",
      "PATH=/tmp/evil; git status",
      "PATH=/tmp/evil && git status",
    ]) {
      const error = await failure(command, "bash")
      expect(error).toBeInstanceOf(ShellCommand.AnalysisError)
      expect(error.reason).toBe("unsupported")
    }
  })

  test("keeps a leading simple-command assignment in the resource without reusable approval", async () => {
    expect(await analyze("PATH=/tmp/evil git status", "bash")).toEqual({
      resources: ["PATH=/tmp/evil git status"],
      save: [],
      pathHints: [],
    })
  })

  test("documents path hints as non-exhaustive for grep and unknown commands", async () => {
    expect(await analyze("grep needle /tmp/outside.txt", "bash")).toEqual({
      resources: ["grep needle /tmp/outside.txt"],
      save: ["grep *"],
      pathHints: [],
    })
    expect(await analyze("project-script /tmp/outside.txt", "bash")).toEqual({
      resources: ["project-script /tmp/outside.txt"],
      save: [],
      pathHints: [],
    })
  })

  test("rejects wrappers that can execute arbitrary commands", async () => {
    for (const command of [
      'bash -c "cat /tmp/outside.txt"',
      "env cat /tmp/outside.txt",
      "sudo cat /tmp/outside.txt",
      'xargs sh -c "cat /tmp/outside.txt"',
    ]) {
      const error = await failure(command, "bash")
      expect(error).toBeInstanceOf(ShellCommand.AnalysisError)
      expect(error.reason).toBe("unsupported")
    }
  })

  test("rejects oversized commands before parsing", async () => {
    const error = await failure(`echo ${"x".repeat(64 * 1024)}`, "bash")
    expect(error).toBeInstanceOf(ShellCommand.AnalysisError)
    expect(error.reason).toBe("size")
  })

  test("reports parser syntax failures as typed analysis errors", async () => {
    const error = await failure('echo "unterminated', "bash")
    expect(error).toBeInstanceOf(ShellCommand.AnalysisError)
    expect(error.reason).toBe("syntax")
  })
})

describe("ShellCommand PowerShell analysis", () => {
  test("splits commands inside conditionals", async () => {
    expect(await analyze("Write-Host foo; if ($?) { Write-Host bar }", "powershell")).toEqual({
      resources: ["Write-Host foo", "Write-Host bar"],
      save: [],
      pathHints: [],
    })
  })

  test("extracts unquoted path parameters while refusing reusable destructive approval", async () => {
    expect(await analyze('Remove-Item -Recurse -Path "C:/outside/file name.txt"', "powershell")).toEqual({
      resources: ['Remove-Item -Recurse -Path "C:/outside/file name.txt"'],
      save: [],
      pathHints: [{ value: "C:/outside/file name.txt", kind: "file" }],
    })
  })

  test("separates PowerShell file redirects and extracts their literal target", async () => {
    expect(await analyze('Write-Host hi > "C:/outside/result file.txt"', "powershell")).toEqual({
      resources: ["Write-Host hi", "redirect > C:/outside/result file.txt"],
      save: [],
      pathHints: [{ value: "C:/outside/result file.txt", kind: "file" }],
    })
  })

  test("fails closed for dynamic PowerShell redirects and paths", async () => {
    for (const command of ["Write-Host hi > $target", "Remove-Item -Path $target", "Write-Host hi 2>&1"]) {
      const error = await failure(command, "powershell")
      expect(error).toBeInstanceOf(ShellCommand.AnalysisError)
      expect(error.reason).toBe("unsupported")
    }
  })

  test("does not turn nested expressions into shell commands", async () => {
    expect(await analyze("Write-Output ('a' * 3)", "powershell")).toEqual({
      resources: ["Write-Output ('a' * 3)"],
      save: [],
      pathHints: [],
    })
  })

  test("fails closed for static method invocation outside command nodes", async () => {
    const error = await failure('[IO.File]::WriteAllText("x", "y")', "powershell")
    expect(error).toBeInstanceOf(ShellCommand.AnalysisError)
    expect(error.reason).toBe("unsupported")
  })

  test("does not treat cwd plus an unrecognized statement as pure cwd", async () => {
    const error = await failure("Set-Location C:/outside; $value = 1", "powershell")
    expect(error).toBeInstanceOf(ShellCommand.AnalysisError)
    expect(error.reason).toBe("unsupported")
  })

  test("allows one literal Set-Location target", async () => {
    expect(await analyze('Set-Location -LiteralPath "C:/outside dir"', "powershell")).toEqual({
      resources: [],
      save: [],
      pathHints: [{ value: "C:/outside dir", kind: "directory" }],
    })
  })

  test("rejects PowerShell stack, targetless, and compound cwd commands", async () => {
    for (const command of [
      "Set-Location",
      "Set-Location -",
      "Pop-Location",
      "Push-Location C:/outside",
      "Set-Location C:/sub; Get-Content ../x",
    ]) {
      const error = await failure(command, "powershell")
      expect(error).toBeInstanceOf(ShellCommand.AnalysisError)
      expect(error.reason).toBe("unsupported")
    }
  })

  test("rejects PowerShell wrappers that can execute arbitrary commands", async () => {
    for (const command of [
      'pwsh -Command "Get-Content C:/outside.txt"',
      'Invoke-Expression "Get-Content C:/outside.txt"',
    ]) {
      const error = await failure(command, "powershell")
      expect(error).toBeInstanceOf(ShellCommand.AnalysisError)
      expect(error.reason).toBe("unsupported")
    }
  })

  test("rejects the PowerShell call invocation operator", async () => {
    const error = await failure("& git status", "powershell")
    expect(error).toBeInstanceOf(ShellCommand.AnalysisError)
    expect(error.reason).toBe("unsupported")
  })

  test("rejects PowerShell dot-sourcing", async () => {
    const error = await failure(". ./script.ps1", "powershell")
    expect(error).toBeInstanceOf(ShellCommand.AnalysisError)
    expect(error.reason).toBe("unsupported")
  })
})

describe("ShellCommand cmd analysis", () => {
  test("rejects cmd until a constrained tokenizer exists", async () => {
    for (const command of [
      "TYPE file.txt",
      "echo 'quoted'",
      "echo one ^& echo two",
      "echo %TEMP%",
      "CD sub",
      "PUSHD sub",
    ]) {
      const error = await failure(command, "cmd")
      expect(error).toBeInstanceOf(ShellCommand.AnalysisError)
      expect(error.reason).toBe("unsupported")
    }
  })
})
