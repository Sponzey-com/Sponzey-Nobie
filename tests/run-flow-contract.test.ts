import { describe, expect, it } from "vitest"
import {
  canTransitionRunStatus,
  deriveRunCompletionOutcome,
  resolveRunFlowIdentifiers,
} from "../packages/core/src/runs/flow-contract.ts"

describe("run flow contract", () => {
  it("resolves request group and lineage identifiers before execution", () => {
    expect(resolveRunFlowIdentifiers({
      runId: "run-1",
      sessionId: "session-1",
    })).toEqual({
      runId: "run-1",
      sessionId: "session-1",
      requestGroupId: "run-1",
      lineageRootRunId: "run-1",
      runScope: "root",
    })

    expect(resolveRunFlowIdentifiers({
      runId: "child-1",
      sessionId: "session-1",
      requestGroupId: "group-1",
      lineageRootRunId: "root-1",
      parentRunId: "root-1",
    })).toEqual({
      runId: "child-1",
      sessionId: "session-1",
      requestGroupId: "group-1",
      lineageRootRunId: "root-1",
      runScope: "child",
      parentRunId: "root-1",
    })
  })

  it("blocks terminal status reversal", () => {
    expect(canTransitionRunStatus("completed", "failed")).toEqual({
      allowed: false,
      reason: "terminal_status_locked:completed->failed",
    })
    expect(canTransitionRunStatus("running", "failed")).toEqual({ allowed: true })
    expect(canTransitionRunStatus("failed", "failed")).toEqual({ allowed: true })
  })

  it("derives user-facing completion outcome statuses", () => {
    expect(deriveRunCompletionOutcome({ impossible: true }).status).toBe("completed_impossible")
    expect(deriveRunCompletionOutcome({ approvalPending: true }).status).toBe("awaiting_approval")
    expect(deriveRunCompletionOutcome({
      completion: {
        executionSatisfied: true,
        deliveryRequired: true,
        deliverySatisfied: true,
        completionSatisfied: true,
        interpretationStatus: "satisfied",
        executionStatus: "satisfied",
        deliveryStatus: "satisfied",
        recoveryStatus: "settled",
        blockingReasons: [],
      },
    }).status).toBe("completed_delivered")
    expect(deriveRunCompletionOutcome({
      completion: {
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
    }).status).toBe("completed_in_chat")
  })
})
