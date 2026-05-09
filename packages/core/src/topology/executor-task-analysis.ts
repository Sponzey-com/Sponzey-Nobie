import type { ExecutorConnectionDraft, ExecutorDraft } from "./executor-graph.js"
import type { AgentExecutionRiskBoundary } from "../orchestration/execution-decision-contract.js"

export type NodeTaskAnalysisSource = "rule_based" | "llm_assisted" | "user_confirmed" | "runtime_refined"

export interface RecoveryAlternative {
  alternativeId: string
  title: string
  changedDimension:
    | "target"
    | "tool"
    | "input_shape"
    | "path"
    | "permission"
    | "execution_order"
    | "task_split"
    | "verification"
    | "fallback_route"
  description: string
}

export interface NodeTaskUnit {
  taskUnitId: string
  title: string
  description: string
  expectedOutput: string
  requiredCapabilities: string[]
  requiredTools: string[]
  canDelegate: boolean
  dependencyTaskUnitIds: string[]
}

export interface NodeTaskAnalysis {
  analysisId: string
  executorId: string
  source: NodeTaskAnalysisSource
  purpose: string
  goals: string[]
  taskUnits: NodeTaskUnit[]
  requiredCapabilities: string[]
  requiredTools: string[]
  inputNeeds: string[]
  outputShape: string
  completionCondition: string
  successSignals: string[]
  failureBoundaries: string[]
  safeAlternatives: RecoveryAlternative[]
  confidence: number
  needsUserConfirmation: boolean
  createdAt: string
  updatedAt: string
}

export function buildNodeTaskAnalysis(input: {
  executor: ExecutorDraft
  incomingConnections?: ExecutorConnectionDraft[]
  outgoingConnections?: ExecutorConnectionDraft[]
  now?: string
  source?: NodeTaskAnalysisSource
  riskBoundary?: AgentExecutionRiskBoundary
}): NodeTaskAnalysis {
  const now = input.now ?? new Date(0).toISOString()
  const description = input.executor.description.trim()
  const purpose = description.length > 0 ? description : `${input.executor.name} 역할의 업무를 처리한다.`
  const goals = buildGoals(input.executor)
  const taskUnits = buildTaskUnits(input.executor, goals)
  const requiredCapabilities = [...new Set(taskUnits.flatMap((taskUnit) => taskUnit.requiredCapabilities))]
  const requiredTools = [...new Set(taskUnits.flatMap((taskUnit) => taskUnit.requiredTools))]
  const riskBoundary = structuredRiskBoundary(input.executor, input.riskBoundary)
  const needsUserConfirmation = riskBoundary.requiresUserConfirmation
  return {
    analysisId: `node-task-analysis:${input.executor.id}`,
    executorId: input.executor.id,
    source: input.source ?? "rule_based",
    purpose,
    goals,
    taskUnits,
    requiredCapabilities,
    requiredTools,
    inputNeeds: buildInputNeeds(input.incomingConnections ?? []),
    outputShape: input.executor.inferredOutputs[0] ?? "처리 결과",
    completionCondition: input.executor.inferredSuccessCriteria[0] ?? "요청한 업무가 처리 결과로 남는다.",
    successSignals: input.executor.inferredSuccessCriteria.length > 0
      ? [...input.executor.inferredSuccessCriteria]
      : ["처리 결과가 기록됨"],
    failureBoundaries: riskBoundary.failureBoundaries,
    safeAlternatives: buildSafeAlternatives(input.executor),
    confidence: input.executor.confidence,
    needsUserConfirmation,
    createdAt: now,
    updatedAt: now,
  }
}

function buildGoals(executor: ExecutorDraft): string[] {
  const goals = [
    `${executor.name}의 역할에 맞게 입력을 해석한다.`,
    `${executor.inferredOutputs[0] ?? "처리 결과"}를 만든다.`,
  ]
  if (executor.inferredSuccessCriteria.length > 0) {
    goals.push(...executor.inferredSuccessCriteria.slice(0, 2))
  }
  return [...new Set(goals)]
}

function buildTaskUnits(executor: ExecutorDraft, goals: string[]): NodeTaskUnit[] {
  return goals.slice(0, 3).map((goal, index) => ({
    taskUnitId: `task-unit:${executor.id}:${index + 1}`,
    title: index === 0 ? "입력 이해" : index === 1 ? "업무 처리" : "결과 검증",
    description: goal,
    expectedOutput: executor.inferredOutputs[0] ?? "처리 결과",
    requiredCapabilities: [...executor.inferredCapabilities],
    requiredTools: [...executor.inferredTools],
    canDelegate: true,
    dependencyTaskUnitIds: index === 0 ? [] : [`task-unit:${executor.id}:${index}`],
  }))
}

function buildInputNeeds(connections: ExecutorConnectionDraft[]): string[] {
  if (connections.length === 0) return ["사용자 실행 입력"]
  return connections.map((connection) => `이전 실행자 ${connection.fromExecutorId}의 ${connection.label}`)
}

function structuredRiskBoundary(
  executor: ExecutorDraft,
  executionRiskBoundary?: AgentExecutionRiskBoundary,
): {
  requiresUserConfirmation: boolean
  failureBoundaries: string[]
} {
  if (executionRiskBoundary) {
    return {
      requiresUserConfirmation: executionRiskBoundary.requires_user_approval,
      failureBoundaries: [executionRiskBoundary.reason || "구조화된 실행 결정의 위험 경계를 따른다."],
    }
  }
  const profileBoundaries = executor.executorProfile?.riskBoundary ?? []
  if (profileBoundaries.length > 0) {
    return {
      requiresUserConfirmation: true,
      failureBoundaries: [...profileBoundaries],
    }
  }
  return {
    requiresUserConfirmation: false,
    failureBoundaries: ["안전한 대안이 없을 때만 실패로 전환"],
  }
}

function buildSafeAlternatives(executor: ExecutorDraft): RecoveryAlternative[] {
  return [
    {
      alternativeId: `alternative:${executor.id}:task-split`,
      title: "작업을 더 작게 나누기",
      changedDimension: "task_split",
      description: "한 번에 처리하지 않고 더 작은 태스크 단위로 나누어 다시 시도한다.",
    },
    {
      alternativeId: `alternative:${executor.id}:fallback-route`,
      title: "다른 실행 경로 찾기",
      changedDimension: "fallback_route",
      description: "맞는 서브 에이전트, 연장, 노비 직접 처리 순서로 다른 경로를 찾는다.",
    },
  ]
}
