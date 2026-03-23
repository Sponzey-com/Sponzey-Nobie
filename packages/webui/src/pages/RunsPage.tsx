import { useEffect } from "react"
import { EmptyState } from "../components/EmptyState"
import { RunEventFeed } from "../components/runs/RunEventFeed"
import { RunStatusCard, type RunStatusTreeNode } from "../components/runs/RunStatusCard"
import { RunStepTimeline } from "../components/runs/RunStepTimeline"
import { RunSummaryPanel } from "../components/runs/RunSummaryPanel"
import { useUiI18n } from "../lib/ui-i18n"
import { useRunsStore } from "../stores/runs"

type RunItem = ReturnType<typeof useRunsStore.getState>["runs"][number]
type TextFn = (ko: string, en: string) => string

function extractPromptField(prompt: string, field: string): string | undefined {
  const match = prompt.match(new RegExp(`^${field}:\s*(.+)$`, "im"))
  return match?.[1]?.trim() || undefined
}

function truncateText(value: string, maxLength = 88) {
  const normalized = value.replace(/\s+/g, " ").trim()
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength - 1)}…`
}

function describeChildRun(run: RunItem, text: TextFn) {
  const prompt = run.prompt.trim()
  if (prompt.startsWith("[Task Intake Bridge]")) return text("작업 분해 및 대상 선택", "Task intake and target selection")
  if (prompt.startsWith("[Scheduled Task]")) {
    return extractPromptField(prompt, "Task") || extractPromptField(prompt, "Goal") || text("예약 작업 실행", "Scheduled task execution")
  }
  if (prompt.startsWith("[Approval Granted Continuation]")) return text("승인 후 작업 계속 진행", "Continue after approval")
  if (prompt.startsWith("[Filesystem Verification]")) return text("결과 검증", "Result verification")
  if (prompt.startsWith("[Filesystem Execution Required]")) return text("실제 파일·폴더 작업 재시도", "Retry real file or folder work")
  if (prompt.startsWith("[Truncated Output Recovery]")) return text("중간 절단 복구 재시도", "Retry truncated output recovery")
  if (/검증|verify|verification|존재 여부 확인|실제 파일/i.test(run.summary)) return text("결과 검증", "Result verification")
  if (run.status === "interrupted" || run.status === "cancelled") return text("이전 작업 정리", "Clean up previous task")

  switch (run.taskProfile) {
    case "coding": return text("코드·파일 작업", "Code and file work")
    case "research": return text("리서치 작업", "Research task")
    case "review": return text("검증 작업", "Review task")
    case "operations":
    case "private_local": return text("로컬 작업", "Local task")
    case "summarization": return text("요약 작업", "Summarization task")
    case "planning": return text("계획 작업", "Planning task")
    default: return run.title
  }
}

function buildRunTreeNodes(groupRuns: RunItem[], text: TextFn): RunStatusTreeNode[] {
  const ordered = [...groupRuns].sort((a, b) => a.createdAt - b.createdAt)
  const rootRun = ordered[0]
  return ordered.map((run, index) => ({
    id: run.id,
    label: index === 0 ? text("사용자 요청", "User request") : describeChildRun(run, text),
    summary: index === 0 ? truncateText(rootRun.prompt, 120) : truncateText(run.summary || run.prompt, 120),
    status: run.status,
    isRoot: index === 0,
  }))
}

function buildGroupTimeline(groupRuns: RunItem[], text: TextFn) {
  const ordered = [...groupRuns].sort((a, b) => a.createdAt - b.createdAt)
  const labelByRunId = new Map(
    ordered.map((run, index) => [run.id, index === 0 ? text("사용자 요청", "User request") : describeChildRun(run, text)]),
  )
  const items = ordered.flatMap((run) =>
    run.recentEvents.map((event) => ({
      id: event.id,
      at: event.at,
      label: event.label,
      runLabel: labelByRunId.get(run.id) ?? run.title,
    })),
  )
  const deduped = new Map(items.map((item) => [item.id, item]))
  return [...deduped.values()].sort((a, b) => b.at - a.at).slice(0, 20)
}

function computeGroupStatus(groupRuns: RunItem[]): RunItem["status"] {
  const statuses = groupRuns.map((run) => run.status)
  if (statuses.includes("awaiting_approval")) return "awaiting_approval"
  if (statuses.includes("awaiting_user")) return "awaiting_user"
  if (statuses.includes("running")) return "running"
  if (statuses.includes("queued")) return "queued"
  if (statuses.includes("failed")) return "failed"
  if (statuses.every((status) => status === "completed")) return "completed"
  if (statuses.includes("interrupted")) return "interrupted"
  if (statuses.includes("cancelled")) return "cancelled"
  return groupRuns[0]?.status ?? "queued"
}

function computeGroupSummary(groupRuns: RunItem[]): string {
  const activeRun = groupRuns
    .filter((run) => ["queued", "running", "awaiting_approval", "awaiting_user"].includes(run.status))
    .sort((a, b) => b.updatedAt - a.updatedAt)[0]
  if (activeRun?.summary?.trim()) return activeRun.summary.trim()
  const latestRun = [...groupRuns].sort((a, b) => b.updatedAt - a.updatedAt)[0]
  return latestRun?.summary?.trim() || latestRun?.prompt?.trim() || ""
}

function buildRunMonitorCards(allRuns: RunItem[], text: TextFn) {
  const grouped = new Map<string, RunItem[]>()
  for (const run of allRuns) {
    const key = run.requestGroupId || run.id
    const existing = grouped.get(key)
    if (existing) existing.push(run)
    else grouped.set(key, [run])
  }

  return [...grouped.entries()]
    .map(([, groupRuns]) => groupRuns.sort((a, b) => b.updatedAt - a.updatedAt))
    .map((groupRuns) => {
      const latestRun = groupRuns[0]
      const anchorRun = [...groupRuns].sort((a, b) => a.createdAt - b.createdAt)[0]
      const delegationTurnCount = groupRuns.reduce((max, run) => Math.max(max, run.delegationTurnCount), 0)
      const maxDelegationTurns = groupRuns.some((run) => run.maxDelegationTurns === 0)
        ? 0
        : groupRuns.reduce((max, run) => Math.max(max, run.maxDelegationTurns), 0)
      const canCancel = groupRuns.some((run) =>
        run.canCancel && ["queued", "running", "awaiting_approval", "awaiting_user"].includes(run.status),
      )
      const groupStatus = computeGroupStatus(groupRuns)
      const groupSummary = computeGroupSummary(groupRuns)

      return {
        key: anchorRun.requestGroupId || anchorRun.id,
        representative: {
          ...latestRun,
          id: anchorRun.id,
          requestGroupId: anchorRun.requestGroupId,
          title: anchorRun.title,
          prompt: anchorRun.prompt,
          createdAt: anchorRun.createdAt,
          status: groupStatus,
          summary: groupSummary,
          delegationTurnCount,
          maxDelegationTurns,
          canCancel,
        },
        runs: groupRuns,
        treeNodes: buildRunTreeNodes(groupRuns, text),
        timeline: buildGroupTimeline(groupRuns, text),
      }
    })
    .sort((a, b) => b.representative.updatedAt - a.representative.updatedAt)
}

export function RunsPage() {
  const { text, displayText } = useUiI18n()
  const { runs, selectedRunId, ensureInitialized, selectRun, cancelRun } = useRunsStore()

  useEffect(() => {
    ensureInitialized()
  }, [ensureInitialized])

  const cards = buildRunMonitorCards(runs, text)
  const selectedCard = cards.find((card) => card.key === selectedRunId || card.representative.id === selectedRunId) ?? cards[0] ?? null
  const selectedRun = selectedCard?.representative ?? null
  const selectedTimeline = selectedCard?.timeline ?? []

  return (
    <div className="flex h-full overflow-hidden bg-stone-100">
      <div className="w-[28rem] shrink-0 border-r border-stone-200 bg-white">
        <div className="border-b border-stone-200 px-5 py-5">
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">Run Monitor</div>
          <div className="mt-2 text-xl font-semibold text-stone-900">{text("실행 상태 모니터", "Run monitor")}</div>
        </div>
        <div className="h-[calc(100%-6.25rem)] overflow-y-auto p-4">
          <div className="space-y-3">
            {cards.map((card) => (
              <RunStatusCard
                key={card.key}
                run={card.representative}
                treeNodes={card.treeNodes}
                selected={card.key === selectedCard?.key}
                onSelect={() => selectRun(card.key)}
                onCancel={card.representative.canCancel ? () => void cancelRun(card.representative.id) : undefined}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto p-6">
        {selectedRun ? (
          <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
            <div className="space-y-6">
              <RunSummaryPanel run={selectedRun} />
              <div className="rounded-2xl border border-stone-200 bg-white p-5">
                <div className="mb-4 text-sm font-semibold text-stone-900">{text("단계 타임라인", "Step timeline")}</div>
                <RunStepTimeline steps={selectedRun.steps} />
              </div>
            </div>
            <div className="space-y-6">
              <RunEventFeed
                events={selectedTimeline.map((item) => ({
                  id: item.id,
                  at: item.at,
                  label: `[${item.runLabel}] ${displayText(item.label)}`,
                }))}
              />
              <div className="rounded-2xl border border-stone-200 bg-white p-5">
                <div className="mb-2 text-sm font-semibold text-stone-900">{text("원래 요청", "Original request")}</div>
                <p className="text-sm leading-6 text-stone-600">{selectedRun.prompt}</p>
              </div>
            </div>
          </div>
        ) : (
          <EmptyState
            title={text("표시할 run이 없습니다", "No runs to display")}
            description={text("채팅에서 메시지를 보내면 실행 이력이 여기에 표시됩니다.", "Runs created from chat will appear here.")}
          />
        )}
      </div>
    </div>
  )
}
