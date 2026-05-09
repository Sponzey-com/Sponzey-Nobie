import * as React from "react"
import type { RunRuntimeInspectorProjection } from "../../contracts/runs"
import {
  buildRuntimeInspectorSummaryCards,
  describeRuntimeApprovalState,
  describeRuntimeFinalizerStatus,
  describeRuntimeTopologyRouting,
  runtimeDecisionSourceLabel,
  runtimeExecutionRouteLabel,
  runtimeFallbackReasonLabel,
  runtimeTopologyReasonLabel,
  runtimeValidationStatusLabel,
  runtimeControlActionLabels,
  runtimeExecutorDisplayName,
  selectRuntimeSubSession,
} from "../../lib/runtime-inspector"
import { useUiI18n } from "../../lib/ui-i18n"
import { CollapsibleText } from "./CollapsibleText"

function summaryToneClassName(tone: "stone" | "blue" | "emerald" | "amber" | "rose"): string {
  switch (tone) {
    case "blue":
      return "border-sky-100 bg-sky-50 text-sky-800"
    case "emerald":
      return "border-emerald-100 bg-emerald-50 text-emerald-800"
    case "amber":
      return "border-amber-100 bg-amber-50 text-amber-800"
    case "rose":
      return "border-rose-100 bg-rose-50 text-rose-800"
    case "stone":
      return "border-stone-200 bg-stone-50 text-stone-700"
  }
}

function statusToneClassName(status: string): string {
  if (status === "completed" || status === "approved" || status === "delivered") {
    return "border-emerald-100 bg-emerald-50 text-emerald-800"
  }
  if (status === "failed" || status === "denied") {
    return "border-rose-100 bg-rose-50 text-rose-800"
  }
  if (status === "needs_revision" || status === "awaiting_approval" || status === "pending") {
    return "border-amber-100 bg-amber-50 text-amber-800"
  }
  return "border-stone-200 bg-stone-50 text-stone-700"
}

function shortenRuntimeIdentifier(value: string): string {
  const normalized = value.trim()
  if (normalized.length <= 24) return normalized
  return `${normalized.slice(0, 10)}...${normalized.slice(-8)}`
}

function RuntimeInspectorIdentityValue({
  label,
  value,
  emptyLabel,
  displayText,
}: {
  label: string
  value: string | undefined
  emptyLabel: string
  displayText: (value: string) => string
}) {
  const normalized = value?.trim()
  const visible = normalized ? shortenRuntimeIdentifier(displayText(normalized)) : emptyLabel
  return (
    <div className="min-w-0 rounded-lg border border-stone-100 bg-white/70 px-2.5 py-1.5">
      <div className="text-[10px] font-semibold uppercase tracking-[0.04em] text-stone-400">
        {label}
      </div>
      <div
        className="mt-0.5 truncate font-mono text-[11px] font-medium text-stone-500"
        title={normalized ? displayText(normalized) : emptyLabel}
      >
        {visible}
      </div>
    </div>
  )
}

function RuntimeInspectorIdList({
  label,
  values,
  emptyLabel,
  displayText,
  displayValue,
}: {
  label: string
  values: string[]
  emptyLabel: string
  displayText: (value: string) => string
  displayValue?: (value: string) => string
}) {
  return (
    <div className="rounded-md bg-white px-2.5 py-2">
      <div className="font-semibold text-stone-600">{label}</div>
      <div className="mt-1 flex flex-wrap gap-1">
        {values.length > 0 ? values.map((value) => {
          const visibleValue = displayValue ? displayValue(value) : displayText(value)
          return (
          <span
            key={value}
            className="rounded-full bg-stone-50 px-2 py-0.5 font-semibold text-stone-800"
            title={displayText(value)}
          >
            {visibleValue}
          </span>
          )
        }) : (
          <span className="rounded-full bg-stone-50 px-2 py-0.5 font-semibold text-stone-500">
            {emptyLabel}
          </span>
        )}
      </div>
    </div>
  )
}

export function RunRuntimeInspectorPanel({
  projection,
  selectedSubSessionId,
  onSelectSubSession,
  loading,
  error,
}: {
  projection: RunRuntimeInspectorProjection | null
  selectedSubSessionId: string | null
  onSelectSubSession: (subSessionId: string) => void
  loading: boolean
  error: string
}) {
  const { text, displayText, formatTime } = useUiI18n()
  const selectedSubSession = selectRuntimeSubSession(projection, selectedSubSessionId)
  const summaryCards = buildRuntimeInspectorSummaryCards(projection, text)
  const actionLabels = runtimeControlActionLabels(selectedSubSession, text)
  const executorDisplayText = React.useCallback((executorId: string) => {
    if (!projection) return displayText(executorId)
    return displayText(runtimeExecutorDisplayName(projection.topologyRouting, executorId))
  }, [displayText, projection])

  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-stone-900">
            {text("Runtime Inspector", "Runtime Inspector")}
          </div>
          <div className="mt-1 text-xs leading-5 text-stone-500">
            {text(
              "Parent run, sub-session, review, approval, data exchange 상태를 projection으로 표시합니다.",
              "Shows parent run, sub-session, review, approval, and data exchange projection.",
            )}
          </div>
        </div>
        {loading ? (
          <span className="rounded-full bg-stone-100 px-2.5 py-1 text-[11px] text-stone-600">
            {text("갱신 중", "Refreshing")}
          </span>
        ) : null}
      </div>

      {error ? (
        <div className="mt-4 rounded-xl border border-rose-100 bg-rose-50 px-3 py-2 text-xs leading-5 text-rose-700">
          {displayText(error)}
        </div>
      ) : null}

      <div className="mt-4 grid grid-cols-2 gap-2 xl:grid-cols-3">
        {summaryCards.map((card) => (
          <div
            key={card.id}
            className={`rounded-xl border px-3 py-2 ${summaryToneClassName(card.tone)}`}
          >
            <div className="text-[11px] font-semibold opacity-80">{card.label}</div>
            <div className="mt-1 break-words text-sm font-semibold [overflow-wrap:anywhere]">
              {displayText(card.value)}
            </div>
          </div>
        ))}
      </div>

      {!projection ? (
        <div className="mt-4 rounded-xl border border-dashed border-stone-200 bg-stone-50 px-3 py-3 text-xs text-stone-500">
          {loading
            ? text("Runtime projection을 불러오는 중입니다.", "Loading runtime projection.")
            : text("Runtime projection이 없습니다.", "No runtime projection.")}
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          <div
            className="rounded-xl border border-stone-100 bg-white px-3 py-2 text-xs leading-5 text-stone-500"
            data-testid="runtime-inspector-request-identity"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-semibold text-stone-700">
                {text("요청 식별", "Request identity")}
              </div>
              <div className="flex flex-wrap gap-1.5 text-[10px] text-stone-400">
                {projection.requestIdentity.requestIsolationMode ? (
                  <span className="rounded-full bg-stone-50 px-2 py-0.5">
                    {text("격리", "Isolation")} {displayText(projection.requestIdentity.requestIsolationMode)}
                  </span>
                ) : null}
                {projection.requestIdentity.continuationSource ? (
                  <span className="rounded-full bg-stone-50 px-2 py-0.5">
                    {text("연결", "Continuation")} {displayText(projection.requestIdentity.continuationSource)}
                  </span>
                ) : null}
                {projection.requestIdentity.contextMode ? (
                  <span className="rounded-full bg-stone-50 px-2 py-0.5">
                    {text("컨텍스트", "Context")} {displayText(projection.requestIdentity.contextMode)}
                  </span>
                ) : null}
              </div>
            </div>
            <div className="mt-2 grid gap-1.5 sm:grid-cols-3">
              <RuntimeInspectorIdentityValue
                label={text("요청 그룹", "Request group")}
                value={projection.requestIdentity.requestGroupId}
                emptyLabel={text("정보 없음", "Unknown")}
                displayText={displayText}
              />
              <RuntimeInspectorIdentityValue
                label={text("Root run", "Root run")}
                value={projection.requestIdentity.rootRunId}
                emptyLabel={text("정보 없음", "Unknown")}
                displayText={displayText}
              />
              <RuntimeInspectorIdentityValue
                label={text("사용자 메시지", "User message")}
                value={projection.requestIdentity.userMessageKey}
                emptyLabel={text("메시지 키 없음", "No message key")}
                displayText={displayText}
              />
            </div>
          </div>

          <div
            className={`rounded-xl border px-3 py-3 text-xs leading-5 ${
              projection.topologyRouting.mode === "route"
                ? "border-sky-100 bg-sky-50 text-sky-800"
                : projection.topologyRouting.mode === "fallback"
                  ? "border-amber-100 bg-amber-50 text-amber-800"
                  : "border-stone-200 bg-stone-50 text-stone-600"
            }`}
            data-testid="runtime-inspector-topology-routing"
            data-routing-mode={projection.topologyRouting.mode}
            data-entry-node-id={projection.topologyRouting.entryNodeId ?? ""}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-semibold text-stone-900">
                {text("실행 판단", "Execution decision")}
              </div>
              <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold">
                {projection.topologyRouting.mode}
              </span>
            </div>
            <div className="mt-2">
              {describeRuntimeTopologyRouting(projection.topologyRouting, text)}
            </div>
            <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
              {projection.topologyRouting.topologyName || projection.topologyRouting.topologyId ? (
                <span className="rounded-full bg-white px-2 py-0.5 font-semibold">
                  {displayText(
                    projection.topologyRouting.topologyName ??
                      projection.topologyRouting.topologyId ??
                      "",
                  )}
                </span>
              ) : null}
              {projection.topologyRouting.entryNodeName || projection.topologyRouting.entryNodeId ? (
                <span className="rounded-full bg-white px-2 py-0.5 font-semibold">
                  {displayText(
                    projection.topologyRouting.entryNodeName ??
                      projection.topologyRouting.entryNodeId ??
                      "",
                  )}
                </span>
              ) : null}
              {projection.topologyRouting.topologySchemaVersion !== undefined ? (
                <span className="rounded-full bg-white px-2 py-0.5 font-semibold">
                  {text("스키마", "Schema")} v{projection.topologyRouting.topologySchemaVersion}
                </span>
              ) : null}
              {projection.topologyRouting.topologyMigrationSource ? (
                <span className="rounded-full bg-white px-2 py-0.5 font-semibold">
                  {text("출처", "Source")} {displayText(projection.topologyRouting.topologyMigrationSource)}
                </span>
              ) : null}
              {projection.topologyRouting.reasonCode ? (
                <span className="rounded-full bg-white px-2 py-0.5 font-semibold">
                  {runtimeTopologyReasonLabel(projection.topologyRouting.reasonCode, text)}
                </span>
              ) : null}
              {projection.topologyRouting.executionDecisionSource ? (
                <span className="rounded-full bg-white px-2 py-0.5 font-semibold">
                  {runtimeDecisionSourceLabel(projection.topologyRouting.executionDecisionSource, text)}
                </span>
              ) : null}
              {projection.topologyRouting.executionDecisionRoute ? (
                <span className="rounded-full bg-white px-2 py-0.5 font-semibold">
                  {text("위임 흐름", "Delegation flow")} {runtimeExecutionRouteLabel(projection.topologyRouting.executionDecisionRoute, text)}
                </span>
              ) : null}
              {projection.topologyRouting.executionDecisionFallbackReason ? (
                <span className="rounded-full bg-white px-2 py-0.5 font-semibold">
                  {text("대안", "Fallback")} {runtimeFallbackReasonLabel(projection.topologyRouting.executionDecisionFallbackReason, text)}
                </span>
              ) : null}
              {projection.topologyRouting.riskBoundaryRequiresUserApproval !== undefined ? (
                <span className="rounded-full bg-white px-2 py-0.5 font-semibold">
                  {projection.topologyRouting.riskBoundaryRequiresUserApproval
                    ? text("검토 필요", "review needed")
                    : text("검토 불필요", "no review")}
                </span>
              ) : null}
              {projection.topologyRouting.riskBoundaryKind ? (
                <span className="rounded-full bg-white px-2 py-0.5 font-semibold">
                  {text("위험", "risk")} {displayText(projection.topologyRouting.riskBoundaryKind)}
                </span>
              ) : null}
              {projection.topologyRouting.providerFallback ? (
                <span className="rounded-full bg-white px-2 py-0.5 font-semibold">
                  {text("직접 실행 대안 사용", "Direct execution fallback used")}
                </span>
              ) : null}
              {projection.topologyRouting.providerFallbackBlocked ? (
                <span className="rounded-full bg-white px-2 py-0.5 font-semibold">
                  {runtimeTopologyReasonLabel(projection.topologyRouting.providerFallbackBlockedReasonCode, text)}
                </span>
              ) : null}
              {projection.topologyRouting.selectedExecutorIds.length > 0 ? (
                <span className="rounded-full bg-white px-2 py-0.5 font-semibold">
                  {text("노드", "nodes")} {projection.topologyRouting.selectedExecutorIds.length}
                </span>
              ) : null}
              {projection.topologyRouting.selectedEdgeIds.length > 0 ? (
                <span className="rounded-full bg-white px-2 py-0.5 font-semibold">
                  {text("연결선", "edges")} {projection.topologyRouting.selectedEdgeIds.length}
                </span>
              ) : null}
            </div>
            <div
              className="mt-3 rounded-lg border border-white/70 bg-white/70 px-3 py-2 text-[11px] leading-5 text-stone-700"
              data-testid="runtime-inspector-executor-scope"
              data-current-executor-id={projection.topologyRouting.executionDecisionCurrentExecutorId ?? ""}
              data-available-executor-count={projection.topologyRouting.executionDecisionAvailableExecutorIds?.length ?? 0}
              data-all-executor-count={
                projection.topologyRouting.executionDecisionAllRegisteredExecutorIds?.length
                ?? projection.topologyRouting.executionDecisionAllExecutorIds?.length
                ?? 0
              }
              data-provider-fallback-blocked={projection.topologyRouting.providerFallbackBlocked}
            >
              <div className="font-semibold text-stone-900">
                {text("노비 실행 판단", "Nobie execution decision")}
              </div>
              <div className="mt-2 grid gap-2 md:grid-cols-2">
                <RuntimeInspectorIdList
                  label={text("현재 실행자", "Current executor")}
                  values={projection.topologyRouting.executionDecisionCurrentExecutorId ? [projection.topologyRouting.executionDecisionCurrentExecutorId] : []}
                  emptyLabel={text("정보 없음", "Unknown")}
                  displayText={displayText}
                  displayValue={executorDisplayText}
                />
                <RuntimeInspectorIdList
                  label={text("현재 판단 후보", "Current decision candidates")}
                  values={projection.topologyRouting.executionDecisionAvailableExecutorIds ?? []}
                  emptyLabel={text("직접 하위 후보 없음", "No direct child candidates")}
                  displayText={displayText}
                  displayValue={executorDisplayText}
                />
                <RuntimeInspectorIdList
                  label={text("전체 등록 실행자", "All registered executors")}
                  values={
                    projection.topologyRouting.executionDecisionAllRegisteredExecutorIds
                    ?? projection.topologyRouting.executionDecisionAllExecutorIds
                    ?? []
                  }
                  emptyLabel={text("등록된 실행자 없음", "No registered executors")}
                  displayText={displayText}
                  displayValue={executorDisplayText}
                />
                <RuntimeInspectorIdList
                  label={text("참고용 실행자", "Reference executors")}
                  values={projection.topologyRouting.executionDecisionDiagnosticExecutorIds ?? []}
                  emptyLabel={text("참고용 실행자 없음", "No reference executors")}
                  displayText={displayText}
                  displayValue={executorDisplayText}
                />
                <RuntimeInspectorIdList
                  label={text("선택된 실행자", "Selected executor")}
                  values={projection.topologyRouting.executionDecisionSelectedExecutorId ? [projection.topologyRouting.executionDecisionSelectedExecutorId] : []}
                  emptyLabel={text("선택 전", "Not selected")}
                  displayText={displayText}
                  displayValue={executorDisplayText}
                />
                <RuntimeInspectorIdList
                  label={text("선택된 연결 경로", "Selected connection path")}
                  values={projection.topologyRouting.executionDecisionNormalizedConnectionPath?.length
                    ? projection.topologyRouting.executionDecisionNormalizedConnectionPath
                    : projection.topologyRouting.executionDecisionSelectedConnectionPath ?? []}
                  emptyLabel={text("경로 없음", "No path")}
                  displayText={displayText}
                  displayValue={executorDisplayText}
                />
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <span className="rounded-full bg-white px-2 py-0.5 font-semibold">
                  {text("검증", "Validation")} {runtimeValidationStatusLabel(projection.topologyRouting.executionDecisionValidationStatus, text)}
                </span>
                {projection.topologyRouting.executionDecisionValidationIssues?.length ? (
                  <span className="rounded-full bg-white px-2 py-0.5 font-semibold">
                    {text("실패 사유", "Failure reason")}{" "}
                    {projection.topologyRouting.executionDecisionValidationIssues
                      .map((issue) => runtimeValidationStatusLabel(issue, text))
                      .join(", ")}
                  </span>
                ) : null}
                <span className="rounded-full bg-white px-2 py-0.5 font-semibold">
                  {projection.topologyRouting.providerFallbackBlocked
                    ? text("직접 실행 대안 차단됨", "Direct execution fallback blocked")
                    : projection.topologyRouting.providerFallback
                      ? text("직접 실행 대안 사용됨", "Direct execution fallback used")
                      : text("직접 실행 대안 미사용", "Direct execution fallback unused")}
                </span>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-3 text-xs leading-5 text-stone-600">
            <div className="font-semibold text-stone-900">
              {text("Orchestration plan", "Orchestration plan")}
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <div>
                {text("직접", "Direct")}: {projection.plan.directTaskCount}
              </div>
              <div>
                {text("자동 배정 작업", "Auto-assigned tasks")}: {projection.plan.delegatedTaskCount}
              </div>
              <div>
                {text("승인 요구", "Approval requirements")}:{" "}
                {projection.plan.approvalRequirementCount}
              </div>
              <div>
                {text("병렬 그룹", "Parallel groups")}: {projection.plan.parallelGroupCount}
              </div>
            </div>
            {projection.plan.taskSummaries.length > 0 ? (
              <div className="mt-3 space-y-2">
                {projection.plan.taskSummaries.map((task) => (
                  <div key={task.taskId} className="rounded-lg bg-white px-3 py-2">
                    <CollapsibleText
                      value={displayText(task.goal)}
                      threshold={140}
                      clampLines={2}
                      showMoreLabel={text("전체 보기", "Show more")}
                      showLessLabel={text("접기", "Show less")}
                      className="font-medium text-stone-900"
                      buttonClassName="mt-1 inline-flex text-[11px] font-semibold text-stone-600 underline-offset-2 hover:underline"
                    />
                    <div className="mt-1 break-words text-[11px] text-stone-500 [overflow-wrap:anywhere]">
                      {task.executionKind}
                      {task.assignedExecutorName || task.assignedExecutorId
                        ? ` · ${displayText(task.assignedExecutorName ?? task.assignedExecutorId ?? "")}`
                        : task.assignedAgentId
                          ? ` · ${task.assignedAgentId}`
                          : ""}
                      {task.assignmentSource ? ` · ${task.assignmentSource}` : ""}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          <div>
            <div className="mb-2 text-xs font-semibold text-stone-700">
              {text("Sub-session list", "Sub-session list")}
            </div>
            {projection.subSessions.length > 0 ? (
              <div className="grid gap-2">
                {projection.subSessions.map((subSession) => (
                  <button
                    key={subSession.subSessionId}
                    type="button"
                    onClick={() => onSelectSubSession(subSession.subSessionId)}
                    className={`rounded-xl border px-3 py-3 text-left transition ${
                      selectedSubSession?.subSessionId === subSession.subSessionId
                        ? "border-sky-200 bg-sky-50"
                        : "border-stone-200 bg-stone-50 hover:bg-stone-100"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="break-words text-sm font-semibold text-stone-900 [overflow-wrap:anywhere]">
                          {displayText(subSession.agentNickname ?? subSession.agentDisplayName)}
                        </div>
                        <div className="mt-1 break-words text-xs text-stone-500 [overflow-wrap:anywhere]">
                          {displayText(subSession.commandSummary)}
                        </div>
                      </div>
                      <span
                        className={`shrink-0 rounded-full border px-2 py-1 text-[11px] ${statusToneClassName(subSession.status)}`}
                      >
                        {subSession.status}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-stone-500">
                      <span className="rounded-full bg-white px-2 py-1">
                        {describeRuntimeApprovalState(subSession.approvalState, text)}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-stone-200 bg-stone-50 px-3 py-3 text-xs text-stone-500">
                {text("이 run에는 sub-session이 없습니다.", "This run has no sub-sessions.")}
              </div>
            )}
          </div>

          {selectedSubSession ? (
            <div className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-3 text-xs leading-5 text-stone-600">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-semibold text-stone-900">
                    {displayText(
                      selectedSubSession.agentNickname ?? selectedSubSession.agentDisplayName,
                    )}
                  </div>
                  <div className="mt-1 break-words text-stone-500 [overflow-wrap:anywhere]">
                    {displayText(selectedSubSession.subSessionId)}
                  </div>
                </div>
                <span
                  className={`rounded-full border px-2 py-1 text-[11px] ${statusToneClassName(selectedSubSession.status)}`}
                >
                  {selectedSubSession.status}
                </span>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <div className="rounded-lg bg-white px-3 py-2">
                  <div className="font-semibold text-stone-900">
                    {text("Expected output", "Expected output")}
                  </div>
                  <div className="mt-2 space-y-2">
                    {selectedSubSession.expectedOutputs.length > 0 ? (
                      selectedSubSession.expectedOutputs.map((output) => (
                        <div key={output.outputId}>
                          <CollapsibleText
                            value={displayText(output.description)}
                            threshold={140}
                            clampLines={2}
                            showMoreLabel={text("전체 보기", "Show more")}
                            showLessLabel={text("접기", "Show less")}
                            className="font-medium text-stone-800"
                            buttonClassName="mt-1 inline-flex text-[11px] font-semibold text-stone-600 underline-offset-2 hover:underline"
                          />
                          <div className="text-[11px] text-stone-500">
                            {output.kind} ·{" "}
                            {output.required ? text("필수", "required") : text("선택", "optional")}
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="text-stone-500">
                        {text("기대 산출물 없음", "No expected outputs")}
                      </div>
                    )}
                  </div>
                </div>

                <div className="rounded-lg bg-white px-3 py-2">
                  <div className="font-semibold text-stone-900">{text("Model", "Model")}</div>
                  {selectedSubSession.model ? (
                    <div className="mt-2 space-y-1">
                      <div>
                        {selectedSubSession.model.providerId} / {selectedSubSession.model.modelId}
                      </div>
                      <div>
                        {text("tokens", "tokens")}:{" "}
                        {selectedSubSession.model.estimatedInputTokens +
                          selectedSubSession.model.estimatedOutputTokens}
                      </div>
                      <div>
                        {text("cost", "cost")}: {selectedSubSession.model.estimatedCost.toFixed(6)}
                      </div>
                      <div>
                        {text("latency", "latency")}: {selectedSubSession.model.latencyMs ?? 0}ms
                      </div>
                      <div>
                        {text("fallback", "fallback")}:{" "}
                        {selectedSubSession.model.fallbackApplied
                          ? text("사용", "used")
                          : text("없음", "none")}
                      </div>
                    </div>
                  ) : (
                    <div className="mt-2 text-stone-500">
                      {text("모델 스냅샷 없음", "No model snapshot")}
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-3 rounded-lg bg-white px-3 py-2">
                <div className="font-semibold text-stone-900">
                  {text("Result review", "Result review")}
                </div>
                <div className="mt-2 grid gap-2 md:grid-cols-2">
                  <div>
                    {text("result", "result")}:{" "}
                    {selectedSubSession.result?.status ?? text("없음", "none")}
                  </div>
                  <div>
                    {text("verdict", "verdict")}:{" "}
                    {selectedSubSession.review?.verdict ?? text("없음", "none")}
                  </div>
                  <div>
                    {text("integration", "integration")}:{" "}
                    {selectedSubSession.review?.parentIntegrationStatus ?? text("없음", "none")}
                  </div>
                  <div>
                    {text("feedback", "feedback")}: {selectedSubSession.feedback.status}
                  </div>
                </div>
                {selectedSubSession.review?.issueCodes.length ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {selectedSubSession.review.issueCodes.map((code) => (
                      <span
                        key={code}
                        className="rounded-full bg-amber-50 px-2 py-1 text-[11px] text-amber-800"
                      >
                        {displayText(code)}
                      </span>
                    ))}
                  </div>
                ) : null}
                {selectedSubSession.result?.risksOrGaps.length ? (
                  <div className="mt-2 space-y-1">
                    {selectedSubSession.result.risksOrGaps.map((item) => (
                      <CollapsibleText
                        key={item}
                        value={displayText(item)}
                        threshold={140}
                        clampLines={2}
                        showMoreLabel={text("전체 보기", "Show more")}
                        showLessLabel={text("접기", "Show less")}
                        className="break-words text-[11px] text-stone-500 [overflow-wrap:anywhere]"
                        buttonClassName="mt-1 inline-flex text-[11px] font-semibold text-stone-600 underline-offset-2 hover:underline"
                      />
                    ))}
                  </div>
                ) : null}
              </div>

              <div className="mt-3 rounded-lg bg-white px-3 py-2">
                <div className="font-semibold text-stone-900">
                  {text("Allowed controls", "Allowed controls")}
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {actionLabels.length > 0 ? (
                    actionLabels.map((label) => (
                      <span
                        key={label}
                        className="rounded-full border border-stone-200 bg-stone-50 px-2.5 py-1 text-[11px] font-semibold text-stone-700"
                      >
                        {label}
                      </span>
                    ))
                  ) : (
                    <span className="text-stone-500">
                      {text("허용된 제어 없음", "No controls allowed")}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ) : null}

          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-3 text-xs leading-5 text-stone-600">
              <div className="font-semibold text-stone-900">
                {text("Data exchange", "Data exchange")}
              </div>
              <div className="mt-2 space-y-2">
                {projection.dataExchanges.length > 0 ? (
                  projection.dataExchanges.map((exchange) => (
                    <div key={exchange.exchangeId} className="rounded-lg bg-white px-3 py-2">
                      <CollapsibleText
                        value={displayText(exchange.purpose)}
                        threshold={140}
                        clampLines={2}
                        showMoreLabel={text("전체 보기", "Show more")}
                        showLessLabel={text("접기", "Show less")}
                        className="font-medium text-stone-900"
                        buttonClassName="mt-1 inline-flex text-[11px] font-semibold text-stone-600 underline-offset-2 hover:underline"
                      />
                      <div className="mt-1 text-[11px] text-stone-500">
                        {exchange.allowedUse} · {exchange.redactionState} ·{" "}
                        {text("provenance", "provenance")} {exchange.provenanceCount}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-stone-500">
                    {text("데이터 교환 없음", "No data exchange")}
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-3 text-xs leading-5 text-stone-600">
              <div className="font-semibold text-stone-900">{text("Approvals", "Approvals")}</div>
              <div className="mt-2 space-y-2">
                {projection.approvals.length > 0 ? (
                  projection.approvals.map((approval) => (
                    <div key={approval.approvalId} className="rounded-lg bg-white px-3 py-2">
                      <div className="font-medium text-stone-900">
                        {describeRuntimeApprovalState(approval.status, text)}
                      </div>
                      <CollapsibleText
                        value={displayText(approval.summary)}
                        threshold={140}
                        clampLines={2}
                        showMoreLabel={text("전체 보기", "Show more")}
                        showLessLabel={text("접기", "Show less")}
                        className="mt-1 break-words text-[11px] text-stone-500 [overflow-wrap:anywhere]"
                        buttonClassName="mt-1 inline-flex text-[11px] font-semibold text-stone-600 underline-offset-2 hover:underline"
                      />
                    </div>
                  ))
                ) : (
                  <div className="text-stone-500">
                    {text("승인 이벤트 없음", "No approval events")}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-3 text-xs leading-5 text-stone-600">
            <div className="font-semibold text-stone-900">
              {describeRuntimeFinalizerStatus(projection, text)}
            </div>
            <CollapsibleText
              value={
                projection.finalizer.summary
                  ? displayText(projection.finalizer.summary)
                  : text(
                      "최종 답변은 parent run finalizer만 사용자에게 전달합니다.",
                      "Only the parent run finalizer delivers the final answer to the user.",
                    )
              }
              threshold={180}
              clampLines={3}
              showMoreLabel={text("전체 보기", "Show more")}
              showLessLabel={text("접기", "Show less")}
              className="mt-1 break-words text-stone-500 [overflow-wrap:anywhere]"
              buttonClassName="mt-1 inline-flex text-[11px] font-semibold text-stone-600 underline-offset-2 hover:underline"
            />
          </div>

          <div className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-3 text-xs leading-5 text-stone-600">
            <div className="font-semibold text-stone-900">
              {text("Runtime timeline", "Runtime timeline")}
            </div>
            <div className="mt-2 max-h-72 space-y-2 overflow-y-auto pr-1">
              {projection.timeline.length > 0 ? (
                projection.timeline.map((event) => (
                  <div key={event.id} className="rounded-lg bg-white px-3 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-stone-900">{displayText(event.kind)}</span>
                      {event.status ? (
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[11px] ${statusToneClassName(event.status)}`}
                        >
                          {event.status}
                        </span>
                      ) : null}
                      <span className="text-[11px] text-stone-400">{formatTime(event.at)}</span>
                    </div>
                    <CollapsibleText
                      value={displayText(event.summary)}
                      threshold={160}
                      clampLines={2}
                      showMoreLabel={text("전체 보기", "Show more")}
                      showLessLabel={text("접기", "Show less")}
                      className="mt-1 break-words text-stone-500 [overflow-wrap:anywhere]"
                      buttonClassName="mt-1 inline-flex text-[11px] font-semibold text-stone-600 underline-offset-2 hover:underline"
                    />
                  </div>
                ))
              ) : (
                <div className="text-stone-500">
                  {text("표시할 이벤트가 없습니다.", "No events to display.")}
                </div>
              )}
            </div>
          </div>

          {projection.topologyRuns.length > 0 ? (
            <div className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-3 text-xs leading-5 text-stone-600">
              <div className="font-semibold text-stone-900">
                {text("Topology run trace", "Topology run trace")}
              </div>
              <div className="mt-2 space-y-2">
                {projection.topologyRuns.map((topologyRun) => (
                  <div key={topologyRun.topologyRunId} className="rounded-lg bg-white px-3 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-stone-900">
                        {displayText(topologyRun.topologyId)}
                      </span>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[11px] ${statusToneClassName(topologyRun.status)}`}
                      >
                        {topologyRun.status}
                      </span>
                      {topologyRun.entryNodeId ? (
                        <span className="rounded-full bg-stone-50 px-2 py-0.5 text-[11px] font-semibold text-stone-600">
                          {displayText(topologyRun.entryNodeId)}
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-1 text-[11px] text-stone-500">
                      {text("노드", "nodes")} {topologyRun.nodeRunCount} ·{" "}
                      {text("연결", "edges")} {topologyRun.observedEdgeCount} ·{" "}
                      {text("실패", "failures")} {topologyRun.failureCount}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}
