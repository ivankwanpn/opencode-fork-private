import { createMemo } from "solid-js"
import { useData } from "../context/data"

export function useConnected() {
  const data = useData()
  return createMemo(() => {
    const catalog = data.location.catalog.get()
    return (
      catalog?.connected.some(
        (providerID) =>
          providerID !== "opencode" ||
          catalog.models.some(
            (model) =>
              model.providerID === providerID &&
              (model.cost.find((cost) => cost.tier === undefined) ?? model.cost[0])?.input !== 0,
          ),
      ) ?? false
    )
  })
}
