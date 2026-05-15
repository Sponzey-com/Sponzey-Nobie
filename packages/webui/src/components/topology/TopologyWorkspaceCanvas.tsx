import { type Edge, ReactFlowProvider, type Node } from "@xyflow/react"
import * as React from "react"
import type {
  EnterpriseRelationType,
  EnterpriseTopology,
  EnterpriseTopologyValidationIssue,
} from "../../contracts/enterprise-topology"
import type { AgentTopologyNode, AgentTopologyProjection } from "../../contracts/topology"
import type { TopologyRelationTemplateCatalog } from "../../contracts/relation-templates"
import type { TopologyTemplateCatalog } from "../../contracts/topology-templates"
import type {
  AgentTeamImportMode,
  AgentTeamTopologyImportPreviewResponse,
  EnterpriseTopologyGuiDraftCompiledPreviewResponse,
  EnterpriseTopologyGuiOperation,
  EnterpriseTopologyRunTraceProjection,
} from "../../lib/enterprise-topology-operations"
import {
  buildTopologyWorkspaceModel,
  buildTopologyWorkspaceSnapshot,
  type TopologyWorkspaceLayer,
  type TopologyWorkspaceModel,
} from "../../lib/topology-workspace"
import {
  shouldShowTopologyWorkspaceAdvancedSurface,
  type TopologyWorkspaceExposureMode,
} from "../../lib/topology-workspace-copy"
import { useUiI18n } from "../../lib/ui-i18n"
import {
  EnterpriseTopologyCanvasShell,
  buildEnterpriseTopologyCanvasModel,
  type EnterpriseTopologyCanvasModel,
  type EnterpriseTopologyCanvasNodeData,
  type EnterpriseTopologyRelationEdgeData,
} from "./EnterpriseTopologyCanvas"
import {
  ExecutorGraphCanvas,
  type ExecutorFlowEdgeStatus,
} from "./ExecutorGraphCanvas"
import { buildExecutorGraphCanvasModel } from "../../lib/executor-graph-viewmodel"
import { ExecutorInspector } from "./ExecutorInspector"
import type { ExecutorCardExecutionStatus } from "./ExecutorCardNode"
import { ExecutorRunResultPanel } from "./ExecutorRunResultPanel"
import type { EnterpriseTopologyPaletteKind } from "./EnterpriseTopologyPalette"
import type { TopologyWorkspaceExecutorMapping } from "./TopologyWorkspaceInspector"
import type { ExecutorDraft } from "../../lib/executor-graph"
import type { EnterpriseRelationModeIssue, TopologyRelationModeId } from "./RelationModeToolbar"
import {
  buildTopologyRunOverlayState,
  topologyTraceEdgeKey,
  type TopologyRunTraceOverlayInput,
} from "./TopologyRunTraceOverlay"

export type TopologyWorkspaceCanvasNodeSource = "declared" | "runtime_resource"
export type TopologyWorkspaceCanvasEdgeSource = "declared" | "trace" | "observed" | "runtime_resource"

export interface TopologyWorkspaceCanvasNodeData extends Record<string, unknown> {
  source: TopologyWorkspaceCanvasNodeSource
  label: string
  detail: string
  iconLabel: string
  entityId: string
  resourceKind: string
  runtimeStatus: string
  healthSummary: string
  capabilitySummary: string
  modelSummary: string
  tooltip: string
  muted: boolean
  strokePattern: "solid" | "dashed"
}

export interface TopologyWorkspaceCanvasEdgeData extends Record<string, unknown> {
  source: TopologyWorkspaceCanvasEdgeSource
  label: string
  strokePattern: "solid" | "dashed"
  tone: "neutral" | "runtime" | "trace" | "failed" | "observed" | "resource"
}

export interface TopologyWorkspaceCanvasLegendItem {
  id: string
  labelKo: string
  labelEn: string
  descriptionKo: string
  descriptionEn: string
  iconLabel: string
  tone: "neutral" | "runtime" | "trace" | "failed" | "observed" | "resource"
  strokePattern: "solid" | "dashed"
}

export interface TopologyWorkspaceCanvasLayerModel {
  layer: TopologyWorkspaceLayer
  declaredModel: EnterpriseTopologyCanvasModel
  visibleDeclaredNodes: Array<Node<EnterpriseTopologyCanvasNodeData>>
  visibleDeclaredEdges: Array<Edge<EnterpriseTopologyRelationEdgeData>>
  resourceNodes: Array<Node<TopologyWorkspaceCanvasNodeData>>
  resourceEdges: Array<Edge<TopologyWorkspaceCanvasEdgeData>>
  observedEdges: Array<Edge<TopologyWorkspaceCanvasEdgeData>>
  legend: TopologyWorkspaceCanvasLegendItem[]
}

export interface TopologyWorkspaceCanvasProps {
  workspaceModel?: TopologyWorkspaceModel
  topologyId?: string
  selectedLayer?: TopologyWorkspaceLayer
  exposureMode?: TopologyWorkspaceExposureMode
  topology?: EnterpriseTopology | null
  runtimeResources?: AgentTopologyProjection | null
  validationIssues?: EnterpriseTopologyValidationIssue[]
  templateCatalog?: TopologyTemplateCatalog | null
  onCreateEntity?: (kind: EnterpriseTopologyPaletteKind, templateId?: string) => void
  relationCatalog?: TopologyRelationTemplateCatalog | null
  selectedRelationType?: EnterpriseRelationType
  selectedRelationMode?: TopologyRelationModeId
  onSelectRelationType?: (relationType: EnterpriseRelationType) => void
  onSelectRelationMode?: (relationMode: TopologyRelationModeId) => void
  relationIssue?: EnterpriseRelationModeIssue | null
  onCreateRelation?: Parameters<typeof EnterpriseTopologyCanvasShell>[0]["onCreateRelation"]
  compilePreview?: EnterpriseTopologyGuiDraftCompiledPreviewResponse | null
  compilePreviewLoading?: boolean
  onApplyQuickFix?: (operations: EnterpriseTopologyGuiOperation[]) => void
  traceOverlay?: TopologyRunTraceOverlayInput | null
  runTargetNodeId?: string | null
  onRunTargetChange?: (nodeId: string) => void
  onExecutorMappingChange?: (nodeId: string, mapping: TopologyWorkspaceExecutorMapping) => void
  onExecutorDraftChange?: (executor: ExecutorDraft) => void
  onExecutorUnderstandingConfirm?: (executor: ExecutorDraft) => void
  onExecutorConnect?: (sourceExecutorId: string, targetExecutorId: string) => void
  onExecutorMove?: (executorId: string, position: { x: number; y: number }) => void
  activeExecutorIds?: string[]
  activeEdgeIds?: string[]
  executorStatuses?: Record<string, ExecutorCardExecutionStatus>
  edgeStatuses?: Record<string, ExecutorFlowEdgeStatus>
  selectedExecutorId?: string | null
  onSelectedExecutorChange?: (executorId: string | null) => void
  onSelectedRunnableTargetChange?: (nodeId: string) => void
  onRunLayerRequest?: () => void
  simpleCreatePanel?: React.ReactNode
  showSimpleCreatePanel?: boolean
  agentTeamPreview?: AgentTeamTopologyImportPreviewResponse | null
  teamImportMode?: AgentTeamImportMode
  onPreviewAgentTeamImport?: () => void
  onApplyAgentTeamImport?: () => void
  onTeamImportModeChange?: (mode: AgentTeamImportMode) => void
}

export function buildTopologyWorkspaceCanvasModel(input: {
  workspaceModel: TopologyWorkspaceModel
  validationIssues?: EnterpriseTopologyValidationIssue[]
  relationCatalog?: TopologyRelationTemplateCatalog | null
  traceOverlay?: TopologyRunTraceOverlayInput | null
}): TopologyWorkspaceCanvasLayerModel {
  const { workspaceModel, relationCatalog, traceOverlay } = input
  const declaredModel = buildEnterpriseTopologyCanvasModel(
    workspaceModel.topology,
    input.validationIssues ?? [],
    relationCatalog,
  )
  const declaredNodes = tagDeclaredNodes(declaredModel.nodes)
  const declaredEdges = tagDeclaredEdges(declaredModel.edges)
  const resourceNodes = buildResourceNodes(workspaceModel)
  const resourceEdges = buildResourceEdges(workspaceModel)
  const observedEdges = buildObservedEdges(workspaceModel, declaredNodes)

  if (workspaceModel.selectedLayer === "resources") {
    return {
      layer: workspaceModel.selectedLayer,
      declaredModel,
      visibleDeclaredNodes: [],
      visibleDeclaredEdges: [],
      resourceNodes,
      resourceEdges,
      observedEdges: [],
      legend: topologyWorkspaceCanvasLegend("resources"),
    }
  }

  if (workspaceModel.selectedLayer === "run") {
    return {
      layer: workspaceModel.selectedLayer,
      declaredModel: {
        ...declaredModel,
        nodes: declaredNodes,
        edges: declaredEdges.filter((edge) => edge.data?.runtimeCandidate === true),
      },
      visibleDeclaredNodes: declaredNodes,
      visibleDeclaredEdges: declaredEdges.filter((edge) => edge.data?.runtimeCandidate === true),
      resourceNodes: [],
      resourceEdges: [],
      observedEdges: [],
      legend: topologyWorkspaceCanvasLegend("run"),
    }
  }

  if (workspaceModel.selectedLayer === "trace") {
    const traced = applyTraceStyles(declaredEdges, traceOverlay)
    return {
      layer: workspaceModel.selectedLayer,
      declaredModel: {
        ...declaredModel,
        nodes: declaredNodes,
        edges: traced,
      },
      visibleDeclaredNodes: declaredNodes,
      visibleDeclaredEdges: traced,
      resourceNodes: [],
      resourceEdges: [],
      observedEdges: [],
      legend: topologyWorkspaceCanvasLegend("trace"),
    }
  }

  if (workspaceModel.selectedLayer === "improve") {
    const improveOverlayEdges = buildImproveOverlayEdges(workspaceModel, declaredNodes)
    const improveEdges = [...declaredEdges, ...improveOverlayEdges]
    return {
      layer: workspaceModel.selectedLayer,
      declaredModel: {
        ...declaredModel,
        nodes: declaredNodes,
        edges: improveEdges,
      },
      visibleDeclaredNodes: declaredNodes,
      visibleDeclaredEdges: declaredEdges,
      resourceNodes: [],
      resourceEdges: [],
      observedEdges,
      legend: topologyWorkspaceCanvasLegend("improve"),
    }
  }

  return {
    layer: workspaceModel.selectedLayer,
    declaredModel: {
      ...declaredModel,
      nodes: declaredNodes,
      edges: declaredEdges,
    },
    visibleDeclaredNodes: declaredNodes,
    visibleDeclaredEdges: declaredEdges,
    resourceNodes: [],
    resourceEdges: [],
    observedEdges: [],
    legend: topologyWorkspaceCanvasLegend("build"),
  }
}

function buildTopologyWorkspaceTraceProjection(
  overlay?: TopologyRunTraceOverlayInput | null,
): EnterpriseTopologyRunTraceProjection | null {
  if (!overlay?.run) return null
  return {
    run: overlay.run,
    nodeRuns: [],
    workOrders: [],
    resultReports: [],
    failureReports: overlay.failureReports,
    traceEvents: overlay.traceEvents,
    toolCalls: overlay.toolCalls,
    observedEdges: overlay.observedEdges ?? [],
    gapFindings: overlay.gapFindings ?? [],
  }
}

export function topologyWorkspaceCanvasLegend(layer: TopologyWorkspaceLayer): TopologyWorkspaceCanvasLegendItem[] {
  if (layer === "resources") {
    return [
      legendItem("resource-node", "실행 리소스", "Runtime resource", "업무 단계에 연결할 Agent 또는 Team.", "Agent or Team that can execute a work step.", "RS", "resource", "dashed"),
      legendItem("resource-edge", "리소스 연결", "Resource link", "기존 runtime resource 관계.", "Existing runtime resource relation.", "RL", "resource", "dashed"),
    ]
  }
  if (layer === "trace") {
    return [
      legendItem("trace-path", "실행 경로", "Trace path", "실제로 지나간 업무 경로.", "Actual path taken by a run.", "TR", "trace", "solid"),
      legendItem("trace-failed", "실패 위치", "Failure", "실패가 확정된 업무 단계.", "Confirmed failed work step.", "FL", "failed", "solid"),
      legendItem("trace-candidate", "실패 후보", "Failure candidate", "실패 가능성이 표시된 업무 단계.", "Work step marked as a failure candidate.", "FC", "failed", "dashed"),
    ]
  }
  if (layer === "improve") {
    return [
      legendItem("declared", "설계된 연결", "Declared connection", "사용자가 설계한 연결.", "Connection designed by the user.", "DC", "neutral", "solid"),
      legendItem("observed", "실제 실행 연결", "Observed connection", "trace에서 관찰된 연결 후보.", "Connection observed from traces.", "OB", "observed", "dashed"),
    ]
  }
  if (layer === "run") {
    return [
      legendItem("entry", "실행 시작", "Run entry", "실행을 시작할 업무 단계.", "Work step where a run starts.", "EN", "runtime", "solid"),
      legendItem("runtime-edge", "실행 가능한 연결", "Runnable connection", "실행 경로로 사용할 수 있는 연결.", "Connection usable as a runtime path.", "RN", "runtime", "solid"),
    ]
  }
  return [
    legendItem("declared-node", "업무 항목", "Declared item", "사용자가 설계한 업무 단계와 리소스.", "Work steps and resources designed by the user.", "DN", "neutral", "solid"),
    legendItem("declared-edge", "연결", "Connection", "사용자가 만든 연결.", "Connection created by the user.", "CE", "neutral", "solid"),
  ]
}

export function TopologyWorkspaceCanvas({
  workspaceModel,
  topologyId,
  selectedLayer = "build",
  exposureMode = "simple",
  topology,
  runtimeResources,
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
  onExecutorDraftChange,
  onExecutorUnderstandingConfirm,
  onExecutorConnect,
  onExecutorMove,
  activeExecutorIds,
  activeEdgeIds,
  executorStatuses,
  edgeStatuses,
  selectedExecutorId,
  onSelectedExecutorChange,
  onSelectedRunnableTargetChange,
  onRunLayerRequest,
  simpleCreatePanel,
  showSimpleCreatePanel,
  agentTeamPreview,
  teamImportMode = "team",
  onPreviewAgentTeamImport,
  onApplyAgentTeamImport,
  onTeamImportModeChange,
}: TopologyWorkspaceCanvasProps) {
  const latestTrace = React.useMemo(() => buildTopologyWorkspaceTraceProjection(traceOverlay), [traceOverlay])
  const effectiveExposureMode: TopologyWorkspaceExposureMode = shouldShowTopologyWorkspaceAdvancedSurface(exposureMode)
    ? exposureMode
    : "simple"
  const effectiveModel = React.useMemo(() => workspaceModel ?? buildTopologyWorkspaceModel({
    snapshot: buildTopologyWorkspaceSnapshot({
      topology: topology ?? null,
      runtimeResources: runtimeResources ?? null,
      latestTrace,
      gapFindings: traceOverlay?.gapFindings ?? latestTrace?.gapFindings ?? [],
    }),
    selectedLayer,
  }), [latestTrace, runtimeResources, selectedLayer, topology, traceOverlay?.gapFindings, workspaceModel])
  const layerModel = React.useMemo(() => buildTopologyWorkspaceCanvasModel({
    workspaceModel: effectiveModel,
    validationIssues,
    relationCatalog,
    traceOverlay,
  }), [effectiveModel, validationIssues, relationCatalog, traceOverlay])
  const showSimpleExecutorGraph = effectiveExposureMode === "simple" && effectiveModel.selectedLayer !== "resources"
  const effectiveTopologyId = topologyId ?? effectiveModel.topologyId
  const simpleExecutorModel = React.useMemo(
    () => showSimpleExecutorGraph ? buildExecutorGraphCanvasModel({ topology }) : null,
    [showSimpleExecutorGraph, topology],
  )
  const [internalSelectedExecutorId, setInternalSelectedExecutorId] = React.useState<string | null>(null)
  const hasControlledSelection = selectedExecutorId !== undefined
  const selectedExecutorState = hasControlledSelection ? selectedExecutorId : internalSelectedExecutorId
  const setSelectedExecutorState = React.useCallback((executorId: string | null) => {
    setInternalSelectedExecutorId(executorId)
    onSelectedExecutorChange?.(executorId)
  }, [onSelectedExecutorChange])
  React.useEffect(() => {
    if (!showSimpleExecutorGraph) return
    const currentExists = simpleExecutorModel?.graph.executors.some((executor) => executor.id === selectedExecutorState) ?? false
    if (currentExists) return
    setSelectedExecutorState(simpleExecutorModel?.graph.executors[0]?.id ?? null)
  }, [selectedExecutorState, setSelectedExecutorState, showSimpleExecutorGraph, simpleExecutorModel])
  const effectiveSelectedExecutorId = selectedExecutorState ?? simpleExecutorModel?.graph.executors[0]?.id ?? null
  const selectedExecutor = simpleExecutorModel?.graph.executors.find((executor) => executor.id === effectiveSelectedExecutorId) ?? null
  if (showSimpleExecutorGraph) {
    return (
      <section
        className="grid h-full min-h-0 flex-1 grid-rows-[minmax(220px,1fr)_auto] gap-3 overflow-y-auto overscroll-contain scroll-pb-4 bg-stone-100 p-4 md:grid-cols-[minmax(0,1fr)_340px] md:grid-rows-1 md:overflow-hidden"
        data-testid="topology-workspace-simple-executor-layout"
      >
        <ExecutorGraphCanvas
          topology={topology}
          graph={simpleExecutorModel?.graph ?? null}
          selectedLayer={effectiveModel.selectedLayer}
          selectedExecutorId={effectiveSelectedExecutorId}
          activeExecutorIds={activeExecutorIds}
          activeEdgeIds={activeEdgeIds}
          executorStatuses={executorStatuses}
          edgeStatuses={edgeStatuses}
          onSelectExecutor={setSelectedExecutorState}
          onConnectExecutors={onExecutorConnect}
          onMoveExecutor={onExecutorMove}
        />
        <aside className="grid min-h-0 max-h-full content-start gap-4 overflow-y-auto overscroll-contain scroll-pb-4 pb-4 pr-1 md:h-full md:pb-0" data-testid="topology-workspace-simple-sidebar">
          {traceOverlay?.run ? (
            <ExecutorRunResultPanel
              topology={topology}
              graph={simpleExecutorModel?.graph ?? null}
              overlay={traceOverlay}
              onTraceLayerRequest={onRunLayerRequest}
            />
          ) : null}
          {simpleCreatePanel ? (
            <div data-testid="topology-workspace-simple-node-card">
              {simpleCreatePanel}
            </div>
          ) : (
            <ExecutorInspector
              executor={selectedExecutor}
              graph={simpleExecutorModel?.graph ?? null}
              workspaceId={effectiveModel.topologyId}
              topologyId={effectiveTopologyId}
              onExecutorChange={onExecutorDraftChange}
              onConfirmUnderstanding={onExecutorUnderstandingConfirm}
            />
          )}
        </aside>
      </section>
    )
  }

  return (
    <section
      className="min-h-0 flex-1"
      data-testid="topology-workspace-canvas"
      data-layer={effectiveModel.selectedLayer}
    >
      <TopologyWorkspaceCanvasLegend items={layerModel.legend} />
      {effectiveModel.selectedLayer === "resources" ? (
        <TopologyWorkspaceResourceLayer
          model={layerModel}
          runtimeResources={effectiveModel.runtimeResources.projection}
          agentTeamPreview={agentTeamPreview}
          teamImportMode={teamImportMode}
          onPreviewAgentTeamImport={onPreviewAgentTeamImport}
          onApplyAgentTeamImport={onApplyAgentTeamImport}
          onTeamImportModeChange={onTeamImportModeChange}
        />
      ) : (
        <ReactFlowProvider>
          <EnterpriseTopologyCanvasShell
            model={layerModel.declaredModel}
            topology={topology}
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
            runtimeResources={effectiveModel.runtimeResources.projection}
            workspaceLayer={effectiveModel.selectedLayer}
            exposureMode={effectiveExposureMode}
            showSimpleCreatePanel={showSimpleCreatePanel}
            gapFindings={effectiveModel.gaps}
            observedEdges={effectiveModel.observed.latestTrace?.observedEdges ?? []}
            onRunLayerRequest={onRunLayerRequest}
          />
        </ReactFlowProvider>
      )}
    </section>
  )
}

function TopologyWorkspaceCanvasLegend({ items }: { items: TopologyWorkspaceCanvasLegendItem[] }) {
  const { text } = useUiI18n()
  return (
    <div
      className="flex flex-wrap items-center gap-2 border-b border-stone-200 bg-white px-4 py-2"
      data-testid="topology-workspace-canvas-legend"
    >
      {items.map((item) => (
        <span
          key={item.id}
          className="inline-flex items-center gap-2 rounded-full border border-stone-200 bg-stone-50 px-2.5 py-1 text-[11px] font-semibold text-stone-700"
          data-testid={`topology-workspace-legend-${item.id}`}
          title={text(item.descriptionKo, item.descriptionEn)}
        >
          <span className={`h-2.5 w-5 rounded-full ${legendToneClassName(item.tone)} ${item.strokePattern === "dashed" ? "border border-dashed border-current bg-transparent" : ""}`} />
          {text(item.labelKo, item.labelEn)}
        </span>
      ))}
    </div>
  )
}

function TopologyWorkspaceResourceLayer({
  model,
  runtimeResources,
  agentTeamPreview,
  teamImportMode = "team",
  onPreviewAgentTeamImport,
  onApplyAgentTeamImport,
  onTeamImportModeChange,
}: {
  model: TopologyWorkspaceCanvasLayerModel
  runtimeResources?: AgentTopologyProjection | null
  agentTeamPreview?: AgentTeamTopologyImportPreviewResponse | null
  teamImportMode?: AgentTeamImportMode
  onPreviewAgentTeamImport?: () => void
  onApplyAgentTeamImport?: () => void
  onTeamImportModeChange?: (mode: AgentTeamImportMode) => void
}) {
  const { text } = useUiI18n()
  return (
    <div
      className="grid min-h-[560px] gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_320px]"
      data-testid="topology-workspace-resources-layer"
    >
      <section className="rounded-lg border border-stone-200 bg-white p-4">
        <div className="text-sm font-semibold text-stone-950">
          {text("리소스", "Resources")}
        </div>
        <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {model.resourceNodes.map((node) => (
            <div
              key={node.id}
              className={topologyWorkspaceResourceNodeClassName(node.data.resourceKind)}
              data-testid="topology-workspace-resource-node"
              data-source={node.data.source}
              data-resource-kind={node.data.resourceKind}
              title={node.data.tooltip}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="text-[11px] font-semibold uppercase text-stone-500">{node.data.iconLabel}</div>
                <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-stone-600">
                  {node.data.runtimeStatus}
                </span>
              </div>
              <div className="mt-1 font-semibold text-stone-950">{node.data.label}</div>
              <div className="mt-1 text-xs text-stone-500">{node.data.detail}</div>
              <dl className="mt-2 grid gap-1 text-[11px] leading-4 text-stone-600">
                <div className="flex gap-1.5">
                  <dt className="shrink-0 font-semibold text-stone-500">{text("상태", "Health")}</dt>
                  <dd className="min-w-0 truncate">{node.data.healthSummary}</dd>
                </div>
                <div className="flex gap-1.5">
                  <dt className="shrink-0 font-semibold text-stone-500">{text("권한", "Capability")}</dt>
                  <dd className="min-w-0 truncate">{node.data.capabilitySummary}</dd>
                </div>
                <div className="flex gap-1.5">
                  <dt className="shrink-0 font-semibold text-stone-500">{text("모델", "Model")}</dt>
                  <dd className="min-w-0 truncate">{node.data.modelSummary}</dd>
                </div>
              </dl>
            </div>
          ))}
          {model.resourceNodes.length === 0 ? (
            <div className="rounded-lg border border-dashed border-stone-200 bg-stone-50 px-3 py-6 text-sm text-stone-500">
              {text("아직 연결된 실행 리소스가 없습니다.", "No runtime resources are connected yet.")}
            </div>
          ) : null}
        </div>
      </section>
      <aside className="rounded-lg border border-stone-200 bg-white p-4 text-xs text-stone-600">
        <div className="text-sm font-semibold text-stone-950">
          {text("Resource projection", "Resource projection")}
        </div>
        <div className="mt-2">
          {model.resourceNodes.length} {text("nodes", "nodes")} / {model.resourceEdges.length} {text("edges", "edges")}
        </div>
        <div className="mt-3 rounded-md border border-stone-200 bg-stone-50 px-2.5 py-2 leading-5">
          {text(
            "Agent/Team hierarchy는 참고용 projection입니다. Enterprise relation으로 자동 변환하지 않고, 선택한 업무 node의 실행자로만 연결합니다.",
            "Agent/Team hierarchy is a read-only projection. It is not auto-converted into enterprise relations and is linked only as a node executor.",
          )}
        </div>
        <section className="mt-4 rounded-md border border-stone-200 bg-white p-3" data-testid="topology-workspace-resource-import-action">
          <div className="text-xs font-semibold text-stone-950">
            {text("Agent/Team 가져오기", "Agent/Team import")}
          </div>
          <div className="mt-1 text-[11px] leading-4 text-stone-500">
            {text("필요할 때만 기존 Agent/Team을 Enterprise 초안으로 미리보기합니다.", "Preview existing Agent/Team as an Enterprise draft only when needed.")}
          </div>
          <div className="mt-3 grid gap-2">
            <label className="grid gap-1 text-[11px] font-semibold text-stone-500">
              <span>{text("TeamConfig 처리", "TeamConfig handling")}</span>
              <select
                value={teamImportMode}
                onChange={(event) => onTeamImportModeChange?.(event.currentTarget.value as AgentTeamImportMode)}
                className="h-8 rounded-md border border-stone-200 bg-white px-2 text-xs font-semibold text-stone-800"
                data-testid="topology-resource-team-import-mode"
              >
                <option value="team">{text("Team으로 가져오기", "Import as Team")}</option>
                <option value="skip">{text("건너뛰기", "Skip")}</option>
              </select>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={onPreviewAgentTeamImport}
                className="h-8 rounded-md border border-stone-200 bg-white px-2 text-xs font-semibold text-stone-800"
                data-testid="topology-resource-agent-team-preview"
              >
                {text("미리보기", "Preview")}
              </button>
              <button
                type="button"
                onClick={onApplyAgentTeamImport}
                disabled={!agentTeamPreview}
                className="h-8 rounded-md bg-stone-900 px-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                data-testid="topology-resource-agent-team-apply"
              >
                {text("초안 적용", "Apply draft")}
              </button>
            </div>
          </div>
          {agentTeamPreview ? (
            <div className="mt-3 rounded-md border border-stone-200 bg-stone-50 px-2.5 py-2 text-[11px] leading-4 text-stone-600" data-testid="topology-resource-agent-team-preview-summary">
              <div className="font-semibold text-stone-800">
                {agentTeamPreview.metadata.agentCount} Agents / {agentTeamPreview.metadata.teamCount} Teams
              </div>
              <div className="mt-1">
                {agentTeamPreview.metadata.sourceOfTruth} · {agentTeamPreview.metadata.legacySourceRole}
              </div>
            </div>
          ) : null}
        </section>
        {runtimeResources?.generatedAt ? (
          <div className="mt-3 text-[11px] text-stone-400" data-testid="topology-workspace-resource-generated-at">
            {text("projection", "projection")} {new Date(runtimeResources.generatedAt).toISOString()}
          </div>
        ) : null}
      </aside>
    </div>
  )
}

function tagDeclaredNodes(
  nodes: Array<Node<EnterpriseTopologyCanvasNodeData>>,
): Array<Node<EnterpriseTopologyCanvasNodeData>> {
  return nodes.map((node) => ({
    ...node,
    className: [node.className, "topology-workspace-declared-node"].filter(Boolean).join(" "),
    data: {
      ...node.data,
      source: "declared",
      muted: false,
      strokePattern: "solid",
    },
  }))
}

function tagDeclaredEdges(
  edges: Array<Edge<EnterpriseTopologyRelationEdgeData>>,
): Array<Edge<EnterpriseTopologyRelationEdgeData>> {
  return edges.map((edge) => ({
    ...edge,
    className: [edge.className, "topology-workspace-declared-edge"].filter(Boolean).join(" "),
    data: {
      ...(edge.data ?? {}),
      source: "declared",
      strokePattern: "solid",
    },
  }))
}

function applyTraceStyles(
  edges: Array<Edge<EnterpriseTopologyRelationEdgeData>>,
  traceOverlay?: TopologyRunTraceOverlayInput | null,
): Array<Edge<EnterpriseTopologyRelationEdgeData>> {
  const overlay = buildTopologyRunOverlayState(traceOverlay)
  return edges.map((edge) => {
    const traceState = overlay.edgeStates[`${edge.source}->${edge.target}`]
    return {
      ...edge,
      className: [
        edge.className,
        traceState === "failed_path"
          ? "topology-workspace-trace-edge-failed"
          : traceState === "delegation_path"
            ? "topology-workspace-trace-edge"
            : undefined,
      ].filter(Boolean).join(" "),
      style: {
        ...edge.style,
        ...(traceState === "failed_path"
          ? { stroke: "#dc2626", strokeWidth: 3 }
          : traceState === "delegation_path"
            ? { stroke: "#0284c7", strokeWidth: 2.5 }
            : {}),
      },
    }
  })
}

export function topologyWorkspaceResourceNodeClassName(kind: string): string {
  const base = "topology-workspace-resource-node topology-workspace-resource-node--runtime rounded-lg border border-dashed px-3 py-2 text-sm"
  if (kind === "team") return `${base} border-teal-300 bg-teal-50 text-teal-950`
  if (kind === "nobie" || kind === "sub_agent" || kind === "agent") return `${base} border-sky-300 bg-sky-50 text-sky-950`
  return `${base} border-stone-300 bg-stone-50 text-stone-800`
}

function resourceIconLabel(kind: string): string {
  if (kind === "team") return "TM"
  if (kind === "team_lead") return "LD"
  if (kind === "team_role") return "RL"
  if (kind === "nobie") return "NB"
  return "AG"
}

function compactList(values: readonly string[] | undefined, fallback: string, limit = 2): string {
  const compacted = [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))]
  if (compacted.length === 0) return fallback
  const visible = compacted.slice(0, limit).join(", ")
  return compacted.length > limit ? `${visible} +${compacted.length - limit}` : visible
}

function summarizeAgentModel(projection: AgentTopologyProjection, resource: AgentTopologyNode): string {
  const inspector = projection.inspectors.agents[resource.entityId]
  if (!inspector) return "model unknown"
  const model = [inspector.model.providerId, inspector.model.modelId].filter(Boolean).join("/")
  const availability = inspector.model.availability ?? "unknown"
  return model ? `${model} (${availability})` : availability
}

function summarizeResourceNode(projection: AgentTopologyProjection, resource: AgentTopologyNode): Pick<
  TopologyWorkspaceCanvasNodeData,
  "runtimeStatus" | "healthSummary" | "capabilitySummary" | "modelSummary" | "tooltip"
> {
  const agent = projection.inspectors.agents[resource.entityId]
  const team = projection.inspectors.teams[resource.entityId]
  const runtimeStatus = resource.status ?? agent?.status ?? team?.status ?? "unknown"

  if (team) {
    const healthSummary = `${team.health.status} · ${team.health.activeMemberCount}/${team.health.referenceMemberCount} active`
    const capabilitySummary = compactList(team.requiredCapabilityTags, "team capability inherited", 3)
    const availableModels = team.members.filter((member) => member.modelAvailability === "available").length
    const modelSummary = team.members.length > 0
      ? `${availableModels}/${team.members.length} member models available`
      : "no member model"
    return {
      runtimeStatus,
      healthSummary,
      capabilitySummary,
      modelSummary,
      tooltip: `Health: ${healthSummary}\nCapability: ${capabilitySummary}\nModel: ${modelSummary}`,
    }
  }

  if (agent) {
    const capabilitySummary = [
      `availability ${agent.capability.availability ?? "unknown"}`,
      `tools ${agent.tools.enabledCount}`,
      agent.capability.allowShellExecution ? "shell" : "",
      agent.capability.allowFilesystemWrite ? "fs-write" : "",
    ].filter(Boolean).join(" · ")
    const healthSummary = `${agent.status} · ${compactList(agent.diagnostics, "no diagnostics", 2)}`
    const modelSummary = summarizeAgentModel(projection, resource)
    return {
      runtimeStatus,
      healthSummary,
      capabilitySummary,
      modelSummary,
      tooltip: `Health: ${healthSummary}\nCapability: ${capabilitySummary}\nModel: ${modelSummary}`,
    }
  }

  const healthSummary = `${runtimeStatus} · ${resource.diagnostics.length} diagnostics`
  const capabilitySummary = compactList(resource.badges, "capability unknown", 3)
  const modelSummary = "model unknown"
  return {
    runtimeStatus,
    healthSummary,
    capabilitySummary,
    modelSummary,
    tooltip: `Health: ${healthSummary}\nCapability: ${capabilitySummary}\nModel: ${modelSummary}`,
  }
}

function buildResourceNodes(model: TopologyWorkspaceModel): Array<Node<TopologyWorkspaceCanvasNodeData>> {
  const projection = model.runtimeResources.projection
  const resources = projection?.nodes ?? []
  return resources.map((resource, index) => ({
    id: `resource:${resource.id}`,
    position: {
      x: 80 + (index % 4) * 240,
      y: 80 + Math.floor(index / 4) * 140,
    },
    className: topologyWorkspaceResourceNodeClassName(resource.kind),
    data: {
      source: "runtime_resource",
      label: resource.label,
      detail: `${resource.kind} / ${resource.status ?? "unknown"}`,
      iconLabel: resourceIconLabel(resource.kind),
      entityId: resource.entityId,
      resourceKind: resource.kind,
      ...(projection
        ? summarizeResourceNode(projection, resource)
        : {
          runtimeStatus: resource.status ?? "unknown",
          healthSummary: resource.status ?? "unknown",
          capabilitySummary: "capability unknown",
          modelSummary: "model unknown",
          tooltip: `Health: ${resource.status ?? "unknown"}\nCapability: capability unknown\nModel: model unknown`,
        }),
      muted: true,
      strokePattern: "dashed",
    },
  }))
}

function buildResourceEdges(model: TopologyWorkspaceModel): Array<Edge<TopologyWorkspaceCanvasEdgeData>> {
  const resources = model.runtimeResources.projection?.edges ?? []
  return resources.map((edge) => ({
    id: `resource:${edge.id}`,
    source: `resource:${edge.source}`,
    target: `resource:${edge.target}`,
    label: edge.label ?? edge.kind,
    type: "smoothstep",
    className: "topology-workspace-resource-edge",
    style: { stroke: "#a8a29e", strokeDasharray: "6 4", strokeWidth: 1.8 },
    data: {
      source: "runtime_resource",
      label: edge.label ?? edge.kind,
      strokePattern: "dashed",
      tone: "resource",
    },
  }))
}

function buildObservedEdges(
  model: TopologyWorkspaceModel,
  declaredNodes: Array<Node<EnterpriseTopologyCanvasNodeData>>,
): Array<Edge<TopologyWorkspaceCanvasEdgeData>> {
  const nodeIds = new Set(declaredNodes.map((node) => node.id))
  return (model.observed.latestTrace?.observedEdges ?? [])
    .map((edge) => {
      const source = `node:${edge.fromNodeId}`
      const target = `node:${edge.toNodeId}`
      if (!nodeIds.has(source) || !nodeIds.has(target)) return null
      return {
        id: `observed:${edge.edgeId}`,
        source,
        target,
        label: edge.edgeKind,
        type: "smoothstep",
        className: "topology-workspace-observed-edge",
        style: { stroke: "#7c3aed", strokeDasharray: "6 4", strokeWidth: 2 },
        data: {
          source: "observed",
          label: edge.edgeKind,
          strokePattern: "dashed",
          tone: "observed",
        },
      } satisfies Edge<TopologyWorkspaceCanvasEdgeData>
    })
    .filter((edge): edge is Edge<TopologyWorkspaceCanvasEdgeData> => Boolean(edge))
}

function entityRefFromUnknown(value: unknown): { entityType: string; id: string } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  return typeof record.entityType === "string" && typeof record.id === "string"
    ? { entityType: record.entityType, id: record.id }
    : null
}

function canvasNodeIdForEntityRef(ref: { entityType: string; id: string }): string {
  return `${ref.entityType}:${ref.id}`
}

function relationTypeForGap(value: unknown): EnterpriseRelationType {
  const relationType = typeof value === "string" ? value : "delegates_to"
  return [
    "reports_to",
    "belongs_to",
    "delegates_to",
    "approves",
    "owns",
    "collaborates_with",
    "escalates_to",
    "informs",
    "uses_system",
    "uses_tool",
    "has_access_to",
    "depends_on",
    "consults",
    "accountable_for",
  ].includes(relationType)
    ? relationType as EnterpriseRelationType
    : "delegates_to"
}

function buildImproveOverlayEdges(
  model: TopologyWorkspaceModel,
  declaredNodes: Array<Node<EnterpriseTopologyCanvasNodeData>>,
): Array<Edge<EnterpriseTopologyRelationEdgeData>> {
  const nodeIds = new Set(declaredNodes.map((node) => node.id))
  const observedEdges = (model.observed.latestTrace?.observedEdges ?? [])
    .map((edge) => {
      const source = `node:${edge.fromNodeId}`
      const target = `node:${edge.toNodeId}`
      if (!nodeIds.has(source) || !nodeIds.has(target)) return null
      return {
        id: `observed:${edge.edgeId}`,
        source,
        target,
        label: edge.edgeKind,
        type: "smoothstep",
        className: "topology-workspace-observed-edge-dotted",
        style: { stroke: "#7c3aed", strokeDasharray: "2 5", strokeWidth: 2.1 },
        data: {
          relationType: "delegates_to",
          layer: "analysis",
          runtimeCandidate: false,
          source: "observed",
          strokePattern: "dotted",
        },
      } satisfies Edge<EnterpriseTopologyRelationEdgeData>
    })
    .filter((edge): edge is Edge<EnterpriseTopologyRelationEdgeData> => Boolean(edge))

  const candidateEdges = model.gaps
    .map((finding, index) => {
      const record = finding && typeof finding === "object" && !Array.isArray(finding)
        ? finding as Record<string, unknown>
        : {}
      const detail = record.detail && typeof record.detail === "object" && !Array.isArray(record.detail)
        ? record.detail as Record<string, unknown>
        : {}
      const reasonCode = typeof detail.reasonCode === "string"
        ? detail.reasonCode
        : typeof record.reasonCode === "string"
          ? record.reasonCode
          : typeof record.findingKind === "string"
            ? record.findingKind
            : "gap_finding"
      if (reasonCode !== "observed_relation_not_declared" && record.findingKind !== "observed_only_relation") {
        return null
      }
      const relatedEntities = Array.isArray(record.relatedEntities)
        ? record.relatedEntities.map(entityRefFromUnknown).filter((ref): ref is { entityType: string; id: string } => Boolean(ref))
        : []
      const [from, to] = relatedEntities
      if (!from || !to) return null
      const source = canvasNodeIdForEntityRef(from)
      const target = canvasNodeIdForEntityRef(to)
      if (!nodeIds.has(source) || !nodeIds.has(target)) return null
      return {
        id: `gap-candidate:${record.findingId ?? index}`,
        source,
        target,
        label: "candidate",
        type: "smoothstep",
        className: "topology-workspace-gap-candidate-edge",
        style: { stroke: "#f59e0b", strokeDasharray: "6 3", strokeWidth: 2 },
        data: {
          relationType: relationTypeForGap(detail.relationType),
          layer: "analysis",
          runtimeCandidate: false,
          source: "gap",
          strokePattern: "candidate",
        },
      } satisfies Edge<EnterpriseTopologyRelationEdgeData>
    })
    .filter((edge): edge is Edge<EnterpriseTopologyRelationEdgeData> => Boolean(edge))

  return [...observedEdges, ...candidateEdges]
}

function legendItem(
  id: string,
  labelKo: string,
  labelEn: string,
  descriptionKo: string,
  descriptionEn: string,
  iconLabel: string,
  tone: TopologyWorkspaceCanvasLegendItem["tone"],
  strokePattern: TopologyWorkspaceCanvasLegendItem["strokePattern"],
): TopologyWorkspaceCanvasLegendItem {
  return { id, labelKo, labelEn, descriptionKo, descriptionEn, iconLabel, tone, strokePattern }
}

function legendToneClassName(tone: TopologyWorkspaceCanvasLegendItem["tone"]): string {
  if (tone === "runtime" || tone === "trace") return "bg-sky-500 text-sky-600"
  if (tone === "failed") return "bg-red-500 text-red-600"
  if (tone === "observed") return "bg-violet-500 text-violet-600"
  if (tone === "resource") return "bg-stone-400 text-stone-500"
  return "bg-stone-700 text-stone-700"
}

export function topologyWorkspaceTraceEdgeKey(fromNodeId: string, toNodeId: string): string {
  return topologyTraceEdgeKey(fromNodeId, toNodeId)
}
