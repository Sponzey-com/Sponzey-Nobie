import type {
  EnterpriseMetadata,
  EnterpriseMetadataValue,
  NodeRuntimeState,
  TraceEvent,
  WorkOrder,
} from "../contracts/enterprise-topology.js"
import type { ToolDispatcher } from "../tools/dispatcher.js"
import type { ToolContext, ToolResult } from "../tools/types.js"
import {
  createNodeRuntimeTraceEvent,
} from "./trace.js"
import type {
  NodeToolExecutionPlan,
  NodeToolPlanIssue,
  PlannedNodeToolCall,
} from "./tool-planner.js"

export type TopologyToolDispatcher = Pick<ToolDispatcher, "dispatch">
export type NodeToolExecutionStatus = "succeeded" | "denied" | "timeout" | "execution_error" | "skipped"

export interface NormalizedNodeToolResult {
  toolId: string
  dispatcherToolName: string
  status: NodeToolExecutionStatus
  reasonCode: string
  output?: EnterpriseMetadataValue
  error?: string
  retryPossible: boolean
  fallbackPossible: boolean
  failureCandidate: boolean
  startedAt: number
  completedAt: number
  traceEvents: TraceEvent[]
  failureCandidateInfo?: EnterpriseMetadata
}

export interface NodeToolExecutionSummary {
  status: "completed" | "partial" | "failed_candidate" | "skipped"
  plan: NodeToolExecutionPlan
  results: NormalizedNodeToolResult[]
  failureCandidateResults: NormalizedNodeToolResult[]
  traceEvents: TraceEvent[]
  reasonCodes: string[]
}

export interface DispatchPlannedNodeToolsInput {
  plan: NodeToolExecutionPlan
  dispatcher: TopologyToolDispatcher
  workOrder: WorkOrder
  nodeRunId: string
  baseToolContext: ToolContext
  now?: () => number
  traceSequenceStart?: number
}

export async function dispatchPlannedNodeTools(
  input: DispatchPlannedNodeToolsInput,
): Promise<NodeToolExecutionSummary> {
  const now = input.now ?? Date.now
  let traceSequence = input.traceSequenceStart ?? 0
  const results: NormalizedNodeToolResult[] = []

  for (const blocked of input.plan.blocked) {
    const result = resultForBlockedToolPlan({
      issue: blocked,
      workOrder: input.workOrder,
      nodeRunId: input.nodeRunId,
      at: now(),
      sequence: ++traceSequence,
    })
    results.push(result)
  }

  for (const call of input.plan.toolCalls) {
    const startedAt = now()
    const startTrace = createNodeRuntimeTraceEvent({
      workOrder: input.workOrder,
      nodeRunId: input.nodeRunId,
      state: "tool_executing",
      sequence: ++traceSequence,
      at: startedAt,
      phase: "tool_execution",
      component: "node-tool-dispatcher",
      reasonCode: "tool_execution_started",
      payload: {
        toolId: call.toolId,
        dispatcherToolName: call.dispatcherToolName,
        toolType: call.toolType,
        approvalStatus: call.approvalStatus,
      },
    })

    const execution = await dispatchOneTool({
      call,
      dispatcher: input.dispatcher,
      baseToolContext: input.baseToolContext,
    })
    const completedAt = now()
    const status = normalizeToolExecutionStatus(execution)
    const reasonCode = reasonCodeForExecutionStatus(status, execution)
    const failureCandidate = status !== "succeeded"
    const retryPossible = failureCandidate && (status === "timeout" || status === "execution_error")
    const fallbackPossible = failureCandidate && call.fallbackNodeIds.length > 0
    const doneTrace = createNodeRuntimeTraceEvent({
      workOrder: input.workOrder,
      nodeRunId: input.nodeRunId,
      state: "tool_executing",
      sequence: ++traceSequence,
      at: completedAt,
      phase: "tool_execution",
      component: "node-tool-dispatcher",
      reasonCode,
      payload: {
        toolId: call.toolId,
        dispatcherToolName: call.dispatcherToolName,
        status,
        retryPossible,
        fallbackPossible,
        ...(execution.result?.error !== undefined ? { error: execution.result.error } : {}),
      },
    })

    results.push({
      toolId: call.toolId,
      dispatcherToolName: call.dispatcherToolName,
      status,
      reasonCode,
      ...(execution.result?.output !== undefined ? { output: execution.result.output } : {}),
      ...(execution.result?.error !== undefined ? { error: execution.result.error } : {}),
      retryPossible,
      fallbackPossible,
      failureCandidate,
      startedAt,
      completedAt,
      traceEvents: [startTrace, doneTrace],
      ...(failureCandidate
        ? {
            failureCandidateInfo: {
              reasonCode,
              retryPossible,
              fallbackPossible,
              fallbackNodeIds: call.fallbackNodeIds,
            },
          }
        : {}),
    })
  }

  const failureCandidateResults = results.filter((result) => result.failureCandidate)
  const succeededCount = results.filter((result) => result.status === "succeeded").length
  const status =
    results.length === 0
      ? "skipped"
      : failureCandidateResults.length === 0
        ? "completed"
        : succeededCount > 0
          ? "partial"
          : "failed_candidate"

  return {
    status,
    plan: input.plan,
    results,
    failureCandidateResults,
    traceEvents: results.flatMap((result) => result.traceEvents),
    reasonCodes: [
      ...input.plan.reasonCodes,
      status === "completed"
        ? "node_tool_execution_completed"
        : status === "partial"
          ? "node_tool_execution_partial"
          : status === "failed_candidate"
            ? "node_tool_execution_failed_candidate"
            : "node_tool_execution_skipped",
    ],
  }
}

async function dispatchOneTool(input: {
  call: PlannedNodeToolCall
  dispatcher: TopologyToolDispatcher
  baseToolContext: ToolContext
}): Promise<{ timedOut: boolean; result?: ToolResult; thrown?: unknown }> {
  const dispatchPromise = input.dispatcher.dispatch(
    input.call.dispatcherToolName,
    input.call.input,
    input.baseToolContext,
  )

  if (input.call.timeoutMs === undefined || input.call.timeoutMs <= 0) {
    try {
      return { timedOut: false, result: await dispatchPromise }
    } catch (error) {
      return { timedOut: false, thrown: error }
    }
  }

  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      dispatchPromise
        .then((result) => ({ timedOut: false, result }))
        .catch((error) => ({ timedOut: false, thrown: error })),
      new Promise<{ timedOut: true }>((resolve) => {
        timeout = setTimeout(() => resolve({ timedOut: true }), input.call.timeoutMs)
      }),
    ])
  } finally {
    if (timeout !== undefined) clearTimeout(timeout)
  }
}

function resultForBlockedToolPlan(input: {
  issue: NodeToolPlanIssue
  workOrder: WorkOrder
  nodeRunId: string
  at: number
  sequence: number
}): NormalizedNodeToolResult {
  return {
    toolId: input.issue.toolId,
    dispatcherToolName: input.issue.toolId,
    status: "denied",
    reasonCode: input.issue.reasonCode,
    error: input.issue.message,
    retryPossible: false,
    fallbackPossible: false,
    failureCandidate: true,
    startedAt: input.at,
    completedAt: input.at,
    traceEvents: [
      createNodeRuntimeTraceEvent({
        workOrder: input.workOrder,
        nodeRunId: input.nodeRunId,
        state: "tool_executing",
        sequence: input.sequence,
        at: input.at,
        phase: "tool_execution",
        component: "node-tool-dispatcher",
        reasonCode: input.issue.reasonCode,
        payload: {
          toolId: input.issue.toolId,
          status: "denied",
          ...(input.issue.systemId !== undefined ? { systemId: input.issue.systemId } : {}),
        },
      }),
    ],
    failureCandidateInfo: {
      reasonCode: input.issue.reasonCode,
      retryPossible: false,
      fallbackPossible: false,
    },
  }
}

function normalizeToolExecutionStatus(input: {
  timedOut: boolean
  result?: ToolResult
  thrown?: unknown
}): NodeToolExecutionStatus {
  if (input.timedOut) return "timeout"
  if (input.thrown !== undefined) return "execution_error"
  if (input.result?.success === true) return "succeeded"
  if (isDeniedToolResult(input.result)) return "denied"
  return "execution_error"
}

function reasonCodeForExecutionStatus(
  status: NodeToolExecutionStatus,
  input: { result?: ToolResult; thrown?: unknown },
): string {
  if (status === "succeeded") return "tool_execution_succeeded"
  if (status === "timeout") return "tool_execution_timeout"
  if (status === "denied") return input.result?.error ?? "tool_execution_denied"
  return input.result?.error ?? (input.thrown instanceof Error ? input.thrown.message : "tool_execution_error")
}

function isDeniedToolResult(result: ToolResult | undefined): boolean {
  if (result?.success !== false) return false
  const error = result.error?.toLowerCase() ?? ""
  return error.includes("denied") || error.includes("approval") || error.includes("not_allowed") || error.includes("policy")
}
