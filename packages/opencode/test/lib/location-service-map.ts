import { Location } from "@opencode-ai/core/location"
import { LocationServiceMap } from "@opencode-ai/core/location-service-map"
import type { LocationServices } from "@opencode-ai/core/location-services"
import { CommandV2 } from "@opencode-ai/core/command"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { ProjectV2 } from "@opencode-ai/core/project"
import { Reference } from "@opencode-ai/core/reference"
import { Tools } from "@opencode-ai/core/tool/tools"
import { Effect, Layer, LayerMap } from "effect"

export const makeLocationServiceMapLayer = (
  references: (ref: Location.Ref) => Reference.Info[] = () => [],
) =>
  Layer.effect(
    LocationServiceMap.Service,
    LayerMap.make(
      (ref: Location.Ref) =>
        Layer.mergeAll(
          Layer.succeed(
            Location.Service,
            Location.Service.of({
              directory: ref.directory,
              workspaceID: ref.workspaceID,
              project: { id: ProjectV2.ID.make("test"), directory: ref.directory },
            }),
          ),
          Layer.mock(Tools.Service, {
            register: () => Effect.void,
          }),
          Layer.mock(PermissionV2.Service, {
            assert: () => Effect.void,
          }),
          Layer.mock(CommandV2.Service, {
            beforeExecute: (input) => Effect.succeed(input.parts),
          }),
          Layer.mock(Reference.Service, { list: () => Effect.succeed(references(ref)) }),
          Layer.mock(PluginV2.Service, {
            add: () => Effect.void,
            remove: () => Effect.void,
            wait: () => Effect.void,
          }),
        ) as unknown as Layer.Layer<LocationServices>,
      { idleTimeToLive: "1 minute" },
    ),
  )

export const locationServiceMapLayer = makeLocationServiceMapLayer()

export const makeLocationServiceMapReplacement = (
  references: (ref: Location.Ref) => Reference.Info[],
) => [LocationServiceMap.node, makeLocationServiceMapLayer(references)] as const

export const locationServiceMapReplacement = [LocationServiceMap.node, locationServiceMapLayer] as const
