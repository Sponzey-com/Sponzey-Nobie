import { describe, expect, it } from "vitest"
import { decideCompletionApplication } from "../packages/core/src/runs/completion-application.ts"

describe("run completion application", () => {
  it("returns stop when empty-result recovery budget is exhausted", () => {
    const decision = decideCompletionApplication({
      decision: {
        kind: "recover_empty_result",
        summary: "실행 결과가 비어 있어 다시 시도합니다.",
        reason: "완료 근거가 없습니다.",
        remainingItems: ["다른 방법으로 재시도"],
      },
      originalRequest: "파일을 만들어줘",
      previousResult: "",
      successfulTools: [],
      sawRealFilesystemMutation: false,
      usedTurns: 3,
      maxTurns: 3,
      interpretationBudgetLimit: 3,
      executionBudgetLimit: 3,
      canRetryInterpretation: true,
      canRetryExecution: false,
      followupAlreadySeen: false,
    })

    expect(decision.kind).toBe("stop")
    if (decision.kind === "stop") {
      expect(decision.summary).toContain("자동 진행을 멈췄습니다")
    }
  })

  it("returns interpretation retry for fresh followup prompts", () => {
    const decision = decideCompletionApplication({
      decision: {
        kind: "followup",
        summary: "추가 작업이 필요합니다.",
        reason: "남은 항목이 있습니다.",
        remainingItems: ["남은 파일 생성"],
        followupPrompt: "남은 파일만 생성하세요.",
      },
      originalRequest: "남은 파일을 만들어줘",
      previousResult: "부분 완료",
      successfulTools: [],
      sawRealFilesystemMutation: false,
      usedTurns: 0,
      maxTurns: 5,
      interpretationBudgetLimit: 5,
      executionBudgetLimit: 5,
      canRetryInterpretation: true,
      canRetryExecution: true,
      followupAlreadySeen: false,
    })

    expect(decision.kind).toBe("retry")
    if (decision.kind === "retry") {
      expect(decision.budgetKind).toBe("interpretation")
      expect(decision.normalizedFollowupPrompt).toBe("남은 파일만 생성하세요.".toLowerCase())
    }
  })

  it("stops duplicated followup prompts", () => {
    const decision = decideCompletionApplication({
      decision: {
        kind: "followup",
        summary: "추가 작업이 필요합니다.",
        reason: "남은 항목이 있습니다.",
        remainingItems: ["남은 파일 생성"],
        followupPrompt: "남은 파일만 생성하세요.",
      },
      originalRequest: "남은 파일을 만들어줘",
      previousResult: "부분 완료",
      successfulTools: [],
      sawRealFilesystemMutation: false,
      usedTurns: 1,
      maxTurns: 5,
      interpretationBudgetLimit: 5,
      executionBudgetLimit: 5,
      canRetryInterpretation: true,
      canRetryExecution: true,
      followupAlreadySeen: true,
    })

    expect(decision.kind).toBe("stop")
    if (decision.kind === "stop") {
      expect(decision.summary).toContain("반복")
    }
  })

  it("returns execution retry for truncated completion decisions", () => {
    const decision = decideCompletionApplication({
      decision: {
        kind: "retry_truncated",
        summary: "중간에 끊긴 작업을 자동으로 다시 시도합니다.",
        reason: "출력이 중간에 끊겼습니다.",
        remainingItems: ["남은 항목 처리"],
      },
      originalRequest: "코드를 끝까지 완성해줘",
      previousResult: "부분 코드",
      successfulTools: [],
      sawRealFilesystemMutation: true,
      usedTurns: 1,
      maxTurns: 5,
      interpretationBudgetLimit: 5,
      executionBudgetLimit: 5,
      canRetryInterpretation: true,
      canRetryExecution: true,
      followupAlreadySeen: false,
    })

    expect(decision.kind).toBe("retry")
    if (decision.kind === "retry") {
      expect(decision.budgetKind).toBe("execution")
      expect(decision.markTruncatedOutputRecoveryAttempted).toBe(true)
      expect(decision.clearWorkerRuntime).toBe(true)
    }
  })
})
