import { expect, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import { createSimpleContext } from "./helper"

test("renders a gated provider after readiness changes", () => {
  let setReady = (_value: boolean) => {}
  let rendered = 0
  let observed: string | undefined

  const context = createSimpleContext({
    name: "Test",
    gate: true,
    init: () => {
      const [ready, updateReady] = createSignal(false)
      setReady = updateReady
      return { ready, value: "ready" }
    },
  })

  createRoot((dispose) => {
    context.provider({
      get children() {
        rendered += 1
        observed = context.use().value
        return "child"
      },
    })

    expect(rendered).toBe(0)
    setReady(true)
    expect(rendered).toBe(1)
    expect(observed).toBe("ready")
    dispose()
  })
})
