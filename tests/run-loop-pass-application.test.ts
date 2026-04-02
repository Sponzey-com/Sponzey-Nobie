import { describe, expect, it } from "vitest"
import {
  applyLoopEntryPassResult,
  applyPostExecutionPassResult,
  applyRecoveryEntryPassResult,
  applyReviewCyclePassResult,
} from "../packages/core/src/runs/loop-pass-application.ts"

describe("loop pass application helpers", () => {
  it("resets pending directive and intake flag on loop-entry retry", () => {
    const result = applyLoopEntryPassResult({
      kind: "retry",
      nextMessage: "retry intake",
    })

    expect(result).toEqual({
      kind: "retry",
      nextMessage: "retry intake",
      state: {
        pendingLoopDirective: null,
        intakeProcessed: false,
      },
    })
  })

  it("maps recovery retry state into current execution state", () => {
    const workerRuntime = {
      kind: "codex_cli",
      targetId: "worker:codex_cli",
      label: "코드 작업 보조 세션",
      command: "codex",
    } as const

    const provider = { id: "openai" } as never
    const result = applyRecoveryEntryPassResult({
      result: {
        kind: "retry",
        nextMessage: "retry with worker runtime",
        nextState: {
          model: "gpt-5",
          providerId: "provider:openai",
          provider,
          targetId: "worker:codex_cli",
          targetLabel: "코드 작업 보조 세션",
          workerRuntime,
        },
      },
      currentMessage: "previous message",
    })

    expect(result).toEqual({
      kind: "retry",
      state: {
        currentMessage: "retry with worker runtime",
        currentModel: "gpt-5",
        currentProviderId: "provider:openai",
        currentProvider: provider,
        currentTargetId: "worker:codex_cli",
        currentTargetLabel: "코드 작업 보조 세션",
        activeWorkerRuntime: workerRuntime,
      },
    })
  })

  it("records seen recovery keys and clears worker runtime on post-execution retry", () => {
    const seenCommandFailureRecoveryKeys = new Set<string>()
    const seenExecutionRecoveryKeys = new Set<string>()
    const seenDeliveryRecoveryKeys = new Set<string>()
    const activeWorkerRuntime = {
      kind: "codex_cli",
      targetId: "worker:codex_cli",
      label: "코드 작업 보조 세션",
      command: "codex",
    } as const

    const result = applyPostExecutionPassResult({
      result: {
        kind: "retry",
        nextMessage: "retry delivery",
        clearWorkerRuntime: true,
        markMutationRecoveryAttempted: true,
        seenCommandFailureRecoveryKey: "command:key",
        seenExecutionRecoveryKey: "execution:key",
        seenDeliveryRecoveryKey: "delivery:key",
      },
      currentMessage: "previous message",
      filesystemMutationRecoveryAttempted: false,
      activeWorkerRuntime,
      seenCommandFailureRecoveryKeys,
      seenExecutionRecoveryKeys,
      seenDeliveryRecoveryKeys,
    })

    expect([...seenCommandFailureRecoveryKeys]).toEqual(["command:key"])
    expect([...seenExecutionRecoveryKeys]).toEqual(["execution:key"])
    expect([...seenDeliveryRecoveryKeys]).toEqual(["delivery:key"])
    expect(result).toEqual({
      kind: "retry",
      state: {
        currentMessage: "retry delivery",
        filesystemMutationRecoveryAttempted: true,
        activeWorkerRuntime: undefined,
      },
    })
  })

  it("records normalized followup prompts and clears runtime/provider on review retry", () => {
    const seenFollowupPrompts = new Set<string>()
    const activeWorkerRuntime = {
      kind: "codex_cli",
      targetId: "worker:codex_cli",
      label: "코드 작업 보조 세션",
      command: "codex",
    } as const
    const currentProvider = { id: "openai" } as never

    const result = applyReviewCyclePassResult({
      result: {
        kind: "retry",
        nextMessage: "follow up with more detail",
        clearWorkerRuntime: true,
        clearProvider: true,
        normalizedFollowupPrompt: "follow up with more detail",
        markTruncatedOutputRecoveryAttempted: true,
      },
      currentMessage: "previous message",
      truncatedOutputRecoveryAttempted: false,
      activeWorkerRuntime,
      currentProvider,
      seenFollowupPrompts,
    })

    expect([...seenFollowupPrompts]).toEqual(["follow up with more detail"])
    expect(result).toEqual({
      kind: "retry",
      state: {
        currentMessage: "follow up with more detail",
        truncatedOutputRecoveryAttempted: true,
        activeWorkerRuntime: undefined,
        currentProvider: undefined,
      },
    })
  })
})
