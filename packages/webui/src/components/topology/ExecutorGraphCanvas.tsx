import {
  applyNodeChanges,
  Background,
  type Connection,
  Controls,
  type Edge,
  Handle,
  type Node,
  type NodeChange,
  type NodeProps,
  Position,
  ReactFlow,
  ReactFlowProvider,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import * as React from "react"
import type { EnterpriseRelation, EnterpriseTopology } from "../../contracts/enterprise-topology"
import {
  buildExecutorGraphFromEnterpriseTopology,
  type ExecutorConnectionDraft,
  type ExecutorDraft,
  type ExecutorGraphWorkspace,
  type ExecutorSectionDraft,
} from "../../lib/executor-graph"
import {
  buildExecutorGraphRelationInfoMap,
  type ExecutorGraphRelationInfo,
} from "../../lib/executor-graph-relations"
import type { TopologyWorkspaceLayer } from "../../lib/topology-workspace"
import { useUiI18n } from "../../lib/ui-i18n"
import {
  ExecutorCardNode,
  type ExecutorCardExecutionStatus,
  type ExecutorCardResourceChip,
} from "./ExecutorCardNode"

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

interface ExecutorFlowNodeData extends Record<string, unknown> {
  executor: ExecutorDraft
  resources: ExecutorCardResourceChip[]
  relation?: ExecutorGraphRelationInfo
  working: boolean
  executionStatus?: ExecutorCardExecutionStatus
}

export type ExecutorFlowEdgeStatus = "running" | "completed" | "failed" | "cancelled"

export function buildExecutorGraphCanvasModel(input: {
  topology?: EnterpriseTopology | null
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

export function ExecutorGraphCanvas({
  topology,
  graph,
  selectedLayer = "build",
  selectedExecutorId,
  activeExecutorIds = [],
  activeEdgeIds = [],
  executorStatuses = {},
  edgeStatuses = {},
  onSelectExecutor,
  onConnectExecutors,
  onMoveExecutor,
}: {
  topology?: EnterpriseTopology | null
  graph?: ExecutorGraphWorkspace | null
  selectedLayer?: TopologyWorkspaceLayer
  selectedExecutorId?: string | null
  activeExecutorIds?: string[]
  activeEdgeIds?: string[]
  executorStatuses?: Record<string, ExecutorCardExecutionStatus>
  edgeStatuses?: Record<string, ExecutorFlowEdgeStatus>
  onSelectExecutor?: (executorId: string) => void
  onConnectExecutors?: (sourceExecutorId: string, targetExecutorId: string) => void
  onMoveExecutor?: (executorId: string, position: { x: number; y: number }) => void
}) {
  const { text } = useUiI18n()
  const model = React.useMemo(() => buildExecutorGraphCanvasModel({ topology, graph }), [graph, topology])
  const activeExecutorIdSet = React.useMemo(() => new Set(activeExecutorIds), [activeExecutorIds])
  const activeEdgeIdSet = React.useMemo(() => new Set(activeEdgeIds), [activeEdgeIds])
  const flowNodes = React.useMemo(
    () => model ? executorFlowNodes(model, selectedExecutorId, activeExecutorIdSet, executorStatuses) : [],
    [activeExecutorIdSet, executorStatuses, model, selectedExecutorId],
  )
  const [interactiveNodes, setInteractiveNodes] = React.useState<Array<Node<ExecutorFlowNodeData>>>(flowNodes)
  React.useEffect(() => {
    setInteractiveNodes(flowNodes)
  }, [flowNodes])
  const flowEdges = React.useMemo(
    () => model ? executorFlowEdges(model, activeEdgeIdSet, edgeStatuses) : [],
    [activeEdgeIdSet, edgeStatuses, model],
  )
  const handleNodesChange = React.useCallback((changes: Array<NodeChange<Node<ExecutorFlowNodeData>>>) => {
    setInteractiveNodes((current) => applyNodeChanges(changes, current))
  }, [])
  const handleConnect = React.useCallback((connection: Connection) => {
    if (!connection.source || !connection.target || connection.source === connection.target) return
    onConnectExecutors?.(connection.source, connection.target)
  }, [onConnectExecutors])
  const handleNodeDragStop = React.useCallback((_: React.MouseEvent, node: Node<ExecutorFlowNodeData>) => {
    onMoveExecutor?.(node.id, {
      x: Math.round(node.position.x),
      y: Math.round(node.position.y),
    })
  }, [onMoveExecutor])

  if (!model || model.graph.executors.length === 0) {
    return (
      <section
        className="h-full min-h-[220px] overflow-hidden bg-stone-100 p-4"
        data-testid="executor-graph-canvas"
        data-layer={selectedLayer}
      >
        <div
          className="rounded-lg border border-dashed border-stone-300 bg-white px-4 py-8 text-sm text-stone-500"
          data-testid="executor-graph-empty-canvas"
        >
          {text("실행자를 추가하면 여기에 업무 흐름이 표시됩니다.", "Add executors to see the workflow here.")}
        </div>
      </section>
    )
  }

  return (
    <section
      className="grid h-full min-h-[220px] grid-rows-[auto_minmax(0,1fr)] gap-4 overflow-hidden bg-stone-100 p-4"
      data-testid="executor-graph-canvas"
      data-layer={selectedLayer}
      data-executor-count={model.graph.executors.length}
      data-connection-count={model.connections.length}
      data-active-executor-count={activeExecutorIds.length}
      data-active-executor-ids={activeExecutorIds.join(" ")}
      data-active-edge-count={activeEdgeIds.length}
      data-active-edge-ids={activeEdgeIds.join(" ")}
      data-draggable="true"
      data-connectable={Boolean(onConnectExecutors)}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-xs font-semibold text-stone-950">
            {text("실행자 흐름", "Executor flow")}
          </div>
          <div className="mt-1 text-[11px] text-stone-500">
            {text("실행 카드만 기본 흐름에 표시하고, 도구와 시스템은 카드 안에 정리합니다.", "Only executor cards appear in the flow; tools and systems stay inside cards.")}
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5 text-[11px] font-semibold text-stone-600">
          <span className="rounded-full bg-white px-2 py-0.5">{model.graph.executors.length} {text("실행자", "executors")}</span>
          <span className="rounded-full bg-white px-2 py-0.5">{model.connections.length} {text("연결", "connections")}</span>
        </div>
      </div>

      <div className="min-h-0 overflow-hidden rounded-lg border border-stone-200 bg-white" data-testid="executor-flow-canvas">
        <ReactFlowProvider>
          <ReactFlow
            nodes={interactiveNodes}
            edges={flowEdges}
            nodeTypes={executorFlowNodeTypes}
            onNodesChange={handleNodesChange}
            onConnect={handleConnect}
            onNodeClick={(_, node) => onSelectExecutor?.(node.id)}
            onNodeDragStop={handleNodeDragStop}
            fitView
            minZoom={0.35}
            maxZoom={1.35}
            nodesDraggable
            nodesConnectable={Boolean(onConnectExecutors)}
            elementsSelectable
          >
            <Background color="#d6d3d1" gap={22} />
            <Controls
              position="top-left"
              className="executor-flow-controls"
              data-testid="executor-flow-controls"
            />
          </ReactFlow>
        </ReactFlowProvider>
      </div>

    </section>
  )
}

function ExecutorFlowNodeView(props: NodeProps) {
  const data = props.data as ExecutorFlowNodeData
  const working = Boolean(data.working)
  return (
    <div
      className={`relative w-[244px] rounded-lg ${working ? "topology-working-node" : ""}`}
      data-testid="executor-flow-node"
      data-executor-id={data.executor.id}
      data-working={working}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!h-3 !w-3 !border-2 !border-stone-500 !bg-white"
      />
      <ExecutorCardNode
        executor={data.executor}
        resources={data.resources}
        selected={Boolean(props.selected)}
        working={working}
        executionStatus={data.executionStatus}
        relationLabel={data.relation?.relationLabelKo}
        relationDescription={data.relation?.relationDetailKo}
        roleLabel={data.relation?.roleLabel}
        shortId={data.relation?.shortId}
        duplicateName={data.relation?.duplicateName}
        selectableWithoutPath={data.relation?.selectableWithoutPath}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        className="!h-3 !w-3 !border-2 !border-stone-500 !bg-white"
      />
    </div>
  )
}

const executorFlowNodeTypes = { executorFlowNode: ExecutorFlowNodeView }

function executorFlowNodes(
  model: ExecutorGraphCanvasModel,
  selectedExecutorId?: string | null,
  activeExecutorIds: Set<string> = new Set(),
  executorStatuses: Record<string, ExecutorCardExecutionStatus> = {},
): Array<Node<ExecutorFlowNodeData>> {
  const cardsById = new Map<string, ExecutorGraphCanvasCard>()
  const relationInfoById = buildExecutorGraphRelationInfoMap(model.graph)
  for (const card of model.unsectionedCards) cardsById.set(card.executor.id, card)
  for (const section of model.sections) {
    for (const card of section.cards) cardsById.set(card.executor.id, card)
  }
  return model.graph.executors.map((executor, index) => {
    const card = cardsById.get(executor.id) ?? { executor, resources: [] }
    const fallbackPosition = {
      x: 80 + (index % 3) * 310,
      y: 70 + Math.floor(index / 3) * 190,
    }
    return {
      id: executor.id,
      type: "executorFlowNode",
      position: executor.position ?? fallbackPosition,
      selected: executor.id === selectedExecutorId,
      data: {
        executor,
        resources: card.resources,
        relation: relationInfoById.get(executor.id),
        working: activeExecutorIds.has(executor.id) || Boolean(executor.sourceNodeId && activeExecutorIds.has(executor.sourceNodeId)),
        executionStatus: executorStatuses[executor.id] ?? (activeExecutorIds.has(executor.id) ? "running" : undefined),
      },
    }
  })
}

function executorFlowEdges(
  model: ExecutorGraphCanvasModel,
  activeEdgeIds: Set<string> = new Set(),
  edgeStatuses: Record<string, ExecutorFlowEdgeStatus> = {},
): Array<Edge> {
  const executorIds = new Set(model.graph.executors.map((executor) => executor.id))
  return model.connections
    .filter((connection) => executorIds.has(connection.fromExecutorId) && executorIds.has(connection.toExecutorId))
    .map((connection) => {
      const status = edgeStatuses[connection.id] ?? (activeEdgeIds.has(connection.id) ? "running" : undefined)
      return {
        id: connection.id,
        source: connection.fromExecutorId,
        target: connection.toExecutorId,
        label: connection.label,
        type: "smoothstep",
        animated: status === "running" || !connection.userConfirmed,
        className: `executor-flow-edge ${status ? `executor-flow-edge-${status}` : ""}`,
        data: { status: status ?? "idle" },
        style: edgeStyleForStatus(status),
      }
    })
}

function edgeStyleForStatus(status: ExecutorFlowEdgeStatus | undefined): Edge["style"] {
  if (status === "running") return { stroke: "#0284c7", strokeWidth: 3 }
  if (status === "completed") return { stroke: "#059669", strokeWidth: 2.5 }
  if (status === "failed") return { stroke: "#e11d48", strokeWidth: 2.5 }
  if (status === "cancelled") return { stroke: "#78716c", strokeWidth: 2, strokeDasharray: "5 5" }
  return { stroke: "#57534e", strokeWidth: 2 }
}


function buildExecutorResourceMap(
  topology: EnterpriseTopology | null | undefined,
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
  toolById: Map<string, NonNullable<EnterpriseTopology["tools"][number]>>,
  systemById: Map<string, NonNullable<EnterpriseTopology["systems"][number]>>,
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
