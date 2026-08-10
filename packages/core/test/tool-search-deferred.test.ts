import { describe, expect, test } from "bun:test"
import { searchDeferred } from "@opencode-ai/core/tool/registry"
import { ToolDefinition } from "@opencode-ai/llm"

const def = (name: string, description: string): ToolDefinition =>
  new ToolDefinition({ name, description, inputSchema: {} })

describe("searchDeferred", () => {
  test("ranks description matches over non-matches", () => {
    const tools = [
      def("playwright_snapshot", "Take a screenshot of the current browser page"),
      def("bash", "Execute a shell command"),
    ]
    const hits = searchDeferred("browser page screenshot", tools, 10)
    expect(hits[0]?.name).toBe("playwright_snapshot")
  })

  test("respects limit", () => {
    const tools = [
      def("a", "alpha beta gamma"),
      def("b", "alpha beta delta"),
      def("c", "alpha epsilon zeta"),
    ]
    const hits = searchDeferred("alpha beta", tools, 2)
    expect(hits.length).toBeLessThanOrEqual(2)
  })
})
