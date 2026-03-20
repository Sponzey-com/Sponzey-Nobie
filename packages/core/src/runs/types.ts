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

export type RunContextMode = "full" | "isolated" | "request_group"

export type TaskProfile =
  | "general_chat"
  | "planning"
  | "coding"
  | "review"
  | "research"
  | "private_local"
  | "summarization"
  | "operations"

export interface RootRun {
  id: string
  sessionId: string
  requestGroupId: string
  title: string
  prompt: string
  source: "webui" | "cli" | "telegram"
  status: RunStatus
  taskProfile: TaskProfile
  targetId?: string
  targetLabel?: string
  workerRuntimeKind?: string
  workerSessionId?: string
  contextMode: RunContextMode
  delegationTurnCount: number
  maxDelegationTurns: number
  currentStepKey: string
  currentStepIndex: number
  totalSteps: number
  summary: string
  canCancel: boolean
  createdAt: number
  updatedAt: number
  steps: RunStep[]
  recentEvents: RunEvent[]
}

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

export interface RunProgressSnapshot {
  runId: string
  status: RunStatus
  currentStep: RunStep
  totalSteps: number
  targetId?: string
  targetLabel?: string
  workerSessionId?: string
  contextMode: RunContextMode
  summary: string
  recentEvents: RunEvent[]
  canCancel: boolean
}

export const DEFAULT_RUN_STEPS: Array<{ key: string; title: string }> = [
  { key: "received", title: "요청 수신" },
  { key: "classified", title: "요청 분류" },
  { key: "target_selected", title: "대상 선택" },
  { key: "executing", title: "실행" },
  { key: "reviewing", title: "검토" },
  { key: "awaiting_approval", title: "승인 대기" },
  { key: "awaiting_user", title: "추가 입력 대기" },
  { key: "finalizing", title: "정리" },
  { key: "completed", title: "완료" },
]
