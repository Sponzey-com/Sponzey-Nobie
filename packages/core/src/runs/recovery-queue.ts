const runRecoveryQueues = new Map<string, Promise<unknown>>()

export function hasRunRecoveryQueue(runId: string): boolean {
  return runRecoveryQueues.has(runId)
}

export function enqueueRunRecovery<T>(
  params: {
    runId: string
    task: () => Promise<T>
  },
): Promise<T> {
  const previous = runRecoveryQueues.get(params.runId)

  const next = (previous ?? Promise.resolve())
    .catch(() => undefined)
    .then(() => params.task())
    .finally(() => {
      if (runRecoveryQueues.get(params.runId) === next) {
        runRecoveryQueues.delete(params.runId)
      }
    })

  runRecoveryQueues.set(params.runId, next)
  return next
}
