import { describe, expect, it, vi } from "vitest"
import { runExternalRecoverySequence } from "../packages/core/src/runs/external-recovery-sequence.ts"

function createBaseParams() {
  return {
    recoveries: [
      { kind: "ai" as const, payload: { summary: "ai", reason: "a", message: "b" } },
      { kind: "worker_runtime" as const, payload: { summary: "worker", reason: "c", message: "d" } },
    ],
    aborted: false,
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
    runId: "run-1",
    sessionId: "session-1",
    source: "telegram" as const,
    onChunk: undefined,
    preview: "preview",
    finalizationDependencies: {
      appendRunEvent: vi.fn(),
      setRunStepStatus: vi.fn(),
      updateRunStatus: vi.fn(),
      rememberRunSuccess: vi.fn(),
      rememberRunFailure: vi.fn(),
    },
  }
}

describe("external recovery sequence", () => {
  it("returns none when all passes return none", async () => {
    const runExternalRecoveryPass = vi.fn()
      .mockResolvedValueOnce({ kind: "none" })
      .mockResolvedValueOnce({ kind: "none" })

    const result = await runExternalRecoverySequence(createBaseParams(), {
      appendRunEvent: vi.fn(),
    }, {
      runExternalRecoveryPass,
    })

    expect(result).toEqual({ kind: "none" })
    expect(runExternalRecoveryPass).toHaveBeenCalledTimes(2)
  })

  it("stops on the first stop result", async () => {
    const runExternalRecoveryPass = vi.fn().mockResolvedValueOnce({ kind: "stop" })

    const result = await runExternalRecoverySequence(createBaseParams(), {
      appendRunEvent: vi.fn(),
    }, {
      runExternalRecoveryPass,
    })

    expect(result).toEqual({ kind: "stop" })
    expect(runExternalRecoveryPass).toHaveBeenCalledTimes(1)
  })

  it("returns retry when a later recovery pass retries", async () => {
    const runExternalRecoveryPass = vi.fn()
      .mockResolvedValueOnce({ kind: "none" })
      .mockResolvedValueOnce({
        kind: "retry",
        nextState: {
          model: "claude-sonnet",
          providerId: "anthropic",
          provider: undefined,
          targetId: "provider:anthropic",
          targetLabel: "Anthropic",
          workerRuntime: undefined,
        },
        nextMessage: "retry prompt",
      })

    const result = await runExternalRecoverySequence(createBaseParams(), {
      appendRunEvent: vi.fn(),
    }, {
      runExternalRecoveryPass,
    })

    expect(result).toEqual({
      kind: "retry",
      nextState: {
        model: "claude-sonnet",
        providerId: "anthropic",
        provider: undefined,
        targetId: "provider:anthropic",
        targetLabel: "Anthropic",
        workerRuntime: undefined,
      },
      nextMessage: "retry prompt",
    })
    expect(runExternalRecoveryPass).toHaveBeenCalledTimes(2)
  })
})
