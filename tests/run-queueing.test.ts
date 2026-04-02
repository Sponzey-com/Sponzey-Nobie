import { describe, expect, it, vi } from "vitest"
import {
  scheduleDelayedRootRun,
} from "../packages/core/src/runs/run-queueing.js"

describe("run queueing", () => {
  it("fires overdue delayed runs immediately with routed target", async () => {
    const startRootRun = vi.fn(() => ({ finished: Promise.resolve(undefined) }))
    const logInfo = vi.fn()

    scheduleDelayedRootRun({
      runAtMs: 999,
      message: "say hello",
      sessionId: "session-1",
      originRunId: "origin-run-1",
      originRequestGroupId: "origin-group-1",
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
      originRunId: "origin-run-1",
      originRequestGroupId: "origin-group-1",
      model: "gpt-routed",
      targetId: "provider:routed",
      targetLabel: "Routed Target",
      skipIntake: true,
      source: "webui",
      taskProfile: "coding",
    }))
    expect(startRootRun.mock.calls[0]?.[0]).not.toHaveProperty("requestGroupId")
    expect(logInfo).toHaveBeenCalledWith("delayed run armed", expect.any(Object))
    expect(logInfo).toHaveBeenCalledWith("delayed run firing", expect.any(Object))
    expect(logInfo.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
      originRunId: "origin-run-1",
      originRequestGroupId: "origin-group-1",
    }))
    expect(logInfo.mock.calls[1]?.[1]).toEqual(expect.objectContaining({
      originRunId: "origin-run-1",
      originRequestGroupId: "origin-group-1",
    }))
  })
})
