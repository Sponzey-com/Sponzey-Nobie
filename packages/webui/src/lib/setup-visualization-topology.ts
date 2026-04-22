import type { UiShellResponse } from "../api/client"
import type { FeatureCapability } from "../contracts/capabilities"
import type { OrchestrationAgentRegistryEntry } from "../contracts/orchestration-api"
import type { CapabilityRiskLevel } from "../contracts/sub-agent-orchestration"
import type { VisualizationAlert, VisualizationEdge, VisualizationNode, VisualizationStatus } from "./setup-visualization"
import { pickUiText, type UiLanguage } from "../stores/uiLanguage"

const SCREEN_CONTROL_FLOOR: CapabilityRiskLevel = "sensitive"
const RISK_ORDER: CapabilityRiskLevel[] = ["safe", "moderate", "external", "sensitive", "dangerous"]

export interface TopologyEditorGate {
  status: "ready" | "preview_only" | "disabled"
  canEdit: boolean
  canValidate: boolean
  canPersist: boolean
  title: string
  message: string
  reasons: string[]
}

export interface YeonjangRuntimeProjection {
  availability: "live" | "broker_ready" | "unavailable"
  mqttEnabled: boolean
  connectedExtensions: number
  label: string
  description: string
}

export interface YeonjangAgentRelation {
  agentId: string
  agentLabel: string
  nodeId: string
  edgeId: string
  state: "approved_to_control" | "approval_required" | "blocked"
  status: VisualizationStatus
  edgeStatus?: "normal" | "warning" | "error"
  label: string
  badges: string[]
  description: string
  approvalPolicyLabel: string
  runtimeLabel: string
  blockedReasons: string[]
}

export interface YeonjangCapabilityProjection {
  hubNode: VisualizationNode
  edges: VisualizationEdge[]
  alerts: VisualizationAlert[]
  relations: YeonjangAgentRelation[]
  runtime: YeonjangRuntimeProjection
}

export interface TopologyInspectorModel {
  id: string
  tone: "ready" | "warning" | "error"
  title: string
  summary: string
  badges: string[]
  details: string[]
}

export function resolveTopologyEditorGate(input: {
  surface: "page" | "settings"
  settingsCapability?: FeatureCapability
  mqttCapability?: FeatureCapability
  language: UiLanguage
}): TopologyEditorGate {
  const { surface, settingsCapability, mqttCapability, language } = input
  const t = (ko: string, en: string) => pickUiText(language, ko, en)
  const reasons: string[] = []

  if (surface !== "page") {
    reasons.push(
      t(
        "설정 탭과 초보 surface는 topology preview만 보여주고, 편집은 전용 `/agents` surface에서만 허용됩니다.",
        "Settings and beginner surfaces stay preview-only. Editing is allowed only on the dedicated `/agents` surface.",
      ),
    )
  }
  if ((settingsCapability?.status ?? "disabled") !== "ready") {
    reasons.push(
      settingsCapability?.reason
        ? String(settingsCapability.reason)
        : t(
          "`settings.control` capability가 ready 상태가 아니라 topology 편집기를 열 수 없습니다.",
          "The `settings.control` capability is not ready, so the topology editor cannot be unlocked.",
        ),
    )
  }
  if ((mqttCapability?.status ?? "disabled") !== "ready") {
    reasons.push(
      mqttCapability?.reason
        ? String(mqttCapability.reason)
        : t(
          "`mqtt.broker` capability가 ready 상태가 아니라 Yeonjang shared hub는 preview만 유지됩니다.",
          "The `mqtt.broker` capability is not ready, so the Yeonjang shared hub stays preview-only.",
        ),
    )
  }

  if (surface !== "page") {
    return {
      status: "preview_only",
      canEdit: false,
      canValidate: false,
      canPersist: false,
      title: t("읽기 전용 surface", "Read-only surface"),
      message: reasons[0] ?? t("현재 surface에서는 구조 요약만 제공합니다.", "This surface only provides a structural preview."),
      reasons,
    }
  }
  if ((settingsCapability?.status ?? "disabled") !== "ready") {
    return {
      status: "disabled",
      canEdit: false,
      canValidate: false,
      canPersist: false,
      title: t("Topology 편집 잠김", "Topology editing locked"),
      message: reasons[0] ?? t("설정 제어 capability를 먼저 복구해야 합니다.", "Restore the settings-control capability first."),
      reasons,
    }
  }
  if ((mqttCapability?.status ?? "disabled") !== "ready") {
    return {
      status: "preview_only",
      canEdit: false,
      canValidate: false,
      canPersist: false,
      title: t("Yeonjang gate 대기", "Waiting for the Yeonjang gate"),
      message: reasons[0] ?? t("MQTT broker capability가 준비될 때까지 preview만 유지됩니다.", "The surface remains preview-only until the MQTT broker capability is ready."),
      reasons,
    }
  }
  return {
    status: "ready",
    canEdit: true,
    canValidate: true,
    canPersist: true,
    title: t("Topology 편집 가능", "Topology editing unlocked"),
    message: t(
      "Yeonjang shared hub와 에이전트 관계를 같은 surface에서 검증하고 저장할 수 있습니다.",
      "You can validate and persist the Yeonjang shared hub and agent relationships on this surface.",
    ),
    reasons: [
      t(
        "`settings.control`과 `mqtt.broker`가 모두 ready이므로 topology write API를 사용할 수 있습니다.",
        "Both `settings.control` and `mqtt.broker` are ready, so topology write APIs can be used.",
      ),
    ],
  }
}

export function resolveYeonjangRuntimeProjection(input: {
  mqttCapability?: FeatureCapability
  shell?: UiShellResponse | null
  language: UiLanguage
}): YeonjangRuntimeProjection {
  const { mqttCapability, shell, language } = input
  const t = (ko: string, en: string) => pickUiText(language, ko, en)
  const mqttEnabled = Boolean(shell?.runtimeHealth.yeonjang.mqttEnabled)
  const connectedExtensions = shell?.runtimeHealth.yeonjang.connectedExtensions ?? 0
  const mqttReady = mqttCapability?.status === "ready"

  if (mqttReady && mqttEnabled && connectedExtensions > 0) {
    return {
      availability: "live",
      mqttEnabled,
      connectedExtensions,
      label: t(`live ${connectedExtensions}`, `live ${connectedExtensions}`),
      description: t(
        `MQTT broker가 살아 있고 Yeonjang extension ${connectedExtensions}개가 연결되어 있습니다.`,
        `The MQTT broker is live and ${connectedExtensions} Yeonjang extension(s) are connected.`,
      ),
    }
  }
  if (mqttReady) {
    return {
      availability: "broker_ready",
      mqttEnabled,
      connectedExtensions,
      label: mqttEnabled ? t("broker on", "broker on") : t("broker ready", "broker ready"),
      description: mqttEnabled
        ? t(
            "MQTT broker는 켜져 있지만 아직 연결된 Yeonjang extension이 없습니다.",
            "The MQTT broker is enabled, but there are no connected Yeonjang extensions yet.",
          )
        : t(
            "MQTT capability는 준비됐지만 현재 runtime broker가 꺼져 있습니다.",
            "The MQTT capability is ready, but the runtime broker is currently off.",
          ),
    }
  }
  return {
    availability: "unavailable",
    mqttEnabled,
    connectedExtensions,
    label: t("broker off", "broker off"),
    description: t(
      "MQTT broker capability가 준비되지 않아 Yeonjang shared hub는 구조 설명만 가능합니다.",
      "The MQTT broker capability is not ready, so the Yeonjang shared hub is structural only.",
    ),
  }
}

export function buildYeonjangCapabilityProjection(input: {
  agents: OrchestrationAgentRegistryEntry[]
  mqttCapability?: FeatureCapability
  shell?: UiShellResponse | null
  language: UiLanguage
}): YeonjangCapabilityProjection {
  const { agents, mqttCapability, shell, language } = input
  const t = (ko: string, en: string) => pickUiText(language, ko, en)
  const runtime = resolveYeonjangRuntimeProjection({ mqttCapability, shell, language })
  const relations = agents.map((agent) => buildYeonjangAgentRelation({ agent, mqttCapability, runtime, language }))
  const approvedCount = relations.filter((item) => item.state === "approved_to_control").length
  const approvalRequiredCount = relations.filter((item) => item.state === "approval_required").length
  const blockedCount = relations.filter((item) => item.state === "blocked").length
  const hubStatus: VisualizationStatus = runtime.availability === "unavailable"
    ? "disabled"
    : blockedCount > 0 || runtime.availability === "broker_ready"
      ? "warning"
      : "ready"
  const hubNode: VisualizationNode = {
    id: "node:orchestration:yeonjang_hub",
    kind: "yeonjang",
    label: "Yeonjang Capability Hub",
    status: hubStatus,
    badges: [
      runtime.label,
      `${approvedCount} ${t("즉시 허용", "approved")}`,
      `${approvalRequiredCount} ${t("승인 필요", "approval required")}`,
      `${blockedCount} ${t("차단", "blocked")}`,
    ],
    description: t(
      "Yeonjang은 특정 전용 agent의 부속이 아니라, 승인된 서브 에이전트가 공유하는 screen-control capability hub입니다. 팀 소속만으로는 접근 권한이 생기지 않습니다.",
      "Yeonjang is not attached to one dedicated agent. It is a shared screen-control capability hub for approved sub-agents, and team membership alone does not grant access.",
    ),
    clusterId: "cluster:orchestration:capabilities",
    inspectorId: "yeonjang:hub",
    featureGateKey: "mqtt.broker",
  }
  const edges: VisualizationEdge[] = relations.map((relation) => ({
    id: relation.edgeId,
    from: relation.nodeId,
    to: hubNode.id,
    kind: "approved_to_control",
    label: relation.label,
    status: relation.edgeStatus,
    featureGateKey: "mqtt.broker",
  }))
  const alerts: VisualizationAlert[] = [
    {
      id: "alert:orchestration:yeonjang-shared",
      tone: "info",
      message: t(
        "Yeonjang은 shared capability hub이며, 팀 소속만으로는 사용 권한이 생기지 않습니다.",
        "Yeonjang is a shared capability hub, and team membership alone does not grant access.",
      ),
      relatedNodeIds: [hubNode.id],
      relatedEdgeIds: edges.map((edge) => edge.id),
    },
  ]

  if (runtime.availability !== "live") {
    alerts.push({
      id: "alert:orchestration:yeonjang-runtime",
      tone: "warning",
      message: runtime.description,
      relatedNodeIds: [hubNode.id],
      relatedEdgeIds: edges.map((edge) => edge.id),
    })
  }
  if (blockedCount > 0) {
    alerts.push({
      id: "alert:orchestration:yeonjang-blocked",
      tone: "warning",
      message: t(`Yeonjang 차단 agent ${blockedCount}명`, `${blockedCount} blocked Yeonjang agents`),
      relatedEdgeIds: relations.filter((item) => item.state === "blocked").map((item) => item.edgeId),
      relatedNodeIds: relations.filter((item) => item.state === "blocked").map((item) => item.nodeId),
    })
  }
  if (approvalRequiredCount > 0) {
    alerts.push({
      id: "alert:orchestration:yeonjang-approval",
      tone: "warning",
      message: t(`Yeonjang 승인 필요 agent ${approvalRequiredCount}명`, `${approvalRequiredCount} Yeonjang agents require approval`),
      relatedEdgeIds: relations.filter((item) => item.state === "approval_required").map((item) => item.edgeId),
      relatedNodeIds: relations.filter((item) => item.state === "approval_required").map((item) => item.nodeId),
    })
  }

  return {
    hubNode,
    edges,
    alerts,
    relations,
    runtime,
  }
}

export function buildOrchestrationTopologyInspector(input: {
  selectedNodeId?: string | null
  selectedEdgeId?: string | null
  relations: YeonjangAgentRelation[]
  runtime: YeonjangRuntimeProjection
  gate: TopologyEditorGate
  language: UiLanguage
}): TopologyInspectorModel {
  const { selectedNodeId, selectedEdgeId, relations, runtime, gate, language } = input
  const t = (ko: string, en: string) => pickUiText(language, ko, en)
  const selectedRelation = relations.find((item) => item.edgeId === selectedEdgeId)
    ?? relations.find((item) => item.nodeId === selectedNodeId)
    ?? null

  if (selectedRelation) {
    const relationTitle = `${selectedRelation.agentLabel} -> Yeonjang`
    const details = [
      t(
        `권한 프로필: screen control ${selectedRelation.state === "blocked" ? "off/blocked" : "on"}`,
        `Permission profile: screen control ${selectedRelation.state === "blocked" ? "off/blocked" : "on"}`,
      ),
      `${t("승인 기준", "Approval policy")}: ${selectedRelation.approvalPolicyLabel}`,
      `${t("런타임 가용성", "Runtime availability")}: ${selectedRelation.runtimeLabel}`,
      t(
        "팀 소속은 구조 정보일 뿐이며, Yeonjang 접근 권한을 자동으로 만들지 않습니다.",
        "Team membership is structural only and does not automatically create Yeonjang access.",
      ),
      ...selectedRelation.blockedReasons.map((reason) => `${t("차단 사유", "Blocked reason")}: ${reason}`),
    ]
    return {
      id: selectedRelation.edgeId,
      tone: selectedRelation.state === "approved_to_control" ? "ready" : selectedRelation.state === "approval_required" ? "warning" : "error",
      title: relationTitle,
      summary: selectedRelation.description,
      badges: selectedRelation.badges,
      details,
    }
  }

  if (selectedNodeId?.startsWith("node:orchestration:team:")) {
    return {
      id: selectedNodeId,
      tone: "warning",
      title: t("팀은 Yeonjang 권한을 대신하지 않습니다.", "Teams do not substitute for Yeonjang permission."),
      summary: t(
        "팀은 위임 구조를 묶을 뿐이며, Yeonjang 사용 여부는 각 agent의 permission profile과 approval policy로 따로 결정됩니다.",
        "Teams only group delegation structure. Yeonjang access is decided separately by each agent's permission profile and approval policy.",
      ),
      badges: [t("구조 정보", "Structural grouping"), t("권한 별도 계산", "Permissions calculated separately")],
      details: [
        t("팀 소속만으로 shared capability hub 연결선이 생기지 않습니다.", "Team membership alone does not create a shared capability-hub edge."),
        `${t("편집 gate", "Editor gate")}: ${gate.title}`,
        `${t("런타임", "Runtime")}: ${runtime.description}`,
      ],
    }
  }

  const approvedCount = relations.filter((item) => item.state === "approved_to_control").length
  const approvalRequiredCount = relations.filter((item) => item.state === "approval_required").length
  const blockedCount = relations.filter((item) => item.state === "blocked").length
  return {
    id: "inspector:yeonjang:hub",
    tone: gate.status === "ready" && runtime.availability === "live" ? "ready" : "warning",
    title: "Yeonjang Capability Hub",
    summary: t(
      "승인된 서브 에이전트는 이 shared hub를 통해 화면 제어를 요청합니다. 현재 runtime availability와 approval boundary는 아래와 같습니다.",
      "Approved sub-agents request screen control through this shared hub. The current runtime availability and approval boundary are summarized below.",
    ),
    badges: [runtime.label, `${approvedCount} ${t("즉시 허용", "approved")}`, `${approvalRequiredCount} ${t("승인 필요", "approval required")}`, `${blockedCount} ${t("차단", "blocked")}`],
    details: [
      runtime.description,
      `${t("편집 gate", "Editor gate")}: ${gate.message}`,
      t(
        "팀 소속은 topology 설명에만 쓰이며 Yeonjang 권한을 직접 부여하지 않습니다.",
        "Team membership is used only for topology description and does not directly grant Yeonjang access.",
      ),
    ],
  }
}

function buildYeonjangAgentRelation(input: {
  agent: OrchestrationAgentRegistryEntry
  mqttCapability?: FeatureCapability
  runtime: YeonjangRuntimeProjection
  language: UiLanguage
}): YeonjangAgentRelation {
  const { agent, mqttCapability, runtime, language } = input
  const t = (ko: string, en: string) => pickUiText(language, ko, en)
  const profile = agent.permissionProfile
  const blockedReasons: string[] = []

  if (agent.status === "disabled" || agent.status === "archived") {
    blockedReasons.push(t("agent가 비활성 또는 보관 상태입니다.", "The agent is disabled or archived."))
  }
  if (!agent.delegationEnabled) {
    blockedReasons.push(t("위임이 꺼져 있어 실행 경로에 포함되지 않습니다.", "Delegation is off, so the agent is not on the execution path."))
  }
  if (!profile.allowScreenControl) {
    blockedReasons.push(t("permission profile에 screen control이 허용되지 않았습니다.", "The permission profile does not allow screen control."))
  }
  if (!meetsRiskFloor(profile.riskCeiling, SCREEN_CONTROL_FLOOR)) {
    blockedReasons.push(t("risk ceiling이 screen-control band보다 낮습니다.", "The risk ceiling is below the screen-control band."))
  }
  if ((mqttCapability?.status ?? "disabled") !== "ready") {
    blockedReasons.push(t("MQTT broker capability가 준비되지 않았습니다.", "The MQTT broker capability is not ready."))
  }

  let state: YeonjangAgentRelation["state"] = "blocked"
  if (blockedReasons.length === 0) {
    state = requiresApprovalForRisk(profile.approvalRequiredFrom, SCREEN_CONTROL_FLOOR) ? "approval_required" : "approved_to_control"
  }

  const agentLabel = agent.nickname ?? agent.displayName
  const approvalPolicyLabel = `${profile.approvalRequiredFrom} -> ${riskText(profile.riskCeiling)}`
  const runtimeLabel = runtime.description
  const label = state === "approved_to_control"
    ? t("승인된 shared control", "Approved shared control")
    : state === "approval_required"
      ? t("승인 후 제어", "Control after approval")
      : t("제어 차단", "Control blocked")
  const description = state === "approved_to_control"
    ? t(
        "이 agent는 shared Yeonjang hub를 직접 사용할 수 있습니다. 다만 runtime extension availability는 별도로 확인해야 합니다.",
        "This agent can use the shared Yeonjang hub directly, but runtime extension availability is still checked separately.",
      )
    : state === "approval_required"
      ? t(
          "이 agent는 Yeonjang을 요청할 수 있지만, approval policy 경계 안에서만 실행됩니다.",
          "This agent may request Yeonjang, but only within the approval-policy boundary.",
        )
      : t(
          "이 agent는 현재 Yeonjang shared hub에 연결될 수 없습니다. permission 또는 runtime blocker를 먼저 해소해야 합니다.",
          "This agent cannot currently connect to the Yeonjang shared hub. Resolve the permission or runtime blockers first.",
        )
  return {
    agentId: agent.agentId,
    agentLabel,
    nodeId: `node:orchestration:agent:${agent.agentId}`,
    edgeId: `edge:orchestration:yeonjang:${agent.agentId}`,
    state,
    status: state === "approved_to_control" ? "ready" : state === "approval_required" ? "warning" : "disabled",
    edgeStatus: state === "approved_to_control" ? undefined : state === "approval_required" ? "warning" : "error",
    label,
    badges: [
      stateLabel(state, language),
      `approval:${profile.approvalRequiredFrom}`,
      runtime.label,
    ],
    description,
    approvalPolicyLabel,
    runtimeLabel,
    blockedReasons,
  }
}

function stateLabel(state: YeonjangAgentRelation["state"], language: UiLanguage): string {
  switch (state) {
    case "approved_to_control":
      return pickUiText(language, "즉시 허용", "Approved")
    case "approval_required":
      return pickUiText(language, "승인 필요", "Approval required")
    case "blocked":
    default:
      return pickUiText(language, "차단됨", "Blocked")
  }
}

function meetsRiskFloor(current: CapabilityRiskLevel, floor: CapabilityRiskLevel): boolean {
  return compareRisk(current, floor) >= 0
}

function requiresApprovalForRisk(requiredFrom: CapabilityRiskLevel, current: CapabilityRiskLevel): boolean {
  return compareRisk(requiredFrom, current) <= 0
}

function compareRisk(left: CapabilityRiskLevel, right: CapabilityRiskLevel): number {
  return RISK_ORDER.indexOf(left) - RISK_ORDER.indexOf(right)
}

function riskText(risk: CapabilityRiskLevel): string {
  return risk
}
