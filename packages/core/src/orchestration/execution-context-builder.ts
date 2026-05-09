import {
  AGENT_EXECUTION_DECISION_CONTRACT_VERSION,
  type AgentExecutionConnection,
  type AgentExecutionContext,
  type AgentExecutionContextRequest,
  type AgentExecutionDiagnosticExecutorProfile,
  type AgentExecutionExecutorProfile,
  type AgentExecutionPermissionPolicy,
  type AgentExecutionRequester,
  type AgentExecutionRiskPolicy,
  type AgentExecutionToolBinding,
} from "./execution-decision-contract.js"
import {
  type ExecutorRuntimeProjection,
  type ExecutionGraphEdgeProjection,
  type ExecutionGraphSnapshot,
  EXECUTION_GRAPH_ROOT_AGENT_ID,
} from "./execution-graph-snapshot.js"
import {
  type ExecutorProfilePromptConnection,
  type ExecutorProfilePromptProjection,
  type ExecutorProfilePromptItem,
} from "./prompt-bundle.js"
import type { ExecutorProfile } from "./registry.js"

export interface BuildAgentExecutionContextFromGraphInput {
  graph: ExecutionGraphSnapshot
  request: AgentExecutionContextRequest
  requester?: AgentExecutionRequester
  availableTools?: AgentExecutionToolBinding[]
  permissionPolicy?: AgentExecutionPermissionPolicy
  riskPolicy?: AgentExecutionRiskPolicy
  currentExecutor?: AgentExecutionExecutorProfile
  directExecutionRequested?: boolean
  explicitTargetExecutorId?: string
  explicitProviderTargetId?: string
}

const DEFAULT_PERMISSION_POLICY: AgentExecutionPermissionPolicy = {
  allowed_tool_ids: [],
}

const DEFAULT_RISK_POLICY: AgentExecutionRiskPolicy = {
  approval_required_for: [
    "privacy",
    "permission",
    "delete",
    "payment",
    "external_transfer",
    "local_system_control",
  ],
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value?.trim())))]
    .sort((left, right) => left.localeCompare(right))
}

function fallbackExecutorProfile(input: {
  executorId: string
  displayName: string
  roleName?: string
  definition?: string
  specialtyTags?: string[]
}): ExecutorProfile {
  const roleName = input.roleName?.trim() || "executor"
  const definition = input.definition?.trim() || `${input.displayName} executor`
  return {
    schemaVersion: 1,
    executorId: input.executorId,
    displayName: input.displayName,
    roleName,
    definition,
    does: input.specialtyTags?.length ? uniqueStrings(input.specialtyTags) : [definition],
    delegationScope: input.specialtyTags?.length ? uniqueStrings(input.specialtyTags) : [roleName],
    expectedOutputs: ["처리 결과"],
    handoffStyle: "structured_handoff",
    declineCriteria: [],
    riskBoundary: [],
  }
}

function runtimeProjectionToExecutorProfile(
  projection: ExecutorRuntimeProjection | undefined,
  executorId: string,
): AgentExecutionExecutorProfile {
  if (!projection) {
    return {
      executor_id: executorId,
      display_name: executorId === EXECUTION_GRAPH_ROOT_AGENT_ID ? "Nobie" : executorId,
      can_delegate: true,
      available: executorId === EXECUTION_GRAPH_ROOT_AGENT_ID,
    }
  }
  const profile = projection.executorProfile ?? fallbackExecutorProfile({
    executorId: projection.agentId,
    displayName: projection.displayName,
    roleName: projection.role,
    definition: projection.role,
    specialtyTags: projection.specialtyTags,
  })
  return {
    executor_id: projection.agentId,
    display_name: projection.displayName,
    role_name: profile.roleName || projection.role,
    definition: profile.definition,
    can_delegate: projection.delegationEnabled,
    available: projection.executionCandidate,
  }
}

function parentExecutorIdFor(graph: ExecutionGraphSnapshot, executorId: string): string | undefined {
  const parents = graph.edges
    .filter((edge) => edge.childAgentId === executorId && edge.executionCandidate)
    .map((edge) => edge.parentAgentId)
    .sort((left, right) => left.localeCompare(right))
  return parents[0]
}

function graphConnection(edge: ExecutionGraphEdgeProjection): AgentExecutionConnection {
  return {
    from_executor_id: edge.parentAgentId,
    to_executor_id: edge.childAgentId,
    relation: "delegates_to",
    label: edge.source,
  }
}

function diagnosticVisibility(input: {
  graph: ExecutionGraphSnapshot
  executorId: string
  directChildIds: Set<string>
  parentId?: string | undefined
}): AgentExecutionDiagnosticExecutorProfile["visibility"] {
  if (input.executorId === input.graph.currentExecutorId) return "current"
  if (input.executorId === input.parentId) return "parent"
  if (input.directChildIds.has(input.executorId)) {
    const projection = input.graph.agentsById[input.executorId]
    return projection?.executionCandidate ? "direct_child" : "unavailable_direct_child"
  }
  return "indirect"
}

export function buildAgentExecutionContextFromGraphSnapshot(
  input: BuildAgentExecutionContextFromGraphInput,
): AgentExecutionContext {
  const graph = input.graph
  const currentExecutorId = graph.currentExecutorId
  const currentExecutor = input.currentExecutor ??
    runtimeProjectionToExecutorProfile(graph.agentsById[currentExecutorId], currentExecutorId)
  const availableChildIds = new Set(graph.availableExecutorIds)
  const parentId = parentExecutorIdFor(graph, currentExecutorId)
  const parentExecutor = parentId
    ? runtimeProjectionToExecutorProfile(graph.agentsById[parentId], parentId)
    : undefined
  const accessibleExecutors = graph.availableExecutorIds.map((executorId) =>
    runtimeProjectionToExecutorProfile(graph.agentsById[executorId], executorId),
  )
  const directChildIds = new Set(graph.directChildAgentIdsByParent[currentExecutorId] ?? [])
  const registeredExecutorIds = graph.allRegisteredExecutorIds ?? graph.allActiveExecutorIds
  const diagnosticExecutors = registeredExecutorIds
    .filter((executorId) => executorId !== currentExecutorId && !availableChildIds.has(executorId))
    .map((executorId): AgentExecutionDiagnosticExecutorProfile => {
      const projection = graph.agentsById[executorId]
      return {
        ...runtimeProjectionToExecutorProfile(projection, executorId),
        visibility: diagnosticVisibility({ graph, executorId, directChildIds, parentId }),
        ...(projection?.source ? { graph_source: projection.source } : {}),
        parent_executor_ids: graph.edges
          .filter((edge) => edge.childAgentId === executorId)
          .map((edge) => edge.parentAgentId)
          .sort((left, right) => left.localeCompare(right)),
        ...(projection?.reasonCodes ? { reason_codes: projection.reasonCodes } : {}),
      }
    })
  const accessibleConnections = graph.edges
    .filter((edge) => edge.executionCandidate)
    .map(graphConnection)
  return {
    contract_version: AGENT_EXECUTION_DECISION_CONTRACT_VERSION,
    request: input.request,
    current_executor: currentExecutor,
    ...(parentExecutor ? { parent_executor: parentExecutor } : {}),
    ...(input.requester ? { requester: input.requester } : {}),
    accessible_executors: accessibleExecutors,
    diagnostic_executors: diagnosticExecutors,
    accessible_connections: accessibleConnections,
    available_tools: input.availableTools ?? [],
    permission_policy: input.permissionPolicy ?? DEFAULT_PERMISSION_POLICY,
    risk_policy: input.riskPolicy ?? DEFAULT_RISK_POLICY,
    execution_graph: {
      graph_id: graph.graphId,
      graph_source: graph.graphSource,
      root_executor_id: graph.rootAgentId,
      current_executor_id: currentExecutorId,
      available_executor_ids: [...graph.availableExecutorIds],
      diagnostic_executor_ids: diagnosticExecutors.map((executor) => executor.executor_id),
      all_active_executor_ids: [...graph.allActiveExecutorIds],
      all_registered_executor_ids: [...registeredExecutorIds],
      allowed_connections: accessibleConnections,
      validation_issue_codes: graph.validationIssues.map((issue) => issue.code),
      ...(graph.topologyId ? { topology_id: graph.topologyId } : {}),
      ...(graph.topologyVersion !== undefined ? { topology_version: graph.topologyVersion } : {}),
    },
    ...(input.directExecutionRequested !== undefined
      ? { direct_execution_requested: input.directExecutionRequested }
      : {}),
    ...(input.explicitTargetExecutorId ? { explicit_target_executor_id: input.explicitTargetExecutorId } : {}),
    ...(input.explicitProviderTargetId
      ? { explicit_provider_target_id: input.explicitProviderTargetId }
      : {}),
  }
}

function promptItemForGraphExecutor(
  graph: ExecutionGraphSnapshot,
  executorId: string,
): ExecutorProfilePromptItem | undefined {
  const projection = graph.agentsById[executorId]
  if (!projection) return undefined
  const profile = projection.executorProfile ?? fallbackExecutorProfile({
    executorId,
    displayName: projection.displayName,
    roleName: projection.role,
    definition: projection.role,
    specialtyTags: projection.specialtyTags,
  })
  return {
    ...profile,
    executorId,
    displayName: projection.displayName,
    connectedNextExecutorIds: uniqueStrings(
      graph.edges
        .filter((edge) => edge.parentAgentId === executorId && edge.executionCandidate)
        .map((edge) => edge.childAgentId),
    ),
  }
}

export function buildExecutorProfilePromptProjectionFromGraphSnapshot(
  graph: ExecutionGraphSnapshot,
): ExecutorProfilePromptProjection {
  const selectableExecutors = graph.availableExecutorIds.flatMap((executorId) => {
    const item = promptItemForGraphExecutor(graph, executorId)
    return item ? [item] : []
  })
  const selectableIds = new Set(selectableExecutors.map((executor) => executor.executorId))
  const registeredExecutorIds = graph.allRegisteredExecutorIds ?? graph.allActiveExecutorIds
  const diagnosticExecutors = registeredExecutorIds
    .filter((executorId) => executorId !== graph.currentExecutorId && !selectableIds.has(executorId))
    .flatMap((executorId) => {
      const item = promptItemForGraphExecutor(graph, executorId)
      return item ? [item] : []
    })
  const connections: ExecutorProfilePromptConnection[] = graph.edges
    .filter((edge) => edge.executionCandidate)
    .map((edge) => ({
      fromExecutorId: edge.parentAgentId,
      toExecutorId: edge.childAgentId,
      relation: edge.source,
    }))
  return {
    currentExecutorId: graph.currentExecutorId,
    graphSource: graph.graphSource,
    selectableExecutors,
    diagnosticExecutors,
    connections,
  }
}
