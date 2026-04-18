import { useState } from "react"
import { sendWs } from "../../api/ws"
import { BEGINNER_ACTION_BUTTON_CLASS, buildBeginnerApprovalCard } from "../../lib/beginner-workspace"
import { useUiI18n } from "../../lib/ui-i18n"
import { useChatStore, type ApprovalRequest } from "../../stores/chat"
import { useUiModeStore } from "../../stores/uiMode"

function beginnerButtonClass(tone: "approve" | "once" | "deny"): string {
  const toneClass = tone === "approve"
    ? "bg-emerald-600 text-white hover:bg-emerald-700 focus:ring-emerald-500"
    : tone === "once"
      ? "bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-500"
      : "bg-white text-stone-700 ring-1 ring-inset ring-stone-200 hover:bg-stone-50 focus:ring-stone-500"
  return `${BEGINNER_ACTION_BUTTON_CLASS} ${toneClass}`
}

export function RunApprovalActions({ approval }: { approval: ApprovalRequest }) {
  const isScreenConfirmation = approval.kind === "screen_confirmation"
  const setPendingApproval = useChatStore((state) => state.setPendingApproval)
  const mode = useUiModeStore((state) => state.mode)
  const { text, displayText, language } = useUiI18n()
  const [submittedDecision, setSubmittedDecision] = useState<"allow_run" | "allow_once" | "deny" | null>(null)
  const beginnerCard = buildBeginnerApprovalCard(approval, language)

  function respond(decision: "allow_run" | "allow_once" | "deny") {
    if (submittedDecision) return
    setSubmittedDecision(decision)
    sendWs({
      type: "approval.respond",
      approvalId: approval.approvalId,
      runId: approval.runId,
      toolName: approval.toolName,
      decision,
    })
    const current = useChatStore.getState().pendingApproval
    if (current?.runId === approval.runId) {
      setPendingApproval(null)
    }
  }

  if (mode === "beginner") {
    return (
      <section id="approval" className="space-y-4 rounded-[1.5rem] border border-amber-200 bg-amber-50/80 p-4" aria-live="polite">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-700">{beginnerCard.title}</div>
          <p className="mt-2 text-sm leading-6 text-stone-700">{beginnerCard.summary}</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {beginnerCard.actions.map((action) => (
            <button
              key={action.decision}
              type="button"
              aria-label={action.ariaLabel}
              disabled={submittedDecision !== null}
              onClick={() => respond(action.decision)}
              className={`${beginnerButtonClass(action.tone)} disabled:cursor-not-allowed disabled:opacity-50`}
            >
              {action.label}
            </button>
          ))}
        </div>
      </section>
    )
  }

  return (
    <div className="space-y-3 rounded-2xl border border-amber-200 bg-amber-50/80 p-4">
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-700">
        {isScreenConfirmation ? text("준비 확인 필요", "Confirmation needed") : text("승인 필요", "Approval needed")}
      </div>
      <div className="text-sm font-semibold text-stone-900">{approval.toolName}</div>
      {approval.guidance ? (
        <div className="rounded-xl bg-white/80 px-3 py-2 text-xs leading-5 text-stone-700">
          {displayText(approval.guidance)}
        </div>
      ) : null}
      <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-xl bg-white/80 p-3 text-xs text-stone-700 [overflow-wrap:anywhere]">
        {JSON.stringify(approval.params, null, 2)}
      </pre>
      <div className="grid gap-2">
        <button
          type="button"
          aria-label={isScreenConfirmation ? text("준비 완료 후 현재 요청 전체 진행", "Ready and continue the entire current request") : text("현재 요청 전체 승인", "Approve the entire current request")}
          disabled={submittedDecision !== null}
          onClick={() => respond("allow_run")}
          className="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isScreenConfirmation ? text("준비 완료 후 전체 진행", "Ready, continue all") : text("이 요청 전체 승인", "Approve entire request")}
        </button>
        <button
          type="button"
          aria-label={isScreenConfirmation ? text("준비 완료 후 이번 단계만 진행", "Ready and continue this step only") : text("이번 단계만 승인", "Approve this step only")}
          disabled={submittedDecision !== null}
          onClick={() => respond("allow_once")}
          className="rounded-xl bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isScreenConfirmation ? text("이번 단계만 진행", "Continue this step only") : text("이번 단계만 승인", "Approve this step only")}
        </button>
        <button
          type="button"
          aria-label={isScreenConfirmation ? text("준비 안 됨으로 요청 취소", "Cancel because the screen is not ready") : text("승인을 거부하고 요청 취소", "Deny approval and cancel the request")}
          disabled={submittedDecision !== null}
          onClick={() => respond("deny")}
          className="rounded-xl bg-red-600 px-3 py-2 text-xs font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isScreenConfirmation ? text("준비 안 됨, 요청 취소", "Not ready, cancel request") : text("거부 후 취소", "Deny and cancel")}
        </button>
      </div>
    </div>
  )
}
