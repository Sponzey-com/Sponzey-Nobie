import { describe, expect, it, vi } from "vitest"
import { buildIncomingIntentContract } from "../packages/core/src/runs/active-run-projection.ts"
import { buildStartPlan } from "../packages/core/src/runs/start-plan.ts"
import { detectExplicitToolIntent, shouldInspectActiveRunCandidates } from "../packages/core/src/runs/request-isolation.ts"

function createDependencies(overrides?: Partial<Parameters<typeof buildStartPlan>[1]>) {
  const reconnectRun = {
    id: "run-retrieval",
    requestGroupId: "group-retrieval",
    lineageRootRunId: "group-retrieval",
    title: "나스닥 지수 조회",
    prompt: "오늘 나스닥 지수 얼마야?",
    summary: "검색 중",
    updatedAt: 100,
    status: "running",
    source: "webui",
    sessionId: "session-1",
  } as any
  return {
    analyzeRequestEntrySemantics: vi.fn(() => ({ reuse_conversation_context: false, active_queue_cancellation_mode: null })),
    isReusableRequestGroup: vi.fn(() => false),
    listActiveSessionRequestGroups: vi.fn(() => [reconnectRun]),
    compareRequestContinuation: vi.fn(async () => ({
      kind: "clarify",
      decisionSource: "contract_ai",
      reason: "should not inspect tool intents",
    } as const)),
    getRequestGroupDelegationTurnCount: vi.fn(() => 1),
    buildWorkerSessionId: vi.fn(() => undefined),
    normalizeTaskProfile: vi.fn((taskProfile) => taskProfile ?? "general_chat"),
    findLatestWorkerSessionRun: vi.fn(() => undefined),
    ...overrides,
  }
}

describe("task006 tool intent bypass", () => {
  it("classifies explicit tool/current-value intents from structured contracts only", () => {
    expect(detectExplicitToolIntent("메인 화면 캡쳐해서 보여줘")).toBeNull()
    expect(detectExplicitToolIntent("메인 화면 캡쳐해서 보여줘", buildIncomingIntentContract({
      sessionId: "session-1",
      source: "webui",
      targetId: "display:main",
      actionType: "run_tool",
    }))).toBe("screen_capture")
    expect(detectExplicitToolIntent("열려있는 창 목록 보여줘", buildIncomingIntentContract({
      sessionId: "session-1",
      source: "webui",
      targetId: "window:list",
      actionType: "run_tool",
    }))).toBe("window_list")
    expect(detectExplicitToolIntent("지금 동천동 날씨 어때?", buildIncomingIntentContract({
      sessionId: "session-1",
      source: "webui",
      targetId: "weather:current",
      actionType: "run_tool",
    }))).toBe("weather_current")
    expect(detectExplicitToolIntent("지금 나스닥 지수는 얼마야?", buildIncomingIntentContract({
      sessionId: "session-1",
      source: "webui",
      targetId: "finance:nasdaq",
      actionType: "run_tool",
    }))).toBe("finance_index_current")
    expect(detectExplicitToolIntent("日経平均を確認して", buildIncomingIntentContract({
      sessionId: "session-1",
      source: "webui",
      targetId: "finance:nikkei",
      actionType: "run_tool",
    }))).toBe("finance_index_current")
  })

  it("bypasses active-run inspection for screen capture after retrieval", async () => {
    const dependencies = createDependencies()
    const result = await buildStartPlan({
      message: "메인 화면 캡쳐해서 보여줘",
      sessionId: "session-1",
      runId: "run-capture",
      source: "webui",
      incomingIntentContract: buildIncomingIntentContract({
        sessionId: "session-1",
        source: "webui",
        targetId: "display:main",
        actionType: "run_tool",
      }),
    }, dependencies)

    expect(dependencies.listActiveSessionRequestGroups).not.toHaveBeenCalled()
    expect(dependencies.compareRequestContinuation).not.toHaveBeenCalled()
    expect(result.reconnectNeedsClarification).toBe(false)
    expect(result.requestGroupId).toBe("run-capture")
    expect(result.isRootRequest).toBe(true)
  })

  it("bypasses active-run inspection for finance current-value requests", async () => {
    const dependencies = createDependencies()
    const result = await buildStartPlan({
      message: "지금 코스닥 지수 알려줘",
      sessionId: "session-1",
      runId: "run-kosdaq",
      source: "telegram",
      incomingIntentContract: buildIncomingIntentContract({
        sessionId: "session-1",
        source: "telegram",
        targetId: "finance:kosdaq",
        actionType: "run_tool",
      }),
    }, dependencies)

    expect(dependencies.listActiveSessionRequestGroups).not.toHaveBeenCalled()
    expect(dependencies.compareRequestContinuation).not.toHaveBeenCalled()
    expect(result.requestGroupId).toBe("run-kosdaq")
    expect(result.isRootRequest).toBe(true)
  })

  it("requires explicit ids or references before inspecting active candidates", () => {
    expect(shouldInspectActiveRunCandidates({
      message: "지금 나스닥 지수 얼마야",
      hasStructuredIncomingContract: true,
      hasExplicitCandidateId: false,
      hasRequestGroupId: false,
    })).toBe(false)
    expect(shouldInspectActiveRunCandidates({
      message: "방금 그 파일 다시 보내줘",
      hasStructuredIncomingContract: true,
      hasExplicitCandidateId: false,
      hasRequestGroupId: false,
    })).toBe(false)
    expect(shouldInspectActiveRunCandidates({
      message: "방금 그 파일 다시 보내줘",
      hasStructuredIncomingContract: true,
      hasExplicitCandidateId: false,
      hasRequestGroupId: false,
      incomingIntentContract: buildIncomingIntentContract({
        sessionId: "session-1",
        source: "telegram",
        targetId: "artifact:last",
      }),
    })).toBe(true)
    expect(shouldInspectActiveRunCandidates({
      message: "이 실행에 이어서 처리",
      hasStructuredIncomingContract: false,
      hasExplicitCandidateId: true,
      hasRequestGroupId: false,
    })).toBe(true)
  })
})
