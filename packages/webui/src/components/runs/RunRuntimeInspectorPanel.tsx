import * as React from "react"
import type { RunRuntimeInspectorProjection } from "../../contracts/runs"
import {
  buildRuntimeInspectorViewModels,
  buildRuntimeInspectorSummaryCards,
  describeRuntimeApprovalState,
  describeRuntimeFinalizerStatus,
  runtimeControlActionLabels,
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
  const viewModels = buildRuntimeInspectorViewModels(projection, text)
  const actionLabels = runtimeControlActionLabels(selectedSubSession, text)
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
            className="rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-3 text-xs leading-5 text-emerald-900"
            data-testid="runtime-inspector-basic-view"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-semibold text-stone-950">
                {text("실행 흐름", "Execution flow")}
              </div>
              <div className="flex flex-wrap gap-1.5 text-[10px] text-emerald-800">
                <span className="rounded-full bg-white px-2 py-0.5 font-semibold">
                  {displayText(viewModels.basic.topologyLabel)}
                </span>
                <span className="rounded-full bg-white px-2 py-0.5 font-semibold">
                  {displayText(viewModels.basic.validationStatus)}
                </span>
              </div>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <div className="rounded-lg bg-white px-3 py-2">
                <div className="text-[10px] font-semibold uppercase tracking-[0.04em] text-stone-400">
                  {text("현재 실행자", "Current executor")}
                </div>
                <div className="mt-1 text-sm font-semibold text-stone-950">
                  {displayText(viewModels.basic.currentExecutorName)}
                </div>
              </div>
              <div className="rounded-lg bg-white px-3 py-2">
                <div className="text-[10px] font-semibold uppercase tracking-[0.04em] text-stone-400">
                  {text("선택된 실행자", "Selected executor")}
                </div>
                <div className="mt-1 text-sm font-semibold text-stone-950">
                  {displayText(viewModels.basic.selectedExecutorName)}
                </div>
                {viewModels.basic.selectedExecutorRoleName ? (
                  <div className="mt-1 inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">
                    {displayText(viewModels.basic.selectedExecutorRoleName)}
                  </div>
                ) : null}
              </div>
              <div className="rounded-lg bg-white px-3 py-2">
                <div className="text-[10px] font-semibold uppercase tracking-[0.04em] text-stone-400">
                  {text("위임 경로", "Delegation path")}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-sm font-semibold text-stone-950">
                  {viewModels.basic.selectedPathNames.length > 0 ? (
                    viewModels.basic.selectedPathNames.map((name, index) => (
                      <React.Fragment key={`${name}:${index}`}>
                        {index > 0 ? <span className="text-stone-300">→</span> : null}
                        <span className="rounded-full bg-stone-50 px-2 py-0.5">
                          {displayText(name)}
                        </span>
                      </React.Fragment>
                    ))
                  ) : (
                    <span className="text-stone-500">{text("경로 없음", "No path")}</span>
                  )}
                </div>
              </div>
              <div className="rounded-lg bg-white px-3 py-2">
                <div className="text-[10px] font-semibold uppercase tracking-[0.04em] text-stone-400">
                  {text("결과 취합", "Aggregation")}
                </div>
                <div className="mt-1 text-sm font-semibold text-stone-950">
                  {displayText(viewModels.basic.aggregationStatus)}
                </div>
              </div>
            </div>
            {viewModels.basic.warningLabels.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {viewModels.basic.warningLabels.map((warning) => (
                  <span key={warning} className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                    {displayText(warning)}
                  </span>
                ))}
              </div>
            ) : null}
            <div className="mt-2 rounded-lg bg-white px-3 py-2 text-[11px] font-semibold text-emerald-900">
              {displayText(viewModels.basic.delegationStatus)}
            </div>
          </div>

          <div
            className={`rounded-xl border px-3 py-3 text-xs leading-5 ${
              viewModels.basic.routingTone === "route"
                ? "border-sky-100 bg-sky-50 text-sky-800"
                : viewModels.basic.routingTone === "fallback"
                  ? "border-amber-100 bg-amber-50 text-amber-800"
                  : "border-stone-200 bg-stone-50 text-stone-600"
            }`}
            data-testid="runtime-inspector-topology-routing"
            data-routing-mode={viewModels.basic.routingMode}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-semibold text-stone-900">
                {text("실행 판단", "Execution decision")}
              </div>
              <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold">
                {viewModels.basic.routingMode}
              </span>
            </div>
            <div className="mt-2">
              {viewModels.basic.routingSummary}
            </div>
            <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
              {viewModels.basic.routingPills.map((pill) => (
                <span key={pill} className="rounded-full bg-white px-2 py-0.5 font-semibold">
                  {displayText(pill)}
                </span>
              ))}
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
                      {task.assignedExecutorName || task.assignedExecutorId || task.assignedAgentId
                        ? ` · ${displayText(
                          task.assignedExecutorName ??
                          (task.assignedExecutorId
                            ? projection.topologyRouting.executionDecisionExecutorNameById?.[task.assignedExecutorId]
                            : undefined) ??
                          (task.assignedAgentId
                            ? projection.topologyRouting.executionDecisionExecutorNameById?.[task.assignedAgentId]
                            : undefined) ??
                          text("실행자", "Executor"),
                        )}`
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
                        {displayText(projection.topologyRouting.topologyName ?? text("업무 흐름 실행", "Workflow run"))}
                      </span>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[11px] ${statusToneClassName(topologyRun.status)}`}
                      >
                        {topologyRun.status}
                      </span>
                      {topologyRun.entryNodeId ? (
                        <span className="rounded-full bg-stone-50 px-2 py-0.5 text-[11px] font-semibold text-stone-600">
                          {displayText(
                            projection.topologyRouting.entryNodeName ??
                              projection.topologyRouting.executionDecisionExecutorNameById?.[topologyRun.entryNodeId] ??
                              topologyRun.entryNodeId,
                          )}
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

          <details
            className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-3 text-xs leading-5 text-stone-600"
            data-testid="runtime-inspector-diagnostic-view"
          >
            <summary className="cursor-pointer font-semibold text-stone-900">
              {text("진단 정보", "Diagnostics")}
            </summary>
            <div className="mt-3 space-y-3">
              <div className="grid gap-2 sm:grid-cols-3">
                {viewModels.diagnostic.identity.map((item) => (
                  <RuntimeInspectorIdentityValue
                    key={item.id}
                    label={item.label}
                    value={item.value}
                    emptyLabel={text("정보 없음", "Unknown")}
                    displayText={displayText}
                  />
                ))}
              </div>
              {viewModels.diagnostic.routing.length > 0 ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  {viewModels.diagnostic.routing.map((item) => (
                    <div key={item.id} className="rounded-lg bg-white px-3 py-2">
                      <div className="font-semibold text-stone-600">{item.label}</div>
                      <div className="mt-1 break-words font-mono text-[11px] text-stone-500 [overflow-wrap:anywhere]">
                        {displayText(item.value)}
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
              <div
                className="rounded-lg border border-white/70 bg-white/70 px-3 py-2 text-[11px] leading-5 text-stone-700"
                data-testid="runtime-inspector-executor-scope"
              >
                <div className="font-semibold text-stone-900">
                  {text("실행자 ID", "Executor IDs")}
                </div>
                <div className="mt-2 grid gap-2 md:grid-cols-2">
                  {viewModels.diagnostic.executorIds.map((item) => (
                    <RuntimeInspectorIdList
                      key={item.id}
                      label={item.label}
                      values={item.values}
                      emptyLabel={text("없음", "None")}
                      displayText={displayText}
                    />
                  ))}
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <span className="rounded-full bg-white px-2 py-0.5 font-semibold">
                    {viewModels.diagnostic.providerFallbackLabel}
                  </span>
                  {viewModels.diagnostic.issues.map((issue) => (
                    <span key={issue} className="rounded-full bg-white px-2 py-0.5 font-semibold">
                      {displayText(issue)}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </details>
        </div>
      )}
    </div>
  )
}
