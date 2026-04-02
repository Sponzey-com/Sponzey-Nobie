import type { FinalizationSource } from "./finalization.js"
import { decideFatalFailureTerminalOutcome } from "./terminal-outcome-policy.js"

interface FatalFailureApplicationDependencies {
  appendRunEvent: (runId: string, event: string) => void
  setRunStepStatus: (
    runId: string,
    step: "executing",
    status: "failed",
    summary: string,
  ) => void
  updateRunStatus: (
    runId: string,
    status: "failed",
    summary: string,
    active: boolean,
  ) => void
  rememberRunFailure: (params: {
    runId: string
    sessionId: string
    source: FinalizationSource
    summary: string
    detail?: string
    title?: string
  }) => void
  markAbortedRunCancelledIfActive: (runId: string) => void
}

export interface FatalFailureApplicationParams {
  runId: string
  sessionId: string
  source: FinalizationSource
  message: string
  aborted: boolean
  summary: string
  title: string
  extraEvents?: string[]
  appendMessageEventOnAbort?: boolean
  appendExtraEventsOnAbort?: boolean
}

export function applyFatalFailure(
  params: FatalFailureApplicationParams,
  dependencies: FatalFailureApplicationDependencies,
): "failed" | "cancelled" {
  const terminalOutcome = decideFatalFailureTerminalOutcome({ aborted: params.aborted })
  const shouldAppendMessageEvent = !params.aborted || params.appendMessageEventOnAbort === true
  const shouldAppendExtraEvents = !params.aborted || params.appendExtraEventsOnAbort === true

  if (shouldAppendMessageEvent) {
    dependencies.appendRunEvent(params.runId, params.message)
  }
  if (shouldAppendExtraEvents) {
    for (const event of params.extraEvents ?? []) {
      dependencies.appendRunEvent(params.runId, event)
    }
  }

  if (terminalOutcome === "cancelled") {
    dependencies.markAbortedRunCancelledIfActive(params.runId)
    return "cancelled"
  }

  dependencies.setRunStepStatus(params.runId, "executing", "failed", params.message)
  dependencies.updateRunStatus(params.runId, "failed", params.message, false)
  dependencies.rememberRunFailure({
    runId: params.runId,
    sessionId: params.sessionId,
    source: params.source,
    summary: params.summary,
    detail: params.message,
    title: params.title,
  })
  return "failed"
}
