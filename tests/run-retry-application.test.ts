import { describe, expect, it, vi } from "vitest"
import { applyRecoveryRetryState } from "../packages/core/src/runs/retry-application.ts"

describe("run retry application", () => {
  it("records failure, consumes budget, and applies running continuation", () => {
    const appendRunEvent = vi.fn()
    const updateRunSummary = vi.fn()
    const setRunStepStatus = vi.fn()
    const updateRunStatus = vi.fn()
    const rememberRunFailure = vi.fn()
    const incrementDelegationTurnCount = vi.fn()

    const result = applyRecoveryRetryState({
      runId: "run-1",
      sessionId: "session-1",
      source: "telegram",
      recoveryBudgetUsage: {
        interpretation: 0,
        execution: 0,
        delivery: 0,
        external: 0,
      },
      state: {
        summary: "파일 검증 복구를 다시 시도합니다.",
        budgetKind: "execution",
        maxDelegationTurns: 3,
        eventLabel: "파일 검증 복구 재시도",
        nextMessage: "retry prompt",
        reviewStepStatus: "running",
        executingStepSummary: "파일 검증 복구를 다시 시도합니다.",
        updateRunStatusSummary: "파일 검증 복구를 다시 시도합니다.",
        clearWorkerRuntime: true,
        alternatives: [{ kind: "other_tool", label: "다른 도구" }],
        failureTitle: "filesystem_verification_recovery",
        failureDetail: "검증 결과가 비어 있습니다.",
      },
    }, {
      rememberRunFailure,
      incrementDelegationTurnCount,
      appendRunEvent,
      updateRunSummary,
      setRunStepStatus,
      updateRunStatus,
    })

    expect(rememberRunFailure).toHaveBeenCalledWith({
      runId: "run-1",
      sessionId: "session-1",
      source: "telegram",
      summary: "파일 검증 복구를 다시 시도합니다.",
      detail: "검증 결과가 비어 있습니다.",
      title: "filesystem_verification_recovery",
    })
    expect(incrementDelegationTurnCount).toHaveBeenCalledWith("run-1", "파일 검증 복구를 다시 시도합니다.")
    expect(appendRunEvent).toHaveBeenNthCalledWith(1, "run-1", "파일 검증 복구 재시도 1/3")
    expect(appendRunEvent).toHaveBeenNthCalledWith(2, "run-1", "대안 후보: 다른 도구")
    expect(updateRunSummary).toHaveBeenCalledWith("run-1", "파일 검증 복구를 다시 시도합니다.")
    expect(updateRunStatus).toHaveBeenCalledWith("run-1", "running", "파일 검증 복구를 다시 시도합니다.", true)
    expect(result).toEqual({
      nextMessage: "retry prompt",
      clearWorkerRuntime: true,
      clearProvider: false,
    })
  })

  it("skips failure journal when no failure detail is provided", () => {
    const rememberRunFailure = vi.fn()

    applyRecoveryRetryState({
      runId: "run-2",
      sessionId: "session-2",
      source: "webui",
      recoveryBudgetUsage: {
        interpretation: 0,
        execution: 0,
        delivery: 0,
        external: 0,
      },
      state: {
        summary: "후속 처리를 계속합니다.",
        budgetKind: "interpretation",
        maxDelegationTurns: 2,
        eventLabel: "후속 처리",
        nextMessage: "followup prompt",
        reviewStepStatus: "completed",
        executingStepSummary: "후속 처리를 계속합니다.",
      },
    }, {
      rememberRunFailure,
      incrementDelegationTurnCount: vi.fn(),
      appendRunEvent: vi.fn(),
      updateRunSummary: vi.fn(),
      setRunStepStatus: vi.fn(),
      updateRunStatus: vi.fn(),
    })

    expect(rememberRunFailure).not.toHaveBeenCalled()
  })
})
