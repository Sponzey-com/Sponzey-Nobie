import { describe, expect, it, vi } from "vitest"
import { runExecutionAttemptPass } from "../packages/core/src/runs/execution-attempt-pass.ts"

async function* toAsyncGenerator<T>(items: T[]): AsyncGenerator<T> {
  for (const item of items) {
    yield item
  }
}

function createDependencies() {
  return {
    rememberRunFailure: vi.fn(),
    incrementDelegationTurnCount: vi.fn(),
    appendRunEvent: vi.fn(),
    updateRunSummary: vi.fn(),
    setRunStepStatus: vi.fn(),
    updateRunStatus: vi.fn(),
    markAbortedRunCancelledIfActive: vi.fn(),
  }
}

function createParams() {
  return {
    runId: "run-1",
    sessionId: "session-1",
    source: "telegram" as const,
    onChunk: undefined,
    onDeliveryError: vi.fn(),
    currentMessage: "do work",
    memorySearchQuery: "do work",
    workDir: "/tmp",
    signal: new AbortController().signal,
    isRootRequest: true,
    requestGroupId: "group-1",
    contextMode: "full" as const,
    preview: "",
    activeWorkerRuntime: {
      kind: "internal_ai" as const,
      targetId: "worker:internal_ai",
      label: "코드 작업 보조 세션",
      command: "disabled",
    },
    workerSessionId: "worker-1",
    pendingToolParams: new Map<string, unknown>(),
    successfulTools: [],
    filesystemMutationPaths: new Set<string>(),
    failedCommandTools: [],
    successfulFileDeliveries: [],
    successfulTextDeliveries: [],
    commandFailureSeen: false,
    recoveryBudgetUsage: {
      interpretation: 0,
      execution: 0,
      delivery: 0,
      external: 0,
    },
    executionRecoveryLimitStop: null,
    stopAfterDirectArtifactDeliverySuccess: false,
    abortExecutionStream: vi.fn(),
  }
}

describe("run execution attempt pass", () => {
  it("runs chunk stream and updates preview", async () => {
    const dependencies = createDependencies()
    const moduleDependencies = {
      createExecutionChunkStream: vi.fn(() => toAsyncGenerator([
        { type: "text", delta: "hello" },
        { type: "done", totalTokens: 1 },
      ])),
      applyExecutionChunkPass: vi.fn(() => ({
        handled: true,
        preview: "hello",
      })),
      applyErrorChunkPass: vi.fn(),
      deliverTrackedChunk: vi.fn().mockResolvedValue(undefined),
      getRootRun: vi.fn(() => ({
        delegationTurnCount: 1,
        maxDelegationTurns: 3,
      })),
    }

    const result = await runExecutionAttemptPass(createParams(), dependencies, moduleDependencies)

    expect(result.preview).toBe("hello")
    expect(result.failed).toBe(false)
    expect(dependencies.appendRunEvent).toHaveBeenCalledWith("run-1", "worker-1 실행 시작")
    expect(dependencies.updateRunSummary).toHaveBeenCalledWith("run-1", "코드 작업 보조 세션에서 작업을 실행 중입니다.")
    expect(moduleDependencies.deliverTrackedChunk).toHaveBeenCalledTimes(2)
  })

  it("delegates error chunks and returns worker runtime recovery", async () => {
    const dependencies = createDependencies()
    const moduleDependencies = {
      createExecutionChunkStream: vi.fn(() => toAsyncGenerator([
        { type: "error", message: "boom" },
      ])),
      applyExecutionChunkPass: vi.fn(),
      applyErrorChunkPass: vi.fn().mockResolvedValue({
        failed: false,
        workerRuntimeRecovery: {
          summary: "retry runtime",
          reason: "boom",
          message: "boom",
        },
      }),
      deliverTrackedChunk: vi.fn(),
      getRootRun: vi.fn(() => ({
        delegationTurnCount: 0,
        maxDelegationTurns: 3,
      })),
    }

    const result = await runExecutionAttemptPass(createParams(), dependencies, moduleDependencies)

    expect(moduleDependencies.applyErrorChunkPass).toHaveBeenCalled()
    expect(result.workerRuntimeRecovery).toEqual({
      summary: "retry runtime",
      reason: "boom",
      message: "boom",
    })
    expect(result.failed).toBe(false)
  })

  it("aborts execution stream when execution chunk requests stop", async () => {
    const dependencies = createDependencies()
    const params = createParams()
    const moduleDependencies = {
      createExecutionChunkStream: vi.fn(() => toAsyncGenerator([
        { type: "execution_recovery", toolNames: ["tool"], summary: "retry", reason: "limit" },
      ])),
      applyExecutionChunkPass: vi.fn(() => ({
        handled: true,
        executionRecoveryLimitStop: {
          summary: "limit",
          reason: "reason",
          remainingItems: ["item"],
        },
        abortExecutionStream: true,
      })),
      applyErrorChunkPass: vi.fn(),
      deliverTrackedChunk: vi.fn().mockResolvedValue(undefined),
      getRootRun: vi.fn(() => ({
        delegationTurnCount: 1,
        maxDelegationTurns: 3,
      })),
    }

    const result = await runExecutionAttemptPass(params, dependencies, moduleDependencies)

    expect(params.abortExecutionStream).toHaveBeenCalled()
    expect(result.executionRecoveryLimitStop).toEqual({
      summary: "limit",
      reason: "reason",
      remainingItems: ["item"],
    })
  })

  it("stops consuming further chunks after direct artifact delivery succeeds", async () => {
    const dependencies = createDependencies()
    const params = createParams()
    params.stopAfterDirectArtifactDeliverySuccess = true
    const moduleDependencies = {
      createExecutionChunkStream: vi.fn(() => toAsyncGenerator([
        {
          type: "tool_end",
          toolName: "telegram_send_file",
          success: true,
          output: "sent",
          details: {
            kind: "artifact_delivery",
            channel: "telegram",
            filePath: "/tmp/result.png",
          },
        },
        { type: "text", delta: "this should not be emitted" },
        { type: "done", totalTokens: 1 },
      ])),
      applyExecutionChunkPass: vi.fn(() => ({ handled: true })),
      applyErrorChunkPass: vi.fn(),
      deliverTrackedChunk: vi.fn().mockResolvedValue({
        artifactDeliveries: [{
          toolName: "telegram_send_file",
          channel: "telegram",
          filePath: "/tmp/result.png",
        }],
      }),
      getRootRun: vi.fn(() => ({
        delegationTurnCount: 0,
        maxDelegationTurns: 3,
      })),
    }

    const result = await runExecutionAttemptPass(params, dependencies, moduleDependencies)

    expect(result.failed).toBe(false)
    expect(moduleDependencies.applyExecutionChunkPass).toHaveBeenCalledTimes(1)
    expect(moduleDependencies.deliverTrackedChunk).toHaveBeenCalledTimes(1)
    expect(params.abortExecutionStream).toHaveBeenCalledTimes(1)
  })
})
