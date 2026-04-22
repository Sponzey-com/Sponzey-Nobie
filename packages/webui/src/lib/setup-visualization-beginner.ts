import type { SetupStepId } from "../contracts/setup"
import type {
  BeginnerConnectionCardView,
  BeginnerSetupStepId,
  BeginnerSetupStepStatus,
  BeginnerSetupStepView,
} from "./beginner-setup"
import type { SetupVisualizationRegistry } from "./setup-visualization-scenes"
import type { VisualizationScene, VisualizationStatus } from "./setup-visualization"

export interface BeginnerVisualizationPreviewNode {
  id: string
  label: string
  status: VisualizationStatus
}

export interface BeginnerVisualizationCard {
  id: BeginnerSetupStepId
  label: string
  description: string
  status: BeginnerSetupStepStatus
  statusLabel: string
  semanticStepIds: SetupStepId[]
  sceneIds: string[]
  semanticStatus: VisualizationStatus
  previewNodes: BeginnerVisualizationPreviewNode[]
  attentionCount: number
  relatedConnections: BeginnerConnectionCardView[]
}

export interface BeginnerVisualizationDeckView {
  cards: BeginnerVisualizationCard[]
  selectedStepId: BeginnerSetupStepId
  selectedCard: BeginnerVisualizationCard | null
}

export const BEGINNER_VISUALIZATION_GROUPS: Record<
  BeginnerSetupStepId,
  {
    semanticStepIds: SetupStepId[]
    relatedConnections: BeginnerConnectionCardView["id"][]
  }
> = {
  ai: {
    semanticStepIds: ["ai_backends"],
    relatedConnections: ["ai"],
  },
  channels: {
    semanticStepIds: ["channels"],
    relatedConnections: ["channels"],
  },
  computer: {
    semanticStepIds: ["remote_access"],
    relatedConnections: ["yeonjang"],
  },
  test: {
    semanticStepIds: ["review", "done"],
    relatedConnections: ["storage"],
  },
}

export function buildBeginnerVisualizationDeck(input: {
  steps: BeginnerSetupStepView[]
  connections: BeginnerConnectionCardView[]
  registry: SetupVisualizationRegistry
  selectedStepId: BeginnerSetupStepId
}): BeginnerVisualizationDeckView {
  const cards = input.steps.map((step) => {
    const group = BEGINNER_VISUALIZATION_GROUPS[step.id]
    const scenes = resolveScenes(group.semanticStepIds, input.registry)
    const previewNodes = scenes
      .flatMap((scene) => scene.nodes)
      .slice(0, 4)
      .map((node) => ({ id: node.id, label: node.label, status: node.status }))
    const semanticStatuses = scenes.map((scene) => deriveSceneStatus(scene))
    const attentionCount = previewNodes.filter((node) => ["warning", "error", "required"].includes(node.status)).length

    return {
      id: step.id,
      label: step.label,
      description: step.description,
      status: step.status,
      statusLabel: step.statusLabel,
      semanticStepIds: group.semanticStepIds,
      sceneIds: scenes.map((scene) => scene.id),
      semanticStatus: aggregateVisualizationStatus(semanticStatuses),
      previewNodes,
      attentionCount,
      relatedConnections: input.connections.filter((connection) => group.relatedConnections.includes(connection.id)),
    } satisfies BeginnerVisualizationCard
  })

  return {
    cards,
    selectedStepId: input.selectedStepId,
    selectedCard: cards.find((card) => card.id === input.selectedStepId) ?? null,
  }
}

function resolveScenes(semanticStepIds: SetupStepId[], registry: SetupVisualizationRegistry): VisualizationScene[] {
  return semanticStepIds
    .map((stepId) => registry.sceneIdByStepId[stepId])
    .filter((sceneId): sceneId is string => Boolean(sceneId))
    .map((sceneId) => registry.scenesById[sceneId])
    .filter((scene): scene is VisualizationScene => Boolean(scene))
}

function deriveSceneStatus(scene: VisualizationScene): VisualizationStatus {
  if (scene.nodes.length === 0) return "planned"
  return aggregateVisualizationStatus(scene.nodes.map((node) => node.status))
}

function aggregateVisualizationStatus(statuses: VisualizationStatus[]): VisualizationStatus {
  if (statuses.some((status) => status === "error")) return "error"
  if (statuses.some((status) => status === "required" || status === "warning")) return "warning"
  if (statuses.some((status) => status === "ready")) return "ready"
  if (statuses.some((status) => status === "draft")) return "draft"
  if (statuses.some((status) => status === "disabled")) return "disabled"
  if (statuses.some((status) => status === "planned")) return "planned"
  return "draft"
}
