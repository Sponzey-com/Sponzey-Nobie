import type { RootRun, RunStatus } from "./runs"

export type TaskAttemptKind =
  | "primary"
  | "followup"
  | "intake_bridge"
  | "approval_continuation"
  | "verification"
  | "filesystem_retry"
  | "truncated_recovery"
  | "scheduled_execution"

export type TaskRecoveryKind = "filesystem" | "truncated_output" | "generic"

export type TaskDeliveryStatus = "not_requested" | "pending" | "delivered" | "failed"

export type TaskActivityKind =
  | "attempt.started"
  | "attempt.awaiting_approval"
  | "attempt.awaiting_user"
  | "attempt.completed"
  | "attempt.failed"
  | "attempt.cancelled"
  | "recovery.started"
  | "recovery.awaiting_approval"
  | "recovery.awaiting_user"
  | "recovery.completed"
  | "recovery.failed"
  | "recovery.cancelled"
  | "delivery.pending"
  | "delivery.delivered"
  | "delivery.failed"

export interface TaskAttemptModel {
  id: string
  taskId: string
  requestGroupId: string
  kind: TaskAttemptKind
  title: string
  prompt: string
  status: RunStatus
  summary: string
  userVisible: boolean
  createdAt: number
  updatedAt: number
}

export interface TaskRecoveryAttemptModel {
  id: string
  taskId: string
  sourceAttemptId?: string
  kind: TaskRecoveryKind
  status: RunStatus
  summary: string
  userVisible: boolean
  createdAt: number
  updatedAt: number
}

export interface TaskDeliveryModel {
  taskId: string
  status: TaskDeliveryStatus
  sourceAttemptId?: string
  channel?: "telegram" | "webui" | "cli" | "unknown"
  summary?: string
}

export interface TaskActivityModel {
  id: string
  taskId: string
  kind: TaskActivityKind
  at: number
  summary: string
  attemptId?: string
  attemptKind?: TaskAttemptKind
  recoveryKind?: TaskRecoveryKind
  runStatus?: RunStatus
}

export interface TaskMonitorModel {
  activeAttemptCount: number
  runningAttemptCount: number
  queuedAttemptCount: number
  visibleAttemptCount: number
  internalAttemptCount: number
  recoveryAttemptCount: number
  activeRecoveryCount: number
  duplicateExecutionRisk: boolean
  awaitingApproval: boolean
  awaitingUser: boolean
  deliveryStatus: TaskDeliveryStatus
}

export interface TaskModel {
  id: string
  requestGroupId: string
  sessionId: string
  source: RootRun["source"]
  anchorRunId: string
  latestAttemptId: string
  runIds: string[]
  title: string
  requestText: string
  summary: string
  status: RunStatus
  canCancel: boolean
  createdAt: number
  updatedAt: number
  attempts: TaskAttemptModel[]
  recoveryAttempts: TaskRecoveryAttemptModel[]
  delivery: TaskDeliveryModel
  monitor: TaskMonitorModel
  activities: TaskActivityModel[]
}
