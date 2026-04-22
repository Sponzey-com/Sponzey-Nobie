import * as React from "react"
import { pickUiText, type UiLanguage } from "../../stores/uiLanguage"

export interface OrchestrationSaveEntityStatus {
  key: string
  targetType: "agent" | "team"
  targetId: string
  phase: "preflight" | "persist"
  status: "succeeded" | "failed" | "skipped"
  message: string
}

export interface OrchestrationSaveResultState {
  status: "idle" | "running" | "validated" | "blocked" | "stored" | "partial"
  summary: string
  effects: string[]
  entities: OrchestrationSaveEntityStatus[]
  remainingInstructionKeys?: string[]
  recommendedActions?: string[]
}

export function OrchestrationSaveResultToast({
  language,
  result,
}: {
  language: UiLanguage
  result: OrchestrationSaveResultState | null
}) {
  if (!result || result.status === "idle") return null
  const failedCount = result.entities.filter((entity) => entity.status === "failed").length
  const successCount = result.entities.filter((entity) => entity.status === "succeeded").length
  const preflightCount = result.entities.filter((entity) => entity.phase === "preflight").length
  const persistCount = result.entities.filter((entity) => entity.phase === "persist").length

  return (
    <section className={`rounded-[1.4rem] border px-4 py-4 text-sm leading-6 ${toneClass(result.status)}`} data-orchestration-save-toast={result.status}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] opacity-70">
            {pickUiText(language, "저장 결과", "Save result")}
          </div>
          <div className="mt-2 text-sm font-semibold">{result.summary}</div>
        </div>
        <div className="rounded-full bg-white/70 px-3 py-1 text-xs font-semibold">
          {pickUiText(language, `${successCount} 성공 / ${failedCount} 실패`, `${successCount} success / ${failedCount} failed`)}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2" data-orchestration-save-phases="">
        <span className="rounded-full border border-current/20 bg-white/40 px-3 py-1 text-[11px] font-semibold">
          {pickUiText(language, `preflight ${preflightCount}`, `preflight ${preflightCount}`)}
        </span>
        <span className="rounded-full border border-current/20 bg-white/40 px-3 py-1 text-[11px] font-semibold">
          {pickUiText(language, `persist ${persistCount}`, `persist ${persistCount}`)}
        </span>
        {result.remainingInstructionKeys?.length ? (
          <span className="rounded-full border border-current/20 bg-white/40 px-3 py-1 text-[11px] font-semibold">
            {pickUiText(language, `retry ${result.remainingInstructionKeys.length}`, `retry ${result.remainingInstructionKeys.length}`)}
          </span>
        ) : null}
      </div>

      {result.effects.length > 0 ? (
        <div className="mt-3 space-y-1">
          {result.effects.map((effect) => <div key={effect}>{effect}</div>)}
        </div>
      ) : null}

      {result.recommendedActions?.length ? (
        <div className="mt-3 flex flex-wrap gap-2" data-orchestration-save-recovery="">
          {result.recommendedActions.map((action) => (
            <span key={action} className="rounded-full border border-current/20 bg-white/40 px-3 py-1 text-[11px] font-semibold">
              {action}
            </span>
          ))}
        </div>
      ) : null}

      {result.entities.length > 0 ? (
        <details className="mt-3 rounded-[1rem] border border-current/20 bg-white/40 px-4 py-3">
          <summary className="cursor-pointer list-none text-sm font-semibold">
            {pickUiText(language, "세부 상태 보기", "Show detailed status")}
          </summary>
          <div className="mt-3 space-y-2 text-xs leading-5">
            {result.entities.map((entity) => (
              <div key={`${entity.key}:${entity.phase}:${entity.status}`}>
                [{entity.phase}] {entity.targetType}:{entity.targetId} - {entity.status} - {entity.message}
              </div>
            ))}
            {result.remainingInstructionKeys?.map((key) => (
              <div key={`remaining:${key}`}>[persist] {key} - skipped - pending retry</div>
            ))}
          </div>
        </details>
      ) : null}
    </section>
  )
}

function toneClass(status: OrchestrationSaveResultState["status"]): string {
  switch (status) {
    case "stored":
      return "border-emerald-200 bg-emerald-50 text-emerald-950"
    case "validated":
      return "border-sky-200 bg-sky-50 text-sky-900"
    case "running":
      return "border-stone-200 bg-stone-50 text-stone-900"
    case "partial":
      return "border-amber-200 bg-amber-50 text-amber-950"
    case "blocked":
    default:
      return "border-red-200 bg-red-50 text-red-900"
  }
}
