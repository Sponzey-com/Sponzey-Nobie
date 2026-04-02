import { describe, expect, it, vi } from "vitest"
import {
  enqueueSessionIntake,
  hasSessionIntakeQueue,
} from "../packages/core/src/runs/intake-queue.ts"

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve
  })
  return { promise, resolve }
}

describe("session intake queue", () => {
  it("serializes same-session intake tasks and clears queue state after completion", async () => {
    const sessionId = "session-intake-1"
    const deferred = createDeferred<void>()
    const order: string[] = []
    const dependencies = {
      logInfo: vi.fn(),
      logWarn: vi.fn(),
      logError: vi.fn(),
    }

    const first = enqueueSessionIntake({
      sessionId,
      runId: "run-1",
      requestGroupId: "group-1",
      task: async () => {
        order.push("first-start")
        await deferred.promise
        order.push("first-end")
        return 1
      },
    }, dependencies)

    const second = enqueueSessionIntake({
      sessionId,
      runId: "run-2",
      requestGroupId: "group-2",
      task: async () => {
        order.push("second-start")
        order.push("second-end")
        return 2
      },
    }, dependencies)

    await Promise.resolve()
    await Promise.resolve()

    expect(hasSessionIntakeQueue(sessionId)).toBe(true)
    expect(order).toEqual(["first-start"])
    expect(dependencies.logInfo).toHaveBeenCalledWith(
      "session intake queued behind active intake task",
      expect.objectContaining({
        sessionId,
        runId: "run-2",
        requestGroupId: "group-2",
      }),
    )

    deferred.resolve()

    await expect(first).resolves.toBe(1)
    await expect(second).resolves.toBe(2)
    expect(order).toEqual(["first-start", "first-end", "second-start", "second-end"])
    expect(hasSessionIntakeQueue(sessionId)).toBe(false)
  })
})
