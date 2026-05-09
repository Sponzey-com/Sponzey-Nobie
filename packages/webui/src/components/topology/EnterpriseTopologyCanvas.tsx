import {
  Background,
  type Connection,
  Controls,
  type Edge,
  Handle,
  MiniMap,
  type Node,
  type NodeProps,
  Position,
  ReactFlow,
  type ReactFlowInstance,
  ReactFlowProvider,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import * as React from "react"
import type {
  EnterpriseEntityRef,
  EnterpriseRelation,
  EnterpriseRelationType,
  EnterpriseTopology,
  EnterpriseTopologyValidationIssue,
  NodeContract,
} from "../../contracts/enterprise-topology"
import type { AgentTopologyProjection } from "../../contracts/topology"
import type { TopologyRelationLayer, TopologyRelationTemplateCatalog } from "../../contracts/relation-templates"
import type { TopologyTemplateCatalog } from "../../contracts/topology-templates"
import type {
  EnterpriseTopologyGuiDraftCompiledPreviewResponse,
  EnterpriseTopologyGuiOperation,
  EnterpriseTopologyObservedEdgeRecord,
} from "../../lib/enterprise-topology-operations"
import type { TopologyWorkspaceLayer } from "../../lib/topology-workspace"
import {
  shouldShowTopologyWorkspaceAdvancedSurface,
  type TopologyWorkspaceExposureMode,
} from "../../lib/topology-workspace-copy"
import { useUiI18n } from "../../lib/ui-i18n"
import { EnterpriseTopologyInspector } from "./EnterpriseTopologyInspector"
import type { TopologyWorkspaceExecutorMapping } from "./TopologyWorkspaceInspector"
import {
  ENTERPRISE_TOPOLOGY_KIND_LABELS,
  ENTERPRISE_TOPOLOGY_PALETTE,
  EnterpriseTopologyPalette,
  type EnterpriseTopologyPaletteItem,
  type EnterpriseTopologyPaletteKind,
} from "./EnterpriseTopologyPalette"
import { TopologyCompilePreview } from "./TopologyCompilePreview"
import { TopologyImprovePanel } from "./TopologyImprovePanel"
import {
  TopologyRunTraceOverlay,
  buildTopologyRunOverlayState,
  type TopologyRunTraceOverlayInput,
  type TopologyTraceNodeState,
} from "./TopologyRunTraceOverlay"
import { TopologyValidationAssistant } from "./TopologyValidationAssistant"
import {
  RelationModeToolbar,
  isRuntimeRelationCandidate,
  relationLayerForType,
  relationModeClassName,
  relationModeStyle,
  type EnterpriseRelationModeIssue,
  type TopologyRelationModeId,
} from "./RelationModeToolbar"

export type EnterpriseTopologyCanvasKind = EnterpriseTopologyPaletteKind

export interface EnterpriseTopologyCanvasNodeData extends Record<string, unknown> {
  kind: EnterpriseTopologyCanvasKind
  label: string
  detail: string
  status: "draft" | "active" | "inactive" | "archived"
  entityId: string
  entityType: string
  traceState?: TopologyTraceNodeState
  runTarget?: boolean
}

export interface EnterpriseTopologyRelationEdgeData extends Record<string, unknown> {
  relationType: EnterpriseRelationType
  layer: TopologyRelationLayer
  runtimeCandidate: boolean
}

export interface EnterpriseTopologyCanvasModel {
  nodes: Array<Node<EnterpriseTopologyCanvasNodeData>>
  edges: Array<Edge<EnterpriseTopologyRelationEdgeData>>
  palette: EnterpriseTopologyPaletteItem[]
  validationIssues: EnterpriseTopologyValidationIssue[]
}

function nodeIdForRef(ref: EnterpriseEntityRef): string {
  return `${ref.entityType}:${ref.id}`
}

function displayName(entity: { name: string; displayName?: string }): string {
  return entity.displayName?.trim() || entity.name
}

function hiddenFromBeginnerCanvas(entity: { metadata?: Record<string, unknown> }): boolean {
  return entity.metadata?.hiddenFromBeginnerCanvas === true
}

function nodeToneClassName(kind: EnterpriseTopologyCanvasKind): string {
  if (kind === "task" || kind === "work_node" || kind === "process") return "border-sky-200 bg-sky-50 text-sky-950"
  if (kind === "decision") return "border-stone-300 bg-white text-stone-950"
  if (kind === "approval" || kind === "authority") return "border-rose-200 bg-rose-50 text-rose-950"
  if (kind === "group" || kind === "team" || kind === "responsibility" || kind === "data") return "border-teal-200 bg-teal-50 text-teal-950"
  if (kind === "system" || kind === "tool") return "border-amber-200 bg-amber-50 text-amber-950"
  return "border-stone-200 bg-white text-stone-950"
}

function traceNodeClassName(state: TopologyTraceNodeState | undefined, runTarget: boolean | undefined): string {
  if (state === "failed") return "border-red-400 bg-red-50 text-red-950 shadow-[0_0_0_3px_rgba(248,113,113,0.35)]"
  if (state === "failed_candidate") return "border-orange-400 bg-orange-50 text-orange-950 shadow-[0_0_0_3px_rgba(251,146,60,0.28)]"
  if (state === "tool_call") return "border-amber-400 bg-amber-50 text-amber-950 shadow-[0_0_0_3px_rgba(251,191,36,0.28)]"
  if (state === "delegation_path") return "border-sky-400 bg-sky-50 text-sky-950 shadow-[0_0_0_3px_rgba(56,189,248,0.24)]"
  if (runTarget) return "border-emerald-400 bg-emerald-50 text-emerald-950 shadow-[0_0_0_3px_rgba(52,211,153,0.24)]"
  return ""
}

function minimapColor(node: Node): string {
  const data = node.data as EnterpriseTopologyCanvasNodeData
  if (data.kind === "task" || data.kind === "work_node" || data.kind === "process") return "#bae6fd"
  if (data.kind === "decision") return "#e7e5e4"
  if (data.kind === "group" || data.kind === "team" || data.kind === "responsibility" || data.kind === "data") return "#99f6e4"
  if (data.kind === "system" || data.kind === "tool") return "#fde68a"
  if (data.kind === "approval" || data.kind === "authority") return "#fecdd3"
  return "#e7e5e4"
}

function EnterpriseTopologyNodeView(props: NodeProps) {
  const data = props.data as EnterpriseTopologyCanvasNodeData
  const { text } = useUiI18n()
  const kindLabel = ENTERPRISE_TOPOLOGY_KIND_LABELS[data.kind]

  return (
    <div className={`min-w-44 rounded-lg border px-3 py-2 shadow-sm ${nodeToneClassName(data.kind)} ${traceNodeClassName(data.traceState, data.runTarget)}`}>
      <Handle type="target" position={Position.Top} className="!h-2 !w-2 !border-stone-400 !bg-white" />
      <div className="text-[11px] font-semibold uppercase text-stone-500">
        {text(kindLabel.ko, kindLabel.en)}
      </div>
      <div className="mt-1 text-sm font-semibold leading-5">{data.label}</div>
      <div className="mt-1 max-w-52 truncate text-xs text-stone-500">{data.detail}</div>
      <Handle type="source" position={Position.Bottom} className="!h-2 !w-2 !border-stone-400 !bg-white" />
    </div>
  )
}

const nodeTypes = { enterpriseTopologyNode: EnterpriseTopologyNodeView }

function sampleModel(): EnterpriseTopologyCanvasModel {
  return {
    palette: ENTERPRISE_TOPOLOGY_PALETTE,
    validationIssues: [],
    nodes: [
      {
        id: "node:customer-intake",
        type: "enterpriseTopologyNode",
        position: { x: 60, y: 120 },
        data: {
          kind: "task",
          label: "Customer Intake",
          detail: "신규 요청 접수",
          status: "draft",
          entityId: "node:customer-intake",
          entityType: "node",
        },
      },
      {
        id: "org_unit:operations",
        type: "enterpriseTopologyNode",
        position: { x: 330, y: 40 },
        data: {
          kind: "group",
          label: "Operations",
          detail: "업무 운영 조직",
          status: "draft",
          entityId: "org:operations",
          entityType: "org_unit",
        },
      },
      {
        id: "position:ops-lead",
        type: "enterpriseTopologyNode",
        position: { x: 610, y: 40 },
        data: {
          kind: "position",
          label: "Ops Lead",
          detail: "승인 책임자",
          status: "draft",
          entityId: "position:ops-lead",
          entityType: "position",
        },
      },
      {
        id: "enterprise_system:crm",
        type: "enterpriseTopologyNode",
        position: { x: 330, y: 235 },
        data: {
          kind: "data",
          label: "CRM",
          detail: "고객 데이터 시스템",
          status: "draft",
          entityId: "system:crm",
          entityType: "enterprise_system",
        },
      },
      {
        id: "enterprise_tool:crm-search",
        type: "enterpriseTopologyNode",
        position: { x: 610, y: 235 },
        data: {
          kind: "tool",
          label: "CRM Search",
          detail: "조회 전용 도구",
          status: "draft",
          entityId: "tool:crm-search",
          entityType: "enterprise_tool",
        },
      },
    ],
    edges: [
      {
        id: "edge:customer-intake:ops",
        source: "node:customer-intake",
        target: "org_unit:operations",
        label: "owns",
        type: "smoothstep",
      },
      {
        id: "edge:ops:lead",
        source: "org_unit:operations",
        target: "position:ops-lead",
        label: "reports_to",
        type: "smoothstep",
      },
      {
        id: "edge:intake:crm",
        source: "node:customer-intake",
        target: "enterprise_system:crm",
        label: "uses_system",
        type: "smoothstep",
      },
      {
        id: "edge:intake:tool",
        source: "node:customer-intake",
        target: "enterprise_tool:crm-search",
        label: "uses_tool",
        type: "smoothstep",
      },
    ],
  }
}

function TopologyWorkspaceSimpleCreatePanel({
  onAddExecutor,
  onAddSection,
}: {
  onAddExecutor?: () => void
  onAddSection?: () => void
}) {
  const { text } = useUiI18n()
  return (
    <aside
      className="min-h-0 overflow-y-auto rounded-lg border border-stone-200 bg-white p-4"
      data-testid="topology-simple-create-panel"
    >
      <div className="text-sm font-semibold text-stone-950">
        {text("실행자 흐름", "Executor flow")}
      </div>
      <div className="mt-1 text-xs leading-5 text-stone-500">
        {text(
          "실행자를 추가하고 연결하면 내부 구조는 노비가 정리합니다.",
          "Add executors and connect them; Nobie organizes the internal structure.",
        )}
      </div>
      <div className="mt-4 grid gap-2">
        <button
          type="button"
          onClick={onAddExecutor}
          disabled={!onAddExecutor}
          className="h-10 rounded-lg bg-stone-900 px-3 text-left text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          data-testid="topology-simple-add-executor"
        >
          {text("+ 실행자 추가", "+ Add executor")}
        </button>
        <button
          type="button"
          onClick={onAddSection}
          disabled={!onAddSection}
          className="h-10 rounded-lg border border-stone-200 bg-white px-3 text-left text-sm font-semibold text-stone-800 disabled:cursor-not-allowed disabled:opacity-50"
          data-testid="topology-simple-add-section"
        >
          {text("+ 영역 추가", "+ Add section")}
        </button>
      </div>
      <div className="mt-4 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-xs leading-5 text-stone-600">
        {text(
          "토폴로지 화면은 실행자 추가와 연결 중심으로 정리되었습니다.",
          "The topology screen is organized around adding and connecting executors.",
        )}
      </div>
    </aside>
  )
}

function canvasKindForNode(node: NodeContract): EnterpriseTopologyCanvasKind {
  if (node.nodeType === "decision_node") return "decision"
  if (node.nodeType === "approval_node") return "approval"
  return "task"
}

function flowNode(
  index: number,
  ref: EnterpriseEntityRef,
  kind: EnterpriseTopologyCanvasKind,
  label: string,
  detail: string,
  status: EnterpriseTopologyCanvasNodeData["status"],
): Node<EnterpriseTopologyCanvasNodeData> {
  const column = index % 4
  const row = Math.floor(index / 4)
  return {
    id: nodeIdForRef(ref),
    type: "enterpriseTopologyNode",
    position: { x: 60 + column * 250, y: 70 + row * 150 },
    data: {
      kind,
      label,
      detail,
      status,
      entityId: ref.id,
      entityType: ref.entityType,
    },
  }
}

function relationToEdge(
  relation: EnterpriseRelation,
  nodeIds: Set<string>,
  relationCatalog?: TopologyRelationTemplateCatalog | null,
): Edge<EnterpriseTopologyRelationEdgeData> | null {
  const source = nodeIdForRef(relation.from)
  const target = nodeIdForRef(relation.to)
  if (!nodeIds.has(source) || !nodeIds.has(target)) return null
  const layer = relationLayerForType(relation.relationType, relationCatalog)
  return {
    id: relation.id,
    source,
    target,
    label: relation.label ?? relation.relationType,
    type: "smoothstep",
    className: relationModeClassName(relation.relationType, relationCatalog),
    animated: isRuntimeRelationCandidate(relation.relationType, relationCatalog),
    style: relationModeStyle(relation.relationType, relationCatalog),
    data: {
      relationType: relation.relationType,
      layer,
      runtimeCandidate: isRuntimeRelationCandidate(relation.relationType, relationCatalog),
    },
  }
}

export function buildEnterpriseTopologyCanvasModel(
  topology?: EnterpriseTopology | null,
  validationIssues: EnterpriseTopologyValidationIssue[] = [],
  relationCatalog?: TopologyRelationTemplateCatalog | null,
): EnterpriseTopologyCanvasModel {
  if (!topology) {
    const sample = sampleModel()
    return { ...sample, validationIssues }
  }

  const nodes: Array<Node<EnterpriseTopologyCanvasNodeData>> = []
  let index = 0
  for (const orgUnit of topology.orgUnits) {
    if (hiddenFromBeginnerCanvas(orgUnit)) continue
    nodes.push(flowNode(index++, { entityType: "org_unit", id: orgUnit.id }, "org_unit", displayName(orgUnit), orgUnit.responsibilityArea ?? "Org unit", orgUnit.status))
  }
  for (const position of topology.positions) {
    nodes.push(flowNode(index++, { entityType: "position", id: position.id }, "position", displayName(position), position.orgUnitId, position.status))
  }
  for (const person of topology.persons) {
    nodes.push(flowNode(index++, { entityType: "person", id: person.id }, "person", displayName(person), person.availability ?? "unknown", person.status))
  }
  for (const team of topology.teams) {
    nodes.push(flowNode(index++, { entityType: "team", id: team.id }, "group", displayName(team), team.purpose ?? "Team", team.status))
  }
  for (const node of topology.nodes) {
    nodes.push(flowNode(index++, { entityType: "node", id: node.id }, canvasKindForNode(node), displayName(node), node.description ?? node.nodeType, node.status))
  }
  for (const process of topology.processes) {
    nodes.push(flowNode(index++, { entityType: "process_definition", id: process.id }, "process", displayName(process), `${process.stepNodeIds.length} steps`, process.status))
  }
  for (const system of topology.systems) {
    nodes.push(flowNode(index++, { entityType: "enterprise_system", id: system.id }, "data", displayName(system), system.systemType, system.status))
  }
  for (const tool of topology.tools) {
    nodes.push(flowNode(index++, { entityType: "enterprise_tool", id: tool.id }, "tool", displayName(tool), tool.toolType, tool.status))
  }
  for (const rule of topology.authorityRules) {
    if (hiddenFromBeginnerCanvas(rule)) continue
    nodes.push(flowNode(index++, { entityType: "authority_rule", id: rule.id }, "authority", displayName(rule), rule.action, rule.status))
  }
  for (const responsibility of topology.responsibilities) {
    if (hiddenFromBeginnerCanvas(responsibility)) continue
    nodes.push(flowNode(index++, { entityType: "responsibility_matrix_entry", id: responsibility.id }, "responsibility", displayName(responsibility), responsibility.scope.id, responsibility.status))
  }

  const nodeIds = new Set(nodes.map((node) => node.id))
  const edges = topology.relations
    .map((relation) => relationToEdge(relation, nodeIds, relationCatalog))
    .filter((edge): edge is Edge<EnterpriseTopologyRelationEdgeData> => Boolean(edge))

  if (nodes.length === 0) {
    const sample = sampleModel()
    return { ...sample, validationIssues }
  }

  return {
    nodes,
    edges,
    palette: ENTERPRISE_TOPOLOGY_PALETTE,
    validationIssues,
  }
}

export function EnterpriseTopologyCanvasShell({
  model,
  topology,
  selectedNodeId,
  selectedEdgeId,
  onSelectNode,
  onSelectEdge,
  templateCatalog,
  onCreateEntity,
  relationCatalog,
  selectedRelationType = "delegates_to",
  selectedRelationMode = "smart_connect",
  onSelectRelationType,
  onSelectRelationMode,
  relationIssue,
  onCreateRelation,
  compilePreview,
  compilePreviewLoading,
  onApplyQuickFix,
  traceOverlay,
  runTargetNodeId,
  onRunTargetChange,
  onExecutorMappingChange,
  onSelectedRunnableTargetChange,
  runtimeResources,
  workspaceLayer = "build",
  exposureMode = "advanced",
  showSimpleCreatePanel = true,
  gapFindings = [],
  observedEdges = [],
  onRunLayerRequest,
}: {
  model: EnterpriseTopologyCanvasModel
  topology?: EnterpriseTopology | null
  selectedNodeId?: string | null
  selectedEdgeId?: string | null
  onSelectNode?: (nodeId: string | null) => void
  onSelectEdge?: (edgeId: string | null) => void
  templateCatalog?: TopologyTemplateCatalog | null
  onCreateEntity?: (kind: EnterpriseTopologyPaletteKind, templateId?: string) => void
  relationCatalog?: TopologyRelationTemplateCatalog | null
  selectedRelationType?: EnterpriseRelationType
  selectedRelationMode?: TopologyRelationModeId
  onSelectRelationType?: (relationType: EnterpriseRelationType) => void
  onSelectRelationMode?: (relationMode: TopologyRelationModeId) => void
  relationIssue?: EnterpriseRelationModeIssue | null
  onCreateRelation?: (connection: Connection, relationMode: TopologyRelationModeId) => void
  compilePreview?: EnterpriseTopologyGuiDraftCompiledPreviewResponse | null
  compilePreviewLoading?: boolean
  onApplyQuickFix?: (operations: EnterpriseTopologyGuiOperation[]) => void
  traceOverlay?: TopologyRunTraceOverlayInput | null
  runTargetNodeId?: string | null
  onRunTargetChange?: (nodeId: string) => void
  onExecutorMappingChange?: (nodeId: string, mapping: TopologyWorkspaceExecutorMapping) => void
  onSelectedRunnableTargetChange?: (nodeId: string) => void
  runtimeResources?: AgentTopologyProjection | null
  workspaceLayer?: TopologyWorkspaceLayer
  exposureMode?: TopologyWorkspaceExposureMode
  showSimpleCreatePanel?: boolean
  gapFindings?: unknown[]
  observedEdges?: EnterpriseTopologyObservedEdgeRecord[]
  onRunLayerRequest?: () => void
}) {
  const { text } = useUiI18n()
  const reactFlowRef = React.useRef<ReactFlowInstance<
    Node<EnterpriseTopologyCanvasNodeData>,
    Edge<EnterpriseTopologyRelationEdgeData>
  > | null>(null)
  const selectedNode = model.nodes.find((node) => node.id === selectedNodeId) ?? model.nodes[0] ?? null
  const selectedData = selectedNode?.data
  const selectedNodeContract = selectedData?.entityType === "node"
    ? topology?.nodes.find((node) => node.id === selectedData.entityId) ?? null
    : null
  const selectedRunnableTargetId = selectedData?.entityType === "node" &&
    (selectedData.kind === "task" || selectedData.kind === "work_node" || selectedData.kind === "approval" || selectedData.kind === "decision" || selectedData.kind === "tool")
    ? selectedData.entityId
    : null
  const overlayState = React.useMemo(() => buildTopologyRunOverlayState(traceOverlay), [traceOverlay])
  const showAdvancedSurface = shouldShowTopologyWorkspaceAdvancedSurface(exposureMode)
  const flowNodes = React.useMemo(
    () => model.nodes.map((node) => ({
      ...node,
      selected: node.id === selectedNodeId,
      data: {
        ...node.data,
        traceState: overlayState.nodeStates[node.id],
        runTarget: node.data.entityType === "node" && node.data.entityId === runTargetNodeId,
      },
    })),
    [model.nodes, overlayState.nodeStates, runTargetNodeId, selectedNodeId],
  )
  const flowEdges = React.useMemo(
    () => model.edges.map((edge) => {
      const traceState = overlayState.edgeStates[`${edge.source}->${edge.target}`]
      return {
        ...edge,
        selected: edge.id === selectedEdgeId,
        className: [edge.className, traceState === "failed_path" ? "enterprise-topology-trace-edge-failed" : traceState === "delegation_path" ? "enterprise-topology-trace-edge" : undefined]
          .filter(Boolean)
          .join(" "),
        style: {
          ...edge.style,
          ...(traceState === "failed_path"
            ? { stroke: "#dc2626", strokeWidth: 3 }
            : traceState === "delegation_path"
              ? { stroke: "#0284c7", strokeWidth: 2.5 }
              : {}),
        },
      }
    }),
    [model.edges, overlayState.edgeStates, selectedEdgeId],
  )

  const moveViewportToNode = React.useCallback((node: Node<EnterpriseTopologyCanvasNodeData>) => {
    reactFlowRef.current?.setCenter(node.position.x + 110, node.position.y + 42, {
      zoom: 0.95,
      duration: 240,
    })
  }, [])

  const handleSelectTarget = React.useCallback((targetId: string) => {
    const node = model.nodes.find((item) => item.id === targetId)
    if (node) {
      onSelectNode?.(node.id)
      onSelectEdge?.(null)
      moveViewportToNode(node)
      return
    }

    const edge = model.edges.find((item) => item.id === targetId)
    if (!edge) return
    onSelectEdge?.(edge.id)
    onSelectNode?.(null)
    const source = model.nodes.find((item) => item.id === edge.source)
    const target = model.nodes.find((item) => item.id === edge.target)
    if (!source || !target) return
    reactFlowRef.current?.setCenter(
      (source.position.x + target.position.x) / 2 + 110,
      (source.position.y + target.position.y) / 2 + 42,
      { zoom: 0.9, duration: 240 },
    )
  }, [model.edges, model.nodes, moveViewportToNode, onSelectEdge, onSelectNode])

  React.useEffect(() => {
    if (selectedRunnableTargetId) onSelectedRunnableTargetChange?.(selectedRunnableTargetId)
  }, [onSelectedRunnableTargetChange, selectedRunnableTargetId])

  return (
    <div
      className={`grid min-h-0 flex-1 gap-4 p-4 ${
        showAdvancedSurface || showSimpleCreatePanel
          ? "lg:grid-cols-[220px_minmax(0,1fr)_320px]"
          : "lg:grid-cols-[minmax(0,1fr)_320px]"
      }`}
      data-testid="enterprise-topology-canvas"
      data-exposure-mode={exposureMode}
    >
      {showAdvancedSurface ? (
        <EnterpriseTopologyPalette
          items={model.palette}
          templateCatalog={templateCatalog}
          onCreateEntity={onCreateEntity}
        />
      ) : showSimpleCreatePanel ? (
        <TopologyWorkspaceSimpleCreatePanel
          onAddExecutor={() => onCreateEntity?.("work_node")}
          onAddSection={() => onCreateEntity?.("group")}
        />
      ) : null}

      <section className="flex min-h-[560px] flex-col overflow-hidden rounded-lg border border-stone-200 bg-white">
        {showAdvancedSurface ? (
          <RelationModeToolbar
            catalog={relationCatalog}
            selectedRelationType={selectedRelationType}
            selectedRelationMode={selectedRelationMode}
            onSelectRelationType={onSelectRelationType}
            onSelectRelationMode={onSelectRelationMode}
            issue={relationIssue}
          />
        ) : (
          <div
            className="border-b border-stone-200 bg-stone-50 px-4 py-2 text-xs font-medium text-stone-600"
            data-testid="topology-simple-relation-policy"
          >
            {text("연결 의미는 노비가 자동으로 추천합니다.", "Nobie recommends connection meaning automatically.")}
          </div>
        )}
        <div className="min-h-0 flex-1">
          <ReactFlow
            nodes={flowNodes}
            edges={flowEdges}
            nodeTypes={nodeTypes}
            onInit={(instance) => {
              reactFlowRef.current = instance
            }}
            onConnect={(connection) => onCreateRelation?.(connection, selectedRelationMode)}
            onNodeClick={(_, node) => {
              onSelectNode?.(node.id)
              onSelectEdge?.(null)
            }}
            onEdgeClick={(_, edge) => {
              onSelectEdge?.(edge.id)
              onSelectNode?.(null)
            }}
            onPaneClick={() => {
              onSelectNode?.(null)
              onSelectEdge?.(null)
            }}
            fitView
            minZoom={0.25}
            maxZoom={1.4}
            nodesDraggable={false}
            nodesConnectable={Boolean(onCreateRelation)}
            elementsSelectable
          >
            <Background color="#d6d3d1" gap={22} />
            <Controls />
            <MiniMap pannable zoomable nodeColor={minimapColor} />
          </ReactFlow>
        </div>
      </section>

      <aside className="grid min-h-0 gap-4 overflow-y-auto">
        <div data-testid="enterprise-topology-validation">
          <TopologyValidationAssistant
            issues={model.validationIssues}
            topology={topology}
            runtimeOverlay={traceOverlay}
            gapFindings={gapFindings}
            onSelectTarget={handleSelectTarget}
            onApplyQuickFix={onApplyQuickFix}
          />
        </div>

        {workspaceLayer === "improve" ? (
          <TopologyImprovePanel
            topology={topology}
            traceOverlay={traceOverlay}
            gapFindings={gapFindings}
            observedEdges={observedEdges}
            onSelectTarget={handleSelectTarget}
            onApplyQuickFix={onApplyQuickFix}
            onRunLayerRequest={onRunLayerRequest}
          />
        ) : null}

        {showAdvancedSurface ? (
          <section className="rounded-lg border border-stone-200 bg-white p-4" data-testid="topology-run-target-panel">
            <div className="text-sm font-semibold text-stone-950">
              {text("Run Target", "Run Target")}
            </div>
            <div className="mt-1 text-xs text-stone-500">
              {selectedData?.entityType === "node"
                ? selectedData.entityId
                : text("업무 node를 선택합니다.", "Select a work node.")}
            </div>
            <button
              type="button"
              disabled={selectedData?.entityType !== "node"}
              onClick={() => {
                if (selectedData?.entityType === "node") onRunTargetChange?.(selectedData.entityId)
              }}
              className="mt-3 h-9 w-full rounded-lg bg-stone-900 px-3 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
              data-testid="topology-run-target-select"
            >
              {text("선택 node를 Entry로 지정", "Set selected node as entry")}
            </button>
          </section>
        ) : null}

        <TopologyRunTraceOverlay overlay={traceOverlay} />

        {showAdvancedSurface ? (
          <TopologyCompilePreview preview={compilePreview} loading={compilePreviewLoading} />
        ) : null}

        <EnterpriseTopologyInspector
          selectedData={selectedData}
          templateCatalog={templateCatalog}
          selectedNodeContract={selectedNodeContract}
          runtimeResources={runtimeResources}
          onExecutorMappingChange={onExecutorMappingChange}
        />
      </aside>
    </div>
  )
}

export function EnterpriseTopologyCanvas({
  topology,
  validationIssues = [],
  templateCatalog,
  onCreateEntity,
  relationCatalog,
  selectedRelationType,
  selectedRelationMode,
  onSelectRelationType,
  onSelectRelationMode,
  relationIssue,
  onCreateRelation,
  compilePreview,
  compilePreviewLoading,
  onApplyQuickFix,
  traceOverlay,
  runTargetNodeId,
  onRunTargetChange,
  onExecutorMappingChange,
  onSelectedRunnableTargetChange,
  runtimeResources,
  workspaceLayer,
  exposureMode,
  showSimpleCreatePanel,
  gapFindings,
  observedEdges,
  onRunLayerRequest,
}: {
  topology?: EnterpriseTopology | null
  validationIssues?: EnterpriseTopologyValidationIssue[]
  templateCatalog?: TopologyTemplateCatalog | null
  onCreateEntity?: (kind: EnterpriseTopologyPaletteKind, templateId?: string) => void
  relationCatalog?: TopologyRelationTemplateCatalog | null
  selectedRelationType?: EnterpriseRelationType
  selectedRelationMode?: TopologyRelationModeId
  onSelectRelationType?: (relationType: EnterpriseRelationType) => void
  onSelectRelationMode?: (relationMode: TopologyRelationModeId) => void
  relationIssue?: EnterpriseRelationModeIssue | null
  onCreateRelation?: (connection: Connection, relationMode: TopologyRelationModeId) => void
  compilePreview?: EnterpriseTopologyGuiDraftCompiledPreviewResponse | null
  compilePreviewLoading?: boolean
  onApplyQuickFix?: (operations: EnterpriseTopologyGuiOperation[]) => void
  traceOverlay?: TopologyRunTraceOverlayInput | null
  runTargetNodeId?: string | null
  onRunTargetChange?: (nodeId: string) => void
  onExecutorMappingChange?: (nodeId: string, mapping: TopologyWorkspaceExecutorMapping) => void
  onSelectedRunnableTargetChange?: (nodeId: string) => void
  runtimeResources?: AgentTopologyProjection | null
  workspaceLayer?: TopologyWorkspaceLayer
  exposureMode?: TopologyWorkspaceExposureMode
  showSimpleCreatePanel?: boolean
  gapFindings?: unknown[]
  observedEdges?: EnterpriseTopologyObservedEdgeRecord[]
  onRunLayerRequest?: () => void
}) {
  const model = React.useMemo(
    () => buildEnterpriseTopologyCanvasModel(topology, validationIssues, relationCatalog),
    [topology, validationIssues, relationCatalog],
  )
  const [selectedNodeId, setSelectedNodeId] = React.useState<string | null>(model.nodes[0]?.id ?? null)
  const [selectedEdgeId, setSelectedEdgeId] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (selectedNodeId && model.nodes.some((node) => node.id === selectedNodeId)) return
    setSelectedNodeId(model.nodes[0]?.id ?? null)
    setSelectedEdgeId(null)
  }, [model.nodes, selectedNodeId])

  return (
    <ReactFlowProvider>
      <EnterpriseTopologyCanvasShell
        model={model}
        topology={topology}
        selectedNodeId={selectedNodeId}
        selectedEdgeId={selectedEdgeId}
        onSelectNode={setSelectedNodeId}
        onSelectEdge={setSelectedEdgeId}
        templateCatalog={templateCatalog}
        onCreateEntity={onCreateEntity}
        relationCatalog={relationCatalog}
        selectedRelationType={selectedRelationType}
        selectedRelationMode={selectedRelationMode}
        onSelectRelationType={onSelectRelationType}
        onSelectRelationMode={onSelectRelationMode}
        relationIssue={relationIssue}
        onCreateRelation={onCreateRelation}
        compilePreview={compilePreview}
        compilePreviewLoading={compilePreviewLoading}
        onApplyQuickFix={onApplyQuickFix}
        traceOverlay={traceOverlay}
        runTargetNodeId={runTargetNodeId}
        onRunTargetChange={onRunTargetChange}
        onExecutorMappingChange={onExecutorMappingChange}
        onSelectedRunnableTargetChange={onSelectedRunnableTargetChange}
        runtimeResources={runtimeResources}
        workspaceLayer={workspaceLayer}
        exposureMode={exposureMode}
        showSimpleCreatePanel={showSimpleCreatePanel}
        gapFindings={gapFindings}
        observedEdges={observedEdges}
        onRunLayerRequest={onRunLayerRequest}
      />
    </ReactFlowProvider>
  )
}
