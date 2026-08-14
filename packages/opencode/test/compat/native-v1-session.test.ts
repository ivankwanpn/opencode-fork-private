import { describe, expect, test } from "bun:test"
import { DateTime } from "effect"
import { AgentV2 } from "@opencode-ai/core/agent"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProjectV2 } from "@opencode-ai/core/project"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionSchema } from "@opencode-ai/core/session/schema"
import { AbsolutePath, RelativePath } from "@opencode-ai/core/schema"
import { WorkspaceV2 } from "@opencode-ai/core/workspace"
import { MessageID, PartID } from "@/session/schema"
import { legacySessionFromV2 } from "../../src/compat/native-v1-session"

describe("legacySessionFromV2", () => {
  test("projects a canonical V2 info into the V1 wire shape", () => {
    const created = DateTime.makeUnsafe(1000)
    const updated = DateTime.makeUnsafe(2000)
    const info = SessionSchema.Info.make({
      id: SessionSchema.ID.make("sess_v2id"),
      projectID: ProjectV2.ID.make("prj_1"),
      title: "hello",
      metadata: { source: "sdk", trace: { id: "abc" } },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created, updated },
      location: { directory: AbsolutePath.make("D:/work/app"), workspaceID: WorkspaceV2.ID.make("wrk_1") },
      subpath: RelativePath.make("packages/opencode"),
      agent: AgentV2.ID.make("build"),
      model: {
        id: ModelV2.ID.make("claude-sonnet-5"),
        providerID: ProviderV2.ID.make("anthropic"),
        variant: ModelV2.VariantID.make("default"),
      },
      share: { url: "https://share.example/s" },
      revert: {
        messageID: SessionMessage.ID.make("msg_1"),
        partID: "prt_1",
        snapshot: "snap",
        diff: "diff",
      },
    })

    const projected = legacySessionFromV2(info)

    expect(projected.id).toBe(SessionSchema.ID.make("sess_v2id"))
    expect(projected.slug).toBe("sess_v2id")
    expect(projected.version).toBe("2")
    expect(projected.projectID).toBe(ProjectV2.ID.make("prj_1"))
    expect(projected.directory).toBe("D:/work/app")
    expect(projected.workspaceID).toBe(WorkspaceV2.ID.make("wrk_1"))
    expect(projected.path).toBe("packages/opencode")
    expect(projected.title).toBe("hello")
    expect(projected.metadata).toEqual({ source: "sdk", trace: { id: "abc" } })
    expect(projected.agent).toBe("build")
    expect(projected.model).toEqual({
      id: ModelV2.ID.make("claude-sonnet-5"),
      providerID: ProviderV2.ID.make("anthropic"),
      variant: ModelV2.VariantID.make("default"),
    })
    expect(projected.share).toEqual({ url: "https://share.example/s" })
    expect(projected.time).toEqual({ created: 1000, updated: 2000 })
    expect(projected.revert).toEqual({
      messageID: MessageID.make("msg_1"),
      partID: PartID.make("prt_1"),
      snapshot: "snap",
      diff: "diff",
    })
    expect(Object.hasOwn(projected, "summary")).toBe(false)
    expect(Object.hasOwn(projected, "permission")).toBe(false)
  })

  test("projects undefined optional fields and dates as undefined", () => {
    const info = SessionSchema.Info.make({
      id: SessionSchema.ID.make("sess_v2id"),
      projectID: ProjectV2.ID.make("prj_1"),
      title: "hello",
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: DateTime.makeUnsafe(1000), updated: DateTime.makeUnsafe(1000) },
      location: { directory: AbsolutePath.make("D:/work") },
    })

    const projected = legacySessionFromV2(info)

    expect(projected.parentID).toBeUndefined()
    expect(projected.path).toBeUndefined()
    expect(projected.workspaceID).toBeUndefined()
    expect(projected.agent).toBeUndefined()
    expect(projected.model).toBeUndefined()
    expect(projected.share).toBeUndefined()
    expect(projected.revert).toBeUndefined()
    expect(projected.metadata).toBeUndefined()
    expect(projected.time.compacting).toBeUndefined()
    expect(projected.time.archived).toBeUndefined()
  })
})
