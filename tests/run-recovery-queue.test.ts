import { describe, expect, it, vi } from "vitest"
import {
  enqueueRunRecovery,
  hasRunRecoveryQueue,
} from "../packages/core/src/runs/recovery-queue.ts"

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve
  })
  return { promise, resolve }
}

describe("run recovery queue", () => {
  it("serializes same-run recovery tasks and clears queue state after completion", async () => {
    const runId = "run-recovery-1"
    const deferred = createDeferred<void>()
    const order: string[] = []
    const dependencies = {
      appendRunEvent: vi.fn(),
    }

    const first = enqueueRunRecovery({
      runId,
      task: async () => {
        order.push("first-start")
        await deferred.promise
        order.push("first-end")
        return 1
      },
    }, dependencies)

    const second = enqueueRunRecovery({
      runId,
      task: async () => {
        order.push("second-start")
        order.push("second-end")
        return 2
      },
    }, dependencies)

    await Promise.resolve()
    await Promise.resolve()

    expect(hasRunRecoveryQueue(runId)).toBe(true)
    expect(order).toEqual(["first-start"])
    expect(dependencies.appendRunEvent).toHaveBeenCalledWith(runId, "recovery_queue_waiting")

    deferred.resolve()

    await expect(first).resolves.toBe(1)
    await expect(second).resolves.toBe(2)
    expect(order).toEqual(["first-start", "first-end", "second-start", "second-end"])
    expect(hasRunRecoveryQueue(runId)).toBe(false)
    expect(dependencies.appendRunEvent).toHaveBeenCalledWith(runId, "recovery_queue_running")
    expect(dependencies.appendRunEvent).toHaveBeenCalledWith(runId, "recovery_queue_released")
  })
})
