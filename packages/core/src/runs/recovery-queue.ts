const runRecoveryQueues = new Map<string, Promise<unknown>>()

interface RecoveryQueueDependencies {
  appendRunEvent?: (runId: string, message: string) => void
}

function appendRecoveryQueueEvent(
  dependencies: RecoveryQueueDependencies | undefined,
  runId: string,
  message: string,
): void {
  try {
    dependencies?.appendRunEvent?.(runId, message)
  } catch {
    // Queue tracing must never block recovery.
  }
}

export function hasRunRecoveryQueue(runId: string): boolean {
  return runRecoveryQueues.has(runId)
}

export function enqueueRunRecovery<T>(
  params: {
    runId: string
    task: () => Promise<T>
  },
  dependencies?: RecoveryQueueDependencies,
): Promise<T> {
  const previous = runRecoveryQueues.get(params.runId)
  if (previous) {
    appendRecoveryQueueEvent(dependencies, params.runId, "recovery_queue_waiting")
  }

  const next = (previous ?? Promise.resolve())
    .catch(() => undefined)
    .then(() => {
      appendRecoveryQueueEvent(dependencies, params.runId, "recovery_queue_running")
      return params.task()
    })
    .finally(() => {
      if (runRecoveryQueues.get(params.runId) === next) {
        runRecoveryQueues.delete(params.runId)
      }
      appendRecoveryQueueEvent(dependencies, params.runId, "recovery_queue_released")
    })

  runRecoveryQueues.set(params.runId, next)
  return next
}
