import { describe, expect, it } from "vitest"
import {
  decideCompletionTerminalOutcome,
  decideFatalFailureTerminalOutcome,
  decideTerminalApplicationOutcome,
} from "../packages/core/src/runs/terminal-outcome-policy.ts"

describe("terminal outcome policy", () => {
  it("allows completion only when completion state is satisfied", () => {
    expect(decideCompletionTerminalOutcome({
      state: {
        executionSatisfied: true,
        deliveryRequired: false,
        deliverySatisfied: true,
        completionSatisfied: true,
        interpretationStatus: "satisfied",
        executionStatus: "satisfied",
        deliveryStatus: "not_required",
        recoveryStatus: "settled",
        blockingReasons: [],
      },
    })).toEqual({ kind: "complete" })

    expect(decideCompletionTerminalOutcome({
      state: {
        executionSatisfied: true,
        deliveryRequired: true,
        deliverySatisfied: false,
        completionSatisfied: false,
        interpretationStatus: "satisfied",
        executionStatus: "satisfied",
        deliveryStatus: "missing",
        recoveryStatus: "required",
        blockingReasons: ["요청된 직접 결과 전달이 아직 완료되지 않았습니다."],
        conflictReason: "요청된 직접 결과 전달이 아직 완료되지 않았습니다.",
      },
    })).toEqual({
      kind: "stop",
      summary: "완료 판정 근거가 부족해 자동 진행을 중단합니다.",
      reason: "요청된 직접 결과 전달이 아직 완료되지 않았습니다.",
      remainingItems: ["실행/전달/복구 상태를 다시 확인해야 합니다."],
    })
  })

  it("classifies aborted fatal failures as cancelled", () => {
    expect(decideFatalFailureTerminalOutcome({ aborted: true })).toBe("cancelled")
    expect(decideFatalFailureTerminalOutcome({ aborted: false })).toBe("failed")
  })

  it("maps terminal applications to awaiting_user or cancelled", () => {
    expect(decideTerminalApplicationOutcome({ applicationKind: "awaiting_user" })).toBe("awaiting_user")
    expect(decideTerminalApplicationOutcome({ applicationKind: "stop" })).toBe("cancelled")
  })
})
