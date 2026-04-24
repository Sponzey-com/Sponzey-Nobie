import { CONTRACT_SCHEMA_VERSION } from "../contracts/index.js"
import type {
  CommandRequest,
  OrchestrationPlan,
  StructuredTaskScope,
  SubSessionContract,
} from "../contracts/sub-agent-orchestration.js"
import type { OrchestrationModeSnapshot } from "./mode.js"
import {
  buildDefaultStructuredTaskScope,
  buildOrchestrationPlan,
  type OrchestrationPlannerIntent,
} from "./planner.js"
import type { OrchestrationRegistrySnapshot } from "./registry.js"

const DEFAULT_ROOT_AGENT_ID = "agent:nobie"
const DEFAULT_MAX_DEPTH = 5
const DEFAULT_MAX_CHILDREN_PER_AGENT = 10

export interface NestedCommandValidationResult {
  ok: boolean
  reasonCodes: string[]
}

export interface NestedSpawnBudgetInput {
  taskScopes: StructuredTaskScope[]
  maxChildrenPerAgent?: number
  nestedSpawnBudgetRemaining?: number
}

export interface NestedSpawnBudgetDecision {
  status: "ok" | "shrunk" | "blocked"
  selectedTaskScopes: StructuredTaskScope[]
  skipped: Array<{ index: number; reasonCode: string }>
  totals: {
    requestedChildren: number
    selectedChildren: number
    remainingBudget: number | null
  }
  reasonCodes: string[]
}

export interface NestedDelegationPlannerInput {
  parentRunId: string
  parentRequestId: string
  parentAgentId: string
  userRequest: string
  modeSnapshot: OrchestrationModeSnapshot
  registrySnapshot: OrchestrationRegistrySnapshot
  parentSubSessionId?: string
  parentSubSessionDepth?: number
  taskScopes?: StructuredTaskScope[]
  intent?: OrchestrationPlannerIntent
  maxDepth?: number
  maxChildrenPerAgent?: number
  nestedSpawnBudgetRemaining?: number
  now?: () => number
  idProvider?: () => string
}

export interface NestedDelegationPlanResult {
  ok: boolean
  status: "planned" | "shrunk" | "blocked"
  plan?: OrchestrationPlan
  parentAgentId: string
  parentSubSessionId?: string
  parentSubSessionDepth: number
  childDepth: number
  budget: NestedSpawnBudgetDecision
  reasonCodes: string[]
}

function normalizedPositiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return fallback
  return Math.floor(value)
}

function normalizedDepth(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value < 0) return 0
  return Math.floor(value)
}

function rootAgentIdFor(registry: OrchestrationRegistrySnapshot | undefined): string {
  return registry?.hierarchy?.rootAgentId ?? DEFAULT_ROOT_AGENT_ID
}

function isRootAgent(agentId: string | undefined, rootAgentId: string): boolean {
  return !agentId || agentId === rootAgentId
}

function commandParentSubSessionId(command: CommandRequest): string | undefined {
  const value = command.identity.parent?.parentSubSessionId
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

export function validateNestedCommandRequest(input: {
  command: CommandRequest
  parentAgentId?: string
  rootAgentId?: string
  expectedParentSubSessionId?: string
}): NestedCommandValidationResult {
  const rootAgentId = input.rootAgentId ?? DEFAULT_ROOT_AGENT_ID
  const parentSubSessionId = commandParentSubSessionId(input.command)
  const reasonCodes: string[] = []
  const nestedByParent = !isRootAgent(input.parentAgentId, rootAgentId)
  const nestedByExpectedParent = Boolean(input.expectedParentSubSessionId)

  if ((nestedByParent || nestedByExpectedParent) && !parentSubSessionId) {
    reasonCodes.push("nested_parent_sub_session_required")
  }

  if (
    input.expectedParentSubSessionId &&
    parentSubSessionId &&
    input.expectedParentSubSessionId !== parentSubSessionId
  ) {
    reasonCodes.push("nested_parent_sub_session_mismatch")
  }

  if (
    input.command.identity.parent?.parentRunId &&
    input.command.identity.parent.parentRunId !== input.command.parentRunId
  ) {
    reasonCodes.push("nested_parent_run_mismatch")
  }

  return {
    ok: reasonCodes.length === 0,
    reasonCodes,
  }
}

export function calculateSubSessionDepth(
  subSessionId: string,
  subSessions: readonly SubSessionContract[],
): number | undefined {
  const byId = new Map(subSessions.map((subSession) => [subSession.subSessionId, subSession]))
  const target = byId.get(subSessionId)
  if (!target) return undefined
  let depth = 1
  let cursor: SubSessionContract | undefined = target
  const seen = new Set<string>()
  while (cursor?.identity.parent?.parentSubSessionId) {
    if (seen.has(cursor.subSessionId)) return undefined
    seen.add(cursor.subSessionId)
    const parent = byId.get(cursor.identity.parent.parentSubSessionId)
    if (!parent) break
    depth += 1
    cursor = parent
  }
  return depth
}

export function applyNestedSpawnBudget(input: NestedSpawnBudgetInput): NestedSpawnBudgetDecision {
  const maxChildren = normalizedPositiveInteger(
    input.maxChildrenPerAgent,
    DEFAULT_MAX_CHILDREN_PER_AGENT,
  )
  const remainingBudget =
    input.nestedSpawnBudgetRemaining === undefined
      ? Number.POSITIVE_INFINITY
      : Math.max(0, Math.floor(input.nestedSpawnBudgetRemaining))
  const selectedTaskScopes: StructuredTaskScope[] = []
  const skipped: NestedSpawnBudgetDecision["skipped"] = []
  const selectedLimit = Math.min(maxChildren, remainingBudget)

  input.taskScopes.forEach((scope, index) => {
    if (selectedTaskScopes.length >= selectedLimit) {
      skipped.push({
        index,
        reasonCode:
          selectedTaskScopes.length >= remainingBudget
            ? "nested_spawn_budget_exhausted"
            : "max_children_per_agent_exceeded",
      })
      return
    }
    selectedTaskScopes.push(scope)
  })

  const reasonCodes = [...new Set(skipped.map((item) => item.reasonCode))]
  return {
    status: skipped.length === 0 ? "ok" : selectedTaskScopes.length > 0 ? "shrunk" : "blocked",
    selectedTaskScopes,
    skipped,
    totals: {
      requestedChildren: input.taskScopes.length,
      selectedChildren: selectedTaskScopes.length,
      remainingBudget:
        input.nestedSpawnBudgetRemaining === undefined
          ? null
          : Math.max(0, remainingBudget - selectedTaskScopes.length),
    },
    reasonCodes,
  }
}

function attachNestedMetadata(input: {
  plan: OrchestrationPlan
  parentSubSessionId?: string
  parentAgentId: string
  parentSubSessionDepth: number
  childDepth: number
  reasonCodes: string[]
}): OrchestrationPlan {
  const parent = {
    ...input.plan.identity.parent,
    parentRunId: input.plan.parentRunId,
    parentRequestId: input.plan.parentRequestId,
    ...(input.parentSubSessionId ? { parentSubSessionId: input.parentSubSessionId } : {}),
  }
  return {
    ...input.plan,
    identity: {
      ...input.plan.identity,
      schemaVersion: CONTRACT_SCHEMA_VERSION,
      parent,
    },
    ...(input.plan.plannerMetadata
      ? {
          plannerMetadata: {
            ...input.plan.plannerMetadata,
            reasonCodes: [
              ...new Set([
                ...input.plan.plannerMetadata.reasonCodes,
                ...input.reasonCodes,
                "nested_delegation_policy_checked",
              ]),
            ],
          },
        }
      : {}),
  }
}

function blockedResult(input: {
  parentAgentId: string
  parentSubSessionId?: string
  parentSubSessionDepth: number
  childDepth: number
  budget: NestedSpawnBudgetDecision
  reasonCodes: string[]
}): NestedDelegationPlanResult {
  return {
    ok: false,
    status: "blocked",
    parentAgentId: input.parentAgentId,
    ...(input.parentSubSessionId ? { parentSubSessionId: input.parentSubSessionId } : {}),
    parentSubSessionDepth: input.parentSubSessionDepth,
    childDepth: input.childDepth,
    budget: input.budget,
    reasonCodes: [...new Set(input.reasonCodes)],
  }
}

export function buildNestedDelegationPlan(
  input: NestedDelegationPlannerInput,
): NestedDelegationPlanResult {
  const rootAgentId = rootAgentIdFor(input.registrySnapshot)
  const parentSubSessionDepth = normalizedDepth(input.parentSubSessionDepth)
  const childDepth = parentSubSessionDepth + 1
  const maxDepth = normalizedPositiveInteger(input.maxDepth, DEFAULT_MAX_DEPTH)
  const taskScopes = input.taskScopes?.length
    ? input.taskScopes
    : [buildDefaultStructuredTaskScope(input.userRequest)]
  const budget = applyNestedSpawnBudget({
    taskScopes,
    ...(input.maxChildrenPerAgent !== undefined
      ? { maxChildrenPerAgent: input.maxChildrenPerAgent }
      : {}),
    ...(input.nestedSpawnBudgetRemaining !== undefined
      ? { nestedSpawnBudgetRemaining: input.nestedSpawnBudgetRemaining }
      : {}),
  })
  const reasonCodes: string[] = []

  if (!isRootAgent(input.parentAgentId, rootAgentId) && !input.parentSubSessionId) {
    reasonCodes.push("nested_parent_sub_session_required")
  }

  if (childDepth > maxDepth) {
    reasonCodes.push("max_depth_exceeded")
  }

  if (budget.status === "blocked") {
    reasonCodes.push(...budget.reasonCodes)
  }

  if (reasonCodes.length > 0) {
    return blockedResult({
      parentAgentId: input.parentAgentId,
      ...(input.parentSubSessionId ? { parentSubSessionId: input.parentSubSessionId } : {}),
      parentSubSessionDepth,
      childDepth,
      budget,
      reasonCodes,
    })
  }

  const plannerResult = buildOrchestrationPlan({
    parentRunId: input.parentRunId,
    parentRequestId: input.parentRequestId,
    userRequest: input.userRequest,
    modeSnapshot: input.modeSnapshot,
    registrySnapshot: input.registrySnapshot,
    taskScopes: budget.selectedTaskScopes,
    parentAgentId: input.parentAgentId,
    ...(input.intent ? { intent: input.intent } : {}),
    ...(input.now ? { now: input.now } : {}),
    ...(input.idProvider ? { idProvider: input.idProvider } : {}),
  })

  const nestedReasonCodes = [
    "nested_delegation_planned",
    ...(input.parentSubSessionId ? ["parent_sub_session_linked"] : []),
    ...(budget.status === "shrunk" ? ["nested_plan_shrunk", ...budget.reasonCodes] : []),
  ]
  const plan = attachNestedMetadata({
    plan: plannerResult.plan,
    ...(input.parentSubSessionId ? { parentSubSessionId: input.parentSubSessionId } : {}),
    parentAgentId: input.parentAgentId,
    parentSubSessionDepth,
    childDepth,
    reasonCodes: nestedReasonCodes,
  })
  if (plan.delegatedTasks.length === 0) {
    return blockedResult({
      parentAgentId: input.parentAgentId,
      ...(input.parentSubSessionId ? { parentSubSessionId: input.parentSubSessionId } : {}),
      parentSubSessionDepth,
      childDepth,
      budget,
      reasonCodes: [
        "nested_delegation_no_direct_child_candidate",
        ...(plan.plannerMetadata?.reasonCodes ?? []),
        ...(plan.plannerMetadata?.fallbackReasonCodes ?? []),
      ],
    })
  }

  return {
    ok: true,
    status: budget.status === "shrunk" ? "shrunk" : "planned",
    plan,
    parentAgentId: input.parentAgentId,
    ...(input.parentSubSessionId ? { parentSubSessionId: input.parentSubSessionId } : {}),
    parentSubSessionDepth,
    childDepth,
    budget,
    reasonCodes: [...new Set([...(plannerResult.reasonCodes ?? []), ...nestedReasonCodes])],
  }
}
