import type {
  AgentConfig,
  CapabilityRiskLevel,
  PermissionProfile,
  RelationshipEdgeType,
  RelationshipGraphEdge,
  RelationshipGraphNode,
  SkillMcpAllowlist,
  SubAgentConfig,
  TeamConfig,
} from "../contracts/sub-agent-orchestration"
import type {
  OrchestrationAgentRegistryEntry,
  OrchestrationGraphResponse,
  OrchestrationRegistrySnapshot,
  OrchestrationTeamRegistryEntry,
} from "../contracts/orchestration-api"
import type { VisualizationAlert, VisualizationCluster, VisualizationEdge, VisualizationNode, VisualizationScene, VisualizationStatus } from "./setup-visualization"
import type { YeonjangCapabilityProjection } from "./setup-visualization-topology"
import { slugifyOrchestrationSegment } from "./orchestration-id"
import type { UiLanguage } from "../stores/uiLanguage"
import { pickUiText } from "../stores/uiLanguage"

export interface BeginnerAgentTemplate {
  id: string
  title: string
  purpose: string
  risk: "low" | "medium" | "high"
  recommendedSkills: string[]
  recommendedMcpServers: string[]
}

export interface BeginnerTeamTemplate {
  id: string
  title: string
  purpose: string
  members: string[]
}

export interface OrchestrationSummaryCard {
  id: string
  label: string
  value: string
  description: string
  tone: "neutral" | "ready" | "warning" | "danger"
}

export interface RelationshipGraphView {
  singleNobieMode: boolean
  nodes: Array<RelationshipGraphNode & { uiTone: "coordinator" | "agent" | "team" | "runtime" | "disabled" }>
  edges: Array<RelationshipGraphEdge & { labelText: string; tone: "delegation" | "data" | "permission" | "capability" | "team" }>
  edgeCounts: Record<RelationshipEdgeType, number>
  diagnostics: string[]
}

export const EDGE_TYPE_LABELS: Record<RelationshipEdgeType, { ko: string; en: string; tone: RelationshipGraphView["edges"][number]["tone"] }> = {
  delegation: { ko: "작업 위임", en: "Delegation", tone: "delegation" },
  data_exchange: { ko: "명시적 데이터 교환", en: "Explicit data exchange", tone: "data" },
  permission: { ko: "권한 경계", en: "Permission boundary", tone: "permission" },
  capability_delegation: { ko: "스킬/MCP 대리 사용", en: "Capability delegation", tone: "capability" },
  team_membership: { ko: "팀 소속", en: "Team membership", tone: "team" },
}

type TopologySceneMode = VisualizationScene["mode"]

export function beginnerAgentTemplates(language: UiLanguage): BeginnerAgentTemplate[] {
  const t = (ko: string, en: string) => pickUiText(language, ko, en)
  return [
    {
      id: "researcher",
      title: t("조사 담당", "Researcher"),
      purpose: t("웹 검색, 문서 요약, 근거 수집처럼 읽기 중심 작업을 맡깁니다.", "Handles read-heavy work such as web search, document summary, and evidence collection."),
      risk: "medium",
      recommendedSkills: ["web-search", "summarizer"],
      recommendedMcpServers: ["browser"],
    },
    {
      id: "operator",
      title: t("작업 실행 담당", "Operator"),
      purpose: t("파일 작업, 로컬 도구 실행, 반복 작업 점검을 맡깁니다.", "Handles file operations, local tool execution, and repeatable checks."),
      risk: "high",
      recommendedSkills: ["filesystem", "automation"],
      recommendedMcpServers: ["local-tools"],
    },
    {
      id: "reviewer",
      title: t("검증 담당", "Reviewer"),
      purpose: t("서브 에이전트 결과를 확인하고 부족하면 피드백할 기준을 만듭니다.", "Reviews sub-agent outputs and prepares feedback when results are insufficient."),
      risk: "low",
      recommendedSkills: ["checklist", "evidence-review"],
      recommendedMcpServers: [],
    },
  ]
}

export function beginnerTeamTemplates(language: UiLanguage): BeginnerTeamTemplate[] {
  const t = (ko: string, en: string) => pickUiText(language, ko, en)
  return [
    {
      id: "research_and_review",
      title: t("조사 + 검증 팀", "Research + Review Team"),
      purpose: t("정보 수집과 검증을 분리해서 빠르게 답하고 마지막 확인은 엄격하게 합니다.", "Separates collection and verification for fast responses with strict final checks."),
      members: [t("조사 담당", "Researcher"), t("검증 담당", "Reviewer")],
    },
    {
      id: "build_and_review",
      title: t("실행 + 검증 팀", "Build + Review Team"),
      purpose: t("코드/파일 변경 담당과 검증 담당을 나눠 병렬로 진행합니다.", "Splits code or file changes from verification so work can progress in parallel."),
      members: [t("작업 실행 담당", "Operator"), t("검증 담당", "Reviewer")],
    },
  ]
}

export function buildOrchestrationSummary(input: {
  snapshot?: OrchestrationRegistrySnapshot | null
  language: UiLanguage
}): OrchestrationSummaryCard[] {
  const { snapshot, language } = input
  const t = (ko: string, en: string) => pickUiText(language, ko, en)
  const agents = snapshot?.agents ?? []
  const teams = snapshot?.teams ?? []
  const enabledAgents = agents.filter((agent) => agent.status === "enabled")
  const unresolvedMemberships = snapshot?.membershipEdges.filter((edge) => edge.status === "unresolved").length ?? 0
  const riskyAgents = agents.filter((agent) => isHighRiskPermissionProfile(agent.permissionProfile)).length

  return [
    {
      id: "mode",
      label: t("기본 동작", "Default behavior"),
      value: enabledAgents.length > 0 ? t("오케스트레이션", "Orchestration") : t("단일 노비", "Single Nobie"),
      description: enabledAgents.length > 0
        ? t("서브 에이전트가 켜져 있으면 노비가 역할과 팀을 보고 위임합니다.", "When sub-agents are enabled, Nobie delegates by role and team.")
        : t("서브 에이전트가 없으면 기존처럼 노비 단독으로 처리합니다.", "Without sub-agents, Nobie behaves exactly as before."),
      tone: enabledAgents.length > 0 ? "ready" : "neutral",
    },
    {
      id: "agents",
      label: t("활성 서브 에이전트", "Active sub-agents"),
      value: `${enabledAgents.length}/${agents.length}`,
      description: t("비활성/보관 에이전트는 자동 위임 대상에서 제외됩니다.", "Disabled or archived agents are excluded from automatic delegation."),
      tone: enabledAgents.length > 0 ? "ready" : "neutral",
    },
    {
      id: "teams",
      label: t("팀", "Teams"),
      value: String(teams.length),
      description: t("팀은 역할 묶음이며 메모리, 스킬, MCP 권한을 자동 공유하지 않습니다.", "Teams are role groupings and do not automatically share memory, skills, or MCP access."),
      tone: teams.length > 0 ? "ready" : "neutral",
    },
    {
      id: "risk",
      label: t("위험 설정", "Risk settings"),
      value: String(riskyAgents),
      description: t("외부 네트워크, 파일 쓰기, 쉘, 화면 제어가 켜진 에이전트 수입니다.", "Agents that can use external network, file writes, shell, or screen control."),
      tone: riskyAgents > 0 ? "warning" : "ready",
    },
    {
      id: "membership",
      label: t("해결 안 된 연결", "Unresolved links"),
      value: String(unresolvedMemberships),
      description: t("팀에 지정됐지만 실제 에이전트가 없는 연결입니다.", "Team links that point to missing agents."),
      tone: unresolvedMemberships > 0 ? "danger" : "ready",
    },
  ]
}

export function buildRelationshipGraphView(input: {
  graph?: OrchestrationGraphResponse | null
  agents: OrchestrationAgentRegistryEntry[]
  teams: OrchestrationTeamRegistryEntry[]
  language: UiLanguage
}): RelationshipGraphView {
  const { graph, agents, teams, language } = input
  const t = (ko: string, en: string) => pickUiText(language, ko, en)
  const coordinator: RelationshipGraphNode = {
    nodeId: "nobie:coordinator",
    entityType: "nobie",
    entityId: "nobie:main",
    label: "Nobie",
    ...(agents.length > 0 ? { status: "enabled" as const } : {}),
    metadata: { role: "coordinator" },
  }
  const rawNodes = graph?.graph.nodes ?? []
  const rawEdges = graph?.graph.edges ?? []
  const edgeCounts = emptyEdgeCounts()

  for (const edge of rawEdges) {
    edgeCounts[edge.edgeType] += 1
  }

  return {
    singleNobieMode: agents.filter((agent) => agent.status === "enabled").length === 0 && teams.length === 0,
    nodes: [
      { ...coordinator, uiTone: "coordinator" },
      ...rawNodes.map((node) => ({
        ...node,
        uiTone: node.status === "disabled" || node.status === "archived"
          ? "disabled" as const
          : node.entityType === "team"
            ? "team" as const
            : node.entityType === "sub_agent"
              ? "agent" as const
              : "runtime" as const,
      })),
    ],
    edges: rawEdges.map((edge) => {
      const label = EDGE_TYPE_LABELS[edge.edgeType]
      return {
        ...edge,
        labelText: edge.label ?? t(label.ko, label.en),
        tone: label.tone,
      }
    }),
    edgeCounts,
    diagnostics: (graph?.diagnostics ?? []).map((item) => `${item.code}: ${item.message}`),
  }
}

export function buildProfilePreviewWarnings(config: AgentConfig | TeamConfig | null | undefined, language: UiLanguage): string[] {
  if (!config) return []
  const t = (ko: string, en: string) => pickUiText(language, ko, en)
  const warnings: string[] = []

  if ("agentType" in config) {
    const permission = config.capabilityPolicy.permissionProfile
    const allowlist = config.capabilityPolicy.skillMcpAllowlist
    if (permission.riskCeiling === "external" || permission.riskCeiling === "sensitive" || permission.riskCeiling === "dangerous") {
      warnings.push(t("위험 한도가 높습니다. 저장 전 승인 기준과 사용 범위를 확인해야 합니다.", "The risk ceiling is high. Review approval rules and usage scope before saving."))
    }
    if (permission.allowFilesystemWrite) warnings.push(t("파일 쓰기 권한이 켜져 있습니다.", "Filesystem write permission is enabled."))
    if (permission.allowShellExecution) warnings.push(t("쉘 실행 권한이 켜져 있습니다.", "Shell execution permission is enabled."))
    if (permission.allowScreenControl) warnings.push(t("화면 제어 권한이 켜져 있습니다.", "Screen control permission is enabled."))
    if (allowlist.enabledSkillIds.length === 0 && allowlist.enabledMcpServerIds.length === 0 && allowlist.enabledToolNames.length === 0) {
      warnings.push(t("스킬/MCP/도구 allowlist가 비어 있어 실제 위임 능력이 제한됩니다.", "The skill/MCP/tool allowlist is empty, so delegated capability is limited."))
    }
  } else if (config.memberAgentIds.length === 0) {
    warnings.push(t("팀에 멤버가 없습니다. 팀을 켜도 위임 대상이 없습니다.", "The team has no members. Enabling it will not create delegation targets."))
  }

  return warnings
}

export function buildOrchestrationTopologyScene(input: {
  snapshot?: OrchestrationRegistrySnapshot | null
  graph?: OrchestrationGraphResponse | null
  agents: OrchestrationAgentRegistryEntry[]
  teams: OrchestrationTeamRegistryEntry[]
  language: UiLanguage
  mode?: TopologySceneMode
  yeonjang?: YeonjangCapabilityProjection | null
}): VisualizationScene {
  const { snapshot, graph, agents, teams, language, yeonjang } = input
  const t = (ko: string, en: string) => pickUiText(language, ko, en)
  const graphView = buildRelationshipGraphView({ graph, agents, teams, language })
  const mode = input.mode ?? "shared"
  const nodes: VisualizationNode[] = []
  const edges: VisualizationEdge[] = []
  const alerts: VisualizationAlert[] = []
  const clusters: VisualizationCluster[] = [
    {
      id: "cluster:orchestration:teams",
      label: t("팀", "Teams"),
      description: t("역할과 목적 중심의 묶음", "Purpose-driven team groups"),
      nodeIds: [],
    },
    {
      id: "cluster:orchestration:agents",
      label: t("서브 에이전트", "Sub-agents"),
      description: t("실제로 작업을 위임받는 실행 노드", "Execution nodes that receive delegated work"),
      nodeIds: [],
    },
    {
      id: "cluster:orchestration:capabilities",
      label: t("Capability", "Capabilities"),
      description: t("각 에이전트의 Skill/MCP/도구 허용 범위", "Per-agent Skill/MCP/tool allowlists"),
      nodeIds: [],
    },
    {
      id: "cluster:orchestration:unresolved",
      label: t("해결 안 된 연결", "Unresolved links"),
      description: t("팀에 지정됐지만 실제 에이전트가 없는 연결", "Team links that point to missing agents"),
      nodeIds: [],
    },
  ]
  const clusterMap = new Map(clusters.map((cluster) => [cluster.id, cluster]))
  const pushNode = (node: VisualizationNode) => {
    nodes.push(node)
    if (!node.clusterId) return
    const cluster = clusterMap.get(node.clusterId)
    if (!cluster) return
    cluster.nodeIds.push(node.id)
  }

  const coordinatorId = "node:orchestration:coordinator"
  const unresolvedMemberships = snapshot?.membershipEdges.filter((edge) => edge.status === "unresolved") ?? []
  const emptyTeams = teams.filter((team) => team.memberAgentIds.length === 0)
  const highRiskAgents = agents.filter((agent) => isHighRiskPermissionProfile(agent.permissionProfile))
  const activeMemberships = snapshot?.membershipEdges.filter((edge) => edge.status === "active") ?? []
  const singleNobieMode = graphView.singleNobieMode

  pushNode({
    id: coordinatorId,
    kind: "router",
    label: "Nobie",
    status: "ready",
    badges: [
      singleNobieMode ? t("단일 노비", "Single Nobie") : t("오케스트레이션", "Orchestration"),
      `${agents.filter((agent) => agent.status === "enabled").length} ${t("활성 agent", "active agents")}`,
      `${teams.length} ${t("팀", "teams")}`,
    ],
    description: singleNobieMode
      ? t("현재는 노비가 직접 처리하지만, 오른쪽 구조로 언제든 확장할 수 있습니다.", "Nobie is handling work directly right now, but the structure can expand at any time.")
      : t("노비가 팀, 서브 에이전트, capability 경계를 보고 위임 흐름을 조정합니다.", "Nobie coordinates delegation using team, sub-agent, and capability boundaries."),
    featureGateKey: "settings.control",
  })

  const teamNodeIds = new Map<string, string>()
  for (const team of teams) {
    const unresolvedCount = unresolvedMemberships.filter((edge) => edge.teamId === team.teamId).length
    const emptyTeam = team.memberAgentIds.length === 0
    const disabled = team.status === "disabled" || team.status === "archived"
    const status: VisualizationStatus = disabled ? "disabled" : unresolvedCount > 0 || emptyTeam ? "warning" : "ready"
    const nodeId = `node:orchestration:team:${team.teamId}`
    teamNodeIds.set(team.teamId, nodeId)
    pushNode({
      id: nodeId,
      kind: "team",
      label: team.nickname ?? team.displayName,
      status,
      badges: [
        team.status,
        `${team.memberAgentIds.length} ${t("멤버", "members")}`,
        ...(unresolvedCount > 0 ? [`${t("해결 안 됨", "unresolved")} ${unresolvedCount}`] : []),
        ...(emptyTeam ? [t("빈 팀", "Empty team")] : []),
      ],
      description: team.purpose,
      clusterId: "cluster:orchestration:teams",
      inspectorId: `team:${team.teamId}`,
      featureGateKey: "settings.control",
    })
    edges.push({
      id: `edge:orchestration:coordinator:team:${team.teamId}`,
      from: coordinatorId,
      to: nodeId,
      kind: "flow",
      label: emptyTeam ? t("팀 구조만 정의됨", "Structure only") : t("팀 단위 위임", "Delegates by team"),
      status: status === "warning" ? "warning" : undefined,
      featureGateKey: "settings.control",
    })
  }

  const agentNodeIds = new Map<string, string>()
  for (const agent of agents) {
    const allowlistCount = agent.skillMcpSummary.enabledSkillIds.length
      + agent.skillMcpSummary.enabledMcpServerIds.length
      + agent.skillMcpSummary.enabledToolNames.length
    const disabled = agent.status === "disabled" || agent.status === "archived"
    const highRisk = isHighRiskPermissionProfile(agent.permissionProfile)
    const limited = allowlistCount === 0 || !agent.delegationEnabled
    const status: VisualizationStatus = disabled ? "disabled" : highRisk || limited ? "warning" : "ready"
    const nodeId = `node:orchestration:agent:${agent.agentId}`
    const capabilityNodeId = `node:orchestration:capability:${agent.agentId}`
    agentNodeIds.set(agent.agentId, nodeId)
    pushNode({
      id: nodeId,
      kind: "sub_agent",
      label: agent.nickname ?? agent.displayName,
      status,
      badges: [
        agent.status,
        riskText(agent.permissionProfile.riskCeiling, language),
        agent.delegationEnabled ? t("위임 on", "Delegation on") : t("위임 off", "Delegation off"),
        ...(agent.teamIds.length > 0 ? [`${t("팀", "Teams")} ${agent.teamIds.length}`] : [t("직접 위임", "Direct delegation")]),
      ],
      description: agent.role,
      clusterId: "cluster:orchestration:agents",
      inspectorId: `agent:${agent.agentId}`,
      featureGateKey: "settings.control",
    })

    const capabilityBadges = [
      `skill ${agent.skillMcpSummary.enabledSkillIds.length}`,
      `mcp ${agent.skillMcpSummary.enabledMcpServerIds.length}`,
      `tool ${agent.skillMcpSummary.enabledToolNames.length}`,
    ]
    const capabilityStatus: VisualizationStatus = disabled ? "disabled" : allowlistCount === 0 || highRisk ? "warning" : "ready"
    pushNode({
      id: capabilityNodeId,
      kind: "capability",
      label: `${agent.nickname ?? agent.displayName} ${t("capability", "capability")}`,
      status: capabilityStatus,
      badges: [
        ...capabilityBadges,
        ...(highRisk ? [t("고위험 권한", "High-risk permissions")] : []),
      ],
      description: allowlistCount === 0
        ? t("허용된 Skill/MCP/도구가 아직 없어 실제 위임 능력이 제한됩니다.", "No Skill/MCP/tool allowlist is enabled yet, so delegated capability is still limited.")
        : t("이 에이전트가 실제로 사용할 수 있는 capability 경계입니다.", "This is the effective capability boundary for the agent."),
      clusterId: "cluster:orchestration:capabilities",
      featureGateKey: "settings.control",
    })

    edges.push({
      id: `edge:orchestration:capability:${agent.agentId}`,
      from: nodeId,
      to: capabilityNodeId,
      kind: "uses",
      label: t("허용 capability", "Allowed capability"),
      status: capabilityStatus === "warning" ? "warning" : undefined,
      featureGateKey: "settings.control",
    })

    if (agent.teamIds.length === 0) {
      edges.push({
        id: `edge:orchestration:coordinator:agent:${agent.agentId}`,
        from: coordinatorId,
        to: nodeId,
        kind: "flow",
        label: t("직접 위임", "Direct delegation"),
        status: status === "warning" ? "warning" : undefined,
        featureGateKey: "settings.control",
      })
    }
  }

  if (yeonjang) {
    pushNode(yeonjang.hubNode)
    edges.push(...yeonjang.edges)
    alerts.push(...yeonjang.alerts)
  }

  for (const edge of activeMemberships) {
    const from = teamNodeIds.get(edge.teamId)
    const to = agentNodeIds.get(edge.agentId)
    if (!from || !to) continue
    edges.push({
      id: `edge:orchestration:membership:${edge.teamId}:${edge.agentId}`,
      from,
      to,
      kind: "belongs_to",
      label: edge.roleHint?.trim() || t("팀 소속", "Team membership"),
      featureGateKey: "settings.control",
    })
  }

  for (const edge of unresolvedMemberships) {
    const from = teamNodeIds.get(edge.teamId)
    if (!from) continue
    const unresolvedId = `node:orchestration:unresolved:${edge.teamId}:${edge.agentId}`
    pushNode({
      id: unresolvedId,
      kind: "sub_agent",
      label: edge.agentId,
      status: "error",
      badges: [t("누락된 멤버", "Missing member")],
      description: edge.roleHint?.trim()
        ? `${t("역할 힌트", "Role hint")}: ${edge.roleHint}`
        : t("팀에는 연결됐지만 현재 registry에 존재하지 않는 에이전트입니다.", "This member is linked from the team but missing from the current registry."),
      clusterId: "cluster:orchestration:unresolved",
      featureGateKey: "settings.control",
    })
    edges.push({
      id: `edge:orchestration:unresolved:${edge.teamId}:${edge.agentId}`,
      from,
      to: unresolvedId,
      kind: "belongs_to",
      label: t("해결 안 된 연결", "Unresolved membership"),
      status: "error",
      featureGateKey: "settings.control",
    })
  }

  if (singleNobieMode) {
    const placeholderTeamId = "node:orchestration:team:placeholder"
    const placeholderAgentId = "node:orchestration:agent:placeholder"
    const placeholderCapabilityId = "node:orchestration:capability:placeholder"
    pushNode({
      id: placeholderTeamId,
      kind: "team",
      label: t("첫 팀", "First team"),
      status: "planned",
      badges: [t("예시 구조", "Example structure")],
      description: t("역할이 비슷한 서브 에이전트를 하나의 팀으로 묶는 자리입니다.", "This is where similar sub-agents can be grouped into a team."),
      clusterId: "cluster:orchestration:teams",
      featureGateKey: "settings.control",
    })
    pushNode({
      id: placeholderAgentId,
      kind: "sub_agent",
      label: t("첫 서브 에이전트", "First sub-agent"),
      status: "planned",
      badges: [t("예시 구조", "Example structure")],
      description: t("나중에 조사, 실행, 검증 같은 역할을 분리할 때 이 자리에 추가됩니다.", "A role such as research, execution, or review can be added here later."),
      clusterId: "cluster:orchestration:agents",
      featureGateKey: "settings.control",
    })
    pushNode({
      id: placeholderCapabilityId,
      kind: "capability",
      label: t("공용 capability", "Shared capability"),
      status: "planned",
      badges: [t("allowlist preview", "allowlist preview")],
      description: t("서브 에이전트를 켜면 Skill/MCP/도구 허용 범위를 이 층에서 관리하게 됩니다.", "Once sub-agents are enabled, Skill/MCP/tool allowlists will be managed on this layer."),
      clusterId: "cluster:orchestration:capabilities",
      featureGateKey: "settings.control",
    })
    edges.push(
      {
        id: "edge:orchestration:coordinator:team:placeholder",
        from: coordinatorId,
        to: placeholderTeamId,
        kind: "flow",
        label: t("확장 지점", "Expansion point"),
        featureGateKey: "settings.control",
      },
      {
        id: "edge:orchestration:membership:placeholder",
        from: placeholderTeamId,
        to: placeholderAgentId,
        kind: "belongs_to",
        label: t("예시 소속", "Example membership"),
        featureGateKey: "settings.control",
      },
      {
        id: "edge:orchestration:capability:placeholder",
        from: placeholderAgentId,
        to: placeholderCapabilityId,
        kind: "uses",
        label: t("예시 capability", "Example capability"),
        featureGateKey: "settings.control",
      },
    )
  }

  if (singleNobieMode) {
    alerts.push({
      id: "alert:orchestration:single-nobie",
      tone: "info",
      message: t("현재는 단일 노비 모드입니다. 아래 구조는 확장될 때의 topology 예시를 함께 보여줍니다.", "Currently in single Nobie mode. The structure below also shows how the topology expands later."),
    })
  }
  if (unresolvedMemberships.length > 0) {
    alerts.push({
      id: "alert:orchestration:unresolved",
      tone: "error",
      message: t(`해결 안 된 팀 연결 ${unresolvedMemberships.length}건`, `${unresolvedMemberships.length} unresolved team links`),
      relatedNodeIds: unresolvedMemberships.map((edge) => `node:orchestration:unresolved:${edge.teamId}:${edge.agentId}`),
    })
  }
  if (emptyTeams.length > 0) {
    alerts.push({
      id: "alert:orchestration:empty-teams",
      tone: "warning",
      message: t(`빈 팀 ${emptyTeams.length}개`, `${emptyTeams.length} empty teams`),
      relatedNodeIds: emptyTeams.map((team) => `node:orchestration:team:${team.teamId}`),
    })
  }
  if (highRiskAgents.length > 0) {
    alerts.push({
      id: "alert:orchestration:high-risk",
      tone: "warning",
      message: t(`고위험 권한 agent ${highRiskAgents.length}명`, `${highRiskAgents.length} agents with high-risk permissions`),
      relatedNodeIds: highRiskAgents.map((agent) => `node:orchestration:agent:${agent.agentId}`),
    })
  }
  for (const item of graphView.diagnostics) {
    alerts.push({
      id: `alert:orchestration:graph:${slugifyId(item)}`,
      tone: "warning",
      message: item,
    })
  }
  for (const item of snapshot?.diagnostics ?? []) {
    alerts.push({
      id: `alert:orchestration:registry:${item.code}`,
      tone: "warning",
      message: `${item.code}: ${item.message}`,
    })
  }

  return {
    id: "scene:orchestration_topology",
    label: t("서브 에이전트 topology", "Sub-agent topology"),
    mode,
    semanticStepIds: [],
    nodes,
    edges,
    clusters: clusters.filter((cluster) => cluster.nodeIds.length > 0),
    alerts,
    featureGateKey: "settings.control",
  }
}

export function riskText(risk: CapabilityRiskLevel, language: UiLanguage): string {
  const t = (ko: string, en: string) => pickUiText(language, ko, en)
  switch (risk) {
    case "safe": return t("읽기/정리 중심", "Read and organize")
    case "moderate": return t("일반 도구 사용", "Normal tool use")
    case "external": return t("외부 네트워크 사용", "External network")
    case "sensitive": return t("민감 정보 가능", "Sensitive access")
    case "dangerous": return t("강한 실행 권한", "Powerful execution")
  }
}

export function isHighRiskPermissionProfile(profile: PermissionProfile): boolean {
  return profile.riskCeiling === "external"
    || profile.riskCeiling === "sensitive"
    || profile.riskCeiling === "dangerous"
    || profile.allowExternalNetwork
    || profile.allowFilesystemWrite
    || profile.allowShellExecution
    || profile.allowScreenControl
}

export function parseCommaList(value: string): string[] {
  return value.split(",").map((item) => item.trim()).filter(Boolean)
}

export function formatCommaList(value: string[] | undefined): string {
  return (value ?? []).join(", ")
}

export function defaultSkillMcpAllowlist(): SkillMcpAllowlist {
  return {
    enabledSkillIds: [],
    enabledMcpServerIds: [],
    enabledToolNames: [],
    disabledToolNames: [],
  }
}

export function createSubAgentConfig(input: {
  agentId: string
  displayName: string
  nickname?: string
  role: string
  personality: string
  specialtyTags: string[]
  avoidTasks: string[]
  teamIds: string[]
  riskCeiling: CapabilityRiskLevel
  enabledSkillIds: string[]
  enabledMcpServerIds: string[]
  enabledToolNames: string[]
  allowExternalNetwork?: boolean
  allowFilesystemWrite?: boolean
  allowShellExecution?: boolean
  allowScreenControl?: boolean
  allowedPaths?: string[]
  existing?: SubAgentConfig
  now?: number
}): SubAgentConfig {
  const now = input.now ?? Date.now()
  const agentId = input.agentId.trim()
  const existing = input.existing
  const allowlist = existing?.capabilityPolicy.skillMcpAllowlist ?? defaultSkillMcpAllowlist()
  const permissionProfile = existing?.capabilityPolicy.permissionProfile ?? {
    profileId: `profile:${agentId}`,
    riskCeiling: input.riskCeiling,
    approvalRequiredFrom: input.riskCeiling === "safe" ? "moderate" as const : input.riskCeiling,
    allowExternalNetwork: false,
    allowFilesystemWrite: false,
    allowShellExecution: false,
    allowScreenControl: false,
    allowedPaths: [],
  }
  return {
    schemaVersion: 1,
    agentType: "sub_agent",
    agentId,
    displayName: preserveDraftText(input.displayName, agentId),
    ...(preserveOptionalDraftText(input.nickname) ? { nickname: preserveOptionalDraftText(input.nickname)! } : {}),
    status: existing?.status ?? "disabled",
    role: preserveDraftText(input.role, "sub-agent"),
    personality: preserveDraftText(input.personality, "Concise, evidence-first, and bounded by assigned role."),
    specialtyTags: input.specialtyTags,
    avoidTasks: input.avoidTasks,
    memoryPolicy: existing?.memoryPolicy ?? {
      owner: { ownerType: "sub_agent", ownerId: agentId },
      visibility: "private",
      readScopes: [{ ownerType: "sub_agent", ownerId: agentId }],
      writeScope: { ownerType: "sub_agent", ownerId: agentId },
      retentionPolicy: "long_term",
      writebackReviewRequired: true,
    },
    capabilityPolicy: {
      permissionProfile: {
        ...permissionProfile,
        riskCeiling: input.riskCeiling,
        allowExternalNetwork: input.allowExternalNetwork ?? permissionProfile.allowExternalNetwork,
        allowFilesystemWrite: input.allowFilesystemWrite ?? permissionProfile.allowFilesystemWrite,
        allowShellExecution: input.allowShellExecution ?? permissionProfile.allowShellExecution,
        allowScreenControl: input.allowScreenControl ?? permissionProfile.allowScreenControl,
        allowedPaths: input.allowedPaths ?? permissionProfile.allowedPaths,
      },
      skillMcpAllowlist: {
        ...allowlist,
        enabledSkillIds: input.enabledSkillIds,
        enabledMcpServerIds: input.enabledMcpServerIds,
        enabledToolNames: input.enabledToolNames,
      },
      rateLimit: existing?.capabilityPolicy.rateLimit ?? { maxConcurrentCalls: 2 },
    },
    profileVersion: existing ? existing.profileVersion + 1 : 1,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    teamIds: input.teamIds,
    delegation: existing?.delegation ?? {
      enabled: false,
      maxParallelSessions: 2,
      retryBudget: 2,
    },
  }
}

export function createTeamConfig(input: {
  teamId: string
  displayName: string
  nickname?: string
  purpose: string
  memberAgentIds: string[]
  roleHints: string[]
  existing?: TeamConfig
  now?: number
}): TeamConfig {
  const now = input.now ?? Date.now()
  const teamId = input.teamId.trim()
  const existing = input.existing
  return {
    schemaVersion: 1,
    teamId,
    displayName: preserveDraftText(input.displayName, teamId),
    ...(preserveOptionalDraftText(input.nickname) ? { nickname: preserveOptionalDraftText(input.nickname)! } : {}),
    status: existing?.status ?? "disabled",
    purpose: preserveDraftText(input.purpose, "Grouped sub-agent collaboration."),
    memberAgentIds: input.memberAgentIds,
    roleHints: input.roleHints,
    profileVersion: existing ? existing.profileVersion + 1 : 1,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
}

function emptyEdgeCounts(): Record<RelationshipEdgeType, number> {
  return {
    delegation: 0,
    data_exchange: 0,
    permission: 0,
    capability_delegation: 0,
    team_membership: 0,
  }
}

function slugifyId(value: string): string {
  return slugifyOrchestrationSegment(value, "item")
}

function preserveDraftText(value: string | undefined, fallback: string): string {
  if (typeof value !== "string") return fallback
  return value
}

function preserveOptionalDraftText(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined
  return value.trim().length > 0 ? value : undefined
}
