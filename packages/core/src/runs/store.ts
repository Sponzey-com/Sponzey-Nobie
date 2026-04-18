import { getDb, getTaskContinuity, insertAuditLog, insertDiagnosticEvent, interruptUnfinishedScheduleRunsOnStartup, upsertTaskContinuity } from "../db/index.js"
import { assertMigrationWriteAllowed } from "../db/migration-safety.js"
import { eventBus } from "../events/index.js"
import { getLastRuntimeManifest, refreshRuntimeManifest } from "../runtime/manifest.js"
import { canTransitionRunStatus, resolveRunFlowIdentifiers } from "./flow-contract.js"
import { finalizeDeliveryForRun, recordMessageLedgerEvent } from "./message-ledger.js"
import { buildStartupRecoverySummary, classifyStartupRecovery, setLastStartupRecoverySummary, summarizeInterruptedScheduleRun, type StartupRecoveryRunSummary } from "./startup-recovery.js"
import type { RootRun, RunContextMode, RunEvent, RunScope, RunStatus, RunStep, RunStepStatus, TaskProfile } from "./types.js"
import { DEFAULT_RUN_STEPS } from "./types.js"

interface RootRunRow {
  id: string
  session_id: string
  request_group_id: string | null
  lineage_root_run_id: string | null
  parent_run_id: string | null
  run_scope: RunScope | null
  handoff_summary: string | null
  title: string
  prompt: string
  source: string
  status: RunStatus
  task_profile: TaskProfile
  target_id: string | null
  target_label: string | null
  worker_runtime_kind: string | null
  worker_session_id: string | null
  context_mode: RunContextMode | null
  delegation_turn_count: number
  max_delegation_turns: number
  current_step_key: string
  current_step_index: number
  total_steps: number
  summary: string
  can_cancel: number
  created_at: number
  updated_at: number
  prompt_source_snapshot: string | null
  runtime_manifest_id: string | null
}

interface RunStepRow {
  run_id: string
  step_key: string
  title: string
  step_index: number
  status: RunStepStatus
  summary: string
  started_at: number | null
  finished_at: number | null
}

interface RunEventRow {
  id: string
  run_id: string
  at: number
  label: string
}

const activeRunControllers = new Map<string, AbortController>()
const ACTIVE_WORKER_SESSION_STATUSES: RunStatus[] = ["queued", "running", "awaiting_approval", "awaiting_user"]
const ACTIVE_REQUEST_GROUP_STATUSES: RunStatus[] = ["queued", "running", "awaiting_approval", "awaiting_user"]
const DEFAULT_STALE_RUN_CLEANUP_MS = 30 * 60 * 1000

export interface StaleRunCleanupResult {
  cleanedRunCount: number
  skippedRunCount: number
  cleanedRunIds: string[]
  skippedRunIds: string[]
  thresholdMs: number
}

function truncateTitle(prompt: string): string {
  const normalized = prompt.trim().replace(/\s+/g, " ")
  return normalized.length > 72 ? `${normalized.slice(0, 72)}…` : normalized
}


const RECONNECT_STOP_WORDS = new Set([
  "그", "그거", "그것", "이거", "이것", "저거", "저것", "기존", "이전", "아까", "방금", "전에", "파일", "폴더", "프로그램", "화면", "페이지", "코드", "수정", "고쳐", "바꿔", "추가", "보완", "업데이트",
  "the", "that", "it", "those", "this", "file", "folder", "program", "page", "screen", "code", "modify", "edit", "fix", "change", "update", "continue", "resume",
])

const CONTINUATION_MESSAGE_PATTERNS = [
  /(?:그리고|또|그럼|그러면|이어서|계속|다시|방금|이제|근데|그런데|여기|이건|그건|저건|이쪽|그쪽|저쪽|아직|왜\s*안|안\s*돼|안돼|실패|오류|에러|결과)/u,
  /(?:보여줘|보내줘|고쳐줘|수정해줘|바꿔줘|이어가|계속해|다시\s*해|이어서\s*해|이어서\s*진행)/u,
  /\b(?:and|also|then|next|continue|resume|again|now|here|this|that|it|but|why|result|failed|error)\b/i,
  /\b(?:show|send|fix|change|update|continue|resume|again|failed|error|result)\b/i,
]

function isActiveRequestGroupStatus(status: RunStatus): boolean {
  return ACTIVE_REQUEST_GROUP_STATUSES.includes(status)
}

function looksLikeContinuationMessage(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) return false

  if (CONTINUATION_MESSAGE_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return true
  }

  return false
}

function extractQuotedReconnectTerms(value: string): string[] {
  const result: string[] = []
  const regex = /["'“”‘’]([^"'“”‘’]{2,80})["'“”‘’]/g
  for (const match of value.matchAll(regex)) {
    const token = match[1]?.trim()
    if (token) result.push(token.toLowerCase())
  }
  return result
}

function tokenizeReconnectTerms(value: string): string[] {
  const tokens = value
    .toLowerCase()
    .match(/[a-z0-9가-힣][a-z0-9가-힣._:-]*/g) ?? []

  return [...new Set(tokens.filter((token) => token.length > 1 && !RECONNECT_STOP_WORDS.has(token)))]
}

function scoreReconnectCandidate(message: string, run: RootRun, recencyIndex: number): number {
  const haystack = [run.title, run.prompt, run.summary].join("\n").toLowerCase()
  const quotedTerms = extractQuotedReconnectTerms(message)
  const tokens = tokenizeReconnectTerms(message)
  const overlap = tokens.filter((token) => haystack.includes(token))
  const continuation = looksLikeContinuationMessage(message)
  let score = 0

  for (const quoted of quotedTerms) {
    if (haystack.includes(quoted)) score += 80
  }

  score += overlap.length * 12

  if (overlap.length > 0 || quotedTerms.length > 0) {
    score += Math.max(0, 10 - recencyIndex)
  }

  if (continuation) {
    score += isActiveRequestGroupStatus(run.status) ? 24 : 10
    score += Math.max(0, 6 - recencyIndex)
    if (overlap.length === 0 && quotedTerms.length === 0 && recencyIndex === 0) {
      score += 8
    }
  }

  if (isActiveRequestGroupStatus(run.status)) {
    score += overlap.length > 0 || continuation ? 8 : 0
  }

  return score
}

function mapStep(row: RunStepRow): RunStep {
  return {
    key: row.step_key,
    title: row.title,
    index: row.step_index,
    status: row.status,
    summary: row.summary,
    ...(row.started_at ? { startedAt: row.started_at } : {}),
    ...(row.finished_at ? { finishedAt: row.finished_at } : {}),
  }
}

function mapEvent(row: RunEventRow): RunEvent {
  return {
    id: row.id,
    at: row.at,
    label: row.label,
  }
}

function parsePromptSourceSnapshot(value: string | null): Record<string, unknown> | undefined {
  if (!value) return undefined
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : undefined
  } catch {
    return undefined
  }
}

function hydrateRun(row: RootRunRow): RootRun {
  const db = getDb()
  assertMigrationWriteAllowed(db, "run.create")
  const promptSourceSnapshot = parsePromptSourceSnapshot(row.prompt_source_snapshot)
  const steps = db
    .prepare<[string], RunStepRow>(
      `SELECT run_id, step_key, title, step_index, status, summary, started_at, finished_at
       FROM run_steps WHERE run_id = ? ORDER BY step_index ASC`,
    )
    .all(row.id)
    .map(mapStep)
  const recentEvents = db
    .prepare<[string], RunEventRow>(
      `SELECT id, run_id, at, label
       FROM run_events WHERE run_id = ? ORDER BY at DESC LIMIT 12`,
    )
    .all(row.id)
    .map(mapEvent)
    .sort((a, b) => a.at - b.at)

  return {
    id: row.id,
    sessionId: row.session_id,
    requestGroupId: row.request_group_id || row.id,
    lineageRootRunId: row.lineage_root_run_id || row.request_group_id || row.id,
    runScope: row.run_scope ?? "root",
    ...(row.parent_run_id ? { parentRunId: row.parent_run_id } : {}),
    ...(row.handoff_summary ? { handoffSummary: row.handoff_summary } : {}),
    title: row.title,
    prompt: row.prompt,
    source: row.source as RootRun["source"],
    status: row.status,
    taskProfile: row.task_profile,
    ...(row.target_id ? { targetId: row.target_id } : {}),
    ...(row.target_label ? { targetLabel: row.target_label } : {}),
    ...(row.worker_runtime_kind ? { workerRuntimeKind: row.worker_runtime_kind } : {}),
    ...(row.worker_session_id ? { workerSessionId: row.worker_session_id } : {}),
    contextMode: row.context_mode ?? "full",
    delegationTurnCount: row.delegation_turn_count,
    maxDelegationTurns: row.max_delegation_turns,
    ...(row.runtime_manifest_id ? { runtimeManifestId: row.runtime_manifest_id } : {}),
    currentStepKey: row.current_step_key,
    currentStepIndex: row.current_step_index,
    totalSteps: row.total_steps,
    summary: row.summary,
    canCancel: Boolean(row.can_cancel),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    steps,
    recentEvents,
    ...(promptSourceSnapshot ? { promptSourceSnapshot } : {}),
  }
}

function buildSqlPlaceholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ")
}

function resolveLineageKey(row: Pick<RootRunRow, "id" | "request_group_id" | "lineage_root_run_id">): string {
  return row.lineage_root_run_id || row.request_group_id || row.id
}

function selectRunRowsForLineage(lineageKey: string): RootRunRow[] {
  return getDb()
    .prepare<[string], RootRunRow>(
      `SELECT *
       FROM root_runs
       WHERE COALESCE(lineage_root_run_id, request_group_id, id) = ?
       ORDER BY created_at ASC, updated_at ASC`,
    )
    .all(lineageKey)
}

function deleteRunRows(params: { runIds: string[]; requestGroupIds: string[] }): number {
  const { runIds, requestGroupIds } = params
  if (runIds.length === 0) return 0

  for (const runId of runIds) {
    const controller = activeRunControllers.get(runId)
    if (controller) controller.abort()
    clearActiveRunController(runId)
  }

  const db = getDb()
  const tx = db.transaction(() => {
    const runPlaceholders = buildSqlPlaceholders(runIds.length)
    db.prepare(`DELETE FROM messages WHERE root_run_id IN (${runPlaceholders})`).run(...runIds)
    db.prepare(`DELETE FROM channel_message_refs WHERE root_run_id IN (${runPlaceholders})`).run(...runIds)

    if (requestGroupIds.length > 0) {
      const requestGroupPlaceholders = buildSqlPlaceholders(requestGroupIds.length)
      db.prepare(`DELETE FROM channel_message_refs WHERE request_group_id IN (${requestGroupPlaceholders})`).run(...requestGroupIds)
    }

    db.prepare(`DELETE FROM root_runs WHERE id IN (${runPlaceholders})`).run(...runIds)
  })

  tx()
  return runIds.length
}

export function listRootRuns(limit = 50): RootRun[] {
  return getDb()
    .prepare<[number], RootRunRow>(
      `SELECT *
       FROM root_runs
       ORDER BY updated_at DESC
       LIMIT ?`,
    )
    .all(limit)
    .map(hydrateRun)
}

export function listActiveRootRuns(limit = 100): RootRun[] {
  return getDb()
    .prepare<[number], RootRunRow>(
      `SELECT *
       FROM root_runs
       WHERE status IN ('queued', 'running', 'awaiting_approval', 'awaiting_user')
       ORDER BY updated_at DESC
       LIMIT ?`,
    )
    .all(limit)
    .map(hydrateRun)
}

export function listActiveSessionRequestGroups(sessionId: string, excludingRunId?: string): RootRun[] {
  const rows = excludingRunId
    ? getDb()
        .prepare<[string, string], RootRunRow>(
          `SELECT *
           FROM root_runs
           WHERE session_id = ?
             AND id <> ?
             AND status IN ('queued', 'running', 'awaiting_approval', 'awaiting_user')
           ORDER BY updated_at DESC`,
        )
        .all(sessionId, excludingRunId)
    : getDb()
        .prepare<[string], RootRunRow>(
          `SELECT *
           FROM root_runs
           WHERE session_id = ?
             AND status IN ('queued', 'running', 'awaiting_approval', 'awaiting_user')
           ORDER BY updated_at DESC`,
        )
        .all(sessionId)

  const grouped = new Map<string, RootRun>()
  for (const run of rows.map(hydrateRun)) {
    if (!grouped.has(run.requestGroupId)) grouped.set(run.requestGroupId, run)
  }
  return [...grouped.values()]
}

export function listRunsForActiveRequestGroups(limitGroups = 100, limitRuns = 300): RootRun[] {
  const activeGroups = [...new Set(listActiveRootRuns(limitGroups).map((run) => run.requestGroupId))]
  if (activeGroups.length === 0) return []

  const placeholders = activeGroups.map(() => "?").join(", ")
  return getDb()
    .prepare<unknown[], RootRunRow>(
      `SELECT *
       FROM root_runs
       WHERE request_group_id IN (${placeholders})
       ORDER BY updated_at DESC
       LIMIT ?`,
    )
    .all(...activeGroups, limitRuns)
    .map(hydrateRun)
}

export function listRunsForRecentRequestGroups(limitGroups = 120, limitRuns = 1000): RootRun[] {
  const groups = getDb()
    .prepare<[number], { lineage_key: string | null; latest_updated: number }>(
      `SELECT COALESCE(lineage_root_run_id, request_group_id, id) AS lineage_key, MAX(updated_at) AS latest_updated
       FROM root_runs
       GROUP BY COALESCE(lineage_root_run_id, request_group_id, id)
       ORDER BY latest_updated DESC
       LIMIT ?`,
    )
    .all(limitGroups)
    .map((row) => row.lineage_key)
    .filter((value): value is string => typeof value === "string" && value.length > 0)

  if (groups.length === 0) return []

  const placeholders = groups.map(() => "?").join(", ")
  return getDb()
    .prepare<unknown[], RootRunRow>(
      `SELECT *
       FROM root_runs
       WHERE COALESCE(lineage_root_run_id, request_group_id, id) IN (${placeholders})
       ORDER BY updated_at DESC
       LIMIT ?`,
    )
    .all(...groups, limitRuns)
    .map(hydrateRun)
}

export function recoverActiveRunsOnStartup(): RootRun[] {
  const activeRuns = listActiveRootRuns(200)
  const recovered: RootRun[] = []
  const runSummaries: StartupRecoveryRunSummary[] = []

  for (const run of activeRuns) {
    const continuity = getTaskContinuity(run.lineageRootRunId)
    const recovery = classifyStartupRecovery(run, continuity)
    runSummaries.push({
      runId: run.id,
      lineageRootRunId: run.lineageRootRunId,
      previousStatus: run.status,
      recoveryStatus: recovery.status,
      ...(recovery.nextRunStatus ? { nextRunStatus: recovery.nextRunStatus } : {}),
      summary: recovery.summary,
      pendingApprovals: recovery.pendingApprovals ?? [],
      pendingDelivery: recovery.pendingDelivery ?? [],
      duplicateRisk: recovery.duplicateRisk,
    })
    upsertTaskContinuity({
      lineageRootRunId: run.lineageRootRunId,
      ...(run.parentRunId ? { parentRunId: run.parentRunId } : {}),
      ...(run.handoffSummary ? { handoffSummary: run.handoffSummary } : {}),
      lastGoodState: recovery.summary,
      ...(recovery.pendingApprovals ? { pendingApprovals: recovery.pendingApprovals } : {}),
      ...(recovery.pendingDelivery ? { pendingDelivery: recovery.pendingDelivery } : {}),
      status: recovery.status,
    })

    if (recovery.status === "delivered") {
      appendRunEvent(run.id, "프로세스 재시작 후 전달 완료 상태 복구")
      setRunStepStatus(run.id, "finalizing", "completed", recovery.summary)
      setRunStepStatus(run.id, "completed", "completed", recovery.summary)
      const updated = updateRunStatus(run.id, "completed", recovery.summary, false)
      if (updated) recovered.push(updated)
      continue
    }

    if (recovery.status === "awaiting_approval") {
      appendRunEvent(run.id, "프로세스 재시작 후 승인 대기 상태 복구")
      setRunStepStatus(run.id, "awaiting_approval", "running", recovery.summary)
      const updated = updateRunStatus(run.id, "awaiting_approval", recovery.summary, true)
      if (updated) recovered.push(updated)
      continue
    }

    if (recovery.status === "pending_delivery" || recovery.status === "awaiting_user") {
      appendRunEvent(run.id, "프로세스 재시작 후 사용자 확인 대기 상태 복구")
      setRunStepStatus(run.id, "awaiting_user", "running", recovery.summary)
      const updated = updateRunStatus(run.id, "awaiting_user", recovery.summary, true)
      if (updated) recovered.push(updated)
      continue
    }

    if (recovery.status === "interrupted") {
      appendRunEvent(run.id, "프로세스 재시작으로 자동 재실행 없이 중단 처리")
      setRunStepStatus(run.id, resolveInterruptStepKey(run), "cancelled", recovery.summary)
      const updated = updateRunStatus(run.id, "interrupted", recovery.summary, false)
      if (updated) recovered.push(updated)
    }
  }

  const interruptedSchedules = interruptUnfinishedScheduleRunsOnStartup()
  setLastStartupRecoverySummary(buildStartupRecoverySummary({
    runs: runSummaries,
    schedules: interruptedSchedules.map(summarizeInterruptedScheduleRun),
  }))

  return recovered
}

export function getRootRun(runId: string): RootRun | undefined {
  const row = getDb()
    .prepare<[string], RootRunRow>("SELECT * FROM root_runs WHERE id = ?")
    .get(runId)
  return row ? hydrateRun(row) : undefined
}

export function listRequestGroupRuns(requestGroupId: string): RootRun[] {
  return getDb()
    .prepare<[string], RootRunRow>(
      `SELECT *
       FROM root_runs
       WHERE request_group_id = ?
       ORDER BY created_at ASC, updated_at ASC`,
    )
    .all(requestGroupId)
    .map(hydrateRun)
}

export function hasActiveRequestGroupRuns(requestGroupId: string): boolean {
  return listRequestGroupRuns(requestGroupId).some((run) => ACTIVE_REQUEST_GROUP_STATUSES.includes(run.status))
}

export function isReusableRequestGroup(requestGroupId: string): boolean {
  const runs = listRequestGroupRuns(requestGroupId)
  if (runs.length === 0) return false
  return runs.some((run) => ACTIVE_REQUEST_GROUP_STATUSES.includes(run.status))
}

export function getRequestGroupDelegationTurnCount(requestGroupId: string): number {
  const row = getDb()
    .prepare<[string], { max_count: number | null }>(
      `SELECT MAX(delegation_turn_count) as max_count
       FROM root_runs
       WHERE request_group_id = ?`,
    )
    .get(requestGroupId)

  return row?.max_count ?? 0
}


export interface ReconnectRequestGroupSelection {
  best?: RootRun
  candidates: RootRun[]
  ambiguous: boolean
}

export function findReconnectRequestGroupSelection(sessionId: string, message: string): ReconnectRequestGroupSelection {
  const runs = getDb()
    .prepare<[string], RootRunRow>(
      `SELECT *
       FROM root_runs
       WHERE session_id = ?
       ORDER BY updated_at DESC
       LIMIT 80`,
    )
    .all(sessionId)
    .map(hydrateRun)

  const grouped = new Map<string, RootRun>()
  for (const run of runs) {
    if (!grouped.has(run.requestGroupId)) {
      grouped.set(run.requestGroupId, run)
    }
  }

  const reusableRuns = [...grouped.values()].filter((run) => isActiveRequestGroupStatus(run.status))
  const activeGroupCount = reusableRuns.filter((run) => isActiveRequestGroupStatus(run.status)).length
  const continuation = looksLikeContinuationMessage(message)

  const scored = reusableRuns
    .map((run, index) => ({ run, score: scoreReconnectCandidate(message, run, index) }))
    .filter((item) => item.score >= 18 || (continuation && activeGroupCount === 1 && item.score >= 14))
    .sort((a, b) => (b.score - a.score) || (b.run.updatedAt - a.run.updatedAt))

  const best = scored[0]?.run
  const secondScore = scored[1]?.score ?? -1
  const bestScore = scored[0]?.score ?? -1
  const ambiguous = Boolean(best && secondScore >= 18 && bestScore - secondScore < 12)

  return {
    ...(best ? { best } : {}),
    candidates: scored.slice(0, 3).map((item) => item.run),
    ambiguous,
  }
}

export function findReconnectRequestGroup(sessionId: string, message: string): RootRun | undefined {
  return findReconnectRequestGroupSelection(sessionId, message).best
}

function resolveInterruptStepKey(run: RootRun): string {
  if (DEFAULT_RUN_STEPS.some((step) => step.key === run.currentStepKey)) {
    return run.currentStepKey
  }

  switch (run.status) {
    case "awaiting_approval":
      return "awaiting_approval"
    case "awaiting_user":
      return "awaiting_user"
    case "queued":
      return "received"
    default:
      return "executing"
  }
}

export function findLatestWorkerSessionRun(
  requestGroupId: string,
  workerSessionId: string,
  excludingRunId?: string,
): RootRun | undefined {
  const runs = getDb()
    .prepare<[string, string], RootRunRow>(
      `SELECT *
       FROM root_runs
       WHERE request_group_id = ?
         AND worker_session_id = ?
       ORDER BY updated_at DESC
       LIMIT 40`,
    )
    .all(requestGroupId, workerSessionId)
    .map(hydrateRun)

  return runs.find((run) => (excludingRunId ? run.id !== excludingRunId : true))
}

export function interruptOrphanWorkerSessionRuns(params: {
  requestGroupId: string
  workerSessionId: string
  keepRunId: string
  summary?: string
}): RootRun[] {
  const summary = params.summary ?? "새 작업 세션이 시작되어 이전 실행을 정리했습니다."
  const runs = getDb()
    .prepare<[string, string, string], RootRunRow>(
      `SELECT *
       FROM root_runs
       WHERE request_group_id = ?
         AND worker_session_id = ?
         AND id != ?
       ORDER BY updated_at DESC`,
    )
    .all(params.requestGroupId, params.workerSessionId, params.keepRunId)
    .map(hydrateRun)
    .filter((run) => ACTIVE_WORKER_SESSION_STATUSES.includes(run.status))

  const interrupted: RootRun[] = []
  for (const run of runs) {
    const controller = activeRunControllers.get(run.id)
    if (controller) {
      controller.abort()
      clearActiveRunController(run.id)
    }
    appendRunEvent(run.id, "새 작업 세션이 연결되어 이전 실행을 중단합니다.")
    setRunStepStatus(run.id, resolveInterruptStepKey(run), "cancelled", summary)
    const updated = updateRunStatus(run.id, "interrupted", summary, false)
    interrupted.push(updated ?? run)
  }

  return interrupted
}

export function createRootRun(params: {
  id: string
  sessionId: string
  requestGroupId?: string
  lineageRootRunId?: string
  parentRunId?: string
  runScope?: RunScope
  handoffSummary?: string
  prompt: string
  source: RootRun["source"]
  taskProfile?: TaskProfile
  targetId?: string
  targetLabel?: string
  workerRuntimeKind?: string
  workerSessionId?: string
  contextMode?: RunContextMode
  promptSourceSnapshot?: Record<string, unknown>
  maxDelegationTurns?: number
  delegationTurnCount?: number
}): RootRun {
  const now = Date.now()
  const totalSteps = DEFAULT_RUN_STEPS.length
  const taskProfile = params.taskProfile ?? "general_chat"
  const summary = params.prompt.trim()
  const title = truncateTitle(params.prompt)
  const runtimeManifestId = (() => {
    const current = getLastRuntimeManifest()
    if (current) return current.id
    try {
      return refreshRuntimeManifest({ includeEnvironment: false, includeReleasePackage: false }).id
    } catch {
      return null
    }
  })()
  const db = getDb()
  const identifiers = resolveRunFlowIdentifiers({
    runId: params.id,
    sessionId: params.sessionId,
    ...(params.requestGroupId ? { requestGroupId: params.requestGroupId } : {}),
    ...(params.lineageRootRunId ? { lineageRootRunId: params.lineageRootRunId } : {}),
    ...(params.parentRunId ? { parentRunId: params.parentRunId } : {}),
    ...(params.runScope ? { runScope: params.runScope } : {}),
  })

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO root_runs
       (id, session_id, request_group_id, lineage_root_run_id, parent_run_id, run_scope, handoff_summary,
        title, prompt, source, status, task_profile, target_id, target_label,
        worker_runtime_kind, worker_session_id, context_mode,
        delegation_turn_count, max_delegation_turns, current_step_key, current_step_index,
        total_steps, summary, can_cancel, prompt_source_snapshot, runtime_manifest_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      params.id,
      params.sessionId,
      identifiers.requestGroupId,
      identifiers.lineageRootRunId,
      identifiers.parentRunId ?? null,
      identifiers.runScope,
      params.handoffSummary ?? null,
      title,
      params.prompt,
      params.source,
      "queued",
      taskProfile,
      params.targetId ?? null,
      params.targetLabel ?? null,
      params.workerRuntimeKind ?? null,
      params.workerSessionId ?? null,
      params.contextMode ?? "full",
      params.delegationTurnCount ?? 0,
      params.maxDelegationTurns ?? 5,
      "received",
      1,
      totalSteps,
      summary,
      1,
      params.promptSourceSnapshot ? JSON.stringify(params.promptSourceSnapshot) : null,
      runtimeManifestId,
      now,
      now,
    )

    const insertStep = db.prepare(
      `INSERT INTO run_steps
       (id, run_id, step_key, title, step_index, status, summary, started_at, finished_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )

    DEFAULT_RUN_STEPS.forEach((step, index) => {
      insertStep.run(
        crypto.randomUUID(),
        params.id,
        step.key,
        step.title,
        index + 1,
        index === 0 ? "running" : "pending",
        index === 0 ? "요청을 받았습니다." : "",
        index === 0 ? now : null,
        null,
      )
    })

    db.prepare(
      `INSERT INTO run_events (id, run_id, at, label)
       VALUES (?, ?, ?, ?)`,
    ).run(crypto.randomUUID(), params.id, now, "요청 수신")
  })

  tx()

  const run = getRootRun(params.id)!
  recordMessageLedgerEvent({
    runId: params.id,
    requestGroupId: run.requestGroupId,
    sessionKey: params.sessionId,
    channel: params.source,
    eventKind: "ingress_received",
    idempotencyKey: `ingress:${params.id}`,
    status: "received",
    summary: "요청을 수신했습니다.",
    detail: {
      source: params.source,
      promptLength: params.prompt.length,
      taskProfile,
    },
  })
  eventBus.emit("run.created", { run })
  eventBus.emit("run.progress", { run })
  return run
}

export function appendRunEvent(runId: string, label: string): void {
  const at = Date.now()
  getDb()
    .prepare(`INSERT INTO run_events (id, run_id, at, label) VALUES (?, ?, ?, ?)`)
    .run(crypto.randomUUID(), runId, at, label)
}

export function updateRunSummary(runId: string, summary: string): RootRun | undefined {
  const now = Date.now()
  getDb()
    .prepare(`UPDATE root_runs SET summary = ?, updated_at = ? WHERE id = ?`)
    .run(summary, now, runId)
  const run = getRootRun(runId)
  if (run) {
    eventBus.emit("run.summary", { runId, summary: run.summary, run })
    eventBus.emit("run.progress", { run })
  }
  return run
}

export function updateRunStatus(runId: string, status: RunStatus, summary?: string, canCancel?: boolean): RootRun | undefined {
  const now = Date.now()
  const current = getRootRun(runId)
  if (!current) return undefined
  let nextStatus = status
  let nextSummary = summary ?? current.summary
  let nextCanCancel = canCancel ?? current.canCancel

  if ((status === "failed" || status === "cancelled" || status === "interrupted") && current.status !== "completed") {
    const finalizer = finalizeDeliveryForRun({
      runId,
      requestedStatus: status,
      ...(summary !== undefined ? { requestedSummary: summary } : {}),
    })
    if (finalizer.shouldProtectDeliveredAnswer && finalizer.runStatus) {
      nextStatus = finalizer.runStatus
      nextSummary = finalizer.summary ?? nextSummary
      nextCanCancel = false
      appendRunEvent(runId, `delivery_finalizer:${finalizer.outcome}`)
    }
  }

  const transition = canTransitionRunStatus(current.status, nextStatus)
  if (!transition.allowed) {
    appendRunEvent(runId, `status_transition_blocked:${transition.reason}`)
    return current
  }

  getDb()
    .prepare(`UPDATE root_runs SET status = ?, summary = ?, can_cancel = ?, updated_at = ? WHERE id = ?`)
    .run(nextStatus, nextSummary, nextCanCancel ? 1 : 0, now, runId)

  const run = getRootRun(runId)
  if (run) {
    eventBus.emit("run.status", { run })
    eventBus.emit("run.progress", { run })
    if (nextStatus === "completed") eventBus.emit("run.completed", { run })
    if (nextStatus === "failed") eventBus.emit("run.failed", { run })
    if (nextStatus === "cancelled") eventBus.emit("run.cancelled", { run })
  }
  return run
}

export function incrementDelegationTurnCount(runId: string, summary?: string): RootRun | undefined {
  const now = Date.now()
  const current = getRootRun(runId)
  if (!current) return undefined

  const nextCount = current.delegationTurnCount + 1

  getDb()
    .prepare(
      `UPDATE root_runs
       SET delegation_turn_count = CASE
             WHEN delegation_turn_count < ? THEN ?
             ELSE delegation_turn_count
           END,
           summary = CASE WHEN id = ? THEN ? ELSE summary END,
           updated_at = CASE WHEN id = ? THEN ? ELSE updated_at END
       WHERE request_group_id = ?`,
    )
    .run(
      nextCount,
      nextCount,
      runId,
      summary ?? current.summary,
      runId,
      now,
      current.requestGroupId,
    )

  const runs = listRequestGroupRuns(current.requestGroupId)
  for (const run of runs) {
    eventBus.emit("run.progress", { run })
  }

  return runs.find((run) => run.id === runId)
}

export function updateActiveRunsMaxDelegationTurns(maxDelegationTurns: number): RootRun[] {
  const now = Date.now()
  getDb()
    .prepare(
      `UPDATE root_runs
       SET max_delegation_turns = ?, updated_at = ?
       WHERE status IN ('queued', 'running', 'awaiting_approval', 'awaiting_user')`,
    )
    .run(maxDelegationTurns, now)

  const runs = getDb()
    .prepare<[], RootRunRow>(
      `SELECT *
       FROM root_runs
       WHERE status IN ('queued', 'running', 'awaiting_approval', 'awaiting_user')
       ORDER BY updated_at DESC`,
    )
    .all()
    .map(hydrateRun)

  for (const run of runs) {
    eventBus.emit("run.progress", { run })
  }

  return runs
}

export function setRunStepStatus(runId: string, stepKey: string, status: RunStepStatus, summary: string): RootRun | undefined {
  const now = Date.now()
  const step = DEFAULT_RUN_STEPS.find((item) => item.key === stepKey)
  if (!step) return undefined

  const currentRow = getDb()
    .prepare<[string, string], RunStepRow>(
      `SELECT run_id, step_key, title, step_index, status, summary, started_at, finished_at
       FROM run_steps WHERE run_id = ? AND step_key = ?`,
    )
    .get(runId, stepKey)
  if (!currentRow) return undefined

  const startedAt = currentRow.started_at ?? now
  const finishedAt = status === "running" ? null : now
  getDb()
    .prepare(
      `UPDATE run_steps
       SET status = ?, summary = ?, started_at = ?, finished_at = ?
       WHERE run_id = ? AND step_key = ?`,
    )
    .run(status, summary, startedAt, finishedAt, runId, stepKey)

  getDb()
    .prepare(
      `UPDATE root_runs
       SET current_step_key = ?, current_step_index = ?, summary = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(stepKey, currentRow.step_index, summary, now, runId)

  const run = getRootRun(runId)
  if (run) {
    const updatedStep = run.steps.find((item) => item.key === stepKey)
    if (updatedStep) {
      if (status === "running") eventBus.emit("run.step.started", { runId, step: updatedStep, run })
      else eventBus.emit("run.step.completed", { runId, step: updatedStep, run })
    }
    eventBus.emit("run.progress", { run })
  }
  return run
}

export function bindActiveRunController(runId: string, controller: AbortController): void {
  activeRunControllers.set(runId, controller)
}

export function clearActiveRunController(runId: string): void {
  activeRunControllers.delete(runId)
}

interface CancelRootRunOptions {
  eventLabel?: string
  stepSummary?: string
  runSummary?: string
}

export function cancelRootRun(runId: string, options: CancelRootRunOptions = {}): RootRun | undefined {
  const current = getRootRun(runId)
  if (!current) return undefined

  const activeRuns = listRequestGroupRuns(current.requestGroupId).filter((run) =>
    ACTIVE_REQUEST_GROUP_STATUSES.includes(run.status) || activeRunControllers.has(run.id),
  )
  if (activeRuns.length === 0) return undefined

  for (const run of activeRuns) {
    appendRunEvent(run.id, options.eventLabel ?? "취소 요청")
    eventBus.emit("run.cancel.requested", { runId: run.id })

    const controller = activeRunControllers.get(run.id)
    if (controller) {
      controller.abort()
      clearActiveRunController(run.id)
    }

    const stepKey = resolveInterruptStepKey(run)
    setRunStepStatus(run.id, stepKey, "cancelled", options.stepSummary ?? "사용자가 실행 취소를 요청했습니다.")
    updateRunStatus(run.id, "cancelled", options.runSummary ?? "사용자가 실행을 취소했습니다.", false)
  }

  return getRootRun(runId) ?? current
}

export function cleanupStaleRunStates(options: { staleMs?: number; now?: number } = {}): StaleRunCleanupResult {
  const now = options.now ?? Date.now()
  const thresholdMs = Math.max(60_000, options.staleMs ?? DEFAULT_STALE_RUN_CLEANUP_MS)
  const cutoff = now - thresholdMs
  const rows = getDb()
    .prepare<[number], RootRunRow>(
      `SELECT *
       FROM root_runs
       WHERE status IN ('queued', 'running', 'awaiting_approval', 'awaiting_user')
         AND updated_at <= ?
       ORDER BY updated_at ASC`,
    )
    .all(cutoff)

  const cleanedRunIds: string[] = []
  const skippedRunIds: string[] = []

  for (const row of rows) {
    const run = hydrateRun(row)
    const controller = activeRunControllers.get(run.id)
    if (controller) {
      controller.abort()
      clearActiveRunController(run.id)
    }

    const summary = staleCleanupSummary(run)
    appendRunEvent(run.id, "운영자가 오래된 대기 상태를 정리했습니다.")
    setRunStepStatus(run.id, resolveInterruptStepKey(run), "cancelled", summary)
    const updated = updateRunStatus(run.id, "interrupted", summary, false)

    if (updated?.status === "interrupted") {
      cleanedRunIds.push(run.id)
      insertDiagnosticEvent({
        kind: "stale_run_cleanup",
        summary,
        runId: run.id,
        sessionId: run.sessionId,
        requestGroupId: run.requestGroupId,
        detail: {
          previousStatus: run.status,
          ageMs: now - run.updatedAt,
          thresholdMs,
        },
      })
    } else {
      skippedRunIds.push(run.id)
    }
  }

  insertAuditLog({
    timestamp: now,
    session_id: null,
    source: "system",
    tool_name: "stale_run_cleanup",
    params: JSON.stringify({ thresholdMs }),
    output: JSON.stringify({ cleanedRunIds, skippedRunIds }),
    result: skippedRunIds.length === 0 ? "success" : "partial",
    duration_ms: 0,
    approval_required: 1,
    approved_by: "webui",
  })

  return {
    cleanedRunCount: cleanedRunIds.length,
    skippedRunCount: skippedRunIds.length,
    cleanedRunIds,
    skippedRunIds,
    thresholdMs,
  }
}

function staleCleanupSummary(run: RootRun): string {
  switch (run.status) {
    case "awaiting_approval":
      return "오래된 승인 대기 상태를 운영 정리했습니다. 작업은 자동 재실행하지 않습니다."
    case "awaiting_user":
      return "오래된 사용자 확인 또는 결과 전달 대기 상태를 운영 정리했습니다. 작업은 자동 재전송하지 않습니다."
    case "queued":
      return "오래된 실행 대기 상태를 운영 정리했습니다. 작업은 자동 실행하지 않습니다."
    case "running":
      return "오래된 실행 중 상태를 운영 정리했습니다. 작업은 자동 재실행하지 않습니다."
    default:
      return "오래된 실행 상태를 운영 정리했습니다."
  }
}

export function deleteRunHistory(runId: string): { deletedRunCount: number; blockedRunCount?: number } | undefined {
  const target = getDb()
    .prepare<[string], RootRunRow>("SELECT * FROM root_runs WHERE id = ?")
    .get(runId)
  if (!target) return undefined

  const lineageKey = resolveLineageKey(target)
  const rows = selectRunRowsForLineage(lineageKey)
  const activeRows = rows.filter((row) => ACTIVE_REQUEST_GROUP_STATUSES.includes(row.status) || activeRunControllers.has(row.id))
  if (activeRows.length > 0) {
    insertDiagnosticEvent({
      kind: "active_run_delete_blocked",
      summary: "진행 중인 실행 기록 삭제 요청을 차단했습니다.",
      runId,
      requestGroupId: target.request_group_id ?? target.id,
      sessionId: target.session_id,
      detail: {
        lineageKey,
        blockedRunIds: activeRows.map((row) => row.id),
      },
    })
    return { deletedRunCount: 0, blockedRunCount: activeRows.length }
  }
  const runIds = rows.map((row) => row.id)
  const requestGroupIds = [...new Set(rows.map((row) => row.request_group_id).filter((value): value is string => typeof value === "string" && value.length > 0))]

  return {
    deletedRunCount: deleteRunRows({ runIds, requestGroupIds }),
  }
}

export function clearHistoricalRunHistory(): { deletedRunCount: number } {
  const rows = getDb()
    .prepare<[], RootRunRow>(
      `SELECT *
       FROM root_runs
       WHERE status IN ('completed', 'failed', 'cancelled', 'interrupted')
       ORDER BY updated_at DESC`,
    )
    .all()

  if (rows.length === 0) {
    return { deletedRunCount: 0 }
  }

  const runIds = rows.map((row) => row.id)
  const requestGroupIds = [...new Set(rows.map((row) => row.request_group_id).filter((value): value is string => typeof value === "string" && value.length > 0))]

  return {
    deletedRunCount: deleteRunRows({ runIds, requestGroupIds }),
  }
}
