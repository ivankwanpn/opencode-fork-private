export type PermissionStage = "permission" | "always" | "reject"

export type PermissionPromptState = {
  requestID: string
  stage: PermissionStage
  submitting: boolean
}

export function createPermissionPromptState(requestID: string): PermissionPromptState {
  return {
    requestID,
    stage: "permission",
    submitting: false,
  }
}

export function syncPermissionPromptState(
  state: PermissionPromptState,
  requestID: string,
  canSave: boolean,
): PermissionPromptState {
  if (state.requestID !== requestID) return createPermissionPromptState(requestID)
  if (state.stage !== "always" || canSave) return state
  return {
    ...state,
    stage: "permission",
  }
}

export function beginPermissionSubmission(
  state: PermissionPromptState,
  requestID: string,
): PermissionPromptState | undefined {
  if (state.requestID !== requestID || state.submitting) return undefined
  return {
    ...state,
    submitting: true,
  }
}

export function failPermissionSubmission(
  state: PermissionPromptState,
  requestID: string,
): PermissionPromptState | undefined {
  if (state.requestID !== requestID || !state.submitting) return undefined
  return {
    ...state,
    submitting: false,
  }
}

export function permissionPromptOptions(save: readonly string[] | undefined): Record<string, string> {
  if (!save?.length) return { once: "Allow once", reject: "Reject" }
  return { once: "Allow once", always: "Allow always", reject: "Reject" }
}

export function permissionPromptKeys<const T extends Record<string, string>>(options: T): (keyof T & string)[] {
  return Object.keys(options) as (keyof T & string)[]
}

export function syncPermissionPromptSelection<T extends string>(
  keys: readonly T[],
  selected: T | undefined,
): T | undefined {
  if (selected && keys.includes(selected)) return selected
  return keys[0]
}

export function permissionPromptIdentity(requestID: string, stage: PermissionStage, canSave: boolean): string {
  return JSON.stringify([requestID, stage, canSave])
}

export type PermissionPromptNavigationState<T extends string = string> = {
  identity: string
  selected: T | undefined
  expanded: boolean
}

export function createPermissionPromptNavigationState<T extends string>(
  identity: string,
  keys: readonly T[],
): PermissionPromptNavigationState<T> {
  return {
    identity,
    selected: keys[0],
    expanded: false,
  }
}

export function syncPermissionPromptNavigationState<T extends string>(
  state: PermissionPromptNavigationState<T>,
  identity: string,
  keys: readonly T[],
): PermissionPromptNavigationState<T> {
  if (state.identity !== identity) return createPermissionPromptNavigationState(identity, keys)
  const selected = syncPermissionPromptSelection(keys, state.selected)
  if (selected === state.selected) return state
  return {
    ...state,
    selected,
  }
}

export function permissionStageForSelection(
  option: string,
  save: readonly string[] | undefined,
  promptForReject: boolean,
): PermissionStage {
  if (option === "always") return save?.length ? "always" : "permission"
  if (option === "reject" && promptForReject) return "reject"
  return "permission"
}
