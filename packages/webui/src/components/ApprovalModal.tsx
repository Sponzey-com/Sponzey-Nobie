import { useEffect, useMemo, useState } from "react"
import { sendWs } from "../api/ws"
import { resolvePendingInteractionForSession } from "../lib/pending-interactions"
import { useUiI18n } from "../lib/ui-i18n"
import { useChatStore } from "../stores/chat"
import { useRunsStore } from "../stores/runs"

export function ApprovalModal() {
  const { pendingApproval, setPendingApproval, sessionId } = useChatStore()
  const runs = useRunsStore((state) => state.runs)
  const [countdown, setCountdown] = useState(60)
  const { text, language } = useUiI18n()
  const resolvedApproval = useMemo(
    () => resolvePendingInteractionForSession(runs, sessionId, pendingApproval, language),
    [runs, sessionId, pendingApproval, language],
  )
  const isScreenConfirmation = resolvedApproval?.kind === "screen_confirmation"

  useEffect(() => {
    if (!resolvedApproval || isScreenConfirmation) return
    setCountdown(60)
    const interval = setInterval(() => {
      setCountdown((value) => {
        if (value <= 1) {
          respond("deny")
          return 0
        }
        return value - 1
      })
    }, 1000)
    return () => clearInterval(interval)
  }, [resolvedApproval, isScreenConfirmation])

  if (!resolvedApproval || isScreenConfirmation) return null

  function respond(decision: "allow_once" | "allow_run" | "deny") {
    sendWs({ type: "approval.respond", runId: resolvedApproval.runId, toolName: resolvedApproval.toolName, decision })
    setPendingApproval(null)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center gap-2">
          <span className="text-2xl">⚠️</span>
          <h2 className="text-lg font-bold text-gray-800">{text("도구 실행 승인 필요", "Tool execution approval required")}</h2>
          <span className="ml-auto text-sm text-gray-400">{countdown}{text("초", "s")}</span>
        </div>
        <div className="mb-4 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-600">{text("도구:", "Tool:")}</span>
            <code className="rounded bg-gray-100 px-2 py-0.5 text-sm font-mono">{resolvedApproval.toolName}</code>
          </div>
          <div>
            <p className="mb-1 text-sm font-medium text-gray-600">{text("파라미터:", "Parameters:")}</p>
            <pre className="overflow-x-auto rounded bg-gray-100 p-3 text-xs">{JSON.stringify(resolvedApproval.params, null, 2)}</pre>
          </div>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => respond("allow_run")}
            className="flex-1 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
          >
            {text("이 요청 전체 승인", "Approve entire request")}
          </button>
          <button
            onClick={() => respond("allow_once")}
            className="flex-1 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
          >
            {text("이번 단계만", "This step only")}
          </button>
          <button
            onClick={() => respond("deny")}
            className="flex-1 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
          >
            {text("거부 후 취소", "Deny and cancel")}
          </button>
        </div>
      </div>
    </div>
  )
}
