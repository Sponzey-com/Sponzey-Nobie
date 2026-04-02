import { describe, expect, it, vi } from "vitest"
import { applyExecutionPostPassDecision } from "../packages/core/src/runs/execution-postpass-application.ts"

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

describe("execution post-pass application", () => {
  it("returns retry continuation with seen key metadata", async () => {
    const dependencies = createDependencies()

    const result = await applyExecutionPostPassDecision({
      runId: "run-1",
      sessionId: "session-1",
      source: "telegram",
      onChunk: undefined,
      preview: "preview",
      decision: {
        kind: "retry",
        seenKey: "command:key",
        seenKeyKind: "command",
        state: {
          summary: "명령 실패 대안 재시도",
          budgetKind: "execution",
          maxDelegationTurns: 3,
          eventLabel: "명령 실패 대안 재시도",
          nextMessage: "retry prompt",
          reviewStepStatus: "running",
          executingStepSummary: "명령 실패 대안 재시도",
          updateRunStatusSummary: "명령 실패 대안 재시도",
          clearWorkerRuntime: true,
          failureTitle: "command_failure_recovery",
          failureDetail: "screencapture missing",
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
      nextMessage: "retry prompt",
      clearWorkerRuntime: true,
      seenKey: {
        key: "command:key",
        kind: "command",
      },
    })
    expect(dependencies.rememberRunFailure).toHaveBeenCalled()
  })

  it("breaks on stop decisions", async () => {
    const applyTerminalApplication = vi.fn()

    const result = await applyExecutionPostPassDecision({
      runId: "run-2",
      sessionId: "session-2",
      source: "webui",
      onChunk: undefined,
      preview: "preview",
      decision: {
        kind: "stop",
        summary: "실행 복구 재시도 한도(2회)에 도달했습니다.",
        reason: "invalid schedule registration path",
        remainingItems: ["실패한 도구에 대한 다른 방법 탐색이 더 필요하지만 자동 한도에 도달했습니다."],
      },
      recoveryBudgetUsage: {
        interpretation: 0,
        execution: 0,
        delivery: 0,
        external: 0,
      },
      finalizationDependencies: createFinalizationDependencies(),
    }, createDependencies(), {
      applyTerminalApplication,
      applyRecoveryRetryState: vi.fn(),
    })

    expect(result).toEqual({ kind: "break" })
    expect(applyTerminalApplication).toHaveBeenCalled()
  })

  it("continues on none decisions", async () => {
    const result = await applyExecutionPostPassDecision({
      runId: "run-3",
      sessionId: "session-3",
      source: "cli",
      onChunk: undefined,
      preview: "preview",
      decision: { kind: "none" },
      recoveryBudgetUsage: {
        interpretation: 0,
        execution: 0,
        delivery: 0,
        external: 0,
      },
      finalizationDependencies: createFinalizationDependencies(),
    }, createDependencies())

    expect(result).toEqual({ kind: "continue" })
  })
})
