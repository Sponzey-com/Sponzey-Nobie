import {
  ENTERPRISE_TOPOLOGY_SCHEMA_VERSION,
  type AuthorityRule,
  type EnterpriseRelation,
  type EnterpriseTimestamp,
  type EnterpriseTopology,
  type NodeContract,
  type NodeType,
  type OrgUnit,
  type ResponsibilityMatrixEntry,
} from "../contracts/enterprise-topology"

export type TopologyWorkspaceStarterTemplateId =
  | "customer-request-flow"
  | "approval-request-flow"
  | "research-review-flow"
  | "tool-assisted-flow"
  | "escalation-flow"
  | "blank-graph"

export interface TopologyWorkspaceStarterTemplate {
  id: TopologyWorkspaceStarterTemplateId
  labelKo: string
  labelEn: string
  descriptionKo: string
  descriptionEn: string
  primaryActionKo: string
  primaryActionEn: string
  noTypingRequired: true
  nodeCount: number
  connectionCount: number
  defaultWorkOrderTemplateId: string
  defaultContextPresetId: string
  defaultSimulationMode: "success" | "failure"
  recommendedLayer: "build"
}

export const TOPOLOGY_WORKSPACE_STARTER_TEMPLATES: TopologyWorkspaceStarterTemplate[] = [
  {
    id: "customer-request-flow",
    labelKo: "고객 요청 처리 흐름",
    labelEn: "Customer request flow",
    descriptionKo: "요청 접수, 검토, 답변 단계를 연결한다.",
    descriptionEn: "Connect intake, review, and response steps.",
    primaryActionKo: "이 흐름으로 시작",
    primaryActionEn: "Start with this flow",
    noTypingRequired: true,
    nodeCount: 3,
    connectionCount: 2,
    defaultWorkOrderTemplateId: "work-order-template:customer-request-triage",
    defaultContextPresetId: "context:customer-general",
    defaultSimulationMode: "success",
    recommendedLayer: "build",
  },
  {
    id: "approval-request-flow",
    labelKo: "승인 요청 흐름",
    labelEn: "Approval request flow",
    descriptionKo: "업무 요청 다음에 승인 단계를 붙인다.",
    descriptionEn: "Add an approval step after a work request.",
    primaryActionKo: "승인 흐름 만들기",
    primaryActionEn: "Create approval flow",
    noTypingRequired: true,
    nodeCount: 2,
    connectionCount: 3,
    defaultWorkOrderTemplateId: "work-order-template:customer-request-triage",
    defaultContextPresetId: "context:customer-general",
    defaultSimulationMode: "success",
    recommendedLayer: "build",
  },
  {
    id: "research-review-flow",
    labelKo: "조사 후 검토 흐름",
    labelEn: "Research and review",
    descriptionKo: "조사 업무와 검토 업무를 순서대로 만든다.",
    descriptionEn: "Create a research step followed by a review step.",
    primaryActionKo: "조사 흐름 만들기",
    primaryActionEn: "Create research flow",
    noTypingRequired: true,
    nodeCount: 2,
    connectionCount: 1,
    defaultWorkOrderTemplateId: "work-order-template:customer-request-triage",
    defaultContextPresetId: "context:customer-general",
    defaultSimulationMode: "success",
    recommendedLayer: "build",
  },
  {
    id: "tool-assisted-flow",
    labelKo: "도구를 사용하는 업무",
    labelEn: "Tool-assisted work",
    descriptionKo: "업무 단계와 사용할 도구를 함께 만든다.",
    descriptionEn: "Create a work step with a tool it can use.",
    primaryActionKo: "도구 흐름 만들기",
    primaryActionEn: "Create tool flow",
    noTypingRequired: true,
    nodeCount: 1,
    connectionCount: 1,
    defaultWorkOrderTemplateId: "work-order-template:customer-request-triage",
    defaultContextPresetId: "context:customer-general",
    defaultSimulationMode: "success",
    recommendedLayer: "build",
  },
  {
    id: "escalation-flow",
    labelKo: "에스컬레이션 흐름",
    labelEn: "Escalation flow",
    descriptionKo: "실패하거나 판단이 필요할 때 넘길 단계를 만든다.",
    descriptionEn: "Create a fallback step for failures or decisions.",
    primaryActionKo: "에스컬레이션 만들기",
    primaryActionEn: "Create escalation flow",
    noTypingRequired: true,
    nodeCount: 2,
    connectionCount: 1,
    defaultWorkOrderTemplateId: "work-order-template:failure-drill",
    defaultContextPresetId: "context:missing-data",
    defaultSimulationMode: "failure",
    recommendedLayer: "build",
  },
  {
    id: "blank-graph",
    labelKo: "빈 그래프",
    labelEn: "Blank graph",
    descriptionKo: "템플릿 없이 첫 업무 단계를 직접 추가한다.",
    descriptionEn: "Start without a template and add the first work step yourself.",
    primaryActionKo: "빈 그래프로 시작",
    primaryActionEn: "Start blank",
    noTypingRequired: true,
    nodeCount: 0,
    connectionCount: 0,
    defaultWorkOrderTemplateId: "work-order-template:customer-request-triage",
    defaultContextPresetId: "context:customer-general",
    defaultSimulationMode: "success",
    recommendedLayer: "build",
  },
]

export function buildTopologyWorkspaceStarterDraft(
  templateId: TopologyWorkspaceStarterTemplateId,
  input: {
    topologyId?: string
    name?: string
    now?: EnterpriseTimestamp
  } = {},
): EnterpriseTopology {
  const now = input.now ?? Date.now()
  const template = TOPOLOGY_WORKSPACE_STARTER_TEMPLATES.find((item) => item.id === templateId) ?? TOPOLOGY_WORKSPACE_STARTER_TEMPLATES[0]!
  const topology = createStarterBaseTopology({
    topologyId: input.topologyId,
    name: input.name ?? starterTopologyName(templateId),
    now,
    templateId,
    defaultWorkOrderTemplateId: template.defaultWorkOrderTemplateId,
    defaultContextPresetId: template.defaultContextPresetId,
    defaultSimulationMode: template.defaultSimulationMode,
  })

  if (templateId === "blank-graph") return topology

  if (templateId === "customer-request-flow") {
    const intake = starterNode("node:customer-request-intake", "요청 접수", "function", now, {
      children: ["node:customer-request-review"],
      tags: ["요청", "접수"],
    })
    const review = starterNode("node:customer-request-review", "요청 검토", "review_node", now, {
      children: ["node:customer-request-response"],
      tags: ["검토"],
    })
    const response = starterNode("node:customer-request-response", "답변 정리", "function", now, {
      tags: ["답변", "정리"],
    })
    pushStarterNodes(topology, intake, review, response)
    topology.relations.push(
      starterRelation("relation:customer-request-intake-review", "다음 업무", "delegates_to", intake.id, review.id, now),
      starterRelation("relation:customer-request-review-response", "다음 업무", "delegates_to", review.id, response.id, now),
    )
    return topology
  }

  if (templateId === "approval-request-flow") {
    const request = starterNode("node:approval-request", "승인 요청 준비", "function", now, {
      children: ["node:approval-step"],
      tags: ["요청", "승인"],
    })
    const approval = starterNode("node:approval-step", "승인 확인", "approval_node", now, {
      tags: ["승인"],
    })
    const approver = starterOrgUnit("org:default-approver", "승인 그룹", now)
    pushStarterNodes(topology, request, approval)
    topology.orgUnits.push(approver)
    topology.authorityRules.push(starterApprovalRule("authority:approval-step", approver.id, approval.id, now))
    topology.relations.push(
      starterRelation("relation:approval-request-step", "승인 단계", "delegates_to", request.id, approval.id, now),
      starterEntityRelation("relation:approver-approval-step", "승인", "approves", "org_unit", approver.id, "node", approval.id, now),
      starterEntityRelation("relation:approval-request-approver", "승인 그룹 알림", "informs", "node", request.id, "org_unit", approver.id, now),
    )
    return topology
  }

  if (templateId === "research-review-flow") {
    const research = starterNode("node:research", "자료 조사", "function", now, {
      children: ["node:review"],
      tags: ["조사"],
    })
    const review = starterNode("node:review", "검토", "review_node", now, {
      tags: ["검토"],
    })
    pushStarterNodes(topology, research, review)
    topology.relations.push(starterRelation("relation:research-review", "검토로 연결", "delegates_to", research.id, review.id, now))
    return topology
  }

  if (templateId === "tool-assisted-flow") {
    const work = starterNode("node:tool-assisted-work", "도구 사용 업무", "automation_node", now, {
      tags: ["도구", "자동화"],
      allowedToolIds: ["tool:default-tool"],
    })
    pushStarterNodes(topology, work)
    topology.tools.push({
      schemaVersion: ENTERPRISE_TOPOLOGY_SCHEMA_VERSION,
      entityType: "enterprise_tool",
      id: "tool:default-tool",
      name: "기본 도구",
      status: "draft",
      createdAt: now,
      updatedAt: now,
      toolType: "read_only",
    })
    topology.relations.push({
      schemaVersion: ENTERPRISE_TOPOLOGY_SCHEMA_VERSION,
      entityType: "relation",
      id: "relation:tool-assisted-work-tool",
      name: "도구 사용",
      label: "도구 사용",
      status: "draft",
      createdAt: now,
      updatedAt: now,
      relationType: "uses_tool",
      from: { entityType: "node", id: work.id },
      to: { entityType: "enterprise_tool", id: "tool:default-tool" },
    })
    return topology
  }

  const primary = starterNode("node:primary-work", "기본 처리", "function", now, {
    children: ["node:escalation-work"],
    tags: ["처리"],
  })
  const escalation = starterNode("node:escalation-work", "상위 검토", "review_node", now, {
    tags: ["에스컬레이션"],
  })
  primary.failurePolicy = {
    failureReportRequired: true,
    allowPartialSuccess: true,
    fallbackNodeIds: [escalation.id],
  }
  primary.recoveryPolicy = {
    retryAllowed: false,
    redelegationAllowed: true,
    fallbackAllowed: true,
    partialSuccessAllowed: true,
  }
  pushStarterNodes(topology, primary, escalation)
  topology.relations.push(starterRelation("relation:primary-escalation", "에스컬레이션", "delegates_to", primary.id, escalation.id, now))
  return topology
}

function createStarterBaseTopology(input: {
  topologyId?: string
  name: string
  now: EnterpriseTimestamp
  templateId: TopologyWorkspaceStarterTemplateId
  defaultWorkOrderTemplateId: string
  defaultContextPresetId: string
  defaultSimulationMode: "success" | "failure"
}): EnterpriseTopology {
  return {
    schemaVersion: ENTERPRISE_TOPOLOGY_SCHEMA_VERSION,
    entityType: "topology",
    id: input.topologyId ?? "topology:workspace-draft",
    name: input.name,
    status: "draft",
    createdAt: input.now,
    updatedAt: input.now,
    metadata: {
      flowTemplateId: input.templateId,
      defaultWorkOrderTemplateId: input.defaultWorkOrderTemplateId,
      defaultContextPresetId: input.defaultContextPresetId,
      defaultSimulationMode: input.defaultSimulationMode,
    },
    nodes: [],
    teams: [],
    orgUnits: [],
    positions: [],
    persons: [],
    memberships: [],
    authorityRules: [],
    responsibilities: [],
    systems: [],
    tools: [],
    processes: [],
    relations: [],
  }
}

function starterTopologyName(templateId: TopologyWorkspaceStarterTemplateId): string {
  return TOPOLOGY_WORKSPACE_STARTER_TEMPLATES.find((template) => template.id === templateId)?.labelKo ?? "새 토폴로지"
}

function starterNode(
  id: string,
  name: string,
  nodeType: NodeType,
  now: EnterpriseTimestamp,
  options: {
    children?: string[]
    tags?: string[]
    allowedToolIds?: string[]
    allowedSystemIds?: string[]
  } = {},
): NodeContract {
  return {
    schemaVersion: ENTERPRISE_TOPOLOGY_SCHEMA_VERSION,
    entityType: "node",
    id,
    name,
    status: "draft",
    createdAt: now,
    updatedAt: now,
    nodeType,
    tags: options.tags ?? [],
    children: options.children ?? [],
    template: {
      templateId: `topology-template:starter:${nodeType}`,
      source: "system_preset",
      fixedRoleCatalog: false,
      metadata: {
        successCriteria: ["결과 확인", "후속 조치 기록"],
        outputPreset: "concise_result_summary",
      },
    },
    allowedToolIds: options.allowedToolIds ?? [],
    allowedSystemIds: options.allowedSystemIds ?? [],
    failurePolicy: {
      failureReportRequired: true,
      allowPartialSuccess: true,
      fallbackNodeIds: [],
    },
    recoveryPolicy: {
      retryAllowed: false,
      redelegationAllowed: true,
      fallbackAllowed: false,
      partialSuccessAllowed: true,
    },
  }
}

function starterOrgUnit(id: string, name: string, now: EnterpriseTimestamp): OrgUnit {
  return {
    schemaVersion: ENTERPRISE_TOPOLOGY_SCHEMA_VERSION,
    entityType: "org_unit",
    id,
    name,
    status: "draft",
    createdAt: now,
    updatedAt: now,
    positionIds: [],
    personIds: [],
    kpiIds: [],
    responsibilityArea: "승인 책임",
    metadata: {
      generatedFromFlowTemplate: true,
      hiddenFromBeginnerCanvas: true,
    },
  }
}

function starterApprovalRule(id: string, approverOrgUnitId: string, nodeId: string, now: EnterpriseTimestamp): AuthorityRule {
  return {
    schemaVersion: ENTERPRISE_TOPOLOGY_SCHEMA_VERSION,
    entityType: "authority_rule",
    id,
    name: "기본 승인 규칙",
    status: "draft",
    createdAt: now,
    updatedAt: now,
    subject: { entityType: "org_unit", id: approverOrgUnitId },
    action: "approve",
    object: { entityType: "node", id: nodeId },
    delegable: false,
    requiresAuditLog: true,
    metadata: {
      generatedFromFlowTemplate: true,
      hiddenFromBeginnerCanvas: true,
    },
  }
}

function starterResponsibility(node: NodeContract, now: EnterpriseTimestamp): ResponsibilityMatrixEntry {
  return {
    schemaVersion: ENTERPRISE_TOPOLOGY_SCHEMA_VERSION,
    entityType: "responsibility_matrix_entry",
    id: `responsibility:${node.id}`,
    name: `${node.name} 책임`,
    status: "draft",
    createdAt: now,
    updatedAt: now,
    scope: { entityType: "node", id: node.id },
    responsible: { entityType: "node", id: node.id },
    accountable: { entityType: "node", id: node.id },
    consulted: [],
    informed: [],
    metadata: {
      generatedFromFlowTemplate: true,
      hiddenFromBeginnerCanvas: true,
    },
  }
}

function pushStarterNodes(topology: EnterpriseTopology, ...nodes: NodeContract[]): void {
  topology.nodes.push(...nodes)
  topology.responsibilities.push(...nodes.map((node) => starterResponsibility(node, node.createdAt)))
}

function starterRelation(
  id: string,
  label: string,
  relationType: "delegates_to",
  fromNodeId: string,
  toNodeId: string,
  now: EnterpriseTimestamp,
): EnterpriseRelation {
  return {
    schemaVersion: ENTERPRISE_TOPOLOGY_SCHEMA_VERSION,
    entityType: "relation",
    id,
    name: label,
    label,
    status: "draft",
    createdAt: now,
    updatedAt: now,
    relationType,
    from: { entityType: "node", id: fromNodeId },
    to: { entityType: "node", id: toNodeId },
  }
}

function starterEntityRelation(
  id: string,
  label: string,
  relationType: EnterpriseRelation["relationType"],
  fromType: EnterpriseRelation["from"]["entityType"],
  fromId: string,
  toType: EnterpriseRelation["to"]["entityType"],
  toId: string,
  now: EnterpriseTimestamp,
): EnterpriseRelation {
  return {
    schemaVersion: ENTERPRISE_TOPOLOGY_SCHEMA_VERSION,
    entityType: "relation",
    id,
    name: label,
    label,
    status: "draft",
    createdAt: now,
    updatedAt: now,
    relationType,
    from: { entityType: fromType, id: fromId },
    to: { entityType: toType, id: toId },
  }
}
