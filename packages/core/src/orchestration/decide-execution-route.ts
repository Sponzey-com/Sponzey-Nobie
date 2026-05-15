import type { AIProvider, ProviderAuditTrace } from "../ai/index.js"
import {
  buildAgentExecutionContextFromGraphSnapshot,
  type BuildAgentExecutionContextFromGraphInput,
} from "./execution-context-builder.js"
import type {
  AgentExecutionContext,
  AgentExecutionContextRequest,
  AgentExecutionDecision,
  AgentExecutionDecisionTraceSnapshot,
  AgentExecutionRequester,
} from "./execution-decision-contract.js"
import {
  buildExecutionGraphSnapshot,
  EXECUTION_GRAPH_ROOT_AGENT_ID,
  type BuildExecutionGraphSnapshotInput,
  type ExecutionGraphSnapshot,
} from "./execution-graph-snapshot.js"
import {
  runAgentExecutionHarness,
  type AgentExecutionHarnessResult,
  type AgentExecutionModelCaller,
} from "./execution-harness.js"

export const DECIDE_EXECUTION_ROUTE_KINDS = [
  "delegate_to_child",
  "self_solve",
  "ask_user",
  "boundary_failure",
  "explicit_provider_target",
] as const

export type DecideExecutionRouteKind = (typeof DECIDE_EXECUTION_ROUTE_KINDS)[number]

export interface DecideExecutionResolvedTarget {
  targetId?: string
  targetLabel?: string
  providerId?: string
  model?: string
  provider?: AIProvider
  providerTrace?: ProviderAuditTrace
  workerRuntime?: unknown
  reason: string
}

export interface ResolveExplicitProviderTargetInput {
  preferredTarget?: string | undefined
  taskProfile?: string | undefined
  fallbackModel?: string | undefined
}

export interface DecideExecutionRouteInput {
  originalRequest: string
  delegatedTitle: string
  delegatedTaskProfile: string
  sessionId: string
  source: string
  preferredTarget?: string | undefined
  fallbackModel?: string | undefined
  currentExecutorId?: string | undefined
  buildExecutionGraphSnapshot?: ((input?: BuildExecutionGraphSnapshotInput) => ExecutionGraphSnapshot) | undefined
  buildExecutionContext?: ((input: BuildAgentExecutionContextFromGraphInput) => AgentExecutionContext) | undefined
  runAgentExecutionHarness?: typeof runAgentExecutionHarness | undefined
  callModel?: AgentExecutionModelCaller | undefined
  resolveExplicitProviderTarget?: ((input: ResolveExplicitProviderTargetInput) => DecideExecutionResolvedTarget | undefined) | undefined
}

export type DecideExecutionRouteResult =
  | {
      kind: "explicit_provider_target"
      route: DecideExecutionResolvedTarget
    }
  | {
      kind: "delegate_to_child"
      route: DecideExecutionResolvedTarget
      agentExecutionDecision: AgentExecutionDecision
      decisionResult: AgentExecutionHarnessResult
      executionGraph: ExecutionGraphSnapshot
      executionContext: AgentExecutionContext
    }
  | {
      kind: "self_solve" | "ask_user" | "boundary_failure"
      agentExecutionDecision: AgentExecutionDecision
      decisionResult: AgentExecutionHarnessResult
      executionGraph: ExecutionGraphSnapshot
      executionContext: AgentExecutionContext
    }

export function normalizeExplicitExecutionTarget(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  if (!trimmed || trimmed === "auto" || trimmed === "embedded" || trimmed === "local_reasoner") {
    return undefined
  }
  return trimmed
}

export function isExplicitProviderExecutionTarget(value: string | undefined): boolean {
  const normalized = normalizeExplicitExecutionTarget(value)?.toLowerCase()
  if (!normalized) return false
  return normalized.startsWith("provider:")
    || normalized.startsWith("worker:")
    || normalized.startsWith("model:")
    || normalized === "openai"
    || normalized === "anthropic"
    || normalized === "gemini"
    || normalized === "ollama"
    || normalized === "llama"
    || normalized === "llama_cpp"
}

export async function decideExecutionRoute(
  input: DecideExecutionRouteInput,
): Promise<DecideExecutionRouteResult> {
  if (isExplicitProviderExecutionTarget(input.preferredTarget)) {
    const explicitRoute = input.resolveExplicitProviderTarget?.({
      preferredTarget: input.preferredTarget,
      taskProfile: input.delegatedTaskProfile,
      fallbackModel: input.fallbackModel,
    })
    if (explicitRoute && hasExplicitProviderResolution(explicitRoute)) {
      return {
        kind: "explicit_provider_target",
        route: explicitRoute,
      }
    }
  }

  const buildGraph = input.buildExecutionGraphSnapshot ?? buildExecutionGraphSnapshot
  const executionGraph = buildGraph({
    mode: "active_deployment",
    currentExecutorId: input.currentExecutorId ?? EXECUTION_GRAPH_ROOT_AGENT_ID,
  })
  const buildContext = input.buildExecutionContext ?? buildAgentExecutionContextFromGraphSnapshot
  const explicitTarget = normalizeExplicitExecutionTarget(input.preferredTarget)
  const explicitProviderTarget = isExplicitProviderExecutionTarget(input.preferredTarget)
    ? explicitTarget
    : undefined
  const executionContext = buildContext({
    graph: executionGraph,
    request: buildDecisionRequest(input),
    requester: buildDecisionRequester(input),
    directExecutionRequested: false,
    ...(explicitTarget ? { explicitTargetExecutorId: explicitTarget } : {}),
    ...(explicitProviderTarget ? { explicitProviderTargetId: explicitProviderTarget } : {}),
  })
  const runHarness = input.runAgentExecutionHarness ?? runAgentExecutionHarness
  const decisionResult = await runHarness({
    context: executionContext,
    ...(input.callModel ? { callModel: input.callModel } : {}),
  })
  const decision = decisionResult.decision

  if (isDelegateToChildDecision(decision)) {
    const selectedExecutorId = decision.selected_executor_id
    return {
      kind: "delegate_to_child",
      route: {
        targetId: selectedExecutorId,
        targetLabel: executorLabel(executionGraph, selectedExecutorId),
        reason: `execution_decision:${decision.execution_route}`,
      },
      agentExecutionDecision: decision,
      decisionResult,
      executionGraph,
      executionContext,
    }
  }

  return {
    kind: fallbackRouteKind(decision),
    agentExecutionDecision: decision,
    decisionResult,
    executionGraph,
    executionContext,
  }
}

export function executionDecisionTraceForResult(
  result: DecideExecutionRouteResult,
): AgentExecutionDecisionTraceSnapshot | undefined {
  return "decisionResult" in result ? result.decisionResult.decisionTrace : undefined
}

function hasExplicitProviderResolution(route: DecideExecutionResolvedTarget): boolean {
  return Boolean(
    route.targetId?.trim() ||
      route.providerId?.trim() ||
      route.workerRuntime ||
      route.model?.trim(),
  )
}

function buildDecisionRequest(input: DecideExecutionRouteInput): AgentExecutionContextRequest {
  return {
    kind: "user_message",
    latest_user_message: input.originalRequest,
    structured_goal: input.delegatedTitle.trim() || input.originalRequest,
    required_outputs: [{
      id: "answer",
      label: "사용자에게 전달할 최종 결과",
      acceptance_criteria: ["요청의 핵심 결과와 남은 이슈를 분명히 전달한다."],
    }],
    channel_id: input.sessionId,
  }
}

function buildDecisionRequester(input: DecideExecutionRouteInput): AgentExecutionRequester {
  return {
    requester_id: input.sessionId,
    requester_type: "channel",
    display_name: input.source,
  }
}

function isDelegateToChildDecision(decision: AgentExecutionDecision): decision is AgentExecutionDecision & {
  selected_executor_id: string
} {
  return decision.execution_route === "delegate_to_child" && Boolean(decision.selected_executor_id?.trim())
}

function fallbackRouteKind(decision: AgentExecutionDecision): "self_solve" | "ask_user" | "boundary_failure" {
  if (decision.execution_route === "boundary_failure") return "boundary_failure"
  if (
    decision.execution_route === "ask_user" ||
    decision.execution_route === "ask_parent" ||
    decision.execution_route === "return_to_parent"
  ) {
    return "ask_user"
  }
  return "self_solve"
}

function executorLabel(graph: ExecutionGraphSnapshot, executorId: string): string {
  return graph.agentsById[executorId]?.displayName?.trim() || executorId
}
