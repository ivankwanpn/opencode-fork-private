import { Button } from "@opencode-ai/ui/button"
import { Dialog } from "@opencode-ai/ui/dialog"
import { TextField } from "@opencode-ai/ui/text-field"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { createSignal, type Component } from "solid-js"
import { useLanguage } from "@/context/language"
import { useServerSync } from "@/context/server-sync"
import { updateModelContext } from "./model-context"

export const DialogEditModelContext: Component<{
  providerID: string
  modelID: string
  modelName: string
  context?: number
}> = (props) => {
  const dialog = useDialog()
  const language = useLanguage()
  const serverSync = useServerSync()
  const [value, setValue] = createSignal(props.context?.toString() ?? "")
  const [error, setError] = createSignal<string>()

  const save = (event: SubmitEvent) => {
    event.preventDefault()
    const input = value().trim()
    const context = input ? Number(input) : undefined
    if (context !== undefined && (!Number.isSafeInteger(context) || context <= 0)) {
      setError(language.t("provider.custom.error.limit"))
      return
    }

    setError(undefined)
    void serverSync()
      .updateConfig(updateModelContext(serverSync().data.config, props.providerID, props.modelID, context))
      .then(
        () => dialog.close(),
        () => setError(language.t("provider.custom.error.limit")),
      )
  }

  return (
    <Dialog title={props.modelName} class="w-full max-w-[480px] mx-auto">
      <form onSubmit={save} class="flex flex-col gap-6 p-6 pt-0">
        <TextField
          autofocus
          type="number"
          min={1}
          label={language.t("provider.custom.models.context.label")}
          value={value()}
          onChange={setValue}
          error={error()}
          validationState={error() ? "invalid" : undefined}
        />
        <div class="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="large" onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Button type="submit" variant="primary" size="large">
            {language.t("common.save")}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
