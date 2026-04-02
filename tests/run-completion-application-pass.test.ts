import { describe, expect, it, vi } from "vitest"
import { applyCompletionApplicationPass } from "../packages/core/src/runs/completion-application-pass.ts"

function createFinalizationDependencies() {
  return {
    appendRunEvent: vi.fn(),
    setRunStepStatus: vi.fn(),
    updateRunStatus: vi.fn(),
    rememberRunSuccess: vi.fn(),
    rememberRunFailure: vi.fn(),
  }
}

function createRetryDependencies() {
  return {
    rememberRunFailure: vi.fn(),
    incrementDelegationTurnCount: vi.fn(),
    appendRunEvent: vi.fn(),
    updateRunSummary: vi.fn(),
    setRunStepStatus: vi.fn(),
    updateRunStatus: vi.fn(),
  }
}

describe("completion application pass", () => {
  it("marks completion and breaks on complete application", async () => {
    const markRunCompleted = vi.fn()

    const result = await applyCompletionApplicationPass({
      runId: "run-1",
      sessionId: "session-1",
      source: "telegram",
      onChunk: undefined,
      preview: "결과",
      application: {
        kind: "complete",
        summary: "완료",
        persistedText: "완료했습니다.",
        statusText: "완료했습니다.",
      },
      maxTurns: 3,
      recoveryBudgetUsage: {
        interpretation: 0,
        execution: 0,
        delivery: 0,
        external: 0,
      },
      finalizationDependencies: createFinalizationDependencies(),
    }, createRetryDependencies(), {
      markRunCompleted,
      applyTerminalApplication: vi.fn(),
      applyRecoveryRetryState: vi.fn(),
    })

    expect(result).toEqual({ kind: "break" })
    expect(markRunCompleted).toHaveBeenCalledWith(expect.objectContaining({
      runId: "run-1",
      sessionId: "session-1",
      text: "완료했습니다.",
    }))
  })

  it("applies retry state and returns next message on retry application", async () => {
    const applyRecoveryRetryState = vi.fn().mockReturnValue({
      nextMessage: "retry prompt",
      clearWorkerRuntime: true,
      clearProvider: false,
    })

    const result = await applyCompletionApplicationPass({
      runId: "run-2",
      sessionId: "session-2",
      source: "webui",
      onChunk: undefined,
      preview: "partial",
      application: {
        kind: "retry",
        budgetKind: "execution",
        summary: "중간에 끊긴 작업을 다시 시도합니다.",
        eventLabel: "중간 절단 복구 재시도",
        nextMessage: "retry prompt",
        reviewStepStatus: "completed",
        executingStepSummary: "다시 시도합니다.",
        normalizedFollowupPrompt: "retry prompt",
        markTruncatedOutputRecoveryAttempted: true,
        clearWorkerRuntime: true,
      },
      maxTurns: 3,
      recoveryBudgetUsage: {
        interpretation: 0,
        execution: 0,
        delivery: 0,
        external: 0,
      },
      finalizationDependencies: createFinalizationDependencies(),
    }, createRetryDependencies(), {
      markRunCompleted: vi.fn(),
      applyTerminalApplication: vi.fn(),
      applyRecoveryRetryState,
    })

    expect(applyRecoveryRetryState).toHaveBeenCalled()
    expect(result).toEqual({
      kind: "retry",
      nextMessage: "retry prompt",
      clearWorkerRuntime: true,
      normalizedFollowupPrompt: "retry prompt",
      markTruncatedOutputRecoveryAttempted: true,
    })
  })

  it("moves to terminal state and breaks on awaiting_user application", async () => {
    const applyTerminalApplication = vi.fn().mockResolvedValue("awaiting_user")

    const result = await applyCompletionApplicationPass({
      runId: "run-3",
      sessionId: "session-3",
      source: "cli",
      onChunk: undefined,
      preview: "partial",
      application: {
        kind: "awaiting_user",
        summary: "추가 입력이 필요합니다.",
        userMessage: "파일명을 알려 주세요.",
      },
      maxTurns: 3,
      recoveryBudgetUsage: {
        interpretation: 0,
        execution: 0,
        delivery: 0,
        external: 0,
      },
      finalizationDependencies: createFinalizationDependencies(),
    }, createRetryDependencies(), {
      markRunCompleted: vi.fn(),
      applyTerminalApplication,
      applyRecoveryRetryState: vi.fn(),
    })

    expect(result).toEqual({ kind: "break" })
    expect(applyTerminalApplication).toHaveBeenCalledWith(expect.objectContaining({
      runId: "run-3",
      sessionId: "session-3",
      source: "cli",
      application: expect.objectContaining({
        kind: "awaiting_user",
        summary: "추가 입력이 필요합니다.",
      }),
    }))
  })
})
