import { describe, expect, it } from "vitest"
import { runCompletionPass } from "../packages/core/src/runs/completion-pass.ts"
import { createRecoveryBudgetUsage } from "../packages/core/src/runs/recovery-budget.ts"

const baseExecutionSemantics = {
  filesystemEffect: "none",
  privilegedOperation: "none",
  artifactDelivery: "none",
  approvalRequired: false,
  approvalTool: "none",
} as const

describe("run completion pass", () => {
  it("returns complete application for successful reviews", () => {
    const result = runCompletionPass({
      review: {
        status: "complete",
        summary: "완료되었습니다.",
        reason: "모든 작업이 끝났습니다.",
        remainingItems: [],
      },
      executionSemantics: baseExecutionSemantics,
      preview: "안녕",
      deliveryOutcome: {
        directArtifactDeliveryRequested: false,
        hasSuccessfulArtifactDelivery: false,
        deliverySatisfied: false,
        requiresDirectArtifactRecovery: false,
      },
      successfulTools: [],
      sawRealFilesystemMutation: false,
      requiresFilesystemMutation: false,
      truncatedOutputRecoveryAttempted: false,
      originalRequest: "인사해줘",
      recoveryBudgetUsage: createRecoveryBudgetUsage(),
      delegationTurnCount: 0,
      maxDelegationTurns: 5,
      defaultMaxDelegationTurns: 5,
      followupAlreadySeen: false,
    })

    expect(result.state.interpretationStatus).toBe("satisfied")
    expect(result.state.executionStatus).toBe("satisfied")
    expect(result.state.deliveryStatus).toBe("not_required")
    expect(result.state.recoveryStatus).toBe("settled")
    expect(result.decision.kind).toBe("complete")
    expect(result.application.kind).toBe("complete")
  })

  it("returns stop application for duplicated followup prompts", () => {
    const result = runCompletionPass({
      review: {
        status: "followup",
        summary: "추가 작업이 필요합니다.",
        reason: "남은 항목이 있습니다.",
        followupPrompt: "남은 파일만 생성하세요.",
        remainingItems: ["남은 파일 생성"],
      },
      executionSemantics: baseExecutionSemantics,
      preview: "부분 완료",
      deliveryOutcome: {
        directArtifactDeliveryRequested: false,
        hasSuccessfulArtifactDelivery: false,
        deliverySatisfied: false,
        requiresDirectArtifactRecovery: false,
      },
      successfulTools: [],
      sawRealFilesystemMutation: false,
      requiresFilesystemMutation: false,
      truncatedOutputRecoveryAttempted: false,
      originalRequest: "남은 파일을 만들어줘",
      recoveryBudgetUsage: createRecoveryBudgetUsage(),
      delegationTurnCount: 1,
      maxDelegationTurns: 5,
      defaultMaxDelegationTurns: 5,
      followupAlreadySeen: true,
    })

    expect(result.decision.kind).toBe("followup")
    expect(result.application.kind).toBe("stop")
  })

  it("returns execution retry for truncated output reviews", () => {
    const result = runCompletionPass({
      review: {
        status: "ask_user",
        summary: "중간에 끊겨서 미완성입니다.",
        reason: "출력이 중간에 끊겼습니다.",
        userMessage: "계속할까요?",
        remainingItems: ["남은 항목 처리"],
      },
      executionSemantics: {
        ...baseExecutionSemantics,
        filesystemEffect: "mutate",
      },
      preview: "부분 코드",
      deliveryOutcome: {
        directArtifactDeliveryRequested: false,
        hasSuccessfulArtifactDelivery: false,
        deliverySatisfied: false,
        requiresDirectArtifactRecovery: false,
      },
      successfulTools: [],
      sawRealFilesystemMutation: true,
      requiresFilesystemMutation: true,
      truncatedOutputRecoveryAttempted: false,
      originalRequest: "코드를 끝까지 완성해줘",
      recoveryBudgetUsage: createRecoveryBudgetUsage(),
      delegationTurnCount: 1,
      maxDelegationTurns: 5,
      defaultMaxDelegationTurns: 5,
      followupAlreadySeen: false,
    })

    expect(result.decision.kind).toBe("retry_truncated")
    expect(result.application.kind).toBe("retry")
    if (result.application.kind === "retry") {
      expect(result.application.budgetKind).toBe("execution")
    }
  })
})
