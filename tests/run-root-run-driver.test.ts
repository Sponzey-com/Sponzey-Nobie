import { describe, expect, it, vi } from "vitest"
import { executeRootRunDriver } from "../packages/core/src/runs/root-run-driver.ts"

function createDependencies() {
  return {
    appendRunEvent: vi.fn(),
    updateRunSummary: vi.fn(),
    setRunStepStatus: vi.fn(),
    updateRunStatus: vi.fn(),
    rememberRunFailure: vi.fn(),
    incrementDelegationTurnCount: vi.fn(),
    markAbortedRunCancelledIfActive: vi.fn(),
    getDelegationTurnState: vi.fn(() => ({ usedTurns: 0, maxTurns: 5 })),
    getFinalizationDependencies: vi.fn(() => ({
      appendRunEvent: vi.fn(),
      setRunStepStatus: vi.fn(),
      updateRunStatus: vi.fn(),
      rememberRunSuccess: vi.fn(),
      rememberRunFailure: vi.fn(),
      onDeliveryError: vi.fn(),
    })),
    insertMessage: vi.fn() as any,
    writeReplyLog: vi.fn() as any,
    createId: vi.fn(() => "generated-id"),
    now: vi.fn(() => 123),
    runVerificationSubtask: vi.fn(async () => ({ ok: true, summary: "verified" })),
    rememberRunApprovalScope: vi.fn(),
    grantRunApprovalScope: vi.fn(),
    grantRunSingleApproval: vi.fn(),
    onDeliveryError: vi.fn(),
    onReviewError: vi.fn(),
    executeLoopDirective: vi.fn(async () => "break" as const),
    tryHandleActiveQueueCancellation: vi.fn(async () => null),
    tryHandleIntakeBridge: vi.fn(async () => null),
    getSyntheticApprovalAlreadyApproved: vi.fn(() => false),
    onBootstrapInfo: vi.fn(),
    onFinally: vi.fn(),
  }
}

function createParams() {
  return {
    runId: "run-1",
    sessionId: "session-1",
    requestGroupId: "group-1",
    source: "cli" as const,
    onChunk: undefined,
    controller: new AbortController(),
    message: "Do the work",
    originalRequest: "Original request",
    currentModel: "gpt-5",
    currentProviderId: "provider:openai",
    currentProvider: undefined,
    currentTargetId: "provider:openai",
    currentTargetLabel: "OpenAI",
    workDir: "/tmp/work",
    reconnectNeedsClarification: false,
    queuedBehindRequestGroupRun: false,
    activeWorkerRuntime: undefined,
    isRootRequest: true,
    contextMode: "isolated" as const,
    taskProfile: "general_chat" as const,
    syntheticApprovalRuntimeDependencies: {
      timeoutSec: 30,
      fallback: "deny" as const,
      appendRunEvent: vi.fn(),
      setRunStepStatus: vi.fn(),
      updateRunStatus: vi.fn(),
      cancelRun: vi.fn(),
      emitApprovalResolved: vi.fn(),
      emitApprovalRequest: vi.fn(),
      onRequested: vi.fn(),
    },
    defaultMaxDelegationTurns: 5,
  }
}

describe("execute root run driver", () => {
  it("wraps verification and intake bridge with the resolved original request", async () => {
    const dependencies = createDependencies()
    const moduleDependencies = {
      createExecutionLoopRuntimeState: vi.fn((params) => ({
        executionProfile: {
          originalRequest: params.originalRequest ?? params.message,
          structuredRequest: {
            source_language: "en",
            normalized_english: params.message,
            target: params.message,
            to: "the current channel",
            context: [],
            complete_condition: [],
          },
          intentEnvelope: {
            intent_type: "task_intake",
            source_language: "en",
            normalized_english: params.message,
            target: params.message,
            destination: "the current channel",
            context: [],
            complete_condition: [],
            schedule_spec: {
              detected: false,
              kind: "none",
              status: "not_applicable",
              schedule_text: "",
            },
            execution_semantics: {
              filesystemEffect: "none",
              privilegedOperation: "none",
              artifactDelivery: "none",
              approvalRequired: false,
              approvalTool: "external_action",
            },
            delivery_mode: "none",
            requires_approval: false,
            approval_tool: "external_action",
            preferred_target: "auto",
            needs_tools: false,
            needs_web: false,
          },
          executionSemantics: {
            filesystemEffect: "none",
            privilegedOperation: "none",
            artifactDelivery: "none",
            approvalRequired: false,
            approvalTool: "external_action",
          },
          requiresFilesystemMutation: false,
          requiresPrivilegedToolExecution: false,
          wantsDirectArtifactDelivery: false,
          approvalRequired: false,
          approvalTool: "external_action",
        },
        originalUserRequest: params.originalRequest ?? params.message,
        priorAssistantMessages: [],
        seenFollowupPrompts: new Set<string>(),
        seenCommandFailureRecoveryKeys: new Set<string>(),
        seenExecutionRecoveryKeys: new Set<string>(),
        seenDeliveryRecoveryKeys: new Set<string>(),
        seenLlmRecoveryKeys: new Set<string>(),
        recoveryBudgetUsage: {
          interpretation: 0,
          execution: 0,
          delivery: 0,
          external: 0,
        },
        requiresFilesystemMutation: false,
        requiresPrivilegedToolExecution: false,
        pendingToolParams: new Map<string, unknown>(),
        filesystemMutationPaths: new Set<string>(["a.txt"]),
      })),
      prepareRootLoopLaunch: vi.fn((_params, _dependencies, runtime) => ({
        rootLoopParams: {} as any,
        rootLoopDependencies: {
          runVerificationSubtask: async () =>
            dependencies.runVerificationSubtask({
              originalRequest: runtime.originalUserRequest,
              mutationPaths: [...runtime.filesystemMutationPaths],
            }),
          tryHandleIntakeBridge: async (currentMessage: string) =>
            dependencies.tryHandleIntakeBridge({
              currentMessage,
              originalRequest: runtime.originalUserRequest,
            }),
        } as any,
      })),
      runRootLoop: vi.fn(async (_params, rootLoopDependencies) => {
        await rootLoopDependencies.runVerificationSubtask()
        await rootLoopDependencies.tryHandleIntakeBridge("retry with more detail")
        return {
          currentMessage: "done",
          currentModel: "gpt-5",
          currentProviderId: "provider:openai",
          currentProvider: undefined,
          currentTargetId: "provider:openai",
          currentTargetLabel: "OpenAI",
          activeWorkerRuntime: undefined,
          executionRecoveryLimitStop: null,
          llmRecoveryLimitStop: null,
          sawRealFilesystemMutation: false,
          filesystemMutationRecoveryAttempted: false,
          truncatedOutputRecoveryAttempted: false,
        }
      }),
      applyRootRunDriverFailure: vi.fn(async () => undefined),
    }

    await executeRootRunDriver(createParams(), dependencies as any, moduleDependencies as any)

    expect(dependencies.runVerificationSubtask).toHaveBeenCalledWith({
      originalRequest: "Original request",
      mutationPaths: ["a.txt"],
    })
    expect(dependencies.tryHandleIntakeBridge).toHaveBeenCalledWith({
      currentMessage: "retry with more detail",
      originalRequest: "Original request",
    })
    expect(dependencies.onFinally).toHaveBeenCalledTimes(1)
  })

  it("applies fatal failure and delivers an error chunk when root loop throws", async () => {
    const dependencies = createDependencies()
    const moduleDependencies = {
      createExecutionLoopRuntimeState: vi.fn((params) => ({
        executionProfile: {
          originalRequest: params.originalRequest ?? params.message,
          structuredRequest: {
            source_language: "en",
            normalized_english: params.message,
            target: params.message,
            to: "the current channel",
            context: [],
            complete_condition: [],
          },
          intentEnvelope: {
            intent_type: "task_intake",
            source_language: "en",
            normalized_english: params.message,
            target: params.message,
            destination: "the current channel",
            context: [],
            complete_condition: [],
            schedule_spec: {
              detected: false,
              kind: "none",
              status: "not_applicable",
              schedule_text: "",
            },
            execution_semantics: {
              filesystemEffect: "none",
              privilegedOperation: "none",
              artifactDelivery: "none",
              approvalRequired: false,
              approvalTool: "external_action",
            },
            delivery_mode: "none",
            requires_approval: false,
            approval_tool: "external_action",
            preferred_target: "auto",
            needs_tools: false,
            needs_web: false,
          },
          executionSemantics: {
            filesystemEffect: "none",
            privilegedOperation: "none",
            artifactDelivery: "none",
            approvalRequired: false,
            approvalTool: "external_action",
          },
          requiresFilesystemMutation: false,
          requiresPrivilegedToolExecution: false,
          wantsDirectArtifactDelivery: false,
          approvalRequired: false,
          approvalTool: "external_action",
        },
        originalUserRequest: params.originalRequest ?? params.message,
        priorAssistantMessages: [],
        seenFollowupPrompts: new Set<string>(),
        seenCommandFailureRecoveryKeys: new Set<string>(),
        seenExecutionRecoveryKeys: new Set<string>(),
        seenDeliveryRecoveryKeys: new Set<string>(),
        seenLlmRecoveryKeys: new Set<string>(),
        recoveryBudgetUsage: {
          interpretation: 0,
          execution: 0,
          delivery: 0,
          external: 0,
        },
        requiresFilesystemMutation: false,
        requiresPrivilegedToolExecution: false,
        pendingToolParams: new Map<string, unknown>(),
        filesystemMutationPaths: new Set<string>(),
      })),
      prepareRootLoopLaunch: vi.fn((_params, _dependencies, runtime) => ({
        rootLoopParams: {} as any,
        rootLoopDependencies: {} as any,
      })),
      runRootLoop: vi.fn(async () => {
        throw new Error("boom")
      }),
      applyRootRunDriverFailure: vi.fn(async () => undefined),
    }

    await executeRootRunDriver(createParams(), dependencies as any, moduleDependencies as any)

    expect(moduleDependencies.applyRootRunDriverFailure).toHaveBeenCalledWith(expect.objectContaining({
      runId: "run-1",
      sessionId: "session-1",
      source: "cli",
      message: "boom",
      aborted: false,
    }), expect.any(Object))
    expect(dependencies.onFinally).toHaveBeenCalledTimes(1)
  })
})
