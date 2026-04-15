export type LatencyMetricName =
  | "ingress_ack_latency_ms"
  | "normalizer_latency_ms"
  | "candidate_search_latency_ms"
  | "contract_ai_comparison_latency_ms"
  | "execution_latency_ms"
  | "delivery_latency_ms"
  | "schedule_tick_direct_execution_latency_ms"

export type LatencyMetricStatus = "ok" | "slow" | "timeout"

export interface LatencyMetricRecord {
  id: string
  name: LatencyMetricName
  durationMs: number
  budgetMs: number
  status: LatencyMetricStatus
  createdAt: number
  runId?: string
  sessionId?: string
  requestGroupId?: string
  source?: string
  detail?: Record<string, unknown>
}

export interface LatencyMetricSummary {
  name: LatencyMetricName
  count: number
  p95Ms: number | null
  lastMs: number | null
  budgetMs: number
  timeoutCount: number
  slowCount: number
  status: LatencyMetricStatus
  lastAt: number | null
}

export interface FastResponseHealthSnapshot {
  generatedAt: number
  status: LatencyMetricStatus
  reason: string
  recentWindowMs: number
  metrics: LatencyMetricSummary[]
  recentTimeouts: LatencyMetricRecord[]
}

const MAX_LATENCY_RECORDS = 1_000
const DEFAULT_RECENT_WINDOW_MS = 15 * 60 * 1000

export const LATENCY_BUDGET_MS: Record<LatencyMetricName, number> = {
  ingress_ack_latency_ms: 800,
  normalizer_latency_ms: 300,
  candidate_search_latency_ms: 250,
  contract_ai_comparison_latency_ms: 1_800,
  execution_latency_ms: 5_000,
  delivery_latency_ms: 1_500,
  schedule_tick_direct_execution_latency_ms: 150,
}

const latencyRecords: LatencyMetricRecord[] = []

function normalizeDuration(value: number): number {
  return Math.max(0, Math.round(Number.isFinite(value) ? value : 0))
}

function classifyLatency(durationMs: number, budgetMs: number, timeout?: boolean): LatencyMetricStatus {
  if (timeout) return "timeout"
  if (durationMs > budgetMs) return "slow"
  return "ok"
}

function percentile95(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)
  return sorted[index] ?? null
}

function worstStatus(statuses: LatencyMetricStatus[]): LatencyMetricStatus {
  if (statuses.includes("timeout")) return "timeout"
  if (statuses.includes("slow")) return "slow"
  return "ok"
}

export function recordLatencyMetric(input: {
  name: LatencyMetricName
  durationMs: number
  budgetMs?: number
  timeout?: boolean
  createdAt?: number
  runId?: string
  sessionId?: string
  requestGroupId?: string
  source?: string
  detail?: Record<string, unknown>
}): LatencyMetricRecord {
  const durationMs = normalizeDuration(input.durationMs)
  const budgetMs = normalizeDuration(input.budgetMs ?? LATENCY_BUDGET_MS[input.name])
  const record: LatencyMetricRecord = {
    id: crypto.randomUUID(),
    name: input.name,
    durationMs,
    budgetMs,
    status: classifyLatency(durationMs, budgetMs, input.timeout),
    createdAt: input.createdAt ?? Date.now(),
    ...(input.runId ? { runId: input.runId } : {}),
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    ...(input.requestGroupId ? { requestGroupId: input.requestGroupId } : {}),
    ...(input.source ? { source: input.source } : {}),
    ...(input.detail ? { detail: input.detail } : {}),
  }

  latencyRecords.push(record)
  if (latencyRecords.length > MAX_LATENCY_RECORDS) latencyRecords.splice(0, latencyRecords.length - MAX_LATENCY_RECORDS)
  return record
}

export function buildLatencyEventLabel(record: Pick<LatencyMetricRecord, "name" | "durationMs" | "status">): string {
  return record.status === "ok"
    ? `${record.name}=${record.durationMs}ms`
    : `${record.name}=${record.durationMs}ms status=${record.status}`
}

export function buildLatencyEventLabelForMeasurement(input: {
  name: LatencyMetricName
  durationMs: number
  budgetMs?: number
  timeout?: boolean
}): string {
  const durationMs = normalizeDuration(input.durationMs)
  const budgetMs = normalizeDuration(input.budgetMs ?? LATENCY_BUDGET_MS[input.name])
  return buildLatencyEventLabel({
    name: input.name,
    durationMs,
    status: classifyLatency(durationMs, budgetMs, input.timeout),
  })
}

export function listLatencyMetrics(): LatencyMetricRecord[] {
  return [...latencyRecords]
}

export function resetLatencyMetrics(): void {
  latencyRecords.splice(0, latencyRecords.length)
}

export function getFastResponseHealthSnapshot(input: {
  now?: number
  windowMs?: number
} = {}): FastResponseHealthSnapshot {
  const now = input.now ?? Date.now()
  const recentWindowMs = input.windowMs ?? DEFAULT_RECENT_WINDOW_MS
  const recent = latencyRecords.filter((record) => now - record.createdAt <= recentWindowMs)
  const metricNames = Object.keys(LATENCY_BUDGET_MS) as LatencyMetricName[]
  const metrics = metricNames.map((name): LatencyMetricSummary => {
    const records = recent.filter((record) => record.name === name)
    const last = records[records.length - 1]
    const status = worstStatus(records.map((record) => record.status))
    return {
      name,
      count: records.length,
      p95Ms: percentile95(records.map((record) => record.durationMs)),
      lastMs: last?.durationMs ?? null,
      budgetMs: LATENCY_BUDGET_MS[name],
      timeoutCount: records.filter((record) => record.status === "timeout").length,
      slowCount: records.filter((record) => record.status === "slow").length,
      status,
      lastAt: last?.createdAt ?? null,
    }
  })
  const status = worstStatus(metrics.map((metric) => metric.status))
  const reason = status === "timeout"
    ? "최근 빠른 응답 경로에서 timeout이 발생했습니다."
    : status === "slow"
      ? "최근 빠른 응답 경로 중 일부가 latency budget을 초과했습니다."
      : "최근 빠른 응답 경로가 budget 안에서 동작했습니다."

  return {
    generatedAt: now,
    status,
    reason,
    recentWindowMs,
    metrics,
    recentTimeouts: recent
      .filter((record) => record.status === "timeout")
      .slice(-10),
  }
}
