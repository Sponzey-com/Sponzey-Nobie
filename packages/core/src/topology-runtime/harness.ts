import type { ChannelSource } from "../channels/contracts.js"
import type {
  EnterpriseMetadata,
  EnterpriseTopology,
  NodeContract,
  NodeResultReport,
} from "../contracts/enterprise-topology.js"
import {
  getFeatureFlag,
  shouldUseNewPath,
  type FeatureFlagMode,
  type RuntimeFeatureFlag,
} from "../runtime/rollout-safety.js"
import type { AgentExecutionDecision } from "../orchestration/execution-decision-contract.js"
import type { OrchestrationModeSnapshot } from "../orchestration/mode.js"
import {
  createEnterpriseTopologyRegistry,
  type EnterpriseTopologyRegistryRecord,
  type EnterpriseTopologyRegistryStore,
  type TopologyExportEnvelope,
} from "../topology/registry.js"
import {
  buildWorkOrder,
  createWorkOrderRuntimeEnvelope,
} from "./work-order.js"
import type { CompiledTopologySnapshot } from "../topology/compiler.js"
import {
  runNodeRuntime,
  type NodeRuntimeExecutionResult,
  type NodeRuntimeSelfExecutor,
} from "./node-runtime.js"
import {
  recordTopologyRuntimeExecution,
  type TopologyTracePersistenceResult,
} from "./trace.js"

export const TOPOLOGY_RUNTIME_FEATURE_KEY = "topology_runtime_enabled" as const

export type TopologyRootRunRoutingMode = "route" | "fallback"

export type TopologyRootRunFallbackReasonCode =
  | "feature_flag_off"
  | "non_root_request"
  | "topology_routing_not_opted_in"
  | "topology_not_found"
  | "topology_not_active"
  | "active_topology_not_found"
  | "topology_export_missing"
  | "topology_validation_blocked"
  | "compiled_snapshot_missing"
  | "entry_node_missing"
  | "selected_executor_missing"
  | "selected_executor_not_direct_child"
  | "selected_executor_path_invalid"

export type TopologyRootRunRouteReasonCode =
  | "explicit_topology_target"
  | "execution_decision_selected_executor"

export type TopologyRootRunRoutingDecision =
  | {
      mode: "fallback"
      reasonCode: TopologyRootRunFallbackReasonCode
      featureFlagMode: FeatureFlagMode
      explicitTopologyId?: string
      activeTopologyCount?: number
      issues?: string[]
    }
  | {
      mode: "route"
      reasonCode: TopologyRootRunRouteReasonCode
      featureFlagMode: FeatureFlagMode
      topologyId: string
      topologyName: string
      topologyVersion: number
      topologyVersionId: string
      compiledTopologySnapshotId: string
      entryNodeId: string
      selectedExecutorId?: string
      selectedConnectionPath?: string[]
      availableDirectChildExecutorIds: string[]
      entrySelection?: "execution_decision"
      executionDecision?: AgentExecutionDecision
      explicit: boolean
    }

export type TopologyRootRunExecutionResult =
  | {
      ok: true
      topologyRunId: string
      topologyId: string
      topologyVersion: number
      entryNodeId: string
      entryNodeName: string
      finalAnswer: string
      nodeResultReport: NodeResultReport
      runtimeResult: NodeRuntimeExecutionResult
      persistence: TopologyTracePersistenceResult
    }
  | {
      ok: false
      reasonCode:
        | TopologyRootRunFallbackReasonCode
        | "work_order_envelope_invalid"
        | "topology_runtime_failed"
      fallbackSummary: string
      issues: string[]
      runtimeResult?: NodeRuntimeExecutionResult
      persistence?: TopologyTracePersistenceResult
    }

type TopologyRootRunExecutionFallbackReasonCode =
  Extract<TopologyRootRunExecutionResult, { ok: false }>["reasonCode"]

export interface ResolveTopologyRootRunRoutingInput {
  message: string
  runId: string
  sessionId: string
  source?: ChannelSource
  targetId?: string
  taskProfile?: string
  isRootRequest: boolean
  registry?: EnterpriseTopologyRegistryStore
  featureFlag?: RuntimeFeatureFlag
  executionDecision?: AgentExecutionDecision
  orchestrationModeSnapshot?: Pick<
    OrchestrationModeSnapshot,
    "mode" | "activeSubAgentCount"
  >
}

export interface RunTopologyRootRunInput {
  decision: Extract<TopologyRootRunRoutingDecision, { mode: "route" }>
  runId: string
  sessionId: string
  source: ChannelSource
  message: string
  registry?: EnterpriseTopologyRegistryStore
  now?: () => number
  selfExecute?: NodeRuntimeSelfExecutor
}

export function resolveTopologyRootRunRouting(
  input: ResolveTopologyRootRunRoutingInput,
): TopologyRootRunRoutingDecision {
  const featureFlag = input.featureFlag ?? getFeatureFlag(TOPOLOGY_RUNTIME_FEATURE_KEY)
  const featureFlagMode = featureFlag.mode
  const explicitTopologyId = explicitTopologyIdFromInput(input.targetId, input.message)
  if (explicitTopologyId === undefined && isExplicitDirectExecutionTarget(input.targetId)) {
    return {
      mode: "fallback",
      reasonCode: "topology_routing_not_opted_in",
      featureFlagMode,
    }
  }
  const orchestrationSnapshotAllowsTopology = topologyExecutionAllowedByOrchestrationSnapshot(
    input.orchestrationModeSnapshot,
  )
  const featureFlagAllowsTopology = shouldUseNewPath(featureFlag)
  const explicitlyDisabledByAdmin =
    featureFlag.source === "db" && (featureFlag.mode === "off" || featureFlag.mode === "rollback")

  if (
    explicitlyDisabledByAdmin ||
    (!featureFlagAllowsTopology && !orchestrationSnapshotAllowsTopology)
  ) {
    return {
      mode: "fallback",
      reasonCode: "feature_flag_off",
      featureFlagMode,
      ...(explicitTopologyId !== undefined ? { explicitTopologyId } : {}),
    }
  }

  if (!input.isRootRequest) {
    return {
      mode: "fallback",
      reasonCode: "non_root_request",
      featureFlagMode,
      ...(explicitTopologyId !== undefined ? { explicitTopologyId } : {}),
    }
  }

  const registry = input.registry ?? createEnterpriseTopologyRegistry()
  const topologies = registry.listTopologies()
  const activeTopologies = topologies.filter((topology) => (
    topology.status === "active" && topology.activeVersion !== undefined
  ))
  const routableTopologies = orchestrationSnapshotAllowsTopology
    ? savedTopologyRoutingCandidates(topologies)
    : activeTopologies
  const topologyRecord = explicitTopologyId !== undefined
    ? registry.getTopology(explicitTopologyId)
    : routableTopologies[0] ?? null

  if (topologyRecord === null) {
    return {
      mode: "fallback",
      reasonCode: explicitTopologyId !== undefined ? "topology_not_found" : "active_topology_not_found",
      featureFlagMode,
      ...(explicitTopologyId !== undefined ? { explicitTopologyId } : {}),
      activeTopologyCount: activeTopologies.length,
    }
  }
  const activeTopologyRequired = featureFlagAllowsTopology && !orchestrationSnapshotAllowsTopology
  if (
    topologyRecord.status === "archived" ||
    (
      activeTopologyRequired &&
      (topologyRecord.status !== "active" || topologyRecord.activeVersion === undefined)
    )
  ) {
    return {
      mode: "fallback",
      reasonCode: "topology_not_active",
      featureFlagMode,
      explicitTopologyId: topologyRecord.topologyId,
      activeTopologyCount: activeTopologies.length,
    }
  }

  const exported = registry.exportTopology(
    topologyRecord.topologyId,
    activeTopologyRequired ? topologyRecord.activeVersion : undefined,
  )
  return exportedToRoutingDecision({
    exported,
    featureFlagMode,
    explicit: explicitTopologyId !== undefined,
    activeTopologyCount: activeTopologies.length,
    ...(input.executionDecision !== undefined ? { executionDecision: input.executionDecision } : {}),
  })
}

function topologyExecutionAllowedByOrchestrationSnapshot(
  snapshot: ResolveTopologyRootRunRoutingInput["orchestrationModeSnapshot"],
): boolean {
  return Boolean(
    snapshot?.mode === "orchestration" &&
    snapshot.activeSubAgentCount > 0,
  )
}

function savedTopologyRoutingCandidates(
  topologies: EnterpriseTopologyRegistryRecord[],
): EnterpriseTopologyRegistryRecord[] {
  return topologies
    .filter((topology) => topology.status !== "archived")
    .sort((left, right) => {
      return timestampMs(right.updatedAt) - timestampMs(left.updatedAt) ||
        left.topologyId.localeCompare(right.topologyId)
    })
}

function timestampMs(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string") {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

export async function runTopologyRootRun(
  input: RunTopologyRootRunInput,
): Promise<TopologyRootRunExecutionResult> {
  const registry = input.registry ?? createEnterpriseTopologyRegistry()
  const exported = registry.exportTopology(input.decision.topologyId, input.decision.topologyVersion)
  if (exported === null) {
    return fallbackExecution("topology_export_missing", ["topology_export_missing"])
  }
  if (exported.compiledSnapshot === undefined) {
    return fallbackExecution("compiled_snapshot_missing", ["compiled_snapshot_missing"])
  }

  const now = input.now ?? Date.now
  const topology = exported.version.topology
  const snapshot = exported.compiledSnapshot.snapshot
  const entryNodeId = input.decision.entryNodeId
  if (entryNodeId === null) return fallbackExecution("entry_node_missing", ["entry_node_missing"])
  const entryNode = topology.nodes.find((node) => node.id === entryNodeId)
  if (entryNode === undefined) return fallbackExecution("entry_node_missing", [`missing_node:${entryNodeId}`])
  const compiledEntryNode = snapshot.nodeIndex[entryNode.id]
  if (compiledEntryNode === undefined) return fallbackExecution("entry_node_missing", [`missing_compiled_node:${entryNode.id}`])

  const topologyRunId = `topology-run:${input.runId}`
  const workOrder = buildWorkOrder({
    workOrderId: `work-order:${topologyRunId}:${entryNode.id}`,
    topologyRunId,
    parentWorkOrderId: null,
    fromNodeId: entryNode.id,
    to: { type: "node", id: entryNode.id },
    objective: input.message,
    scope: {
      included: [entryNode.id, ...compiledEntryNode.childNodeIds],
      excluded: [],
    },
    input: {
      userRequest: input.message,
      rootRunId: input.runId,
      sessionId: input.sessionId,
      source: input.source,
      routingReasonCode: input.decision.reasonCode,
      entrySelection: input.decision.entrySelection ?? "execution_decision",
      selectedExecutorId: input.decision.selectedExecutorId,
      selectedConnectionPath: input.decision.selectedConnectionPath ?? [entryNode.id],
      ...(input.decision.executionDecision !== undefined
        ? { executionDecision: input.decision.executionDecision as unknown as EnterpriseMetadata }
        : {}),
    },
    expectedOutputSchema: {
      type: "object",
      required: ["answer"],
      properties: {
        answer: { type: "string" },
      },
    },
    successCriteria: [{
      criterionId: `criterion:${topologyRunId}:nobie-final-answer`,
      description: "Produce a result that Nobie can synthesize into the final user answer.",
      required: true,
      validationKind: "manual",
    }],
    permissionScope: {
      allowedToolIds: [...compiledEntryNode.allowedToolIds],
      allowedSystemIds: [...compiledEntryNode.allowedSystemIds],
      dataDomainIds: [],
      riskLevel: "unknown",
    },
    authorityScope: {
      requiredAuthorityRuleIds: [],
      approvalRequired: false,
    },
    failureReportRequired: entryNode.failurePolicy?.failureReportRequired ?? true,
    delegationPath: [entryNode.id],
    createdAt: now(),
  })
  const runtimeEnvelope = createWorkOrderRuntimeEnvelope({
    workOrder,
    nodeContractSnapshot: entryNode,
    compiledTopologySnapshot: snapshot,
    parentRunId: input.runId,
    parentSessionId: input.sessionId,
    commandRequestId: `command:${topologyRunId}:${entryNode.id}`,
    subSessionId: `sub-session:${topologyRunId}:${entryNode.id}`,
    now,
  })
  if (!runtimeEnvelope.ok) {
    return fallbackExecution(
      "work_order_envelope_invalid",
      runtimeEnvelope.issues.map((issue) => issue.reasonCode ?? issue.code),
    )
  }

  const childNodeContractsById = Object.fromEntries(
    topology.nodes.map((node) => [node.id, structuredClone(node)]),
  ) as Record<string, NodeContract>
  const runtimeResult = await runNodeRuntime({
    envelope: runtimeEnvelope.envelope,
    compiledTopologySnapshot: snapshot,
    nodeRunId: `node-run:${topologyRunId}:${entryNode.id}`,
    now,
    component: "topology-root-run",
    ...(input.selfExecute !== undefined ? { selfExecute: input.selfExecute } : {}),
    childDelegation: {
      enabled: true,
      childNodeContractsById,
      recursive: true,
    },
    aggregation: {
      enabled: true,
      strategy: "parent_decides",
      expectedChildNodeIds: snapshot.parentChildTree.edges[entryNode.id] ?? [],
      requireAllChildResults: false,
      allowPartialSuccess: true,
    },
    recovery: {
      enabled: true,
      childDelegationAttempted: true,
      toolExecutionAttempted: true,
      retryAttempted: true,
      fallbackAttempted: true,
      partialSuccessChecked: true,
      parentRecoveryPossibleChecked: true,
      recommendedAction: "Use the current-agent fallback contract if topology execution cannot produce a final answer.",
    },
  })
  const persistence = recordTopologyRuntimeExecution({
    result: runtimeResult,
    topologyId: topology.id,
    topologyVersion: exported.version.version,
    topologyVersionId: exported.version.versionId,
    rootRunId: input.runId,
    metadata: {
      source: "root_run_topology_runtime",
      routingReasonCode: input.decision.reasonCode,
      entrySelection: input.decision.entrySelection ?? "execution_decision",
      sessionId: input.sessionId,
      sourceChannel: input.source,
      ...(input.decision.selectedExecutorId !== undefined
        ? { selectedExecutorId: input.decision.selectedExecutorId }
        : {}),
      ...(input.decision.selectedConnectionPath !== undefined
        ? { selectedConnectionPath: input.decision.selectedConnectionPath }
        : {}),
    },
    now,
  })

  if (runtimeResult.status !== "completed" && runtimeResult.status !== "partial_success") {
    return {
      ok: false,
      reasonCode: "topology_runtime_failed",
      fallbackSummary: "Topology runtime did not produce a completed result; use the current-agent fallback contract.",
      issues: runtimeResult.nodeResultReport.risksOrGaps,
      runtimeResult,
      persistence,
    }
  }

  return {
    ok: true,
    topologyRunId,
    topologyId: topology.id,
    topologyVersion: exported.version.version,
    entryNodeId: entryNode.id,
    entryNodeName: entryNode.name,
    finalAnswer: buildTopologyFinalAnswer({
      topology,
      entryNode,
      nodeResultReport: runtimeResult.nodeResultReport,
      userRequest: input.message,
    }),
    nodeResultReport: runtimeResult.nodeResultReport,
    runtimeResult,
    persistence,
  }
}

function exportedToRoutingDecision(input: {
  exported: TopologyExportEnvelope | null
  featureFlagMode: FeatureFlagMode
  explicit: boolean
  activeTopologyCount: number
  executionDecision?: AgentExecutionDecision
}): TopologyRootRunRoutingDecision {
  if (input.exported === null) {
    return {
      mode: "fallback",
      reasonCode: "topology_export_missing",
      featureFlagMode: input.featureFlagMode,
      activeTopologyCount: input.activeTopologyCount,
    }
  }
  const exported = input.exported
  if (!exported.validationSnapshot.executable) {
    return {
      mode: "fallback",
      reasonCode: "topology_validation_blocked",
      featureFlagMode: input.featureFlagMode,
      explicitTopologyId: exported.topologyRecord.topologyId,
      activeTopologyCount: input.activeTopologyCount,
      issues: exported.validationSnapshot.validation.issues
        .filter((issue) => issue.severity === "blocked" || issue.severity === "invalid")
        .map((issue) => issue.reasonCode),
    }
  }
  if (exported.compiledSnapshot === undefined) {
    return {
      mode: "fallback",
      reasonCode: "compiled_snapshot_missing",
      featureFlagMode: input.featureFlagMode,
      explicitTopologyId: exported.topologyRecord.topologyId,
      activeTopologyCount: input.activeTopologyCount,
    }
  }
  const snapshot = exported.compiledSnapshot.snapshot
  const entrySelection = selectEntryNodeFromExecutionDecision({
    topologyId: exported.topologyRecord.topologyId,
    snapshot,
    ...(input.executionDecision !== undefined ? { executionDecision: input.executionDecision } : {}),
  })
  if (!entrySelection.ok) {
    return {
      mode: "fallback",
      reasonCode: entrySelection.reasonCode,
      featureFlagMode: input.featureFlagMode,
      explicitTopologyId: exported.topologyRecord.topologyId,
      activeTopologyCount: input.activeTopologyCount,
      issues: entrySelection.issues,
    }
  }
  return {
    mode: "route",
    reasonCode: input.explicit ? "explicit_topology_target" : "execution_decision_selected_executor",
    featureFlagMode: input.featureFlagMode,
    topologyId: exported.topologyRecord.topologyId,
    topologyName: exported.topologyRecord.name,
    topologyVersion: exported.version.version,
    topologyVersionId: exported.version.versionId,
    compiledTopologySnapshotId: exported.compiledSnapshot.snapshotId,
    entryNodeId: entrySelection.entryNodeId,
    entrySelection: entrySelection.selectionKind,
    availableDirectChildExecutorIds: rootChildEntryNodeIds(exported.compiledSnapshot.snapshot)
      .map((nodeId) => `${exported.topologyRecord.topologyId}:${nodeId}`),
    ...(entrySelection.selectedExecutorId !== undefined
      ? { selectedExecutorId: entrySelection.selectedExecutorId }
      : {}),
    ...(entrySelection.selectedConnectionPath !== undefined
      ? { selectedConnectionPath: entrySelection.selectedConnectionPath }
      : {}),
    ...(input.executionDecision !== undefined ? { executionDecision: input.executionDecision } : {}),
    explicit: input.explicit,
  }
}

function selectEntryNodeFromExecutionDecision(input: {
  topologyId: string
  executionDecision?: AgentExecutionDecision
  snapshot: CompiledTopologySnapshot
}): {
  ok: true
  entryNodeId: string
  selectionKind: "execution_decision"
  selectedExecutorId?: string
  selectedConnectionPath?: string[]
} | {
  ok: false
  reasonCode: Extract<
    TopologyRootRunFallbackReasonCode,
    "selected_executor_missing" | "selected_executor_not_direct_child" | "selected_executor_path_invalid"
  >
  issues: string[]
} {
  const selectedExecutorId = input.executionDecision?.selected_executor_id
  if (selectedExecutorId === undefined || selectedExecutorId.trim().length === 0) {
    return {
      ok: false,
      reasonCode: "selected_executor_missing",
      issues: ["selected_executor_missing"],
    }
  }

  const normalizedSelected = normalizeDecisionNodeId({
    value: selectedExecutorId,
    topologyId: input.topologyId,
    snapshot: input.snapshot,
  })
  if (normalizedSelected === undefined) {
    return {
      ok: false,
      reasonCode: "selected_executor_missing",
      issues: [`missing_selected_executor:${selectedExecutorId}`],
    }
  }
  const rootChildNodeIds = rootChildEntryNodeIds(input.snapshot)
  const rootChildNodeIdSet = new Set(rootChildNodeIds)

  const normalizedPath = normalizeDecisionConnectionPath({
    path: input.executionDecision?.selected_connection_path ?? [],
    topologyId: input.topologyId,
    snapshot: input.snapshot,
  })
  if (!normalizedPath.ok) {
    return {
      ok: false,
      reasonCode: "selected_executor_path_invalid",
      issues: normalizedPath.issues,
    }
  }
  if (normalizedPath.nodeIds.length === 0) {
    if (rootChildNodeIdSet.has(normalizedSelected)) {
      return {
        ok: true,
        entryNodeId: normalizedSelected,
        selectionKind: "execution_decision",
        selectedExecutorId: normalizedSelected,
        selectedConnectionPath: [normalizedSelected],
      }
    }
    return {
      ok: false,
      reasonCode: "selected_executor_not_direct_child",
      issues: [`selected_executor_not_direct_child:${normalizedSelected}`],
    }
  }
  const firstNodeId = normalizedPath.nodeIds[0] ?? ""
  const lastNodeId = normalizedPath.nodeIds[normalizedPath.nodeIds.length - 1] ?? ""
  const pathIssues: string[] = []
  if (!rootChildNodeIdSet.has(firstNodeId)) {
    pathIssues.push(`selected_path_must_start_at_root_child:${rootChildNodeIds.join(",")}`)
  }
  if (lastNodeId !== normalizedSelected) {
    pathIssues.push(`selected_path_must_end_at_executor:${normalizedSelected}`)
  }
  for (let index = 0; index < normalizedPath.nodeIds.length - 1; index += 1) {
    const from = normalizedPath.nodeIds[index]
    const to = normalizedPath.nodeIds[index + 1]
    if (from === undefined || to === undefined) {
      pathIssues.push("selected_connection_path_contains_empty_node")
      continue
    }
    if (!input.snapshot.parentChildTree.edges[from]?.includes(to)) {
      pathIssues.push(`missing_topology_edge:${from}->${to}`)
    }
  }
  if (pathIssues.length > 0) {
    return {
      ok: false,
      reasonCode: "selected_executor_path_invalid",
      issues: pathIssues,
    }
  }

  return {
    ok: true,
    entryNodeId: firstNodeId,
    selectionKind: "execution_decision",
    selectedExecutorId: normalizedSelected,
    selectedConnectionPath: normalizedPath.nodeIds,
  }
}

function rootChildEntryNodeIds(snapshot: CompiledTopologySnapshot): string[] {
  const runtimeRootChildren = snapshot.runtimeExecutionContext.rootChildNodeIds
  if (Array.isArray(runtimeRootChildren) && runtimeRootChildren.length > 0) {
    return [...runtimeRootChildren]
  }
  const treeRootChildren = snapshot.parentChildTree.rootChildNodeIds
  if (Array.isArray(treeRootChildren) && treeRootChildren.length > 0) {
    return [...treeRootChildren]
  }
  return [...snapshot.parentChildTree.rootNodeIds]
}

function normalizeDecisionConnectionPath(input: {
  path: string[]
  topologyId: string
  snapshot: CompiledTopologySnapshot
}): { ok: true; nodeIds: string[] } | { ok: false; issues: string[] } {
  const nodeIds: string[] = []
  const issues: string[] = []
  for (const raw of input.path) {
    const normalized = normalizeDecisionNodeId({
      value: raw,
      topologyId: input.topologyId,
      snapshot: input.snapshot,
    })
    if (normalized === undefined) {
      issues.push(`missing_connection_path_node:${raw}`)
      continue
    }
    nodeIds.push(normalized)
  }
  return issues.length === 0 ? { ok: true, nodeIds } : { ok: false, issues }
}

function normalizeDecisionNodeId(input: {
  value: string
  topologyId: string
  snapshot: CompiledTopologySnapshot
}): string | undefined {
  const trimmed = input.value.trim()
  if (!trimmed) return undefined
  if (input.snapshot.nodeIndex[trimmed] !== undefined) return trimmed
  const topologyPrefix = `${input.topologyId}:`
  if (trimmed.startsWith(topologyPrefix)) {
    const stripped = trimmed.slice(topologyPrefix.length)
    if (input.snapshot.nodeIndex[stripped] !== undefined) return stripped
  }
  const nodeMarker = ":node:"
  const markerIndex = trimmed.indexOf(nodeMarker)
  if (markerIndex >= 0) {
    const nodeId = trimmed.slice(markerIndex + 1)
    if (input.snapshot.nodeIndex[nodeId] !== undefined) return nodeId
  }
  return undefined
}

function explicitTopologyIdFromInput(targetId: string | undefined, message: string): string | undefined {
  const normalizedTarget = normalizeTopologyIdCandidate(targetId)
  if (normalizedTarget !== undefined) return normalizedTarget
  const match = message.match(/\b(?:topology|enterprise-topology):([A-Za-z0-9_.:-]+)/u)
  if (!match?.[0]) return undefined
  return normalizeTopologyIdCandidate(match[0])
}

function normalizeTopologyIdCandidate(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  if (!trimmed) return undefined
  const nodeMarker = ":node:"
  const nodeMarkerIndex = trimmed.indexOf(nodeMarker)
  const topologyScopedValue = nodeMarkerIndex >= 0 ? trimmed.slice(0, nodeMarkerIndex) : trimmed
  if (topologyScopedValue.startsWith("topology:")) return topologyScopedValue
  if (topologyScopedValue.startsWith("enterprise-topology:")) return `topology:${topologyScopedValue.slice("enterprise-topology:".length)}`
  return undefined
}

function isExplicitDirectExecutionTarget(value: string | undefined): boolean {
  const trimmed = value?.trim().toLowerCase()
  if (!trimmed) return false
  return trimmed.startsWith("provider:") || trimmed.startsWith("worker:") || trimmed.startsWith("model:")
}

function fallbackExecution(
  reasonCode: TopologyRootRunExecutionFallbackReasonCode,
  issues: string[],
): Extract<TopologyRootRunExecutionResult, { ok: false }> {
  return {
    ok: false,
    reasonCode,
    fallbackSummary: `Topology runtime fallback: ${reasonCode}.`,
    issues,
  }
}

function buildTopologyFinalAnswer(input: {
  topology: EnterpriseTopology
  entryNode: NodeContract
  nodeResultReport: NodeResultReport
  userRequest: string
}): string {
  const outputSummary = summarizeNodeOutputs(input.nodeResultReport)
  const risks = input.nodeResultReport.risksOrGaps.length > 0
    ? `\n\n검토 필요 항목: ${input.nodeResultReport.risksOrGaps.slice(0, 5).join(", ")}`
    : ""
  return [
    `요청을 active Enterprise Topology "${input.topology.name}"의 "${input.entryNode.name}" 노드로 처리했습니다.`,
    `Nobie final answer: ${outputSummary}`,
    `요청: ${input.userRequest}`,
  ].join("\n\n") + risks
}

function summarizeNodeOutputs(report: NodeResultReport): string {
  const values = report.outputs
    .filter((output) => output.status === "satisfied")
    .map((output) => output.value)
  const stringValue = values.find((value) => typeof value === "string")
  if (typeof stringValue === "string" && stringValue.trim()) return stringValue.trim()
  const objectValue = values.find((value): value is EnterpriseMetadata => {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value)
  })
  if (objectValue !== undefined && typeof objectValue.answer === "string" && objectValue.answer.trim()) {
    return objectValue.answer.trim()
  }
  if (objectValue !== undefined) return JSON.stringify(objectValue).slice(0, 240)
  return report.status
}
