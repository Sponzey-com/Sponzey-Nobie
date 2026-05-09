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
} from "../contracts/enterprise-topology.js"

export type TopologyBeginnerPaletteKind =
  | "task"
  | "decision"
  | "approval"
  | "tool"
  | "data"
  | "group"

export type TopologyTemplateEntityKind =
  | TopologyBeginnerPaletteKind
  | "work_node"
  | "team"
  | "org_unit"
  | "position"
  | "person"
  | "process"
  | "system"
  | "tool"
  | "authority"
  | "responsibility"

export interface TopologyNodeTemplatePreset {
  id: string
  labelKo: string
  labelEn: string
  descriptionKo: string
  descriptionEn: string
  nodeType: NodeType
  defaultNameKo: string
  defaultNameEn: string
  expertiseChips: string[]
  successCriteria: string[]
  fixedRoleCatalog: false
}

export interface TopologyEntityTemplatePreset {
  kind: TopologyTemplateEntityKind
  labelKo: string
  labelEn: string
  defaultNameKo: string
  defaultNameEn: string
  group: "core" | "advanced"
}

export interface TopologyTemplateCatalog {
  schemaVersion: 1
  nodePresets: TopologyNodeTemplatePreset[]
  entityPresets: TopologyEntityTemplatePreset[]
  workspaceStarterTemplates: TopologyWorkspaceStarterTemplatePreset[]
  flowTemplates: TopologyFlowTemplatePreset[]
  expertiseChips: string[]
  successCriteriaPresets: string[]
}

export type TopologyFlowTemplateId =
  | "customer-request-flow"
  | "approval-request-flow"
  | "research-review-flow"
  | "tool-assisted-flow"
  | "escalation-flow"
  | "blank-graph"

export interface TopologyWorkspaceStarterTemplatePreset {
  id: TopologyFlowTemplateId
  labelKo: string
  labelEn: string
  descriptionKo: string
  descriptionEn: string
  noTypingRequired: true
  recommendedLayer: "build"
}

export interface TopologyFlowTemplatePreset extends TopologyWorkspaceStarterTemplatePreset {
  nodeCount: number
  connectionCount: number
  defaultWorkOrderTemplateId: string
  defaultContextPresetId: string
  defaultSimulationMode: "success" | "failure"
}

export const TOPOLOGY_FLOW_TEMPLATES: TopologyFlowTemplatePreset[] = [
  {
    id: "customer-request-flow",
    labelKo: "고객 요청 처리 흐름",
    labelEn: "Customer request flow",
    descriptionKo: "요청 접수, 검토, 답변 단계를 연결한다.",
    descriptionEn: "Connect intake, review, and response steps.",
    noTypingRequired: true,
    recommendedLayer: "build",
    nodeCount: 3,
    connectionCount: 2,
    defaultWorkOrderTemplateId: "work-order-template:customer-request-triage",
    defaultContextPresetId: "context:customer-general",
    defaultSimulationMode: "success",
  },
  {
    id: "approval-request-flow",
    labelKo: "승인 요청 흐름",
    labelEn: "Approval request flow",
    descriptionKo: "업무 요청 다음에 승인 단계를 붙인다.",
    descriptionEn: "Add an approval step after a work request.",
    noTypingRequired: true,
    recommendedLayer: "build",
    nodeCount: 2,
    connectionCount: 3,
    defaultWorkOrderTemplateId: "work-order-template:customer-request-triage",
    defaultContextPresetId: "context:customer-general",
    defaultSimulationMode: "success",
  },
  {
    id: "research-review-flow",
    labelKo: "조사 후 검토 흐름",
    labelEn: "Research and review",
    descriptionKo: "조사 업무와 검토 업무를 순서대로 만든다.",
    descriptionEn: "Create a research step followed by a review step.",
    noTypingRequired: true,
    recommendedLayer: "build",
    nodeCount: 2,
    connectionCount: 1,
    defaultWorkOrderTemplateId: "work-order-template:customer-request-triage",
    defaultContextPresetId: "context:customer-general",
    defaultSimulationMode: "success",
  },
  {
    id: "tool-assisted-flow",
    labelKo: "도구를 사용하는 업무",
    labelEn: "Tool-assisted work",
    descriptionKo: "업무 단계와 사용할 도구를 함께 만든다.",
    descriptionEn: "Create a work step with a tool it can use.",
    noTypingRequired: true,
    recommendedLayer: "build",
    nodeCount: 1,
    connectionCount: 1,
    defaultWorkOrderTemplateId: "work-order-template:customer-request-triage",
    defaultContextPresetId: "context:customer-general",
    defaultSimulationMode: "success",
  },
  {
    id: "escalation-flow",
    labelKo: "에스컬레이션 흐름",
    labelEn: "Escalation flow",
    descriptionKo: "실패하거나 판단이 필요할 때 넘길 단계를 만든다.",
    descriptionEn: "Create a fallback step for failures or decisions.",
    noTypingRequired: true,
    recommendedLayer: "build",
    nodeCount: 2,
    connectionCount: 1,
    defaultWorkOrderTemplateId: "work-order-template:failure-drill",
    defaultContextPresetId: "context:missing-data",
    defaultSimulationMode: "failure",
  },
  {
    id: "blank-graph",
    labelKo: "빈 그래프",
    labelEn: "Blank graph",
    descriptionKo: "템플릿 없이 첫 업무 단계를 직접 추가한다.",
    descriptionEn: "Start without a template and add the first work step yourself.",
    noTypingRequired: true,
    recommendedLayer: "build",
    nodeCount: 0,
    connectionCount: 0,
    defaultWorkOrderTemplateId: "work-order-template:customer-request-triage",
    defaultContextPresetId: "context:customer-general",
    defaultSimulationMode: "success",
  },
]

export const TOPOLOGY_TEMPLATE_CATALOG: TopologyTemplateCatalog = {
  schemaVersion: 1,
  nodePresets: [
    {
      id: "topology-template:node:general-work",
      labelKo: "업무 단계",
      labelEn: "General work",
      descriptionKo: "가장 기본적인 업무 단계",
      descriptionEn: "Default work step for a flow",
      nodeType: "function",
      defaultNameKo: "새 업무 노드",
      defaultNameEn: "New work node",
      expertiseChips: ["조사", "정리", "고객 응대"],
      successCriteria: ["요청 범위 확인", "결과 요약", "후속 조치 기록"],
      fixedRoleCatalog: false,
    },
    {
      id: "topology-template:node:review",
      labelKo: "검토 단계",
      labelEn: "Review work",
      descriptionKo: "결과를 확인하고 다음 단계로 넘기는 업무 단계",
      descriptionEn: "Work step for review before moving forward",
      nodeType: "review_node",
      defaultNameKo: "새 검토 노드",
      defaultNameEn: "New review node",
      expertiseChips: ["품질 검토", "정책 확인", "리스크 확인"],
      successCriteria: ["검토 기준 확인", "수정 필요 항목 표시", "승인 가능 여부 기록"],
      fixedRoleCatalog: false,
    },
    {
      id: "topology-template:node:automation",
      labelKo: "도구 사용 단계",
      labelEn: "Automation work",
      descriptionKo: "시스템 또는 도구를 사용하는 업무 단계",
      descriptionEn: "Work step centered on system or tool use",
      nodeType: "automation_node",
      defaultNameKo: "새 자동화 노드",
      defaultNameEn: "New automation node",
      expertiseChips: ["도구 실행", "데이터 처리", "상태 확인"],
      successCriteria: ["입력 조건 확인", "도구 결과 확인", "실패 시 보고"],
      fixedRoleCatalog: false,
    },
  ],
  entityPresets: [
    { kind: "task", labelKo: "Task", labelEn: "Task", defaultNameKo: "새 업무", defaultNameEn: "New task", group: "core" },
    { kind: "decision", labelKo: "Decision", labelEn: "Decision", defaultNameKo: "새 결정", defaultNameEn: "New decision", group: "core" },
    { kind: "approval", labelKo: "Approval", labelEn: "Approval", defaultNameKo: "새 승인", defaultNameEn: "New approval", group: "core" },
    { kind: "tool", labelKo: "도구", labelEn: "Tool", defaultNameKo: "새 도구", defaultNameEn: "New tool", group: "core" },
    { kind: "data", labelKo: "Data", labelEn: "Data", defaultNameKo: "새 데이터", defaultNameEn: "New data", group: "core" },
    { kind: "group", labelKo: "Group", labelEn: "Group", defaultNameKo: "새 그룹", defaultNameEn: "New group", group: "core" },
    { kind: "org_unit", labelKo: "조직", labelEn: "Org unit", defaultNameKo: "새 조직", defaultNameEn: "New org unit", group: "advanced" },
    { kind: "position", labelKo: "직책", labelEn: "Position", defaultNameKo: "새 직책", defaultNameEn: "New position", group: "advanced" },
    { kind: "person", labelKo: "담당자", labelEn: "Person", defaultNameKo: "새 담당자", defaultNameEn: "New person", group: "advanced" },
    { kind: "process", labelKo: "업무 프로세스", labelEn: "Process", defaultNameKo: "새 프로세스", defaultNameEn: "New process", group: "advanced" },
    { kind: "authority", labelKo: "승인 규칙", labelEn: "Authority rule", defaultNameKo: "새 승인 규칙", defaultNameEn: "New authority rule", group: "advanced" },
    { kind: "responsibility", labelKo: "책임 매트릭스", labelEn: "Responsibility", defaultNameKo: "새 책임 항목", defaultNameEn: "New responsibility", group: "advanced" },
  ],
  workspaceStarterTemplates: TOPOLOGY_FLOW_TEMPLATES,
  flowTemplates: TOPOLOGY_FLOW_TEMPLATES,
  expertiseChips: ["조사", "정리", "고객 응대", "품질 검토", "정책 확인", "도구 실행", "데이터 처리"],
  successCriteriaPresets: ["요청 범위 확인", "결과 요약", "후속 조치 기록", "검토 기준 확인", "실패 시 보고"],
}

export function buildTopologyFlowTemplateDraft(
  templateId: TopologyFlowTemplateId,
  input: {
    topologyId?: string
    name?: string
    now?: EnterpriseTimestamp
  } = {},
): EnterpriseTopology {
  const now = input.now ?? Date.now()
  const template = flowTemplateById(templateId)
  const topology = createFlowBaseTopology({
    ...(input.topologyId !== undefined ? { topologyId: input.topologyId } : {}),
    name: input.name ?? template.labelKo,
    now,
    template,
  })

  if (templateId === "blank-graph") return topology

  if (templateId === "customer-request-flow") {
    const intake = flowNode("node:customer-request-intake", "요청 접수", "function", now, template, {
      children: ["node:customer-request-review"],
      tags: ["요청", "접수"],
      successCriteria: ["요청 범위 확인", "우선순위 확인", "다음 조치 기록"],
    })
    const review = flowNode("node:customer-request-review", "요청 검토", "review_node", now, template, {
      children: ["node:customer-request-response"],
      tags: ["검토"],
      successCriteria: ["검토 기준 확인", "처리 방향 결정"],
    })
    const response = flowNode("node:customer-request-response", "답변 정리", "function", now, template, {
      tags: ["답변", "정리"],
      successCriteria: ["답변 요약", "후속 조치 기록"],
    })
    pushNodes(topology, intake, review, response)
    pushRelations(topology,
      flowRelation("relation:customer-request-intake-review", "다음 업무", "delegates_to", "node", intake.id, "node", review.id, now),
      flowRelation("relation:customer-request-review-response", "다음 업무", "delegates_to", "node", review.id, "node", response.id, now),
    )
    return topology
  }

  if (templateId === "approval-request-flow") {
    const request = flowNode("node:approval-request", "승인 요청 준비", "function", now, template, {
      children: ["node:approval-step"],
      tags: ["요청", "승인"],
      successCriteria: ["승인 대상 정리", "승인 기준 확인"],
    })
    const approval = flowNode("node:approval-step", "승인 확인", "approval_node", now, template, {
      tags: ["승인"],
      successCriteria: ["승인 여부 기록", "승인 근거 기록"],
    })
    const approver = flowOrgUnit("org:default-approver", "승인 그룹", now)
    pushNodes(topology, request, approval)
    topology.orgUnits.push(approver)
    topology.authorityRules.push(flowApprovalRule("authority:approval-step", approver.id, approval.id, now))
    pushRelations(topology,
      flowRelation("relation:approval-request-step", "승인 단계", "delegates_to", "node", request.id, "node", approval.id, now),
      flowRelation("relation:approver-approval-step", "승인", "approves", "org_unit", approver.id, "node", approval.id, now),
      flowRelation("relation:approval-request-approver", "승인 그룹 알림", "informs", "node", request.id, "org_unit", approver.id, now),
    )
    return topology
  }

  if (templateId === "research-review-flow") {
    const research = flowNode("node:research", "자료 조사", "function", now, template, {
      children: ["node:review"],
      tags: ["조사"],
      successCriteria: ["근거 수집", "핵심 발견 정리"],
    })
    const review = flowNode("node:review", "검토", "review_node", now, template, {
      tags: ["검토"],
      successCriteria: ["검토 기준 확인", "수정 필요 항목 기록"],
    })
    pushNodes(topology, research, review)
    pushRelations(topology, flowRelation("relation:research-review", "검토로 연결", "delegates_to", "node", research.id, "node", review.id, now))
    return topology
  }

  if (templateId === "tool-assisted-flow") {
    const work = flowNode("node:tool-assisted-work", "도구 사용 업무", "automation_node", now, template, {
      tags: ["도구", "자동화"],
      allowedToolIds: ["tool:default-tool"],
      successCriteria: ["입력 조건 확인", "도구 결과 확인", "실패 시 보고"],
    })
    pushNodes(topology, work)
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
    pushRelations(topology, flowRelation("relation:tool-assisted-work-tool", "도구 사용", "uses_tool", "node", work.id, "enterprise_tool", "tool:default-tool", now))
    return topology
  }

  const primary = flowNode("node:primary-work", "기본 처리", "function", now, template, {
    children: ["node:escalation-work"],
    tags: ["처리"],
    successCriteria: ["처리 결과 요약", "실패 조건 기록"],
  })
  const escalation = flowNode("node:escalation-work", "상위 검토", "review_node", now, template, {
    tags: ["에스컬레이션"],
    successCriteria: ["상위 검토 결과 기록", "후속 조치 결정"],
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
  pushNodes(topology, primary, escalation)
  pushRelations(topology, flowRelation("relation:primary-escalation", "에스컬레이션", "delegates_to", "node", primary.id, "node", escalation.id, now))
  return topology
}

function flowTemplateById(templateId: TopologyFlowTemplateId): TopologyFlowTemplatePreset {
  return TOPOLOGY_FLOW_TEMPLATES.find((template) => template.id === templateId) ?? TOPOLOGY_FLOW_TEMPLATES[0]!
}

function createFlowBaseTopology(input: {
  topologyId?: string
  name: string
  now: EnterpriseTimestamp
  template: TopologyFlowTemplatePreset
}): EnterpriseTopology {
  return {
    schemaVersion: ENTERPRISE_TOPOLOGY_SCHEMA_VERSION,
    entityType: "topology",
    id: input.topologyId ?? "topology:flow-template-draft",
    name: input.name,
    status: "draft",
    createdAt: input.now,
    updatedAt: input.now,
    metadata: {
      flowTemplateId: input.template.id,
      defaultWorkOrderTemplateId: input.template.defaultWorkOrderTemplateId,
      defaultContextPresetId: input.template.defaultContextPresetId,
      defaultSimulationMode: input.template.defaultSimulationMode,
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

function flowNode(
  id: string,
  name: string,
  nodeType: NodeType,
  now: EnterpriseTimestamp,
  template: TopologyFlowTemplatePreset,
  options: {
    children?: string[]
    tags?: string[]
    allowedToolIds?: string[]
    allowedSystemIds?: string[]
    successCriteria: string[]
  },
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
      templateId: `topology-template:flow:${template.id}:${nodeType}`,
      source: "system_preset",
      fixedRoleCatalog: false,
      metadata: {
        flowTemplateId: template.id,
        defaultWorkOrderTemplateId: template.defaultWorkOrderTemplateId,
        successCriteria: options.successCriteria,
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

function flowOrgUnit(id: string, name: string, now: EnterpriseTimestamp): OrgUnit {
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

function flowApprovalRule(id: string, approverOrgUnitId: string, nodeId: string, now: EnterpriseTimestamp): AuthorityRule {
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

function nodeResponsibility(node: NodeContract, now: EnterpriseTimestamp): ResponsibilityMatrixEntry {
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

function pushNodes(topology: EnterpriseTopology, ...nodes: NodeContract[]): void {
  topology.nodes.push(...nodes)
  topology.responsibilities.push(...nodes.map((node) => nodeResponsibility(node, node.createdAt)))
}

function pushRelations(topology: EnterpriseTopology, ...relations: EnterpriseRelation[]): void {
  topology.relations.push(...relations)
}

function flowRelation(
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
