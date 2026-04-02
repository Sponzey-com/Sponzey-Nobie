import { describe, expect, it, vi } from "vitest"
import { applyExecutionChunkPass } from "../packages/core/src/runs/execution-chunk-pass.ts"

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

function createBaseParams() {
  return {
    runId: "run-1",
    sessionId: "session-1",
    source: "telegram" as const,
    preview: "",
    workDir: "/tmp",
    pendingToolParams: new Map<string, unknown>(),
    successfulTools: [],
    filesystemMutationPaths: new Set<string>(),
    failedCommandTools: [],
    commandFailureSeen: false,
    recoveryBudgetUsage: {
      interpretation: 0,
      execution: 0,
      delivery: 0,
      external: 0,
    },
    usedTurns: 0,
    maxDelegationTurns: 3,
  }
}

describe("execution chunk pass", () => {
  it("updates preview for text chunks", () => {
    const dependencies = createDependencies()

    const result = applyExecutionChunkPass({
      ...createBaseParams(),
      chunk: { type: "text", delta: "hello" },
    }, dependencies)

    expect(result).toEqual({
      handled: true,
      preview: "hello",
    })
    expect(dependencies.updateRunSummary).toHaveBeenCalledWith("run-1", "hello")
  })

  it("returns execution recovery stop with abort flag", () => {
    const dependencies = createDependencies()

    const result = applyExecutionChunkPass({
      ...createBaseParams(),
      chunk: {
        type: "execution_recovery",
        toolNames: ["screencapture"],
        summary: "retry",
        reason: "missing permission",
      },
    }, dependencies, {
      applyToolStartChunk: vi.fn(),
      applyToolEndChunk: vi.fn(),
      applyExecutionRecoveryAttempt: vi.fn().mockReturnValue({
        kind: "stop",
        stop: {
          summary: "실행 복구 한도",
          reason: "missing permission",
          remainingItems: ["manual action"],
        },
      }),
      applyExternalRecoveryAttempt: vi.fn(),
    })

    expect(result).toEqual({
      handled: true,
      executionRecoveryLimitStop: {
        summary: "실행 복구 한도",
        reason: "missing permission",
        remainingItems: ["manual action"],
      },
      abortExecutionStream: true,
    })
  })

  it("applies tool end state updates", () => {
    const dependencies = createDependencies()

    const result = applyExecutionChunkPass({
      ...createBaseParams(),
      chunk: {
        type: "tool_end",
        toolName: "write_file",
        success: true,
        output: "ok",
      },
    }, dependencies, {
      applyToolStartChunk: vi.fn(),
      applyToolEndChunk: vi.fn().mockReturnValue({
        sawRealFilesystemMutation: true,
        commandFailureSeen: true,
        commandRecoveredWithinSamePass: false,
      }),
      applyExecutionRecoveryAttempt: vi.fn(),
      applyExternalRecoveryAttempt: vi.fn(),
    })

    expect(result).toEqual({
      handled: true,
      sawRealFilesystemMutation: true,
      commandFailureSeen: true,
      commandRecoveredWithinSamePass: false,
    })
  })

  it("returns llm recovery retry payload", () => {
    const dependencies = createDependencies()

    const result = applyExecutionChunkPass({
      ...createBaseParams(),
      chunk: {
        type: "llm_recovery",
        summary: "LLM 오류를 분석하고 다른 방법으로 재시도합니다.",
        reason: "403 blocked",
        message: "forbidden",
      },
    }, dependencies, {
      applyToolStartChunk: vi.fn(),
      applyToolEndChunk: vi.fn(),
      applyExecutionRecoveryAttempt: vi.fn(),
      applyExternalRecoveryAttempt: vi.fn().mockReturnValue({
        kind: "retry",
        payload: {
          summary: "LLM 오류를 분석하고 다른 방법으로 재시도합니다.",
          reason: "403 blocked",
          message: "forbidden",
        },
      }),
    })

    expect(result).toEqual({
      handled: true,
      llmRecovery: {
        summary: "LLM 오류를 분석하고 다른 방법으로 재시도합니다.",
        reason: "403 blocked",
        message: "forbidden",
      },
    })
  })
})
