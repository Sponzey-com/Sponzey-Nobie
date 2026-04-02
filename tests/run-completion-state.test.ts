import { describe, expect, it } from "vitest"
import {
  deriveCompletionEvidenceState,
  deriveCompletionStageState,
} from "../packages/core/src/runs/completion-state.ts"

const baseExecutionSemantics = {
  filesystemEffect: "none",
  privilegedOperation: "none",
  artifactDelivery: "none",
  approvalRequired: false,
  approvalTool: "none",
} as const

describe("completion state", () => {
  it("treats text-only replies as completed execution when no direct delivery is required", () => {
    const result = deriveCompletionEvidenceState({
      executionSemantics: baseExecutionSemantics,
      preview: "인사를 보냈습니다.",
      deliverySatisfied: false,
      successfulTools: [],
      sawRealFilesystemMutation: false,
    })

    expect(result).toEqual({
      executionSatisfied: true,
      deliveryRequired: false,
      deliverySatisfied: true,
      completionSatisfied: true,
    })
  })

  it("requires direct artifact delivery even when execution evidence exists", () => {
    const result = deriveCompletionEvidenceState({
      executionSemantics: {
        ...baseExecutionSemantics,
        artifactDelivery: "direct",
      },
      preview: "스크린샷을 만들었습니다.",
      deliverySatisfied: false,
      successfulTools: [{ toolName: "screencapture", output: "saved capture" }],
      sawRealFilesystemMutation: false,
    })

    expect(result).toEqual({
      executionSatisfied: true,
      deliveryRequired: true,
      deliverySatisfied: false,
      completionSatisfied: false,
      conflictReason: "요청된 직접 결과 전달이 아직 완료되지 않았습니다.",
    })
  })

  it("marks completion satisfied when direct delivery succeeds", () => {
    const result = deriveCompletionEvidenceState({
      executionSemantics: {
        ...baseExecutionSemantics,
        artifactDelivery: "direct",
      },
      preview: "스크린샷을 보냈습니다.",
      deliverySatisfied: true,
      successfulTools: [{ toolName: "screencapture", output: "saved capture" }],
      sawRealFilesystemMutation: false,
    })

    expect(result).toEqual({
      executionSatisfied: true,
      deliveryRequired: true,
      deliverySatisfied: true,
      completionSatisfied: true,
    })
  })

  it("splits completion into interpretation/execution/delivery/recovery axes", () => {
    const result = deriveCompletionStageState({
      review: {
        status: "followup",
        summary: "추가 작업 필요",
        reason: "남은 파일이 있습니다.",
        remainingItems: ["남은 파일 생성"],
        followupPrompt: "남은 파일만 생성하세요.",
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

    expect(result).toEqual({
      executionSatisfied: true,
      deliveryRequired: true,
      deliverySatisfied: false,
      completionSatisfied: false,
      conflictReason: "completion review가 추가 follow-up 작업을 요구합니다.",
      interpretationStatus: "followup_required",
      executionStatus: "satisfied",
      deliveryStatus: "missing",
      recoveryStatus: "required",
      blockingReasons: [
        "completion review가 추가 follow-up 작업을 요구합니다.",
        "요청된 직접 결과 전달이 아직 완료되지 않았습니다.",
      ],
    })
  })
})
