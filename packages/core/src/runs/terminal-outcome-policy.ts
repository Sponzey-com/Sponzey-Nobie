import type { CompletionStageState } from "./completion-state.js"

export function decideCompletionTerminalOutcome(params: {
  state: CompletionStageState
}): {
  kind: "complete"
} | {
  kind: "stop"
  summary: string
  reason: string
  remainingItems: string[]
} {
  if (params.state.completionSatisfied) {
    return { kind: "complete" }
  }

  return {
    kind: "stop",
    summary: "완료 판정 근거가 부족해 자동 진행을 중단합니다.",
    reason: params.state.blockingReasons[0]
      ?? "receipt 기준 완료 근거가 부족합니다.",
    remainingItems: ["실행/전달/복구 상태를 다시 확인해야 합니다."],
  }
}

export function decideFatalFailureTerminalOutcome(params: {
  aborted: boolean
}): "failed" | "cancelled" {
  return params.aborted ? "cancelled" : "failed"
}

export function decideTerminalApplicationOutcome(params: {
  applicationKind: "awaiting_user" | "stop"
}): "awaiting_user" | "cancelled" {
  return params.applicationKind === "awaiting_user" ? "awaiting_user" : "cancelled"
}
