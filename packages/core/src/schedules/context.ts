import { getDb, getSchedule, getScheduleRuns } from "../db/index.js"

interface ScheduleMemoryEntryRow {
  schedule_id: string
  session_id: string | null
  request_group_id: string | null
  title: string | null
  prompt: string
  cron_expression: string | null
  next_run_at: number | null
  enabled: number
  metadata_json: string | null
  updated_at: number
}

function getScheduleMemoryEntry(scheduleId: string): ScheduleMemoryEntryRow | undefined {
  return getDb()
    .prepare<[string], ScheduleMemoryEntryRow>(
      `SELECT schedule_id, session_id, request_group_id, title, prompt, cron_expression,
              next_run_at, enabled, metadata_json, updated_at
       FROM schedule_entries
       WHERE schedule_id = ?
       LIMIT 1`,
    )
    .get(scheduleId)
}

function formatDate(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value)
    ? new Date(value).toISOString()
    : "unknown"
}

function normalizeLine(value: string | null | undefined, maxChars = 360): string {
  const normalized = value?.replace(/\s+/gu, " ").trim() ?? ""
  if (normalized.length <= maxChars) return normalized
  return `${normalized.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`
}

export function buildScheduleMemoryContext(input: {
  scheduleId: string
  maxRuns?: number
}): string {
  const scheduleId = input.scheduleId.trim()
  if (!scheduleId) return ""

  const entry = getScheduleMemoryEntry(scheduleId)
  const schedule = getSchedule(scheduleId)
  if (!entry && !schedule) return ""

  const maxRuns = Math.max(0, Math.min(5, input.maxRuns ?? 3))
  const runs = maxRuns > 0 ? getScheduleRuns(scheduleId, maxRuns, 0) : []
  const title = entry?.title || schedule?.name || scheduleId
  const prompt = entry?.prompt || schedule?.prompt || ""
  const cron = entry?.cron_expression || schedule?.cron_expression || null
  const timezone = schedule?.timezone ?? null
  const enabled = entry ? entry.enabled === 1 : schedule?.enabled === 1
  const nextRunAt = entry?.next_run_at ?? schedule?.next_run_at ?? null
  const target = schedule
    ? `${schedule.target_channel}${schedule.target_session_id ? `:${schedule.target_session_id}` : ""}`
    : "unknown"

  const lines = [
    `[예약 작업 기억]`,
    `- scheduleId: ${scheduleId}`,
    `- 이름: ${normalizeLine(title, 160)}`,
    `- 활성 상태: ${enabled ? "enabled" : "disabled"}`,
    cron ? `- 반복 규칙: ${cron}` : "",
    timezone ? `- 시간대: ${timezone}` : "",
    `- 다음 실행: ${formatDate(nextRunAt)}`,
    `- 전달 대상: ${target}`,
    prompt ? `- 실행 내용: ${normalizeLine(prompt)}` : "",
  ].filter(Boolean)

  if (runs.length > 0) {
    lines.push("- 최근 실행 이력:")
    for (const run of runs) {
      const status = run.success === 1 ? "success" : run.success === 0 ? "failure" : "running"
      const summary = normalizeLine(run.summary || run.error || "", 220)
      lines.push(`  - ${status} at ${formatDate(run.started_at)}${summary ? `: ${summary}` : ""}`)
    }
  }

  return lines.join("\n")
}
