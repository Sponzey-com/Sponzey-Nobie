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
      state: {
        executionSatisfied: true,
        deliveryRequired: false,
        deliverySatisfied: true,
        completionSatisfied: true,
        interpretationStatus: "satisfied",
        executionStatus: "satisfied",
        deliveryStatus: "not_required",
        recoveryStatus: "settled",
        blockingReasons: [],
      },
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
      decideCompletionTerminalOutcome: vi.fn().mockReturnValue({ kind: "complete" }),
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
      state: {
        executionSatisfied: false,
        deliveryRequired: false,
        deliverySatisfied: false,
        completionSatisfied: false,
        interpretationStatus: "followup_required",
        executionStatus: "missing",
        deliveryStatus: "not_required",
        recoveryStatus: "required",
        blockingReasons: ["completion review가 추가 follow-up 작업을 요구합니다."],
        conflictReason: "completion review가 추가 follow-up 작업을 요구합니다.",
      },
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
      decideCompletionTerminalOutcome: vi.fn(),
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
      state: {
        executionSatisfied: false,
        deliveryRequired: false,
        deliverySatisfied: false,
        completionSatisfied: false,
        interpretationStatus: "user_input_required",
        executionStatus: "missing",
        deliveryStatus: "not_required",
        recoveryStatus: "required",
        blockingReasons: ["completion review가 사용자 추가 입력을 요구합니다."],
        conflictReason: "completion review가 사용자 추가 입력을 요구합니다.",
      },
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
      decideCompletionTerminalOutcome: vi.fn(),
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

  it("blocks complete application when completion state is not satisfied", async () => {
    const markRunCompleted = vi.fn()
    const applyTerminalApplication = vi.fn().mockResolvedValue("cancelled")

    const result = await applyCompletionApplicationPass({
      runId: "run-4",
      sessionId: "session-4",
      source: "telegram",
      onChunk: undefined,
      preview: "스크린샷을 만들었습니다.",
      state: {
        executionSatisfied: true,
        deliveryRequired: true,
        deliverySatisfied: false,
        completionSatisfied: false,
        interpretationStatus: "satisfied",
        executionStatus: "satisfied",
        deliveryStatus: "missing",
        recoveryStatus: "required",
        blockingReasons: ["요청된 직접 결과 전달이 아직 완료되지 않았습니다."],
        conflictReason: "요청된 직접 결과 전달이 아직 완료되지 않았습니다.",
      },
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
      decideCompletionTerminalOutcome: vi.fn().mockReturnValue({
        kind: "stop",
        summary: "완료 판정 근거가 부족해 자동 진행을 중단합니다.",
        reason: "요청된 직접 결과 전달이 아직 완료되지 않았습니다.",
        remainingItems: ["실행/전달/복구 상태를 다시 확인해야 합니다."],
      }),
      markRunCompleted,
      applyTerminalApplication,
      applyRecoveryRetryState: vi.fn(),
    })

    expect(result).toEqual({ kind: "break" })
    expect(markRunCompleted).not.toHaveBeenCalled()
    expect(applyTerminalApplication).toHaveBeenCalledWith(expect.objectContaining({
      application: expect.objectContaining({
        kind: "stop",
        reason: "요청된 직접 결과 전달이 아직 완료되지 않았습니다.",
      }),
    }))
  })
})
