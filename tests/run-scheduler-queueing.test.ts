import { describe, expect, it, vi } from "vitest"
import {
  enqueueScheduleExecution,
  hasScheduleExecutionQueue,
  listScheduleExecutionQueueIds,
} from "../packages/core/src/scheduler/queueing.ts"

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve
  })
  return { promise, resolve }
}

describe("scheduler queueing", () => {
  it("serializes same-schedule tasks and clears queue state after completion", async () => {
    const deferred = createDeferred<void>()
    const order: string[] = []
    const dependencies = {
      logInfo: vi.fn(),
      logWarn: vi.fn(),
      logError: vi.fn(),
    }

    const first = enqueueScheduleExecution({
      scheduleId: "schedule-1",
      scheduleName: "아침 보고",
      trigger: "tick",
      task: async () => {
        order.push("first-start")
        await deferred.promise
        order.push("first-end")
        return "run-1"
      },
    }, dependencies)

    const second = enqueueScheduleExecution({
      scheduleId: "schedule-1",
      scheduleName: "아침 보고",
      trigger: "manual",
      task: async () => {
        order.push("second-start")
        order.push("second-end")
        return "run-2"
      },
    }, dependencies)

    await Promise.resolve()
    await Promise.resolve()

    expect(hasScheduleExecutionQueue("schedule-1")).toBe(true)
    expect(listScheduleExecutionQueueIds()).toContain("schedule-1")
    expect(order).toEqual(["first-start"])
    expect(dependencies.logInfo).toHaveBeenCalledWith(
      "schedule run queued behind active schedule task",
      expect.objectContaining({
        scheduleId: "schedule-1",
        trigger: "manual",
      }),
    )

    deferred.resolve()

    await expect(first).resolves.toBe("run-1")
    await expect(second).resolves.toBe("run-2")
    expect(order).toEqual(["first-start", "first-end", "second-start", "second-end"])
    expect(hasScheduleExecutionQueue("schedule-1")).toBe(false)
    expect(listScheduleExecutionQueueIds()).not.toContain("schedule-1")
  })
})
