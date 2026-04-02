import { describe, expect, it, vi } from "vitest"
import { applyIntakeRetryDirective } from "../packages/core/src/runs/intake-retry-application.ts"

function createFinalizationDependencies() {
  return {
    appendRunEvent: vi.fn(),
    setRunStepStatus: vi.fn(),
    updateRunStatus: vi.fn(),
    rememberRunSuccess: vi.fn(),
    rememberRunFailure: vi.fn(),
  }
}

function createDependencies() {
  return {
    rememberRunFailure: vi.fn(),
    incrementDelegationTurnCount: vi.fn(),
    appendRunEvent: vi.fn(),
    setRunStepStatus: vi.fn(),
    updateRunStatus: vi.fn(),
  }
}

describe("intake retry application", () => {
  it("retries interpretation when budget remains", async () => {
    const deps = createDependencies()

    const result = await applyIntakeRetryDirective({
      runId: "run-1",
      sessionId: "session-1",
      source: "telegram",
      onChunk: undefined,
      directive: {
        summary: "일정 요청을 다시 분석합니다.",
        reason: "run_at이 비어 있습니다.",
        message: "retry prompt",
        eventLabel: "일정 해석 실패로 재분석",
      },
      usedTurns: 0,
      maxTurns: 3,
      recoveryBudgetUsage: {
        interpretation: 0,
        execution: 0,
        delivery: 0,
        external: 0,
      },
      finalizationDependencies: createFinalizationDependencies(),
    }, deps)

    expect(result).toEqual({
      kind: "retry",
      nextMessage: "retry prompt",
    })
    expect(deps.rememberRunFailure).toHaveBeenCalled()
    expect(deps.incrementDelegationTurnCount).toHaveBeenCalledWith("run-1", "일정 요청을 다시 분석합니다.")
    expect(deps.appendRunEvent).toHaveBeenCalledWith("run-1", "일정 해석 실패로 재분석")
    expect(deps.setRunStepStatus).toHaveBeenCalledWith("run-1", "executing", "running", "일정 요청을 다시 분석합니다.")
  })

  it("stops when interpretation retry budget is exhausted", async () => {
    const deps = createDependencies()
    const applyTerminalApplication = vi.fn().mockResolvedValue("cancelled")

    const result = await applyIntakeRetryDirective({
      runId: "run-2",
      sessionId: "session-2",
      source: "webui",
      onChunk: undefined,
      directive: {
        summary: "일정 요청을 다시 분석합니다.",
        reason: "cron을 만들 수 없습니다.",
        message: "retry prompt",
        remainingItems: ["유효한 run_at 또는 cron 필요"],
      },
      usedTurns: 2,
      maxTurns: 2,
      recoveryBudgetUsage: {
        interpretation: 0,
        execution: 0,
        delivery: 0,
        external: 0,
      },
      finalizationDependencies: createFinalizationDependencies(),
    }, deps, {
      applyTerminalApplication,
    })

    expect(result).toEqual({ kind: "break" })
    expect(applyTerminalApplication).toHaveBeenCalledWith(expect.objectContaining({
      runId: "run-2",
      sessionId: "session-2",
      source: "webui",
      application: expect.objectContaining({
        kind: "stop",
      }),
    }))
  })
})
