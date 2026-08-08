import { expect, test } from "@playwright/test"
import {
  assistantMessage,
  connected,
  partUpdated,
  setupTimeline,
  status,
  textPart,
  userMessage,
} from "../performance/timeline-stability/fixture"

test("keeps one connection open while delivering multiple events", async ({ page }) => {
  const timeline = await setupTimeline(page)

  const first = await timeline.transport.send(partUpdated(textPart("prt_transport_first", "first event")))
  const second = await timeline.transport.send(partUpdated(textPart("prt_transport_second", "second event")))

  await timeline.waitForPart("prt_transport_first")
  await timeline.waitForPart("prt_transport_second")
  expect(first.connectionID).toBe(second.connectionID)
  expect(await timeline.transport.connections()).toHaveLength(1)
  expect(await timeline.transport.acknowledgements()).toHaveLength(2)
})

test("delivers a burst from one stream chunk", async ({ page }) => {
  const timeline = await setupTimeline(page)
  const acknowledgements = await timeline.transport.burst([
    partUpdated(textPart("prt_transport_burst_a", "burst a")),
    partUpdated(textPart("prt_transport_burst_b", "burst b")),
  ])

  await timeline.waitForPart("prt_transport_burst_a")
  await timeline.waitForPart("prt_transport_burst_b")
  expect(acknowledgements.map((item) => item.chunkCount)).toEqual([1, 1])
  expect(new Set(acknowledgements.map((item) => item.deliveryID)).size).toBe(2)
})

test("delivers bounded batches over one connection", async ({ page }) => {
  const timeline = await setupTimeline(page)
  const parts = Array.from({ length: 5 }, (_, index) =>
    partUpdated(textPart(`prt_transport_batch_${index}`, `batch ${index}`)),
  )

  const acknowledgements = await timeline.transport.batches(parts, { size: 2, delay: 5 })

  await Promise.all(parts.map((event) => timeline.waitForPart(event.data.part.id)))
  expect(acknowledgements).toHaveLength(5)
  expect(acknowledgements.at(-1)!.deliveredAt - acknowledgements[0]!.deliveredAt).toBeGreaterThanOrEqual(5)
  expect(new Set(acknowledgements.map((item) => item.connectionID))).toEqual(
    new Set([acknowledgements[0]!.connectionID]),
  )
  expect(await timeline.transport.connections()).toHaveLength(1)
})

test("schedules paced batches without blocking the caller", async ({ page }) => {
  const timeline = await setupTimeline(page)
  const parts = Array.from({ length: 3 }, (_, index) =>
    partUpdated(textPart(`prt_transport_scheduled_${index}`, `scheduled ${index}`)),
  )

  await timeline.transport.schedule(parts, { size: 1, delay: 20 })

  expect(await timeline.transport.acknowledgements()).toHaveLength(1)
  await Promise.all(parts.map((event) => timeline.waitForPart(event.data.part.id)))
  expect(await timeline.transport.acknowledgements()).toHaveLength(3)
})

test("parses split JSON and a split multibyte code point", async ({ page }) => {
  const timeline = await setupTimeline(page)
  const payload = partUpdated(textPart("prt_transport_split", "split snowman \u2603\u2603\u2603"))
  const encoded = new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`)
  const snowman = new TextEncoder().encode("\u2603")[0]!
  const multibyte = encoded.indexOf(snowman)

  const acknowledgement = await timeline.transport.split(payload, [9, multibyte + 1, multibyte + 2])

  await timeline.waitForPart("prt_transport_split")
  await expect(page.locator('[data-timeline-part-id="prt_transport_split"]')).toContainText(
    "split snowman \u2603\u2603\u2603",
  )
  expect(acknowledgement.chunkCount).toBe(4)
})

test("delivers server heartbeat without mutating the timeline", async ({ page }) => {
  const timeline = await setupTimeline(page, {
    messages: [userMessage(), assistantMessage([textPart("prt_transport_steady", "steady")])],
  })
  const before = await page.locator("[data-timeline-row]").allTextContents()

  const acknowledgement = await timeline.transport.heartbeat({ marker: "heartbeat" })
  await timeline.settle()

  expect(await page.locator("[data-timeline-row]").allTextContents()).toEqual(before)
  expect(await timeline.transport.connections()).toHaveLength(1)
  expect(acknowledgement.bytes).toBe(new TextEncoder().encode(": heartbeat\n\n").byteLength)
  expect(acknowledgement.eventID).toBeUndefined()
})

test("reconnects after a clean close", async ({ page }) => {
  const timeline = await setupTimeline(page, { eventRetry: 10 })
  const first = await timeline.transport.waitForConnection()

  await timeline.transport.close()
  const second = await timeline.transport.waitForConnection({ after: first.id })
  await timeline.transport.send(partUpdated(textPart("prt_transport_close", "after close")))

  await timeline.waitForPart("prt_transport_close")
  expect(second.id).toBeGreaterThan(first.id)
  expect((await timeline.transport.connections())[0]?.endedBy).toBe("close")
})

test("reconnects after a stream error", async ({ page }) => {
  const timeline = await setupTimeline(page, { eventRetry: 10 })
  const first = await timeline.transport.waitForConnection()

  await timeline.transport.error("contract failure")
  const second = await timeline.transport.waitForConnection({ after: first.id })
  await timeline.transport.send(status("busy"))

  await expect.poll(async () => (await timeline.transport.connections()).length).toBe(2)
  expect(second.id).toBeGreaterThan(first.id)
  expect((await timeline.transport.connections())[0]?.endedBy).toBe("error")
})

test("refreshes an open idle session after reconnect", async ({ page }) => {
  const partial = [userMessage(), assistantMessage([textPart("prt_transport_recovery", "partial canonical answer")])]
  const timeline = await setupTimeline(page, { messages: partial, eventRetry: 10 })
  await expect(page.getByText("partial canonical answer", { exact: true })).toBeVisible()

  timeline.replaceMessages([
    userMessage(),
    assistantMessage([textPart("prt_transport_recovery", "complete canonical answer after reconnect")]),
  ])
  const first = await timeline.transport.waitForConnection()
  await timeline.transport.close()
  await timeline.transport.waitForConnection({ after: first.id })
  await timeline.transport.send(connected())

  await expect(page.getByText("complete canonical answer after reconnect", { exact: true })).toBeVisible()
  await expect(page.getByText("partial canonical answer", { exact: true })).toHaveCount(0)
})

test("records event IDs and reconnect Last-Event-ID headers", async ({ page }) => {
  const timeline = await setupTimeline(page, { eventRetry: 10 })
  const payload = partUpdated(textPart("prt_transport_id", "event with id"))
  const first = await timeline.transport.send(payload, { id: payload.id })
  await timeline.waitForPart("prt_transport_id")

  await timeline.transport.error("retry with event id")
  const connection = await timeline.transport.waitForConnection({ after: first.connectionID })

  expect(first.eventID).toBe(payload.id)
  expect(connection.headers["last-event-id"]).toBe(payload.id)
})

test("passes through non-event fetches", async ({ page }) => {
  const timeline = await setupTimeline(page)

  const health = await page.evaluate(async (server) => {
    const response = await fetch(new URL("/api/health", server))
    return response.json()
  }, timeline.transport.server)

  expect(health).toMatchObject({ healthy: true })
  expect(await timeline.transport.connections()).toHaveLength(1)
})
