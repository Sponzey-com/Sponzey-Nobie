import type { RunChunkDeliveryHandler } from "./delivery.js"
import {
  moveRunToAwaitingUser,
  moveRunToCancelledAfterStop,
  type AwaitingUserParams,
  type FinalizationDependencies,
  type FinalizationSource,
} from "./finalization.js"
import { decideTerminalApplicationOutcome } from "./terminal-outcome-policy.js"

export type TerminalApplication =
  | ({ kind: "awaiting_user" } & AwaitingUserParams)
  | ({ kind: "stop" } & AwaitingUserParams)

interface TerminalApplicationDependencies {
  moveRunToAwaitingUser: typeof moveRunToAwaitingUser
  moveRunToCancelledAfterStop: typeof moveRunToCancelledAfterStop
}

const defaultTerminalApplicationDependencies: TerminalApplicationDependencies = {
  moveRunToAwaitingUser,
  moveRunToCancelledAfterStop,
}

export async function applyTerminalApplication(
  params: {
    runId: string
    sessionId: string
    source: FinalizationSource
    onChunk: RunChunkDeliveryHandler | undefined
    application: TerminalApplication
    dependencies: FinalizationDependencies
  },
  dependencies: TerminalApplicationDependencies = defaultTerminalApplicationDependencies,
): Promise<"awaiting_user" | "cancelled"> {
  const terminalOutcome = decideTerminalApplicationOutcome({
    applicationKind: params.application.kind,
  })

  if (terminalOutcome === "awaiting_user") {
    await dependencies.moveRunToAwaitingUser({
      runId: params.runId,
      sessionId: params.sessionId,
      source: params.source,
      onChunk: params.onChunk,
      awaitingUser: {
        preview: params.application.preview,
        summary: params.application.summary,
        ...(params.application.reason ? { reason: params.application.reason } : {}),
        ...(params.application.rawMessage ? { rawMessage: params.application.rawMessage } : {}),
        ...(params.application.userMessage ? { userMessage: params.application.userMessage } : {}),
        ...(params.application.remainingItems ? { remainingItems: params.application.remainingItems } : {}),
      },
      dependencies: params.dependencies,
    })
    return "awaiting_user"
  }

  await dependencies.moveRunToCancelledAfterStop({
    runId: params.runId,
    sessionId: params.sessionId,
    source: params.source,
    onChunk: params.onChunk,
    cancellation: {
      preview: params.application.preview,
      summary: params.application.summary,
      ...(params.application.reason ? { reason: params.application.reason } : {}),
      ...(params.application.rawMessage ? { rawMessage: params.application.rawMessage } : {}),
      ...(params.application.userMessage ? { userMessage: params.application.userMessage } : {}),
      ...(params.application.remainingItems ? { remainingItems: params.application.remainingItems } : {}),
    },
    dependencies: params.dependencies,
  })
  return "cancelled"
}
