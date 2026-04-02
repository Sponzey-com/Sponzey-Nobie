import { describe, expect, it, vi } from "vitest"
import { applyExecutionRecoveryAttempt } from "../packages/core/src/runs/execution-retry-application.ts"

describe("execution retry application", () => {
  it("stops when the execution recovery limit is reached", () => {
    const rememberRunFailure = vi.fn()
    const appendRunEvent = vi.fn()

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
      incrementDelegationTurnCount: vi.fn(),
      appendRunEvent,
      setRunStepStatus: vi.fn(),
      updateRunStatus: vi.fn(),
    })

    expect(rememberRunFailure).toHaveBeenCalledWith({
      runId: "run-1",
      sessionId: "session-1",
      source: "telegram",
      summary: "실행 오류를 분석하고 다른 도구 조합으로 재시도합니다.",
      detail: "tool failed",
      title: "execution_recovery: shell_exec",
    })
    expect(appendRunEvent).toHaveBeenCalledWith("run-1", "실행 복구 한도 도달 0/2")
    expect(result).toEqual({
      kind: "stop",
      stop: {
        summary: "실행 복구 재시도 한도(2회)에 도달했습니다.",
        reason: "tool failed",
        remainingItems: ["shell_exec 실행 실패에 대한 추가 대안 탐색이 필요하지만 자동 한도에 도달했습니다."],
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
    expect(appendRunEvent).toHaveBeenCalledWith("run-2", "실행 복구 재시도 1/2")
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
