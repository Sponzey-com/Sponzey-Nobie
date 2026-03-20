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

export function RunSummaryPanel({ run, extraContent }: { run: RootRun; extraContent?: ReactNode }) {
  const { text, displayText, formatTime, language } = useUiI18n()

  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <div className="text-lg font-semibold text-stone-900">{run.title}</div>
          <div className="mt-1 text-sm text-stone-500">
            {toTaskProfileText(run.taskProfile, language)} · {toRunStatusText(run.status, language)} · {text(`단계 ${run.currentStepIndex}/${run.totalSteps}`, `Step ${run.currentStepIndex}/${run.totalSteps}`)}
          </div>
        </div>
        <RunTargetBadge targetId={run.targetId} targetLabel={run.targetLabel} />
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl bg-stone-50 px-4 py-3">
          <div className="text-xs font-semibold text-stone-500">{text("현재 상황", "Current situation")}</div>
          <div className="mt-2 text-sm leading-6 text-stone-700">{displayText(run.summary)}</div>
        </div>
        <div className="rounded-xl bg-stone-50 px-4 py-3">
          <div className="text-xs font-semibold text-stone-500">{text("재질의 예산", "Follow-up budget")}</div>
          <div className="mt-2 text-sm text-stone-700">{run.delegationTurnCount} / {run.maxDelegationTurns === 0 ? text("무제한", "Unlimited") : run.maxDelegationTurns}</div>
        </div>
        <div className="rounded-xl bg-stone-50 px-4 py-3">
          <div className="text-xs font-semibold text-stone-500">{text("문맥 범위", "Context scope")}</div>
          <div className="mt-2 text-sm text-stone-700">{toContextModeText(run.contextMode, language)}</div>
        </div>
        <div className="rounded-xl bg-stone-50 px-4 py-3">
          <div className="text-xs font-semibold text-stone-500">{text("작업 세션", "Worker session")}</div>
          <div className="mt-2 text-sm text-stone-700">{run.workerSessionId || text("루트 검토 실행", "Root review execution")}</div>
        </div>
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-[1.1fr,0.9fr]">
        <div className="rounded-xl bg-stone-50 px-4 py-3">
          <div className="text-xs font-semibold text-stone-500">{text("진단", "Diagnostics")}</div>
          <div className="mt-2 text-sm leading-6 text-stone-700">{displayText(describeDiagnosticReason(run))}</div>
        </div>
        <div className="rounded-xl bg-stone-50 px-4 py-3">
          <div className="text-xs font-semibold text-stone-500">{text("최근 기록", "Recent records")}</div>
          <div className="mt-2 space-y-2 text-sm text-stone-700">
            {run.recentEvents.length > 0 ? run.recentEvents.slice(-5).reverse().map((event) => (
              <div key={event.id} className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1 break-words [overflow-wrap:anywhere]">{displayText(event.label)}</div>
                <div className="shrink-0 text-xs text-stone-500">{formatTime(event.at)}</div>
              </div>
            )) : <div className="text-sm text-stone-500">{text("기록이 없습니다.", "No records yet.")}</div>}
          </div>
        </div>
      </div>
      {extraContent ? <div className="mt-4">{extraContent}</div> : null}
    </div>
  )
}
