import { describe, expect, it, vi } from "vitest"
import { applyExternalRecoveryAttempt } from "../packages/core/src/runs/external-retry-application.ts"

describe("external retry application", () => {
  it("stops when the llm recovery limit is reached", () => {
    const rememberRunFailure = vi.fn()
    const appendRunEvent = vi.fn()

    const result = applyExternalRecoveryAttempt({
      kind: "llm",
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
      failureTitle: "llm_recovery",
      payload: {
        summary: "LLM 오류를 분석하고 다른 방법으로 재시도합니다.",
        reason: "403 blocked",
        message: "forbidden",
      },
      limitRemainingItems: ["모델 호출 실패 원인을 더 분석해야 하지만 자동 재시도 한도에 도달했습니다."],
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
      summary: "LLM 오류를 분석하고 다른 방법으로 재시도합니다.",
      detail: "403 blocked\nforbidden",
      title: "llm_recovery",
    })
    expect(appendRunEvent).toHaveBeenCalledWith("run-1", "LLM 복구 한도 도달 0/2")
    expect(result).toEqual({
      kind: "stop",
      stop: {
        summary: "LLM 복구 재시도 한도(2회)에 도달했습니다.",
        reason: "403 blocked",
        remainingItems: ["모델 호출 실패 원인을 더 분석해야 하지만 자동 재시도 한도에 도달했습니다."],
      },
    })
  })

  it("applies retry state when worker runtime recovery continues", () => {
    const rememberRunFailure = vi.fn()
    const incrementDelegationTurnCount = vi.fn()
    const appendRunEvent = vi.fn()
    const setRunStepStatus = vi.fn()
    const updateRunStatus = vi.fn()

    const result = applyExternalRecoveryAttempt({
      kind: "worker_runtime",
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
      failureTitle: "worker_runtime_recovery",
      payload: {
        summary: "Claude Code 오류를 분석하고 다른 경로로 재시도합니다.",
        reason: "sandbox denied",
        message: "command failed",
      },
      limitRemainingItems: ["작업 세션 실패 원인을 더 분석해야 하지만 자동 재시도 한도에 도달했습니다."],
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
      summary: "Claude Code 오류를 분석하고 다른 경로로 재시도합니다.",
      detail: "sandbox denied\ncommand failed",
      title: "worker_runtime_recovery",
    })
    expect(incrementDelegationTurnCount).toHaveBeenCalledWith("run-2", "Claude Code 오류를 분석하고 다른 경로로 재시도합니다.")
    expect(appendRunEvent).toHaveBeenCalledWith("run-2", "작업 세션 복구 재시도 1/2")
    expect(setRunStepStatus).toHaveBeenCalledWith("run-2", "executing", "running", "Claude Code 오류를 분석하고 다른 경로로 재시도합니다.")
    expect(updateRunStatus).toHaveBeenCalledWith("run-2", "running", "Claude Code 오류를 분석하고 다른 경로로 재시도합니다.", true)
    expect(result).toEqual({
      kind: "retry",
      payload: {
        summary: "Claude Code 오류를 분석하고 다른 경로로 재시도합니다.",
        reason: "sandbox denied",
        message: "command failed",
      },
    })
  })
})
