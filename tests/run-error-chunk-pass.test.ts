import { describe, expect, it, vi } from "vitest"
import { applyErrorChunkPass } from "../packages/core/src/runs/error-chunk-pass.ts"

function createDependencies() {
  return {
    rememberRunFailure: vi.fn(),
    incrementDelegationTurnCount: vi.fn(),
    appendRunEvent: vi.fn(),
    setRunStepStatus: vi.fn(),
    updateRunStatus: vi.fn(),
    markAbortedRunCancelledIfActive: vi.fn(),
  }
}

describe("error chunk pass", () => {
  it("logs and delivers when execution recovery is already stopped", async () => {
    const dependencies = createDependencies()
    const deliverTrackedChunk = vi.fn().mockResolvedValue(undefined)

    const result = await applyErrorChunkPass({
      runId: "run-1",
      sessionId: "session-1",
      source: "telegram",
      onChunk: undefined,
      chunk: { type: "error", message: "command failed" },
      aborted: false,
      executionRecoveryLimitStop: {
        summary: "실행 복구 한도",
        reason: "limit",
        remainingItems: ["manual action"],
      },
      activeWorkerRuntime: undefined,
      recoveryBudgetUsage: {
        interpretation: 0,
        execution: 0,
        delivery: 0,
        external: 0,
      },
      usedTurns: 0,
      maxDelegationTurns: 3,
      successfulFileDeliveries: [],
      successfulTextDeliveries: [],
    }, dependencies, {
      applyExternalRecoveryAttempt: vi.fn(),
      applyFatalFailure: vi.fn(),
      deliverTrackedChunk,
      describeWorkerRuntimeErrorReason: vi.fn(),
    })

    expect(result).toEqual({ failed: false })
    expect(dependencies.appendRunEvent).toHaveBeenCalledWith("run-1", "실행 복구 한도에 도달해 자동 진행을 중단합니다.")
    expect(deliverTrackedChunk).toHaveBeenCalled()
  })

  it("creates worker runtime recovery and delivers the error chunk", async () => {
    const dependencies = createDependencies()
    const deliverTrackedChunk = vi.fn().mockResolvedValue(undefined)
    const applyExternalRecoveryAttempt = vi.fn().mockReturnValue({
      kind: "retry",
      payload: {
        summary: "코드 작업 세션 오류를 분석하고 다른 경로로 재시도합니다.",
        reason: "sandbox denied",
        message: "command failed",
      },
    })

    const result = await applyErrorChunkPass({
      runId: "run-2",
      sessionId: "session-2",
      source: "webui",
      onChunk: undefined,
      chunk: { type: "error", message: "command failed" },
      aborted: false,
      executionRecoveryLimitStop: null,
      activeWorkerRuntime: {
        kind: "claude_code",
        targetId: "worker:claude_code",
        label: "코드 작업 세션",
        command: "claude",
      },
      workerSessionId: "worker-123",
      recoveryBudgetUsage: {
        interpretation: 0,
        execution: 0,
        delivery: 0,
        external: 0,
      },
      usedTurns: 1,
      maxDelegationTurns: 3,
      successfulFileDeliveries: [],
      successfulTextDeliveries: [],
    }, dependencies, {
      applyExternalRecoveryAttempt,
      applyFatalFailure: vi.fn(),
      deliverTrackedChunk,
      describeWorkerRuntimeErrorReason: vi.fn().mockReturnValue("sandbox denied"),
    })

    expect(applyExternalRecoveryAttempt).toHaveBeenCalled()
    expect(deliverTrackedChunk).toHaveBeenCalled()
    expect(result).toEqual({
      failed: false,
      workerRuntimeRecovery: {
        summary: "코드 작업 세션 오류를 분석하고 다른 경로로 재시도합니다.",
        reason: "sandbox denied",
        message: "command failed",
      },
    })
  })

  it("applies fatal failure and marks failed when no runtime recovery is available", async () => {
    const dependencies = createDependencies()
    const deliverTrackedChunk = vi.fn().mockResolvedValue(undefined)
    const applyFatalFailure = vi.fn().mockReturnValue("failed")

    const result = await applyErrorChunkPass({
      runId: "run-3",
      sessionId: "session-3",
      source: "cli",
      onChunk: undefined,
      chunk: { type: "error", message: "unexpected failure" },
      aborted: false,
      executionRecoveryLimitStop: null,
      activeWorkerRuntime: undefined,
      recoveryBudgetUsage: {
        interpretation: 0,
        execution: 0,
        delivery: 0,
        external: 0,
      },
      usedTurns: 0,
      maxDelegationTurns: 3,
      successfulFileDeliveries: [],
      successfulTextDeliveries: [],
    }, dependencies, {
      applyExternalRecoveryAttempt: vi.fn(),
      applyFatalFailure,
      deliverTrackedChunk,
      describeWorkerRuntimeErrorReason: vi.fn(),
    })

    expect(applyFatalFailure).toHaveBeenCalled()
    expect(deliverTrackedChunk).toHaveBeenCalled()
    expect(result).toEqual({ failed: true })
  })
})
