import { describe, expect, it, vi } from "vitest"
import { runLoopEntryPass } from "../packages/core/src/runs/loop-entry-pass.ts"

function createDependencies() {
  return {
    rememberRunFailure: vi.fn(),
    incrementDelegationTurnCount: vi.fn(),
    appendRunEvent: vi.fn(),
    setRunStepStatus: vi.fn(),
    updateRunStatus: vi.fn(),
    getDelegationTurnState: vi.fn(() => ({ usedTurns: 0, maxTurns: 3 })),
    executeLoopDirective: vi.fn().mockResolvedValue("break"),
    tryHandleActiveQueueCancellation: vi.fn().mockResolvedValue(null),
    tryHandleIntakeBridge: vi.fn().mockResolvedValue(null),
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

describe("run loop entry pass", () => {
  it("retries intake directives through intake retry application", async () => {
    const dependencies = createDependencies()
    const result = await runLoopEntryPass({
      runId: "run-1",
      sessionId: "session-1",
      source: "telegram",
      onChunk: undefined,
      pendingLoopDirective: {
        kind: "retry_intake",
        summary: "일정 재분석",
        reason: "run_at missing",
        message: "retry prompt",
      },
      intakeProcessed: true,
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
    })
    expect(dependencies.getDelegationTurnState).toHaveBeenCalled()
  })

  it("breaks after executing non-retry directives", async () => {
    const dependencies = createDependencies()
    const result = await runLoopEntryPass({
      runId: "run-2",
      sessionId: "session-2",
      source: "webui",
      onChunk: undefined,
      pendingLoopDirective: {
        kind: "complete",
        text: "done",
      },
      intakeProcessed: true,
      recoveryBudgetUsage: {
        interpretation: 0,
        execution: 0,
        delivery: 0,
        external: 0,
      },
      finalizationDependencies: createFinalizationDependencies(),
    }, dependencies)

    expect(result).toEqual({ kind: "break" })
    expect(dependencies.executeLoopDirective).toHaveBeenCalled()
  })

  it("sets directive from intake handlers when intake is not processed", async () => {
    const dependencies = createDependencies()
    dependencies.tryHandleIntakeBridge.mockResolvedValue({
      kind: "awaiting_user",
      preview: "",
      summary: "need target",
    })

    const result = await runLoopEntryPass({
      runId: "run-3",
      sessionId: "session-3",
      source: "cli",
      onChunk: undefined,
      pendingLoopDirective: null,
      intakeProcessed: false,
      recoveryBudgetUsage: {
        interpretation: 0,
        execution: 0,
        delivery: 0,
        external: 0,
      },
      finalizationDependencies: createFinalizationDependencies(),
    }, dependencies)

    expect(result).toEqual({
      kind: "set_directive",
      directive: {
        kind: "awaiting_user",
        preview: "",
        summary: "need target",
      },
      intakeProcessed: true,
    })
  })
})
