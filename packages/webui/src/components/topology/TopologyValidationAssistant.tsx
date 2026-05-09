import * as React from "react"
import type {
  EnterpriseEntityRef,
  EnterpriseMetadataValue,
  EnterpriseTopology,
  EnterpriseTopologyValidationIssue,
  TopologyValidatorSeverity,
} from "../../contracts/enterprise-topology"
import {
  ENTERPRISE_TOPOLOGY_GUI_DRAFT_SCHEMA_VERSION,
  createGuiDraftOperationBase,
  type EnterpriseTopologyGuiOperation,
  type EnterpriseTopologyQuickFixId,
  type EnterpriseTopologyQuickFixOperationPlan,
  type EnterpriseTopologyQuickFixOperationPreview,
} from "../../lib/enterprise-topology-operations"
import { useUiI18n } from "../../lib/ui-i18n"
import type { TopologyRunTraceOverlayInput } from "./TopologyRunTraceOverlay"

export type TopologyWorkspaceIssueSource = "validation" | "compile" | "runtime" | "gap"

export interface TopologyWorkspaceIssue {
  id: string
  source: TopologyWorkspaceIssueSource
  severity: TopologyValidatorSeverity
  title: string
  detail: string
  reasonCode: string
  targetId: string | null
  runId?: string
  validationIssue?: EnterpriseTopologyValidationIssue
  quickFixPlans: EnterpriseTopologyQuickFixOperationPlan[]
}

const SEVERITIES: TopologyValidatorSeverity[] = ["invalid", "blocked", "warning", "info"]

const SEVERITY_LABELS: Record<TopologyValidatorSeverity, { ko: string; en: string }> = {
  invalid: { ko: "유효하지 않음", en: "Invalid" },
  blocked: { ko: "차단", en: "Blocked" },
  warning: { ko: "경고", en: "Warning" },
  info: { ko: "정보", en: "Info" },
}

const SOURCE_LABELS: Record<TopologyWorkspaceIssueSource, { ko: string; en: string }> = {
  validation: { ko: "검증", en: "Validation" },
  compile: { ko: "실행 준비", en: "Compile" },
  runtime: { ko: "실행 실패", en: "Runtime" },
  gap: { ko: "개선", en: "Gap" },
}

const QUICK_FIX_LABELS: Record<EnterpriseTopologyQuickFixId, string> = {
  set_start_node: "시작 노드 지정",
  add_child_task: "하위 업무 추가",
  add_approval_step: "승인 단계 추가",
  connect_selected_nodes: "선택 노드 연결",
  add_tool_permission: "도구 권한 추가",
  add_fallback_path: "fallback path 추가",
  set_output_preset: "output preset 설정",
}

function metadataRecord(value: EnterpriseMetadataValue | undefined): Record<string, EnterpriseMetadataValue | undefined> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null
}

function nodeById(topology: EnterpriseTopology | undefined, nodeId: string | undefined) {
  if (!topology || !nodeId) return undefined
  return topology.nodes.find((node) => node.id === nodeId)
}

function defaultApprovalHolder(topology: EnterpriseTopology | undefined, nodeId: string | undefined) {
  const node = nodeById(topology, nodeId)
  if (
    node?.owner &&
    (node.owner.entityType === "position" ||
      node.owner.entityType === "person" ||
      node.owner.entityType === "org_unit")
  ) {
    return node.owner
  }
  if (topology?.positions[0]) return { entityType: "position" as const, id: topology.positions[0].id }
  if (topology?.persons[0]) return { entityType: "person" as const, id: topology.persons[0].id }
  if (topology?.orgUnits[0]) return { entityType: "org_unit" as const, id: topology.orgUnits[0].id }
  return undefined
}

function relationId(prefix: string, sourceId: string, targetId: string): string {
  return `relation:${prefix}:${sourceId}:${targetId}`.replace(/[^a-zA-Z0-9:_-]+/g, "-")
}

function nodeId(prefix: string, sourceId: string): string {
  return `node:${prefix}:${sourceId}`.replace(/[^a-zA-Z0-9:_-]+/g, "-")
}

function quickFixPreview(operation: EnterpriseTopologyGuiOperation): EnterpriseTopologyQuickFixOperationPreview {
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
      summary: `node 위치 변경: ${operation.nodeId}`,
    }
  }
  if (operation.op === "deleteNode") {
    return {
      operationId: operation.operationId,
      op: operation.op,
      targetId: operation.nodeId,
      summary: `node 보관: ${operation.nodeId}`,
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

function quickFixPlan(
  quickFixId: EnterpriseTopologyQuickFixId,
  operations: EnterpriseTopologyGuiOperation[],
  label = QUICK_FIX_LABELS[quickFixId],
): EnterpriseTopologyQuickFixOperationPlan {
  return {
    quickFixId,
    label,
    operations,
    preview: operations.map(quickFixPreview),
  }
}

export function topologyIssueTargetId(issue: EnterpriseTopologyValidationIssue): string | null {
  if (issue.relationId) return issue.relationId
  if (issue.entityId && issue.entityType) return `${issue.entityType}:${issue.entityId}`
  if (issue.sourceEntityId) return issue.sourceEntityId
  return null
}

export function topologyWorkspaceIssueTargetId(issue: TopologyWorkspaceIssue): string | null {
  return issue.targetId
}

export function groupTopologyIssuesBySeverity(
  issues: readonly EnterpriseTopologyValidationIssue[],
): Record<TopologyValidatorSeverity, EnterpriseTopologyValidationIssue[]> {
  return {
    invalid: issues.filter((issue) => issue.severity === "invalid"),
    blocked: issues.filter((issue) => issue.severity === "blocked"),
    warning: issues.filter((issue) => issue.severity === "warning"),
    info: issues.filter((issue) => issue.severity === "info"),
  }
}

function fallbackOperations(input: {
  sourceNodeId: string
  at: number
  topology?: EnterpriseTopology
  reasonLabel?: string
}): EnterpriseTopologyGuiOperation[] {
  const fallbackNodeId = nodeId("fallback", input.sourceNodeId)
  const node = nodeById(input.topology, input.sourceNodeId)
  return [
    {
      schemaVersion: ENTERPRISE_TOPOLOGY_GUI_DRAFT_SCHEMA_VERSION,
      operationId: `quickfix:fallback-node:${input.sourceNodeId}`,
      op: "createNode",
      at: input.at,
      label: "fallback node 추가",
      nodeId: fallbackNodeId,
      name: input.reasonLabel ?? "Fallback 처리",
      nodeType: "review_node",
    },
    {
      ...createGuiDraftOperationBase("createRelation", {
        operationId: `quickfix:fallback-relation:${input.sourceNodeId}:${fallbackNodeId}`,
        at: input.at,
        label: "fallback path 연결",
      }),
      relationId: relationId("fallback", input.sourceNodeId, fallbackNodeId),
      relationType: "delegates_to",
      from: { entityType: "node", id: input.sourceNodeId },
      to: { entityType: "node", id: fallbackNodeId },
      label: "fallback",
    },
    {
      ...createGuiDraftOperationBase("updateNode", {
        operationId: `quickfix:fallback-policy:${input.sourceNodeId}`,
        at: input.at,
        label: "fallback 정책 설정",
      }),
      nodeId: input.sourceNodeId,
      patch: {
        failurePolicy: {
          failureReportRequired: node?.failurePolicy?.failureReportRequired ?? true,
          allowPartialSuccess: node?.failurePolicy?.allowPartialSuccess ?? true,
          fallbackNodeIds: [...new Set([...(node?.failurePolicy?.fallbackNodeIds ?? []), fallbackNodeId])],
        },
        recoveryPolicy: {
          retryAllowed: node?.recoveryPolicy?.retryAllowed ?? false,
          redelegationAllowed: node?.recoveryPolicy?.redelegationAllowed ?? true,
          fallbackAllowed: true,
          partialSuccessAllowed: node?.recoveryPolicy?.partialSuccessAllowed ?? true,
        },
      },
    },
  ]
}

function outputPresetOperation(input: {
  nodeId: string
  at: number
  topology?: EnterpriseTopology
}): EnterpriseTopologyGuiOperation {
  const node = nodeById(input.topology, input.nodeId)
  const metadata = metadataRecord(node?.template?.metadata)
  return {
    ...createGuiDraftOperationBase("updateNode", {
      operationId: `quickfix:output-preset:${input.nodeId}`,
      at: input.at,
      label: "output preset 설정",
    }),
    nodeId: input.nodeId,
    patch: {
      template: {
        templateId: node?.template?.templateId ?? "topology-template:node:general-work",
        source: node?.template?.source ?? "user_preset",
        fixedRoleCatalog: false,
        metadata: {
          ...(metadata ?? {}),
          outputPreset: "concise_result_summary",
          successCriteria: ["결과 요약", "후속 조치 기록"],
        },
      },
    },
  }
}

export function buildTopologyQuickFixPlans(
  issue: Pick<EnterpriseTopologyValidationIssue, "reasonCode" | "entityId" | "entityType" | "relationId" | "refId" | "refType" | "sourceEntityId" | "targetEntityId">,
  topology?: EnterpriseTopology,
): EnterpriseTopologyQuickFixOperationPlan[] {
  const at = Date.now()

  if (issue.reasonCode === "no_entry_node") {
    return [quickFixPlan("set_start_node", [{
      schemaVersion: ENTERPRISE_TOPOLOGY_GUI_DRAFT_SCHEMA_VERSION,
      operationId: "quickfix:start-node:create",
      op: "createNode",
      at,
      label: "시작 노드 지정",
      nodeId: "node:start",
      name: "시작 업무",
      nodeType: "function",
    }])]
  }

  if (issue.reasonCode === "connect_selected_nodes" && issue.sourceEntityId && issue.targetEntityId) {
    return [quickFixPlan("connect_selected_nodes", [{
      ...createGuiDraftOperationBase("createRelation", {
        operationId: `quickfix:connect:${issue.sourceEntityId}:${issue.targetEntityId}`,
        at,
        label: "선택 노드 연결",
      }),
      relationId: relationId("delegates_to", issue.sourceEntityId, issue.targetEntityId),
      relationType: "delegates_to",
      from: { entityType: "node", id: issue.sourceEntityId },
      to: { entityType: "node", id: issue.targetEntityId },
      label: "다음 업무",
    }])]
  }

  if (issue.reasonCode === "approval_authority_missing" && issue.entityId) {
    const holder = defaultApprovalHolder(topology, issue.entityId)
    const blockedRelation = topology?.relations.find((relation) => relation.id === issue.relationId)
    const target = blockedRelation?.to ?? { entityType: "node" as const, id: issue.entityId }
    if (holder) {
      return [quickFixPlan("add_approval_step", [{
        ...createGuiDraftOperationBase("createRelation", {
          operationId: `quickfix:approval-authority:${holder.id}:${target.id}`,
          at,
          label: "승인 관계 추가",
        }),
        relationId: relationId("approves", holder.id, target.id),
        relationType: "approves",
        from: holder,
        to: target,
        label: "승인",
      }], "승인 단계 추가")]
    }

    return [quickFixPlan("add_approval_step", [{
      schemaVersion: ENTERPRISE_TOPOLOGY_GUI_DRAFT_SCHEMA_VERSION,
      operationId: `quickfix:approval-review-node:${issue.entityId}`,
      op: "createNode",
      at,
      label: "승인 검토 노드 추가",
      nodeId: nodeId("approval-review", issue.entityId),
      name: "승인 검토 노드",
      nodeType: "approval_node",
    }])]
  }

  if (issue.reasonCode === "empty_process_steps" && issue.entityId) {
    return [quickFixPlan("add_child_task", [{
      schemaVersion: ENTERPRISE_TOPOLOGY_GUI_DRAFT_SCHEMA_VERSION,
      operationId: `quickfix:delegation-target:${issue.entityId}`,
      op: "createNode",
      at,
      label: "하위 업무 추가",
      nodeId: nodeId("delegation-target", issue.entityId),
      name: "새 하위 업무",
      nodeType: "process_step",
    }])]
  }

  if (issue.reasonCode === "invalid_relation_endpoint" && issue.relationId) {
    return [quickFixPlan("connect_selected_nodes", [{
      ...createGuiDraftOperationBase("updateRelation", {
        operationId: `quickfix:team-org-relation:${issue.relationId}`,
        at,
        label: "소속 관계로 수정",
      }),
      relationId: issue.relationId,
      patch: {
        relationType: "belongs_to",
        label: "소속",
      },
    }], "선택 노드 연결")]
  }

  if ((issue.reasonCode === "fallback_path_missing" || issue.reasonCode === "runtime_failure_report") && issue.entityId) {
    return [quickFixPlan("add_fallback_path", fallbackOperations({
      sourceNodeId: issue.entityId,
      topology,
      at,
    }))]
  }

  if ((issue.reasonCode === "missing_success_criteria" || issue.reasonCode === "output_preset_missing") && issue.entityId) {
    return [quickFixPlan("set_output_preset", [outputPresetOperation({
      nodeId: issue.entityId,
      topology,
      at,
    })])]
  }

  return []
}

export function buildTopologyQuickFixOperations(
  issue: EnterpriseTopologyValidationIssue,
  topology?: EnterpriseTopology,
): EnterpriseTopologyGuiOperation[] {
  return buildTopologyQuickFixPlans(issue, topology)[0]?.operations ?? []
}

function validationIssueTitle(issue: EnterpriseTopologyValidationIssue): string {
  if (issue.reasonCode === "tool_permission_missing") return "도구 권한이 빠져 있습니다."
  if (issue.reasonCode === "system_permission_missing") return "데이터/시스템 권한이 빠져 있습니다."
  if (issue.reasonCode === "approval_authority_missing") return "승인자를 연결해야 합니다."
  if (issue.reasonCode === "missing_success_criteria") return "완료 기준이 필요합니다."
  if (issue.reasonCode === "invalid_relation_endpoint") return "연결 종류가 맞지 않습니다."
  return issue.message
}

function gapRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function gapDetailRecord(value: Record<string, unknown>): Record<string, unknown> {
  return value.detail && typeof value.detail === "object" && !Array.isArray(value.detail)
    ? value.detail as Record<string, unknown>
    : {}
}

function gapSeverity(value: unknown): TopologyValidatorSeverity {
  if (value === "critical" || value === "high") return "blocked"
  if (value === "medium") return "warning"
  if (value === "low" || value === "info") return "info"
  return "warning"
}

function entityRefFromGap(value: unknown): EnterpriseEntityRef | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (typeof record.entityType !== "string" || typeof record.id !== "string") return null
  return { entityType: record.entityType, id: record.id } as EnterpriseEntityRef
}

function gapRelatedEntities(record: Record<string, unknown>): EnterpriseEntityRef[] {
  return Array.isArray(record.relatedEntities)
    ? record.relatedEntities.map(entityRefFromGap).filter((ref): ref is EnterpriseEntityRef => Boolean(ref))
    : []
}

function gapTargetId(record: Record<string, unknown>): string | null {
  const entities = gapRelatedEntities(record)
  const node = entities.find((entity) => entity.entityType === "node")
  if (node) return `node:${node.id}`
  const first = entities[0]
  if (first) return `${first.entityType}:${first.id}`
  const nodeIdValue = typeof record.nodeId === "string"
    ? record.nodeId
    : typeof record.targetNodeId === "string"
      ? record.targetNodeId
      : undefined
  return nodeIdValue ? `node:${nodeIdValue}` : null
}

export function buildTopologyWorkspaceIssues(input: {
  validationIssues?: EnterpriseTopologyValidationIssue[]
  compileIssues?: EnterpriseTopologyValidationIssue[]
  runtimeOverlay?: TopologyRunTraceOverlayInput | null
  gapFindings?: unknown[]
  topology?: EnterpriseTopology | null
}): TopologyWorkspaceIssue[] {
  const topology = input.topology ?? undefined
  const issues: TopologyWorkspaceIssue[] = []

  for (const [source, sourceIssues] of [
    ["validation", input.validationIssues ?? []],
    ["compile", input.compileIssues ?? []],
  ] as const) {
    sourceIssues.forEach((issue, index) => {
      issues.push({
        id: `${source}:${issue.path}:${issue.reasonCode}:${index}`,
        source,
        severity: issue.severity,
        title: validationIssueTitle(issue),
        detail: issue.message,
        reasonCode: issue.reasonCode,
        targetId: topologyIssueTargetId(issue),
        validationIssue: issue,
        quickFixPlans: buildTopologyQuickFixPlans(issue, topology),
      })
    })
  }

  for (const failure of input.runtimeOverlay?.failureReports ?? []) {
    const syntheticIssue = {
      reasonCode: "runtime_failure_report",
      entityId: failure.nodeId,
      entityType: "node",
    } satisfies Pick<EnterpriseTopologyValidationIssue, "reasonCode" | "entityId" | "entityType">
    issues.push({
      id: `runtime:${failure.failureReportId}`,
      source: "runtime",
      severity: "blocked",
      title: "실행 실패를 복구해야 합니다.",
      detail: failure.report.recommendedAction,
      reasonCode: "runtime_failure_report",
      targetId: `node:${failure.nodeId}`,
      runId: failure.topologyRunId,
      quickFixPlans: buildTopologyQuickFixPlans(syntheticIssue, topology),
    })
  }

  for (const [index, finding] of (input.gapFindings ?? []).entries()) {
    const record = gapRecord(finding)
    const detail = gapDetailRecord(record)
    const targetId = gapTargetId(record)
    const entityId = targetId?.startsWith("node:") ? targetId.slice("node:".length) : undefined
    const reasonCode = typeof detail.reasonCode === "string"
      ? detail.reasonCode
      : typeof record.reasonCode === "string"
        ? record.reasonCode
        : typeof record.findingKind === "string"
          ? record.findingKind
          : "gap_finding"
    issues.push({
      id: `gap:${reasonCode}:${index}`,
      source: "gap",
      severity: gapSeverity(record.severity),
      title: typeof record.summary === "string" ? record.summary : typeof record.title === "string" ? record.title : "개선 후보가 있습니다.",
      detail: typeof record.recommendation === "string"
        ? record.recommendation
        : typeof record.message === "string"
          ? record.message
          : typeof record.detail === "string"
            ? record.detail
            : reasonCode,
      reasonCode,
      targetId,
      quickFixPlans: entityId
        ? buildTopologyQuickFixPlans({ reasonCode: "fallback_path_missing", entityId, entityType: "node" }, topology)
        : [],
    })
  }

  return issues
}

function severityTone(severity: TopologyValidatorSeverity): string {
  if (severity === "invalid") return "border-red-200 bg-red-50 text-red-900"
  if (severity === "blocked") return "border-amber-200 bg-amber-50 text-amber-900"
  if (severity === "warning") return "border-yellow-200 bg-yellow-50 text-yellow-900"
  return "border-stone-200 bg-stone-50 text-stone-700"
}

function sourceTone(source: TopologyWorkspaceIssueSource): string {
  if (source === "runtime") return "bg-red-100 text-red-800"
  if (source === "compile") return "bg-sky-100 text-sky-800"
  if (source === "gap") return "bg-purple-100 text-purple-800"
  return "bg-stone-100 text-stone-700"
}

function sourceOrder(source: TopologyWorkspaceIssueSource): number {
  if (source === "runtime") return 0
  if (source === "compile") return 1
  if (source === "validation") return 2
  return 3
}

function issueSortKey(issue: TopologyWorkspaceIssue): string {
  return `${sourceOrder(issue.source)}:${SEVERITIES.indexOf(issue.severity)}:${issue.reasonCode}:${issue.id}`
}

function uniqueIssueCountBySource(issues: TopologyWorkspaceIssue[]): Record<TopologyWorkspaceIssueSource, number> {
  return {
    validation: issues.filter((issue) => issue.source === "validation").length,
    compile: issues.filter((issue) => issue.source === "compile").length,
    runtime: issues.filter((issue) => issue.source === "runtime").length,
    gap: issues.filter((issue) => issue.source === "gap").length,
  }
}

function firstTargetPreview(plan: EnterpriseTopologyQuickFixOperationPlan): string {
  return plan.preview.map((item) => item.summary).join(" / ")
}

export function TopologyValidationAssistant({
  issues,
  topology,
  compileIssues = [],
  runtimeOverlay,
  gapFindings = [],
  onSelectTarget,
  onApplyQuickFix,
}: {
  issues: EnterpriseTopologyValidationIssue[]
  topology?: EnterpriseTopology | null
  compileIssues?: EnterpriseTopologyValidationIssue[]
  runtimeOverlay?: TopologyRunTraceOverlayInput | null
  gapFindings?: unknown[]
  onSelectTarget?: (targetId: string) => void
  onApplyQuickFix?: (operations: EnterpriseTopologyGuiOperation[]) => void
}) {
  const { text } = useUiI18n()
  const workspaceIssues = React.useMemo(
    () => buildTopologyWorkspaceIssues({
      validationIssues: issues,
      compileIssues,
      runtimeOverlay,
      gapFindings,
      topology,
    }).sort((left, right) => issueSortKey(left).localeCompare(issueSortKey(right))),
    [compileIssues, gapFindings, issues, runtimeOverlay, topology],
  )
  const counts = uniqueIssueCountBySource(workspaceIssues)

  return (
    <section
      className="rounded-lg border border-stone-200 bg-white p-4"
      data-testid="enterprise-topology-validation-assistant"
    >
      <div data-testid="topology-workspace-issue-drawer">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-stone-950">
              {text("고칠 점", "Issues")}
            </div>
            <div className="mt-1 text-xs text-stone-500">
              {workspaceIssues.length === 0
                ? text("표시할 문제가 없습니다.", "No issues to show.")
                : text("문제를 선택해 canvas 대상과 빠른 수정을 확인합니다.", "Select an issue to inspect target and quick fixes.")}
            </div>
          </div>
          <span className="rounded-full bg-stone-100 px-2.5 py-1 text-xs font-semibold text-stone-700">
            {workspaceIssues.length}
          </span>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {(["validation", "compile", "runtime", "gap"] as const).map((source) => (
            <span
              key={source}
              className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${sourceTone(source)}`}
              data-testid={`topology-workspace-issue-source-${source}`}
            >
              {text(SOURCE_LABELS[source].ko, SOURCE_LABELS[source].en)} {counts[source]}
            </span>
          ))}
        </div>

        <div className="mt-3 grid gap-2">
          {workspaceIssues.map((issue) => {
            const primaryPlan = issue.quickFixPlans[0]
            return (
              <div
                key={issue.id}
                className={`rounded-lg border p-3 ${severityTone(issue.severity)}`}
                data-testid={`topology-workspace-issue-${issue.source}`}
                data-target-id={issue.targetId ?? undefined}
              >
                <div className="flex items-start justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => issue.targetId ? onSelectTarget?.(issue.targetId) : undefined}
                    className="min-w-0 text-left"
                    data-testid={`topology-validation-issue-${issue.reasonCode}`}
                  >
                    <span className="block text-xs font-semibold text-stone-950">{issue.title}</span>
                    <span className="mt-1 block text-[11px] leading-4 text-stone-600">{issue.detail}</span>
                  </button>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${sourceTone(issue.source)}`}>
                    {text(SOURCE_LABELS[issue.source].ko, SOURCE_LABELS[issue.source].en)}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap gap-1 text-[11px] text-stone-500">
                  <span>{issue.reasonCode}</span>
                  <span>{text(SEVERITY_LABELS[issue.severity].ko, SEVERITY_LABELS[issue.severity].en)}</span>
                  {issue.targetId ? <span>{issue.targetId}</span> : null}
                </div>

                {primaryPlan ? (
                  <div className="mt-2 rounded-md border border-white/70 bg-white/80 p-2" data-testid={`topology-quickfix-preview-${issue.reasonCode}`}>
                    <div className="text-[11px] font-semibold text-stone-700">
                      {text("미리보기", "Preview")}: {primaryPlan.label}
                    </div>
                    <div className="mt-1 text-[11px] leading-4 text-stone-500">
                      {firstTargetPreview(primaryPlan)}
                    </div>
                    <button
                      type="button"
                      onClick={() => onApplyQuickFix?.(primaryPlan.operations)}
                      className="mt-2 rounded-md bg-stone-900 px-2.5 py-1 text-[11px] font-semibold text-white"
                      data-testid={`topology-validation-quickfix-${issue.reasonCode}`}
                    >
                      {primaryPlan.label}
                    </button>
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
