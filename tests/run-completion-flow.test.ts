import { describe, expect, it } from "vitest"
import { decideCompletionFlow } from "../packages/core/src/runs/completion-flow.ts"

const baseExecutionSemantics = {
  filesystemEffect: "none",
  privilegedOperation: "none",
  artifactDelivery: "none",
  approvalRequired: false,
  approvalTool: "none",
} as const

describe("run completion flow", () => {
  it("requests empty-result recovery when there is no review and no completion evidence", () => {
    const decision = decideCompletionFlow({
      review: null,
      executionSemantics: {
        ...baseExecutionSemantics,
        filesystemEffect: "mutate",
      },
      preview: "",
      deliverySatisfied: false,
      successfulTools: [],
      sawRealFilesystemMutation: false,
      requiresFilesystemMutation: true,
      truncatedOutputRecoveryAttempted: false,
    })

    expect(decision.kind).toBe("recover_empty_result")
  })

  it("completes when review is complete", () => {
    const decision = decideCompletionFlow({
      review: {
        status: "complete",
        summary: "완료되었습니다.",
        reason: "모든 작업이 끝났습니다.",
        remainingItems: [],
      },
      executionSemantics: baseExecutionSemantics,
      preview: "안녕",
      deliverySatisfied: false,
      successfulTools: [],
      sawRealFilesystemMutation: false,
      requiresFilesystemMutation: false,
      truncatedOutputRecoveryAttempted: false,
    })

    expect(decision.kind).toBe("complete")
    if (decision.kind === "complete") {
      expect(decision.summary).toBe("완료되었습니다.")
      expect(decision.persistedText).toBe("안녕")
    }
  })

  it("does not complete when a complete review conflicts with unsatisfied direct delivery", () => {
    const decision = decideCompletionFlow({
      review: {
        status: "complete",
        summary: "스크린샷 전달까지 끝났습니다.",
        reason: "모든 작업이 끝났습니다.",
        remainingItems: [],
      },
      executionSemantics: {
        ...baseExecutionSemantics,
        artifactDelivery: "direct",
      },
      preview: "스크린샷을 만들었습니다.",
      deliverySatisfied: false,
      successfulTools: [{ toolName: "screencapture", output: "saved capture" }],
      sawRealFilesystemMutation: false,
      requiresFilesystemMutation: false,
      truncatedOutputRecoveryAttempted: false,
    })

    expect(decision.kind).toBe("recover_empty_result")
    if (decision.kind === "recover_empty_result") {
      expect(decision.reason).toContain("receipt 기준")
      expect(decision.reason).toContain("직접 결과 전달")
    }
  })

  it("completes when execution and direct delivery are both satisfied", () => {
    const decision = decideCompletionFlow({
      review: null,
      executionSemantics: {
        ...baseExecutionSemantics,
        artifactDelivery: "direct",
      },
      preview: "스크린샷을 보냈습니다.",
      deliverySatisfied: true,
      successfulTools: [{ toolName: "screencapture", output: "saved capture" }],
      sawRealFilesystemMutation: false,
      requiresFilesystemMutation: false,
      truncatedOutputRecoveryAttempted: false,
    })

    expect(decision.kind).toBe("complete")
  })

  it("returns followup or invalid_followup based on prompt presence", () => {
    const valid = decideCompletionFlow({
      review: {
        status: "followup",
        summary: "추가 작업",
        reason: "남은 작업이 있습니다.",
        followupPrompt: "남은 파일만 생성하세요.",
        remainingItems: ["남은 파일 생성"],
      },
      executionSemantics: baseExecutionSemantics,
      preview: "중간 결과",
      deliverySatisfied: false,
      successfulTools: [],
      sawRealFilesystemMutation: false,
      requiresFilesystemMutation: false,
      truncatedOutputRecoveryAttempted: false,
    })

    expect(valid.kind).toBe("followup")

    const invalid = decideCompletionFlow({
      review: {
        status: "followup",
        summary: "추가 작업",
        reason: "남은 작업이 있습니다.",
        remainingItems: ["남은 파일 생성"],
      },
      executionSemantics: baseExecutionSemantics,
      preview: "중간 결과",
      deliverySatisfied: false,
      successfulTools: [],
      sawRealFilesystemMutation: false,
      requiresFilesystemMutation: false,
      truncatedOutputRecoveryAttempted: false,
    })

    expect(invalid.kind).toBe("invalid_followup")
  })

  it("classifies truncated ask_user reviews as retry_truncated when filesystem work is required", () => {
    const decision = decideCompletionFlow({
      review: {
        status: "ask_user",
        summary: "중간에 끊겨서 미완성입니다.",
        reason: "코드가 incomplete 상태입니다.",
        userMessage: "계속할까요?",
        remainingItems: ["나머지 파일 작성"],
      },
      executionSemantics: {
        ...baseExecutionSemantics,
        filesystemEffect: "mutate",
      },
      preview: "부분 코드",
      deliverySatisfied: false,
      successfulTools: [],
      sawRealFilesystemMutation: false,
      requiresFilesystemMutation: true,
      truncatedOutputRecoveryAttempted: false,
    })

    expect(decision.kind).toBe("retry_truncated")
  })

  it("falls back to ask_user for non-truncated review requests", () => {
    const decision = decideCompletionFlow({
      review: {
        status: "ask_user",
        summary: "추가 정보가 필요합니다.",
        reason: "대상 파일 경로가 없습니다.",
        userMessage: "어느 파일을 수정해야 하나요?",
        remainingItems: ["대상 파일 확인"],
      },
      executionSemantics: baseExecutionSemantics,
      preview: "중간 결과",
      deliverySatisfied: false,
      successfulTools: [],
      sawRealFilesystemMutation: false,
      requiresFilesystemMutation: false,
      truncatedOutputRecoveryAttempted: false,
    })

    expect(decision.kind).toBe("ask_user")
    if (decision.kind === "ask_user") {
      expect(decision.userMessage).toBe("어느 파일을 수정해야 하나요?")
    }
  })
})
