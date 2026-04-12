interface IntakeQueueLoggingDependencies {
  logInfo: (message: string, payload?: Record<string, unknown>) => void
  logWarn: (message: string) => void
  logError: (message: string, payload?: Record<string, unknown>) => void
  appendRunEvent?: (runId: string, message: string) => void
}

const intakeSessionQueues = new Map<string, Promise<unknown>>()

function appendIntakeQueueEvent(
  dependencies: IntakeQueueLoggingDependencies,
  runId: string,
  message: string,
): void {
  try {
    dependencies.appendRunEvent?.(runId, message)
  } catch {
    // Queue tracing must never block intake execution.
  }
}

export function hasSessionIntakeQueue(sessionId: string): boolean {
  return intakeSessionQueues.has(sessionId)
}

export function enqueueSessionIntake<T>(
  params: {
    sessionId: string
    runId: string
    requestGroupId: string
    task: () => Promise<T>
  },
  dependencies: IntakeQueueLoggingDependencies,
): Promise<T> {
  const previous = intakeSessionQueues.get(params.sessionId)
  if (previous) {
    dependencies.logInfo("session intake queued behind active intake task", {
      sessionId: params.sessionId,
      runId: params.runId,
      requestGroupId: params.requestGroupId,
    })
    appendIntakeQueueEvent(dependencies, params.runId, "intake_queue_waiting")
  }

  const next = (previous ?? Promise.resolve())
    .catch((error) => {
      dependencies.logWarn(
        `previous session intake queue recovered: ${error instanceof Error ? error.message : String(error)}`,
      )
    })
    .then(() => {
      appendIntakeQueueEvent(dependencies, params.runId, "intake_queue_running")
      return params.task()
    })
    .catch((error) => {
      dependencies.logError("session intake queue task failed", {
        sessionId: params.sessionId,
        runId: params.runId,
        requestGroupId: params.requestGroupId,
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    })
    .finally(() => {
      if (intakeSessionQueues.get(params.sessionId) === next) {
        intakeSessionQueues.delete(params.sessionId)
      }
      appendIntakeQueueEvent(dependencies, params.runId, "intake_queue_released")
    })

  intakeSessionQueues.set(params.sessionId, next)
  return next
}
