import { describe, expect, it } from "vitest"
import {
  canConsumeRecoveryBudget,
  consumeRecoveryBudget,
  createRecoveryBudgetUsage,
  formatRecoveryBudgetProgress,
  getRecoveryBudgetState,
} from "../packages/core/src/runs/recovery-budget.ts"
import {
  normalizeFailureReason,
} from "../packages/core/src/runs/execution-policy.ts"
import {
  recordQueueRecoveryAttempt,
  resetQueueBackpressureState,
} from "../packages/core/src/runs/queue-backpressure.ts"

describe("run recovery budget helpers", () => {
  it("keeps recovery kinds unbounded by fixed retry count", () => {
    const usage = createRecoveryBudgetUsage()

    expect(getRecoveryBudgetState({
      usage,
      kind: "interpretation",
      maxDelegationTurns: 5,
    }).limit).toBe(0)

    expect(getRecoveryBudgetState({
      usage,
      kind: "delivery",
      maxDelegationTurns: 5,
    }).limit).toBe(0)

    expect(getRecoveryBudgetState({
      usage,
      kind: "external",
      maxDelegationTurns: 5,
    }).limit).toBe(0)
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

    expect(formatRecoveryBudgetProgress(state)).toBe("신호 3")
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

  it("treats legacy count reports as recovery signals unless the user set the limit", () => {
    expect(normalizeFailureReason({ reason: "max_attempts_reached" })).toEqual({
      kind: "recovery_signal",
      reason: "count_signal_observed",
      originalReason: "max_attempts_reached",
    })
    expect(normalizeFailureReason({
      reason: "max_attempts_reached",
      explicitUserLimit: true,
    })).toEqual({
      kind: "terminal",
      reason: "explicit_user_limit_reached",
    })
  })

  it("keeps boundary timeouts as recovery signals rather than task failure", () => {
    expect(normalizeFailureReason({ reason: "model_timeout" })).toEqual({
      kind: "recovery_signal",
      reason: "model_timeout",
      originalReason: "model_timeout",
    })
    expect(normalizeFailureReason({ reason: "queue_timeout" })).toEqual({
      kind: "recovery_signal",
      reason: "boundary_timeout",
      originalReason: "queue_timeout",
    })
  })

  it("records queue recovery attempts as unbounded signals", () => {
    resetQueueBackpressureState()

    const first = recordQueueRecoveryAttempt({
      queueName: "tool_execution",
      recoveryKey: "tool:lookup",
      reason: "queue_timeout",
    })
    const second = recordQueueRecoveryAttempt({
      queueName: "tool_execution",
      recoveryKey: "tool:lookup",
      reason: "queue_timeout",
    })

    expect(first).toMatchObject({ allowed: true, signalCount: 1 })
    expect(second).toMatchObject({ allowed: true, signalCount: 2 })
  })
})
