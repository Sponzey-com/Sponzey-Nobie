import { describe, expect, it, vi } from "vitest"
import {
  buildStartFinalizationDependencies,
  executeStartLoopDirective,
  runStartIntakeBridge,
} from "../packages/core/src/runs/start-bridges.js"

describe("start bridges", () => {
  it("builds finalization dependencies with optional delivery error handler", () => {
    const appendRunEvent = vi.fn()
    const onDeliveryError = vi.fn()

    const dependencies = buildStartFinalizationDependencies({
      appendRunEvent,
      setRunStepStatus: vi.fn(),
      updateRunStatus: vi.fn(),
      rememberRunSuccess: vi.fn(),
      rememberRunFailure: vi.fn(),
      onDeliveryError,
    })

    dependencies.appendRunEvent("run-1", "done")
    dependencies.onDeliveryError?.("failed")

    expect(appendRunEvent).toHaveBeenCalledWith("run-1", "done")
    expect(onDeliveryError).toHaveBeenCalledWith("failed")
  })

  it("delegates loop directive and intake bridge to module helpers", async () => {
    const applyLoopDirectiveMock = vi.fn(async () => "break" as const)
    const runIntakeBridgePassMock = vi.fn(async () => ({
      kind: "complete" as const,
      text: "ok",
      eventLabel: "done",
    }))
    const finalizationDependencies = buildStartFinalizationDependencies({
      appendRunEvent: vi.fn(),
      setRunStepStatus: vi.fn(),
      updateRunStatus: vi.fn(),
      rememberRunSuccess: vi.fn(),
      rememberRunFailure: vi.fn(),
    })

    const loopResult = await executeStartLoopDirective({
      runId: "run-1",
      sessionId: "session-1",
      source: "webui",
      onChunk: undefined,
      directive: { kind: "complete", text: "ok" },
      finalizationDependencies,
    }, {
      applyLoopDirective: applyLoopDirectiveMock as never,
      runIntakeBridgePass: runIntakeBridgePassMock as never,
    })

    const intakeResult = await runStartIntakeBridge({
      message: "hello",
      originalRequest: "hello",
      sessionId: "session-1",
      requestGroupId: "group-1",
      model: "gpt-test",
      workDir: "/tmp",
      source: "webui",
      runId: "run-1",
      onChunk: undefined,
      reuseConversationContext: false,
      scheduleDelayedRun: vi.fn(),
      startDelegatedRun: vi.fn(),
    }, {
      appendRunEvent: vi.fn(),
      updateRunSummary: vi.fn(),
      incrementDelegationTurnCount: vi.fn(),
      normalizeTaskProfile: (taskProfile) => (taskProfile ?? "general_chat"),
      logInfo: vi.fn(),
    }, {
      applyLoopDirective: applyLoopDirectiveMock as never,
      runIntakeBridgePass: runIntakeBridgePassMock as never,
    })

    expect(loopResult).toBe("break")
    expect(applyLoopDirectiveMock).toHaveBeenCalledTimes(1)
    expect(runIntakeBridgePassMock).toHaveBeenCalledTimes(1)
    expect(intakeResult).toEqual({
      kind: "complete",
      text: "ok",
      eventLabel: "done",
    })
  })
})
