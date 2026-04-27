import type {
  RunRuntimeInspectorProjection,
  RunRuntimeInspectorSubSession,
  RuntimeInspectorApprovalState,
  RuntimeInspectorControlAction,
} from "../contracts/runs"

export interface RuntimeInspectorSummaryCard {
  id: string
  label: string
  value: string
  tone: "stone" | "blue" | "emerald" | "amber" | "rose"
}

export function selectRuntimeSubSession(
  projection: RunRuntimeInspectorProjection | null,
  selectedSubSessionId: string | null,
): RunRuntimeInspectorSubSession | null {
  if (!projection || projection.subSessions.length === 0) return null
  return (
    projection.subSessions.find((item) => item.subSessionId === selectedSubSessionId) ??
    projection.subSessions[0] ??
    null
  )
}

export function describeRuntimeApprovalState(
  state: RuntimeInspectorApprovalState,
  text: (ko: string, en: string) => string,
): string {
  switch (state) {
    case "approved":
      return text("승인 완료", "Approved")
    case "denied":
      return text("승인 거절", "Denied")
    case "pending":
      return text("승인 대기", "Pending approval")
    case "required":
      return text("승인 필요", "Approval required")
    case "not_required":
      return text("승인 불필요", "No approval required")
  }
}

export function describeRuntimeFinalizerStatus(
  projection: RunRuntimeInspectorProjection | null,
  text: (ko: string, en: string) => string,
): string {
  switch (projection?.finalizer.status) {
    case "delivered":
      return text("parent finalizer 전달 완료", "Parent finalizer delivered")
    case "generated":
      return text("parent finalizer 생성 완료", "Parent finalizer generated")
    case "suppressed":
      return text("parent finalizer 전달 억제", "Parent finalizer suppressed")
    case "failed":
      return text("parent finalizer 전달 실패", "Parent finalizer failed")
    default:
      return text("parent finalizer 대기", "Parent finalizer pending")
  }
}

export function runtimeControlActionLabel(
  action: RuntimeInspectorControlAction,
  text: (ko: string, en: string) => string,
): string {
  switch (action) {
    case "send":
      return text("전송", "Send")
    case "steer":
      return text("방향 조정", "Steer")
    case "retry":
      return text("재시도", "Retry")
    case "feedback":
      return text("피드백", "Feedback")
    case "redelegate":
      return text("재위임", "Redelegate")
    case "cancel":
      return text("취소", "Cancel")
    case "kill":
      return text("중지", "Kill")
  }
}

export function runtimeControlActionLabels(
  subSession: RunRuntimeInspectorSubSession | null,
  text: (ko: string, en: string) => string,
): string[] {
  return (subSession?.allowedControlActions ?? []).map((item) =>
    runtimeControlActionLabel(item.action, text),
  )
}

export function buildRuntimeInspectorSummaryCards(
  projection: RunRuntimeInspectorProjection | null,
  text: (ko: string, en: string) => string,
): RuntimeInspectorSummaryCard[] {
  if (!projection) {
    return [
      {
        id: "runtime",
        label: text("Runtime", "Runtime"),
        value: text("불러오는 중", "Loading"),
        tone: "stone",
      },
    ]
  }

  const pendingApprovals = projection.approvals.filter(
    (item) => item.status === "pending" || item.status === "required",
  ).length
  const failedSubSessions = projection.subSessions.filter(
    (item) => item.status === "failed" || item.status === "needs_revision",
  ).length

  return [
    {
      id: "mode",
      label: text("모드", "Mode"),
      value: projection.orchestrationMode,
      tone: projection.orchestrationMode === "orchestration" ? "blue" : "stone",
    },
    {
      id: "subsessions",
      label: text("Sub-session", "Sub-sessions"),
      value: String(projection.subSessions.length),
      tone: failedSubSessions > 0 ? "amber" : "emerald",
    },
    {
      id: "data",
      label: text("Data exchange", "Data exchange"),
      value: String(projection.dataExchanges.length),
      tone: projection.dataExchanges.some((item) => item.redactionState === "blocked")
        ? "rose"
        : "stone",
    },
    {
      id: "approvals",
      label: text("승인", "Approvals"),
      value: String(pendingApprovals),
      tone: pendingApprovals > 0 ? "amber" : "stone",
    },
    {
      id: "finalizer",
      label: text("Finalizer", "Finalizer"),
      value: describeRuntimeFinalizerStatus(projection, text),
      tone: projection.finalizer.status === "delivered" ? "emerald" : "stone",
    },
  ]
}
