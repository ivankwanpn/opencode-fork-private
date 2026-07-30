import { Context, Effect, Layer } from "effect"
import { Slug } from "@opencode-ai/core/util/slug"

export interface Interface {
  readonly generate: (context?: string) => Effect.Effect<string>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/server/ProjectCopyNameCapability") {}

export const layer = Layer.succeed(Service, Service.of({ generate: () => Effect.sync(() => Slug.create()) }))

export * as ProjectCopyNameCapability from "./project-copy-name-capability"
