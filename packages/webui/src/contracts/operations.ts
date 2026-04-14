import type { RunStatus } from "./runs"

export type OperationsHealthStatus = "ok" | "degraded" | "down"
export type OperationsIssueKind = "memory" | "vector" | "schedule" | "channel" | "tool" | "provider" | "run"
export type StaleCandidateKind = "pending_approval" | "pending_delivery" | "run"

export interface OperationsHealthItem {
  key: "overall" | "memory" | "vector" | "schedule" | "channel"
  label: string
  status: OperationsHealthStatus
  reason: string
  lastAt?: number
  count: number
}

export interface OperationsRepeatedIssue {
  key: string
  kind: OperationsIssueKind
  label: string
  status: OperationsHealthStatus
  count: number
  lastAt?: number
  sample: string
}

export interface StaleRunCandidate {
  runId: string
  requestGroupId: string
  status: RunStatus
  kind: StaleCandidateKind
  reason: string
  updatedAt: number
  ageMs: number
}

export interface OperationsStaleSummary {
  thresholdMs: number
  pendingApprovals: StaleRunCandidate[]
  pendingDeliveries: StaleRunCandidate[]
  runs: StaleRunCandidate[]
  total: number
}

export interface OperationsSummary {
  generatedAt: number
  health: {
    overall: OperationsHealthItem
    memory: OperationsHealthItem
    vector: OperationsHealthItem
    schedule: OperationsHealthItem
    channel: OperationsHealthItem
  }
  repeatedIssues: OperationsRepeatedIssue[]
  stale: OperationsStaleSummary
  counts: {
    runs: number
    tasks: number
    repeatedIssues: number
    stale: number
  }
}

export interface StaleRunCleanupResult {
  cleanedRunCount: number
  skippedRunCount: number
  cleanedRunIds: string[]
  skippedRunIds: string[]
  thresholdMs: number
}
