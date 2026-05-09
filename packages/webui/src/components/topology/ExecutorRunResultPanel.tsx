import * as React from "react"
import type {
  EnterpriseTopology,
  FailureIssueKind,
  FailureNextActionKind,
  FailureRecoveryActionKind,
} from "../../contracts/enterprise-topology"
import {
  ENTERPRISE_TOPOLOGY_GUI_DRAFT_SCHEMA_VERSION,
  createGuiDraftOperationBase,
  type EnterpriseTopologyGuiOperation,
  type EnterpriseTopologyQuickFixOperationPreview,
} from "../../lib/enterprise-topology-operations"
import {
  buildExecutorGraphFromEnterpriseTopology,
  type ExecutorDraft,
  type ExecutorGraphWorkspace,
} from "../../lib/executor-graph"
import type { TopologyRunTraceOverlayInput } from "./TopologyRunTraceOverlay"
import { TopologyRunTraceOverlay } from "./TopologyRunTraceOverlay"
import { buildTopologyQuickFixPlans } from "./TopologyValidationAssistant"
import { useUiI18n } from "../../lib/ui-i18n"

export type ExecutorRunNodeStatus = "success" | "waiting" | "partial_success" | "failed"

export interface ExecutorRunNodeResult {
  executorId: string
  name: string
  status: ExecutorRunNodeStatus
  statusLabelKo: "성공" | "대기" | "부분 성공" | "실패"
  statusLabelEn: "Success" | "Waiting" | "Partial success" | "Failed"
  detailKo: string
  detailEn: string
}

export interface ExecutorFailureExplanation {
  failureReportId: string
  nodeId: string
  nodeName: string
  pathKo: string
  pathEn: string
  reasonKo: string
  reasonEn: string
  triedKo: string[]
  triedEn: string[]
  nextActionKo: string
  nextActionEn: string
}

export interface ExecutorRunQuickAction {
  actionId: "add_permission" | "pass_partial" | "move_to_exception" | "revise_description"
  labelKo: "권한 추가" | "부분 정보로 넘기기" | "예외 처리로 이동" | "설명 수정"
  labelEn: "Add permission" | "Pass partial info" | "Move to exception handler" | "Revise description"
  operations: EnterpriseTopologyGuiOperation[]
  preview: EnterpriseTopologyQuickFixOperationPreview[]
}

export interface ExecutorRunResultModel {
  hasRun: boolean
  runStatus: string
  nodeResults: ExecutorRunNodeResult[]
  failures: ExecutorFailureExplanation[]
  quickActions: ExecutorRunQuickAction[]
}

export interface ExecutorRunResultPanelProps {
  topology?: EnterpriseTopology | null
  graph?: ExecutorGraphWorkspace | null
  overlay?: TopologyRunTraceOverlayInput | null
  advancedOpen?: boolean
  onPreviewQuickAction?: (action: ExecutorRunQuickAction) => void
  onTraceLayerRequest?: () => void
}

export function buildExecutorRunResultModel(input: {
  topology?: EnterpriseTopology | null
  graph?: ExecutorGraphWorkspace | null
  overlay?: TopologyRunTraceOverlayInput | null
}): ExecutorRunResultModel {
  const graph = input.graph ?? (input.topology
    ? buildExecutorGraphFromEnterpriseTopology(input.topology, { mode: "simple" })
    : null)
  const overlay = input.overlay ?? null
  const executors = graph?.executors ?? []
  const failureNodeIds = new Set((overlay?.failureReports ?? []).map((failure) => failure.nodeId))
  const visitedNodeIds = new Set<string>()
  const partialNodeIds = new Set<string>()

  for (const event of overlay?.traceEvents ?? []) {
    for (const nodeId of event.delegationPath) visitedNodeIds.add(nodeId)
    const currentNodeId = event.delegationPath[event.delegationPath.length - 1]
    if (currentNodeId && traceEventNodeResultStatus(event) === "partial_success") {
      partialNodeIds.add(currentNodeId)
    }
  }

  const nodeResults = executors.map((executor) => {
    if (failureNodeIds.has(executor.id)) return nodeResult(executor, "failed")
    if (partialNodeIds.has(executor.id)) return nodeResult(executor, "partial_success")
    if (visitedNodeIds.has(executor.id) || overlay?.run?.entryNodeId === executor.id && overlay?.run?.status === "completed") {
      return nodeResult(executor, "success")
    }
    return nodeResult(executor, "waiting")
  })
  const failures = (overlay?.failureReports ?? []).map((failure) => failureExplanation({
    failure,
    graph,
    overlay,
  }))

  return {
    hasRun: Boolean(overlay?.run),
    runStatus: overlay?.run?.status ?? "waiting",
    nodeResults,
    failures,
    quickActions: buildQuickActions({ topology: input.topology ?? undefined, graph, overlay }),
  }
}

export function ExecutorRunResultPanel({
  topology,
  graph,
  overlay,
  advancedOpen = false,
  onPreviewQuickAction,
  onTraceLayerRequest,
}: ExecutorRunResultPanelProps) {
  const { text } = useUiI18n()
  const [advancedExpanded, setAdvancedExpanded] = React.useState(advancedOpen)
  const isAdvancedOpen = advancedOpen || advancedExpanded
  const model = React.useMemo(
    () => buildExecutorRunResultModel({ topology, graph, overlay }),
    [graph, overlay, topology],
  )
  const observabilityEvidence = React.useMemo(() => collectExecutorObservabilityEvidence(overlay), [overlay])

  return (
    <section
      className="rounded-lg border border-stone-200 bg-white p-4"
      data-testid="executor-run-result-panel"
      data-run-status={model.runStatus}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-stone-950">
            {text("실행 결과", "Run result")}
          </div>
          <div className="mt-1 text-xs text-stone-500">
            {model.hasRun
              ? text("실행자별 상태와 고칠 점을 확인합니다.", "Review each executor state and what to fix.")
              : text("실행 후 결과가 여기에 표시됩니다.", "Results appear here after a run.")}
          </div>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${runStatusTone(model.runStatus)}`}>
          {runStatusLabel(model.runStatus, text)}
        </span>
      </div>

      <div className="mt-3 grid gap-2" data-testid="executor-result-node-status-list">
        {model.nodeResults.length > 0 ? model.nodeResults.map((result) => (
          <div
            key={result.executorId}
            className={`rounded-md border px-2.5 py-2 ${nodeStatusTone(result.status)}`}
            data-testid="executor-result-node-status"
            data-status={result.status}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0 truncate text-xs font-semibold">{result.name}</div>
              <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold">
                {text(result.statusLabelKo, result.statusLabelEn)}
              </span>
            </div>
            <div className="mt-1 text-[11px] leading-4 opacity-80">
              {text(result.detailKo, result.detailEn)}
            </div>
          </div>
        )) : (
          <div className="rounded-md border border-dashed border-stone-200 bg-stone-50 px-3 py-3 text-xs text-stone-500">
            {text("아직 실행자가 없습니다.", "No executors yet.")}
          </div>
        )}
      </div>

      {model.failures.length > 0 ? (
        <div className="mt-3 grid gap-2" data-testid="executor-result-failures">
          {model.failures.map((failure) => (
            <section
              key={failure.failureReportId}
              className="rounded-lg border border-red-100 bg-red-50 p-3 text-red-950"
              data-testid="executor-result-failure"
            >
              <div className="text-xs font-semibold">{text("실패 위치", "Failure location")}</div>
              <div className="mt-1 text-sm font-semibold" data-testid="executor-result-failure-path">
                {text(failure.pathKo, failure.pathEn)}
              </div>
              <div className="mt-3 grid gap-2 text-xs">
                <InfoBlock
                  title={text("실패 이유", "Failure reason")}
                  body={text(failure.reasonKo, failure.reasonEn)}
                  testId="executor-result-failure-reason"
                />
                <div className="rounded-md bg-white/80 px-2.5 py-2" data-testid="executor-result-tried-list">
                  <div className="text-[11px] font-semibold text-red-900">{text("노비가 시도한 것", "What Nobie tried")}</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {failure.triedKo.map((item, index) => (
                      <span key={`${item}:${index}`} className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-900">
                        {text(item, failure.triedEn[index] ?? item)}
                      </span>
                    ))}
                  </div>
                </div>
                <InfoBlock
                  title={text("다음 조치", "Next action")}
                  body={text(failure.nextActionKo, failure.nextActionEn)}
                  testId="executor-result-next-action"
                />
              </div>
            </section>
          ))}
        </div>
      ) : null}

      {model.quickActions.length > 0 ? (
        <section className="mt-3 rounded-lg border border-stone-200 bg-stone-50 p-3" data-testid="executor-result-quick-actions">
          <div className="text-xs font-semibold text-stone-950">
            {text("다음 조치", "Next actions")}
          </div>
          <div className="mt-2 grid gap-2">
            {model.quickActions.map((action) => (
              <div key={action.actionId} className="rounded-md border border-stone-200 bg-white p-2" data-testid="executor-result-quick-action">
                <button
                  type="button"
                  onClick={() => onPreviewQuickAction?.(action)}
                  className="h-8 rounded-md border border-stone-200 bg-white px-2.5 text-xs font-semibold text-stone-800"
                  data-testid={`executor-result-action-${action.actionId}`}
                >
                  {text(action.labelKo, action.labelEn)}
                </button>
                <div className="mt-2 rounded-md bg-stone-50 px-2 py-1.5 text-[11px] leading-4 text-stone-600" data-testid="executor-result-quick-action-preview">
                  <span className="font-semibold text-stone-800">{text("미리보기", "Preview")}: </span>
                  {action.preview.map((item) => item.summary).join(" / ") || text("변경 미리보기 없음", "No change preview")}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <details
        className="mt-3 rounded-lg border border-stone-200 bg-white p-3"
        data-testid="executor-result-advanced-trace"
        open={isAdvancedOpen}
        onToggle={(event) => setAdvancedExpanded(event.currentTarget.open)}
      >
        <summary className="cursor-pointer text-xs font-semibold text-stone-700">
          {text("고급 실행 기록", "Advanced trace")}
        </summary>
        {isAdvancedOpen ? (
          <div className="mt-3 grid gap-3" data-testid="executor-result-raw-trace">
            <button
              type="button"
              onClick={onTraceLayerRequest}
              className="h-8 w-fit rounded-md border border-sky-200 bg-sky-50 px-3 text-xs font-semibold text-sky-800"
              data-testid="executor-result-open-trace-layer"
            >
              {text("Trace 화면으로 이동", "Open trace view")}
            </button>
            {observabilityEvidence.length > 0 ? (
              <section
                className="rounded-md border border-stone-200 bg-stone-50 px-2.5 py-2 text-[11px] leading-4 text-stone-600"
                data-testid="executor-result-observability-evidence"
              >
                <div className="font-semibold text-stone-800">
                  {text("Executor evidence", "Executor evidence")}
                </div>
                <div className="mt-1 grid gap-1">
                  {observabilityEvidence.map((item) => (
                    <div
                      key={`${item.source}:${item.evidenceId}`}
                      data-testid="executor-result-observability-evidence-item"
                      data-source={item.source}
                    >
                      {item.source}: {item.evidenceId}
                      {item.inferenceEvidenceRef ? ` / ${item.inferenceEvidenceRef}` : ""}
                    </div>
                  ))}
                </div>
              </section>
            ) : null}
            <RawTraceList overlay={overlay} />
            <TopologyRunTraceOverlay overlay={overlay} />
          </div>
        ) : null}
      </details>
    </section>
  )
}

interface ExecutorObservabilityEvidenceItem {
  source: "run" | "trace" | "failure"
  evidenceId: string
  inferenceEvidenceRef?: string
}

function collectExecutorObservabilityEvidence(
  overlay?: TopologyRunTraceOverlayInput | null,
): ExecutorObservabilityEvidenceItem[] {
  const items: ExecutorObservabilityEvidenceItem[] = []
  const add = (item: ExecutorObservabilityEvidenceItem | null) => {
    if (!item) return
    if (items.some((current) => current.source === item.source && current.evidenceId === item.evidenceId)) return
    items.push(item)
  }

  add(evidenceItem("run", recordValue(overlay?.run?.metadata, "executorObservability")))
  for (const event of overlay?.traceEvents ?? []) {
    add(evidenceItem("trace", recordValue(event.payload, "executorObservability")))
  }
  for (const failure of overlay?.failureReports ?? []) {
    add(evidenceItem("failure", recordValue(failure.report.partialResult, "executorObservabilityFailure")))
  }
  return items
}

function evidenceItem(
  source: ExecutorObservabilityEvidenceItem["source"],
  value: Record<string, unknown> | null,
): ExecutorObservabilityEvidenceItem | null {
  const evidenceId = stringValue(value?.evidenceId) ?? stringValue(value?.runEvidenceRef)
  if (!evidenceId) return null
  const inferenceEvidenceRef = stringValue(value?.inferenceEvidenceRef)
  return {
    source,
    evidenceId,
    ...(inferenceEvidenceRef ? { inferenceEvidenceRef } : {}),
  }
}

function recordValue(value: unknown, key: string): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const nested = (value as Record<string, unknown>)[key]
  if (!nested || typeof nested !== "object" || Array.isArray(nested)) return null
  return nested as Record<string, unknown>
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined
}

function recordPayload(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function traceEventNodeResultStatus(
  event: NonNullable<TopologyRunTraceOverlayInput["traceEvents"]>[number],
): string | undefined {
  return stringValue(recordPayload(event.payload)?.nodeResultStatus)
    ?? stringValue(recordPayload(event.event?.payload)?.nodeResultStatus)
}

function nodeResult(executor: ExecutorDraft, status: ExecutorRunNodeStatus): ExecutorRunNodeResult {
  if (status === "failed") {
    return {
      executorId: executor.id,
      name: executor.name,
      status,
      statusLabelKo: "실패",
      statusLabelEn: "Failed",
      detailKo: "이 실행자에서 처리가 멈췄습니다.",
      detailEn: "Processing stopped at this executor.",
    }
  }
  if (status === "partial_success") {
    return {
      executorId: executor.id,
      name: executor.name,
      status,
      statusLabelKo: "부분 성공",
      statusLabelEn: "Partial success",
      detailKo: "일부 결과는 만들었지만 추가 확인이 필요합니다.",
      detailEn: "Some output exists, but more review is needed.",
    }
  }
  if (status === "success") {
    return {
      executorId: executor.id,
      name: executor.name,
      status,
      statusLabelKo: "성공",
      statusLabelEn: "Success",
      detailKo: "이 실행자는 처리를 완료했습니다.",
      detailEn: "This executor completed its work.",
    }
  }
  return {
    executorId: executor.id,
    name: executor.name,
    status,
    statusLabelKo: "대기",
    statusLabelEn: "Waiting",
    detailKo: "아직 실행 경로에 도달하지 않았습니다.",
    detailEn: "This executor has not been reached yet.",
  }
}

function failureExplanation(input: {
  failure: NonNullable<TopologyRunTraceOverlayInput["failureReports"]>[number]
  graph: ExecutorGraphWorkspace | null
  overlay: TopologyRunTraceOverlayInput | null
}): ExecutorFailureExplanation {
  const executor = input.graph?.executors.find((item) => item.id === input.failure.nodeId)
  const path = failurePath(input.failure, input.overlay, input.graph)
  const report = input.failure.report
  const reason = failureIssueText(report.issueKind)
  const nextAction = failureNextActionText(report.nextActionKind, report.recoveryActionKind)
  const tried = triedActions(report.exhaustionSummary, input.overlay, input.failure.nodeRunId)

  return {
    failureReportId: input.failure.failureReportId,
    nodeId: input.failure.nodeId,
    nodeName: executor?.name ?? input.failure.nodeId,
    pathKo: path.join(" -> "),
    pathEn: path.join(" -> "),
    reasonKo: reason.ko,
    reasonEn: reason.en,
    triedKo: tried.ko,
    triedEn: tried.en,
    nextActionKo: nextAction.ko,
    nextActionEn: nextAction.en,
  }
}

function failurePath(
  failure: NonNullable<TopologyRunTraceOverlayInput["failureReports"]>[number],
  overlay: TopologyRunTraceOverlayInput | null,
  graph: ExecutorGraphWorkspace | null,
): string[] {
  const byId = new Map(graph?.executors.map((executor) => [executor.id, executor.name]) ?? [])
  const path = overlay?.traceEvents
    .find((event) => event.nodeRunId === failure.nodeRunId && event.phase === failure.failurePhase)
    ?.delegationPath ??
    overlay?.traceEvents
      .filter((event) => event.nodeRunId === failure.nodeRunId)
      .at(-1)
      ?.delegationPath ??
    [failure.nodeId]
  return path.map((nodeId) => byId.get(nodeId) ?? nodeId)
}

function triedActions(
  summary: NonNullable<TopologyRunTraceOverlayInput["failureReports"]>[number]["report"]["exhaustionSummary"],
  overlay: TopologyRunTraceOverlayInput | null,
  nodeRunId: string,
): { ko: string[]; en: string[] } {
  const ko: string[] = []
  const en: string[] = []
  const add = (koValue: string, enValue: string) => {
    ko.push(koValue)
    en.push(enValue)
  }
  if (summary.selfExecutionAttempted) add("직접 처리", "Self execution")
  if (summary.childDelegationAttempted) add("다음 실행자에게 넘기기", "Child delegation")
  if (summary.toolExecutionAttempted) add("도구 실행", "Tool execution")
  if (summary.retryAttempted) add("재시도", "Retry")
  if (summary.fallbackAttempted) add("예외 처리 경로 확인", "Fallback path")
  if (summary.partialSuccessChecked) add("부분 성공 가능성 확인", "Partial success check")
  if (summary.parentRecoveryPossibleChecked) add("상위 복구 가능성 확인", "Parent recovery check")
  for (const toolCall of overlay?.toolCalls.filter((item) => item.nodeRunId === nodeRunId) ?? []) {
    add(`${toolCall.toolId} 실행`, `Tool ${toolCall.toolId}`)
  }
  return ko.length > 0 ? { ko, en } : { ko: ["실행 상태 확인"], en: ["Checked runtime state"] }
}

function buildQuickActions(input: {
  topology?: EnterpriseTopology
  graph: ExecutorGraphWorkspace | null
  overlay: TopologyRunTraceOverlayInput | null
}): ExecutorRunQuickAction[] {
  const failure = input.overlay?.failureReports[0]
  if (!failure) return []
  const failedNode = input.topology?.nodes.find((node) => node.id === failure.nodeId)
  const toolId = input.overlay?.toolCalls.find((toolCall) => toolCall.nodeRunId === failure.nodeRunId)?.toolId ??
    input.graph?.executors.find((executor) => executor.id === failure.nodeId)?.inferredTools[0] ??
    "tool:recommended"
  const fallbackPlan = buildTopologyQuickFixPlans({
    reasonCode: "runtime_failure_report",
    entityId: failure.nodeId,
    entityType: "node",
  }, input.topology)[0]

  const actions: ExecutorRunQuickAction[] = [
    quickAction("add_permission", "권한 추가", "Add permission", [{
      ...createGuiDraftOperationBase("updateNode", {
        operationId: `executor-result:permission:${failure.nodeId}:${toolId}`,
        at: Date.now(),
        label: "도구 권한 추가",
      }),
      nodeId: failure.nodeId,
      patch: {
        allowedToolIds: [...new Set([...(failedNode?.allowedToolIds ?? []), toolId])],
      },
    }]),
    quickAction("pass_partial", "부분 정보로 넘기기", "Pass partial info", [{
      ...createGuiDraftOperationBase("updateNode", {
        operationId: `executor-result:partial:${failure.nodeId}`,
        at: Date.now(),
        label: "부분 성공 허용",
      }),
      nodeId: failure.nodeId,
      patch: {
        failurePolicy: {
          failureReportRequired: failedNode?.failurePolicy?.failureReportRequired ?? true,
          allowPartialSuccess: true,
          fallbackNodeIds: failedNode?.failurePolicy?.fallbackNodeIds ?? [],
        },
        recoveryPolicy: {
          retryAllowed: failedNode?.recoveryPolicy?.retryAllowed ?? false,
          redelegationAllowed: failedNode?.recoveryPolicy?.redelegationAllowed ?? true,
          fallbackAllowed: failedNode?.recoveryPolicy?.fallbackAllowed ?? false,
          partialSuccessAllowed: true,
        },
      },
    }]),
    quickAction(
      "move_to_exception",
      "예외 처리로 이동",
      "Move to exception handler",
      fallbackPlan?.operations ?? fallbackOperations(failure.nodeId),
    ),
    quickAction("revise_description", "설명 수정", "Revise description", [{
      ...createGuiDraftOperationBase("updateNode", {
        operationId: `executor-result:revise-description:${failure.nodeId}`,
        at: Date.now(),
        label: "실행자 설명 보강",
      }),
      nodeId: failure.nodeId,
      patch: {
        description: `${failedNode?.description ?? ""}`.trim() || "실패 조건과 필요한 입력을 더 구체적으로 설명합니다.",
      },
    }]),
  ]

  return actions
}

function fallbackOperations(nodeId: string): EnterpriseTopologyGuiOperation[] {
  const fallbackNodeId = `node:fallback:${nodeId}`.replace(/[^a-zA-Z0-9:_-]+/g, "-")
  return [
    {
      schemaVersion: ENTERPRISE_TOPOLOGY_GUI_DRAFT_SCHEMA_VERSION,
      operationId: `executor-result:fallback-node:${nodeId}`,
      op: "createNode",
      at: Date.now(),
      label: "예외 처리 실행자 추가",
      nodeId: fallbackNodeId,
      name: "예외 처리 담당자",
      nodeType: "review_node",
    },
    {
      ...createGuiDraftOperationBase("createRelation", {
        operationId: `executor-result:fallback-relation:${nodeId}:${fallbackNodeId}`,
        at: Date.now(),
        label: "예외 처리로 이동",
      }),
      relationId: `relation:fallback:${nodeId}:${fallbackNodeId}`.replace(/[^a-zA-Z0-9:_-]+/g, "-"),
      relationType: "delegates_to",
      from: { entityType: "node", id: nodeId },
      to: { entityType: "node", id: fallbackNodeId },
      label: "예외 처리",
    },
  ]
}

function quickAction(
  actionId: ExecutorRunQuickAction["actionId"],
  labelKo: ExecutorRunQuickAction["labelKo"],
  labelEn: ExecutorRunQuickAction["labelEn"],
  operations: EnterpriseTopologyGuiOperation[],
): ExecutorRunQuickAction {
  return {
    actionId,
    labelKo,
    labelEn,
    operations,
    preview: operations.map(operationPreview),
  }
}

function operationPreview(operation: EnterpriseTopologyGuiOperation): EnterpriseTopologyQuickFixOperationPreview {
  if (operation.op === "createNode") {
    return {
      operationId: operation.operationId,
      op: operation.op,
      targetId: operation.nodeId,
      summary: `node 생성: ${operation.name ?? operation.nodeId}`,
    }
  }
  if (operation.op === "updateNode") {
    return {
      operationId: operation.operationId,
      op: operation.op,
      targetId: operation.nodeId,
      summary: `node 수정: ${operation.nodeId}`,
    }
  }
  if (operation.op === "moveNode") {
    return {
      operationId: operation.operationId,
      op: operation.op,
      targetId: operation.nodeId,
      summary: `node 이동: ${operation.nodeId}`,
    }
  }
  if (operation.op === "deleteNode") {
    return {
      operationId: operation.operationId,
      op: operation.op,
      targetId: operation.nodeId,
      summary: `node 삭제: ${operation.nodeId}`,
    }
  }
  if (operation.op === "createRelation") {
    return {
      operationId: operation.operationId,
      op: operation.op,
      targetId: operation.relationId,
      summary: `관계 생성: ${operation.from.id} -> ${operation.to.id}`,
    }
  }
  if (operation.op === "updateRelation") {
    return {
      operationId: operation.operationId,
      op: operation.op,
      targetId: operation.relationId,
      summary: `관계 수정: ${operation.relationId}`,
    }
  }
  return {
    operationId: operation.operationId,
    op: operation.op,
    targetId: operation.relationId,
    summary: `관계 보관: ${operation.relationId}`,
  }
}

function RawTraceList({ overlay }: { overlay?: TopologyRunTraceOverlayInput | null }) {
  return (
    <div className="rounded-md border border-stone-200 bg-stone-50 p-2 text-[11px] leading-4 text-stone-600">
      {(overlay?.traceEvents ?? []).map((event) => (
        <div key={event.traceEventId} data-testid="executor-result-raw-trace-event">
          {event.traceEventId} / {event.nodeRunId} / {event.workOrderId}
        </div>
      ))}
      {(overlay?.failureReports ?? []).map((failure) => (
        <div key={failure.failureReportId} data-testid="executor-result-raw-failure-report">
          {failure.failureReportId} / {failure.nodeRunId} / {failure.workOrderId}
        </div>
      ))}
    </div>
  )
}

function InfoBlock({ title, body, testId }: { title: string; body: string; testId: string }) {
  return (
    <div className="rounded-md bg-white/80 px-2.5 py-2" data-testid={testId}>
      <div className="text-[11px] font-semibold text-red-900">{title}</div>
      <div className="mt-1 leading-5 text-red-950">{body}</div>
    </div>
  )
}

function failureIssueText(issueKind: FailureIssueKind | undefined): { ko: string; en: string } {
  switch (issueKind) {
    case "success_criteria_unmet":
      return {
        ko: "완료 기준을 만족하지 못해 실패했습니다.",
        en: "The run failed because success criteria were still unmet.",
      }
    case "runtime_risk":
      return {
        ko: "실행 중 남은 위험이나 누락된 조건이 있어 멈췄습니다.",
        en: "The run stopped because runtime risks or gaps remain.",
      }
    case "permission_or_tool_blocked":
      return {
        ko: "필요한 권한이나 도구 조건이 맞지 않아 처리를 끝내지 못했습니다.",
        en: "The run could not finish because a required permission or tool condition was blocked.",
      }
    case "execution_incomplete":
      return {
        ko: "실행을 완료하지 못했습니다.",
        en: "The run could not complete.",
      }
    case "unknown":
    case undefined:
      return {
        ko: "실행을 완료하지 못했습니다. 자세한 원인은 실행 기록에서 확인할 수 있습니다.",
        en: "The run could not complete. Detailed evidence is available in the trace.",
      }
  }
}

function failureNextActionText(
  nextActionKind: FailureNextActionKind | undefined,
  recoveryActionKind: FailureRecoveryActionKind | undefined,
): { ko: string; en: string } {
  switch (nextActionKind ?? nextActionKindFromRecovery(recoveryActionKind)) {
    case "add_permission":
      return {
        ko: "필요한 권한을 추가한 뒤 다시 실행하세요.",
        en: "Add the required permission, then run it again.",
      }
    case "pass_partial":
      return {
        ko: "부분 결과를 다음 실행자에게 넘길지 결정하세요.",
        en: "Decide whether to pass the partial result to the next executor.",
      }
    case "add_fallback":
      return {
        ko: "예외 처리 경로를 추가해 실패 시 넘길 곳을 정하세요.",
        en: "Add a fallback path so the work has somewhere to go when this fails.",
      }
    case "revise_description":
      return {
        ko: "실행자 설명을 더 구체적으로 고친 뒤 다시 실행하세요.",
        en: "Revise the executor description, then run it again.",
      }
    case "user_review":
      return {
        ko: "최종 결과를 사람이 검토해야 하는지 확인하세요.",
        en: "Check whether the final result needs human review.",
      }
    case "review_trace":
    case undefined:
      return {
        ko: "실행 기록에서 선택된 실행자, 시도한 작업, 남은 조건을 확인하세요.",
        en: "Review the trace for the selected executor, attempted work, and remaining conditions.",
      }
  }
}

function nextActionKindFromRecovery(
  recoveryActionKind: FailureRecoveryActionKind | undefined,
): FailureNextActionKind | undefined {
  switch (recoveryActionKind) {
    case "add_tool_permission":
      return "add_permission"
    case "add_fallback_path":
      return "add_fallback"
    case "pass_partial_result":
      return "pass_partial"
    case "retry":
    case "delegate_to_next_executor":
    case "return_to_parent":
    case "review_trace":
    case "none":
      return "review_trace"
    case undefined:
      return undefined
  }
}

function runStatusTone(status: string): string {
  if (status === "failed") return "bg-red-100 text-red-800"
  if (status === "completed") return "bg-emerald-100 text-emerald-800"
  if (status === "running") return "bg-sky-100 text-sky-800"
  return "bg-stone-100 text-stone-700"
}

function runStatusLabel(status: string, text: (ko: string, en: string) => string): string {
  if (status === "failed") return text("실패", "Failed")
  if (status === "completed") return text("완료", "Completed")
  if (status === "running") return text("실행 중", "Running")
  return text("대기", "Waiting")
}

function nodeStatusTone(status: ExecutorRunNodeStatus): string {
  if (status === "failed") return "border-red-200 bg-red-50 text-red-900"
  if (status === "partial_success") return "border-amber-200 bg-amber-50 text-amber-900"
  if (status === "success") return "border-emerald-200 bg-emerald-50 text-emerald-900"
  return "border-stone-200 bg-stone-50 text-stone-600"
}
