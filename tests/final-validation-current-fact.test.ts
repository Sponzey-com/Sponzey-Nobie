import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { reloadConfig } from "../packages/core/src/config/index.js"
import {
  closeDb,
  insertSession,
  listMessageLedgerEvents,
} from "../packages/core/src/db/index.js"
import {
  buildCurrentFactFinalValidationInput,
  buildRetrievalVerificationPlan,
  evaluateRetrievalVerificationPlan,
  type CurrentFactSourceCandidate,
} from "../packages/core/src/runs/current-fact-retrieval.ts"
import {
  completeRunWithAssistantMessage,
  validateAndFinalize,
} from "../packages/core/src/runs/finalization.ts"
import { buildRunRuntimeInspectorProjection } from "../packages/core/src/runs/runtime-inspector-projection.ts"
import { createRootRun, getRootRun } from "../packages/core/src/runs/store.ts"
import { createFinanceIndexTargetContract } from "../packages/core/src/runs/web-source-adapters/finance.ts"
import type { RetrievalVerificationVerdict } from "../packages/core/src/runs/web-retrieval-verification.ts"

const previousStateDir = process.env["NOBIE_STATE_DIR"]
const previousConfig = process.env["NOBIE_CONFIG"]
const tempDirs: string[] = []

function useTempConfig(): void {
  closeDb()
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-final-validation-current-fact-"))
  tempDirs.push(stateDir)
  const configPath = join(stateDir, "config.json5")
  writeFileSync(configPath, `{
    ai: { connection: { provider: "ollama", endpoint: "http://127.0.0.1:11434", model: "llama3.2" } },
    webui: { enabled: true, host: "127.0.0.1", port: 18181, auth: { enabled: false } },
    security: { approvalMode: "off" },
    memory: { searchMode: "fts", sessionRetentionDays: 30 },
    scheduler: { enabled: false, timezone: "Asia/Seoul" }
  }`, "utf-8")
  process.env["NOBIE_STATE_DIR"] = stateDir
  process.env["NOBIE_CONFIG"] = configPath
  reloadConfig()
}

function financeSources(): CurrentFactSourceCandidate[] {
  return [
    {
      sourceId: "source:google-finance",
      role: "verification_source",
      method: "direct_fetch",
      sourceUrl: "https://www.google.com/finance/quote/KOSPI:KRX",
      sourceDomain: "www.google.com",
      sourceLabel: "Google Finance KOSPI",
      sourceKind: "first_party",
      reliability: "medium",
    },
    {
      sourceId: "source:naver-finance",
      role: "verification_source",
      method: "direct_fetch",
      sourceUrl: "https://finance.naver.com/sise/sise_index.naver?code=KOSPI",
      sourceDomain: "finance.naver.com",
      sourceLabel: "Naver Finance KOSPI",
      sourceKind: "first_party",
      reliability: "medium",
    },
  ]
}

function verifiedVerdict(value = "2700.50"): RetrievalVerificationVerdict {
  return {
    candidateId: "candidate:kospi",
    canAnswer: true,
    bindingStrength: "strong",
    evidenceSufficiency: "sufficient_approximate",
    rejectionReason: null,
    policy: "latest_approximate",
    sourceEvidenceId: "evidence:kospi",
    targetId: "finance_index:kospi",
    acceptedValue: value,
    acceptedUnit: "point",
    bindingSignals: ["symbol:KOSPI"],
    conflicts: [],
    caveats: [],
  }
}

function createDeps() {
  return {
    appendRunEvent: vi.fn(),
    setRunStepStatus: vi.fn(),
    updateRunStatus: vi.fn(),
    rememberRunSuccess: vi.fn(),
    rememberRunFailure: vi.fn(),
    onDeliveryError: vi.fn(),
    deliveryDependencies: {
      now: () => 0,
      createId: () => "message-1",
      insertMessage: vi.fn(),
      emitStart: vi.fn(),
      emitStream: vi.fn(),
      emitEnd: vi.fn(),
      writeReplyLog: vi.fn(),
    },
  }
}

beforeEach(() => {
  useTempConfig()
})

afterEach(() => {
  closeDb()
  if (previousStateDir === undefined) delete process.env["NOBIE_STATE_DIR"]
  else process.env["NOBIE_STATE_DIR"] = previousStateDir
  if (previousConfig === undefined) delete process.env["NOBIE_CONFIG"]
  else process.env["NOBIE_CONFIG"] = previousConfig
  reloadConfig()
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe("task009 final validation for current facts", () => {
  it("blocks final delivery when a required current value is missing and another source remains", () => {
    const plan = buildRetrievalVerificationPlan({
      target: createFinanceIndexTargetContract("kospi", "현재 코스피 지수"),
      freshnessPolicy: "latest_approximate",
      sources: financeSources(),
      now: new Date("2026-05-07T08:00:00.000Z"),
    })
    const decision = evaluateRetrievalVerificationPlan({
      plan,
      results: [{
        sourceId: plan.sources[0]!.sourceId,
        status: "no_value",
        attemptedAt: "2026-05-07T08:01:00.000Z",
        failureReason: "primary source did not expose a bound value",
      }],
    })
    const finalInput = buildCurrentFactFinalValidationInput({ plan, decision })
    const validation = validateAndFinalize(finalInput)

    expect(decision.kind).toBe("continue_verification")
    expect(validation.status).toBe("needs_recovery")
    expect(validation.finalDeliveryAllowed).toBe(false)
    expect(validation.trace.missingValues).toEqual([
      expect.objectContaining({ valueId: plan.target.targetId }),
    ])
    expect(validation.trace.sourceList).toHaveLength(2)
    expect(validation.trace.sourceTimestamps).toContain("2026-05-07T08:01:00.000Z")
    expect(validation.reasonCodes).toContain("final_validation_requires_recovery")
  })

  it("allows final delivery when the current value has a verified source and basis time", () => {
    const plan = buildRetrievalVerificationPlan({
      target: createFinanceIndexTargetContract("kospi", "현재 코스피 지수"),
      freshnessPolicy: "latest_approximate",
      sources: financeSources(),
    })
    const decision = evaluateRetrievalVerificationPlan({
      plan,
      results: [{
        sourceId: plan.sources[0]!.sourceId,
        status: "verified",
        verdict: verifiedVerdict(),
        evidence: {
          method: "direct_fetch",
          sourceKind: "first_party",
          reliability: "medium",
          sourceUrl: plan.sources[0]!.sourceUrl,
          sourceDomain: plan.sources[0]!.sourceDomain,
          sourceLabel: plan.sources[0]!.sourceLabel,
          sourceTimestamp: "2026-05-07T08:00:30.000Z",
          fetchTimestamp: "2026-05-07T08:01:00.000Z",
          freshnessPolicy: "latest_approximate",
        },
        attemptedAt: "2026-05-07T08:01:00.000Z",
      }],
    })
    const validation = validateAndFinalize(buildCurrentFactFinalValidationInput({ plan, decision }))

    expect(decision.kind).toBe("ready_to_answer")
    expect(validation.status).toBe("ready")
    expect(validation.finalDeliveryAllowed).toBe(true)
    expect(validation.trace.observedValues[0]).toEqual(expect.objectContaining({
      value: "2700.50",
      sourceTimestamp: "2026-05-07T08:00:30.000Z",
      fetchTimestamp: "2026-05-07T08:01:00.000Z",
    }))
    expect(validation.trace.sourceTimestamps).toEqual(expect.arrayContaining([
      "2026-05-07T08:00:30.000Z",
      "2026-05-07T08:01:00.000Z",
    ]))
  })

  it("allows only a limited conflict explanation after every safe source is exhausted", () => {
    const plan = buildRetrievalVerificationPlan({
      target: createFinanceIndexTargetContract("kospi", "현재 코스피 지수"),
      freshnessPolicy: "latest_approximate",
      sources: financeSources(),
    })
    const decision = evaluateRetrievalVerificationPlan({
      plan,
      results: plan.sources.map((source, index) => ({
        sourceId: source.sourceId,
        status: "conflict",
        verdict: {
          ...verifiedVerdict(index === 0 ? "2700.00" : "2750.50"),
          canAnswer: false,
          evidenceSufficiency: "insufficient_conflict",
          acceptedValue: index === 0 ? "2700.00" : "2750.50",
          conflicts: ["2700.00 and 2750.50 conflict outside tolerance"],
        },
        attemptedAt: `2026-05-07T08:0${index}:00.000Z`,
      })),
    })
    const validation = validateAndFinalize(buildCurrentFactFinalValidationInput({ plan, decision }))

    expect(decision.kind).toBe("explain_conflict")
    expect(validation.status).toBe("limited_failure_allowed")
    expect(validation.finalDeliveryAllowed).toBe(true)
    expect(validation.trace.conflicts.length).toBeGreaterThan(0)
    expect(validation.reasonCodes).toContain("safe_alternatives_exhausted")
  })

  it("records a blocked final validation without delivering or completing the run", async () => {
    insertSession({
      id: "session:final-validation",
      source: "webui",
      source_id: "session:final-validation",
      created_at: Date.UTC(2026, 4, 7, 8, 0, 0),
      updated_at: Date.UTC(2026, 4, 7, 8, 0, 0),
      summary: "final validation",
    })
    createRootRun({
      id: "run:final-validation",
      sessionId: "session:final-validation",
      requestGroupId: "group:final-validation",
      prompt: "현재 코스피 지수 알려줘",
      source: "webui",
    })
    const plan = buildRetrievalVerificationPlan({
      target: createFinanceIndexTargetContract("kospi", "현재 코스피 지수"),
      freshnessPolicy: "latest_approximate",
      sources: financeSources(),
    })
    const decision = evaluateRetrievalVerificationPlan({
      plan,
      results: [{
        sourceId: plan.sources[0]!.sourceId,
        status: "no_value",
        attemptedAt: "2026-05-07T08:01:00.000Z",
      }],
    })
    const deps = createDeps()
    const onChunk = vi.fn().mockResolvedValue(undefined)

    const outcome = await completeRunWithAssistantMessage({
      runId: "run:final-validation",
      sessionId: "session:final-validation",
      text: "확인 실패로 보입니다.",
      source: "webui",
      onChunk,
      finalValidation: buildCurrentFactFinalValidationInput({ plan, decision }),
      dependencies: deps,
    })

    expect(outcome.status).toBe("blocked_by_final_validation")
    expect(onChunk).not.toHaveBeenCalled()
    expect(deps.rememberRunSuccess).not.toHaveBeenCalled()
    expect(deps.updateRunStatus).toHaveBeenCalledWith(
      "run:final-validation",
      "running",
      "필수 값, 출처, 충돌 검증이 끝나지 않아 최종 전달을 보류합니다.",
      true,
    )
    expect(listMessageLedgerEvents({ runId: "run:final-validation", limit: 20 }))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({
          event_kind: "final_validation_evaluated",
          status: "pending",
        }),
      ]))

    const run = getRootRun("run:final-validation")
    expect(run).toBeDefined()
    if (!run) return
    const projection = buildRunRuntimeInspectorProjection(run, { now: Date.UTC(2026, 4, 7, 8, 2, 0) })
    expect(projection.finalizer.status).toBe("not_started")
    expect(projection.finalizer.validation).toEqual(expect.objectContaining({
      status: "needs_recovery",
      finalDeliveryAllowed: false,
      missingValueCount: 1,
      sourceCount: 2,
    }))
  })
})
