import { describe, expect, it, vi } from "vitest"
import { runRecoveryEntryPass } from "../packages/core/src/runs/recovery-entry-pass.ts"

function createBaseParams() {
  return {
    runId: "run-1",
    sessionId: "session-1",
    source: "telegram" as const,
    onChunk: undefined,
    preview: "preview",
    executionRecoveryLimitStop: null,
    llmRecoveryLimitStop: null,
    recoveries: [
      { kind: "llm" as const, payload: { summary: "llm", reason: "a", message: "b" } },
      { kind: "worker_runtime" as const, payload: { summary: "worker", reason: "c", message: "d" } },
    ],
    aborted: false,
    failed: false,
    taskProfile: "general_chat" as const,
    current: {
      model: "gpt-4o-mini",
      providerId: "openai",
      provider: undefined,
      targetId: "provider:openai",
      targetLabel: "OpenAI",
      workerRuntime: undefined,
    },
    seenKeys: new Set<string>(),
    originalRequest: "hello",
    previousResult: "preview",
    finalizationDependencies: {
      appendRunEvent: vi.fn(),
      setRunStepStatus: vi.fn(),
      updateRunStatus: vi.fn(),
      rememberRunSuccess: vi.fn(),
      rememberRunFailure: vi.fn(),
    },
  }
}

describe("recovery entry pass", () => {
  it("breaks when execution recovery limit stop exists", async () => {
    const applyTerminalApplication = vi.fn()

    const result = await runRecoveryEntryPass({
      ...createBaseParams(),
      executionRecoveryLimitStop: {
        summary: "실행 복구 한도",
        reason: "limit",
        remainingItems: ["manual action"],
      },
    }, {
      appendRunEvent: vi.fn(),
    }, {
      applyTerminalApplication,
      runExternalRecoverySequence: vi.fn(),
      enqueueRunRecovery: async ({ task }) => task(),
    })

    expect(result).toEqual({ kind: "break" })
    expect(applyTerminalApplication).toHaveBeenCalled()
  })

  it("retries when external recovery sequence returns retry", async () => {
    const runExternalRecoverySequence = vi.fn().mockResolvedValue({
      kind: "retry",
      nextState: {
        model: "claude-sonnet",
        providerId: "anthropic",
        provider: undefined,
        targetId: "worker:claude",
        targetLabel: "Claude",
        workerRuntime: undefined,
      },
      nextMessage: "retry prompt",
    })

    const result = await runRecoveryEntryPass(createBaseParams(), {
      appendRunEvent: vi.fn(),
    }, {
      applyTerminalApplication: vi.fn(),
      runExternalRecoverySequence,
      enqueueRunRecovery: async ({ task }) => task(),
    })

    expect(result).toEqual({
      kind: "retry",
      nextState: {
        model: "claude-sonnet",
        providerId: "anthropic",
        provider: undefined,
        targetId: "worker:claude",
        targetLabel: "Claude",
        workerRuntime: undefined,
      },
      nextMessage: "retry prompt",
    })
    expect(runExternalRecoverySequence).toHaveBeenCalled()
  })

  it("breaks when execution already failed and no recovery applies", async () => {
    const result = await runRecoveryEntryPass({
      ...createBaseParams(),
      failed: true,
    }, {
      appendRunEvent: vi.fn(),
    }, {
      applyTerminalApplication: vi.fn(),
      runExternalRecoverySequence: vi.fn().mockResolvedValue({ kind: "none" }),
      enqueueRunRecovery: async ({ task }) => task(),
    })

    expect(result).toEqual({ kind: "break" })
  })

  it("continues when there is no stop, retry, or failure", async () => {
    const result = await runRecoveryEntryPass(createBaseParams(), {
      appendRunEvent: vi.fn(),
    }, {
      applyTerminalApplication: vi.fn(),
      runExternalRecoverySequence: vi.fn().mockResolvedValue({ kind: "none" }),
      enqueueRunRecovery: async ({ task }) => task(),
    })

    expect(result).toEqual({ kind: "continue" })
  })
})
