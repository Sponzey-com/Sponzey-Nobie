import { describe, expect, it, vi } from "vitest"
import { applyExecutionRecoveryAttempt } from "../packages/core/src/runs/execution-retry-application.ts"

describe("execution retry application", () => {
  it("continues ordinary execution recovery past the old fixed retry count", () => {
    const rememberRunFailure = vi.fn()
    const appendRunEvent = vi.fn()
    const incrementDelegationTurnCount = vi.fn()
    const setRunStepStatus = vi.fn()
    const updateRunStatus = vi.fn()

    const result = applyExecutionRecoveryAttempt({
      runId: "run-1",
      sessionId: "session-1",
      source: "telegram",
      recoveryBudgetUsage: {
        interpretation: 0,
        execution: 0,
        delivery: 0,
        external: 0,
      },
      usedTurns: 2,
      maxDelegationTurns: 2,
      payload: {
        summary: "실행 오류를 분석하고 다른 도구 조합으로 재시도합니다.",
        reason: "tool failed",
        toolNames: ["shell_exec"],
      },
    }, {
      rememberRunFailure,
      incrementDelegationTurnCount,
      appendRunEvent,
      setRunStepStatus,
      updateRunStatus,
    })

    expect(rememberRunFailure).toHaveBeenCalledWith({
      runId: "run-1",
      sessionId: "session-1",
      source: "telegram",
      summary: "실행 오류를 분석하고 다른 도구 조합으로 재시도합니다.",
      detail: "tool failed",
      title: "execution_recovery: shell_exec",
    })
    expect(incrementDelegationTurnCount).toHaveBeenCalledWith("run-1", "실행 오류를 분석하고 다른 도구 조합으로 재시도합니다.")
    expect(appendRunEvent).toHaveBeenCalledWith("run-1", "실행 복구 신호 1")
    expect(setRunStepStatus).toHaveBeenCalledWith("run-1", "executing", "running", "실행 오류를 분석하고 다른 도구 조합으로 재시도합니다.")
    expect(updateRunStatus).toHaveBeenCalledWith("run-1", "running", "실행 오류를 분석하고 다른 도구 조합으로 재시도합니다.", true)
    expect(result).toEqual({
      kind: "retry",
      payload: {
        summary: "실행 오류를 분석하고 다른 도구 조합으로 재시도합니다.",
        reason: "tool failed",
        toolNames: ["shell_exec"],
      },
    })
  })

  it("records retry state when execution recovery continues", () => {
    const rememberRunFailure = vi.fn()
    const incrementDelegationTurnCount = vi.fn()
    const appendRunEvent = vi.fn()
    const setRunStepStatus = vi.fn()
    const updateRunStatus = vi.fn()

    const result = applyExecutionRecoveryAttempt({
      runId: "run-2",
      sessionId: "session-2",
      source: "webui",
      recoveryBudgetUsage: {
        interpretation: 0,
        execution: 0,
        delivery: 0,
        external: 0,
      },
      usedTurns: 0,
      maxDelegationTurns: 2,
      payload: {
        summary: "실행 오류를 분석하고 다른 도구 조합으로 재시도합니다.",
        reason: "tool failed",
        toolNames: ["shell_exec", "screen_capture"],
      },
    }, {
      rememberRunFailure,
      incrementDelegationTurnCount,
      appendRunEvent,
      setRunStepStatus,
      updateRunStatus,
    })

    expect(rememberRunFailure).toHaveBeenCalledWith({
      runId: "run-2",
      sessionId: "session-2",
      source: "webui",
      summary: "실행 오류를 분석하고 다른 도구 조합으로 재시도합니다.",
      detail: "tool failed",
      title: "execution_recovery: shell_exec, screen_capture",
    })
    expect(incrementDelegationTurnCount).toHaveBeenCalledWith("run-2", "실행 오류를 분석하고 다른 도구 조합으로 재시도합니다.")
    expect(appendRunEvent).toHaveBeenCalledWith("run-2", "실행 복구 신호 1")
    expect(setRunStepStatus).toHaveBeenCalledWith("run-2", "executing", "running", "실행 오류를 분석하고 다른 도구 조합으로 재시도합니다.")
    expect(updateRunStatus).toHaveBeenCalledWith("run-2", "running", "실행 오류를 분석하고 다른 도구 조합으로 재시도합니다.", true)
    expect(result).toEqual({
      kind: "retry",
      payload: {
        summary: "실행 오류를 분석하고 다른 도구 조합으로 재시도합니다.",
        reason: "tool failed",
        toolNames: ["shell_exec", "screen_capture"],
      },
    })
  })
})
