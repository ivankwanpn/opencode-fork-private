export * as ApplicationTools from "./application-tools"

import { Context, Effect, Layer, Scope } from "effect"
import { State } from "../state"
import { ToolCatalog } from "./catalog"
import { Tool } from "./tool"
import { makeGlobalNode } from "../effect/app-node"

type Data = {
  readonly entries: Map<string, Entry>
}

type Draft = {
  readonly set: (name: string, entry: Entry) => void
}

export interface Entry {
  readonly identity: object
  readonly tool: Tool.AnyTool
  readonly catalog: ToolCatalog.Metadata
}

export interface Interface {
  readonly register: (
    tools: Readonly<Record<string, Tool.AnyTool>>,
  ) => Effect.Effect<void, Tool.RegistrationError, Scope.Scope>
  readonly entries: () => ReadonlyMap<string, Entry>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ApplicationTools") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const state = State.create<Data, Draft>({
      initial: () => ({ entries: new Map() }),
      draft: (draft) => ({
        set: (name, tool) => {
          draft.entries.set(name, tool)
        },
      }),
    })

    return Service.of({
      register: Effect.fn("ApplicationTools.register")(function* (tools) {
        const entries = Object.entries(tools)
        if (entries.length === 0) return
        yield* Effect.forEach(entries, ([name]) => Tool.validateName(name), { discard: true })
        const source = { type: "app" as const, id: "opencode-sdk", displayName: "OpenCode SDK" }
        const registrations = yield* Effect.forEach(entries, ([name, tool]) => {
          const declared = Tool.catalog(tool)
          if (declared && ToolCatalog.sourceKey(declared.source) !== ToolCatalog.sourceKey(source)) {
            return Effect.fail(
              new Tool.RegistrationError({
                name,
                message: `Application tool source does not match ${source.type}:${source.id}: ${name}`,
              }),
            )
          }
          return Effect.succeed([
            name,
            {
              identity: {},
              tool,
              catalog: {
                ...declared,
                source,
                sourceLocalID: declared?.sourceLocalID ?? name,
              },
            },
          ] as const)
        })
        yield* state.transform((draft) => {
          for (const [name, entry] of registrations) draft.set(name, entry)
        })
      }),
      entries: () => state.get().entries,
    })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [] })
