import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Command } from "../src/command"
import { EventManifest } from "../src/event-manifest"

describe("Command.Event.Executed", () => {
  test("owns the current live command execution event", () => {
    const input: unknown = {
      id: "evt_command_executed",
      type: "command.executed",
      data: {
        name: "init",
        sessionID: "ses_command",
        arguments: "--force",
        messageID: "msg_command",
      },
    }
    const expected: unknown = {
      id: "evt_command_executed",
      type: "command.executed",
      data: {
        name: "init",
        sessionID: "ses_command",
        arguments: "--force",
        messageID: "msg_command",
      },
    }

    expect(Command.Event).toBeDefined()
    if (!Command.Event) return

    expect(Command.Event.Executed.type).toBe("command.executed")
    expect(Command.Event.Executed.durable).toBeUndefined()
    expect(EventManifest.Latest.get("command.executed")).toBe(Command.Event.Executed)
    expect([...EventManifest.Durable.keys()].some((type) => type.startsWith("command.executed."))).toBe(false)

    expect(Schema.decodeUnknownSync(Command.Event.Executed)(input) as unknown).toEqual(expected)
  })
})
