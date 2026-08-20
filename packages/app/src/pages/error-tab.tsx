import { Show, onMount } from "solid-js"
import { useNavigate, useParams } from "@solidjs/router"
import { useTabs } from "@/context/tabs"
import { ErrorPage } from "./error"

export function ErrorTabPage() {
  const params = useParams<{ errorID: string }>()
  const navigate = useNavigate()
  const tabs = useTabs()
  const data = () => tabs.error(params.errorID)

  onMount(() => {
    if (!data()) navigate("/")
  })

  return (
    <Show when={data()}>
      {(value) => (
        <ErrorPage
          error={value().error}
          fatal={false}
          embedded
          onClose={() => tabs.removeErrorTab(params.errorID)}
        />
      )}
    </Show>
  )
}
