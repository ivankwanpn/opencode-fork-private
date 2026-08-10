import { app } from "electron"
import { resolveChannel } from "../../../script/src/channel"

export const CHANNEL = resolveChannel(import.meta.env.OPENCODE_CHANNEL)
