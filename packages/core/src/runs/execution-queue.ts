import type { RootRun } from "./types.js"

interface ExecutionQueueLoggingDependencies {
  logInfo: (message: string, payload?: Record<string, unknown>) => void
  logWarn: (message: string) => void
  logError: (message: string, payload?: Record<string, unknown>) => void
  appendRunEvent?: (runId: string, message: string) => void
}

interface RequestGroupExecutionQueueDependencies extends ExecutionQueueLoggingDependencies {
  getRootRun: (runId: string) => RootRun | undefined
}

const requestGroupExecutionQueues = new Map<string, Promise<RootRun | undefined>>()

function appendExecutionQueueEvent(
  dependencies: ExecutionQueueLoggingDependencies,
  runId: string,
  message: string,
): void {
  try {
    dependencies.appendRunEvent?.(runId, message)
  } catch {
    // Queue tracing must never block execution.
  }
}

export function hasRequestGroupExecutionQueue(requestGroupId: string): boolean {
  return requestGroupExecutionQueues.has(requestGroupId)
}

export function enqueueRequestGroupExecution(
  params: {
    requestGroupId: string
    runId: string
    task: () => Promise<RootRun | undefined>
  },
  dependencies: RequestGroupExecutionQueueDependencies,
): Promise<RootRun | undefined> {
  const previous = requestGroupExecutionQueues.get(params.requestGroupId)
  if (previous) {
    dependencies.logInfo("request-group execution queued behind active execution task", {
      runId: params.runId,
      requestGroupId: params.requestGroupId,
    })
    appendExecutionQueueEvent(dependencies, params.runId, "execution_queue_waiting")
  }

  const next = (previous ?? Promise.resolve<RootRun | undefined>(undefined))
    .catch((error) => {
      dependencies.logWarn(
        `previous request-group execution queue recovered: ${error instanceof Error ? error.message : String(error)}`,
      )
      return undefined
    })
    .then(() => {
      appendExecutionQueueEvent(dependencies, params.runId, "execution_queue_running")
      return params.task()
    })
    .catch((error) => {
      dependencies.logError("request-group execution queue task failed", {
        runId: params.runId,
        requestGroupId: params.requestGroupId,
        error: error instanceof Error ? error.message : String(error),
      })
      return dependencies.getRootRun(params.runId)
    })
    .finally(() => {
      if (requestGroupExecutionQueues.get(params.requestGroupId) === next) {
        requestGroupExecutionQueues.delete(params.requestGroupId)
      }
      appendExecutionQueueEvent(dependencies, params.runId, "execution_queue_released")
    })

  requestGroupExecutionQueues.set(params.requestGroupId, next)
  return next
}
