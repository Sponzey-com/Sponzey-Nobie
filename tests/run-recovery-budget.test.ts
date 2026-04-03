import { describe, expect, it } from "vitest"
import {
  canConsumeRecoveryBudget,
  consumeRecoveryBudget,
  createRecoveryBudgetUsage,
  formatRecoveryBudgetProgress,
  getRecoveryBudgetState,
} from "../packages/core/src/runs/recovery-budget.ts"

describe("run recovery budget helpers", () => {
  it("tracks different recovery limits by failure kind", () => {
    const usage = createRecoveryBudgetUsage()

    expect(getRecoveryBudgetState({
      usage,
      kind: "interpretation",
      maxDelegationTurns: 5,
    }).limit).toBe(5)

    expect(getRecoveryBudgetState({
      usage,
      kind: "delivery",
      maxDelegationTurns: 5,
    }).limit).toBe(5)

    expect(getRecoveryBudgetState({
      usage,
      kind: "external",
      maxDelegationTurns: 5,
    }).limit).toBe(5)
  })

  it("consumes budget independently per recovery kind", () => {
    const usage = createRecoveryBudgetUsage()

    consumeRecoveryBudget({
      usage,
      kind: "delivery",
      maxDelegationTurns: 5,
    })
    consumeRecoveryBudget({
      usage,
      kind: "delivery",
      maxDelegationTurns: 5,
    })
    const state = consumeRecoveryBudget({
      usage,
      kind: "delivery",
      maxDelegationTurns: 5,
    })

    expect(formatRecoveryBudgetProgress(state)).toBe("3/5")
    expect(canConsumeRecoveryBudget({
      usage,
      kind: "delivery",
      maxDelegationTurns: 5,
    })).toBe(true)
    expect(canConsumeRecoveryBudget({
      usage,
      kind: "execution",
      maxDelegationTurns: 5,
    })).toBe(true)
  })
})
