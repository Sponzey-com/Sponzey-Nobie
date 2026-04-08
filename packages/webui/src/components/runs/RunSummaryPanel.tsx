import type { ReactNode } from "react"
import type { RootRun } from "../../contracts/runs"
import { useUiI18n } from "../../lib/ui-i18n"
import { RunTargetBadge } from "./RunTargetBadge"
import { toContextModeText, toRunStatusText, toTaskProfileText } from "./runLabels"

function describeDiagnosticReason(run: RootRun): string {
  const recent = [...run.recentEvents].sort((a, b) => b.at - a.at)
  const latest = recent[0]?.label
  if (run.status === "awaiting_approval") return latest || "권한 승인을 기다리고 있습니다."
  if (run.status === "awaiting_user") return latest || "추가 입력 또는 확인을 기다리고 있습니다."
  if (run.status === "running") return latest || "작업이 진행 중입니다."
  if (run.status === "queued") return latest || "실행 대기 중입니다."
  if (run.status === "failed") return latest || "실행 중 오류가 발생했습니다."
  return latest || run.summary
}

function InfoRow({
  label,
  value,
}: {
  label: string
  value: ReactNode
}) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white px-4 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">{label}</div>
      <div className="mt-2 text-sm font-medium leading-6 text-stone-900">{value}</div>
    </div>
  )
}

export function RunSummaryPanel({ run, extraContent }: { run: RootRun; extraContent?: ReactNode }) {
  const { text, displayText, formatTime, language } = useUiI18n()

  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <div className="text-lg font-semibold text-stone-900">{run.title}</div>
          <div className="mt-1 text-sm text-stone-500">
            {toTaskProfileText(run.taskProfile, language)} · {toRunStatusText(run.status, language)} · {text(`진행 ${run.currentStepIndex}/${run.totalSteps}`, `Progress ${run.currentStepIndex}/${run.totalSteps}`)}
          </div>
        </div>
        <RunTargetBadge targetId={run.targetId} targetLabel={run.targetLabel} />
      </div>
      <div className="space-y-4">
        <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-4">
          <div className="text-xs font-semibold text-stone-500">{text("현재 상황", "Current situation")}</div>
          <div className="mt-2 break-words text-sm leading-7 text-stone-800 [overflow-wrap:anywhere]">
            {displayText(run.summary)}
          </div>
        </div>

        <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-4">
          <div className="text-xs font-semibold text-stone-500">{text("진행 정보", "Run details")}</div>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <InfoRow
              label={text("후속 시도 한도", "Follow-up limit")}
              value={`${run.delegationTurnCount} / ${run.maxDelegationTurns === 0 ? text("무제한", "Unlimited") : run.maxDelegationTurns}`}
            />
            <InfoRow
              label={text("참조 범위", "Context range")}
              value={toContextModeText(run.contextMode, language)}
            />
            <InfoRow
              label={text("세션 ID", "Session ID")}
              value={run.workerSessionId || text("기본 세션", "Default session")}
            />
            <InfoRow
              label={text("실행 대상", "Execution target")}
              value={run.targetLabel || run.targetId || text("실행 대상 미선정", "No target selected")}
            />
          </div>
        </div>

        <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-4">
          <div className="text-xs font-semibold text-stone-500">{text("진단", "Diagnostics")}</div>
          <div className="mt-2 break-words text-sm leading-7 text-stone-800 [overflow-wrap:anywhere]">
            {displayText(describeDiagnosticReason(run))}
          </div>
        </div>

        <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-4">
          <div className="text-xs font-semibold text-stone-500">{text("최근 기록", "Recent history")}</div>
          <div className="mt-3 space-y-2 text-sm text-stone-700">
            {run.recentEvents.length > 0 ? run.recentEvents.slice(-5).reverse().map((event) => (
              <div key={event.id} className="flex items-start justify-between gap-3 rounded-xl border border-stone-200 bg-white px-3 py-2.5">
                <div className="min-w-0 flex-1 break-words leading-6 [overflow-wrap:anywhere]">{displayText(event.label)}</div>
                <div className="shrink-0 text-xs text-stone-500">{formatTime(event.at)}</div>
              </div>
            )) : <div className="rounded-xl border border-dashed border-stone-200 bg-white px-3 py-3 text-sm text-stone-500">{text("기록이 없습니다.", "No records yet.")}</div>}
          </div>
        </div>
      </div>
      {extraContent ? <div className="mt-4">{extraContent}</div> : null}
    </div>
  )
}
