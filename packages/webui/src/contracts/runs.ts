export type RunOrchestrationMode = "single_nobie" | "orchestration"

export type RuntimeInspectorControlAction =
  | "send"
  | "steer"
  | "retry"
  | "feedback"
  | "redelegate"
  | "cancel"
  | "kill"

export type RuntimeInspectorApprovalState =
  | "not_required"
  | "required"
  | "approved"
  | "denied"
  | "pending"

export type RunStatus =
  | "queued"
  | "running"
  | "awaiting_approval"
  | "awaiting_user"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted"

export type RunStepStatus = "pending" | "running" | "completed" | "failed" | "cancelled"

export type RunContextMode = "full" | "isolated" | "request_group" | "handoff"

export type RunScope = "root" | "child" | "analysis"

export type TaskProfile =
  | "general_chat"
  | "planning"
  | "coding"
  | "review"
  | "research"
  | "private_local"
  | "summarization"
  | "operations"

export interface RunStep {
  key: string
  title: string
  index: number
  status: RunStepStatus
  startedAt?: number
  finishedAt?: number
  summary: string
}

export interface RunEvent {
  id: string
  at: number
  label: string
}

export interface RootRun {
  id: string
  sessionId: string
  requestGroupId: string
  lineageRootRunId: string
  runScope: RunScope
  parentRunId?: string
  handoffSummary?: string
  title: string
  prompt: string
  source: "webui" | "cli" | "telegram" | "slack"
  status: RunStatus
  taskProfile: TaskProfile
  targetId?: string
  targetLabel?: string
  workerRuntimeKind?: string
  workerSessionId?: string
  contextMode: RunContextMode
  delegationTurnCount: number
  maxDelegationTurns: number
  orchestrationMode?: RunOrchestrationMode
  orchestrationPlanSnapshot?: Record<string, unknown>
  subSessionIds?: string[]
  subSessionsSnapshot?: Array<Record<string, unknown>>
  agentDisplayName?: string
  agentNickname?: string
  currentStepKey: string
  currentStepIndex: number
  totalSteps: number
  summary: string
  canCancel: boolean
  createdAt: number
  updatedAt: number
  steps: RunStep[]
  recentEvents: RunEvent[]
  promptSourceSnapshot?: Record<string, unknown>
}

export interface RunProgressSnapshot {
  runId: string
  status: RunStatus
  currentStep: RunStep
  totalSteps: number
  targetId?: string
  targetLabel?: string
  workerSessionId?: string
  contextMode: RunContextMode
  orchestrationMode?: RunOrchestrationMode
  subSessionIds?: string[]
  summary: string
  recentEvents: RunEvent[]
  canCancel: boolean
}

export interface RuntimeInspectorAllowedControlAction {
  action: RuntimeInspectorControlAction
  reasonCode: string
}

export interface RunRuntimeInspectorExpectedOutput {
  outputId: string
  kind: "text" | "artifact" | "tool_result" | "data_package" | "state_change"
  required: boolean
  description: string
  acceptanceReasonCodes: string[]
}

export interface RunRuntimeInspectorProgressItem {
  eventId: string
  at: number
  status: string
  summary: string
}

export interface RunRuntimeInspectorReview {
  resultReportId?: string
  status?: string
  verdict?: string
  parentIntegrationStatus?: string
  accepted?: boolean
  issueCodes: string[]
  normalizedFailureKey?: string
  risksOrGaps: string[]
}

export interface RunRuntimeInspectorResult {
  resultReportId?: string
  status?: string
  outputCount?: number
  artifactCount?: number
  riskOrGapCount?: number
  risksOrGaps: string[]
  summary?: string
  impossibleReasonKind?: string
}

export interface RunRuntimeInspectorFeedback {
  status: "none" | "requested" | "redelegation_requested"
  feedbackRequestId?: string
  targetAgentId?: string
  targetAgentNickname?: string
  reasonCode?: string
  missingItemCount?: number
  requiredChangeCount?: number
}

export interface RunRuntimeInspectorModel {
  providerId: string
  modelId: string
  fallbackApplied: boolean
  fallbackFromModelId?: string
  fallbackReasonCode?: string
  effort?: string
  retryCount: number
  attemptCount?: number
  estimatedInputTokens: number
  estimatedOutputTokens: number
  estimatedCost: number
  latencyMs?: number
  status?: string
}

export interface RunRuntimeInspectorSubSession {
  subSessionId: string
  parentRunId: string
  agentId: string
  agentDisplayName: string
  agentNickname?: string
  status:
    | "created"
    | "queued"
    | "running"
    | "waiting_for_input"
    | "awaiting_approval"
    | "completed"
    | "needs_revision"
    | "failed"
    | "cancelled"
  commandSummary: string
  expectedOutputs: RunRuntimeInspectorExpectedOutput[]
  retryBudgetRemaining: number
  promptBundleId: string
  startedAt?: number
  finishedAt?: number
  progress: RunRuntimeInspectorProgressItem[]
  result?: RunRuntimeInspectorResult
  review?: RunRuntimeInspectorReview
  feedback: RunRuntimeInspectorFeedback
  approvalState: RuntimeInspectorApprovalState
  model?: RunRuntimeInspectorModel
  allowedControlActions: RuntimeInspectorAllowedControlAction[]
}

export interface RunRuntimeInspectorDataExchangeSummary {
  exchangeId: string
  sourceOwnerId: string
  sourceNickname?: string
  recipientOwnerId: string
  recipientNickname?: string
  purpose: string
  allowedUse: "temporary_context" | "memory_candidate" | "verification_only"
  retentionPolicy: "session_only" | "short_term" | "long_term_candidate"
  redactionState: "redacted" | "not_sensitive" | "blocked"
  provenanceCount: number
  createdAt: number
  expiresAt?: number
}

export interface RunRuntimeInspectorApprovalSummary {
  approvalId: string
  status: RuntimeInspectorApprovalState
  subSessionId?: string
  agentId?: string
  summary: string
  at: number
}

export interface RunRuntimeInspectorTimelineEvent {
  id: string
  at: number
  source: "run_event" | "orchestration" | "message_ledger"
  kind: string
  status?: string
  severity?: string
  summary: string
  subSessionId?: string
  agentId?: string
  exchangeId?: string
  approvalId?: string
}

export interface RunRuntimeInspectorPlanTask {
  taskId: string
  executionKind: string
  goal: string
  assignedAgentId?: string
  assignedTeamId?: string
  reasonCodes: string[]
}

export interface RunRuntimeInspectorPlanProjection {
  planId?: string
  parentRequestId?: string
  createdAt?: number
  plannerStatus?: string
  directTaskCount: number
  delegatedTaskCount: number
  approvalRequirementCount: number
  resourceLockCount: number
  parallelGroupCount: number
  fallbackMode?: string
  fallbackReasonCode?: string
  taskSummaries: RunRuntimeInspectorPlanTask[]
}

export interface RunRuntimeInspectorFinalizer {
  parentOwnedFinalAnswer: true
  status: "not_started" | "generated" | "delivered" | "suppressed" | "failed"
  deliveryKey?: string
  idempotencyKey?: string
  summary?: string
  at?: number
}

export interface RunRuntimeInspectorProjection {
  schemaVersion: 1
  runId: string
  requestGroupId: string
  generatedAt: number
  orchestrationMode: RunOrchestrationMode
  plan: RunRuntimeInspectorPlanProjection
  subSessions: RunRuntimeInspectorSubSession[]
  dataExchanges: RunRuntimeInspectorDataExchangeSummary[]
  approvals: RunRuntimeInspectorApprovalSummary[]
  timeline: RunRuntimeInspectorTimelineEvent[]
  finalizer: RunRuntimeInspectorFinalizer
  redaction: {
    payloadsRedacted: true
    rawPayloadVisible: false
  }
}
