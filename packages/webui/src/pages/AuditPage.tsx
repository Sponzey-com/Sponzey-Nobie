import { useEffect, useMemo, useState } from "react"
import { api, type AuditEvent } from "../api/client"
import { EmptyState } from "../components/EmptyState"
import { ErrorState } from "../components/ErrorState"
import { FeatureGate } from "../components/FeatureGate"
import { useUiI18n } from "../lib/ui-i18n"

type AuditStatusFilter = "" | "success" | "failed" | "denied" | "partial" | "info" | "blocked" | "pending"
type AuditKindFilter = "" | AuditEvent["kind"]

function formatTime(value: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value))
}

function stringifyMeta(value: unknown): string {
  if (value == null) return ""
  if (typeof value === "string") return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function downloadText(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function statusClass(status: string): string {
  if (status === "success" || status === "info") return "border-emerald-200 bg-emerald-50 text-emerald-700"
  if (status === "failed" || status === "denied" || status === "blocked") return "border-red-200 bg-red-50 text-red-700"
  if (status === "pending" || status === "partial") return "border-amber-200 bg-amber-50 text-amber-700"
  return "border-stone-200 bg-stone-50 text-stone-600"
}

export function AuditPage() {
  const { text } = useUiI18n()
  const [events, setEvents] = useState<AuditEvent[]>([])
  const [selected, setSelected] = useState<AuditEvent | null>(null)
  const [status, setStatus] = useState<AuditStatusFilter>("")
  const [kind, setKind] = useState<AuditKindFilter>("")
  const [channel, setChannel] = useState("")
  const [toolName, setToolName] = useState("")
  const [runId, setRunId] = useState("")
  const [query, setQuery] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [total, setTotal] = useState(0)
  const [cleanupMessage, setCleanupMessage] = useState<string | null>(null)

  const selectedMeta = useMemo(() => {
    if (!selected) return ""
    return stringifyMeta({
      params: selected.params,
      detail: selected.detail,
      output: selected.output,
    })
  }, [selected])

  async function load(): Promise<void> {
    setLoading(true)
    setError(null)
    try {
      const response = await api.audit({
        limit: 100,
        ...(status ? { status } : {}),
        ...(kind ? { kind } : {}),
        ...(channel.trim() ? { channel: channel.trim() } : {}),
        ...(toolName.trim() ? { toolName: toolName.trim() } : {}),
        ...(runId.trim() ? { runId: runId.trim() } : {}),
        ...(query.trim() ? { q: query.trim() } : {}),
      })
      setEvents(response.items)
      setTotal(response.total)
      setSelected((current) => current && response.items.some((item) => item.id === current.id) ? current : response.items[0] ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  async function exportSelected(): Promise<void> {
    const targetRunId = selected?.runId ?? runId.trim()
    if (!targetRunId) return
    const response = await api.auditExport(targetRunId, "markdown")
    downloadText(`audit-${targetRunId}.md`, response.content)
  }

  async function cleanupOldAudit(): Promise<void> {
    const ok = window.confirm(text("30일보다 오래된 감사/진단 로그를 정리할까요? 실행 타임라인과 아티팩트 기록은 유지됩니다.", "Clean audit and diagnostic logs older than 30 days? Run timelines and artifact metadata are kept."))
    if (!ok) return
    const before = Date.now() - 30 * 24 * 60 * 60 * 1000
    const response = await api.cleanupAudit({ before })
    setCleanupMessage(text(
      `정리 완료: 감사 ${response.deleted.auditLogs}건, 진단 ${response.deleted.diagnosticEvents}건`,
      `Cleanup complete: ${response.deleted.auditLogs} audit logs, ${response.deleted.diagnosticEvents} diagnostic events`,
    ))
    await load()
  }

  return (
    <div className="h-full overflow-y-auto bg-stone-100 p-6">
      <div className="rounded-[1.75rem] border border-stone-200 bg-white p-6">
        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">Audit</div>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-stone-900">{text("감사 로그", "Audit logs")}</h1>
            <p className="mt-2 max-w-3xl text-sm leading-7 text-stone-600">
              {text(
                "도구 실행, 승인, 실행 이벤트, 진단, 아티팩트 전달 흐름을 하나의 타임라인으로 확인합니다.",
                "Inspect tool calls, approvals, run events, diagnostics, and artifact delivery in one timeline.",
              )}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="rounded-full border border-stone-200 px-4 py-2 text-sm font-semibold text-stone-700 hover:bg-stone-50" onClick={() => void load()} disabled={loading}>
              {loading ? text("불러오는 중", "Loading") : text("새로고침", "Refresh")}
            </button>
            <button className="rounded-full border border-stone-200 px-4 py-2 text-sm font-semibold text-stone-700 hover:bg-stone-50 disabled:opacity-40" onClick={() => void exportSelected()} disabled={!selected?.runId && !runId.trim()}>
              {text("타임라인 내보내기", "Export timeline")}
            </button>
            <button className="rounded-full border border-red-200 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50" onClick={() => void cleanupOldAudit()}>
              {text("오래된 로그 정리", "Clean old logs")}
            </button>
          </div>
        </div>
        {cleanupMessage ? <div className="mt-4 rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{cleanupMessage}</div> : null}
      </div>

      <FeatureGate capabilityKey="audit.viewer" title={text("감사 로그", "Audit Logs")}>
        <div className="mt-6 grid gap-4 rounded-[1.75rem] border border-stone-200 bg-white p-4 lg:grid-cols-6">
          <input className="rounded-2xl border border-stone-200 px-4 py-3 text-sm outline-none focus:border-stone-400" placeholder={text("검색어", "Search")} value={query} onChange={(event) => setQuery(event.target.value)} />
          <input className="rounded-2xl border border-stone-200 px-4 py-3 text-sm outline-none focus:border-stone-400" placeholder="run id" value={runId} onChange={(event) => setRunId(event.target.value)} />
          <input className="rounded-2xl border border-stone-200 px-4 py-3 text-sm outline-none focus:border-stone-400" placeholder={text("도구명", "Tool name")} value={toolName} onChange={(event) => setToolName(event.target.value)} />
          <input className="rounded-2xl border border-stone-200 px-4 py-3 text-sm outline-none focus:border-stone-400" placeholder={text("채널", "Channel")} value={channel} onChange={(event) => setChannel(event.target.value)} />
          <select className="rounded-2xl border border-stone-200 px-4 py-3 text-sm outline-none focus:border-stone-400" value={kind} onChange={(event) => setKind(event.target.value as AuditKindFilter)}>
            <option value="">{text("모든 유형", "All kinds")}</option>
            <option value="tool_call">tool_call</option>
            <option value="diagnostic">diagnostic</option>
            <option value="run_event">run_event</option>
            <option value="artifact">artifact</option>
            <option value="delivery">delivery</option>
          </select>
          <select className="rounded-2xl border border-stone-200 px-4 py-3 text-sm outline-none focus:border-stone-400" value={status} onChange={(event) => setStatus(event.target.value as AuditStatusFilter)}>
            <option value="">{text("모든 상태", "All statuses")}</option>
            <option value="success">success</option>
            <option value="failed">failed</option>
            <option value="denied">denied</option>
            <option value="partial">partial</option>
            <option value="info">info</option>
            <option value="blocked">blocked</option>
            <option value="pending">pending</option>
          </select>
          <button className="rounded-2xl bg-stone-900 px-4 py-3 text-sm font-semibold text-white lg:col-span-6" onClick={() => void load()}>
            {text("필터 적용", "Apply filters")}
          </button>
        </div>

        {error ? <div className="mt-6"><ErrorState title={text("감사 로그를 불러오지 못했습니다", "Failed to load audit logs")} description={error} /></div> : null}

        <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)]">
          <div className="rounded-[1.75rem] border border-stone-200 bg-white p-4">
            <div className="mb-3 flex items-center justify-between text-sm text-stone-500">
              <span>{text(`총 ${total}건`, `${total} events`)}</span>
              <span>{loading ? text("갱신 중", "Refreshing") : text("최근 100건", "Latest 100")}</span>
            </div>
            {events.length === 0 && !loading ? (
              <EmptyState title={text("표시할 감사 로그가 없습니다", "No audit logs to show")} description={text("필터를 줄이거나 실행 후 다시 확인하세요.", "Relax filters or try again after a run.")} />
            ) : (
              <div className="space-y-3">
                {events.map((event) => (
                  <button key={event.id} className={`w-full rounded-3xl border p-4 text-left transition ${selected?.id === event.id ? "border-stone-900 bg-stone-50" : "border-stone-200 bg-white hover:bg-stone-50"}`} onClick={() => setSelected(event)}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${statusClass(event.status)}`}>{event.status}</span>
                      <span className="rounded-full bg-stone-100 px-2.5 py-1 text-xs font-semibold text-stone-600">{event.kind}</span>
                      {event.channel ? <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">{event.channel}</span> : null}
                      <span className="ml-auto text-xs text-stone-500">{formatTime(event.at)}</span>
                    </div>
                    <div className="mt-3 text-sm font-semibold text-stone-900">{event.summary}</div>
                    <div className="mt-2 flex flex-wrap gap-2 text-xs text-stone-500">
                      {event.toolName ? <span>tool={event.toolName}</span> : null}
                      {event.runId ? <span>run={event.runId}</span> : null}
                      {event.requestGroupId ? <span>group={event.requestGroupId}</span> : null}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-[1.75rem] border border-stone-200 bg-white p-5">
            {selected ? (
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">Selected Event</div>
                <h2 className="mt-2 text-lg font-semibold text-stone-900">{selected.summary}</h2>
                <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <dt className="text-stone-500">{text("시각", "Time")}</dt><dd className="text-right text-stone-800">{formatTime(selected.at)}</dd>
                  <dt className="text-stone-500">Status</dt><dd className="text-right text-stone-800">{selected.status}</dd>
                  <dt className="text-stone-500">Kind</dt><dd className="text-right text-stone-800">{selected.kind}</dd>
                  <dt className="text-stone-500">Channel</dt><dd className="text-right text-stone-800">{selected.channel ?? "-"}</dd>
                  <dt className="text-stone-500">Tool</dt><dd className="text-right text-stone-800">{selected.toolName ?? "-"}</dd>
                  <dt className="text-stone-500">Duration</dt><dd className="text-right text-stone-800">{selected.durationMs != null ? `${selected.durationMs}ms` : "-"}</dd>
                  <dt className="text-stone-500">Approval</dt><dd className="text-right text-stone-800">{selected.approvalRequired ? selected.approvedBy ?? "required" : "-"}</dd>
                  <dt className="text-stone-500">Reason</dt><dd className="text-right text-stone-800">{selected.stopReason ?? selected.errorCode ?? "-"}</dd>
                </dl>
                <pre className="mt-5 max-h-[420px] overflow-auto rounded-3xl bg-stone-950 p-4 text-xs leading-6 text-stone-100">{selectedMeta || "{}"}</pre>
              </div>
            ) : (
              <EmptyState title={text("선택된 항목 없음", "No event selected")} description={text("왼쪽 목록에서 이벤트를 선택하세요.", "Select an event from the list.")} />
            )}
          </div>
        </div>
      </FeatureGate>
    </div>
  )
}
