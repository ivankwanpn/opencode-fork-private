export * as SessionShell from "./shell"

import { Context, Effect, Layer, Stream } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { Config } from "../config"
import { makeLocationNode } from "../effect/app-node"
import { AppProcess } from "../process"
import { PluginRuntime } from "../plugin/runtime"
import { Shell } from "../shell"

export type ExecuteInput = {
  readonly command: string
  readonly cwd: string
  readonly sessionID?: string
  readonly callID?: string
  readonly onOutput: (chunk: string) => Effect.Effect<void>
}

export interface Interface {
  readonly execute: (input: ExecuteInput) => Effect.Effect<void, AppProcess.AppProcessError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/SessionShell") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const process = yield* AppProcess.Service
    const plugins = yield* PluginRuntime.Service

    return Service.of({
      execute: Effect.fn("SessionShell.execute")(function* (input) {
        const shell = Shell.preferred(Config.latest(yield* config.entries(), "shell"))
        const env = PluginRuntime.mutable<Record<string, string>>({})
        yield* plugins.run(PluginRuntime.HookName.shellEnv, {
          cwd: input.cwd,
          sessionID: input.sessionID,
          callID: input.callID,
          env: env.value,
        })
        const command = ChildProcess.make(shell, Shell.args(shell, input.command, input.cwd), {
          cwd: input.cwd,
          extendEnv: true,
          env: { ...env.get(), TERM: "dumb" },
          stdin: "ignore",
          forceKillAfter: "3 seconds",
        })

        return yield* Effect.scoped(
          Effect.gen(function* () {
            const handle = yield* process.spawn(command)
            yield* Stream.runForEach(Stream.decodeText(handle.all), input.onOutput)
            yield* handle.exitCode
          }),
        ).pipe(
          Effect.asVoid,
          Effect.mapError(
            (cause) =>
              new AppProcess.AppProcessError({
                command: input.command,
                cause,
              }),
          ),
        )
      }),
    })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Config.node, AppProcess.node, PluginRuntime.node],
})
