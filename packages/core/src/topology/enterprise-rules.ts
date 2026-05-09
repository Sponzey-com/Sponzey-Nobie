import type {
  AuthorityRule,
  EnterpriseEntityRef,
  EnterpriseTimestamp,
  EnterpriseTopology,
  Position,
} from "../contracts/enterprise-topology.js"

export interface ApprovalLineSimulationInput {
  topology: EnterpriseTopology
  target: EnterpriseEntityRef
  action?: string
  amount?: number
  requester?: EnterpriseEntityRef<"position" | "person" | "org_unit" | "node">
  asOf?: EnterpriseTimestamp
  maxEscalationDepth?: number
}

export interface ApprovalLineApprover {
  approver: EnterpriseEntityRef<"position" | "person" | "org_unit">
  source: "authority_rule" | "approves_relation" | "reports_to_escalation"
  authorityRuleIds: string[]
  relationIds: string[]
  approvalLimit?: number
  sufficient: boolean
  reasonCodes: string[]
}

export interface ApprovalLineSimulationResult {
  approved: boolean
  reasonCode:
    | "approval_line_not_required"
    | "approval_line_approved"
    | "approval_line_insufficient_limit"
    | "approval_line_missing"
  action: string
  target: EnterpriseEntityRef
  amount?: number
  approvers: ApprovalLineApprover[]
  missingAuthorityRuleIds: string[]
  escalationPath: EnterpriseEntityRef<"position">[]
  authorityContext: {
    requiredAuthorityRuleIds: string[]
    approvalRequired: boolean
    approvedBy: Array<EnterpriseEntityRef<"position" | "person" | "org_unit">>
  }
}

export function simulateApprovalLine(input: ApprovalLineSimulationInput): ApprovalLineSimulationResult {
  const action = normalizeAction(input.action ?? "approve") ?? "approve"
  const directAuthorityApprovers = authorityRuleApprovers(input.topology, input.target, action, input.amount)
  const relationApprovers = approvesRelationApprovers(input.topology, input.target, input.amount)
  const escalationApprovers = reportsToEscalationApprovers(input)
  const approvers = dedupeApprovers([
    ...directAuthorityApprovers,
    ...relationApprovers,
    ...escalationApprovers.approvers,
  ])
  const sufficient = approvers.filter((approver) => approver.sufficient)
  const requiredAuthorityRuleIds = directAuthorityApprovers.flatMap((approver) => approver.authorityRuleIds)

  if (approvers.length === 0) {
    return {
      approved: false,
      reasonCode: "approval_line_missing",
      action,
      target: cloneRef(input.target),
      ...(input.amount !== undefined ? { amount: input.amount } : {}),
      approvers: [],
      missingAuthorityRuleIds: [],
      escalationPath: escalationApprovers.escalationPath,
      authorityContext: {
        requiredAuthorityRuleIds: [],
        approvalRequired: true,
        approvedBy: [],
      },
    }
  }

  if (sufficient.length === 0) {
    return {
      approved: false,
      reasonCode: "approval_line_insufficient_limit",
      action,
      target: cloneRef(input.target),
      ...(input.amount !== undefined ? { amount: input.amount } : {}),
      approvers,
      missingAuthorityRuleIds: requiredAuthorityRuleIds,
      escalationPath: escalationApprovers.escalationPath,
      authorityContext: {
        requiredAuthorityRuleIds,
        approvalRequired: true,
        approvedBy: [],
      },
    }
  }

  return {
    approved: true,
    reasonCode: "approval_line_approved",
    action,
    target: cloneRef(input.target),
    ...(input.amount !== undefined ? { amount: input.amount } : {}),
    approvers,
    missingAuthorityRuleIds: [],
    escalationPath: escalationApprovers.escalationPath,
    authorityContext: {
      requiredAuthorityRuleIds,
      approvalRequired: true,
      approvedBy: sufficient.map((approver) => cloneRef(approver.approver)),
    },
  }
}

function authorityRuleApprovers(
  topology: EnterpriseTopology,
  target: EnterpriseEntityRef,
  action: string,
  amount: number | undefined,
): ApprovalLineApprover[] {
  return topology.authorityRules
    .filter((rule) => normalizeAction(rule.action) === action)
    .filter((rule) => refKey(rule.object) === refKey(target))
    .map((rule) => approvalApproverFromAuthorityRule(topology, rule, amount))
    .filter((approver): approver is ApprovalLineApprover => approver !== undefined)
}

function approvalApproverFromAuthorityRule(
  topology: EnterpriseTopology,
  rule: AuthorityRule,
  amount: number | undefined,
): ApprovalLineApprover | undefined {
  if (!isApprovalSubject(rule.subject)) return undefined
  const approvalLimit = approvalLimitForSubject(topology, rule.subject)
  return {
    approver: cloneRef(rule.subject),
    source: "authority_rule",
    authorityRuleIds: [rule.id],
    relationIds: [],
    ...(approvalLimit !== undefined ? { approvalLimit } : {}),
    sufficient: amount === undefined || (approvalLimit !== undefined && approvalLimit >= amount),
    reasonCodes: [
      "authority_rule_candidate",
      ...(approvalLimit === undefined ? ["approval_limit_missing"] : []),
      ...(amount !== undefined && approvalLimit !== undefined && approvalLimit < amount ? ["approval_limit_insufficient"] : []),
    ],
  }
}

function approvesRelationApprovers(
  topology: EnterpriseTopology,
  target: EnterpriseEntityRef,
  amount: number | undefined,
): ApprovalLineApprover[] {
  return topology.relations
    .filter((relation) => relation.relationType === "approves")
    .filter((relation) => refKey(relation.to) === refKey(target))
    .filter((relation) => isApprovalSubject(relation.from))
    .map((relation) => {
      const approver = relation.from as EnterpriseEntityRef<"position" | "person" | "org_unit">
      const approvalLimit = approvalLimitForSubject(topology, approver)
      return {
        approver: cloneRef(approver),
        source: "approves_relation" as const,
        authorityRuleIds: [],
        relationIds: [relation.id],
        ...(approvalLimit !== undefined ? { approvalLimit } : {}),
        sufficient: amount === undefined || (approvalLimit !== undefined && approvalLimit >= amount),
        reasonCodes: [
          "approves_relation_candidate",
          ...(approvalLimit === undefined ? ["approval_limit_missing"] : []),
          ...(amount !== undefined && approvalLimit !== undefined && approvalLimit < amount ? ["approval_limit_insufficient"] : []),
        ],
      }
    })
}

function reportsToEscalationApprovers(input: ApprovalLineSimulationInput): {
  approvers: ApprovalLineApprover[]
  escalationPath: EnterpriseEntityRef<"position">[]
} {
  const requesterPositionIds = requesterPositionIdsFor(input.topology, input.requester)
  const positions = new Map(input.topology.positions.map((position) => [position.id, position]))
  const maxDepth = Math.max(0, Math.floor(input.maxEscalationDepth ?? 8))
  const approvers: ApprovalLineApprover[] = []
  const escalationPath: EnterpriseEntityRef<"position">[] = []

  for (const requesterPositionId of requesterPositionIds) {
    let current = positions.get(requesterPositionId)
    const visited = new Set<string>()
    let depth = 0
    while (current?.reportsToPositionId !== undefined && depth < maxDepth && !visited.has(current.id)) {
      visited.add(current.id)
      const manager = positions.get(current.reportsToPositionId)
      if (manager === undefined) break
      const managerRef: EnterpriseEntityRef<"position"> = { entityType: "position", id: manager.id }
      escalationPath.push(managerRef)
      approvers.push(approvalApproverFromPosition(manager, input.amount))
      current = manager
      depth += 1
    }
  }

  return { approvers, escalationPath: dedupeRefs(escalationPath) }
}

function approvalApproverFromPosition(position: Position, amount: number | undefined): ApprovalLineApprover {
  return {
    approver: { entityType: "position", id: position.id },
    source: "reports_to_escalation",
    authorityRuleIds: [],
    relationIds: [],
    ...(position.approvalLimit !== undefined ? { approvalLimit: position.approvalLimit } : {}),
    sufficient: amount === undefined || (position.approvalLimit !== undefined && position.approvalLimit >= amount),
    reasonCodes: [
      "reports_to_escalation_candidate",
      ...(position.approvalLimit === undefined ? ["approval_limit_missing"] : []),
      ...(amount !== undefined && position.approvalLimit !== undefined && position.approvalLimit < amount
        ? ["approval_limit_insufficient"]
        : []),
    ],
  }
}

function requesterPositionIdsFor(
  topology: EnterpriseTopology,
  requester: ApprovalLineSimulationInput["requester"],
): string[] {
  if (requester === undefined) return []
  if (requester.entityType === "position") return [requester.id]
  if (requester.entityType === "person") {
    return topology.persons.find((person) => person.id === requester.id)?.positionIds ?? []
  }
  if (requester.entityType === "org_unit") {
    return topology.positions.filter((position) => position.orgUnitId === requester.id).map((position) => position.id)
  }
  const node = topology.nodes.find((candidate) => candidate.id === requester.id)
  return node?.owner?.entityType === "position" ? [node.owner.id] : []
}

function approvalLimitForSubject(
  topology: EnterpriseTopology,
  subject: EnterpriseEntityRef<"position" | "person" | "org_unit">,
): number | undefined {
  if (subject.entityType === "position") {
    const limit = topology.positions.find((position) => position.id === subject.id)?.approvalLimit
    return typeof limit === "number" && Number.isFinite(limit) ? limit : undefined
  }
  if (subject.entityType === "person") {
    const person = topology.persons.find((candidate) => candidate.id === subject.id)
    if (person === undefined) return undefined
    return maxNumber(person.positionIds.map((positionId) => {
      return topology.positions.find((position) => position.id === positionId)?.approvalLimit
    }))
  }
  return maxNumber(topology.positions
    .filter((position) => position.orgUnitId === subject.id)
    .map((position) => position.approvalLimit))
}

function dedupeApprovers(approvers: ApprovalLineApprover[]): ApprovalLineApprover[] {
  const byKey = new Map<string, ApprovalLineApprover>()
  for (const approver of approvers) {
    const key = `${refKey(approver.approver)}|${approver.source}`
    const existing = byKey.get(key)
    if (existing === undefined) {
      byKey.set(key, {
        ...approver,
        authorityRuleIds: [...approver.authorityRuleIds],
        relationIds: [...approver.relationIds],
        reasonCodes: [...approver.reasonCodes],
      })
      continue
    }
    existing.authorityRuleIds = addUnique(existing.authorityRuleIds, ...approver.authorityRuleIds)
    existing.relationIds = addUnique(existing.relationIds, ...approver.relationIds)
    existing.reasonCodes = addUnique(existing.reasonCodes, ...approver.reasonCodes)
    existing.sufficient = existing.sufficient || approver.sufficient
    if (existing.approvalLimit === undefined && approver.approvalLimit !== undefined) {
      existing.approvalLimit = approver.approvalLimit
    }
  }
  return [...byKey.values()]
}

function dedupeRefs<T extends EnterpriseEntityRef>(refs: T[]): T[] {
  const result: T[] = []
  for (const ref of refs) {
    if (!result.some((item) => refKey(item) === refKey(ref))) result.push(cloneRef(ref))
  }
  return result
}

function isApprovalSubject(value: EnterpriseEntityRef): value is EnterpriseEntityRef<"position" | "person" | "org_unit"> {
  return value.entityType === "position" || value.entityType === "person" || value.entityType === "org_unit"
}

function normalizeAction(action: unknown): string | undefined {
  if (typeof action !== "string") return undefined
  const normalized = action.trim().toLowerCase()
  return normalized.length > 0 ? normalized : undefined
}

function cloneRef<T extends EnterpriseEntityRef>(ref: T): T {
  return { entityType: ref.entityType, id: ref.id } as T
}

function refKey(reference: EnterpriseEntityRef): string {
  return `${reference.entityType}:${reference.id}`
}

function maxNumber(values: Array<number | undefined>): number | undefined {
  const numeric = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value))
  return numeric.length > 0 ? Math.max(...numeric) : undefined
}

function addUnique<T>(values: readonly T[], ...nextValues: T[]): T[] {
  const result = [...values]
  for (const nextValue of nextValues) {
    if (!result.includes(nextValue)) result.push(nextValue)
  }
  return result
}
