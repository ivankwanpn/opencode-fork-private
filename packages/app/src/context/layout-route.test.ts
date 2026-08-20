import { expect, test } from "bun:test"
import { currentRoute } from "./layout-route"

test("recognizes error detail tabs", () => {
  expect(currentRoute("/error/err_1", "")).toEqual({ type: "error", errorID: "err_1" })
})
