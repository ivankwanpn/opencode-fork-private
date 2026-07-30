import { createResource, createMemo, createSignal } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { DialogSelect } from "../ui/dialog-select"
import { useSDK } from "../context/sdk"
import { useDialog } from "../ui/dialog"
import { useToast } from "../ui/toast"
import { useTheme } from "../context/theme"
import { errorMessage } from "../util/error"
import type { ConsoleListOrgsOutput } from "@opencode-ai/client"
import { useSync } from "../context/sync"

type OrgOption = ConsoleListOrgsOutput["data"][number]

const accountHost = (url: string) => {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

const accountLabel = (item: Pick<OrgOption, "accountEmail" | "accountUrl">) =>
  `${item.accountEmail}  ${accountHost(item.accountUrl)}`

export function DialogConsoleOrg() {
  const sdk = useSDK()
  const dialog = useDialog()
  const toast = useToast()
  const sync = useSync()
  const { theme } = useTheme()

  const [loadError, setLoadError] = createSignal<unknown>()

  const [orgs] = createResource(() =>
    sdk.native.console
      .listOrgs()
      .then((result) => result.data)
      // Catch so the rejected resource never reaches the memos below: reading
      // orgs() in an errored state re-throws and tears down the dialog.
      .catch((error) => {
        setLoadError(error)
        return undefined
      }),
  )

  const showError = createMemo(() => Boolean(loadError()))

  const current = createMemo(() => orgs()?.find((item) => item.active))

  const options = createMemo(() => {
    if (showError()) return []
    const listed = orgs()
    if (listed === undefined) {
      return [
        {
          title: "Loading orgs...",
          value: "loading",
          onSelect: () => {},
        },
      ]
    }

    if (listed.length === 0) {
      return [
        {
          title: "No orgs found",
          value: "empty",
          onSelect: () => {},
        },
      ]
    }

    return listed
      .toSorted((a, b) => {
        const activeAccountA = a.active ? 0 : 1
        const activeAccountB = b.active ? 0 : 1
        if (activeAccountA !== activeAccountB) return activeAccountA - activeAccountB

        const accountCompare = accountLabel(a).localeCompare(accountLabel(b))
        if (accountCompare !== 0) return accountCompare

        return a.orgName.localeCompare(b.orgName)
      })
      .map((item) => ({
        title: item.orgName,
        value: item,
        category: accountLabel(item),
        categoryView: (
          <box flexDirection="row" gap={2}>
            <text fg={theme.accent}>{item.accountEmail}</text>
            <text fg={theme.textMuted}>{accountHost(item.accountUrl)}</text>
          </box>
        ),
        onSelect: async () => {
          if (item.active) {
            dialog.clear()
            return
          }

          await sdk.native.console.switchOrg({ accountID: item.accountID, orgID: item.orgID })
          await sync.bootstrap({ fatal: false })
          toast.show({
            message: `Switched to ${item.orgName}`,
            variant: "info",
          })
          dialog.clear()
        },
      }))
  })

  return (
    <DialogSelect<string | OrgOption>
      title="Switch org"
      options={options()}
      current={current()}
      renderFilter={!showError()}
      locked={showError()}
      emptyView={
        showError() ? (
          <box paddingLeft={4} paddingRight={4}>
            <text fg={theme.error} attributes={TextAttributes.BOLD}>
              Could not load orgs
            </text>
            <text fg={theme.textMuted}>{errorMessage(loadError())}</text>
          </box>
        ) : undefined
      }
    />
  )
}
