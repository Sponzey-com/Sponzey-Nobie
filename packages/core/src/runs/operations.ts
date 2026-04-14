import { sanitizeUserFacingError } from "./error-sanitizer.js"
import type { TaskModel } from "./task-model.js"
import type { RootRun, RunStatus } from "./types.js"

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

interface IssueInput {
  kind: OperationsIssueKind
  key: string
  label: string
  at?: number
}

export const DEFAULT_STALE_RUN_MS = 30 * 60 * 1000

const ACTIVE_STATUSES: RunStatus[] = ["queued", "running", "awaiting_approval", "awaiting_user"]

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

function truncateText(value: string, maxLength = 160): string {
  const normalized = normalizeText(value)
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength - 1)}…`
}

function safeLabel(value: string): string {
  return truncateText(sanitizeUserFacingError(value).userMessage)
}

function isIssueText(value: string): boolean {
  return /(fail|failed|failure|error|degraded|blocked|timeout|timed out|interrupted|denied|forbidden|not found|conflict|stale|mismatch|\b4\d\d\b|\b5\d\d\b|실패|오류|에러|저하|차단|거부|중단|시간 초과|찾지 못|깨진|충돌|불일치)/i.test(value)
}

function issueStatus(count: number): OperationsHealthStatus {
  if (count >= 5) return "down"
  if (count > 0) return "degraded"
  return "ok"
}

function classifyIssue(value: string): { kind: OperationsIssueKind; key: string } {
  const lower = value.toLowerCase()
  if (/(vector|embedding|fts|stale_embedding|dimension|벡터|임베딩)/i.test(value)) return { kind: "vector", key: "vector" }
  if (/(memory|메모리)/i.test(value)) return { kind: "memory", key: "memory" }
  if (/(schedule|scheduler|cron|예약)/i.test(value)) return { kind: "schedule", key: "schedule" }
  if (/(telegram|slack|webui|delivery|send_file|send file|전달|채널|메신저)/i.test(value)) {
    const channel = lower.includes("slack")
      ? "slack"
      : lower.includes("telegram")
        ? "telegram"
        : lower.includes("webui")
          ? "webui"
          : "channel"
    return { kind: "channel", key: `channel:${channel}` }
  }
  if (/(openai|anthropic|gemini|ollama|llama|provider|model|모델|추론)/i.test(value)) {
    const provider = lower.includes("anthropic")
      ? "anthropic"
      : lower.includes("gemini")
        ? "gemini"
        : lower.includes("ollama")
          ? "ollama"
          : lower.includes("llama")
            ? "llama"
            : lower.includes("openai")
              ? "openai"
              : "provider"
    return { kind: "provider", key: `provider:${provider}` }
  }
  if (/(tool|screen_capture|shell_exec|keyboard_|mouse_|yeonjang_|도구|연장)/i.test(value)) {
    const toolMatch = lower.match(/\b(?:screen_capture|shell_exec|keyboard_[a-z_]+|mouse_[a-z_]+|yeonjang_[a-z_]+)\b/)
    return { kind: "tool", key: `tool:${toolMatch?.[0] ?? "unknown"}` }
  }
  return { kind: "run", key: "run" }
}

function pushIssue(issues: IssueInput[], value: string | undefined, at?: number): void {
  if (!value?.trim()) return
  if (!isIssueText(value)) return
  const classified = classifyIssue(value)
  issues.push({
    ...classified,
    label: safeLabel(value),
    ...(at ? { at } : {}),
  })
}

function collectIssues(runs: RootRun[], tasks: TaskModel[]): IssueInput[] {
  const issues: IssueInput[] = []

  for (const run of runs) {
    if (run.status === "failed" || run.status === "interrupted") pushIssue(issues, run.summary, run.updatedAt)
    for (const event of run.recentEvents) pushIssue(issues, event.label, event.at)
  }

  for (const task of tasks) {
    pushIssue(issues, task.failure?.summary, task.updatedAt)
    if (task.delivery.status === "failed") pushIssue(issues, task.delivery.summary ?? "delivery failed", task.updatedAt)
    for (const event of task.diagnostics?.memoryEvents ?? []) pushIssue(issues, event, task.updatedAt)
    for (const event of task.diagnostics?.toolEvents ?? []) pushIssue(issues, event, task.updatedAt)
    for (const event of task.diagnostics?.deliveryEvents ?? []) pushIssue(issues, event, task.updatedAt)
    for (const event of task.diagnostics?.recoveryEvents ?? []) pushIssue(issues, event, task.updatedAt)
    for (const event of task.diagnostics?.latencyEvents ?? []) pushIssue(issues, event, task.updatedAt)
  }

  return issues
}

function aggregateRepeatedIssues(issues: IssueInput[]): OperationsRepeatedIssue[] {
  const grouped = new Map<string, IssueInput[]>()
  for (const issue of issues) {
    const bucket = grouped.get(issue.key) ?? []
    bucket.push(issue)
    grouped.set(issue.key, bucket)
  }

  return [...grouped.entries()]
    .map(([key, items]) => {
      const sorted = [...items].sort((a, b) => (b.at ?? 0) - (a.at ?? 0))
      const sample = sorted[0]?.label ?? "알 수 없는 오류"
      const kind = sorted[0]?.kind ?? "run"
      return {
        key,
        kind,
        label: labelForIssueKind(kind),
        status: issueStatus(sorted.length),
        count: sorted.length,
        ...(sorted[0]?.at ? { lastAt: sorted[0].at } : {}),
        sample,
      } satisfies OperationsRepeatedIssue
    })
    .filter((issue) => issue.count >= 2)
    .sort((a, b) => (b.count - a.count) || ((b.lastAt ?? 0) - (a.lastAt ?? 0)))
}

function labelForIssueKind(kind: OperationsIssueKind): string {
  switch (kind) {
    case "memory":
      return "메모리"
    case "vector":
      return "벡터"
    case "schedule":
      return "예약"
    case "channel":
      return "채널"
    case "tool":
      return "도구"
    case "provider":
      return "AI 연결"
    case "run":
      return "실행"
  }
}

function healthItem(
  key: OperationsHealthItem["key"],
  label: string,
  issues: IssueInput[],
  match: (issue: IssueInput) => boolean,
): OperationsHealthItem {
  const matched = issues.filter(match).sort((a, b) => (b.at ?? 0) - (a.at ?? 0))
  const status = issueStatus(matched.length)
  return {
    key,
    label,
    status,
    reason: matched[0]?.label ?? "최근 반복 오류 없음",
    ...(matched[0]?.at ? { lastAt: matched[0].at } : {}),
    count: matched.length,
  }
}

function overallHealth(items: OperationsHealthItem[]): OperationsHealthItem {
  const worst = items.find((item) => item.status === "down") ?? items.find((item) => item.status === "degraded")
  return {
    key: "overall",
    label: "전체",
    status: worst?.status ?? "ok",
    reason: worst ? `${worst.label}: ${worst.reason}` : "최근 반복 오류 없음",
    ...(worst?.lastAt ? { lastAt: worst.lastAt } : {}),
    count: items.reduce((sum, item) => sum + item.count, 0),
  }
}

function buildStaleCandidate(run: RootRun, kind: StaleCandidateKind, now: number): StaleRunCandidate {
  return {
    runId: run.id,
    requestGroupId: run.requestGroupId,
    status: run.status,
    kind,
    reason: staleReason(kind),
    updatedAt: run.updatedAt,
    ageMs: Math.max(0, now - run.updatedAt),
  }
}

function staleReason(kind: StaleCandidateKind): string {
  switch (kind) {
    case "pending_approval":
      return "오래된 승인 대기"
    case "pending_delivery":
      return "오래된 결과 전달 대기"
    case "run":
      return "오래된 실행 대기 또는 진행 상태"
  }
}

function buildStaleSummary(runs: RootRun[], now: number, thresholdMs: number): OperationsStaleSummary {
  const staleRuns = runs
    .filter((run) => ACTIVE_STATUSES.includes(run.status))
    .filter((run) => now - run.updatedAt >= thresholdMs)

  const pendingApprovals = staleRuns
    .filter((run) => run.status === "awaiting_approval")
    .map((run) => buildStaleCandidate(run, "pending_approval", now))
  const pendingDeliveries = staleRuns
    .filter((run) => run.status === "awaiting_user")
    .map((run) => buildStaleCandidate(run, "pending_delivery", now))
  const genericRuns = staleRuns
    .filter((run) => run.status === "queued" || run.status === "running")
    .map((run) => buildStaleCandidate(run, "run", now))

  return {
    thresholdMs,
    pendingApprovals,
    pendingDeliveries,
    runs: genericRuns,
    total: pendingApprovals.length + pendingDeliveries.length + genericRuns.length,
  }
}

export function buildOperationsSummary(input: {
  runs: RootRun[]
  tasks: TaskModel[]
  now?: number
  staleThresholdMs?: number
}): OperationsSummary {
  const now = input.now ?? Date.now()
  const thresholdMs = input.staleThresholdMs ?? DEFAULT_STALE_RUN_MS
  const issues = collectIssues(input.runs, input.tasks)
  const repeatedIssues = aggregateRepeatedIssues(issues)
  const memory = healthItem("memory", "메모리", issues, (issue) => issue.kind === "memory")
  const vector = healthItem("vector", "벡터", issues, (issue) => issue.kind === "vector")
  const schedule = healthItem("schedule", "예약", issues, (issue) => issue.kind === "schedule")
  const channel = healthItem("channel", "채널", issues, (issue) => issue.kind === "channel")
  const healthItems = [memory, vector, schedule, channel]
  const stale = buildStaleSummary(input.runs, now, thresholdMs)

  return {
    generatedAt: now,
    health: {
      overall: overallHealth(healthItems),
      memory,
      vector,
      schedule,
      channel,
    },
    repeatedIssues,
    stale,
    counts: {
      runs: input.runs.length,
      tasks: input.tasks.length,
      repeatedIssues: repeatedIssues.length,
      stale: stale.total,
    },
  }
}
