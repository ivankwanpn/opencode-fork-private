export * as SessionSchema from "./schema"

import { Session } from "@opencode-ai/schema/session"

export const ID = Session.ID
export type ID = typeof ID.Type

export const Info = Session.Info
export type Info = Session.Info

export const ExecutionEngine = Session.ExecutionEngine
export type ExecutionEngine = Session.ExecutionEngine

export const KernelUnavailableError = Session.KernelUnavailableError
export type KernelUnavailableError = Session.KernelUnavailableError
