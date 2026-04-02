interface ScheduleQueueLoggingDependencies {
  logInfo: (message: string, payload?: Record<string, unknown>) => void
  logWarn: (message: string) => void
  logError: (message: string, payload?: Record<string, unknown>) => void
}

const scheduleExecutionQueues = new Map<string, Promise<unknown>>()

export function hasScheduleExecutionQueue(scheduleId: string): boolean {
  return scheduleExecutionQueues.has(scheduleId)
}

export function listScheduleExecutionQueueIds(): string[] {
  return [...scheduleExecutionQueues.keys()]
}

export function enqueueScheduleExecution<T>(
  params: {
    scheduleId: string
    scheduleName?: string
    trigger?: string
    task: () => Promise<T>
  },
  dependencies: ScheduleQueueLoggingDependencies,
): Promise<T> {
  const previous = scheduleExecutionQueues.get(params.scheduleId)
  if (previous) {
    dependencies.logInfo("schedule run queued behind active schedule task", {
      scheduleId: params.scheduleId,
      scheduleName: params.scheduleName ?? null,
      trigger: params.trigger ?? null,
    })
  }

  const next = (previous ?? Promise.resolve())
    .catch((error) => {
      dependencies.logWarn(
        `previous schedule queue recovered: ${error instanceof Error ? error.message : String(error)}`,
      )
    })
    .then(() => params.task())
    .catch((error) => {
      dependencies.logError("schedule queue task failed", {
        scheduleId: params.scheduleId,
        scheduleName: params.scheduleName ?? null,
        trigger: params.trigger ?? null,
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    })
    .finally(() => {
      if (scheduleExecutionQueues.get(params.scheduleId) === next) {
        scheduleExecutionQueues.delete(params.scheduleId)
      }
    })

  scheduleExecutionQueues.set(params.scheduleId, next)
  return next
}
