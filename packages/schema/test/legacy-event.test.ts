import { describe, expect, test } from "bun:test"
import { PermissionV1 } from "../src/permission-v1"
import { QuestionV1 } from "../src/question-v1"
import { Project } from "../src/project"

describe("legacy public event schemas", () => {
  test("owns the legacy transient public definitions", () => {
    expect([
      PermissionV1.Event.Asked.type,
      PermissionV1.Event.Replied.type,
      QuestionV1.Event.Asked.type,
      QuestionV1.Event.Replied.type,
      QuestionV1.Event.Rejected.type,
      Project.Event.Updated.type,
    ]).toEqual([
      "permission.asked",
      "permission.replied",
      "question.asked",
      "question.replied",
      "question.rejected",
      "project.updated",
    ])
  })
})
