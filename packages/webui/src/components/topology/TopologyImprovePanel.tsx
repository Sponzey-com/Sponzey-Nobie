import * as React from "react"
import type {
  EnterpriseEntityRef,
  EnterpriseRelationType,
  EnterpriseTopology,
} from "../../contracts/enterprise-topology"
import { ENTERPRISE_RELATION_TYPES } from "../../contracts/enterprise-topology"
import {
  ENTERPRISE_TOPOLOGY_GUI_DRAFT_SCHEMA_VERSION,
  createGuiDraftOperationBase,
  type EnterpriseTopologyGuiOperation,
  type EnterpriseTopologyQuickFixId,
  type EnterpriseTopologyQuickFixOperationPlan,
  type EnterpriseTopologyQuickFixOperationPreview,
  type EnterpriseTopologyObservedEdgeRecord,
} from "../../lib/enterprise-topology-operations"
import { useUiI18n } from "../../lib/ui-i18n"
import type { TopologyRunTraceOverlayInput } from "./TopologyRunTraceOverlay"

export type TopologyImproveCategory =
  | "execution_drift"
  | "frequent_failure"
  | "blocked_connection"
  | "permission"
  | "tool"
  | "failure_policy"

export interface TopologyImproveFindingView {
  id: string
  kind: string
  severity: string
  category: TopologyImproveCategory
  categoryLabelKo: string
  categoryLabelEn: string
  title: string
  detail: string
  evidenceKo: string
  evidenceEn: string
  recommendedActionKo: string
  recommendedActionEn: string
  failureCount: number | null
  recentFailureReason: string | null
  targetId: string | null
  relatedEntities: EnterpriseEntityRef[]
  actionPlans: EnterpriseTopologyQuickFixOperationPlan[]
}

export interface TopologyImprovePendingPreview {
  findingId: string
  quickFixId: EnterpriseTopologyQuickFixId
}

export type TopologyImprovePreviewIntent = "preview" | "apply" | "cancel"

export interface TopologyImprovePreviewTransition {
  pendingPreview: TopologyImprovePendingPreview | null
  operations: EnterpriseTopologyGuiOperation[]
  shouldApply: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function entityRef(value: unknown): EnterpriseEntityRef | null {
  if (!isRecord(value) || typeof value.entityType !== "string" || typeof value.id !== "string") return null
  return { entityType: value.entityType, id: value.id } as EnterpriseEntityRef
}

function entityRefKey(ref: EnterpriseEntityRef): string {
  return `${ref.entityType}:${ref.id}`
}

function sanitizeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9:_-]+/g, "-")
}

function relationType(value: unknown, fallback: EnterpriseRelationType = "delegates_to"): EnterpriseRelationType {
  return typeof value === "string" && ENTERPRISE_RELATION_TYPES.includes(value as EnterpriseRelationType)
    ? value as EnterpriseRelationType
    : fallback
}

function relationTypeForObservedEdge(edge: EnterpriseTopologyObservedEdgeRecord): EnterpriseRelationType {
  if (edge.edgeKind === "tool_call") return "uses_tool"
  if (edge.edgeKind === "observed_owner") return "owns"
  return "delegates_to"
}

function nodeLabel(topology: EnterpriseTopology | null | undefined, nodeId: string): string {
  const node = topology?.nodes.find((item) => item.id === nodeId)
  return node?.displayName ?? node?.name ?? nodeId
}

function entityLabel(ref: EnterpriseEntityRef, topology?: EnterpriseTopology | null): string {
  if (ref.entityType === "node") return nodeLabel(topology, ref.id)
  return ref.id
}

function entityPathLabel(entities: readonly EnterpriseEntityRef[], topology?: EnterpriseTopology | null): string {
  const labels = entities.map((entity) => entityLabel(entity, topology))
  return labels.length > 0 ? labels.join(" -> ") : "확인 대상"
}

function simplifyUserCopy(value: unknown, fallback: string): string {
  const raw = typeof value === "string" && value.trim() ? value.trim() : fallback
  return raw
    .replace(/\bDeclared\b/g, "설계")
    .replace(/\bObserved\b/g, "실제 실행")
    .replace(/\bdeclared\b/g, "설계")
    .replace(/\bobserved\b/g, "실제 실행")
    .replace(/\bgap\b/g, "고칠 점")
    .replace(/선언된\s*/g, "")
    .replace(/관계 후보/g, "연결 후보")
    .replace(/fallback path/g, "예외 처리 경로")
    .replace(/backup node/g, "대체 실행자")
}

function findingRecord(finding: unknown): Record<string, unknown> {
  return isRecord(finding) ? finding : {}
}

function findingDetailRecord(finding: Record<string, unknown>): Record<string, unknown> {
  return isRecord(finding.detail) ? finding.detail : {}
}

function relatedEntitiesFromFinding(finding: Record<string, unknown>): EnterpriseEntityRef[] {
  const relatedEntities = Array.isArray(finding.relatedEntities)
    ? finding.relatedEntities.map(entityRef).filter((ref): ref is EnterpriseEntityRef => Boolean(ref))
    : []
  if (relatedEntities.length > 0) return relatedEntities

  const nodeId = typeof finding.nodeId === "string"
    ? finding.nodeId
    : typeof finding.targetNodeId === "string"
      ? finding.targetNodeId
      : null
  if (nodeId) return [{ entityType: "node", id: nodeId }]
  return []
}

function targetIdForEntities(entities: readonly EnterpriseEntityRef[]): string | null {
  const firstNode = entities.find((entity) => entity.entityType === "node")
  if (firstNode) return `node:${firstNode.id}`
  const first = entities[0]
  return first ? `${first.entityType}:${first.id}` : null
}

function preview(operation: EnterpriseTopologyGuiOperation): EnterpriseTopologyQuickFixOperationPreview {
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
      summary: `관계 후보: ${operation.from.id} -> ${operation.to.id}`,
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
    targetId: "delete",
    summary: operation.label ?? operation.op,
  }
}

function plan(
  quickFixId: EnterpriseTopologyQuickFixId,
  label: string,
  operations: EnterpriseTopologyGuiOperation[],
): EnterpriseTopologyQuickFixOperationPlan {
  return {
    quickFixId,
    label,
    operations,
    preview: operations.map(preview),
  }
}

function createRelationPlan(input: {
  entities: EnterpriseEntityRef[]
  relationType: EnterpriseRelationType
  label: string
  at: number
}): EnterpriseTopologyQuickFixOperationPlan | null {
  const [from, to] = input.entities
  if (!from || !to) return null
  const relationId = sanitizeId(`relation:observed:${input.relationType}:${from.id}:${to.id}`)
  return plan("connect_selected_nodes", input.label, [{
    ...createGuiDraftOperationBase("createRelation", {
      operationId: `improve:connect-observed:${relationId}`,
      at: input.at,
      label: input.label,
    }),
    relationId,
    relationType: input.relationType,
    from,
    to,
    label: input.label,
  }])
}

function fallbackPlan(nodeId: string, at: number): EnterpriseTopologyQuickFixOperationPlan {
  const fallbackNodeId = sanitizeId(`node:fallback:${nodeId}`)
  const operations: EnterpriseTopologyGuiOperation[] = [
    {
      schemaVersion: ENTERPRISE_TOPOLOGY_GUI_DRAFT_SCHEMA_VERSION,
      operationId: `improve:fallback-node:${nodeId}`,
      op: "createNode",
      at,
      label: "fallback path 추가",
      nodeId: fallbackNodeId,
      name: "Fallback 처리",
      nodeType: "review_node",
    },
    {
      ...createGuiDraftOperationBase("createRelation", {
        operationId: `improve:fallback-relation:${nodeId}`,
        at,
        label: "fallback path 연결",
      }),
      relationId: sanitizeId(`relation:fallback:${nodeId}:${fallbackNodeId}`),
      relationType: "delegates_to",
      from: { entityType: "node", id: nodeId },
      to: { entityType: "node", id: fallbackNodeId },
      label: "fallback",
    },
    {
      ...createGuiDraftOperationBase("updateNode", {
        operationId: `improve:fallback-policy:${nodeId}`,
        at,
        label: "fallback 정책 설정",
      }),
      nodeId,
      patch: {
        failurePolicy: {
          failureReportRequired: true,
          allowPartialSuccess: true,
          fallbackNodeIds: [fallbackNodeId],
        },
        recoveryPolicy: {
          retryAllowed: false,
          redelegationAllowed: true,
          fallbackAllowed: true,
          partialSuccessAllowed: true,
        },
      },
    },
  ]
  return plan("add_fallback_path", "fallback path 추가", operations)
}

function backupNodePlan(nodeId: string, at: number): EnterpriseTopologyQuickFixOperationPlan {
  const backupNodeId = sanitizeId(`node:backup:${nodeId}`)
  return plan("add_child_task", "backup node 연결", [
    {
      schemaVersion: ENTERPRISE_TOPOLOGY_GUI_DRAFT_SCHEMA_VERSION,
      operationId: `improve:backup-node:${nodeId}`,
      op: "createNode",
      at,
      label: "backup node 추가",
      nodeId: backupNodeId,
      name: "Backup 처리",
      nodeType: "function",
    },
    {
      ...createGuiDraftOperationBase("createRelation", {
        operationId: `improve:backup-relation:${nodeId}`,
        at,
        label: "backup node 연결",
      }),
      relationId: sanitizeId(`relation:backup:${nodeId}:${backupNodeId}`),
      relationType: "delegates_to",
      from: { entityType: "node", id: nodeId },
      to: { entityType: "node", id: backupNodeId },
      label: "backup",
    },
  ])
}

function approvalPlan(nodeId: string, at: number): EnterpriseTopologyQuickFixOperationPlan {
  const approvalNodeId = sanitizeId(`node:approval:${nodeId}`)
  return plan("add_approval_step", "승인 단계 추가", [
    {
      schemaVersion: ENTERPRISE_TOPOLOGY_GUI_DRAFT_SCHEMA_VERSION,
      operationId: `improve:approval-node:${nodeId}`,
      op: "createNode",
      at,
      label: "승인 단계 추가",
      nodeId: approvalNodeId,
      name: "승인 확인",
      nodeType: "approval_node",
    },
    {
      ...createGuiDraftOperationBase("createRelation", {
        operationId: `improve:approval-relation:${nodeId}`,
        at,
        label: "승인 단계 연결",
      }),
      relationId: sanitizeId(`relation:approval:${nodeId}:${approvalNodeId}`),
      relationType: "approves",
      from: { entityType: "node", id: approvalNodeId },
      to: { entityType: "node", id: nodeId },
      label: "승인",
    },
  ])
}

function permissionPlan(input: {
  nodeId: string
  refId: string
  permissionKind: "tool" | "system"
  topology?: EnterpriseTopology | null
  at: number
}): EnterpriseTopologyQuickFixOperationPlan {
  const node = input.topology?.nodes.find((item) => item.id === input.nodeId)
  const patch = input.permissionKind === "system"
    ? { allowedSystemIds: [...new Set([...(node?.allowedSystemIds ?? []), input.refId])] }
    : { allowedToolIds: [...new Set([...(node?.allowedToolIds ?? []), input.refId])] }
  return plan("add_tool_permission", "권한 추가", [{
    ...createGuiDraftOperationBase("updateNode", {
      operationId: `improve:permission:${input.nodeId}:${input.refId}`,
      at: input.at,
      label: "필요한 권한 추가",
    }),
    nodeId: input.nodeId,
    patch,
  }])
}

export function buildTopologyImproveActionPlans(input: {
  finding: unknown
  topology?: EnterpriseTopology | null
  now?: number
}): EnterpriseTopologyQuickFixOperationPlan[] {
  const record = findingRecord(input.finding)
  const detail = findingDetailRecord(record)
  const kind = String(record.findingKind ?? record.kind ?? detail.reasonCode ?? record.reasonCode ?? "gap_finding")
  const reasonCode = String(detail.reasonCode ?? record.reasonCode ?? kind)
  const entities = relatedEntitiesFromFinding(record)
  const targetNode = entities.find((entity) => entity.entityType === "node")
  const refId = typeof detail.refId === "string"
    ? detail.refId
    : typeof detail.toolId === "string"
      ? detail.toolId
      : typeof detail.systemId === "string"
        ? detail.systemId
        : typeof record.refId === "string"
          ? record.refId
          : typeof record.toolId === "string"
            ? record.toolId
            : typeof record.systemId === "string"
              ? record.systemId
              : null
  const at = input.now ?? Date.now()
  const plans: EnterpriseTopologyQuickFixOperationPlan[] = []

  if (kind === "observed_only_relation" || reasonCode === "observed_relation_not_declared") {
    const relationPlan = createRelationPlan({
      entities,
      relationType: relationType(detail.relationType),
      label: "실제 경로를 연결 후보로 추가",
      at,
    })
    if (relationPlan) plans.push(relationPlan)
  }

  if (targetNode && refId && (
    kind.includes("permission") ||
    reasonCode.includes("permission") ||
    reasonCode.includes("allowed_tool") ||
    reasonCode.includes("allowed_system")
  )) {
    plans.push(permissionPlan({
      nodeId: targetNode.id,
      refId,
      permissionKind: reasonCode.includes("system") ? "system" : "tool",
      topology: input.topology,
      at,
    }))
  }

  if (targetNode && (
    kind === "single_point_of_failure" ||
    kind === "missing_backup" ||
    reasonCode === "execution_node_without_backup" ||
    reasonCode === "failure_node_missing_fallback"
  )) {
    plans.push(fallbackPlan(targetNode.id, at), backupNodePlan(targetNode.id, at))
  }

  if (targetNode && (
    kind === "approval_bottleneck" ||
    reasonCode === "single_approver_multiple_targets" ||
    reasonCode === "approval_missing"
  )) {
    plans.push(approvalPlan(targetNode.id, at))
  }

  if (plans.length === 0 && targetNode) plans.push(fallbackPlan(targetNode.id, at))
  return plans
}

function categoryForFinding(kind: string, reasonCode: string): TopologyImproveCategory {
  const key = `${kind} ${reasonCode}`.toLocaleLowerCase("ko-KR")
  if (key.includes("permission") || key.includes("allowed_tool") || key.includes("allowed_system")) return "permission"
  if (key.includes("tool")) return "tool"
  if (key.includes("approval") || key.includes("bottleneck") || key.includes("blocked")) return "blocked_connection"
  if (key.includes("single_point") || key.includes("backup") || key.includes("fallback") || key.includes("failure")) return "frequent_failure"
  if (key.includes("observed") || key.includes("declared") || key.includes("relation")) return "execution_drift"
  return "failure_policy"
}

function categoryLabel(category: TopologyImproveCategory): { ko: string; en: string } {
  if (category === "permission") return { ko: "필요한 권한", en: "Needed permission" }
  if (category === "tool") return { ko: "도구 실패", en: "Tool issue" }
  if (category === "blocked_connection") return { ko: "막힌 연결", en: "Blocked connection" }
  if (category === "frequent_failure") return { ko: "자주 실패한 실행자", en: "Frequent failure" }
  if (category === "failure_policy") return { ko: "실패 대비", en: "Failure handling" }
  return { ko: "실제 실행과 다른 점", en: "Runtime difference" }
}

function numericRecordValue(record: Record<string, unknown>, detail: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = record[key] ?? detail[key]
    if (typeof value === "number" && Number.isFinite(value)) return value
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value)
  }
  return null
}

function recentReason(record: Record<string, unknown>, detail: Record<string, unknown>, fallback: string): string | null {
  const value = record.recentFailureReason ?? detail.recentFailureReason ?? record.reason ?? detail.reason ?? record.reasonCode ?? detail.reasonCode
  return typeof value === "string" && value.trim() ? simplifyUserCopy(value, fallback) : null
}

function buildFindingCopy(input: {
  category: TopologyImproveCategory
  record: Record<string, unknown>
  detail: Record<string, unknown>
  relatedEntities: EnterpriseEntityRef[]
  topology?: EnterpriseTopology | null
}): {
  title: string
  detail: string
  evidenceKo: string
  evidenceEn: string
  recommendedActionKo: string
  recommendedActionEn: string
  failureCount: number | null
  recentFailureReason: string | null
} {
  const path = entityPathLabel(input.relatedEntities, input.topology)
  const target = input.relatedEntities.find((entity) => entity.entityType === "node")
  const targetName = target ? entityLabel(target, input.topology) : path
  const fallbackTitle = simplifyUserCopy(input.record.summary ?? input.record.title, "고칠 점이 있습니다.")
  const fallbackDetail = simplifyUserCopy(
    input.record.recommendation ?? input.record.message ?? input.record.detail ?? input.detail.reasonCode,
    "이 흐름이 맞는지 확인한 뒤 적용하세요.",
  )
  const failureCount = numericRecordValue(input.record, input.detail, ["failureCount", "failedCount", "count", "occurrences"])
  const reason = recentReason(input.record, input.detail, fallbackDetail)

  if (input.category === "execution_drift") {
    return {
      title: input.relatedEntities.length >= 2
        ? `실제 실행에서는 ${path}로 넘어갔습니다.`
        : fallbackTitle,
      detail: "이 흐름이 맞다면 연결 후보를 검토해 추가하세요.",
      evidenceKo: "실행 기록에서 기존 화면에 없던 연결이 확인되었습니다.",
      evidenceEn: "The run showed a connection that is not on the main graph yet.",
      recommendedActionKo: "연결 후보를 미리보기로 확인한 뒤 필요할 때만 추가하세요.",
      recommendedActionEn: "Preview the suggested connection before adding it.",
      failureCount,
      recentFailureReason: reason,
    }
  }

  if (input.category === "permission") {
    const refId = String(input.detail.refId ?? input.detail.toolId ?? input.detail.systemId ?? input.record.refId ?? input.record.toolId ?? input.record.systemId ?? "필요 권한")
    return {
      title: `${targetName}에게 ${refId} 권한이 필요합니다.`,
      detail: "권한이 없으면 실행자가 도구나 시스템을 사용할 수 없어 같은 지점에서 멈출 수 있습니다.",
      evidenceKo: reason ? `최근 이유: ${reason}` : "권한 부족으로 실행이 막힌 후보입니다.",
      evidenceEn: reason ? `Recent reason: ${reason}` : "The run appears blocked by missing permission.",
      recommendedActionKo: "권한 추가 미리보기를 확인한 뒤 반영하세요.",
      recommendedActionEn: "Preview the permission change before applying it.",
      failureCount,
      recentFailureReason: reason,
    }
  }

  if (input.category === "blocked_connection") {
    return {
      title: `${targetName}에서 흐름이 막힐 수 있습니다.`,
      detail: "승인 대기나 한 명에게 몰린 연결 때문에 다음 단계가 늦어질 수 있습니다.",
      evidenceKo: reason ? `최근 이유: ${reason}` : "실행 흐름에서 병목 후보가 확인되었습니다.",
      evidenceEn: reason ? `Recent reason: ${reason}` : "The run shows a possible bottleneck.",
      recommendedActionKo: "승인 단계나 예외 이동 후보를 미리보기로 확인하세요.",
      recommendedActionEn: "Preview an approval or exception path.",
      failureCount,
      recentFailureReason: reason,
    }
  }

  if (input.category === "tool") {
    return {
      title: `${targetName}의 도구 실행을 확인해야 합니다.`,
      detail: "도구 호출이 실패했거나 필요한 도구 연결이 부족할 수 있습니다.",
      evidenceKo: reason ? `최근 이유: ${reason}` : "도구 실행 실패 후보입니다.",
      evidenceEn: reason ? `Recent reason: ${reason}` : "A tool execution issue was detected.",
      recommendedActionKo: "필요한 도구 권한과 대체 경로를 미리보기로 확인하세요.",
      recommendedActionEn: "Preview the needed tool permission or backup path.",
      failureCount,
      recentFailureReason: reason,
    }
  }

  return {
    title: `${targetName}의 실패 대비가 부족합니다.`,
    detail: failureCount ? `최근 실행에서 ${failureCount}회 실패했습니다.` : "실패했을 때 넘길 예외 처리 또는 대체 실행자가 부족합니다.",
    evidenceKo: reason ? `최근 실패 이유: ${reason}` : "실패 시 복구할 후보 경로가 필요합니다.",
    evidenceEn: reason ? `Recent failure reason: ${reason}` : "A fallback or backup path is needed.",
    recommendedActionKo: "예외 처리 경로나 대체 실행자를 미리보기로 확인하세요.",
    recommendedActionEn: "Preview an exception or backup path before applying it.",
    failureCount,
    recentFailureReason: reason,
  }
}

function findingViewFromGap(finding: unknown, index: number, topology?: EnterpriseTopology | null): TopologyImproveFindingView {
  const record = findingRecord(finding)
  const detail = findingDetailRecord(record)
  const kind = String(record.findingKind ?? record.kind ?? detail.reasonCode ?? record.reasonCode ?? "gap_finding")
  const severity = String(record.severity ?? "medium")
  const relatedEntities = relatedEntitiesFromFinding(record)
  const reasonCode = String(detail.reasonCode ?? record.reasonCode ?? kind)
  const category = categoryForFinding(kind, reasonCode)
  const label = categoryLabel(category)
  const copy = buildFindingCopy({ category, record, detail, relatedEntities, topology })
  return {
    id: String(record.findingId ?? `gap:${kind}:${index}`),
    kind,
    severity,
    category,
    categoryLabelKo: label.ko,
    categoryLabelEn: label.en,
    title: copy.title,
    detail: copy.detail,
    evidenceKo: copy.evidenceKo,
    evidenceEn: copy.evidenceEn,
    recommendedActionKo: copy.recommendedActionKo,
    recommendedActionEn: copy.recommendedActionEn,
    failureCount: copy.failureCount,
    recentFailureReason: copy.recentFailureReason,
    targetId: targetIdForEntities(relatedEntities),
    relatedEntities,
    actionPlans: buildTopologyImproveActionPlans({ finding, topology }),
  }
}

function findingViewFromObservedEdge(edge: EnterpriseTopologyObservedEdgeRecord, index: number, topology?: EnterpriseTopology | null): TopologyImproveFindingView {
  const relation = relationTypeForObservedEdge(edge)
  const relatedEntities: EnterpriseEntityRef[] = [
    { entityType: "node", id: edge.fromNodeId },
    { entityType: relation === "uses_tool" ? "enterprise_tool" : "node", id: edge.toNodeId },
  ]
  const synthetic = {
    findingId: `observed:${edge.edgeId}`,
    findingKind: "observed_only_relation",
    severity: "medium",
    summary: `실제 실행 연결 후보: ${edge.fromNodeId} -> ${edge.toNodeId}`,
    recommendation: "실제 실행 경로가 맞다면 선언된 관계 후보로 추가하세요.",
    relatedEntities,
    detail: { reasonCode: "observed_relation_not_declared", relationType: relation },
  }
  return {
    ...findingViewFromGap(synthetic, index, topology),
    targetId: `observed:${edge.edgeId}`,
  }
}

export function buildTopologyImproveFindings(input: {
  gapFindings?: unknown[]
  observedEdges?: EnterpriseTopologyObservedEdgeRecord[]
  topology?: EnterpriseTopology | null
}): TopologyImproveFindingView[] {
  const gapViews = (input.gapFindings ?? []).map((finding, index) =>
    findingViewFromGap(finding, index, input.topology)
  )
  const gapKeys = new Set(gapViews.map((finding) => finding.relatedEntities.map(entityRefKey).join("->")))
  const observedViews = (input.observedEdges ?? [])
    .map((edge, index) => findingViewFromObservedEdge(edge, index, input.topology))
    .filter((finding) => !gapKeys.has(finding.relatedEntities.map(entityRefKey).join("->")))
  return [...gapViews, ...observedViews]
}

function severityClassName(severity: string): string {
  if (severity === "critical" || severity === "high") return "border-red-200 bg-red-50 text-red-950"
  if (severity === "medium") return "border-amber-200 bg-amber-50 text-amber-950"
  return "border-stone-200 bg-stone-50 text-stone-800"
}

function previewText(plan: EnterpriseTopologyQuickFixOperationPlan): string {
  return plan.preview.map((item) => item.summary).join(" / ")
}

export function resolveTopologyImprovePreviewTransition(input: {
  intent: TopologyImprovePreviewIntent
  findingId: string
  plan?: EnterpriseTopologyQuickFixOperationPlan | null
}): TopologyImprovePreviewTransition {
  if (!input.plan || input.intent === "cancel") {
    return {
      pendingPreview: null,
      operations: [],
      shouldApply: false,
    }
  }
  if (input.intent === "preview") {
    return {
      pendingPreview: {
        findingId: input.findingId,
        quickFixId: input.plan.quickFixId,
      },
      operations: [],
      shouldApply: false,
    }
  }
  return {
    pendingPreview: null,
    operations: input.plan.operations,
    shouldApply: true,
  }
}

export function TopologyImprovePanel({
  topology,
  traceOverlay,
  gapFindings = [],
  observedEdges = [],
  onSelectTarget,
  onApplyQuickFix,
  onRunLayerRequest,
  advancedOpen = false,
  initialPendingPreview = null,
}: {
  topology?: EnterpriseTopology | null
  traceOverlay?: TopologyRunTraceOverlayInput | null
  gapFindings?: unknown[]
  observedEdges?: EnterpriseTopologyObservedEdgeRecord[]
  onSelectTarget?: (targetId: string) => void
  onApplyQuickFix?: (operations: EnterpriseTopologyGuiOperation[]) => void
  onRunLayerRequest?: () => void
  advancedOpen?: boolean
  initialPendingPreview?: TopologyImprovePendingPreview | null
}) {
  const { text } = useUiI18n()
  const [pendingPreview, setPendingPreview] = React.useState<TopologyImprovePendingPreview | null>(initialPendingPreview)
  const [advancedExpanded, setAdvancedExpanded] = React.useState(advancedOpen)
  const isAdvancedOpen = advancedOpen || advancedExpanded
  const findings = React.useMemo(
    () => buildTopologyImproveFindings({ gapFindings, observedEdges, topology }),
    [gapFindings, observedEdges, topology],
  )
  const categoryCounts = React.useMemo(() => {
    const counts = new Map<TopologyImproveCategory, { labelKo: string; labelEn: string; count: number }>()
    for (const finding of findings) {
      const current = counts.get(finding.category) ?? {
        labelKo: finding.categoryLabelKo,
        labelEn: finding.categoryLabelEn,
        count: 0,
      }
      current.count += 1
      counts.set(finding.category, current)
    }
    return Array.from(counts.entries()).map(([category, value]) => ({ category, ...value }))
  }, [findings])

  return (
    <section className="rounded-lg border border-stone-200 bg-white p-4" data-testid="topology-improve-panel">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-stone-950">
            {text("고칠 점", "What to fix")}
          </div>
          <div className="mt-1 text-xs leading-5 text-stone-500">
            {text("실제 실행과 다른 점, 실패가 잦은 실행자, 막힌 연결, 필요한 권한을 확인합니다.", "Review runtime differences, repeated failures, blocked connections, and needed permissions.")}
          </div>
        </div>
        <span className="rounded-full bg-sky-100 px-2.5 py-1 text-xs font-semibold text-sky-800">
          {findings.length}
        </span>
      </div>

      {!traceOverlay?.run ? (
        <div className="mt-3 rounded-lg border border-dashed border-stone-200 bg-stone-50 p-3 text-xs text-stone-600" data-testid="topology-improve-empty-state">
          <div className="font-semibold text-stone-800">
            {text("아직 개선할 실행 기록이 없습니다.", "No run evidence yet.")}
          </div>
          <div className="mt-1 leading-5">
            {text("먼저 한 번 실행하면 실제로 어디서 막혔는지와 고칠 후보를 볼 수 있습니다.", "Run once to see where the workflow got stuck and what can be improved.")}
          </div>
          <button
            type="button"
            onClick={onRunLayerRequest}
            className="mt-3 rounded-md bg-stone-900 px-3 py-1.5 text-xs font-semibold text-white"
            data-testid="topology-improve-run-cta"
          >
            {text("실행으로 이동", "Go to run")}
          </button>
        </div>
      ) : (
        <div className="mt-3 grid gap-2">
          {categoryCounts.length > 0 ? (
            <div className="grid gap-2 sm:grid-cols-2" data-testid="topology-improve-category-summary">
              {categoryCounts.map((item) => (
                <div
                  key={item.category}
                  className="rounded-md border border-stone-200 bg-stone-50 px-2.5 py-2"
                  data-testid="topology-improve-category-card"
                  data-category={item.category}
                >
                  <div className="text-[11px] font-semibold text-stone-800">
                    {text(item.labelKo, item.labelEn)}
                  </div>
                  <div className="mt-1 text-lg font-semibold text-stone-950">{item.count}</div>
                </div>
              ))}
            </div>
          ) : null}
          {findings.length === 0 ? (
            <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-3 text-xs text-emerald-900">
              {text("현재 실행에서 바로 고칠 후보는 없습니다.", "No immediate improvements were found in this run.")}
            </div>
          ) : null}
          {findings.map((finding) => {
            const primaryPlan = finding.actionPlans[0]
            const pending = Boolean(primaryPlan && pendingPreview?.findingId === finding.id && pendingPreview.quickFixId === primaryPlan.quickFixId)
            return (
              <div
                key={finding.id}
                className={`rounded-lg border p-3 ${severityClassName(finding.severity)}`}
                data-testid="topology-improve-gap-finding"
                data-target-id={finding.targetId ?? undefined}
              >
                <button
                  type="button"
                  onClick={() => finding.targetId ? onSelectTarget?.(finding.targetId) : undefined}
                  className="block w-full text-left"
                  data-testid="topology-improve-gap-target"
                >
                  <span className="inline-flex rounded-full bg-white/80 px-2 py-0.5 text-[10px] font-semibold text-stone-700">
                    {text(finding.categoryLabelKo, finding.categoryLabelEn)}
                  </span>
                  <span className="mt-2 block text-xs font-semibold text-stone-950">{finding.title}</span>
                  <span className="mt-1 block text-[11px] leading-4 text-stone-600">{finding.detail}</span>
                </button>
                <div className="mt-2 grid gap-1 rounded-md bg-white/70 px-2.5 py-2 text-[11px] leading-4 text-stone-600">
                  <div data-testid="topology-improve-evidence">
                    <span className="font-semibold text-stone-800">{text("확인한 내용", "Evidence")}: </span>
                    {text(finding.evidenceKo, finding.evidenceEn)}
                  </div>
                  <div data-testid="topology-improve-recommended-action">
                    <span className="font-semibold text-stone-800">{text("추천 조치", "Recommended action")}: </span>
                    {text(finding.recommendedActionKo, finding.recommendedActionEn)}
                  </div>
                  {finding.failureCount ? (
                    <div data-testid="topology-improve-failure-count">
                      <span className="font-semibold text-stone-800">{text("최근 실패", "Recent failures")}: </span>
                      {finding.failureCount}
                    </div>
                  ) : null}
                </div>
                {primaryPlan ? (
                  <div className="mt-2 rounded-md border border-white/70 bg-white/80 p-2" data-testid="topology-improve-action-preview">
                    <div className="text-[11px] font-semibold text-stone-700">
                      {text("변경 미리보기", "Change preview")}: {primaryPlan.label}
                    </div>
                    <div className="mt-1 text-[11px] leading-4 text-stone-500">
                      {previewText(primaryPlan)}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const transition = resolveTopologyImprovePreviewTransition({
                          intent: "preview",
                          findingId: finding.id,
                          plan: primaryPlan,
                        })
                        setPendingPreview(transition.pendingPreview)
                      }}
                      className="mt-2 rounded-md border border-stone-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-stone-800"
                      data-testid={`topology-improve-action-${primaryPlan.quickFixId}`}
                      data-action-mode="preview_required"
                    >
                      {text("미리보기 확인", "Review preview")}
                    </button>
                    {pending ? (
                      <div className="mt-2 rounded-md border border-sky-200 bg-sky-50 p-2" data-testid="topology-improve-preview-confirmation">
                        <div className="text-[11px] font-semibold text-sky-950">
                          {text("이 변경을 적용할까요?", "Apply this change?")}
                        </div>
                        <div className="mt-1 grid gap-1 text-[11px] leading-4 text-sky-900">
                          {primaryPlan.preview.map((item) => (
                            <div key={item.operationId} data-testid="topology-improve-confirm-preview-item">
                              {item.summary}
                            </div>
                          ))}
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              const transition = resolveTopologyImprovePreviewTransition({
                                intent: "apply",
                                findingId: finding.id,
                                plan: primaryPlan,
                              })
                              if (transition.shouldApply) onApplyQuickFix?.(transition.operations)
                              setPendingPreview(transition.pendingPreview)
                            }}
                            className="rounded-md bg-stone-900 px-2.5 py-1 text-[11px] font-semibold text-white"
                            data-testid={`topology-improve-apply-confirmed-${primaryPlan.quickFixId}`}
                          >
                            {text("변경 적용", "Apply change")}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const transition = resolveTopologyImprovePreviewTransition({
                                intent: "cancel",
                                findingId: finding.id,
                                plan: primaryPlan,
                              })
                              setPendingPreview(transition.pendingPreview)
                            }}
                            className="rounded-md border border-sky-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-sky-900"
                            data-testid="topology-improve-preview-cancel"
                          >
                            {text("취소", "Cancel")}
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      )}
      <details
        className="mt-3 rounded-lg border border-stone-200 bg-white p-3"
        data-testid="topology-improve-advanced-details"
        open={isAdvancedOpen}
        onToggle={(event) => setAdvancedExpanded(event.currentTarget.open)}
      >
        <summary className="cursor-pointer text-xs font-semibold text-stone-700">
          {text("고급 분석 정보", "Advanced analysis")}
        </summary>
        {isAdvancedOpen ? (
          <div className="mt-2 grid gap-2 text-[11px] leading-4 text-stone-600" data-testid="topology-improve-advanced-debug">
            {findings.map((finding) => (
              <div key={`debug:${finding.id}`} className="rounded-md bg-stone-50 p-2" data-testid="topology-improve-raw-finding">
                {finding.id} / {finding.kind} / {finding.severity} / {finding.targetId ?? "no-target"}
              </div>
            ))}
            {observedEdges.map((edge) => (
              <div key={`edge:${edge.edgeId}`} className="rounded-md bg-stone-50 p-2" data-testid="topology-improve-raw-observed-edge">
                {edge.edgeId} / {edge.edgeKind} / {edge.fromNodeId} -&gt; {edge.toNodeId}
              </div>
            ))}
          </div>
        ) : null}
      </details>
    </section>
  )
}
