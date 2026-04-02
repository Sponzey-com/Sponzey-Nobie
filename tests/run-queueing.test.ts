import { describe, expect, it, vi } from "vitest"
import {
  enqueueRequestGroupRun,
  hasRequestGroupQueue,
  scheduleDelayedRootRun,
} from "../packages/core/src/runs/run-queueing.js"

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve
  })
  return { promise, resolve }
}

describe("run queueing", () => {
  it("serializes request-group tasks and clears queue state after completion", async () => {
    const requestGroupId = "rq-serial-test"
    const firstDeferred = createDeferred<void>()
    const order: string[] = []
    const dependencies = {
      getRootRun: () => undefined,
      logInfo: vi.fn(),
      logWarn: vi.fn(),
      logError: vi.fn(),
    }

    const first = enqueueRequestGroupRun({
      requestGroupId,
      runId: "run-1",
      task: async () => {
        order.push("first-start")
        await firstDeferred.promise
        order.push("first-end")
        return undefined
      },
    }, dependencies)

    const second = enqueueRequestGroupRun({
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
    expect(hasRequestGroupQueue(requestGroupId)).toBe(true)
    expect(order).toEqual(["first-start"])

    firstDeferred.resolve()
    await first
    await second

    expect(order).toEqual(["first-start", "first-end", "second-start", "second-end"])
    expect(hasRequestGroupQueue(requestGroupId)).toBe(false)
  })

  it("fires overdue delayed runs immediately with routed target", async () => {
    const startRootRun = vi.fn(() => ({ finished: Promise.resolve(undefined) }))
    const logInfo = vi.fn()

    scheduleDelayedRootRun({
      runAtMs: 999,
      message: "say hello",
      sessionId: "session-1",
      model: "gpt-test",
      source: "webui",
      onChunk: undefined,
      preferredTarget: "preferred",
      taskProfile: "coding",
    }, {
      startRootRun,
      now: () => 1_000,
      resolveRoute: () => ({
        model: "gpt-routed",
        targetId: "provider:routed",
        targetLabel: "Routed Target",
      }),
      logInfo,
      logWarn: vi.fn(),
      logError: vi.fn(),
    })

    await Promise.resolve()
    await Promise.resolve()

    expect(startRootRun).toHaveBeenCalledTimes(1)
    expect(startRootRun).toHaveBeenCalledWith(expect.objectContaining({
      message: "say hello",
      sessionId: "session-1",
      model: "gpt-routed",
      targetId: "provider:routed",
      targetLabel: "Routed Target",
      skipIntake: true,
      source: "webui",
      taskProfile: "coding",
    }))
    expect(logInfo).toHaveBeenCalledWith("delayed run armed", expect.any(Object))
    expect(logInfo).toHaveBeenCalledWith("delayed run firing", expect.any(Object))
  })
})
