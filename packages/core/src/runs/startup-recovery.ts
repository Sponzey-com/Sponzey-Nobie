import type { DbScheduleRun, TaskContinuitySnapshot } from "../db/index.js"
import type { RootRun, RunStatus } from "./types.js"

export type StartupRecoveryStatus =
  | "awaiting_approval"
  | "awaiting_user"
  | "pending_delivery"
  | "interrupted"
  | "delivered"
  | "stale"

export interface StartupRecoveryClassification {
  status: StartupRecoveryStatus
  summary: string
  pendingApprovals?: string[]
  pendingDelivery?: string[]
  nextRunStatus?: RunStatus
  safeToAutoExecute: boolean
  safeToAutoDeliver: boolean
  requiresUserConfirmation: boolean
  duplicateRisk: boolean
}

export interface StartupRecoveryRunSummary {
  runId: string
  lineageRootRunId: string
  previousStatus: RunStatus
  recoveryStatus: StartupRecoveryStatus
  nextRunStatus?: RunStatus
  summary: string
  pendingApprovals: string[]
  pendingDelivery: string[]
  duplicateRisk: boolean
}

export interface StartupRecoveryScheduleSummary {
  scheduleId: string
  scheduleRunId: string
  startedAt: number
  recoveryStatus: "interrupted"
  summary: string
}

export interface StartupRecoverySummary {
  createdAt: number
  totalActiveRuns: number
  recoveredRunCount: number
  interruptedRunCount: number
  awaitingApprovalCount: number
  pendingDeliveryCount: number
  deliveredCount: number
  staleCount: number
  interruptedScheduleRunCount: number
  runs: StartupRecoveryRunSummary[]
  schedules: StartupRecoveryScheduleSummary[]
  userFacingSummary: string
}

let lastStartupRecoverySummary: StartupRecoverySummary = buildStartupRecoverySummary({ runs: [], schedules: [] })

function nonEmptyValues(values: string[] | undefined): string[] {
  return values?.filter((value) => value.trim().length > 0) ?? []
}

function buildClassification(params: {
  status: StartupRecoveryStatus
  summary: string
  pendingApprovals?: string[]
  pendingDelivery?: string[]
  nextRunStatus?: RunStatus
  safeToAutoExecute?: boolean
  safeToAutoDeliver?: boolean
  requiresUserConfirmation?: boolean
  duplicateRisk?: boolean
}): StartupRecoveryClassification {
  return {
    status: params.status,
    summary: params.summary,
    pendingApprovals: nonEmptyValues(params.pendingApprovals),
    pendingDelivery: nonEmptyValues(params.pendingDelivery),
    ...(params.nextRunStatus ? { nextRunStatus: params.nextRunStatus } : {}),
    safeToAutoExecute: params.safeToAutoExecute ?? false,
    safeToAutoDeliver: params.safeToAutoDeliver ?? false,
    requiresUserConfirmation: params.requiresUserConfirmation ?? true,
    duplicateRisk: params.duplicateRisk ?? false,
  }
}

export function classifyStartupRecovery(run: RootRun, continuity?: TaskContinuitySnapshot): StartupRecoveryClassification {
  const pendingApprovals = nonEmptyValues(continuity?.pendingApprovals)
  const pendingDelivery = nonEmptyValues(continuity?.pendingDelivery)

  if (continuity?.lastDeliveryReceipt && pendingDelivery.length === 0) {
    return buildClassification({
      status: "delivered",
      nextRunStatus: "completed",
      summary: "재시작 전 결과 전달 기록이 있어 중복 전달하지 않습니다.",
      safeToAutoExecute: false,
      safeToAutoDeliver: false,
      requiresUserConfirmation: false,
      duplicateRisk: false,
    })
  }

  if (pendingDelivery.length > 0 && continuity?.lastToolReceipt) {
    return buildClassification({
      status: "pending_delivery",
      nextRunStatus: "awaiting_user",
      summary: "도구 실행 기록은 있지만 결과 전달 완료 기록이 없어 자동 중복 전송을 멈췄습니다. 전달 재개에는 사용자 확인이 필요합니다.",
      pendingApprovals,
      pendingDelivery,
      safeToAutoExecute: false,
      safeToAutoDeliver: false,
      requiresUserConfirmation: true,
      duplicateRisk: true,
    })
  }

  if (run.status === "awaiting_approval" || pendingApprovals.length > 0) {
    return buildClassification({
      status: "awaiting_approval",
      nextRunStatus: "awaiting_approval",
      summary: "재시작 전 승인 대기 상태를 복구했습니다. 승인 resolver는 재생성되어야 하므로 자동 실행하지 않습니다.",
      pendingApprovals: pendingApprovals.length ? pendingApprovals : [`approval:${run.id}`],
      pendingDelivery,
      safeToAutoExecute: false,
      safeToAutoDeliver: false,
      requiresUserConfirmation: true,
      duplicateRisk: false,
    })
  }

  if (run.status === "awaiting_user") {
    return buildClassification({
      status: "awaiting_user",
      nextRunStatus: "awaiting_user",
      summary: run.summary || "추가 입력을 기다리고 있습니다.",
      pendingApprovals,
      pendingDelivery,
      safeToAutoExecute: false,
      safeToAutoDeliver: false,
      requiresUserConfirmation: true,
    })
  }

  if (run.status === "queued" || run.status === "running") {
    return buildClassification({
      status: "interrupted",
      nextRunStatus: "interrupted",
      summary: "프로세스가 다시 시작되어 자동 실행이 중단되었습니다. 이어서 진행하려면 요청을 다시 실행하거나 취소해 주세요.",
      pendingApprovals,
      pendingDelivery,
      safeToAutoExecute: false,
      safeToAutoDeliver: false,
      requiresUserConfirmation: true,
      duplicateRisk: true,
    })
  }

  return buildClassification({
    status: "stale",
    nextRunStatus: run.status,
    summary: "재시작 복구 대상이 아닌 과거 실행입니다.",
    pendingApprovals,
    pendingDelivery,
    safeToAutoExecute: false,
    safeToAutoDeliver: false,
    requiresUserConfirmation: false,
  })
}

export function summarizeInterruptedScheduleRun(row: DbScheduleRun): StartupRecoveryScheduleSummary {
  return {
    scheduleId: row.schedule_id,
    scheduleRunId: row.id,
    startedAt: row.started_at,
    recoveryStatus: "interrupted",
    summary: "재시작 전 실행 중이던 예약 작업을 실패 처리했습니다. 같은 scheduleId를 자동으로 즉시 재실행하지 않습니다.",
  }
}

export function buildStartupRecoverySummary(input: {
  runs: StartupRecoveryRunSummary[]
  schedules: StartupRecoveryScheduleSummary[]
  createdAt?: number
}): StartupRecoverySummary {
  const runs = input.runs
  const schedules = input.schedules
  const count = (status: StartupRecoveryStatus) => runs.filter((run) => run.recoveryStatus === status).length
  const recoveredRunCount = runs.filter((run) => run.recoveryStatus !== "stale").length
  const interruptedRunCount = count("interrupted")
  const awaitingApprovalCount = count("awaiting_approval")
  const pendingDeliveryCount = count("pending_delivery")
  const deliveredCount = count("delivered")
  const staleCount = count("stale")
  const interruptedScheduleRunCount = schedules.length
  const userFacingSummary = recoveredRunCount === 0 && interruptedScheduleRunCount === 0
    ? "재시작 복구 대상 실행이 없습니다."
    : `재시작 복구: run ${recoveredRunCount}건, 중단 ${interruptedRunCount}건, 승인 대기 ${awaitingApprovalCount}건, 전달 대기 ${pendingDeliveryCount}건, 전달 완료 ${deliveredCount}건, 예약 중단 ${interruptedScheduleRunCount}건.`

  return {
    createdAt: input.createdAt ?? Date.now(),
    totalActiveRuns: runs.length,
    recoveredRunCount,
    interruptedRunCount,
    awaitingApprovalCount,
    pendingDeliveryCount,
    deliveredCount,
    staleCount,
    interruptedScheduleRunCount,
    runs,
    schedules,
    userFacingSummary,
  }
}

export function setLastStartupRecoverySummary(summary: StartupRecoverySummary): void {
  lastStartupRecoverySummary = summary
}

export function getLastStartupRecoverySummary(): StartupRecoverySummary {
  return lastStartupRecoverySummary
}
