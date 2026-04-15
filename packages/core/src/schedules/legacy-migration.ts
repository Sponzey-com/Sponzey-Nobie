import {
  buildDeliveryKey,
  buildPayloadHash,
  buildScheduleIdentityKey,
  CONTRACT_SCHEMA_VERSION,
  formatContractValidationFailureForUser,
  toCanonicalJson,
  validateScheduleContract,
  type DeliveryChannel,
  type ScheduleContract,
} from "../contracts/index.js"
import { getConfig } from "../config/index.js"
import {
  getSchedule,
  getSchedules,
  insertAuditLog,
  isLegacySchedule,
  updateSchedule,
  type DbSchedule,
} from "../db/index.js"
import { isValidCron, normalizeScheduleTimezone } from "../scheduler/cron.js"
import { extractDirectChannelDeliveryText } from "../runs/scheduled.js"

export type LegacyScheduleMigrationRisk = "low" | "medium" | "high" | "blocked"
export type LegacyScheduleMigrationStatus = "already_contract" | "convertible" | "blocked"

export interface LegacyScheduleMigrationPersistencePreview {
  identityKey: string
  payloadHash: string
  deliveryKey: string
  contractSchemaVersion: number
}

export interface LegacyScheduleMigrationReport {
  scheduleId: string
  scheduleName: string
  status: LegacyScheduleMigrationStatus
  legacy: boolean
  convertible: boolean
  risk: LegacyScheduleMigrationRisk
  confidence: number
  reasons: string[]
  warnings: string[]
  contract: ScheduleContract | null
  persistence: LegacyScheduleMigrationPersistencePreview | null
}

export interface LegacyScheduleMigrationItem {
  scheduleId: string
  name: string
  rawPrompt: string
  cronExpression: string
  timezone: string | null
  enabled: boolean
  target: {
    channel: string
    sessionId: string | null
  }
  legacy: boolean
  convertible: boolean
  risk: LegacyScheduleMigrationRisk
  reason: string
  createdAt: number
  updatedAt: number
  lastRunAt: number | null
}

interface LegacyScheduleContractPersistence {
  contract_json: string
  identity_key: string
  payload_hash: string
  delivery_key: string
  contract_schema_version: number
}

function normalizeDeliveryChannel(channel: string): { channel: DeliveryChannel; warning?: string } {
  const normalized = channel.trim().toLowerCase()
  if (normalized === "telegram" || normalized === "slack" || normalized === "webui" || normalized === "local" || normalized === "agent") {
    return { channel: normalized }
  }
  return {
    channel: "agent",
    warning: `Unsupported legacy target channel "${channel}" was mapped to agent.`,
  }
}

function prepareLegacyScheduleContractPersistence(contract: ScheduleContract): LegacyScheduleContractPersistence {
  const validation = validateScheduleContract(contract)
  if (!validation.ok) {
    throw new Error(formatContractValidationFailureForUser(validation.issues))
  }

  return {
    contract_json: toCanonicalJson(contract),
    identity_key: buildScheduleIdentityKey(contract),
    payload_hash: buildPayloadHash(contract.payload),
    delivery_key: buildDeliveryKey(contract.delivery),
    contract_schema_version: contract.schemaVersion,
  }
}

function buildPersistencePreview(contract: ScheduleContract): LegacyScheduleMigrationPersistencePreview {
  const persistence = prepareLegacyScheduleContractPersistence(contract)
  return {
    identityKey: persistence.identity_key,
    payloadHash: persistence.payload_hash,
    deliveryKey: persistence.delivery_key,
    contractSchemaVersion: persistence.contract_schema_version,
  }
}

function auditLegacyMigration(params: {
  schedule: DbSchedule
  action: "dry_run" | "convert" | "keep"
  result: "success" | "failed"
  report?: LegacyScheduleMigrationReport
  error?: string
}): void {
  try {
    insertAuditLog({
      timestamp: Date.now(),
      session_id: params.schedule.target_session_id,
      run_id: params.schedule.origin_run_id,
      request_group_id: params.schedule.origin_request_group_id,
      channel: params.schedule.target_channel,
      source: "scheduler",
      tool_name: "legacy_schedule_contract_migration",
      params: JSON.stringify({
        action: params.action,
        scheduleId: params.schedule.id,
        scheduleName: params.schedule.name,
      }),
      output: params.report
        ? JSON.stringify({
            status: params.report.status,
            convertible: params.report.convertible,
            risk: params.report.risk,
            confidence: params.report.confidence,
            reasons: params.report.reasons,
            warnings: params.report.warnings,
            persistence: params.report.persistence,
          })
        : null,
      result: params.result,
      duration_ms: 0,
      approval_required: 0,
      approved_by: null,
      error_code: params.error ?? null,
    })
  } catch {
    // Migration diagnostics must not break schedule management APIs.
  }
}

export function buildLegacyScheduleMigrationReport(schedule: DbSchedule): LegacyScheduleMigrationReport {
  const legacy = isLegacySchedule(schedule)
  if (!legacy) {
    return {
      scheduleId: schedule.id,
      scheduleName: schedule.name,
      status: "already_contract",
      legacy: false,
      convertible: false,
      risk: "low",
      confidence: 1,
      reasons: ["Schedule already has a persisted ScheduleContract."],
      warnings: [],
      contract: null,
      persistence: null,
    }
  }

  const reasons: string[] = []
  const warnings: string[] = []
  if (!isValidCron(schedule.cron_expression)) {
    return {
      scheduleId: schedule.id,
      scheduleName: schedule.name,
      status: "blocked",
      legacy: true,
      convertible: false,
      risk: "blocked",
      confidence: 0,
      reasons: ["Legacy schedule has an invalid cron expression."],
      warnings: [],
      contract: null,
      persistence: null,
    }
  }

  const config = getConfig()
  const timezone = normalizeScheduleTimezone(schedule.timezone, config.scheduler.timezone || config.profile.timezone)
  if (!schedule.timezone) warnings.push("Legacy schedule did not store a timezone; current default timezone will be used.")

  const delivery = normalizeDeliveryChannel(schedule.target_channel)
  if (delivery.warning) warnings.push(delivery.warning)

  const literalText = extractDirectChannelDeliveryText(schedule.prompt)
  const payload = literalText
    ? { kind: "literal_message" as const, literalText }
    : { kind: "agent_task" as const, taskContract: null }

  if (literalText) {
    reasons.push("Raw prompt can be represented as a literal message payload.")
  } else {
    reasons.push("Raw prompt can be preserved as an agent task payload.")
    warnings.push("Agent task conversion preserves the original prompt but cannot prove exact user intent without running the scheduler.")
  }

  const contract: ScheduleContract = {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    kind: "recurring",
    time: {
      cron: schedule.cron_expression,
      timezone,
      missedPolicy: "next_only",
    },
    payload,
    delivery: {
      schemaVersion: CONTRACT_SCHEMA_VERSION,
      mode: "channel_message",
      channel: delivery.channel,
      sessionId: schedule.target_session_id ?? null,
      threadId: null,
    },
    source: {
      ...(schedule.origin_run_id ? { originRunId: schedule.origin_run_id } : {}),
      ...(schedule.origin_request_group_id ? { originRequestGroupId: schedule.origin_request_group_id } : {}),
      createdBy: "legacy_schedule_migration",
    },
    displayName: schedule.name,
    rawText: schedule.prompt,
    summary: literalText ? "Legacy literal schedule migration candidate." : "Legacy agent task schedule migration candidate.",
  }

  const persistence = buildPersistencePreview(contract)
  const risk: LegacyScheduleMigrationRisk = literalText && warnings.length === 0 ? "low" : warnings.length <= 1 ? "medium" : "high"
  return {
    scheduleId: schedule.id,
    scheduleName: schedule.name,
    status: "convertible",
    legacy: true,
    convertible: true,
    risk,
    confidence: literalText ? 0.92 : 0.72,
    reasons,
    warnings,
    contract,
    persistence,
  }
}

export function dryRunLegacyScheduleMigration(scheduleId: string, options: { audit?: boolean } = {}): LegacyScheduleMigrationReport | null {
  const schedule = getSchedule(scheduleId)
  if (!schedule) return null
  const report = buildLegacyScheduleMigrationReport(schedule)
  if (options.audit === true) {
    auditLegacyMigration({
      schedule,
      action: "dry_run",
      result: report.convertible || report.status === "already_contract" ? "success" : "failed",
      report,
      ...(!report.convertible && report.status !== "already_contract" ? { error: report.reasons[0] ?? "legacy migration blocked" } : {}),
    })
  }
  return report
}

export function applyLegacyScheduleMigration(scheduleId: string): { ok: boolean; report: LegacyScheduleMigrationReport | null; error?: string } {
  const schedule = getSchedule(scheduleId)
  if (!schedule) return { ok: false, report: null, error: "schedule_not_found" }
  const report = buildLegacyScheduleMigrationReport(schedule)
  if (!report.convertible || !report.contract) {
    const error = report.reasons[0] ?? "legacy migration is not convertible"
    auditLegacyMigration({ schedule, action: "convert", result: "failed", report, error })
    return { ok: false, report, error }
  }

  const persistence = prepareLegacyScheduleContractPersistence(report.contract)
  updateSchedule(schedule.id, {
    contract_json: persistence.contract_json,
    identity_key: persistence.identity_key,
    payload_hash: persistence.payload_hash,
    delivery_key: persistence.delivery_key,
    contract_schema_version: persistence.contract_schema_version,
  })
  auditLegacyMigration({ schedule, action: "convert", result: "success", report })
  return { ok: true, report }
}

export function keepLegacySchedule(scheduleId: string): { ok: boolean; report: LegacyScheduleMigrationReport | null; error?: string } {
  const schedule = getSchedule(scheduleId)
  if (!schedule) return { ok: false, report: null, error: "schedule_not_found" }
  const report = buildLegacyScheduleMigrationReport(schedule)
  auditLegacyMigration({ schedule, action: "keep", result: "success", report })
  return { ok: true, report }
}

export function listLegacyScheduleMigrationItems(): LegacyScheduleMigrationItem[] {
  return getSchedules()
    .filter((schedule) => isLegacySchedule(schedule))
    .map((schedule) => {
      const report = buildLegacyScheduleMigrationReport(schedule)
      return {
        scheduleId: schedule.id,
        name: schedule.name,
        rawPrompt: schedule.prompt,
        cronExpression: schedule.cron_expression,
        timezone: schedule.timezone,
        enabled: schedule.enabled === 1,
        target: {
          channel: schedule.target_channel,
          sessionId: schedule.target_session_id,
        },
        legacy: true,
        convertible: report.convertible,
        risk: report.risk,
        reason: report.reasons[0] ?? "Legacy schedule requires review.",
        createdAt: schedule.created_at,
        updatedAt: schedule.updated_at,
        lastRunAt: schedule.last_run_at ?? null,
      }
    })
}
