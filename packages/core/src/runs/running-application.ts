export interface RunningContinuationState {
  eventLabels?: string[]
  reviewStepStatus: "running" | "completed"
  reviewSummary: string
  executingSummary: string
  updateRunStatusSummary?: string
  updateRunSummary?: string
  nextMessage: string
  clearWorkerRuntime?: boolean
  clearProvider?: boolean
}

export interface RunningContinuationDependencies {
  appendRunEvent: (runId: string, label: string) => void
  updateRunSummary: (runId: string, summary: string) => void
  setRunStepStatus: (
    runId: string,
    stepKey: string,
    status: "running" | "completed" | "cancelled" | "pending" | "failed",
    summary: string,
  ) => void
  updateRunStatus: (
    runId: string,
    status: "queued" | "running" | "awaiting_approval" | "awaiting_user" | "completed" | "failed" | "cancelled" | "interrupted",
    summary: string,
    canCancel: boolean,
  ) => void
}

export interface AppliedRunningContinuation {
  nextMessage: string
  clearWorkerRuntime: boolean
  clearProvider: boolean
}

export function applyRunningContinuationState(
  params: {
    runId: string
    state: RunningContinuationState
  },
  dependencies: RunningContinuationDependencies,
): AppliedRunningContinuation {
  for (const eventLabel of params.state.eventLabels ?? []) {
    const normalized = eventLabel.trim()
    if (!normalized) continue
    dependencies.appendRunEvent(params.runId, normalized)
  }

  if (params.state.updateRunSummary) {
    dependencies.updateRunSummary(params.runId, params.state.updateRunSummary)
  }

  dependencies.setRunStepStatus(
    params.runId,
    "reviewing",
    params.state.reviewStepStatus,
    params.state.reviewSummary,
  )
  dependencies.setRunStepStatus(
    params.runId,
    "executing",
    "running",
    params.state.executingSummary,
  )

  if (params.state.updateRunStatusSummary) {
    dependencies.updateRunStatus(params.runId, "running", params.state.updateRunStatusSummary, true)
  }

  return {
    nextMessage: params.state.nextMessage,
    clearWorkerRuntime: Boolean(params.state.clearWorkerRuntime),
    clearProvider: Boolean(params.state.clearProvider),
  }
}
