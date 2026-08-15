import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { CheckboxV2 } from "@opencode-ai/ui/v2/checkbox-v2"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@opencode-ai/ui/v2/dialog-v2"
import { DividerV2 } from "@opencode-ai/ui/v2/divider-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { For, Show, type Component } from "solid-js"
import { createStore } from "solid-js/store"
import { useServerSDK } from "@/context/server-sdk"
import type { ServerApi } from "@/utils/server"
import "./settings-v2.css"

type Catalog = Awaited<ReturnType<ServerApi["plugins"]["list"]>>
type Inspection = Awaited<ReturnType<ServerApi["plugins"]["inspectDirect"]>>

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string") {
    return error.message
  }
  return String(error)
}

function entries(text: string, label: string) {
  return Object.fromEntries(
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const separator = line.indexOf("=")
        if (separator < 1) throw new Error(`${label} must use KEY=VALUE lines`)
        return [line.slice(0, separator).trim(), line.slice(separator + 1)]
      }),
  )
}

export const DialogInstallExtension: Component<{
  onInstalled: (catalog: Catalog) => void | Promise<void>
}> = (props) => {
  const dialog = useDialog()
  const sdk = useServerSDK()
  const [state, setState] = createStore({
    kind: "plugin" as "plugin" | "mcp",
    mcpType: "remote" as "remote" | "local",
    source: "",
    name: "",
    url: "",
    command: "",
    arguments: "",
    headers: "",
    environment: "",
    inspection: undefined as Inspection | undefined,
    trusted: false,
    approved: [] as string[],
    busy: false,
    error: undefined as string | undefined,
  })

  const switchKind = (kind: "plugin" | "mcp") => {
    setState("kind", kind)
    setState("error", undefined)
  }

  const inspect = async () => {
    const source = state.source.trim()
    if (!source) return
    setState({ busy: true, error: undefined, inspection: undefined, trusted: false, approved: [] })
    const result = await sdk()
      .apiForGeneration()
      .then((api) => api.plugins.inspectDirect({ source }))
      .then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error }),
      )
    setState("busy", false)
    if (!result.ok) {
      setState("error", errorMessage(result.error))
      return
    }
    setState("inspection", result.value)
  }

  const approve = (name: string, approved: boolean) => {
    setState("approved", (current) =>
      approved ? Array.from(new Set([...current, name])) : current.filter((item) => item !== name),
    )
  }

  const complete = async (catalog: Catalog) => {
    const result = await Promise.resolve()
      .then(() => props.onInstalled(catalog))
      .then(
        () => ({ ok: true as const }),
        (error: unknown) => ({ ok: false as const, error }),
      )
    if (!result.ok) {
      setState({ busy: false, error: errorMessage(result.error) })
      return
    }
    dialog.close()
  }

  const installPlugin = async () => {
    const inspection = state.inspection
    if (!inspection) return
    setState({ busy: true, error: undefined })
    const result = await sdk()
      .apiForGeneration()
      .then((api) =>
        api.plugins.installDirect({
          source: inspection.source,
          trusted: state.trusted,
          approvedCapabilities: state.approved,
        }),
      )
      .then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error }),
      )
    if (!result.ok) {
      setState({ busy: false, error: errorMessage(result.error) })
      return
    }
    await complete(result.value)
  }

  const installMcp = async () => {
    const name = state.name.trim()
    setState({ busy: true, error: undefined })
    const result = await Promise.resolve()
      .then(() => {
        if (!name) throw new Error("MCP server name is required")
        if (state.mcpType === "remote") {
          const url = state.url.trim()
          if (!url) throw new Error("Remote URL is required")
          return sdk()
            .apiForGeneration()
            .then((api) =>
              api.plugins.installMcp({
                name,
                config: {
                  type: "remote",
                  url,
                  ...(state.headers.trim() ? { headers: entries(state.headers, "Headers") } : {}),
                },
              }),
            )
        }

        const command = state.command.trim()
        if (!command) throw new Error("Local command is required")
        return sdk()
          .apiForGeneration()
          .then((api) =>
            api.plugins.installMcp({
              name,
              config: {
                type: "local",
                command: [
                  command,
                  ...state.arguments
                    .split(/\r?\n/)
                    .map((line) => line.trim())
                    .filter(Boolean),
                ],
                ...(state.environment.trim() ? { environment: entries(state.environment, "Environment") } : {}),
              },
            }),
          )
      })
      .then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error }),
      )
    if (!result.ok) {
      setState({ busy: false, error: errorMessage(result.error) })
      return
    }
    await complete(result.value)
  }

  const approvalsComplete = () =>
    state.trusted &&
    (state.inspection?.requestedCapabilities.every((item) => state.approved.includes(item.name)) ?? false)

  return (
    <Dialog fit class="settings-v2-extension-dialog">
      <DialogHeader>
        <DialogTitle>Install extension</DialogTitle>
      </DialogHeader>
      <DividerV2 />
      <DialogBody class="settings-v2-extension-dialog-body">
        <div class="settings-v2-extension-segments">
          <ButtonV2
            size="small"
            variant={state.kind === "plugin" ? "contrast" : "ghost-muted"}
            disabled={state.busy}
            onClick={() => switchKind("plugin")}
          >
            Plugin
          </ButtonV2>
          <ButtonV2
            size="small"
            variant={state.kind === "mcp" ? "contrast" : "ghost-muted"}
            disabled={state.busy}
            onClick={() => switchKind("mcp")}
          >
            MCP
          </ButtonV2>
        </div>

        <Show
          when={state.kind === "plugin"}
          fallback={
            <div class="settings-v2-extension-form">
              <label class="settings-v2-server-dialog-label">Name</label>
              <TextInputV2
                value={state.name}
                onInput={(event) => setState("name", event.currentTarget.value)}
                placeholder="my-mcp-server"
                disabled={state.busy}
                autofocus
              />
              <div class="settings-v2-extension-segments">
                <ButtonV2
                  size="small"
                  variant={state.mcpType === "remote" ? "contrast" : "ghost-muted"}
                  disabled={state.busy}
                  onClick={() => setState("mcpType", "remote")}
                >
                  Remote
                </ButtonV2>
                <ButtonV2
                  size="small"
                  variant={state.mcpType === "local" ? "contrast" : "ghost-muted"}
                  disabled={state.busy}
                  onClick={() => setState("mcpType", "local")}
                >
                  Local
                </ButtonV2>
              </div>
              <Show
                when={state.mcpType === "remote"}
                fallback={
                  <>
                    <label class="settings-v2-server-dialog-label">Command</label>
                    <TextInputV2
                      value={state.command}
                      onInput={(event) => setState("command", event.currentTarget.value)}
                      placeholder="bunx"
                      disabled={state.busy}
                    />
                    <label class="settings-v2-server-dialog-label">Arguments</label>
                    <textarea
                      class="settings-v2-extension-textarea"
                      value={state.arguments}
                      onInput={(event) => setState("arguments", event.currentTarget.value)}
                      placeholder={"One argument per line\n@modelcontextprotocol/server-filesystem"}
                      disabled={state.busy}
                    />
                    <label class="settings-v2-server-dialog-label">Environment</label>
                    <textarea
                      class="settings-v2-extension-textarea"
                      value={state.environment}
                      onInput={(event) => setState("environment", event.currentTarget.value)}
                      placeholder="KEY=VALUE"
                      disabled={state.busy}
                    />
                  </>
                }
              >
                <label class="settings-v2-server-dialog-label">URL</label>
                <TextInputV2
                  value={state.url}
                  onInput={(event) => setState("url", event.currentTarget.value)}
                  placeholder="https://example.com/mcp"
                  disabled={state.busy}
                />
                <label class="settings-v2-server-dialog-label">Headers</label>
                <textarea
                  class="settings-v2-extension-textarea"
                  value={state.headers}
                  onInput={(event) => setState("headers", event.currentTarget.value)}
                  placeholder="Authorization=Bearer ..."
                  disabled={state.busy}
                />
              </Show>
            </div>
          }
        >
          <div class="settings-v2-extension-form">
            <label class="settings-v2-server-dialog-label">Package, Git URL, or local path</label>
            <div class="settings-v2-extension-source">
              <TextInputV2
                value={state.source}
                onInput={(event) => {
                  setState("source", event.currentTarget.value)
                  setState("inspection", undefined)
                  setState("trusted", false)
                  setState("approved", [])
                }}
                placeholder="package-name, git+https://..., or C:\\path\\plugin"
                disabled={state.busy}
                autofocus
              />
              <ButtonV2
                variant="neutral"
                size="small"
                icon="search"
                disabled={!state.source.trim() || state.busy}
                onClick={() => void inspect()}
              >
                Inspect
              </ButtonV2>
            </div>
            <Show when={state.inspection}>
              {(inspection) => (
                <div class="settings-v2-extension-inspection">
                  <div class="settings-v2-extension-manifest">
                    <strong>{inspection().name}</strong>
                    <span>{inspection().version ?? "Unversioned"}</span>
                    <span>{inspection().targets.join(" + ")}</span>
                  </div>
                  <Show when={inspection().description}>
                    {(description) => <span class="settings-v2-extension-muted">{description()}</span>}
                  </Show>
                  <div class="settings-v2-extension-warning">
                    Direct plugins run inside the OpenCode process with its filesystem and network access.
                  </div>
                  <CheckboxV2
                    checked={state.trusted}
                    onChange={(trusted) => setState("trusted", trusted)}
                    label="Trust this source"
                    description="Allow this plugin package to execute in the OpenCode process"
                    disabled={state.busy}
                  />
                  <Show when={inspection().requestedCapabilities.length > 0}>
                    <div class="settings-v2-extension-capabilities">
                      <For each={inspection().requestedCapabilities}>
                        {(item) => (
                          <CheckboxV2
                            checked={state.approved.includes(item.name)}
                            onChange={(checked) => approve(item.name, checked)}
                            label={item.name}
                            description={
                              item.tier === "trusted-runtime"
                                ? "Trusted runtime access requested"
                                : `${item.tier} capability`
                            }
                            disabled={state.busy}
                          />
                        )}
                      </For>
                    </div>
                  </Show>
                </div>
              )}
            </Show>
          </div>
        </Show>

        <Show when={state.error}>{(message) => <div class="settings-v2-plugins-error">{message()}</div>}</Show>
      </DialogBody>
      <DialogFooter>
        <ButtonV2 variant="neutral" disabled={state.busy} onClick={() => dialog.close()}>
          Cancel
        </ButtonV2>
        <Show
          when={state.kind === "plugin"}
          fallback={
            <ButtonV2 variant="contrast" disabled={state.busy} onClick={() => void installMcp()}>
              {state.busy ? "Installing..." : "Install MCP"}
            </ButtonV2>
          }
        >
          <ButtonV2
            variant="contrast"
            disabled={state.busy || !state.inspection || !approvalsComplete()}
            onClick={() => void installPlugin()}
          >
            {state.busy ? "Installing..." : "Install plugin"}
          </ButtonV2>
        </Show>
      </DialogFooter>
    </Dialog>
  )
}
