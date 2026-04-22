import React from "react"
import type { ReviewReadinessBoard, ReviewBoardStepId } from "../../lib/setup-readiness"
import { useUiI18n } from "../../lib/ui-i18n"

export function ReviewSummaryPanel({
  board,
  onSelectStep,
}: {
  board: ReviewReadinessBoard
  onSelectStep?: (stepId: ReviewBoardStepId) => void
}) {
  const { text, displayText } = useUiI18n()

  return (
    <div className="space-y-5">
      <div className={`rounded-3xl border px-5 py-5 ${board.overallTone === "ready" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.18em] opacity-70">
              {text("Readiness Board", "Readiness Board")}
            </div>
            <div className="mt-2 text-lg font-semibold">{board.overallTitle}</div>
            <div className="mt-2 text-sm leading-6">{displayText(board.overallMessage)}</div>
          </div>
          <div className="grid gap-2 text-sm">
            <MetricPill label={text("준비 단계", "Ready steps")} value={`${board.readyCount}/${board.totalCount}`} />
            <MetricPill label={text("준비 capability", "Ready capabilities")} value={`${board.capabilityReadyCount}/${board.capabilityTotalCount}`} />
          </div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {board.tiles.map((tile) => (
          <button
            key={tile.stepId}
            type="button"
            onClick={() => onSelectStep?.(tile.stepId)}
            data-review-step-action={tile.stepId}
            className={`rounded-3xl border bg-white p-5 text-left transition hover:border-stone-300 ${tileToneClass(tile.tone)}`}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">{tile.stepId}</div>
                <div className="mt-2 text-lg font-semibold text-stone-900">{tile.title}</div>
                <div className="mt-2 text-sm leading-6 text-stone-700">{tile.summary}</div>
              </div>
              <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${tileToneBadgeClass(tile.tone)}`}>
                {tileToneLabel(tile.tone, text)}
              </span>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {tile.badges.map((badge) => (
                <span key={badge} className="rounded-full bg-stone-100 px-2.5 py-1 text-[11px] font-semibold text-stone-600">
                  {badge}
                </span>
              ))}
            </div>
            <div className="mt-4 grid gap-2 text-sm leading-6 text-stone-600">
              {tile.details.length > 0 ? tile.details.map((detail) => (
                <div key={detail}>{detail}</div>
              )) : (
                <div>{text("추가 상세 없음", "No extra details")}</div>
              )}
            </div>
            <div className="mt-4 text-xs font-semibold text-stone-500">
              {text("이 단계로 이동", "Jump to this step")}
            </div>
          </button>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <IssueBoard
          title={text("누락 연결", "Missing links")}
          emptyLabel={text("누락 연결이 없습니다.", "There are no missing links.")}
          issues={board.missingLinks}
          onSelectStep={onSelectStep}
        />
        <IssueBoard
          title={text("위험 경로", "Risk paths")}
          emptyLabel={text("즉시 보이는 위험 경로가 없습니다.", "There are no visible risk paths.")}
          issues={board.riskPaths}
          onSelectStep={onSelectStep}
        />
        <div className="rounded-3xl border border-stone-200 bg-white p-5">
          <div className="text-sm font-semibold text-stone-900">{text("저장 전 snapshot", "Pre-finish snapshot")}</div>
          <div className="mt-4 space-y-3">
            {board.snapshot.map((item) => (
              <div key={item.label} className="rounded-2xl bg-stone-50 px-4 py-3 text-sm text-stone-700">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">{item.label}</div>
                <div className="mt-2 break-all">{item.value}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function IssueBoard({
  title,
  emptyLabel,
  issues,
  onSelectStep,
}: {
  title: string
  emptyLabel: string
  issues: ReviewReadinessBoard["missingLinks"]
  onSelectStep?: (stepId: ReviewBoardStepId) => void
}) {
  return (
    <div className="rounded-3xl border border-stone-200 bg-white p-5">
      <div className="text-sm font-semibold text-stone-900">{title}</div>
      <div className="mt-4 space-y-3">
        {issues.length > 0 ? issues.map((issue) => (
          <button
            key={issue.id}
            type="button"
            onClick={() => { if (issue.stepId) onSelectStep?.(issue.stepId) }}
            data-review-issue-action={issue.stepId}
            className={`w-full rounded-2xl border px-4 py-3 text-left ${issueToneClass(issue.tone)}`}
          >
            <div className="text-sm font-semibold">{issue.title}</div>
            <div className="mt-2 text-sm leading-6">{issue.description}</div>
          </button>
        )) : (
          <div className="rounded-2xl border border-dashed border-stone-300 bg-stone-50 px-4 py-4 text-sm text-stone-500">
            {emptyLabel}
          </div>
        )}
      </div>
    </div>
  )
}

function MetricPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/60 bg-white/70 px-4 py-3 text-right">
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500">{label}</div>
      <div className="mt-2 text-sm font-semibold text-stone-900">{value}</div>
    </div>
  )
}

function tileToneLabel(tone: "ready" | "warning" | "error" | "draft", text: (ko: string, en: string) => string): string {
  switch (tone) {
    case "ready":
      return text("준비됨", "Ready")
    case "warning":
      return text("주의", "Warning")
    case "error":
      return text("오류", "Error")
    case "draft":
    default:
      return text("초안", "Draft")
  }
}

function tileToneClass(tone: "ready" | "warning" | "error" | "draft"): string {
  switch (tone) {
    case "ready":
      return "border-emerald-200"
    case "warning":
      return "border-amber-200"
    case "error":
      return "border-red-200"
    case "draft":
    default:
      return "border-stone-200"
  }
}

function tileToneBadgeClass(tone: "ready" | "warning" | "error" | "draft"): string {
  switch (tone) {
    case "ready":
      return "border-emerald-200 bg-emerald-50 text-emerald-700"
    case "warning":
      return "border-amber-200 bg-amber-50 text-amber-700"
    case "error":
      return "border-red-200 bg-red-50 text-red-700"
    case "draft":
    default:
      return "border-stone-200 bg-stone-100 text-stone-600"
  }
}

function issueToneClass(tone: "info" | "warning" | "error"): string {
  switch (tone) {
    case "error":
      return "border-red-200 bg-red-50 text-red-700"
    case "warning":
      return "border-amber-200 bg-amber-50 text-amber-800"
    case "info":
    default:
      return "border-blue-200 bg-blue-50 text-blue-700"
  }
}

export type { ReviewBoardStepId as ReviewSummaryStepId } from "../../lib/setup-readiness"
