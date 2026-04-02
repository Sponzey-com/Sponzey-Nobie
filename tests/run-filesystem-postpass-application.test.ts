import { describe, expect, it, vi } from "vitest"
import { applyFilesystemPostPassDecision } from "../packages/core/src/runs/filesystem-postpass-application.ts"

function createDependencies() {
  return {
    rememberRunFailure: vi.fn(),
    incrementDelegationTurnCount: vi.fn(),
    appendRunEvent: vi.fn(),
    updateRunSummary: vi.fn(),
    setRunStepStatus: vi.fn(),
    updateRunStatus: vi.fn(),
  }
}

function createFinalizationDependencies() {
  return {
    appendRunEvent: vi.fn(),
    setRunStepStatus: vi.fn(),
    updateRunStatus: vi.fn(),
    rememberRunSuccess: vi.fn(),
    rememberRunFailure: vi.fn(),
  }
}

describe("filesystem post-pass application", () => {
  it("applies initial retry as running continuation", async () => {
    const dependencies = createDependencies()

    const result = await applyFilesystemPostPassDecision({
      runId: "run-1",
      sessionId: "session-1",
      source: "telegram",
      onChunk: undefined,
      preview: "preview",
      decision: {
        kind: "initial_retry",
        eventLabel: "실제 파일/폴더 변경이 확인되지 않아 로컬 도구 작업으로 재시도합니다.",
        summary: "실제 파일/폴더 작업을 다시 시도합니다.",
        nextMessage: "retry prompt",
        markAttempted: true,
      },
      recoveryBudgetUsage: {
        interpretation: 0,
        execution: 0,
        delivery: 0,
        external: 0,
      },
      finalizationDependencies: createFinalizationDependencies(),
    }, dependencies)

    expect(result).toEqual({
      kind: "retry",
      nextMessage: "retry prompt",
      clearWorkerRuntime: true,
      markMutationRecoveryAttempted: true,
    })
    expect(dependencies.appendRunEvent).toHaveBeenCalledWith(
      "run-1",
      "실제 파일/폴더 변경이 확인되지 않아 로컬 도구 작업으로 재시도합니다.",
    )
    expect(dependencies.updateRunStatus).toHaveBeenCalledWith(
      "run-1",
      "running",
      "실제 파일/폴더 작업을 다시 시도합니다.",
      true,
    )
  })

  it("applies retry through recovery retry helper", async () => {
    const dependencies = createDependencies()

    const result = await applyFilesystemPostPassDecision({
      runId: "run-2",
      sessionId: "session-2",
      source: "webui",
      onChunk: undefined,
      preview: "preview",
      decision: {
        kind: "retry",
        state: {
          summary: "파일 검증 복구를 다시 시도합니다.",
          budgetKind: "execution",
          maxDelegationTurns: 3,
          eventLabel: "파일 검증 복구 재시도",
          nextMessage: "verification retry",
          reviewStepStatus: "running",
          executingStepSummary: "파일 검증 복구를 다시 시도합니다.",
          updateRunStatusSummary: "파일 검증 복구를 다시 시도합니다.",
          clearWorkerRuntime: true,
          failureTitle: "filesystem_verification_recovery",
          failureDetail: "검증 실패",
        },
      },
      recoveryBudgetUsage: {
        interpretation: 0,
        execution: 0,
        delivery: 0,
        external: 0,
      },
      finalizationDependencies: createFinalizationDependencies(),
    }, dependencies)

    expect(result).toEqual({
      kind: "retry",
      nextMessage: "verification retry",
      clearWorkerRuntime: true,
    })
    expect(dependencies.rememberRunFailure).toHaveBeenCalled()
    expect(dependencies.incrementDelegationTurnCount).toHaveBeenCalled()
  })

  it("returns updated preview for verified results", async () => {
    const dependencies = createDependencies()

    const result = await applyFilesystemPostPassDecision({
      runId: "run-3",
      sessionId: "session-3",
      source: "cli",
      onChunk: undefined,
      preview: "preview",
      decision: {
        kind: "verified",
        summary: "검증 완료",
        eventLabel: "실제 파일/폴더 결과 검증을 완료했습니다.",
        nextPreview: "preview\n\n검증 완료",
      },
      recoveryBudgetUsage: {
        interpretation: 0,
        execution: 0,
        delivery: 0,
        external: 0,
      },
      finalizationDependencies: createFinalizationDependencies(),
    }, dependencies)

    expect(result).toEqual({
      kind: "continue",
      preview: "preview\n\n검증 완료",
    })
    expect(dependencies.appendRunEvent).toHaveBeenCalledWith(
      "run-3",
      "실제 파일/폴더 결과 검증을 완료했습니다.",
    )
  })
})
