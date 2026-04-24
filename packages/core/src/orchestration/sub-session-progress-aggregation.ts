import type { SubSessionStatus } from "../contracts/sub-agent-orchestration.js"

export interface SubSessionProgressAggregationItem {
  parentRunId: string
  subSessionId: string
  agentId?: string
  agentDisplayName?: string
  agentNickname?: string
  status: SubSessionStatus
  summary: string
  at: number
}

export interface SubSessionProgressAggregationBatch {
  parentRunId: string
  windowStartedAt: number
  windowClosedAt: number
  windowMs: number
  reason: "window_elapsed" | "manual_flush" | "terminal_flush"
  items: SubSessionProgressAggregationItem[]
  text: string
}

export interface SubSessionProgressAggregatorOptions {
  now?: () => number
  windowMs?: number
}

interface ProgressBucket {
  startedAt: number
  latestBySubSession: Map<string, SubSessionProgressAggregationItem>
}

const MIN_WINDOW_MS = 2_000
const MAX_WINDOW_MS = 5_000
const DEFAULT_WINDOW_MS = 3_000

function clampWindowMs(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_WINDOW_MS
  return Math.max(MIN_WINDOW_MS, Math.min(MAX_WINDOW_MS, Math.floor(value ?? DEFAULT_WINDOW_MS)))
}

export function buildSubSessionProgressSummary(items: SubSessionProgressAggregationItem[]): string {
  const ordered = [...items].sort((a, b) => a.subSessionId.localeCompare(b.subSessionId))
  if (ordered.length === 0) return "서브 에이전트 진행 요약: 변경 없음"
  const body = ordered
    .map((item) => {
      const name = item.agentNickname?.trim() || item.agentDisplayName?.trim() || item.agentId?.trim() || item.subSessionId
      return `${name} ${item.status}: ${item.summary.trim()}`
    })
    .join(" / ")
  return `서브 에이전트 진행 요약: ${body}`
}

export class SubSessionProgressAggregator {
  private readonly now: () => number
  readonly windowMs: number
  private readonly buckets = new Map<string, ProgressBucket>()

  constructor(options: SubSessionProgressAggregatorOptions = {}) {
    this.now = options.now ?? (() => Date.now())
    this.windowMs = clampWindowMs(options.windowMs)
  }

  push(item: SubSessionProgressAggregationItem): SubSessionProgressAggregationBatch | undefined {
    const at = item.at || this.now()
    const bucket = this.buckets.get(item.parentRunId) ?? {
      startedAt: at,
      latestBySubSession: new Map<string, SubSessionProgressAggregationItem>(),
    }
    bucket.latestBySubSession.set(item.subSessionId, { ...item, at })
    this.buckets.set(item.parentRunId, bucket)

    if (at - bucket.startedAt < this.windowMs) return undefined
    return this.flush(item.parentRunId, "window_elapsed", at)
  }

  flush(
    parentRunId: string,
    reason: SubSessionProgressAggregationBatch["reason"] = "manual_flush",
    now = this.now(),
  ): SubSessionProgressAggregationBatch | undefined {
    const bucket = this.buckets.get(parentRunId)
    if (!bucket || bucket.latestBySubSession.size === 0) return undefined
    this.buckets.delete(parentRunId)
    const items = [...bucket.latestBySubSession.values()]
    return {
      parentRunId,
      windowStartedAt: bucket.startedAt,
      windowClosedAt: now,
      windowMs: Math.max(0, now - bucket.startedAt),
      reason,
      items,
      text: buildSubSessionProgressSummary(items),
    }
  }

  flushAll(
    reason: SubSessionProgressAggregationBatch["reason"] = "manual_flush",
    now = this.now(),
  ): SubSessionProgressAggregationBatch[] {
    return [...this.buckets.keys()]
      .map((parentRunId) => this.flush(parentRunId, reason, now))
      .filter((batch): batch is SubSessionProgressAggregationBatch => Boolean(batch))
  }
}

export function createSubSessionProgressAggregator(
  options: SubSessionProgressAggregatorOptions = {},
): SubSessionProgressAggregator {
  return new SubSessionProgressAggregator(options)
}
