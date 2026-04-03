import { describe, expect, it } from "vitest"
import { decideReviewGate } from "../packages/core/src/runs/review-gate.ts"

const baseExecutionSemantics = {
  filesystemEffect: "none",
  artifactDelivery: "direct",
  approvalRequired: false,
  approvalTool: "none",
  privilegedOperation: "none",
} as const

describe("review gate", () => {
  it("skips completion review when direct delivery is already satisfied", () => {
    const decision = decideReviewGate({
      executionSemantics: baseExecutionSemantics,
      preview: "스크린샷을 전송했습니다.",
      deliveryOutcome: {
        directArtifactDeliveryRequested: true,
        hasSuccessfulArtifactDelivery: true,
        deliverySatisfied: true,
        requiresDirectArtifactRecovery: false,
      },
      successfulTools: [{ toolName: "screencapture", output: "saved capture" }],
      sawRealFilesystemMutation: false,
      requiresFilesystemMutation: false,
      truncatedOutputRecoveryAttempted: false,
    })

    expect(decision.kind).toBe("skip")
    expect(decision.state.completionSatisfied).toBe(true)
  })

  it("keeps completion review when direct delivery is not yet satisfied", () => {
    const decision = decideReviewGate({
      executionSemantics: baseExecutionSemantics,
      preview: "스크린샷을 만들었습니다.",
      deliveryOutcome: {
        directArtifactDeliveryRequested: true,
        hasSuccessfulArtifactDelivery: false,
        deliverySatisfied: false,
        requiresDirectArtifactRecovery: true,
      },
      successfulTools: [{ toolName: "screencapture", output: "saved capture" }],
      sawRealFilesystemMutation: false,
      requiresFilesystemMutation: false,
      truncatedOutputRecoveryAttempted: false,
    })

    expect(decision.kind).toBe("run")
    expect(decision.state.deliveryStatus).toBe("missing")
  })

  it("skips completion review for read-only successful executions when checklist is already settled", () => {
    const decision = decideReviewGate({
      executionSemantics: {
        ...baseExecutionSemantics,
        artifactDelivery: "none",
      },
      preview: "모니터는 2개이고 메인 디스플레이 해상도는 2560x1440입니다.",
      deliveryOutcome: {
        directArtifactDeliveryRequested: false,
        hasSuccessfulArtifactDelivery: false,
        deliverySatisfied: false,
        requiresDirectArtifactRecovery: false,
      },
      successfulTools: [{ toolName: "shell_exec", output: "Displays: 2\n2560x1440" }],
      sawRealFilesystemMutation: false,
      requiresFilesystemMutation: false,
      truncatedOutputRecoveryAttempted: false,
    })

    expect(decision.kind).toBe("skip")
    expect(decision.state.completionSatisfied).toBe(true)
  })
})
