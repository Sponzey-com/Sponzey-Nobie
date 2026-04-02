interface ScheduleDeliveryQueueDependencies {
  logInfo: (message: string, payload?: Record<string, unknown>) => void
  logWarn: (message: string) => void
  logError: (message: string, payload?: Record<string, unknown>) => void
}

const scheduleDeliveryQueues = new Map<string, Promise<unknown>>()

export function buildScheduleDeliveryQueueId(params: {
  targetChannel: string
  targetSessionId: string
}): string {
  return `${params.targetChannel}:${params.targetSessionId}`
}

export function hasScheduleDeliveryQueue(queueId: string): boolean {
  return scheduleDeliveryQueues.has(queueId)
}

export function enqueueScheduledDelivery<T>(
  params: {
    targetChannel: string
    targetSessionId: string
    scheduleId?: string
    scheduleRunId?: string
    task: () => Promise<T>
  },
  dependencies: ScheduleDeliveryQueueDependencies,
): Promise<T> {
  const queueId = buildScheduleDeliveryQueueId({
    targetChannel: params.targetChannel,
    targetSessionId: params.targetSessionId,
  })
  const previous = scheduleDeliveryQueues.get(queueId)

  if (previous) {
    dependencies.logInfo("scheduled delivery queued behind active target", {
      queueId,
      targetChannel: params.targetChannel,
      targetSessionId: params.targetSessionId,
      scheduleId: params.scheduleId ?? null,
      scheduleRunId: params.scheduleRunId ?? null,
    })
  }

  const next = (previous ?? Promise.resolve())
    .catch((error) => {
      dependencies.logWarn(
        `previous scheduled delivery queue recovered: ${error instanceof Error ? error.message : String(error)}`,
      )
    })
    .then(() => params.task())
    .catch((error) => {
      dependencies.logError("scheduled delivery queue task failed", {
        queueId,
        targetChannel: params.targetChannel,
        targetSessionId: params.targetSessionId,
        scheduleId: params.scheduleId ?? null,
        scheduleRunId: params.scheduleRunId ?? null,
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    })
    .finally(() => {
      if (scheduleDeliveryQueues.get(queueId) === next) {
        scheduleDeliveryQueues.delete(queueId)
      }
    })

  scheduleDeliveryQueues.set(queueId, next)
  return next
}
