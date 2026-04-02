import { describe, expect, it, vi } from "vitest"
import { runReviewEntryPass } from "../packages/core/src/runs/review-entry-pass.ts"

function createDependencies() {
  return {
    rememberRunFailure: vi.fn(),
    incrementDelegationTurnCount: vi.fn(),
    appendRunEvent: vi.fn(),
    updateRunSummary: vi.fn(),
    setRunStepStatus: vi.fn(),
    updateRunStatus: vi.fn(),
    getFinalizationDependencies: vi.fn(() => ({
      appendRunEvent: vi.fn(),
      setRunStepStatus: vi.fn(),
      updateRunStatus: vi.fn(),
      rememberRunSuccess: vi.fn(),
      rememberRunFailure: vi.fn(),
    })),
    insertMessage: vi.fn(),
    writeReplyLog: vi.fn(),
    createId: vi.fn(() => "msg-1"),
    now: vi.fn(() => 123),
  }
}

describe("run review entry pass", () => {
  it("prepares review and completes direct delivery results", async () => {
    const dependencies = createDependencies()

    const result = await runReviewEntryPass({
      runId: "run-1",
      sessionId: "session-1",
      source: "telegram",
      onChunk: undefined,
      preview: "preview text",
      workerSessionId: "worker-1",
      persistRuntimePreview: true,
      directDeliveryApplication: {
        kind: "complete",
        summary: "전달 완료",
        finalText: "캡처 전달 완료",
        eventLabel: "직접 파일 전달 요청 완료",
      },
      recoveryBudgetUsage: {
        interpretation: 0,
        execution: 0,
        delivery: 0,
        external: 0,
      },
      maxDelegationTurns: 3,
    }, dependencies)

    expect(result).toEqual({ kind: "break" })
    expect(dependencies.appendRunEvent).toHaveBeenCalledWith("run-1", "worker-1 실행 종료")
    expect(dependencies.insertMessage).toHaveBeenCalled()
    expect(dependencies.writeReplyLog).toHaveBeenCalledWith("telegram", "preview text")
    expect(dependencies.getFinalizationDependencies).toHaveBeenCalled()
  })

  it("returns retry continuation for direct delivery retry", async () => {
    const dependencies = createDependencies()

    const result = await runReviewEntryPass({
      runId: "run-2",
      sessionId: "session-2",
      source: "webui",
      onChunk: undefined,
      preview: "preview",
      persistRuntimePreview: false,
      directDeliveryApplication: {
        kind: "retry",
        recoveryKey: "delivery:key",
        summary: "메신저 결과 전달을 다시 시도합니다.",
        detail: "직접 전달이 완료되지 않았습니다.",
        title: "direct_artifact_delivery_recovery",
        eventLabel: "메신저 결과 전달 재시도",
        alternatives: [{ kind: "other_channel", label: "다른 채널" }],
        nextMessage: "retry prompt",
        reviewStepStatus: "running",
        executingStepSummary: "메신저 결과 전달을 다시 시도합니다.",
        updateRunStatusSummary: "메신저 결과 전달을 다시 시도합니다.",
        clearWorkerRuntime: true,
      },
      recoveryBudgetUsage: {
        interpretation: 0,
        execution: 0,
        delivery: 0,
        external: 0,
      },
      maxDelegationTurns: 4,
    }, dependencies)

    expect(result).toEqual({
      kind: "retry",
      nextMessage: "retry prompt",
      clearWorkerRuntime: true,
    })
    expect(dependencies.rememberRunFailure).toHaveBeenCalled()
    expect(dependencies.incrementDelegationTurnCount).toHaveBeenCalledWith("run-2", "메신저 결과 전달을 다시 시도합니다.")
  })

  it("continues to review when there is no direct delivery application", async () => {
    const dependencies = createDependencies()

    const result = await runReviewEntryPass({
      runId: "run-3",
      sessionId: "session-3",
      source: "cli",
      onChunk: undefined,
      preview: "plain preview",
      persistRuntimePreview: false,
      directDeliveryApplication: { kind: "none" },
      recoveryBudgetUsage: {
        interpretation: 0,
        execution: 0,
        delivery: 0,
        external: 0,
      },
      maxDelegationTurns: 2,
    }, dependencies)

    expect(result).toEqual({ kind: "continue" })
    expect(dependencies.writeReplyLog).toHaveBeenCalledWith("cli", "plain preview")
  })
})
