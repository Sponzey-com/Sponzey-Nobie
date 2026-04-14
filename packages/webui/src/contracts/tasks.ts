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
export type TaskFailureKind = "execution" | "recovery" | "delivery"
export type TaskChecklistItemKey = "request" | "execution" | "delivery" | "completion"
export type TaskChecklistItemStatus = "pending" | "running" | "completed" | "failed" | "cancelled" | "not_required"

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
  channel?: "telegram" | "webui" | "slack" | "cli" | "unknown"
  summary?: string
  artifact?: TaskArtifactModel
}

export interface TaskArtifactModel {
  filePath?: string
  fileName: string
  url?: string
  mimeType?: string
}

export interface TaskFailureModel {
  kind: TaskFailureKind
  status: Extract<RunStatus, "failed" | "cancelled" | "interrupted">
  title: string
  summary: string
  detailLines: string[]
  sourceAttemptId?: string
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

export interface TaskChecklistItemModel {
  key: TaskChecklistItemKey
  status: TaskChecklistItemStatus
  summary?: string
}

export interface TaskChecklistModel {
  items: TaskChecklistItemModel[]
  completedCount: number
  actionableCount: number
  failedCount: number
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

export interface TaskContinuityModel {
  lineageRootRunId: string
  parentRunId?: string
  handoffSummary?: string
  lastGoodState?: string
  pendingApprovals: string[]
  pendingDelivery: string[]
  lastToolReceipt?: string
  lastDeliveryReceipt?: string
  failedRecoveryKey?: string
  failureKind?: string
  recoveryBudget?: string
  status?: string
  updatedAt: number
}

export interface TaskDiagnosticsModel {
  promptSourceIds: string[]
  promptSources: TaskPromptSourceDiagnosticModel[]
  promptSourceVersion?: string
  latencyEvents: string[]
  memoryEvents: string[]
  toolEvents: string[]
  deliveryEvents: string[]
  recoveryEvents: string[]
  lastRecoveryKey?: string
  recoveryBudget?: string
}

export interface TaskPromptSourceDiagnosticModel {
  sourceId: string
  locale?: string
  version?: string
  checksum?: string
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
  failure?: TaskFailureModel
  checklist: TaskChecklistModel
  monitor: TaskMonitorModel
  continuity?: TaskContinuityModel
  diagnostics?: TaskDiagnosticsModel
  activities: TaskActivityModel[]
}
