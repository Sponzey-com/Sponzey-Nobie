import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { AIProvider } from "../packages/core/src/ai/index.ts"
import { analyzeTaskIntake, type TaskIntakeActionItem, type TaskIntakeResult } from "../packages/core/src/agent/intake.ts"
import { executeScheduleActions, type ScheduleActionDependencies } from "../packages/core/src/runs/action-execution.ts"
import { reloadConfig } from "../packages/core/src/config/index.js"
import {
  CONTRACT_SCHEMA_VERSION,
  buildDeliveryKey,
  buildPayloadHash,
  buildScheduleIdentityKey,
  compareScheduleContractsWithAI,
  findScheduleCandidatesByContract,
  parseScheduleContractComparisonResult,
  toCanonicalJson,
  type ScheduleContract,
} from "../packages/core/src/index.ts"
import { closeDb, getDb, getSchedule } from "../packages/core/src/db/index.js"

const tempDirs: string[] = []
const previousStateDir = process.env["NOBIE_STATE_DIR"]
const previousConfig = process.env["NOBIE_CONFIG"]

function useTempState(): void {
  closeDb()
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-task004-schedule-"))
  tempDirs.push(stateDir)
  process.env["NOBIE_STATE_DIR"] = stateDir
  delete process.env["NOBIE_CONFIG"]
  reloadConfig()
}

beforeEach(() => {
  useTempState()
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

function scheduleContract(overrides: Partial<ScheduleContract> = {}): ScheduleContract {
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    kind: "recurring",
    time: {
      cron: "0 9 * * *",
      timezone: "Asia/Seoul",
      missedPolicy: "next_only",
    },
    payload: {
      kind: "literal_message",
      literalText: "알림",
    },
    delivery: {
      schemaVersion: CONTRACT_SCHEMA_VERSION,
      mode: "channel_message",
      channel: "telegram",
      sessionId: "telegram:42120565",
      threadId: "main",
    },
    source: {
      originRunId: "run-task004",
      originRequestGroupId: "group-task004",
    },
    displayName: "아침 알림",
    rawText: "매일 오전 9시에 알림이라고 보내줘",
    ...overrides,
  }
}

function insertContractSchedule(id: string, contract: ScheduleContract): void {
  const now = Date.parse("2026-04-15T00:00:00.000Z")
  getDb()
    .prepare(`INSERT INTO schedules
      (id, name, cron_expression, timezone, prompt, enabled, target_channel, target_session_id,
       execution_driver, origin_run_id, origin_request_group_id, model, max_retries, timeout_sec,
       contract_json, identity_key, payload_hash, delivery_key, contract_schema_version, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`) 
    .run(
      id,
      contract.displayName ?? id,
      contract.time.cron ?? "0 9 * * *",
      contract.time.timezone,
      contract.rawText ?? contract.displayName ?? id,
      1,
      contract.delivery.channel,
      contract.delivery.sessionId ?? null,
      "internal",
      contract.source?.originRunId ?? null,
      contract.source?.originRequestGroupId ?? null,
      null,
      3,
      300,
      toCanonicalJson(contract),
      buildScheduleIdentityKey(contract),
      buildPayloadHash(contract.payload),
      buildDeliveryKey(contract.delivery),
      contract.schemaVersion,
      now,
      now,
    )
}

function mockProviderWithText(text: string): AIProvider {
  return {
    id: "mock",
    supportedModels: ["mock-model"],
    maxContextTokens: () => 4096,
    async *chat() {
      yield { type: "text_delta", delta: text }
    },
  }
}

function buildScheduleIntake(): TaskIntakeResult {
  return {
    intent: { category: "schedule_request", summary: "예약 생성", confidence: 0.9 },
    user_message: { mode: "accepted_receipt", text: "요청을 접수했습니다." },
    action_items: [],
    structured_request: {
      source_language: "ko",
      normalized_english: "Create schedule",
      target: "예약 생성",
      to: "current session",
      context: [],
      complete_condition: ["예약 처리 결과를 안내한다."],
    },
    intent_envelope: {
      intent_type: "schedule_request",
      source_language: "ko",
      normalized_english: "Create schedule",
      target: "예약 생성",
      destination: "current session",
      context: [],
      complete_condition: ["예약 처리 결과를 안내한다."],
      schedule_spec: { detected: true, kind: "recurring", status: "accepted", schedule_text: "매일 오전 9시" },
      execution_semantics: {
        filesystemEffect: "none",
        privilegedOperation: "none",
        artifactDelivery: "none",
        approvalRequired: false,
        approvalTool: "external_action",
      },
      delivery_mode: "none",
      requires_approval: false,
      approval_tool: "external_action",
      preferred_target: "auto",
      needs_tools: false,
      needs_web: false,
    },
    scheduling: { detected: true, kind: "recurring", status: "accepted", schedule_text: "매일 오전 9시", cron: "0 9 * * *" },
    execution: {
      requires_run: false,
      requires_delegation: false,
      suggested_target: "auto",
      max_delegation_turns: 3,
      needs_tools: false,
      needs_web: false,
      execution_semantics: {
        filesystemEffect: "none",
        privilegedOperation: "none",
        artifactDelivery: "none",
        approvalRequired: false,
        approvalTool: "external_action",
      },
    },
    notes: [],
  }
}

describe("task004 schedule contract candidates", () => {
  it("returns explicit scheduleId as the highest priority candidate without comparison", () => {
    const contract = scheduleContract()
    insertContractSchedule("schedule-explicit-task004", contract)

    const candidates = findScheduleCandidatesByContract({
      contract: scheduleContract({ rawText: "different language preview" }),
      scheduleId: "schedule-explicit-task004",
    })

    expect(candidates[0]).toMatchObject({
      candidateReason: "explicit_id",
      confidenceKind: "exact",
      requiresComparison: false,
    })
    expect(candidates[0]?.schedule.id).toBe("schedule-explicit-task004")
  })

  it("finds multilingual requests with the same contract identity without using raw text", () => {
    const stored = scheduleContract({
      displayName: "한국어 알림",
      rawText: "매일 오전 9시에 알림이라고 보내줘",
    })
    insertContractSchedule("schedule-identity-task004", stored)

    for (const [displayName, rawText] of [
      ["English reminder", "Send the literal reminder at 9 AM every day."],
      ["日本語リマインダー", "毎日午前9時に通知を送ってください。"],
      ["中文提醒", "每天上午9点发送提醒。"],
    ] as const) {
      const incoming = scheduleContract({
        displayName,
        rawText,
        source: {
          originRunId: `run-incoming-task004-${displayName}`,
          originRequestGroupId: `group-incoming-task004-${displayName}`,
        },
      })

      expect(buildScheduleIdentityKey(stored)).toBe(buildScheduleIdentityKey(incoming))
      const candidates = findScheduleCandidatesByContract({ contract: incoming })

      expect(candidates.map((candidate) => candidate.schedule.id)).toContain("schedule-identity-task004")
      expect(candidates.find((candidate) => candidate.schedule.id === "schedule-identity-task004")).toMatchObject({
        candidateReason: "identity_key",
        confidenceKind: "exact",
        requiresComparison: false,
      })
    }
  })

  it("keeps different delivery destinations separated even when payload is identical", () => {
    const telegram = scheduleContract()
    const slack = scheduleContract({
      delivery: {
        schemaVersion: CONTRACT_SCHEMA_VERSION,
        mode: "channel_message",
        channel: "slack",
        sessionId: "slack:C123",
        threadId: "main",
      },
    })
    insertContractSchedule("schedule-telegram-task004", telegram)
    insertContractSchedule("schedule-slack-task004", slack)

    expect(buildPayloadHash(telegram.payload)).toBe(buildPayloadHash(slack.payload))
    const candidates = findScheduleCandidatesByContract({ contract: telegram })

    expect(candidates.map((candidate) => candidate.schedule.id)).toContain("schedule-telegram-task004")
    expect(candidates.map((candidate) => candidate.schedule.id)).not.toContain("schedule-slack-task004")
  })

  it("returns delivery plus time matches as comparison-required candidates", () => {
    const stored = scheduleContract({
      payload: { kind: "literal_message", literalText: "회의 시작" },
    })
    const incoming = scheduleContract({
      payload: { kind: "literal_message", literalText: "회의 종료" },
    })
    insertContractSchedule("schedule-delivery-time-task004", stored)

    const candidates = findScheduleCandidatesByContract({ contract: incoming })
    expect(candidates.find((candidate) => candidate.schedule.id === "schedule-delivery-time-task004")).toMatchObject({
      candidateReason: "delivery_time",
      confidenceKind: "strong",
      requiresComparison: true,
    })
  })

  it("returns payload plus destination matches as comparison-required candidates", () => {
    const stored = scheduleContract({
      time: {
        cron: "0 9 * * *",
        timezone: "Asia/Seoul",
        missedPolicy: "next_only",
      },
    })
    const incoming = scheduleContract({
      time: {
        cron: "0 18 * * *",
        timezone: "Asia/Seoul",
        missedPolicy: "next_only",
      },
    })
    insertContractSchedule("schedule-payload-destination-task004", stored)

    const candidates = findScheduleCandidatesByContract({ contract: incoming })
    expect(candidates.find((candidate) => candidate.schedule.id === "schedule-payload-destination-task004")).toMatchObject({
      candidateReason: "payload_destination",
      confidenceKind: "weak",
      requiresComparison: true,
    })
  })

  it("marks vector or fts candidates as semantic-only and comparison-required", () => {
    const contract = scheduleContract()
    const semanticContract = scheduleContract({
      time: {
        cron: "0 10 * * *",
        timezone: "Asia/Seoul",
        missedPolicy: "next_only",
      },
      payload: { kind: "literal_message", literalText: "다른 알림" },
      delivery: {
        schemaVersion: CONTRACT_SCHEMA_VERSION,
        mode: "channel_message",
        channel: "slack",
        sessionId: "slack:C999",
        threadId: "main",
      },
      displayName: "semantic only",
    })
    insertContractSchedule("schedule-semantic-task004", semanticContract)
    const semanticSchedule = getSchedule("schedule-semantic-task004")
    expect(semanticSchedule).toBeTruthy()

    const candidates = findScheduleCandidatesByContract({
      contract,
      semanticCandidates: semanticSchedule ? [semanticSchedule] : [],
    })

    expect(candidates.find((candidate) => candidate.schedule.id === "schedule-semantic-task004")).toMatchObject({
      candidateReason: "semantic_candidate",
      confidenceKind: "semantic",
      requiresComparison: true,
    })
  })

  it("does not turn a natural-language cancel heuristic into a final cancel action", async () => {
    insertContractSchedule("schedule-cancel-choice-task004", scheduleContract({
      delivery: {
        schemaVersion: CONTRACT_SCHEMA_VERSION,
        mode: "channel_message",
        channel: "telegram",
        sessionId: "session-cancel-task004",
        threadId: "main",
      },
    }))

    const result = await analyzeTaskIntake({
      userMessage: "/cancel schedule",
      sessionId: "session-cancel-task004",
      source: "telegram",
      model: "mock-model",
    })

    expect(result?.intent.category).toBe("clarification")
    expect(result?.action_items.map((action) => action.type)).toEqual(["ask_user"])
    expect(result?.action_items.some((action) => action.type === "cancel_schedule")).toBe(false)
  })

  it("returns a user choice message instead of silently rejecting duplicate schedules", () => {
    const dependencies: ScheduleActionDependencies = {
      scheduleDelayedRun: () => undefined,
      createRecurringSchedule: () => ({
        scheduleId: "schedule-existing-task004",
        targetSessionId: "telegram:42120565",
        driver: "internal",
        reason: "duplicate_contract_key",
        duplicate: {
          scheduleId: "schedule-existing-task004",
          title: "기존 아침 알림",
          decisionSource: "contract_key",
        },
      }),
      cancelSchedules: () => [],
    }
    const action: TaskIntakeActionItem = {
      id: "create-duplicate-task004",
      type: "create_schedule",
      title: "아침 알림",
      priority: "normal",
      reason: "중복 예약 사용자 선택 테스트",
      payload: {
        title: "아침 알림",
        task: "알림이라고 보내줘",
        cron: "0 9 * * *",
      },
    }

    const result = executeScheduleActions([action], buildScheduleIntake(), {
      runId: "run-duplicate-task004",
      message: "매일 오전 9시에 알림이라고 보내줘",
      originalRequest: "매일 오전 9시에 알림이라고 보내줘",
      sessionId: "telegram:42120565",
      requestGroupId: "group-duplicate-task004",
      model: "mock-model",
      source: "telegram",
      onChunk: undefined,
    }, dependencies)

    expect(result.ok).toBe(true)
    expect(result.successCount).toBe(0)
    expect(result.failureCount).toBe(0)
    expect(result.receipts).toEqual([])
    expect(result.message).toContain("같은 구조의 예약이 이미 있습니다")
    expect(result.message).toContain("기존 예약 유지")
    expect(result.message).toContain("기존 예약 수정")
    expect(result.message).toContain("새 예약으로 추가")
  })
})

describe("task004 schedule contract ai comparison", () => {
  it("accepts a valid same decision only when the candidate id exists", async () => {
    const contract = scheduleContract()
    const result = await compareScheduleContractsWithAI({
      incoming: contract,
      candidates: [{ id: "candidate-1", contract }],
      model: "mock-model",
      providerId: "mock",
      provider: mockProviderWithText(JSON.stringify({
        decision: "same",
        candidateId: "candidate-1",
        reasonCode: "same_schedule_identity",
        userMessage: "같은 예약입니다.",
      })),
    })

    expect(result).toEqual({
      decision: "same",
      candidateId: "candidate-1",
      reasonCode: "same_schedule_identity",
      userMessage: "같은 예약입니다.",
    })
  })

  it("turns invented candidate ids and invalid json into clarification", () => {
    expect(parseScheduleContractComparisonResult(
      JSON.stringify({ decision: "same", candidateId: "invented", reasonCode: "same_schedule_identity" }),
      new Set(["candidate-1"]),
    )).toMatchObject({ decision: "clarify", reasonCode: "invalid_candidate_selection" })

    expect(parseScheduleContractComparisonResult("not json", new Set(["candidate-1"]))).toMatchObject({
      decision: "clarify",
      reasonCode: "invalid_ai_response",
    })
  })

  it("parses valid different and clarify decisions", () => {
    expect(parseScheduleContractComparisonResult(JSON.stringify({
      decision: "different",
      reasonCode: "different_destination",
      userMessage: "전달 대상이 다릅니다.",
    }), new Set(["candidate-1"]))).toEqual({
      decision: "different",
      reasonCode: "different_destination",
      userMessage: "전달 대상이 다릅니다.",
    })

    expect(parseScheduleContractComparisonResult(JSON.stringify({
      decision: "clarify",
      reasonCode: "target_ambiguous",
      userMessage: "후보가 여러 개입니다.",
    }), new Set(["candidate-1"]))).toEqual({
      decision: "clarify",
      reasonCode: "target_ambiguous",
      userMessage: "후보가 여러 개입니다.",
    })
  })

  it("falls back to clarification on comparator timeout", async () => {
    const slowProvider: AIProvider = {
      id: "slow",
      supportedModels: ["mock-model"],
      maxContextTokens: () => 4096,
      async *chat(params) {
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(resolve, 1_000)
          params.signal?.addEventListener("abort", () => {
            clearTimeout(timeout)
            reject(new Error("aborted"))
          })
        })
        yield { type: "text_delta", delta: "{}" }
      },
    }

    const contract = scheduleContract()
    const result = await compareScheduleContractsWithAI({
      incoming: contract,
      candidates: [{ id: "candidate-1", contract }],
      model: "mock-model",
      providerId: "slow",
      provider: slowProvider,
      timeoutMs: 25,
    })

    expect(result).toMatchObject({ decision: "clarify", reasonCode: "comparator_timeout" })
  })
})
