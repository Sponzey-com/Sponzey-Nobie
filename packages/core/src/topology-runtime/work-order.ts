import { createHash } from "node:crypto"
import {
  CONTRACT_SCHEMA_VERSION,
  type JsonObject,
  type JsonValue,
} from "../contracts/index.js"
import {
  ENTERPRISE_TOPOLOGY_SCHEMA_VERSION,
  validateWorkOrder,
  type AuthorityScope,
  type EnterpriseMetadata,
  type EnterpriseMetadataValue,
  type EnterpriseTimestamp,
  type NodeContract,
  type PermissionScope,
  type WorkOrder,
  type WorkOrderScope,
  type WorkOrderSuccessCriterion,
  type WorkOrderTarget,
} from "../contracts/enterprise-topology.js"
import {
  validateCommandRequest,
  type CapabilityPolicy,
  type CapabilityRiskLevel,
  type CommandRequest,
  type DataExchangePackage,
  type ExpectedOutputContract,
  type RuntimeIdentity,
  type SkillMcpAllowlist,
} from "../contracts/sub-agent-orchestration.js"
import type { CompiledTopologySnapshot } from "../topology/compiler.js"

export type WorkOrderRuntimeBridgeIssueCode =
  | "invalid_work_order"
  | "invalid_command_request"
  | "node_contract_mismatch"
  | "compiled_topology_mismatch"
  | "work_order_target_not_node"
  | "authority_preflight_denied"

export interface WorkOrderRuntimeBridgeIssue {
  code: WorkOrderRuntimeBridgeIssueCode
  message: string
  path?: string
  reasonCode?: string
}

export interface BuildWorkOrderInput {
  workOrderId: string
  topologyRunId: string
  parentWorkOrderId?: string | null
  fromNodeId: string
  to: WorkOrderTarget
  objective: string
  scope: WorkOrderScope
  input: EnterpriseMetadata
  expectedOutputSchema: EnterpriseMetadata
  successCriteria: WorkOrderSuccessCriterion[]
  permissionScope: PermissionScope
  authorityScope: AuthorityScope
  failureReportRequired: boolean
  delegationPath: string[]
  createdAt: EnterpriseTimestamp
}

export interface WorkOrderRuntimeEnvelopeInput {
  workOrder: WorkOrder
  nodeContractSnapshot: NodeContract
  compiledTopologySnapshot: CompiledTopologySnapshot
  parentRunId?: string
  parentSessionId?: string
  parentSubSessionId?: string
  commandRequestId?: string
  subSessionId?: string
  targetAgentId?: string
  targetNicknameSnapshot?: string
  contextPackageId?: string
  now?: () => number
  authorityPreflight?: WorkOrderAuthorityPreflightInput
  baseCapabilityPolicy?: CapabilityPolicy
}

export type WorkOrderRuntimeEnvelopeResult =
  | { ok: true; envelope: WorkOrderRuntimeEnvelope }
  | { ok: false; issues: WorkOrderRuntimeBridgeIssue[] }

export interface WorkOrderRuntimeEnvelope {
  workOrder: WorkOrder
  nodeContractSnapshot: NodeContract
  compiledTopologySnapshotId: string
  parentWorkOrderId?: string | null
  delegationPath: string[]
  inputDataExchangePackage: DataExchangePackage
  expectedOutputs: ExpectedOutputContract[]
  effectivePermissionScope: EffectiveWorkOrderPermissionScope
  capabilityPolicy: CapabilityPolicy
  authorityDecision: WorkOrderAuthorityDecision
  promptBridge: WorkOrderPromptBridge
  resultReviewBridge: WorkOrderResultReviewBridge
  subSessionCommandRequest: CommandRequest
  subSessionIdempotencyKey: string
}

export interface EffectiveWorkOrderPermissionScope {
  allowedToolIds: string[]
  allowedSystemIds: string[]
  dataDomainIds: string[]
  riskLevel?: PermissionScope["riskLevel"]
  removedToolIds: string[]
  removedSystemIds: string[]
  removedDataDomainIds: string[]
  reasonCodes: string[]
}

export interface WorkOrderPromptBridge {
  completionCriteria: ExpectedOutputContract[]
  successCriterionIds: string[]
  promptContextRefs: string[]
  promptFragments: Array<{
    kind: "completion_criteria" | "permission_profile" | "authority"
    title: string
    content: string
  }>
}

export interface WorkOrderResultReviewBridge {
  expectedOutputs: ExpectedOutputContract[]
  additionalContextRefs: string[]
  successCriterionIds: string[]
}

export interface WorkOrderAuthorityPreflightInput {
  grantedAuthorityRuleIds?: string[]
  deniedAuthorityRuleIds?: string[]
  approvedBy?: AuthorityScope["approvedBy"]
}

export interface WorkOrderAuthorityDecision {
  allowed: boolean
  status: "not_required" | "approved" | "denied"
  reasonCode: string
  requiredAuthorityRuleIds: string[]
  grantedAuthorityRuleIds: string[]
  deniedAuthorityRuleIds: string[]
  missingAuthorityRuleIds: string[]
  approvedBy: NonNullable<AuthorityScope["approvedBy"]>
}

export function buildWorkOrder(input: BuildWorkOrderInput): WorkOrder {
  return {
    schemaVersion: ENTERPRISE_TOPOLOGY_SCHEMA_VERSION,
    workOrderId: input.workOrderId,
    topologyRunId: input.topologyRunId,
    parentWorkOrderId: input.parentWorkOrderId ?? null,
    fromNodeId: input.fromNodeId,
    to: input.to,
    objective: input.objective,
    scope: {
      included: [...input.scope.included],
      excluded: [...input.scope.excluded],
    },
    input: structuredClone(input.input),
    expectedOutputSchema: structuredClone(input.expectedOutputSchema),
    successCriteria: input.successCriteria.map((criterion) => ({
      ...criterion,
      ...(criterion.metadata !== undefined ? { metadata: structuredClone(criterion.metadata) } : {}),
    })),
    permissionScope: {
      allowedToolIds: [...input.permissionScope.allowedToolIds],
      allowedSystemIds: [...input.permissionScope.allowedSystemIds],
      dataDomainIds: [...input.permissionScope.dataDomainIds],
      ...(input.permissionScope.riskLevel !== undefined ? { riskLevel: input.permissionScope.riskLevel } : {}),
    },
    authorityScope: {
      requiredAuthorityRuleIds: [...input.authorityScope.requiredAuthorityRuleIds],
      approvalRequired: input.authorityScope.approvalRequired,
      ...(input.authorityScope.approvedBy !== undefined
        ? { approvedBy: input.authorityScope.approvedBy.map((reference) => ({ ...reference })) }
        : {}),
    },
    failureReportRequired: input.failureReportRequired,
    delegationPath: [...input.delegationPath],
    createdAt: input.createdAt,
  }
}

export function createWorkOrderRuntimeEnvelope(input: WorkOrderRuntimeEnvelopeInput): WorkOrderRuntimeEnvelopeResult {
  const issues = validateWorkOrderRuntimeEnvelopeInput(input)
  if (issues.length > 0) return { ok: false, issues }

  const now = input.now?.() ?? Date.now()
  const commandRequestId = input.commandRequestId ?? `command:${input.workOrder.workOrderId}`
  const subSessionId = input.subSessionId ?? `sub-session:${input.workOrder.workOrderId}`
  const contextPackageId = input.contextPackageId ?? `exchange:${input.workOrder.workOrderId}:input`
  const subSessionIdempotencyKey = buildWorkOrderSubSessionIdempotencyKey(input.workOrder, subSessionId)
  const expectedOutputs = buildExpectedOutputsForWorkOrder(input.workOrder)
  const effectivePermissionScope = deriveEffectiveWorkOrderPermissionScope({
    workOrder: input.workOrder,
    nodeContractSnapshot: input.nodeContractSnapshot,
    compiledTopologySnapshot: input.compiledTopologySnapshot,
  })
  const capabilityPolicy = deriveWorkOrderCapabilityPolicy({
    workOrder: input.workOrder,
    effectivePermissionScope,
    ...(input.baseCapabilityPolicy !== undefined ? { baseCapabilityPolicy: input.baseCapabilityPolicy } : {}),
  })
  const authorityDecision = evaluateWorkOrderAuthorityPreflight(input.workOrder, input.authorityPreflight)
  const identity = buildRuntimeIdentity({
    entityType: "sub_session",
    entityId: subSessionId,
    idempotencyKey: subSessionIdempotencyKey,
    parentRunId: input.parentRunId ?? input.workOrder.topologyRunId,
    ...(input.parentSessionId !== undefined ? { parentSessionId: input.parentSessionId } : {}),
    ...(input.parentSubSessionId !== undefined ? { parentSubSessionId: input.parentSubSessionId } : {}),
    parentRequestId: input.workOrder.workOrderId,
    auditCorrelationId: input.workOrder.topologyRunId,
  })
  const inputDataExchangePackage = buildWorkOrderInputDataExchangePackage({
    workOrder: input.workOrder,
    exchangeId: contextPackageId,
    now,
    identity: buildRuntimeIdentity({
      entityType: "data_exchange",
      entityId: contextPackageId,
      idempotencyKey: `${subSessionIdempotencyKey}:input`,
      parentRunId: input.parentRunId ?? input.workOrder.topologyRunId,
      ...(input.parentSessionId !== undefined ? { parentSessionId: input.parentSessionId } : {}),
      ...(input.parentSubSessionId !== undefined ? { parentSubSessionId: input.parentSubSessionId } : {}),
      parentRequestId: input.workOrder.workOrderId,
      auditCorrelationId: input.workOrder.topologyRunId,
    }),
  })
  const command = buildWorkOrderCommandRequest({
    workOrder: input.workOrder,
    identity,
    commandRequestId,
    subSessionId,
    targetAgentId: input.targetAgentId ?? input.nodeContractSnapshot.id,
    ...(input.targetNicknameSnapshot !== undefined ? { targetNicknameSnapshot: input.targetNicknameSnapshot } : {}),
    contextPackageIds: [contextPackageId],
    expectedOutputs,
  })

  const commandValidation = validateCommandRequest(command)
  if (!commandValidation.ok) {
    return {
      ok: false,
      issues: commandValidation.issues.map((issue) => ({
        code: "invalid_command_request",
        path: issue.path,
        message: issue.message,
        reasonCode: issue.code,
      })),
    }
  }

  return {
    ok: true,
    envelope: {
      workOrder: input.workOrder,
      nodeContractSnapshot: structuredClone(input.nodeContractSnapshot),
      compiledTopologySnapshotId: input.compiledTopologySnapshot.compiledTopologySnapshotId,
      parentWorkOrderId: input.workOrder.parentWorkOrderId ?? null,
      delegationPath: [...input.workOrder.delegationPath],
      inputDataExchangePackage,
      expectedOutputs,
      effectivePermissionScope,
      capabilityPolicy,
      authorityDecision,
      promptBridge: buildWorkOrderPromptBridge(input.workOrder, expectedOutputs, [contextPackageId]),
      resultReviewBridge: {
        expectedOutputs,
        additionalContextRefs: [contextPackageId],
        successCriterionIds: input.workOrder.successCriteria.map((criterion) => criterion.criterionId),
      },
      subSessionCommandRequest: command,
      subSessionIdempotencyKey,
    },
  }
}

export function buildExpectedOutputsForWorkOrder(workOrder: WorkOrder): ExpectedOutputContract[] {
  return [
    workOrderExpectedOutputSchemaToExpectedOutputContract(workOrder),
    ...workOrder.successCriteria.map((criterion) => successCriterionToExpectedOutputContract(criterion)),
  ]
}

export function workOrderExpectedOutputSchemaToExpectedOutputContract(workOrder: WorkOrder): ExpectedOutputContract {
  return {
    outputId: `${workOrder.workOrderId}:expected-output-schema`,
    kind: "data_package",
    description: `Satisfy WorkOrder expected output schema ${stableStringify(workOrder.expectedOutputSchema)}.`,
    required: true,
    acceptance: {
      statusField: "schema",
      requiredEvidenceKinds: [],
      artifactRequired: false,
      reasonCodes: [
        "work_order_expected_output_schema",
        `work_order:${workOrder.workOrderId}`,
        `schema_hash:${hashJson(workOrder.expectedOutputSchema).slice(0, 12)}`,
      ],
    },
  }
}

export function successCriterionToExpectedOutputContract(
  criterion: WorkOrderSuccessCriterion,
): ExpectedOutputContract {
  return {
    outputId: criterion.criterionId,
    kind: expectedOutputKindForSuccessCriterion(criterion.validationKind),
    description: criterion.description,
    required: criterion.required,
    acceptance: {
      statusField: criterion.criterionId,
      requiredEvidenceKinds: requiredEvidenceKindsForSuccessCriterion(criterion.validationKind),
      artifactRequired: criterion.validationKind === "evidence",
      reasonCodes: [
        `success_criterion:${criterion.criterionId}`,
        `validation:${criterion.validationKind}`,
      ],
    },
  }
}

export function deriveEffectiveWorkOrderPermissionScope(input: {
  workOrder: WorkOrder
  nodeContractSnapshot: NodeContract
  compiledTopologySnapshot: CompiledTopologySnapshot
}): EffectiveWorkOrderPermissionScope {
  const compiledToolScope = input.compiledTopologySnapshot.toolScopeIndex[input.nodeContractSnapshot.id]
  const nodeAllowedToolIds = compiledToolScope?.effectiveToolIds ?? input.nodeContractSnapshot.allowedToolIds
  const nodeAllowedSystemIds = compiledToolScope?.effectiveSystemIds ?? input.nodeContractSnapshot.allowedSystemIds
  const nodeAllowedDataDomainIds = compiledToolScope?.effectiveDataDomainIds ?? dataDomainIdsForSystems(
    input.compiledTopologySnapshot,
    nodeAllowedSystemIds,
  )
  const allowedToolIds = intersectStable(input.workOrder.permissionScope.allowedToolIds, nodeAllowedToolIds)
  const allowedSystemIds = intersectStable(input.workOrder.permissionScope.allowedSystemIds, nodeAllowedSystemIds)
  const dataDomainIds = intersectStable(input.workOrder.permissionScope.dataDomainIds, nodeAllowedDataDomainIds)
  const removedToolIds = input.workOrder.permissionScope.allowedToolIds.filter((toolId) => !allowedToolIds.includes(toolId))
  const removedSystemIds = input.workOrder.permissionScope.allowedSystemIds.filter((systemId) => !allowedSystemIds.includes(systemId))
  const removedDataDomainIds = input.workOrder.permissionScope.dataDomainIds.filter((domainId) => !dataDomainIds.includes(domainId))

  return {
    allowedToolIds,
    allowedSystemIds,
    dataDomainIds,
    ...(input.workOrder.permissionScope.riskLevel !== undefined ? { riskLevel: input.workOrder.permissionScope.riskLevel } : {}),
    removedToolIds,
    removedSystemIds,
    removedDataDomainIds,
    reasonCodes: [
      "permission_scope_narrowed_to_node_contract",
      ...(compiledToolScope !== undefined ? ["permission_scope_narrowed_to_compiled_tool_scope"] : []),
      ...(removedToolIds.length > 0 ? ["work_order_tool_scope_reduced"] : []),
      ...(removedSystemIds.length > 0 ? ["work_order_system_scope_reduced"] : []),
      ...(removedDataDomainIds.length > 0 ? ["work_order_data_domain_scope_reduced"] : []),
    ],
  }
}

export function deriveWorkOrderCapabilityPolicy(input: {
  workOrder: WorkOrder
  effectivePermissionScope: EffectiveWorkOrderPermissionScope
  baseCapabilityPolicy?: CapabilityPolicy
}): CapabilityPolicy {
  const base = input.baseCapabilityPolicy
  const allowlist: SkillMcpAllowlist = {
    enabledSkillIds: [...(base?.skillMcpAllowlist.enabledSkillIds ?? [])],
    enabledMcpServerIds: [...(base?.skillMcpAllowlist.enabledMcpServerIds ?? [])],
    enabledToolNames: addUnique([
      ...(base?.skillMcpAllowlist.enabledToolNames ?? []),
      ...input.effectivePermissionScope.allowedToolIds,
      ...input.effectivePermissionScope.allowedSystemIds,
    ]),
    disabledToolNames: addUnique([
      ...(base?.skillMcpAllowlist.disabledToolNames ?? []),
      ...input.effectivePermissionScope.removedToolIds,
      ...input.effectivePermissionScope.removedSystemIds,
    ]),
    ...(base?.skillMcpAllowlist.secretScopeId !== undefined ? { secretScopeId: base.skillMcpAllowlist.secretScopeId } : {}),
  }

  return {
    permissionProfile: {
      profileId: base?.permissionProfile.profileId ?? `permission:${input.workOrder.workOrderId}`,
      riskCeiling: riskLevelToCapabilityRisk(input.effectivePermissionScope.riskLevel),
      approvalRequiredFrom: input.workOrder.authorityScope.approvalRequired
        ? "safe"
        : base?.permissionProfile.approvalRequiredFrom ?? "dangerous",
      allowExternalNetwork: base?.permissionProfile.allowExternalNetwork ?? false,
      allowFilesystemWrite: base?.permissionProfile.allowFilesystemWrite ?? false,
      allowShellExecution: base?.permissionProfile.allowShellExecution ?? false,
      allowScreenControl: base?.permissionProfile.allowScreenControl ?? false,
      allowedPaths: [...(base?.permissionProfile.allowedPaths ?? [])],
    },
    skillMcpAllowlist: allowlist,
    rateLimit: {
      maxConcurrentCalls: base?.rateLimit.maxConcurrentCalls ?? 1,
      ...(base?.rateLimit.maxCallsPerMinute !== undefined ? { maxCallsPerMinute: base.rateLimit.maxCallsPerMinute } : {}),
    },
  }
}

export function evaluateWorkOrderAuthorityPreflight(
  workOrder: WorkOrder,
  input: WorkOrderAuthorityPreflightInput = {},
): WorkOrderAuthorityDecision {
  const requiredAuthorityRuleIds = [...workOrder.authorityScope.requiredAuthorityRuleIds]
  const grantedAuthorityRuleIds = [...(input.grantedAuthorityRuleIds ?? [])]
  const deniedAuthorityRuleIds = [...(input.deniedAuthorityRuleIds ?? [])]
  const missingAuthorityRuleIds = requiredAuthorityRuleIds.filter(
    (ruleId) => !grantedAuthorityRuleIds.includes(ruleId),
  )
  const approvedBy = input.approvedBy ?? workOrder.authorityScope.approvedBy ?? []

  if (deniedAuthorityRuleIds.length > 0) {
    return {
      allowed: false,
      status: "denied",
      reasonCode: "authority_rule_denied",
      requiredAuthorityRuleIds,
      grantedAuthorityRuleIds,
      deniedAuthorityRuleIds,
      missingAuthorityRuleIds,
      approvedBy,
    }
  }

  if (missingAuthorityRuleIds.length > 0) {
    return {
      allowed: false,
      status: "denied",
      reasonCode: "required_authority_rule_missing",
      requiredAuthorityRuleIds,
      grantedAuthorityRuleIds,
      deniedAuthorityRuleIds,
      missingAuthorityRuleIds,
      approvedBy,
    }
  }

  if (workOrder.authorityScope.approvalRequired && approvedBy.length === 0) {
    return {
      allowed: false,
      status: "denied",
      reasonCode: "approval_required_without_approver",
      requiredAuthorityRuleIds,
      grantedAuthorityRuleIds,
      deniedAuthorityRuleIds,
      missingAuthorityRuleIds,
      approvedBy,
    }
  }

  return {
    allowed: true,
    status: workOrder.authorityScope.approvalRequired ? "approved" : "not_required",
    reasonCode: workOrder.authorityScope.approvalRequired ? "authority_preflight_approved" : "authority_preflight_not_required",
    requiredAuthorityRuleIds,
    grantedAuthorityRuleIds,
    deniedAuthorityRuleIds,
    missingAuthorityRuleIds,
    approvedBy,
  }
}

export function buildWorkOrderSubSessionIdempotencyKey(workOrder: WorkOrder, subSessionId: string): string {
  return `work-order:${hashText(`${workOrder.topologyRunId}|${workOrder.workOrderId}|${subSessionId}|${workOrder.to.type}|${workOrder.to.id}`)}`
}

function validateWorkOrderRuntimeEnvelopeInput(input: WorkOrderRuntimeEnvelopeInput): WorkOrderRuntimeBridgeIssue[] {
  const issues: WorkOrderRuntimeBridgeIssue[] = []
  const workOrderValidation = validateWorkOrder(input.workOrder)
  if (!workOrderValidation.ok) {
    issues.push(...workOrderValidation.issues.map((issue) => ({
      code: "invalid_work_order" as const,
      path: issue.path,
      reasonCode: issue.reasonCode,
      message: issue.message,
    })))
  }

  if (input.workOrder.to.type !== "node") {
    issues.push({
      code: "work_order_target_not_node",
      path: "$.workOrder.to.type",
      message: "WorkOrder runtime bridge currently supports node targets only.",
    })
  }

  if (input.workOrder.to.type === "node" && input.workOrder.to.id !== input.nodeContractSnapshot.id) {
    issues.push({
      code: "node_contract_mismatch",
      path: "$.nodeContractSnapshot.id",
      message: "NodeContract snapshot id must match WorkOrder target node id.",
    })
  }

  if (input.compiledTopologySnapshot.nodeIndex[input.nodeContractSnapshot.id] === undefined) {
    issues.push({
      code: "compiled_topology_mismatch",
      path: "$.compiledTopologySnapshot.nodeIndex",
      message: "CompiledTopologySnapshot does not contain the target node.",
    })
  }

  const authorityDecision = evaluateWorkOrderAuthorityPreflight(input.workOrder, input.authorityPreflight)
  if (!authorityDecision.allowed) {
    issues.push({
      code: "authority_preflight_denied",
      path: "$.workOrder.authorityScope",
      reasonCode: authorityDecision.reasonCode,
      message: "WorkOrder authority preflight denied execution.",
    })
  }

  return issues
}

function buildWorkOrderCommandRequest(input: {
  workOrder: WorkOrder
  identity: RuntimeIdentity
  commandRequestId: string
  subSessionId: string
  targetAgentId: string
  targetNicknameSnapshot?: string
  contextPackageIds: string[]
  expectedOutputs: ExpectedOutputContract[]
}): CommandRequest {
  const topologyExecutor = topologyExecutorMetadataFromWorkOrder(input.workOrder)
  return {
    identity: input.identity,
    commandRequestId: input.commandRequestId,
    parentRunId: input.workOrder.topologyRunId,
    subSessionId: input.subSessionId,
    targetAgentId: input.targetAgentId,
    ...(input.targetNicknameSnapshot !== undefined ? { targetNicknameSnapshot: input.targetNicknameSnapshot } : {}),
    ...(topologyExecutor ? { topologyExecutor } : {}),
    taskScope: {
      goal: input.workOrder.objective,
      intentType: "topology_work_order",
      actionType: `execute_${input.workOrder.to.type}`,
      constraints: buildWorkOrderConstraints(input.workOrder),
      expectedOutputs: input.expectedOutputs,
      reasonCodes: [
        "topology_work_order",
        `work_order:${input.workOrder.workOrderId}`,
        `target:${input.workOrder.to.type}:${input.workOrder.to.id}`,
        ...(topologyExecutor?.executorId ? [`executor:${topologyExecutor.executorId}`] : []),
        ...(topologyExecutor?.edgeId ? [`edge:${topologyExecutor.edgeId}`] : []),
      ],
    },
    contextPackageIds: input.contextPackageIds,
    expectedOutputs: input.expectedOutputs,
  }
}

function topologyExecutorMetadataFromWorkOrder(workOrder: WorkOrder): CommandRequest["topologyExecutor"] | undefined {
  const metadata = workOrder.input.executorGraph
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return undefined
  const record = metadata as Record<string, EnterpriseMetadataValue | undefined>
  if (typeof record.graphExecutionPlanId !== "string") return undefined
  return {
    graphExecutionPlanId: record.graphExecutionPlanId,
    ...(typeof record.executorId === "string" ? { executorId: record.executorId } : {}),
    ...(typeof record.edgeId === "string" ? { edgeId: record.edgeId } : {}),
    ...(typeof record.systemPreparation === "boolean" ? { systemPreparation: record.systemPreparation } : {}),
  }
}

function buildWorkOrderInputDataExchangePackage(input: {
  workOrder: WorkOrder
  exchangeId: string
  now: number
  identity: RuntimeIdentity
}): DataExchangePackage {
  const sourceOwner = { ownerType: "system" as const, ownerId: input.workOrder.fromNodeId }
  const recipientOwner = { ownerType: "system" as const, ownerId: input.workOrder.to.id }
  return {
    identity: input.identity,
    exchangeId: input.exchangeId,
    sourceOwner,
    recipientOwner,
    purpose: `Input context for ${input.workOrder.workOrderId}.`,
    allowedUse: "temporary_context",
    retentionPolicy: "session_only",
    redactionState: "not_sensitive",
    provenanceRefs: [
      `work_order:${input.workOrder.workOrderId}`,
      `topology_run:${input.workOrder.topologyRunId}`,
    ],
    payload: sanitizeJsonObject({
      workOrderId: input.workOrder.workOrderId,
      objective: input.workOrder.objective,
      scope: input.workOrder.scope,
      input: input.workOrder.input,
      expectedOutputSchema: input.workOrder.expectedOutputSchema,
      permissionScope: input.workOrder.permissionScope,
      authorityScope: input.workOrder.authorityScope,
      delegationPath: input.workOrder.delegationPath,
    }),
    expiresAt: null,
    createdAt: input.now,
  }
}

function buildRuntimeIdentity(input: {
  entityType: RuntimeIdentity["entityType"]
  entityId: string
  idempotencyKey: string
  parentRunId: string
  parentSessionId?: string
  parentSubSessionId?: string
  parentRequestId?: string
  auditCorrelationId?: string
}): RuntimeIdentity {
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    entityType: input.entityType,
    entityId: input.entityId,
    owner: { ownerType: "system", ownerId: "topology-runtime" },
    idempotencyKey: input.idempotencyKey,
    ...(input.auditCorrelationId !== undefined ? { auditCorrelationId: input.auditCorrelationId } : {}),
    parent: {
      parentRunId: input.parentRunId,
      ...(input.parentSessionId !== undefined ? { parentSessionId: input.parentSessionId } : {}),
      ...(input.parentSubSessionId !== undefined ? { parentSubSessionId: input.parentSubSessionId } : {}),
      ...(input.parentRequestId !== undefined ? { parentRequestId: input.parentRequestId } : {}),
    },
  }
}

function buildWorkOrderPromptBridge(
  workOrder: WorkOrder,
  expectedOutputs: ExpectedOutputContract[],
  contextRefs: string[],
): WorkOrderPromptBridge {
  return {
    completionCriteria: expectedOutputs,
    successCriterionIds: workOrder.successCriteria.map((criterion) => criterion.criterionId),
    promptContextRefs: contextRefs,
    promptFragments: [
      {
        kind: "completion_criteria",
        title: "WorkOrder success criteria",
        content: workOrder.successCriteria.map((criterion) => `- ${criterion.criterionId}: ${criterion.description}`).join("\n"),
      },
      {
        kind: "permission_profile",
        title: "WorkOrder permission scope",
        content: [
          `tools=${workOrder.permissionScope.allowedToolIds.join(",")}`,
          `systems=${workOrder.permissionScope.allowedSystemIds.join(",")}`,
          `dataDomains=${workOrder.permissionScope.dataDomainIds.join(",")}`,
        ].join("\n"),
      },
      {
        kind: "authority",
        title: "WorkOrder authority scope",
        content: [
          `approvalRequired=${workOrder.authorityScope.approvalRequired}`,
          `requiredRules=${workOrder.authorityScope.requiredAuthorityRuleIds.join(",")}`,
        ].join("\n"),
      },
    ],
  }
}

function buildWorkOrderConstraints(workOrder: WorkOrder): string[] {
  return [
    ...workOrder.scope.included.map((item) => `include:${item}`),
    ...workOrder.scope.excluded.map((item) => `exclude:${item}`),
    ...workOrder.permissionScope.allowedToolIds.map((toolId) => `allowed_tool:${toolId}`),
    ...workOrder.permissionScope.allowedSystemIds.map((systemId) => `allowed_system:${systemId}`),
    ...workOrder.authorityScope.requiredAuthorityRuleIds.map((ruleId) => `required_authority:${ruleId}`),
    `failure_report_required:${workOrder.failureReportRequired}`,
  ]
}

function expectedOutputKindForSuccessCriterion(
  validationKind: WorkOrderSuccessCriterion["validationKind"],
): ExpectedOutputContract["kind"] {
  switch (validationKind) {
    case "tool":
      return "tool_result"
    case "schema":
      return "data_package"
    case "evidence":
      return "artifact"
    case "policy":
      return "state_change"
    case "manual":
      return "text"
  }
}

function requiredEvidenceKindsForSuccessCriterion(
  validationKind: WorkOrderSuccessCriterion["validationKind"],
): string[] {
  switch (validationKind) {
    case "evidence":
      return ["evidence"]
    case "tool":
      return ["tool_result"]
    case "schema":
      return ["schema_validation"]
    case "policy":
      return ["policy_check"]
    case "manual":
      return []
  }
}

function riskLevelToCapabilityRisk(riskLevel: PermissionScope["riskLevel"]): CapabilityRiskLevel {
  switch (riskLevel) {
    case "low":
      return "safe"
    case "medium":
      return "moderate"
    case "high":
      return "sensitive"
    case "critical":
      return "dangerous"
    case "unknown":
    case undefined:
      return "moderate"
  }
}

function intersectStable(left: readonly string[], right: readonly string[]): string[] {
  return left.filter((value) => right.includes(value))
}

function dataDomainIdsForSystems(
  snapshot: CompiledTopologySnapshot,
  systemIds: readonly string[],
): string[] {
  const result: string[] = []
  for (const systemId of systemIds) {
    const system = snapshot.systemIndex[systemId]
    if (system === undefined) continue
    for (const dataDomainId of system.dataDomainIds) {
      if (!result.includes(dataDomainId)) result.push(dataDomainId)
    }
  }
  return result
}

function addUnique(values: readonly string[]): string[] {
  return [...new Set(values)]
}

function sanitizeJsonObject(value: Record<string, unknown>): JsonObject {
  return sanitizeJsonValue(value) as JsonObject
}

function sanitizeJsonValue(value: unknown): JsonValue {
  if (Array.isArray(value)) return value.map(sanitizeJsonValue)
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, nested]) => nested !== undefined)
        .map(([key, nested]) => [key, sanitizeJsonValue(nested)]),
    ) as JsonObject
  }
  return null
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortJsonValue(value))
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue)
  if (!isRecord(value)) return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, nested]) => nested !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, sortJsonValue(nested)]),
  )
}

function hashJson(value: unknown): string {
  return hashText(stableStringify(value))
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}
