import { describe, expect, it, vi } from "vitest"
import { applyLoopDirective } from "../packages/core/src/runs/loop-directive-application.ts"

function createFinalizationDependencies() {
  return {
    appendRunEvent: vi.fn(),
    setRunStepStatus: vi.fn(),
    updateRunStatus: vi.fn(),
    rememberRunSuccess: vi.fn(),
    rememberRunFailure: vi.fn(),
    onDeliveryError: vi.fn(),
  }
}

describe("apply loop directive", () => {
  it("completes complete directives through finalization helper", async () => {
    const finalizationDependencies = createFinalizationDependencies()
    const moduleDependencies = {
      completeRunWithAssistantMessage: vi.fn().mockResolvedValue(undefined),
      applyTerminalApplication: vi.fn(),
    }

    const result = await applyLoopDirective({
      runId: "run-1",
      sessionId: "session-1",
      source: "telegram",
      onChunk: undefined,
      directive: {
        kind: "complete",
        text: "done",
        eventLabel: "완료 전달",
      },
      finalizationDependencies,
    }, moduleDependencies)

    expect(result).toBe("break")
    expect(finalizationDependencies.appendRunEvent).toHaveBeenCalledWith("run-1", "완료 전달")
    expect(moduleDependencies.completeRunWithAssistantMessage).toHaveBeenCalledWith(expect.objectContaining({
      runId: "run-1",
      sessionId: "session-1",
      text: "done",
      source: "telegram",
      dependencies: finalizationDependencies,
    }))
  })

  it("routes awaiting_user directives through terminal application", async () => {
    const finalizationDependencies = createFinalizationDependencies()
    const moduleDependencies = {
      completeRunWithAssistantMessage: vi.fn(),
      applyTerminalApplication: vi.fn().mockResolvedValue("awaiting_user"),
    }

    const result = await applyLoopDirective({
      runId: "run-2",
      sessionId: "session-2",
      source: "webui",
      onChunk: undefined,
      directive: {
        kind: "awaiting_user",
        preview: "",
        summary: "추가 입력 필요",
        reason: "target missing",
        remainingItems: ["대상을 지정해 주세요."],
      },
      finalizationDependencies,
    }, moduleDependencies)

    expect(result).toBe("break")
    expect(moduleDependencies.applyTerminalApplication).toHaveBeenCalledWith(expect.objectContaining({
      runId: "run-2",
      sessionId: "session-2",
      source: "webui",
      dependencies: finalizationDependencies,
      application: expect.objectContaining({
        kind: "awaiting_user",
        summary: "추가 입력 필요",
        reason: "target missing",
      }),
    }))
  })

  it("throws for retry_intake directives", async () => {
    const finalizationDependencies = createFinalizationDependencies()

    await expect(applyLoopDirective({
      runId: "run-3",
      sessionId: "session-3",
      source: "cli",
      onChunk: undefined,
      directive: {
        kind: "retry_intake",
        summary: "재분석",
        reason: "missing run_at",
        message: "retry prompt",
      },
      finalizationDependencies,
    }, {
      completeRunWithAssistantMessage: vi.fn(),
      applyTerminalApplication: vi.fn(),
    })).rejects.toThrow("retry_intake directive must be handled inside the main loop before applyLoopDirective")
  })
})
