import { describe, expect, it, vi } from "vitest"
import {
  buildScheduleDeliveryQueueId,
  enqueueScheduledDelivery,
  hasScheduleDeliveryQueue,
} from "../packages/core/src/scheduler/delivery-queue.ts"

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve
  })
  return { promise, resolve }
}

describe("scheduler delivery queue", () => {
  it("serializes deliveries for the same target session", async () => {
    const deferred = createDeferred<void>()
    const order: string[] = []
    const dependencies = {
      logInfo: vi.fn(),
      logWarn: vi.fn(),
      logError: vi.fn(),
    }
    const queueId = buildScheduleDeliveryQueueId({
      targetChannel: "telegram",
      targetSessionId: "telegram-session-1",
    })

    const first = enqueueScheduledDelivery({
      targetChannel: "telegram",
      targetSessionId: "telegram-session-1",
      scheduleId: "schedule-1",
      scheduleRunId: "schedule-run-1",
      task: async () => {
        order.push("first-start")
        await deferred.promise
        order.push("first-end")
        return 1
      },
    }, dependencies)

    const second = enqueueScheduledDelivery({
      targetChannel: "telegram",
      targetSessionId: "telegram-session-1",
      scheduleId: "schedule-2",
      scheduleRunId: "schedule-run-2",
      task: async () => {
        order.push("second-start")
        order.push("second-end")
        return 2
      },
    }, dependencies)

    await Promise.resolve()
    await Promise.resolve()

    expect(hasScheduleDeliveryQueue(queueId)).toBe(true)
    expect(order).toEqual(["first-start"])
    expect(dependencies.logInfo).toHaveBeenCalledWith(
      "scheduled delivery queued behind active target",
      expect.objectContaining({
        queueId,
        scheduleId: "schedule-2",
        scheduleRunId: "schedule-run-2",
      }),
    )

    deferred.resolve()

    await expect(first).resolves.toBe(1)
    await expect(second).resolves.toBe(2)
    expect(order).toEqual(["first-start", "first-end", "second-start", "second-end"])
    expect(hasScheduleDeliveryQueue(queueId)).toBe(false)
  })
})
