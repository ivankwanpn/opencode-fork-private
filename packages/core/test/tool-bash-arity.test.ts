import { describe, expect, test } from "bun:test"
import { BashArity } from "@opencode-ai/core/tool/bash-arity"

describe("BashArity.savePattern", () => {
  test("builds only explicitly allowed reusable prefixes", () => {
    expect(BashArity.savePattern(["git", "status", "--short"])).toBe("git status *")
    expect(BashArity.savePattern(["git", "log", "--oneline"])).toBe("git log *")
    expect(BashArity.savePattern(["npm", "run", "test", "--", "--watch"])).toBe("npm run test *")
    expect(BashArity.savePattern(["ls", "-la"])).toBe("ls *")
    expect(BashArity.savePattern(["echo", "safe"])).toBe("echo *")
  })

  test("does not create reusable patterns for unknown, wrapper, or assigned commands", () => {
    expect(BashArity.savePattern(["project-script", "deploy"])).toBeUndefined()
    expect(BashArity.savePattern(["env", "MODE=test", "git", "status"])).toBeUndefined()
    expect(BashArity.savePattern(["sudo", "git", "status"])).toBeUndefined()
    expect(BashArity.savePattern(["source", "./env.sh"])).toBeUndefined()
    expect(BashArity.savePattern(["bash", "-c", "git status"])).toBeUndefined()
    expect(BashArity.savePattern(["MODE=test", "git", "status"])).toBeUndefined()
  })

  test("refuses destructive and remote-execution subcommands", () => {
    expect(BashArity.savePattern(["git", "clean", "-fdx"])).toBeUndefined()
    expect(BashArity.savePattern(["docker", "exec", "container", "sh"])).toBeUndefined()
    expect(BashArity.savePattern(["kubectl", "exec", "pod", "--", "sh"])).toBeUndefined()
    expect(BashArity.savePattern(["ip", "netns", "exec", "ns", "sh"])).toBeUndefined()
    expect(BashArity.savePattern(["systemctl", "restart", "service"])).toBeUndefined()
    expect(BashArity.savePattern(["terraform", "destroy"])).toBeUndefined()
    expect(BashArity.savePattern(["rm", "-rf", "build"])).toBeUndefined()
  })

  test("refuses flags before a subcommand and every shell expansion surface", () => {
    expect(BashArity.savePattern(["git", "-C", "../repo", "status"])).toBeUndefined()
    expect(BashArity.savePattern(["npm", "--silent", "run", "test"])).toBeUndefined()
    expect(BashArity.savePattern(["npm", "run", "--silent", "test"])).toBeUndefined()
    expect(BashArity.savePattern(["git", "log", "release/*"])).toBeUndefined()
    expect(BashArity.savePattern(["git", "log", "feature?"])).toBeUndefined()
    expect(BashArity.savePattern(["git", "log", "[ab]"])).toBeUndefined()
    expect(BashArity.savePattern(["git", "log", "$REF"])).toBeUndefined()
    expect(BashArity.savePattern(["echo", "$(pwd)"])).toBeUndefined()
    expect(BashArity.savePattern(["echo", "`pwd`"])).toBeUndefined()
    expect(BashArity.savePattern(["echo", "{a,b}"])).toBeUndefined()
    expect(BashArity.savePattern(["echo", "~/secret"])).toBeUndefined()
    expect(BashArity.savePattern(["echo", "%TEMP%"])).toBeUndefined()
    expect(BashArity.savePattern(["echo", "%1"])).toBeUndefined()
    expect(BashArity.savePattern(["echo", "%~dp0"])).toBeUndefined()
    expect(BashArity.savePattern(["echo", "!TEMP!"])).toBeUndefined()
    expect(BashArity.savePattern(["echo", "(Get-Item)"])).toBeUndefined()
    expect(BashArity.savePattern(["echo", "one^&two"])).toBeUndefined()
  })
})
