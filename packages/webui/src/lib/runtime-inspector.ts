import type {
  RunRuntimeInspectorProjection,
  RunRuntimeInspectorSubSession,
  RunRuntimeInspectorTopologyRouting,
  RuntimeInspectorApprovalState,
  RuntimeInspectorControlAction,
} from "../contracts/runs"

export interface RuntimeInspectorSummaryCard {
  id: string
  label: string
  value: string
  tone: "stone" | "blue" | "emerald" | "amber" | "rose"
}

export interface RuntimeTopologyActiveState {
  executorIds: string[]
  edgeIds: string[]
  executorStatuses: Record<string, "running">
  edgeStatuses: Record<string, "running">
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

export function describeRuntimeTopologyRouting(
  routing: RunRuntimeInspectorTopologyRouting | null | undefined,
  text: (ko: string, en: string) => string,
): string {
  if (!routing || routing.mode === "unknown") {
    return text("실행 판단 정보가 아직 없습니다.", "No execution decision information yet.")
  }
  if (routing.mode === "route") {
    const selectedExecutorName = routing.executionDecisionSelectedExecutorId
      ? runtimeExecutorDisplayName(routing, routing.executionDecisionSelectedExecutorId)
      : undefined
    const target =
      routing.entryNodeName ??
      selectedExecutorName ??
      routing.entryNodeId ??
      routing.executionDecisionSelectedExecutorId ??
      routing.topologyName ??
      routing.topologyId ??
      "-"
    return text(
      `${target} 실행자로 토폴로지를 실행합니다.`,
      `Topology execution uses ${target}.`,
    )
  }
  if (routing.reasonCode === "feature_flag_off") {
    return text(
      "관리자가 토폴로지 실행을 명시적으로 꺼서 직접 실행으로 전환되었습니다.",
      "Topology execution was explicitly disabled by an administrator, so the run fell back.",
    )
  }
  if (routing.reasonCode === "active_topology_not_found" || routing.reasonCode === "topology_not_found") {
    return text(
      "저장된 실행 토폴로지를 찾지 못해 직접 실행으로 전환되었습니다.",
      "No saved executable topology was found, so the run fell back.",
    )
  }
  if (routing.reasonCode === "topology_validation_blocked") {
    return text(
      "토폴로지 검증 문제가 있어 실행 전에 차단되었습니다.",
      "Topology validation blocked execution before the path was selected.",
    )
  }
  if (routing.reasonCode === "entry_node_missing") {
    return text(
      "실행을 시작할 노드가 없어 직접 실행으로 전환되었습니다.",
      "No entry node was available, so the run fell back.",
    )
  }
  if (routing.reasonCode === "non_root_request") {
    return text(
      "이미 진행 중인 하위 요청이라 새 토폴로지 루트 실행을 만들지 않았습니다.",
      "This was a child request, so no new topology root route was created.",
    )
  }
  return text(
    `${runtimeTopologyReasonLabel(routing.reasonCode, text)} 상태라 기본 처리로 전환되었습니다.`,
    `The execution path fell back: ${runtimeTopologyReasonLabel(routing.reasonCode, text)}.`,
  )
}

export function runtimeTopologyReasonLabel(
  reasonCode: string | undefined,
  text: (ko: string, en: string) => string,
): string {
  switch (reasonCode) {
    case "topology_routing_not_opted_in":
      return text("저장된 위임 흐름을 쓰지 않음", "Saved delegation flow was not used")
    case "provider_direct_blocked_without_explicit_target":
      return text("명시적 요청 없는 직접 실행 차단", "Direct execution blocked without explicit request")
    case "feature_flag_off":
      return text("토폴로지 실행 꺼짐", "Topology execution disabled")
    case "active_topology_not_found":
    case "topology_not_found":
      return text("저장된 실행 토폴로지 없음", "No saved executable topology")
    case "topology_validation_blocked":
      return text("토폴로지 검증 차단", "Topology validation blocked execution")
    case "entry_node_missing":
      return text("시작 실행자 없음", "No entry executor")
    case "selected_executor_missing":
      return text("선택된 실행자 없음", "No selected executor")
    case "execution_decision_selected_executor":
      return text("검증된 실행자 선택", "Validated executor selection")
    case "explicit_topology_target":
      return text("명시된 토폴로지 대상", "Explicit topology target")
    case "non_root_request":
      return text("이미 진행 중인 하위 요청", "Already a child request")
    case "execution_decision_validated":
      return text("실행 판단 검증 완료", "Execution decision validated")
    case undefined:
      return text("실행 판단 정보 없음", "No execution decision details")
    default:
      return text("기본 처리로 전환", "Fell back to default handling")
  }
}

export function runtimeExecutorDisplayName(
  routing: RunRuntimeInspectorTopologyRouting | null | undefined,
  executorId: string | undefined,
): string {
  const normalized = executorId?.trim()
  if (!normalized) return ""
  return routing?.executionDecisionExecutorNameById?.[normalized] ?? normalized
}

export function runtimeDecisionSourceLabel(
  source: string | undefined,
  text: (ko: string, en: string) => string,
): string {
  if (!source) return text("판단 정보 없음", "No decision source")
  if (source === "nobie_harness") return text("노비 실행 판단", "Nobie execution decision")
  return text("실행 판단", "Execution decision")
}

export function runtimeExecutionRouteLabel(
  route: string | undefined,
  text: (ko: string, en: string) => string,
): string {
  switch (route) {
    case "delegate_to_child":
      return text("하위 실행자에게 위임", "Delegate to child executor")
    case "self_solve":
    case "direct_current_agent":
      return text("현재 실행자가 직접 처리", "Current executor handles it")
    case "root_nobie_direct":
    case "nobie_direct":
      return text("노비가 직접 처리", "Nobie handles it")
    case "return_to_parent":
      return text("상위 실행자에게 반환", "Return to parent executor")
    case "ask_parent":
      return text("상위 실행자 확인", "Ask parent executor")
    case "ask_user":
      return text("사용자 확인", "Ask user")
    case "explicit_provider":
      return text("명시적 직접 실행", "Explicit direct execution")
    case "sub_agent":
      return text("서브 에이전트 실행", "Sub-agent execution")
    case "yeonjang":
      return text("연장 실행", "Yeonjang execution")
    case undefined:
      return text("위임 흐름 미정", "Delegation flow unknown")
    default:
      return text("위임 흐름", "Delegation flow")
  }
}

export function runtimeFallbackReasonLabel(
  reason: string | undefined,
  text: (ko: string, en: string) => string,
): string {
  switch (reason) {
    case "self_solve":
    case "direct_current_agent":
      return text("현재 실행자가 처리", "Current executor handles it")
    case "delegate_to_child":
      return text("가능한 하위 실행자에게 위임", "Delegate to an available child")
    case "return_to_parent":
      return text("상위 실행자에게 반환", "Return to parent executor")
    case "ask_parent":
      return text("상위 실행자 확인", "Ask parent executor")
    case "ask_user":
      return text("사용자 확인", "Ask user")
    case "root_nobie_direct":
    case "nobie_direct":
      return text("노비가 처리", "Nobie handles it")
    case "explicit_provider":
      return text("명시적 직접 실행", "Explicit direct execution")
    case undefined:
      return text("대안 없음", "No fallback")
    default:
      return runtimeTopologyReasonLabel(reason, text)
  }
}

export function runtimeValidationStatusLabel(
  status: string | undefined,
  text: (ko: string, en: string) => string,
): string {
  switch (status) {
    case "valid":
      return text("검증 통과", "Validation passed")
    case "selected_executor_not_direct_child":
      return text("선택된 실행자가 현재 실행자의 직접 하위가 아님", "Selected executor is not a direct child")
    case "selected_executor_not_in_graph":
      return text("선택된 실행자가 그래프에 없음", "Selected executor is not in the graph")
    case "selected_connection_path_invalid":
    case "inaccessible_connection_path":
      return text("선택된 연결 경로를 사용할 수 없음", "Selected connection path is not usable")
    case "executor_unavailable":
      return text("선택된 실행자를 사용할 수 없음", "Selected executor is unavailable")
    case "risk_boundary_requires_approval":
      return text("최종 검토가 필요한 위험 경계", "Risk boundary needs final review")
    case "fallback_not_allowed":
      return text("선택한 대안 경로를 사용할 수 없음", "Selected fallback path is not allowed")
    case undefined:
      return text("검증 정보 없음", "No validation status")
    default:
      return text("검증 실패", "Validation failed")
  }
}

export function selectRuntimeTopologyActiveState(
  projection: RunRuntimeInspectorProjection | null,
): RuntimeTopologyActiveState {
  const executorIds = [...new Set(projection?.topologyRouting.selectedExecutorIds ?? [])]
  const edgeIds = [...new Set(projection?.topologyRouting.selectedEdgeIds ?? [])]
  return {
    executorIds,
    edgeIds,
    executorStatuses: executorIds.reduce<Record<string, "running">>((statuses, executorId) => {
      statuses[executorId] = "running"
      return statuses
    }, {}),
    edgeStatuses: edgeIds.reduce<Record<string, "running">>((statuses, edgeId) => {
      statuses[edgeId] = "running"
      return statuses
    }, {}),
  }
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
      id: "topology",
      label: text("토폴로지", "Topology"),
      value: projection.topologyRouting.mode === "route"
        ? projection.topologyRouting.entryNodeName ??
          projection.topologyRouting.entryNodeId ??
          projection.topologyRouting.topologyName ??
          text("route", "route")
        : runtimeTopologyReasonLabel(projection.topologyRouting.reasonCode, text),
      tone: projection.topologyRouting.mode === "route"
        ? "blue"
        : projection.topologyRouting.mode === "fallback"
          ? "amber"
          : "stone",
    },
    {
      id: "finalizer",
      label: text("Finalizer", "Finalizer"),
      value: describeRuntimeFinalizerStatus(projection, text),
      tone: projection.finalizer.status === "delivered" ? "emerald" : "stone",
    },
  ]
}
