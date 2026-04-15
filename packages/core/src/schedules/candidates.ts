import {
  buildDeliveryKey,
  buildPayloadHash,
  buildScheduleIdentityKey,
  type ScheduleContract,
} from "../contracts/index.js"
import { getDb, getSchedule, type DbSchedule } from "../db/index.js"

export type ScheduleCandidateReason =
  | "explicit_id"
  | "identity_key"
  | "delivery_time"
  | "payload_destination"
  | "semantic_candidate"

export type ScheduleCandidateConfidence = "exact" | "strong" | "weak" | "semantic"

export interface ScheduleCandidate {
  schedule: DbSchedule
  contract: ScheduleContract | null
  candidateReason: ScheduleCandidateReason
  confidenceKind: ScheduleCandidateConfidence
  requiresComparison: boolean
  matchedKeys: string[]
}

export interface FindScheduleCandidatesByContractInput {
  contract: ScheduleContract
  scheduleId?: string | null
  sessionId?: string | null | undefined | undefined
  includeDisabled?: boolean
  limit?: number
  semanticCandidates?: DbSchedule[]
}

interface CandidateSpec {
  schedule: DbSchedule
  contract: ScheduleContract | null
  candidateReason: ScheduleCandidateReason
  confidenceKind: ScheduleCandidateConfidence
  requiresComparison: boolean
  matchedKey: string
}

const CANDIDATE_ORDER: Record<ScheduleCandidateReason, number> = {
  explicit_id: 0,
  identity_key: 1,
  delivery_time: 2,
  payload_destination: 3,
  semantic_candidate: 4,
}

export function parseScheduleContractJson(value: string | null | undefined): ScheduleContract | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as ScheduleContract
    return parsed && typeof parsed === "object" ? parsed : null
  } catch {
    return null
  }
}

export function scheduleContractTimeEquals(a: ScheduleContract, b: ScheduleContract): boolean {
  return a.kind === b.kind
    && (a.time.runAt ?? null) === (b.time.runAt ?? null)
    && (a.time.cron ?? null) === (b.time.cron ?? null)
    && a.time.timezone === b.time.timezone
    && a.time.missedPolicy === b.time.missedPolicy
}

export function scheduleContractDestinationEquals(a: ScheduleContract, b: ScheduleContract): boolean {
  return a.delivery.channel === b.delivery.channel
    && (a.delivery.sessionId ?? null) === (b.delivery.sessionId ?? null)
    && (a.delivery.threadId ?? null) === (b.delivery.threadId ?? null)
}

function activeClause(includeDisabled: boolean): string {
  return includeDisabled ? "" : "AND enabled = 1"
}

function sessionClause(sessionId: string | null | undefined): { sql: string; args: string[] } {
  const normalized = sessionId?.trim()
  return normalized ? { sql: "AND target_session_id = ?", args: [normalized] } : { sql: "", args: [] }
}

function querySchedulesByColumn(params: {
  column: "identity_key" | "delivery_key" | "payload_hash"
  value: string
  includeDisabled: boolean
  sessionId?: string | null | undefined
  limit: number
}): DbSchedule[] {
  const session = sessionClause(params.sessionId)
  return getDb()
    .prepare(
      `SELECT s.*,
        (SELECT r.started_at FROM schedule_runs r WHERE r.schedule_id = s.id ORDER BY r.started_at DESC LIMIT 1) AS last_run_at,
        CASE WHEN s.contract_json IS NULL OR s.contract_schema_version IS NULL THEN 1 ELSE 0 END AS legacy
       FROM schedules s
       WHERE s.${params.column} = ?
       ${activeClause(params.includeDisabled)}
       ${session.sql}
       ORDER BY s.created_at DESC
       LIMIT ?`,
    )
    .all(params.value, ...session.args, params.limit) as DbSchedule[]
}

function addCandidate(map: Map<string, ScheduleCandidate>, spec: CandidateSpec): void {
  const existing = map.get(spec.schedule.id)
  if (!existing) {
    map.set(spec.schedule.id, {
      schedule: spec.schedule,
      contract: spec.contract,
      candidateReason: spec.candidateReason,
      confidenceKind: spec.confidenceKind,
      requiresComparison: spec.requiresComparison,
      matchedKeys: [spec.matchedKey],
    })
    return
  }

  existing.matchedKeys.push(spec.matchedKey)
  if (CANDIDATE_ORDER[spec.candidateReason] < CANDIDATE_ORDER[existing.candidateReason]) {
    existing.candidateReason = spec.candidateReason
    existing.confidenceKind = spec.confidenceKind
    existing.requiresComparison = spec.requiresComparison
  }
  if (existing.contract == null && spec.contract != null) existing.contract = spec.contract
}

export function findScheduleCandidatesByContract(
  input: FindScheduleCandidatesByContractInput,
): ScheduleCandidate[] {
  const limit = Math.max(1, Math.min(input.limit ?? 20, 50))
  const includeDisabled = input.includeDisabled === true
  const candidates = new Map<string, ScheduleCandidate>()
  const incomingIdentityKey = buildScheduleIdentityKey(input.contract)
  const incomingDeliveryKey = buildDeliveryKey(input.contract.delivery)
  const incomingPayloadHash = buildPayloadHash(input.contract.payload)

  const explicitId = input.scheduleId?.trim()
  if (explicitId) {
    const schedule = getSchedule(explicitId)
    if (schedule && (includeDisabled || schedule.enabled === 1)) {
      addCandidate(candidates, {
        schedule,
        contract: parseScheduleContractJson(schedule.contract_json),
        candidateReason: "explicit_id",
        confidenceKind: "exact",
        requiresComparison: false,
        matchedKey: `scheduleId:${explicitId}`,
      })
    }
  }

  for (const schedule of querySchedulesByColumn({
    column: "identity_key",
    value: incomingIdentityKey,
    includeDisabled,
    sessionId: input.sessionId,
    limit,
  })) {
    addCandidate(candidates, {
      schedule,
      contract: parseScheduleContractJson(schedule.contract_json),
      candidateReason: "identity_key",
      confidenceKind: "exact",
      requiresComparison: false,
      matchedKey: incomingIdentityKey,
    })
  }

  for (const schedule of querySchedulesByColumn({
    column: "delivery_key",
    value: incomingDeliveryKey,
    includeDisabled,
    sessionId: input.sessionId,
    limit,
  })) {
    const contract = parseScheduleContractJson(schedule.contract_json)
    if (!contract || !scheduleContractTimeEquals(input.contract, contract)) continue
    addCandidate(candidates, {
      schedule,
      contract,
      candidateReason: "delivery_time",
      confidenceKind: "strong",
      requiresComparison: true,
      matchedKey: `${incomingDeliveryKey}:time`,
    })
  }

  for (const schedule of querySchedulesByColumn({
    column: "payload_hash",
    value: incomingPayloadHash,
    includeDisabled,
    sessionId: input.sessionId,
    limit,
  })) {
    const contract = parseScheduleContractJson(schedule.contract_json)
    if (!contract || !scheduleContractDestinationEquals(input.contract, contract)) continue
    addCandidate(candidates, {
      schedule,
      contract,
      candidateReason: "payload_destination",
      confidenceKind: "weak",
      requiresComparison: true,
      matchedKey: `${incomingPayloadHash}:destination`,
    })
  }

  for (const schedule of input.semanticCandidates ?? []) {
    if (!includeDisabled && schedule.enabled !== 1) continue
    addCandidate(candidates, {
      schedule,
      contract: parseScheduleContractJson(schedule.contract_json),
      candidateReason: "semantic_candidate",
      confidenceKind: "semantic",
      requiresComparison: true,
      matchedKey: "semantic_candidate",
    })
  }

  return [...candidates.values()]
    .sort((a, b) => {
      const rank = CANDIDATE_ORDER[a.candidateReason] - CANDIDATE_ORDER[b.candidateReason]
      if (rank !== 0) return rank
      return b.schedule.created_at - a.schedule.created_at
    })
    .slice(0, limit)
}
