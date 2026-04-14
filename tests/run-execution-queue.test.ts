import { describe, expect, it, vi } from "vitest"
import {
  enqueueRequestGroupExecution,
  hasRequestGroupExecutionQueue,
} from "../packages/core/src/runs/execution-queue.ts"

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve
  })
  return { promise, resolve }
}

describe("request-group execution queue", () => {
  it("serializes same-request-group executions and clears queue state after completion", async () => {
    const requestGroupId = "rq-serial-test"
    const firstDeferred = createDeferred<void>()
    const order: string[] = []
    const dependencies = {
      getRootRun: () => undefined,
      logInfo: vi.fn(),
      logWarn: vi.fn(),
      logError: vi.fn(),
      appendRunEvent: vi.fn(),
    }

    const first = enqueueRequestGroupExecution({
      requestGroupId,
      runId: "run-1",
      task: async () => {
        order.push("first-start")
        await firstDeferred.promise
        order.push("first-end")
        return undefined
      },
    }, dependencies)

    const second = enqueueRequestGroupExecution({
      requestGroupId,
      runId: "run-2",
      task: async () => {
        order.push("second-start")
        order.push("second-end")
        return undefined
      },
    }, dependencies)

    await Promise.resolve()
    await Promise.resolve()

    expect(hasRequestGroupExecutionQueue(requestGroupId)).toBe(true)
    expect(order).toEqual(["first-start"])
    expect(dependencies.logInfo).toHaveBeenCalledWith(
      "request-group execution queued behind active execution task",
      expect.objectContaining({
        runId: "run-2",
        requestGroupId,
      }),
    )
    expect(dependencies.appendRunEvent).toHaveBeenCalledWith("run-2", "execution_queue_waiting")

    firstDeferred.resolve()
    await first
    await second

    expect(order).toEqual(["first-start", "first-end", "second-start", "second-end"])
    expect(hasRequestGroupExecutionQueue(requestGroupId)).toBe(false)
    expect(dependencies.appendRunEvent).toHaveBeenCalledWith("run-1", "execution_queue_running")
    expect(dependencies.appendRunEvent).toHaveBeenCalledWith("run-1", "execution_queue_released")
    expect(dependencies.appendRunEvent).toHaveBeenCalledWith("run-2", "execution_queue_running")
    expect(dependencies.appendRunEvent).toHaveBeenCalledWith("run-2", "execution_queue_released")
  })
})
