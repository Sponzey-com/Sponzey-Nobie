import { describe, expect, it } from "vitest"
import type { TaskIntentEnvelope } from "../packages/core/src/agent/intake.ts"
import {
  CANONICAL_JSON_POLICY,
  CONTRACT_SCHEMA_VERSION,
  buildDeliveryDedupeKey,
  buildDeliveryKey,
  buildPayloadHash,
  buildScheduleIdentityKey,
  formatContractValidationFailureForUser,
  intentContractFromTaskIntentEnvelope,
  stableContractHash,
  toCanonicalJson,
  validateIntentContract,
  validateScheduleContract,
  type DeliveryContract,
  type ScheduleContract,
} from "../packages/core/src/index.ts"

function baseDelivery(overrides: Partial<DeliveryContract> = {}): DeliveryContract {
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    mode: "channel_message",
    channel: "telegram",
    sessionId: "telegram:42120565",
    threadId: "main",
    ...overrides,
  }
}

function baseSchedule(overrides: Partial<ScheduleContract> = {}): ScheduleContract {
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
    delivery: baseDelivery(),
    rawText: "매일 아침 9시에 알림이라고 보내줘",
    displayName: "아침 알림",
    summary: "사용자 표시용 요약",
    source: {
      originRunId: "run-a",
      originRequestGroupId: "group-a",
      createdBy: "user-a",
    },
    ...overrides,
  }
}

describe("task002 contracts", () => {
  it("validates v1 intent and schedule contracts with narrow enums", () => {
    const intent = validateIntentContract({
      schemaVersion: CONTRACT_SCHEMA_VERSION,
      intentType: "schedule_request",
      actionType: "create_schedule",
      target: {
        schemaVersion: CONTRACT_SCHEMA_VERSION,
        kind: "schedule",
      },
      delivery: baseDelivery({ channel: "current_session", sessionId: null, threadId: null }),
      constraints: [],
      requiresApproval: false,
      impossibility: null,
    })
    expect(intent.ok).toBe(true)

    const schedule = validateScheduleContract(baseSchedule())
    expect(schedule.ok).toBe(true)

    const invalid = validateIntentContract({
      schemaVersion: CONTRACT_SCHEMA_VERSION,
      intentType: "whatever",
      actionType: "do_magic",
      target: { schemaVersion: CONTRACT_SCHEMA_VERSION, kind: "display" },
      delivery: baseDelivery(),
      constraints: [],
      requiresApproval: false,
    })
    expect(invalid.ok).toBe(false)
    if (!invalid.ok) {
      expect(invalid.issues.map((issue) => issue.code)).toContain("unknown_contract_action")
      expect(formatContractValidationFailureForUser(invalid.issues)).toBe("지원하지 않는 실행 계약 작업입니다. 요청을 다시 해석해야 합니다.")
    }
  })

  it("creates deterministic canonical json and hashes regardless of object key order", () => {
    expect(CANONICAL_JSON_POLICY.keyOrder).toContain("lexicographically")
    const left = { b: 2, a: { z: true, y: [3, undefined, null, ""] } }
    const right = { a: { y: [3], z: true }, b: 2 }

    expect(toCanonicalJson(left)).toBe(toCanonicalJson(right))
    expect(stableContractHash(left, "fixture")).toBe(stableContractHash(right, "fixture"))
  })

  it("excludes raw/display/source text from schedule identity keys", () => {
    const first = baseSchedule()
    const second = baseSchedule({
      rawText: "Remind me every day at 9 AM",
      displayName: "Morning reminder",
      summary: "different display summary",
      source: {
        originRunId: "run-b",
        originRequestGroupId: "group-b",
        createdBy: "user-b",
      },
    })

    expect(buildScheduleIdentityKey(first)).toBe(buildScheduleIdentityKey(second))
  })

  it("separates payload hashes, delivery keys, and delivery dedupe keys", () => {
    const schedule = baseSchedule()
    const differentPayload = baseSchedule({ payload: { kind: "literal_message", literalText: "알람" } })
    const differentDelivery = baseSchedule({ delivery: baseDelivery({ sessionId: "slack:C01" }) })

    expect(buildPayloadHash(schedule.payload)).not.toBe(buildPayloadHash(differentPayload.payload))
    expect(buildDeliveryKey(schedule.delivery)).not.toBe(buildDeliveryKey(differentDelivery.delivery))
    expect(buildScheduleIdentityKey(schedule)).not.toBe(buildScheduleIdentityKey(differentDelivery))

    const payloadHash = buildPayloadHash(schedule.payload)
    expect(buildDeliveryDedupeKey({
      scheduleId: "schedule-1",
      dueAt: "2026-04-15T00:00:00.000Z",
      delivery: schedule.delivery,
      payloadHash,
    })).toBe(buildDeliveryDedupeKey({
      scheduleId: "schedule-1",
      dueAt: "2026-04-15T00:00:00.000Z",
      delivery: schedule.delivery,
      payloadHash,
    }))
  })

  it("adapts the legacy TaskIntentEnvelope into a structure-only IntentContract", () => {
    const envelope: TaskIntentEnvelope = {
      intent_type: "schedule_request",
      source_language: "ko",
      normalized_english: "Create a recurring reminder.",
      target: "daily reminder",
      destination: "current telegram session",
      context: ["context"],
      complete_condition: ["reminder is scheduled"],
      schedule_spec: {
        detected: true,
        kind: "recurring",
        status: "accepted",
        schedule_text: "매일 오전 9시",
        cron: "0 9 * * *",
      },
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
      preferred_target: "",
      needs_tools: false,
      needs_web: false,
    }

    const contract = intentContractFromTaskIntentEnvelope(envelope)
    expect(contract.intentType).toBe("schedule_request")
    expect(contract.actionType).toBe("create_schedule")
    expect(contract.delivery.mode).toBe("channel_message")
    expect(contract.constraints).toEqual(["reminder is scheduled"])
    expect(validateIntentContract(contract).ok).toBe(true)
  })

  it("adapts text answer envelopes to reply delivery instead of channel artifact delivery", () => {
    const envelope: TaskIntentEnvelope = {
      intent_type: "task_intake",
      source_language: "ko",
      normalized_english: "Tell me the current weather in Dongcheon-dong.",
      target: "current weather in Dongcheon-dong",
      destination: "telegram chat 42120565, main thread",
      context: ["Original user request: 지금 동천동 날씨 어때?"],
      complete_condition: ["Reply with the weather summary in the current channel."],
      schedule_spec: {
        detected: false,
        kind: "none",
        status: "not_applicable",
        schedule_text: "",
      },
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
      needs_tools: true,
      needs_web: true,
    }

    const contract = intentContractFromTaskIntentEnvelope(envelope)

    expect(contract.actionType).toBe("run_tool")
    expect(contract.delivery.mode).toBe("reply")
    expect(validateIntentContract(contract).ok).toBe(true)
  })
})
