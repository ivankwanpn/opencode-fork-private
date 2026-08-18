/** @jsxImportSource @opentui/solid */
import { describe, expect, test } from "bun:test"
import type { OpenCodeEvent } from "@opencode-ai/client"
import { testRender } from "@opentui/solid"
import type { Event, GlobalEvent } from "@opencode-ai/sdk/v2"
import { onMount } from "solid-js"
import { ProjectProvider, useProject } from "../../../src/context/project"
import { SDKProvider } from "../../../src/context/sdk"
import { useEvent } from "../../../src/context/event"
import { createEventSource, createFetch, directory } from "../../fixture/tui-sdk"
import { TestTuiContexts } from "../../fixture/tui-environment"

const projectID = "proj_test"

async function wait(fn: () => boolean, timeout = 2000) {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > timeout) throw new Error("timed out waiting for condition")
    await Bun.sleep(10)
  }
}

function event(payload: Event, input: { directory: string; project?: string; workspace?: string }): GlobalEvent {
  return {
    directory: input.directory,
    project: input.project,
    workspace: input.workspace,
    payload,
  }
}

function vcs(branch: string): Event {
  return {
    id: `evt_vcs_${branch}`,
    type: "vcs.branch.updated",
    properties: {
      branch,
    },
  }
}

function connected(): Event {
  return {
    id: "evt_connected",
    type: "server.connected",
    properties: {},
  }
}

function status(): Event {
  return {
    id: "evt_status",
    type: "session.next.status",
    properties: {
      timestamp: 1,
      sessionID: "ses_test",
      status: { type: "busy" },
    },
  }
}

async function mount() {
  const events = createEventSource()
  const calls = createFetch()
  const seen: Event[] = []
  const workspaces: Array<string | undefined> = []
  let project!: ReturnType<typeof useProject>
  let done!: () => void
  const ready = new Promise<void>((resolve) => {
    done = resolve
  })

  const app = await testRender(() => (
    <TestTuiContexts>
      <SDKProvider url="http://test" directory={directory} events={events.source} fetch={calls.fetch}>
        <ProjectProvider>
          <Probe
            onReady={async (ctx) => {
              project = ctx.project
              await project.sync()
              done()
            }}
            seen={seen}
            workspaces={workspaces}
          />
        </ProjectProvider>
      </SDKProvider>
    </TestTuiContexts>
  ))

  await ready
  return { app, emit: events.emit, emitNative: events.emitNative, project, seen, workspaces }
}

function Probe(props: {
  seen: Event[]
  workspaces: Array<string | undefined>
  onReady: (ctx: { project: ReturnType<typeof useProject> }) => void
}) {
  const project = useProject()
  const event = useEvent()

  onMount(() => {
    event.subscribe((evt, { workspace }) => {
      props.seen.push(evt)
      props.workspaces.push(workspace)
    })
    props.onReady({ project })
  })

  return <box />
}

describe("useEvent", () => {
  test("delivers events for the current project", async () => {
    const { app, emit, seen, workspaces } = await mount()

    try {
      emit(event(vcs("main"), { directory: "/tmp/other", project: projectID, workspace: "ws_a" }))

      await wait(() => seen.length === 1)

      expect(seen).toEqual([vcs("main")])
      expect(workspaces).toEqual(["ws_a"])
    } finally {
      app.renderer.destroy()
    }
  })

  test("delivers current project events regardless of active workspace", async () => {
    const { app, emit, project, seen } = await mount()

    try {
      project.workspace.set("ws_a")
      emit(event(vcs("ws"), { directory: "/tmp/other", project: projectID, workspace: "ws_b" }))

      await wait(() => seen.length === 1)

      expect(seen).toEqual([vcs("ws")])
    } finally {
      app.renderer.destroy()
    }
  })

  test("delivers truly global events even when a workspace is active", async () => {
    const { app, emit, project, seen } = await mount()

    try {
      project.workspace.set("ws_a")
      emit(event(connected(), { directory: "global" }))

      await wait(() => seen.length === 1)

      expect(seen).toEqual([connected()])
    } finally {
      app.renderer.destroy()
    }
  })

  test("does not project native session status into the compatibility stream", async () => {
    const { app, emit, seen } = await mount()

    try {
      emit(event(status(), { directory, project: projectID }))
      await Bun.sleep(30)

      expect(seen).toEqual([])
    } finally {
      app.renderer.destroy()
    }
  })

  test("does not project canonical question and permission events into the compatibility stream", async () => {
    const { app, emitNative, seen } = await mount()

    try {
      emitNative({
        id: "evt_question",
        type: "question.v2.asked",
        data: { id: "que_test", sessionID: "ses_test", questions: [] },
      } as OpenCodeEvent)
      emitNative({
        id: "evt_permission",
        type: "permission.v2.asked",
        data: { id: "per_test", sessionID: "ses_test", action: "edit", resources: [] },
      } as OpenCodeEvent)
      await Bun.sleep(30)

      expect(seen).toEqual([])
    } finally {
      app.renderer.destroy()
    }
  })
})
