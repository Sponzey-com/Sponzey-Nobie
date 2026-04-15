import { describe, expect, it } from "vitest"
import type { AIProvider, ChatParams } from "../packages/core/src/ai/types.ts"
import {
  CONTRACT_SCHEMA_VERSION,
  type IntentContract,
  type ToolTargetKind,
} from "../packages/core/src/contracts/index.ts"
import {
  buildActiveRunProjection,
  buildIncomingIntentContract,
} from "../packages/core/src/runs/active-run-projection.ts"
import {
  compareRequestContinuationWithAI,
  parseRequestContinuationDecision,
} from "../packages/core/src/runs/entry-comparison.ts"
import type { RootRun } from "../packages/core/src/runs/types.ts"

function intentContract(params: {
  targetId: string
  targetKind?: ToolTargetKind
  sessionId?: string
  actionType?: IntentContract["actionType"]
}): IntentContract {
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    intentType: params.actionType === "cancel_schedule" ? "cancel" : "question",
    actionType: params.actionType ?? "answer",
    target: {
      schemaVersion: CONTRACT_SCHEMA_VERSION,
      kind: params.targetKind ?? "display",
      id: params.targetId,
      selector: null,
    },
    delivery: {
      schemaVersion: CONTRACT_SCHEMA_VERSION,
      mode: "reply",
      channel: "webui",
      sessionId: params.sessionId ?? "session-1",
    },
    constraints: [],
    requiresApproval: false,
  }
}

function rootRun(overrides: Partial<RootRun> = {}): RootRun {
  return {
    id: "run-1",
    sessionId: "session-1",
    requestGroupId: "group-1",
    lineageRootRunId: "group-1",
    runScope: "root",
    title: "표시명",
    prompt: "SECRET RAW PROMPT",
    source: "webui",
    status: "running",
    taskProfile: "general_chat",
    contextMode: "full",
    delegationTurnCount: 0,
    maxDelegationTurns: 5,
    currentStepKey: "executing",
    currentStepIndex: 4,
    totalSteps: 9,
    summary: "SECRET SUMMARY",
    canCancel: true,
    createdAt: 1,
    updatedAt: 2,
    steps: [],
    recentEvents: [],
    ...overrides,
  }
}

function providerReturning(text: string, capture?: (params: ChatParams) => void): AIProvider {
  return {
    id: "fake-contract-comparator",
    supportedModels: ["fake-model"],
    maxContextTokens: () => 8192,
    async *chat(params: ChatParams) {
      capture?.(params)
      yield { type: "text_delta", delta: text }
    },
  }
}

describe("task006 active run contract continuation", () => {
  it("builds active run projections without raw prompt identity fields", () => {
    const projection = buildActiveRunProjection(rootRun({
      promptSourceSnapshot: {
        intentContract: intentContract({ targetId: "display:2" }),
        approvalId: "approval-1",
      },
    }))

    expect(projection.runId).toBe("run-1")
    expect(projection.requestGroupId).toBe("group-1")
    expect(projection.approvalId).toBe("approval-1")
    expect(projection.legacy).toBe(false)
    expect(projection.displayName).toBe("표시명")
    expect(JSON.stringify(projection.comparisonProjection)).not.toContain("SECRET RAW PROMPT")
    expect(JSON.stringify(projection.comparisonProjection)).not.toContain("SECRET SUMMARY")
    expect(JSON.stringify(projection.comparisonProjection)).not.toContain("표시명")
  })

  it("marks runs without persisted contracts as legacy active items", () => {
    const projection = buildActiveRunProjection(rootRun({ targetId: "provider:openai" }))

    expect(projection.legacy).toBe(true)
    expect(projection.legacyReason).toBe("missing_persisted_contract")
    expect(projection.intentContract.target.id).toBe("provider:openai")
  })

  it("matches multilingual follow-up by equal target contract without calling AI", async () => {
    const contract = intentContract({ targetId: "display:external" })
    const candidate = buildActiveRunProjection(rootRun({
      promptSourceSnapshot: { intentContract: contract },
    }))
    let called = false

    const result = await compareRequestContinuationWithAI({
      incomingContract: contract,
      candidates: [candidate],
      model: "fake-model",
      providerId: "fake-provider",
      provider: providerReturning("{}", () => { called = true }),
    })

    expect(result.kind).toBe("same_run")
    expect(result.requestGroupId).toBe("group-1")
    expect(result.decisionSource).toBe("contract_exact")
    expect(called).toBe(false)
  })

  it("does not arbitrarily choose when multiple active runs share the same contract", async () => {
    const contract = intentContract({ targetId: "display:shared" })
    const candidates = [
      buildActiveRunProjection(rootRun({
        id: "run-shared-a",
        requestGroupId: "group-shared-a",
        promptSourceSnapshot: { intentContract: contract },
      })),
      buildActiveRunProjection(rootRun({
        id: "run-shared-b",
        requestGroupId: "group-shared-b",
        promptSourceSnapshot: { intentContract: contract },
      })),
    ]

    const result = await compareRequestContinuationWithAI({
      incomingContract: contract,
      candidates,
      model: "fake-model",
      providerId: "fake-provider",
      provider: providerReturning("{}"),
    })

    expect(result.kind).toBe("clarify")
    expect(result.decisionSource).toBe("safe_fallback")
  })

  it("does not send raw candidate prompts to the isolated AI comparator", async () => {
    const candidate = buildActiveRunProjection(rootRun({
      prompt: "NEVER_SEND_THIS_PROMPT",
      summary: "NEVER_SEND_THIS_SUMMARY",
      promptSourceSnapshot: { intentContract: intentContract({ targetId: "display:1" }) },
    }))
    const incoming = buildIncomingIntentContract({
      sessionId: "session-1",
      source: "webui",
      targetId: "display:2",
    })
    let captured: ChatParams | undefined

    const result = await compareRequestContinuationWithAI({
      incomingContract: incoming,
      candidates: [candidate],
      model: "fake-model",
      providerId: "fake-provider",
      provider: providerReturning('{"decision":"new_run","reason":"different target"}', (params) => {
        captured = params
      }),
    })

    expect(result.kind).toBe("new_run")
    const serializedMessages = JSON.stringify(captured?.messages)
    expect(serializedMessages).not.toContain("NEVER_SEND_THIS_PROMPT")
    expect(serializedMessages).not.toContain("NEVER_SEND_THIS_SUMMARY")
  })

  it("falls back safely on invalid AI JSON without raw prompt fallback", async () => {
    const candidates = [
      buildActiveRunProjection(rootRun({
        id: "run-a",
        requestGroupId: "group-a",
        promptSourceSnapshot: { intentContract: intentContract({ targetId: "display:a" }) },
      })),
      buildActiveRunProjection(rootRun({
        id: "run-b",
        requestGroupId: "group-b",
        promptSourceSnapshot: { intentContract: intentContract({ targetId: "display:b" }) },
      })),
    ]

    const result = await compareRequestContinuationWithAI({
      incomingContract: buildIncomingIntentContract({ sessionId: "session-1", source: "webui", targetId: "display:c" }),
      candidates,
      model: "fake-model",
      providerId: "fake-provider",
      provider: providerReturning("not json"),
    })

    expect(result.kind).toBe("clarify")
    expect(result.decisionSource).toBe("safe_fallback")
  })

  it("allows structured cancel/update target decisions only from contract comparator output", async () => {
    const candidate = buildActiveRunProjection(rootRun({
      id: "run-cancel-target",
      requestGroupId: "group-cancel-target",
      promptSourceSnapshot: { intentContract: intentContract({ targetId: "run:active", targetKind: "run" }) },
    }))
    const incoming = intentContract({
      targetId: "run:other",
      targetKind: "run",
      actionType: "cancel_schedule",
    })

    const result = await compareRequestContinuationWithAI({
      incomingContract: incoming,
      candidates: [candidate],
      model: "fake-model",
      providerId: "fake-provider",
      provider: providerReturning('{"decision":"cancel_target","request_group_id":"group-cancel-target","reason":"structured cancel target"}'),
    })

    expect(result.kind).toBe("cancel_target")
    expect(result.requestGroupId).toBe("group-cancel-target")
    expect(result.runId).toBe("run-cancel-target")
    expect(result.decisionSource).toBe("contract_ai")
  })

  it("parses new structured continuation decisions and legacy aliases", () => {
    expect(parseRequestContinuationDecision('{"decision":"same_run","request_group_id":"group-1"}')?.decision).toBe("same_run")
    expect(parseRequestContinuationDecision('{"decision":"reuse","request_group_id":"group-1"}')?.decision).toBe("same_run")
    expect(parseRequestContinuationDecision('{"decision":"new"}')?.decision).toBe("new_run")
    expect(parseRequestContinuationDecision('{"decision":"cancel_target","run_id":"run-1"}')?.decision).toBe("cancel_target")
  })
})
