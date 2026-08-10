import { createRoot } from "solid-js"
import { createSimpleContext } from "@opencode-ai/ui/context"

const { provider: P } = createSimpleContext({ name: "t", init: () => ({ v: 1 }), gate: false })

test("helper pragma", () => {
  createRoot(() => {
    const el = P({ children: undefined }) as unknown as { v: number }
    expect(el).toBeTruthy()
  })
})
