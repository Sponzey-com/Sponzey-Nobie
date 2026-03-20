import type { ReactNode } from "react"
import type { RootRun } from "../../contracts/runs"
import { useUiI18n } from "../../lib/ui-i18n"
import { CapabilityBadge } from "../CapabilityBadge"
import { CancelRunButton } from "./CancelRunButton"
import { RunTargetBadge } from "./RunTargetBadge"
import { toContextModeText, toRunStatusText, toTaskProfileText } from "./runLabels"

export interface RunStatusTreeNode {
  id: string
  label: string
  summary?: string
  status: RootRun["status"]
  isRoot?: boolean
}

function toCapabilityStatus(status: RootRun["status"]) {
  switch (status) {
    case "completed":
      return "ready" as const
    case "failed":
      return "error" as const
    case "cancelled":
    case "interrupted":
      return "disabled" as const
    default:
      return "planned" as const
  }
}

export function RunStatusCard({
  run,
  selected,
  onSelect,
  onCancel,
  extraContent,
  treeNodes,
}: {
  run: RootRun
  selected?: boolean
  onSelect?: () => void
  onCancel?: () => void
  extraContent?: ReactNode
  treeNodes?: RunStatusTreeNode[]
}) {
  const { text, displayText, language } = useUiI18n()

  return (
    <div
      className={`rounded-2xl border p-4 transition ${selected ? "border-stone-900 bg-white shadow-sm" : "border-stone-200 bg-white"}`}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-stone-900">{run.title}</div>
          <div className="mt-1 text-xs text-stone-500">
            {toTaskProfileText(run.taskProfile, language)} · {text(`단계 ${run.currentStepIndex}/${run.totalSteps}`, `Step ${run.currentStepIndex}/${run.totalSteps}`)}
          </div>
          <div className="mt-2 break-words text-xs leading-5 text-stone-600 [overflow-wrap:anywhere]">
            {text("현재 상태:", "Current status:")} {displayText(run.summary)}
          </div>
        </div>
        <CapabilityBadge status={toCapabilityStatus(run.status)} />
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        <RunTargetBadge targetId={run.targetId} targetLabel={run.targetLabel} />
        {run.workerSessionId ? (
          <span className="inline-flex items-center rounded-full bg-stone-100 px-2.5 py-1 text-[11px] text-stone-700">
            {text("작업 세션", "Worker session")} {run.workerSessionId}
          </span>
        ) : null}
        <span className="inline-flex items-center rounded-full bg-stone-100 px-2.5 py-1 text-[11px] text-stone-700">
          {text("문맥", "Context")} {toContextModeText(run.contextMode, language)}
        </span>
        <span className="inline-flex items-center rounded-full bg-stone-100 px-2.5 py-1 text-[11px] text-stone-700">
          {text("재질의", "Follow-up")} {run.delegationTurnCount}/{run.maxDelegationTurns === 0 ? text("무제한", "Unlimited") : run.maxDelegationTurns}
        </span>
      </div>

      {treeNodes && treeNodes.length > 0 ? (
        <div className="mb-4 rounded-2xl border border-stone-200 bg-stone-50/80 px-3 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-500">{text("작업 흐름", "Task flow")}</div>
          <div className="mt-3 space-y-3">
            {treeNodes.map((node) => (
              <div key={node.id} className={node.isRoot ? "" : "relative ml-5 border-l border-stone-200 pl-4"}>
                <div className="flex items-start gap-3">
                  <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${node.isRoot ? "bg-stone-900" : "bg-stone-400"}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-xs font-semibold text-stone-900">{node.label}</div>
                      <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-stone-600 ring-1 ring-stone-200">
                        {toRunStatusText(node.status, language)}
                      </span>
                    </div>
                    {node.summary ? (
                      <div className="mt-1 break-words text-xs leading-5 text-stone-600 [overflow-wrap:anywhere]">
                        {displayText(node.summary)}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {extraContent ? <div className="mb-4">{extraContent}</div> : null}

      <div className="flex items-center justify-between">
        <button
          onClick={onSelect}
          className="rounded-xl border border-stone-200 px-3 py-2 text-xs font-semibold text-stone-700 hover:bg-stone-50"
        >
          {text("상세 보기", "View details")}
        </button>
        {onCancel ? <CancelRunButton canCancel={run.canCancel} onCancel={onCancel} /> : null}
      </div>
    </div>
  )
}
