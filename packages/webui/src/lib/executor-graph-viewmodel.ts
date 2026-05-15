import type { EnterpriseRelation, EnterpriseTopology } from "../contracts/enterprise-topology"
import {
  buildExecutorGraphFromEnterpriseTopology,
  type ExecutorConnectionDraft,
  type ExecutorDraft,
  type ExecutorGraphWorkspace,
  type ExecutorSectionDraft,
} from "./executor-graph"

export interface ExecutorCardResourceChip {
  id: string
  label: string
  kind: "tool" | "system" | "data"
}

export interface ExecutorGraphCanvasCard {
  executor: ExecutorDraft
  resources: ExecutorCardResourceChip[]
}

export interface ExecutorGraphCanvasSection {
  section: ExecutorSectionDraft
  cards: ExecutorGraphCanvasCard[]
}

export interface ExecutorGraphCanvasModel {
  graph: ExecutorGraphWorkspace
  sections: ExecutorGraphCanvasSection[]
  unsectionedCards: ExecutorGraphCanvasCard[]
  connections: ExecutorConnectionDraft[]
}

export type ExecutorGraphCanvasInputTopology = EnterpriseTopology

export function buildExecutorGraphCanvasModel(input: {
  topology?: ExecutorGraphCanvasInputTopology | null
  graph?: ExecutorGraphWorkspace | null
}): ExecutorGraphCanvasModel | null {
  const graph = input.graph ?? (input.topology
    ? buildExecutorGraphFromEnterpriseTopology(input.topology, { mode: "simple" })
    : null)
  if (!graph) return null

  const resourceMap = buildExecutorResourceMap(input.topology, graph)
  const cardByExecutorId = new Map(graph.executors.map((executor) => [
    executor.id,
    {
      executor,
      resources: resourceMap.get(executor.id) ?? [],
    },
  ]))
  const usedExecutorIds = new Set<string>()
  const sections = graph.sections.map((section) => {
    const cards = section.executorIds
      .map((executorId) => cardByExecutorId.get(executorId))
      .filter((card): card is ExecutorGraphCanvasCard => Boolean(card))
    for (const card of cards) usedExecutorIds.add(card.executor.id)
    return { section, cards }
  })
  const unsectionedCards = graph.executors
    .filter((executor) => !usedExecutorIds.has(executor.id))
    .map((executor) => cardByExecutorId.get(executor.id))
    .filter((card): card is ExecutorGraphCanvasCard => Boolean(card))

  return {
    graph,
    sections,
    unsectionedCards,
    connections: graph.connections,
  }
}

function buildExecutorResourceMap(
  topology: ExecutorGraphCanvasInputTopology | null | undefined,
  graph: ExecutorGraphWorkspace,
): Map<string, ExecutorCardResourceChip[]> {
  const resources = new Map<string, ExecutorCardResourceChip[]>()
  const toolById = new Map(topology?.tools.map((tool) => [tool.id, tool]) ?? [])
  const systemById = new Map(topology?.systems.map((system) => [system.id, system]) ?? [])

  for (const executor of graph.executors) {
    const chips: ExecutorCardResourceChip[] = []
    for (const resourceId of executor.inferredTools) {
      if (resourceId.startsWith("system:")) {
        chips.push({
          id: resourceId,
          label: systemById.get(resourceId)?.displayName?.trim() || systemById.get(resourceId)?.name || resourceId,
          kind: "system",
        })
        continue
      }
      chips.push({
        id: resourceId,
        label: toolById.get(resourceId)?.displayName?.trim() || toolById.get(resourceId)?.name || resourceId,
        kind: "tool",
      })
    }
    for (const systemId of executor.advancedMapping?.allowedSystemIds ?? []) {
      chips.push({
        id: systemId,
        label: systemById.get(systemId)?.displayName?.trim() || systemById.get(systemId)?.name || systemId,
        kind: "system",
      })
    }
    if (chips.length > 0) resources.set(executor.id, dedupeResources(chips))
  }

  for (const relation of topology?.relations ?? []) {
    const relationResource = resourceChipForRelation(relation, toolById, systemById)
    if (!relationResource) continue
    const current = resources.get(relation.from.id) ?? []
    resources.set(relation.from.id, dedupeResources([...current, relationResource]))
  }

  return resources
}

function resourceChipForRelation(
  relation: EnterpriseRelation,
  toolById: Map<string, NonNullable<ExecutorGraphCanvasInputTopology["tools"][number]>>,
  systemById: Map<string, NonNullable<ExecutorGraphCanvasInputTopology["systems"][number]>>,
): ExecutorCardResourceChip | null {
  if (relation.from.entityType !== "node") return null
  if (relation.relationType === "uses_tool" && relation.to.entityType === "enterprise_tool") {
    const tool = toolById.get(relation.to.id)
    return {
      id: relation.to.id,
      label: tool?.displayName?.trim() || tool?.name || relation.to.id,
      kind: "tool",
    }
  }
  if (relation.relationType === "uses_system" && relation.to.entityType === "enterprise_system") {
    const system = systemById.get(relation.to.id)
    return {
      id: relation.to.id,
      label: system?.displayName?.trim() || system?.name || relation.to.id,
      kind: "system",
    }
  }
  return null
}

function dedupeResources(resources: ExecutorCardResourceChip[]): ExecutorCardResourceChip[] {
  const seen = new Set<string>()
  const deduped: ExecutorCardResourceChip[] = []
  for (const resource of resources) {
    const key = `${resource.kind}:${resource.id}`
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(resource)
  }
  return deduped
}
