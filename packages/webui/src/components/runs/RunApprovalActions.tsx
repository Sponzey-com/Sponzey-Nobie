import { sendWs } from "../../api/ws"
import { useUiI18n } from "../../lib/ui-i18n"
import { useChatStore, type ApprovalRequest } from "../../stores/chat"

export function RunApprovalActions({ approval }: { approval: ApprovalRequest }) {
  const isScreenConfirmation = approval.kind === "screen_confirmation"
  const setPendingApproval = useChatStore((state) => state.setPendingApproval)
  const { text, displayText } = useUiI18n()

  function respond(decision: "allow_run" | "allow_once" | "deny") {
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
          onClick={() => respond("allow_run")}
          className="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
        >
          {isScreenConfirmation ? text("준비 완료 후 전체 진행", "Ready, continue all") : text("이 요청 전체 승인", "Approve entire request")}
        </button>
        <button
          onClick={() => respond("allow_once")}
          className="rounded-xl bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700"
        >
          {isScreenConfirmation ? text("이번 단계만 진행", "Continue this step only") : text("이번 단계만 승인", "Approve this step only")}
        </button>
        <button
          onClick={() => respond("deny")}
          className="rounded-xl bg-red-600 px-3 py-2 text-xs font-semibold text-white hover:bg-red-700"
        >
          {isScreenConfirmation ? text("준비 안 됨, 요청 취소", "Not ready, cancel request") : text("거부 후 취소", "Deny and cancel")}
        </button>
      </div>
    </div>
  )
}
