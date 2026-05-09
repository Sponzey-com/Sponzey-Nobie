import { describe, expect, it, vi } from "vitest"
import { buildIncomingIntentContract } from "../packages/core/src/runs/active-run-projection.ts"
import { buildStartPlan } from "../packages/core/src/runs/start-plan.ts"
import { buildTaskModels } from "../packages/core/src/runs/task-model.js"
import { createInboundMessageRecord } from "../packages/core/src/runs/request-isolation.ts"
import type { RootRun } from "../packages/core/src/runs/types.js"

function createDependencies(overrides?: Partial<Parameters<typeof buildStartPlan>[1]>) {
  const reconnectRun = {
    id: "run-prev",
    requestGroupId: "group-prev",
    lineageRootRunId: "group-prev",
    title: "이전 코스피 조회",
    prompt: "현재 코스피 알려줘",
    summary: "KOSPI lookup running",
    updatedAt: 100,
    status: "running",
    source: "telegram",
    sessionId: "session-1",
  } as any

  return {
    analyzeRequestEntrySemantics: vi.fn(() => ({ reuse_conversation_context: false, active_queue_cancellation_mode: null })),
    isReusableRequestGroup: vi.fn(() => false),
    listActiveSessionRequestGroups: vi.fn(() => [reconnectRun]),
    compareRequestContinuation: vi.fn(async () => ({
      kind: "same_run",
      requestGroupId: "group-prev",
      runId: "run-prev",
      decisionSource: "contract_ai",
      reason: "would incorrectly reuse without request isolation",
    } as const)),
    getRequestGroupDelegationTurnCount: vi.fn(() => 1),
    buildWorkerSessionId: vi.fn(() => undefined),
    normalizeTaskProfile: vi.fn((taskProfile) => taskProfile ?? "general_chat"),
    findLatestWorkerSessionRun: vi.fn(() => undefined),
    ...overrides,
  }
}

function makeRun(overrides: Partial<RootRun> & Pick<RootRun, "id" | "requestGroupId" | "lineageRootRunId" | "prompt">): RootRun {
  return {
    id: overrides.id,
    sessionId: overrides.sessionId ?? "telegram:chat-1",
    requestGroupId: overrides.requestGroupId,
    lineageRootRunId: overrides.lineageRootRunId,
    runScope: overrides.runScope ?? "root",
    title: overrides.title ?? overrides.prompt,
    prompt: overrides.prompt,
    source: overrides.source ?? "telegram",
    status: overrides.status ?? "completed",
    taskProfile: overrides.taskProfile ?? "general_chat",
    contextMode: overrides.contextMode ?? "isolated",
    delegationTurnCount: overrides.delegationTurnCount ?? 0,
    maxDelegationTurns: overrides.maxDelegationTurns ?? 0,
    currentStepKey: overrides.currentStepKey ?? "done",
    currentStepIndex: overrides.currentStepIndex ?? 1,
    totalSteps: overrides.totalSteps ?? 1,
    summary: overrides.summary ?? overrides.prompt,
    canCancel: overrides.canCancel ?? false,
    createdAt: overrides.createdAt ?? 1,
    updatedAt: overrides.updatedAt ?? 1,
    steps: overrides.steps ?? [],
    recentEvents: overrides.recentEvents ?? [],
    ...(overrides.parentRunId ? { parentRunId: overrides.parentRunId } : {}),
    ...(overrides.promptSourceSnapshot ? { promptSourceSnapshot: overrides.promptSourceSnapshot } : {}),
  }
}

function promptSnapshot(messageKey: string) {
  return {
    inboundMessage: {
      messageKey,
      rootIsolation: "new_root_by_default",
    },
    requestIsolation: {
      mode: "root",
      continuationSource: "new_root",
      contextMode: "isolated",
    },
  }
}

describe("request continuity new message isolation", () => {
  it("does not inspect or reuse an active task for a separate Telegram message", async () => {
    const dependencies = createDependencies()
    const inboundMessage = createInboundMessageRecord({
      source: "telegram",
      sessionId: "telegram:chat-1",
      channelEventId: "chat-1:main:204",
      externalChatId: "chat-1",
      externalThreadId: "main",
      externalMessageId: 204,
      userId: 7,
      rawText: "현재 나스닥 지수도 확인해줘",
      receivedAt: 2,
    })

    const result = await buildStartPlan({
      message: "현재 나스닥 지수도 확인해줘",
      sessionId: "telegram:chat-1",
      runId: "run-new-message",
      source: "telegram",
      inboundMessage,
      incomingIntentContract: buildIncomingIntentContract({
        sessionId: "telegram:chat-1",
        source: "telegram",
        targetId: "finance:nasdaq",
      }),
    }, dependencies)

    expect(dependencies.listActiveSessionRequestGroups).not.toHaveBeenCalled()
    expect(dependencies.compareRequestContinuation).not.toHaveBeenCalled()
    expect(result.requestGroupId).toBe("run-new-message")
    expect(result.isRootRequest).toBe(true)
    expect(result.requestIsolation).toBe("root")
    expect(result.continuationSource).toBe("new_root")
    expect(result.effectiveContextMode).toBe("isolated")
  })

  it("keeps two root messages in separate task identities even in the same channel session", () => {
    const tasks = buildTaskModels([
      makeRun({
        id: "run-kospi",
        requestGroupId: "group-kospi",
        lineageRootRunId: "group-kospi",
        prompt: "현재 코스피 확인해줘",
        summary: "코스피 확인 완료",
        createdAt: 1,
        updatedAt: 2,
        promptSourceSnapshot: promptSnapshot("telegram:chat-1:main:101"),
      }),
      makeRun({
        id: "run-nasdaq",
        requestGroupId: "group-nasdaq",
        lineageRootRunId: "group-nasdaq",
        prompt: "현재 나스닥 확인해줘",
        summary: "나스닥 확인 완료",
        createdAt: 3,
        updatedAt: 4,
        promptSourceSnapshot: promptSnapshot("telegram:chat-1:main:102"),
      }),
    ])

    expect(tasks).toHaveLength(2)
    expect(tasks.map((task) => task.requestGroupId).sort()).toEqual(["group-kospi", "group-nasdaq"])
    expect(tasks.map((task) => task.userMessageKey).sort()).toEqual([
      "telegram:chat-1:main:101",
      "telegram:chat-1:main:102",
    ])
    expect(tasks.find((task) => task.requestGroupId === "group-kospi")?.runIds).toEqual(["run-kospi"])
  })

  it("keeps same-root verification as augmentation verification instead of a new request", () => {
    const tasks = buildTaskModels([
      makeRun({
        id: "run-root",
        requestGroupId: "group-root",
        lineageRootRunId: "group-root",
        prompt: "보고서 파일을 만들어줘",
        summary: "파일 생성 완료",
        createdAt: 1,
        updatedAt: 2,
        promptSourceSnapshot: promptSnapshot("telegram:chat-1:main:201"),
      }),
      makeRun({
        id: "run-verification",
        requestGroupId: "group-root:verification",
        lineageRootRunId: "group-root",
        runScope: "analysis",
        parentRunId: "run-root",
        prompt: "[Filesystem Verification]\nTask: 보고서 파일을 만들어줘",
        summary: "파일 존재 확인 완료",
        createdAt: 3,
        updatedAt: 4,
      }),
    ])

    expect(tasks).toHaveLength(1)
    expect(tasks[0]?.runIds).toEqual(["run-root", "run-verification"])
    expect(tasks[0]?.attempts[0]?.executionKind).toBe("new_request")
    expect(tasks[0]?.attempts[1]?.executionKind).toBe("augmentation_verification")
    expect(tasks[0]?.attempts[1]?.augmentationOfRunId).toBe("run-root")
    expect(tasks[0]?.attempts[1]?.userMessageKey).toBe("telegram:chat-1:main:201")
  })
})
