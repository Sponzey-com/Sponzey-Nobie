import type { RootRun } from "./types.js"

interface ExecutionQueueLoggingDependencies {
  logInfo: (message: string, payload?: Record<string, unknown>) => void
  logWarn: (message: string) => void
  logError: (message: string, payload?: Record<string, unknown>) => void
}

interface RequestGroupExecutionQueueDependencies extends ExecutionQueueLoggingDependencies {
  getRootRun: (runId: string) => RootRun | undefined
}

const requestGroupExecutionQueues = new Map<string, Promise<RootRun | undefined>>()

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
  }

  const next = (previous ?? Promise.resolve<RootRun | undefined>(undefined))
    .catch((error) => {
      dependencies.logWarn(
        `previous request-group execution queue recovered: ${error instanceof Error ? error.message : String(error)}`,
      )
      return undefined
    })
    .then(() => params.task())
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
    })

  requestGroupExecutionQueues.set(params.requestGroupId, next)
  return next
}
