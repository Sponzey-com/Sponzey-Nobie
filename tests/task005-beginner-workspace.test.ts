import { describe, expect, it } from "vitest"
import type { RootRun } from "../packages/webui/src/contracts/runs.ts"
import {
  BEGINNER_ACTION_BUTTON_CLASS,
  BEGINNER_CHAT_INPUT_CLASS,
  buildBeginnerApprovalCard,
  buildBeginnerResultCards,
  buildBeginnerRunCards,
  mapBeginnerRunStatus,
  sanitizeBeginnerWorkspaceText,
} from "../packages/webui/src/lib/beginner-workspace.js"
import type { ApprovalRequest, Message } from "../packages/webui/src/stores/chat.ts"

function run(overrides: Partial<RootRun>): RootRun {
  const now = 1_776_489_600_000
  return {
    id: "run-task005-secret-id",
    sessionId: "session-task005",
    requestGroupId: "request-group-task005",
    lineageRootRunId: "run-task005-secret-id",
    runScope: "root",
    title: "메인 화면 캡쳐",
    prompt: "메인 화면 캡쳐",
    source: "webui",
    status: "running",
    taskProfile: "general_chat",
    contextMode: "full",
    delegationTurnCount: 0,
    maxDelegationTurns: 0,
    currentStepKey: "step",
    currentStepIndex: 0,
    totalSteps: 1,
    summary: "진행 중입니다.",
    canCancel: true,
    createdAt: now,
    updatedAt: now,
    steps: [],
    recentEvents: [],
    ...overrides,
  }
}

describe("task005 beginner workspace", () => {
  it("maps detailed run states into the four beginner card states", () => {
    expect(mapBeginnerRunStatus("queued")).toBe("running")
    expect(mapBeginnerRunStatus("running")).toBe("running")
    expect(mapBeginnerRunStatus("completed")).toBe("completed")
    expect(mapBeginnerRunStatus("awaiting_approval")).toBe("needs_attention")
    expect(mapBeginnerRunStatus("awaiting_user")).toBe("needs_attention")
    expect(mapBeginnerRunStatus("failed")).toBe("failed")
    expect(mapBeginnerRunStatus("cancelled")).toBe("failed")
    expect(mapBeginnerRunStatus("interrupted")).toBe("failed")
  })

  it("builds at most three beginner run cards without raw ids, HTML, stack, or local paths", () => {
    const cards = buildBeginnerRunCards({
      sessionId: "session-task005",
      language: "ko",
      runs: [
        run({ id: "run-1", status: "failed", updatedAt: 4, summary: "AI error: 403 Forbidden runId=secret raw path /Users/example/private.txt" }),
        run({ id: "run-2", status: "awaiting_approval", updatedAt: 3, summary: "승인 대기" }),
        run({ id: "run-3", status: "completed", updatedAt: 2, summary: "<!doctype html><html><body>secret</body></html>완료" }),
        run({ id: "run-4", status: "running", updatedAt: 1, summary: "진행" }),
      ],
    })

    expect(cards).toHaveLength(3)
    expect(cards.map((card) => card.status)).toEqual(["failed", "needs_attention", "completed"])
    expect(cards[0]?.nextAction).toEqual({ label: "상태 확인", href: "/status" })
    expect(cards[1]?.nextAction).toEqual({ label: "확인하기", href: "#approval" })

    const serialized = JSON.stringify(cards)
    expect(serialized).not.toMatch(/requestGroupId|sessionId|runId=|raw path|stack trace|<!doctype|<html|\/Users/i)
  })

  it("renders approval actions as accessible beginner buttons without tool params", () => {
    const approval: ApprovalRequest = {
      runId: "run-secret",
      toolName: "screen_capture",
      params: { extensionId: "yeonjang-main", raw: "secret" },
      guidance: "현재 화면 전체를 캡처하려고 합니다.",
      kind: "approval",
    }

    const card = buildBeginnerApprovalCard(approval, "ko")
    expect(card.title).toBe("확인이 필요합니다")
    expect(card.summary).toContain("현재 화면 전체")
    expect(card.actions.map((action) => action.decision)).toEqual(["allow_run", "allow_once", "deny"])
    expect(card.actions.every((action) => action.ariaLabel.length > action.label.length)).toBe(true)

    const serialized = JSON.stringify(card)
    expect(serialized).not.toMatch(/screen_capture|yeonjang-main|extensionId|raw|run-secret/i)
  })

  it("extracts recent result files from assistant artifacts without exposing local paths", () => {
    const messages: Message[] = [
      { id: "m1", role: "user", content: "캡쳐" },
      {
        id: "m2",
        role: "assistant",
        content: "완료",
        artifacts: [
          {
            url: "/api/artifacts/1",
            downloadUrl: "/api/artifacts/1/download",
            previewUrl: "/api/artifacts/1/preview",
            fileName: "screen.png",
            filePath: "/Users/example/.nobie/artifacts/screen.png",
            mimeType: "image/png",
            caption: "메인 화면",
          },
        ],
      },
    ]

    const cards = buildBeginnerResultCards(messages, "ko")
    expect(cards).toEqual([
      expect.objectContaining({ title: "screen.png", caption: "메인 화면", previewable: true, mimeType: "image/png" }),
    ])
    expect(JSON.stringify(cards)).not.toContain("/Users/example")
  })

  it("keeps mobile-first input and approval button classes accessible", () => {
    expect(BEGINNER_CHAT_INPUT_CLASS).toContain("w-full")
    expect(BEGINNER_CHAT_INPUT_CLASS).toContain("min-h")
    expect(BEGINNER_ACTION_BUTTON_CLASS).toContain("min-h-11")
    expect(BEGINNER_ACTION_BUTTON_CLASS).toContain("w-full")
    expect(BEGINNER_ACTION_BUTTON_CLASS).toContain("sm:w-auto")
  })

  it("falls back to user-safe error wording for raw failure text", () => {
    expect(sanitizeBeginnerWorkspaceText("<!doctype html><html><title>403 Forbidden</title><body>token</body></html>", "ko")).toContain("AI 인증 또는 권한")
  })
})
