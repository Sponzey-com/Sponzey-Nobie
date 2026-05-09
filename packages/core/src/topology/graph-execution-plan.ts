import type { ExecutorConnectionDraft, ExecutorGraphWorkspace } from "./executor-graph.js"
import { type NodeDelegationResolution, resolveNodeDelegation } from "./executor-delegation-resolution.js"
import { type NodeTaskAnalysis, buildNodeTaskAnalysis } from "./executor-task-analysis.js"
import { type ExecutionPolicySnapshot, createDefaultExecutionPolicySnapshot } from "../runs/execution-policy.js"

export interface CancellationPolicySnapshot {
  userCancelPriority: true
  cancellationOutcome: "cancelled"
}

export interface NodeExecutionPlan {
  executorId: string
  nodeContractId: string
  taskAnalysis: NodeTaskAnalysis
  delegationResolution: NodeDelegationResolution
  inputBindings: string[]
  outputBindings: string[]
}

export interface EdgeExecutionPlan {
  edgeId: string
  sourceExecutorId: string
  targetExecutorId: string
  relationKind: string
  executionBehavior: "handoff" | "approval" | "review" | "report" | "exception" | "reference" | "collaboration"
  propagation: "sequential" | "parallel" | "conditional"
}

export interface GraphExecutionPlan {
  graphExecutionPlanId: string
  topologyId: string
  workspaceId: string
  entryExecutorIds: string[]
  nodePlans: NodeExecutionPlan[]
  edgePlans: EdgeExecutionPlan[]
  recoveryPolicy: ExecutionPolicySnapshot
  cancellationPolicy: CancellationPolicySnapshot
  validationWarnings: string[]
  createdAt: string
}

export function buildGraphExecutionPlan(input: {
  workspaceId: string
  graph: ExecutorGraphWorkspace
  now?: string
}): GraphExecutionPlan {
  const now = input.now ?? new Date(0).toISOString()
  const incomingByExecutor = new Map<string, ExecutorConnectionDraft[]>()
  const outgoingByExecutor = new Map<string, ExecutorConnectionDraft[]>()
  for (const connection of input.graph.connections) {
    incomingByExecutor.set(connection.toExecutorId, [...(incomingByExecutor.get(connection.toExecutorId) ?? []), connection])
    outgoingByExecutor.set(connection.fromExecutorId, [...(outgoingByExecutor.get(connection.fromExecutorId) ?? []), connection])
  }
  const nodePlans = input.graph.executors.map((executor) => {
    const taskAnalysis = buildNodeTaskAnalysis({
      executor,
      incomingConnections: incomingByExecutor.get(executor.id) ?? [],
      outgoingConnections: outgoingByExecutor.get(executor.id) ?? [],
      now,
    })
    const delegationResolution = resolveNodeDelegation({
      executorId: executor.id,
      nodeContractId: executor.sourceNodeId ?? executor.id,
      taskAnalysis,
      now,
    })
    return {
      executorId: executor.id,
      nodeContractId: executor.sourceNodeId ?? executor.id,
      taskAnalysis,
      delegationResolution,
      inputBindings: taskAnalysis.inputNeeds,
      outputBindings: [taskAnalysis.outputShape],
    }
  })
  const edgePlans = input.graph.connections.map(edgeExecutionPlanFromConnection)
  return {
    graphExecutionPlanId: `graph-execution-plan:${input.graph.graphId}`,
    topologyId: input.graph.topologyId,
    workspaceId: input.workspaceId,
    entryExecutorIds: findEntryExecutorIds(input.graph),
    nodePlans,
    edgePlans,
    recoveryPolicy: createDefaultExecutionPolicySnapshot(),
    cancellationPolicy: {
      userCancelPriority: true,
      cancellationOutcome: "cancelled",
    },
    validationWarnings: validateGraphExecutionPlan({ nodePlans, edgePlans }),
    createdAt: now,
  }
}

export function validateGraphExecutionPlan(input: {
  nodePlans: NodeExecutionPlan[]
  edgePlans: EdgeExecutionPlan[]
}): string[] {
  const warnings: string[] = []
  const nodeIds = new Set(input.nodePlans.map((node) => node.executorId))
  for (const node of input.nodePlans) {
    if (!node.delegationResolution || node.delegationResolution.visibility !== "visible_node") {
      warnings.push(`node_not_visible:${node.executorId}`)
    }
  }
  for (const edge of input.edgePlans) {
    if (!nodeIds.has(edge.sourceExecutorId)) warnings.push(`missing_edge_source:${edge.edgeId}`)
    if (!nodeIds.has(edge.targetExecutorId)) warnings.push(`missing_edge_target:${edge.edgeId}`)
  }
  return warnings
}

function findEntryExecutorIds(graph: ExecutorGraphWorkspace): string[] {
  const targets = new Set(graph.connections.map((connection) => connection.toExecutorId))
  const entries = graph.executors.filter((executor) => !targets.has(executor.id)).map((executor) => executor.id)
  return entries.length > 0 ? entries : graph.executors.slice(0, 1).map((executor) => executor.id)
}

function edgeExecutionPlanFromConnection(connection: ExecutorConnectionDraft): EdgeExecutionPlan {
  const behavior = connection.inferredRelation === "approval_request"
    ? "approval"
    : connection.inferredRelation === "report"
      ? "report"
      : connection.inferredRelation === "exception"
        ? "exception"
        : connection.inferredRelation === "reference"
          ? "reference"
          : connection.inferredRelation === "collaboration"
            ? "collaboration"
            : "handoff"
  return {
    edgeId: connection.id,
    sourceExecutorId: connection.fromExecutorId,
    targetExecutorId: connection.toExecutorId,
    relationKind: connection.inferredRelation,
    executionBehavior: behavior,
    propagation: behavior === "exception" ? "conditional" : behavior === "collaboration" ? "parallel" : "sequential",
  }
}
