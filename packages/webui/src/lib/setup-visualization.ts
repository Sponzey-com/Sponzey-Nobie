import type { CapabilityStatus } from "../contracts/capabilities"
import type { SetupStepId } from "../contracts/setup"
import type { StepValidation } from "./setupFlow"
import type { BeginnerConnectionStatus, BeginnerSetupStepStatus } from "./beginner-setup"
import { pickUiText, type UiLanguage } from "../stores/uiLanguage"

export type VisualizationStatus =
  | "ready"
  | "warning"
  | "error"
  | "disabled"
  | "draft"
  | "required"
  | "planned"

export type VisualizationOverlayTone =
  | "required"
  | "warning"
  | "error"
  | "draft-changed"
  | "blocked-next-step"

export type VisualizationNodeKind =
  | "step"
  | "profile"
  | "ai_backend"
  | "router"
  | "capability"
  | "mcp"
  | "skill"
  | "channel"
  | "security"
  | "remote"
  | "yeonjang"
  | "team"
  | "sub_agent"
  | "approval"
  | "memory"

export type VisualizationEdgeKind =
  | "flow"
  | "depends"
  | "uses"
  | "protected_by"
  | "belongs_to"
  | "approved_to_control"

export interface VisualizationNode {
  id: string
  kind: VisualizationNodeKind
  label: string
  status: VisualizationStatus
  badges: string[]
  description?: string
  clusterId?: string
  inspectorId?: string
  featureGateKey?: string
  semanticStepIds?: SetupStepId[]
  draftOwnedByStepIds?: SetupStepId[]
  overlayTones?: VisualizationOverlayTone[]
  overlayMessages?: string[]
}

export interface VisualizationEdge {
  id: string
  from: string
  to: string
  kind: VisualizationEdgeKind
  label?: string
  status?: "normal" | "warning" | "error"
  featureGateKey?: string
  semanticStepIds?: SetupStepId[]
  overlayTones?: VisualizationOverlayTone[]
  overlayMessages?: string[]
}

export interface VisualizationCluster {
  id: string
  label: string
  description?: string
  nodeIds: string[]
  featureGateKey?: string
  semanticStepIds?: SetupStepId[]
  overlayTones?: VisualizationOverlayTone[]
  overlayMessages?: string[]
}

export interface VisualizationInspectorSection {
  id: string
  label: string
  description?: string
  fieldKeys: string[]
  featureGateKey?: string
}

export interface VisualizationAlert {
  id: string
  tone: "info" | "warning" | "error"
  message: string
  semanticStepIds?: SetupStepId[]
  relatedNodeIds?: string[]
  relatedEdgeIds?: string[]
}

export interface VisualizationScene {
  id: string
  label: string
  mode: "shared" | "beginner" | "advanced"
  semanticStepIds: SetupStepId[]
  nodes: VisualizationNode[]
  edges: VisualizationEdge[]
  clusters?: VisualizationCluster[]
  inspectorSections?: VisualizationInspectorSection[]
  alerts?: VisualizationAlert[]
  featureGateKey?: string
}

export function applyValidationOverlaysToScene(
  scene: VisualizationScene | null,
  {
    stepId,
    validation,
    showValidation,
    isDraftDirty,
    nextStepBlocked,
    language,
  }: {
    stepId: SetupStepId
    validation: StepValidation
    showValidation: boolean
    isDraftDirty: boolean
    nextStepBlocked: boolean
    language: UiLanguage
  },
): VisualizationScene | null {
  if (!scene) return null

  const nodes = scene.nodes.map((node) => ({ ...node }))
  const edges = scene.edges.map((edge) => ({ ...edge }))
  const clusters = scene.clusters?.map((cluster) => ({ ...cluster }))
  const alerts = [...(scene.alerts ?? [])]

  const applyOverlay = (
    tone: VisualizationOverlayTone,
    message: string,
    {
      nodeIds = [],
      edgeIds = [],
      clusterIds = [],
    }: {
      nodeIds?: string[]
      edgeIds?: string[]
      clusterIds?: string[]
    },
  ) => {
    for (const nodeId of nodeIds) {
      const node = nodes.find((candidate) => candidate.id === nodeId)
      if (!node) continue
      node.overlayTones = pushUnique(node.overlayTones, tone)
      node.overlayMessages = pushUnique(node.overlayMessages, message)
      node.status = mergeStatusWithOverlay(node.status, tone)
    }

    for (const edgeId of edgeIds) {
      const edge = edges.find((candidate) => candidate.id === edgeId)
      if (!edge) continue
      edge.overlayTones = pushUnique(edge.overlayTones, tone)
      edge.overlayMessages = pushUnique(edge.overlayMessages, message)
      edge.status = edgeToneToStatus(tone, edge.status)
    }

    for (const clusterId of clusterIds) {
      const cluster = clusters?.find((candidate) => candidate.id === clusterId)
      if (!cluster) continue
      cluster.overlayTones = pushUnique(cluster.overlayTones, tone)
      cluster.overlayMessages = pushUnique(cluster.overlayMessages, message)
    }
  }

  if (showValidation) {
    for (const [fieldKey, message] of Object.entries(validation.fieldErrors)) {
      const targets = mapFieldValidationTargets(scene, stepId, fieldKey)
      applyOverlay(toneFromFieldMessage(message), message, targets)
    }

    for (const [backendId, errors] of Object.entries(validation.backendErrors)) {
      const nodeId = scene.nodes.find((candidate) => candidate.id === `node:ai:${backendId}` || candidate.id === `node:routing:${backendId}`)?.id
      if (!nodeId) continue
      for (const [errorKey, message] of Object.entries(errors)) {
        if (!message) continue
        const clusterIds = collectClusterIdsForNode(scene, nodeId)
        const edgeIds = scene.edges.filter((edge) => edge.to === nodeId || edge.from === nodeId).map((edge) => edge.id)
        applyOverlay(errorKey === "enabled" ? "warning" : "required", message, { nodeIds: [nodeId], edgeIds, clusterIds })
      }
    }

    for (const [serverId, errors] of Object.entries(validation.mcpErrors)) {
      const nodeId = `node:mcp:${serverId}`
      for (const [errorKey, message] of Object.entries(errors)) {
        if (!message) continue
        const clusterIds = collectClusterIdsForNode(scene, nodeId)
        const edgeIds = scene.edges.filter((edge) => edge.to === nodeId || edge.from === nodeId).map((edge) => edge.id)
        applyOverlay(errorKey === "status" ? "warning" : "required", message, { nodeIds: [nodeId], edgeIds, clusterIds })
      }
    }

    for (const [skillId, errors] of Object.entries(validation.skillErrors)) {
      const nodeId = `node:skills:${skillId}`
      for (const [errorKey, message] of Object.entries(errors)) {
        if (!message) continue
        const clusterIds = collectClusterIdsForNode(scene, nodeId)
        const edgeIds = scene.edges.filter((edge) => edge.to === nodeId || edge.from === nodeId).map((edge) => edge.id)
        applyOverlay(errorKey === "status" ? "warning" : "required", message, { nodeIds: [nodeId], edgeIds, clusterIds })
      }
    }
  }

  if (isDraftDirty) {
    const draftNodes = nodes.filter((node) =>
      node.draftOwnedByStepIds?.includes(stepId)
      || node.semanticStepIds?.includes(stepId),
    )
    for (const node of draftNodes) {
      node.overlayTones = pushUnique(node.overlayTones, "draft-changed")
      node.overlayMessages = pushUnique(
        node.overlayMessages,
        pickUiText(language, "저장되지 않은 변경사항", "Unsaved changes"),
      )
    }
  }

  if (nextStepBlocked && showValidation && !validation.valid) {
    const message = pickUiText(
      language,
      "현재 단계의 필수 입력을 마치기 전에는 다음 단계로 이동할 수 없습니다.",
      "You cannot move to the next step until the required inputs in this step are complete.",
    )
    for (const node of nodes.filter((candidate) => candidate.semanticStepIds?.includes(stepId) || candidate.draftOwnedByStepIds?.includes(stepId))) {
      node.overlayTones = pushUnique(node.overlayTones, "blocked-next-step")
      node.overlayMessages = pushUnique(node.overlayMessages, message)
    }
    alerts.push({
      id: `alert:${scene.id}:blocked-next-step`,
      tone: "error",
      message,
      semanticStepIds: [stepId],
      relatedNodeIds: nodes
        .filter((candidate) => candidate.overlayTones?.includes("blocked-next-step"))
        .map((candidate) => candidate.id),
    })
  }

  if (showValidation) {
    for (const message of validation.summary) {
      alerts.push({
        id: `alert:${scene.id}:validation:${slugifyMessage(message)}`,
        tone: toneFromFieldMessage(message) === "warning" ? "warning" : "error",
        message,
        semanticStepIds: [stepId],
      })
    }
  }

  return {
    ...scene,
    nodes,
    edges,
    clusters,
    alerts: dedupeAlerts(alerts),
  }
}

export function normalizeCapabilityVisualizationStatus(status: CapabilityStatus): VisualizationStatus {
  switch (status) {
    case "ready":
      return "ready"
    case "error":
      return "error"
    case "disabled":
      return "disabled"
    case "planned":
    default:
      return "planned"
  }
}

function pushUnique<T>(values: T[] | undefined, next: T): T[] {
  if (!values) return [next]
  return values.includes(next) ? values : [...values, next]
}

function mergeStatusWithOverlay(status: VisualizationStatus, tone: VisualizationOverlayTone): VisualizationStatus {
  switch (tone) {
    case "error":
      return "error"
    case "required":
      return status === "error" ? status : "required"
    case "warning":
    case "blocked-next-step":
      return status === "error" || status === "required" ? status : "warning"
    case "draft-changed":
      return status === "planned" ? "draft" : status
    default:
      return status
  }
}

function edgeToneToStatus(
  tone: VisualizationOverlayTone,
  current: VisualizationEdge["status"],
): VisualizationEdge["status"] {
  if (tone === "error") return "error"
  if (tone === "required" || tone === "warning" || tone === "blocked-next-step") return current === "error" ? current : "warning"
  return current
}

function toneFromFieldMessage(message: string): VisualizationOverlayTone {
  if (/(입력|선택|켜야|하나 이상|전체 경로)/.test(message)) {
    return "required"
  }
  if (/(다시 확인|지원|확인 필요|먼저 진행)/.test(message)) {
    return "warning"
  }
  return "error"
}

function mapFieldValidationTargets(
  scene: VisualizationScene,
  stepId: SetupStepId,
  fieldKey: string,
): { nodeIds: string[]; edgeIds: string[]; clusterIds: string[] } {
  switch (stepId) {
    case "personal":
      if (fieldKey === "profileName" || fieldKey === "displayName") {
        return {
          nodeIds: ["node:personal:identity"],
          edgeIds: [
            "edge:personal:identity:language",
            "edge:personal:identity:timezone",
            "edge:personal:identity:workspace",
          ],
          clusterIds: [],
        }
      }
      if (fieldKey === "language") {
        return {
          nodeIds: ["node:personal:language", "node:personal:ai_context"],
          edgeIds: ["edge:personal:identity:language", "edge:personal:language:ai"],
          clusterIds: [],
        }
      }
      if (fieldKey === "timezone") {
        return {
          nodeIds: ["node:personal:timezone", "node:personal:channel_context"],
          edgeIds: ["edge:personal:identity:timezone", "edge:personal:timezone:channels"],
          clusterIds: [],
        }
      }
      if (fieldKey === "workspace") {
        return {
          nodeIds: ["node:personal:workspace", "node:personal:local_context"],
          edgeIds: ["edge:personal:identity:workspace", "edge:personal:workspace:local"],
          clusterIds: [],
        }
      }
      break
    case "security":
      if (fieldKey === "approvalTimeout") {
        return {
          nodeIds: ["node:security:approval_gate", "node:security:timeout_policy"],
          edgeIds: ["edge:security:approval:timeout", "edge:security:timeout:restricted"],
          clusterIds: [],
        }
      }
      break
    case "channels":
      if (fieldKey === "telegramEnabled") {
        return {
          nodeIds: ["node:channels:webui", "node:channels:telegram", "node:channels:slack"].filter((nodeId) => scene.nodes.some((node) => node.id === nodeId)),
          edgeIds: ["edge:channels:webui:telegram", "edge:channels:webui:slack"].filter((edgeId) => scene.edges.some((edge) => edge.id === edgeId)),
          clusterIds: [],
        }
      }
      if (fieldKey === "botToken") {
        return {
          nodeIds: ["node:channels:telegram"],
          edgeIds: ["edge:channels:webui:telegram"],
          clusterIds: [],
        }
      }
      if (fieldKey === "slackBotToken" || fieldKey === "slackAppToken") {
        return {
          nodeIds: ["node:channels:slack"],
          edgeIds: ["edge:channels:webui:slack"],
          clusterIds: [],
        }
      }
      break
    case "remote_access":
      if (fieldKey === "host" || fieldKey === "port") {
        return {
          nodeIds: ["node:remote:endpoint", "node:remote:external_clients"],
          edgeIds: ["edge:remote:endpoint:auth", "edge:remote:auth:external"],
          clusterIds: [],
        }
      }
      if (fieldKey === "authToken") {
        return {
          nodeIds: ["node:remote:auth_boundary"],
          edgeIds: ["edge:remote:endpoint:auth", "edge:remote:auth:external", "edge:remote:auth:mqtt"],
          clusterIds: [],
        }
      }
      if (fieldKey.startsWith("mqtt")) {
        return {
          nodeIds: ["node:remote:mqtt_bridge"],
          edgeIds: ["edge:remote:auth:mqtt", "edge:remote:mqtt:external"],
          clusterIds: [],
        }
      }
      break
    default:
      break
  }

  return {
    nodeIds: scene.nodes
      .filter((node) => node.semanticStepIds?.includes(stepId) || node.draftOwnedByStepIds?.includes(stepId))
      .map((node) => node.id),
    edgeIds: scene.edges
      .filter((edge) => edge.semanticStepIds?.includes(stepId))
      .map((edge) => edge.id),
    clusterIds: scene.clusters
      ?.filter((cluster) => cluster.semanticStepIds?.includes(stepId))
      .map((cluster) => cluster.id) ?? [],
  }
}

function collectClusterIdsForNode(scene: VisualizationScene, nodeId: string): string[] {
  return scene.clusters
    ?.filter((cluster) => cluster.nodeIds.includes(nodeId))
    .map((cluster) => cluster.id) ?? []
}

function dedupeAlerts(alerts: VisualizationAlert[]): VisualizationAlert[] {
  const seen = new Set<string>()
  const deduped: VisualizationAlert[] = []
  for (const alert of alerts) {
    const key = `${alert.tone}:${alert.message}`
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(alert)
  }
  return deduped
}

function slugifyMessage(message: string): string {
  return message
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
}

export function normalizeBeginnerSetupVisualizationStatus(status: BeginnerSetupStepStatus): VisualizationStatus {
  switch (status) {
    case "done":
      return "ready"
    case "needs_attention":
      return "warning"
    case "skipped":
    default:
      return "disabled"
  }
}

export function normalizeBeginnerConnectionVisualizationStatus(status: BeginnerConnectionStatus): VisualizationStatus {
  switch (status) {
    case "ready":
      return "ready"
    case "needs_attention":
      return "warning"
    case "idle":
    default:
      return "disabled"
  }
}
