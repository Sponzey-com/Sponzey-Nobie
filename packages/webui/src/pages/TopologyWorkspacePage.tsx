import * as React from "react"
import { useLocation } from "react-router-dom"
import { api } from "../api/client"
import type {
  EnterpriseMetadata,
  EnterpriseMetadataValue,
  EnterpriseRelation,
  EnterpriseTopology,
  NodeContract,
} from "../contracts/enterprise-topology"
import type { TaskModel } from "../contracts/tasks"
import { ExecutorGraphCanvas } from "../components/topology/ExecutorGraphCanvas"
import { ExecutorInspector } from "../components/topology/ExecutorInspector"
import { ExecutorWorkspaceShell } from "../components/topology/ExecutorWorkspaceShell"
import {
  EXECUTOR_GRAPH_SCHEMA_VERSION,
  EXECUTOR_GRAPH_SOURCE_OF_TRUTH,
  type ExecutorConnectionDraft,
  type ExecutorDraft,
  type ExecutorGraphWorkspace,
} from "../lib/executor-graph"
import { createExecutorDraftFromInference } from "../lib/executor-inference"
import {
  EXECUTOR_TOPOLOGY_V2_SCHEMA_VERSION,
  buildExecutorTopologyV2RuntimeReadModelFromEnterpriseTopology,
  enterpriseTopologyFromExecutorTopologyV2 as coreEnterpriseTopologyFromExecutorTopologyV2,
  repairExecutorTopologyV2ForPersistence,
  validateExecutorTopologyV2,
  type ExecutorEdgeV2,
  type ExecutorNodeV2,
  type ExecutorTopologyV2,
  type ExecutorTopologyV2ValidationIssue,
} from "../lib/executor-topology-v2"
import {
  resolveTopologyWorkspaceExposureModeForRoute,
  shouldShowTopologyWorkspaceAdvancedSurface,
  topologyWorkspaceVisibleLayers,
  type TopologyWorkspaceExposureMode,
} from "../lib/topology-workspace-copy"
import {
  buildTopologyWorkspaceModel,
  buildTopologyWorkspaceSnapshot,
  selectTopologyWorkspaceLayer,
  type TopologyWorkspaceLayer,
  type TopologyWorkspaceModel,
} from "../lib/topology-workspace"
import {
  buildTopologyExecutionTraceViewModel,
  type TopologyExecutionTraceEventViewModel,
  type TopologyExecutionTraceViewModel,
} from "../lib/topology-execution-trace"
import { useUiI18n } from "../lib/ui-i18n"
import type { EnterpriseTopologyRunTraceProjection } from "../lib/enterprise-topology-operations"

const DEFAULT_TOPOLOGY_ID = "workspace:draft"
const DEFAULT_TOPOLOGY_NAME = "업무 흐름"

const TOPOLOGY_WORKSPACE_LAYER_SET = new Set<TopologyWorkspaceLayer>([
  "build",
  "run",
  "trace",
  "improve",
])

type ExecutorProfileDraft = NonNullable<ExecutorDraft["executorProfile"]>
type TopologySaveStatus = "idle" | "loading" | "saved" | "failed"
type TopologyLoadStatus = "idle" | "loading" | "ready" | "failed"
type TopologyTraceEmptyReason = "none" | "no_recent_task" | "no_topology_run_for_latest_task"

export function resolveTopologyWorkspaceInitialLayer(
  search: string,
  _exposureMode: TopologyWorkspaceExposureMode = "simple",
): TopologyWorkspaceLayer {
  const normalizedSearch = search.startsWith("?") ? search : `?${search}`
  const params = new URLSearchParams(normalizedSearch)
  const requested = params.get("mode") ?? params.get("layer")
  return requested && TOPOLOGY_WORKSPACE_LAYER_SET.has(requested as TopologyWorkspaceLayer)
    ? requested as TopologyWorkspaceLayer
    : "build"
}

export function selectLatestTaskRootRunIdForTopologyTrace(
  tasks: Pick<TaskModel, "createdAt" | "updatedAt" | "rootRunId" | "anchorRunId" | "requestIdentity">[],
): string | null {
  const latestTask = [...tasks].sort((a, b) =>
    (b.createdAt - a.createdAt) || (b.updatedAt - a.updatedAt)
  )[0]
  return latestTask?.rootRunId
    ?? latestTask?.requestIdentity?.rootRunId
    ?? latestTask?.anchorRunId
    ?? null
}

export interface TopologyWorkspaceRouteShellProps {
  initialLayer?: TopologyWorkspaceLayer
  exposureMode?: TopologyWorkspaceExposureMode
  renderSimpleHeader?: boolean
  children?: React.ReactNode | ((model: TopologyWorkspaceModel, actions: TopologyWorkspaceRouteShellActions) => React.ReactNode)
}

export interface TopologyWorkspaceRouteShellActions {
  selectLayer: (layer: TopologyWorkspaceLayer) => void
}

export function TopologyWorkspaceRouteShell({
  initialLayer = "build",
  exposureMode = "simple",
  renderSimpleHeader = true,
  children,
}: TopologyWorkspaceRouteShellProps) {
  const { text } = useUiI18n()
  const effectiveExposureMode: TopologyWorkspaceExposureMode = shouldShowTopologyWorkspaceAdvancedSurface(exposureMode)
    ? exposureMode
    : "simple"
  const [model, setModel] = React.useState(() => buildTopologyWorkspaceModel({
    snapshot: buildTopologyWorkspaceSnapshot({ topologyId: DEFAULT_TOPOLOGY_ID }),
    selectedLayer: initialLayer,
  }))
  React.useEffect(() => {
    setModel((current) =>
      current.selectedLayer === initialLayer ? current : selectTopologyWorkspaceLayer(current, initialLayer)
    )
  }, [initialLayer])
  const selectLayer = React.useCallback((layer: TopologyWorkspaceLayer) => {
    setModel((current) => selectTopologyWorkspaceLayer(current, layer))
  }, [])
  const actions = React.useMemo(() => ({ selectLayer }), [selectLayer])
  const renderedChildren = typeof children === "function" ? children(model, actions) : children
  const visibleLayers = React.useMemo(() => topologyWorkspaceVisibleLayers(effectiveExposureMode), [effectiveExposureMode])
  const shouldRenderRouteHeader = effectiveExposureMode !== "simple" || renderSimpleHeader
  return (
    <div
      className="flex h-full min-h-0 flex-col bg-stone-100 text-stone-950"
      data-testid="topology-workspace-route-shell"
      data-exposure-mode={effectiveExposureMode}
    >
      {shouldRenderRouteHeader ? (
      <header className="shrink-0 border-b border-stone-200 bg-white px-6 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">
              {text("토폴로지", "Topology")}
            </div>
            <h1 className="mt-1 text-2xl font-semibold">
              {effectiveExposureMode === "simple"
                ? text("업무 흐름 만들기", "Build a workflow")
                : text("Topology Workspace", "Topology Workspace")}
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label={text("토폴로지 작업 모드", "Topology workspace modes")}>
            {visibleLayers.map((layer) => (
              <button
                key={layer.layer}
                type="button"
                role="tab"
                aria-selected={layer.layer === model.selectedLayer}
                onClick={() => selectLayer(layer.layer)}
                title={text(layer.tooltipKo, layer.tooltipEn)}
                className={`h-9 rounded-lg border px-3 text-xs font-semibold ${
                  layer.layer === model.selectedLayer
                    ? "border-stone-900 bg-stone-900 text-white"
                    : "border-stone-200 bg-white text-stone-700"
                }`}
                data-testid={`topology-workspace-layer-${layer.layer}`}
              >
                {text(layer.labelKo, layer.labelEn)}
              </button>
            ))}
          </div>
        </div>
      </header>
      ) : null}
      <output
        className="sr-only"
        aria-live="polite"
        data-testid="topology-workspace-model-state"
        data-topology-id={model.topologyId}
        data-selected-layer={model.selectedLayer}
        data-selection-kind={model.selection.kind}
      >
        {model.topologyId}:{model.selectedLayer}:{model.selection.kind}
      </output>
      <div className="min-h-0 flex-1 overflow-hidden">
        {renderedChildren}
      </div>
    </div>
  )
}

export function createEmptyExecutorTopologyV2(
  now: number | string = Date.now(),
  id = DEFAULT_TOPOLOGY_ID,
): ExecutorTopologyV2 {
  return {
    schemaVersion: EXECUTOR_TOPOLOGY_V2_SCHEMA_VERSION,
    id,
    name: DEFAULT_TOPOLOGY_NAME,
    status: "draft",
    nodes: [],
    edges: [],
    createdAt: now,
    updatedAt: now,
  }
}

export function executorGraphFromExecutorTopologyV2(
  topology: ExecutorTopologyV2,
): ExecutorGraphWorkspace {
  const activeNodes = activeExecutorNodes(topology)
  const activeNodeIds = new Set(activeNodes.map((node) => node.id))
  const executors = activeNodes.map((node) => executorDraftFromExecutorNodeV2(node, topology.updatedAt))
  const connections: ExecutorConnectionDraft[] = topology.edges
    .filter((edge) =>
      edge.status === "active" &&
      activeNodeIds.has(edge.sourceNodeId) &&
      activeNodeIds.has(edge.targetNodeId)
    )
    .map((edge) => ({
      id: edge.id,
      fromExecutorId: edge.sourceNodeId,
      toExecutorId: edge.targetNodeId,
      inferredRelation: "handoff",
      label: "넘김",
      confidence: 1,
      userConfirmed: true,
      sourceRelationId: edge.id,
      advancedRelationType: "delegates_to",
    }))

  return {
    schemaVersion: EXECUTOR_GRAPH_SCHEMA_VERSION,
    graphId: `${topology.id}:executor-graph`,
    topologyId: topology.id,
    name: topology.name,
    mode: "simple",
    executors,
    sections: [],
    connections,
    selectedId: null,
    inference: {
      source: "enterprise_topology_projection",
      confidence: activeNodes.length === 0 ? 0 : 1,
      executorCount: executors.length,
      connectionCount: connections.length,
      issueCount: 0,
      generatedAt: topology.updatedAt,
    },
    compiledPreview: null,
    latestRun: null,
    issues: [],
    sourceOfTruth: EXECUTOR_GRAPH_SOURCE_OF_TRUTH,
  }
}

export function enterpriseTopologyFromExecutorTopologyV2(
  topology: ExecutorTopologyV2,
): EnterpriseTopology {
  return coreEnterpriseTopologyFromExecutorTopologyV2(topology, {
    migrationSource: "executor_topology_v2_default_workspace",
  })
}

export function addExecutorNodeV2(
  topology: ExecutorTopologyV2,
  now: number | string = Date.now(),
): { topology: ExecutorTopologyV2; node: ExecutorNodeV2 } {
  const nodeName = nextExecutorNodeName(topology)
  const id = nextExecutorNodeId(topology, now)
  const node: ExecutorNodeV2 = {
    id,
    name: nodeName,
    roleName: "실행자",
    description: "이 실행자가 맡을 일을 적어주세요.",
    position: nextExecutorPosition(topology.nodes.length),
    status: "active",
    profile: defaultExecutorProfile({
      id,
      name: nodeName,
      roleName: "실행자",
      description: "이 실행자가 맡을 일을 적어주세요.",
    }) as unknown as ExecutorNodeV2["profile"],
  }
  return {
    topology: {
      ...topology,
      nodes: [...topology.nodes, node],
      updatedAt: now,
    },
    node,
  }
}

export function deleteExecutorNodeV2(
  topology: ExecutorTopologyV2,
  nodeId: string,
  now: number | string = Date.now(),
): ExecutorTopologyV2 {
  return {
    ...topology,
    nodes: topology.nodes.filter((node) => node.id !== nodeId),
    edges: topology.edges.filter((edge) => edge.sourceNodeId !== nodeId && edge.targetNodeId !== nodeId),
    updatedAt: now,
  }
}

export function connectExecutorNodesV2(
  topology: ExecutorTopologyV2,
  sourceNodeId: string,
  targetNodeId: string,
  now: number | string = Date.now(),
): ExecutorTopologyV2 {
  if (sourceNodeId === targetNodeId) return topology
  const activeNodeIds = new Set(activeExecutorNodes(topology).map((node) => node.id))
  if (!activeNodeIds.has(sourceNodeId) || !activeNodeIds.has(targetNodeId)) return topology
  const existing = topology.edges.find((edge) =>
    edge.status === "active" &&
    edge.sourceNodeId === sourceNodeId &&
    edge.targetNodeId === targetNodeId
  )
  if (existing) return topology
  const edge: ExecutorEdgeV2 = {
    id: nextExecutorEdgeId(topology, sourceNodeId, targetNodeId, now),
    sourceNodeId,
    targetNodeId,
    type: "delegates_to",
    label: "넘김",
    status: "active",
  }
  return {
    ...topology,
    edges: [...topology.edges, edge],
    updatedAt: now,
  }
}

export function moveExecutorNodeV2(
  topology: ExecutorTopologyV2,
  nodeId: string,
  position: { x: number; y: number },
  now: number | string = Date.now(),
): ExecutorTopologyV2 {
  return {
    ...topology,
    nodes: topology.nodes.map((node) =>
      node.id === nodeId
        ? { ...node, position: { x: Math.round(position.x), y: Math.round(position.y) } }
        : node
    ),
    updatedAt: now,
  }
}

export function applyExecutorDraftToExecutorTopologyV2(
  topology: ExecutorTopologyV2,
  executor: ExecutorDraft,
  now: number | string = Date.now(),
): ExecutorTopologyV2 {
  const profile = executor.executorProfile
    ? {
        ...executor.executorProfile,
        executorId: executor.id,
        displayName: executor.name,
      }
    : defaultExecutorProfile({
        id: executor.id,
        name: executor.name,
        roleName: "",
        description: executor.description,
      })
  const roleName = profile.roleName
  const existingNode = topology.nodes.find((node) => node.id === executor.id)
  const nextNode: ExecutorNodeV2 = {
    id: executor.id,
    name: executor.name,
    ...(roleName ? { roleName } : {}),
    description: executor.description,
    ...(executor.definitionQuickChips?.length ? { definitionQuickChips: [...executor.definitionQuickChips] } : {}),
    position: executor.position ?? existingNode?.position ?? nextExecutorPosition(topology.nodes.length),
    status: existingNode?.status ?? "active",
    profile: profile as unknown as ExecutorNodeV2["profile"],
    metadata: mergeExecutorNodeMetadata(existingNode?.metadata, executor),
  }
  const found = Boolean(existingNode)
  return {
    ...topology,
    nodes: found
      ? topology.nodes.map((node) => node.id === executor.id ? nextNode : node)
      : [...topology.nodes, nextNode],
    updatedAt: now,
  }
}

export function autoLayoutExecutorTopologyV2(
  topology: ExecutorTopologyV2,
  now: number | string = Date.now(),
): ExecutorTopologyV2 {
  return {
    ...topology,
    nodes: topology.nodes.map((node, index) => ({
      ...node,
      position: {
        x: 120 + (index % 3) * 320,
        y: 80 + Math.floor(index / 3) * 210,
      },
    })),
    updatedAt: now,
  }
}

export function TopologyWorkspacePage() {
  const location = useLocation()
  const { text } = useUiI18n()
  const exposureMode = React.useMemo(
    () => resolveTopologyWorkspaceExposureModeForRoute({
      search: location.search,
      pathname: location.pathname,
    }),
    [location.pathname, location.search],
  )
  const initialLayer = React.useMemo(
    () => resolveTopologyWorkspaceInitialLayer(location.search, exposureMode),
    [exposureMode, location.search],
  )
  return (
    <TopologyWorkspaceRouteShell initialLayer={initialLayer} exposureMode={exposureMode} renderSimpleHeader={false}>
      {(model) => (
        <ExecutorTopologyV2Workspace
          selectedLayer={model.selectedLayer}
          text={text}
        />
      )}
    </TopologyWorkspaceRouteShell>
  )
}

function ExecutorTopologyV2Workspace({
  selectedLayer,
  text,
}: {
  selectedLayer: TopologyWorkspaceLayer
  text: ReturnType<typeof useUiI18n>["text"]
}) {
  const [topology, setTopology] = React.useState(() => createEmptyExecutorTopologyV2())
  const [selectedExecutorId, setSelectedExecutorId] = React.useState<string | null>(null)
  const [saveStatus, setSaveStatus] = React.useState<TopologySaveStatus>("idle")
  const [loadStatus, setLoadStatus] = React.useState<TopologyLoadStatus>("idle")
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null)
  const [traceProjection, setTraceProjection] = React.useState<EnterpriseTopologyRunTraceProjection | null>(null)
  const [traceLoadStatus, setTraceLoadStatus] = React.useState<TopologyLoadStatus>("idle")
  const [traceErrorMessage, setTraceErrorMessage] = React.useState<string | null>(null)
  const [traceEmptyReason, setTraceEmptyReason] = React.useState<TopologyTraceEmptyReason>("none")
  const topologyRef = React.useRef(topology)

  React.useEffect(() => {
    topologyRef.current = topology
  }, [topology])

  React.useEffect(() => {
    let cancelled = false
    setLoadStatus("loading")
    api.enterpriseTopologyGuiDraft(DEFAULT_TOPOLOGY_ID)
      .then((response) => {
        if (cancelled) return
        const loaded = response.draft?.topology
          ? buildExecutorTopologyV2RuntimeReadModelFromEnterpriseTopology(response.draft.topology).topology
          : createEmptyExecutorTopologyV2()
        topologyRef.current = loaded
        setTopology(loaded)
        setSelectedExecutorId((current) => current && loaded.nodes.some((node) => node.id === current) ? current : null)
        setLoadStatus("ready")
        setErrorMessage(null)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setLoadStatus("failed")
        setErrorMessage(error instanceof Error ? error.message : text("토폴로지를 불러오지 못했습니다.", "Failed to load topology."))
      })
    return () => {
      cancelled = true
    }
  }, [text])

  const graph = React.useMemo(() => ({
    ...executorGraphFromExecutorTopologyV2(topology),
    selectedId: selectedExecutorId,
  }), [selectedExecutorId, topology])
  const validation = React.useMemo(() => validateExecutorTopologyV2(topology), [topology])
  const selectedExecutor = React.useMemo(
    () => graph.executors.find((executor) => executor.id === selectedExecutorId) ?? null,
    [graph.executors, selectedExecutorId],
  )
  const activeNodes = React.useMemo(() => activeExecutorNodes(topology), [topology])
  const activeEdges = React.useMemo(() => topology.edges.filter((edge) => edge.status === "active"), [topology.edges])
  const executorNames = React.useMemo(
    () => Object.fromEntries(activeNodes.map((node) => [node.id, node.name])),
    [activeNodes],
  )
  const edgeIdsByNodePair = React.useMemo(
    () => Object.fromEntries(activeEdges.map((edge) => [`${edge.sourceNodeId}->${edge.targetNodeId}`, edge.id])),
    [activeEdges],
  )
  const traceView = React.useMemo(
    () => buildTopologyExecutionTraceViewModel({
      topologyRun: traceProjection,
      executorNames,
      edgeIdsByNodePair,
    }),
    [edgeIdsByNodePair, executorNames, traceProjection],
  )

  React.useEffect(() => {
    if (loadStatus !== "ready") return
    let cancelled = false
    let intervalId: ReturnType<typeof setInterval> | undefined

    const loadLatestTrace = async () => {
      setTraceLoadStatus((current) => current === "idle" ? "loading" : current)
      try {
        const tasks = await api.tasks()
        if (cancelled) return
        const latestRootRunId = selectLatestTaskRootRunIdForTopologyTrace(tasks.tasks)
        if (!latestRootRunId) {
          setTraceProjection(null)
          setTraceEmptyReason("no_recent_task")
          setTraceLoadStatus("ready")
          setTraceErrorMessage(null)
          return
        }
        const runs = await api.topologyRuns({
          topologyId: topologyRef.current.id,
          rootRunId: latestRootRunId,
          limit: 1,
        })
        if (cancelled) return
        const latest = runs.topologyRuns[0]
        if (!latest) {
          setTraceProjection(null)
          setTraceEmptyReason("no_topology_run_for_latest_task")
          setTraceLoadStatus("ready")
          setTraceErrorMessage(null)
          return
        }
        const projection = await api.topologyRun(latest.topologyRunId, { limit: 500 })
        if (cancelled) return
        setTraceProjection(projection.topologyRun)
        setTraceEmptyReason("none")
        setTraceLoadStatus("ready")
        setTraceErrorMessage(null)
      } catch (error) {
        if (cancelled) return
        setTraceLoadStatus("failed")
        setTraceEmptyReason("none")
        setTraceErrorMessage(error instanceof Error ? error.message : text("실행 흐름을 불러오지 못했습니다.", "Failed to load execution trace."))
      }
    }

    void loadLatestTrace()
    intervalId = setInterval(() => {
      void loadLatestTrace()
    }, 5000)

    return () => {
      cancelled = true
      if (intervalId !== undefined) clearInterval(intervalId)
    }
  }, [loadStatus, text])

  const persistTopology = React.useCallback(async (nextTopology: ExecutorTopologyV2) => {
    const repaired = repairExecutorTopologyV2ForPersistence(nextTopology).topology
    const validationResult = validateExecutorTopologyV2(repaired)
    if (!validationResult.ok) {
      setSaveStatus("failed")
      setErrorMessage(validationIssueMessage(validationResult.issues, text))
      return
    }
    setSaveStatus("loading")
    try {
      const saved = await api.startEnterpriseTopologyGuiDraft(repaired.id, {
        topology: enterpriseTopologyFromExecutorTopologyV2(repaired),
        reset: true,
        persist: true,
        activate: true,
        importSource: "executor_topology_v2_default_workspace",
      })
      if (saved.activation && saved.activation.ok !== true) {
        setSaveStatus("failed")
        setErrorMessage(
          saved.activation.issues?.join(", ") ||
            saved.activation.reasonCode ||
            text("저장했지만 실행 토폴로지로 활성화하지 못했습니다.", "Saved, but failed to activate the executable topology."),
        )
        return
      }
      topologyRef.current = repaired
      setTopology(repaired)
      setSaveStatus("saved")
      setErrorMessage(null)
    } catch (error) {
      setSaveStatus("failed")
      setErrorMessage(error instanceof Error ? error.message : text("저장하지 못했습니다.", "Failed to save."))
    }
  }, [text])

  const commitTopology = React.useCallback((updater: (current: ExecutorTopologyV2) => ExecutorTopologyV2) => {
    setTopology((current) => {
      const next = updater(current)
      topologyRef.current = next
      return next
    })
    setSaveStatus("idle")
    setErrorMessage(null)
  }, [])

  const handleAddExecutor = React.useCallback(() => {
    setTopology((current) => {
      const result = addExecutorNodeV2(current)
      topologyRef.current = result.topology
      setSelectedExecutorId(result.node.id)
      return result.topology
    })
    setSaveStatus("idle")
    setErrorMessage(null)
  }, [])

  const handleDeleteExecutor = React.useCallback(() => {
    if (!selectedExecutorId) return
    commitTopology((current) => deleteExecutorNodeV2(current, selectedExecutorId))
    setSelectedExecutorId(null)
  }, [commitTopology, selectedExecutorId])

  const handleExecutorChange = React.useCallback((executor: ExecutorDraft) => {
    commitTopology((current) => applyExecutorDraftToExecutorTopologyV2(current, executor))
    setSelectedExecutorId(executor.id)
  }, [commitTopology])

  const handleConfirmUnderstanding = React.useCallback((executor: ExecutorDraft) => {
    const nextTopology = applyExecutorDraftToExecutorTopologyV2(topologyRef.current, executor)
    topologyRef.current = nextTopology
    setTopology(nextTopology)
    setSelectedExecutorId(executor.id)
    void persistTopology(nextTopology)
  }, [persistTopology])

  const handleConnectExecutors = React.useCallback((sourceExecutorId: string, targetExecutorId: string) => {
    commitTopology((current) => connectExecutorNodesV2(current, sourceExecutorId, targetExecutorId))
    setSelectedExecutorId(targetExecutorId)
  }, [commitTopology])

  const handleMoveExecutor = React.useCallback((executorId: string, position: { x: number; y: number }) => {
    commitTopology((current) => moveExecutorNodeV2(current, executorId, position))
  }, [commitTopology])

  const handleAutoLayout = React.useCallback(() => {
    commitTopology((current) => autoLayoutExecutorTopologyV2(current))
  }, [commitTopology])

  const savedStatusLabel = saveStatusLabel(saveStatus, loadStatus, text)
  const validationLabel = validation.ok
    ? text("저장 가능", "Ready to save")
    : validationIssueShortLabel(validation.issues, text)

  return (
    <ExecutorWorkspaceShell
      selectedLayer={selectedLayer}
      savedStatusLabel={savedStatusLabel}
      validationLabel={validationLabel}
      executorCount={activeNodes.length}
      connectionCount={activeEdges.length}
      showFirstStart={false}
      showLeftRail={false}
      saveDisabled={saveStatus === "loading" || !validation.ok}
      deleteDisabled={!selectedExecutorId}
      onAddExecutor={handleAddExecutor}
      onDeleteExecutor={handleDeleteExecutor}
      onSaveDraft={() => void persistTopology(topologyRef.current)}
      onAutoLayout={handleAutoLayout}
    >
      <section
        className="grid h-full min-h-0 gap-3 overflow-y-auto overscroll-contain p-3 md:grid-cols-[minmax(0,1fr)_360px] md:overflow-hidden"
        data-testid="topology-v2-workspace"
      >
        <div className="min-h-[360px] overflow-hidden rounded-lg border border-stone-200 bg-white md:min-h-0" data-testid="topology-v2-canvas-pane">
          <ExecutorGraphCanvas
            graph={graph}
            selectedLayer={selectedLayer}
            selectedExecutorId={selectedExecutorId}
            activeExecutorIds={traceView.activeExecutorIds}
            activeEdgeIds={traceView.activeEdgeIds}
            executorStatuses={traceView.executorStatuses}
            edgeStatuses={traceView.edgeStatuses}
            onSelectExecutor={setSelectedExecutorId}
            onConnectExecutors={handleConnectExecutors}
            onMoveExecutor={handleMoveExecutor}
          />
        </div>
        <aside
          className="min-h-[320px] overflow-y-auto overscroll-contain rounded-lg border border-stone-200 bg-white p-3 pb-4 md:min-h-0"
          data-testid="topology-v2-sidebar"
        >
          <TopologyV2FlowStatusCard
            loadStatus={loadStatus}
            saveStatus={saveStatus}
            errorMessage={errorMessage}
            selectedExecutor={selectedExecutor}
            executorCount={activeNodes.length}
            connectionCount={activeEdges.length}
            traceView={traceView}
            traceLoadStatus={traceLoadStatus}
            traceEmptyReason={traceEmptyReason}
            traceErrorMessage={traceErrorMessage}
            text={text}
          />
          <div className="mt-3">
            <ExecutorInspector
              executor={selectedExecutor}
              graph={graph}
              workspaceId={DEFAULT_TOPOLOGY_ID}
              topologyId={topology.id}
              onExecutorChange={handleExecutorChange}
              onConfirmUnderstanding={handleConfirmUnderstanding}
            />
          </div>
        </aside>
      </section>
    </ExecutorWorkspaceShell>
  )
}

export function TopologyV2FlowStatusCard({
  loadStatus,
  saveStatus,
  errorMessage,
  selectedExecutor,
  executorCount,
  connectionCount,
  traceView,
  traceLoadStatus,
  traceEmptyReason = "none",
  traceErrorMessage,
  text,
}: {
  loadStatus: TopologyLoadStatus
  saveStatus: TopologySaveStatus
  errorMessage: string | null
  selectedExecutor: ExecutorDraft | null
  executorCount: number
  connectionCount: number
  traceView: TopologyExecutionTraceViewModel
  traceLoadStatus: TopologyLoadStatus
  traceEmptyReason?: TopologyTraceEmptyReason
  traceErrorMessage: string | null
  text: ReturnType<typeof useUiI18n>["text"]
}) {
  const visibleTraceEvents = traceView.events.slice(-6)
  return (
    <section className="rounded-lg border border-stone-200 bg-stone-50 p-3" data-testid="topology-v2-flow-status-card">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-semibold text-stone-950">
          {text("최근 요청/실행 흐름", "Recent request flow")}
        </div>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${traceStatusChipClassName(traceView.status, traceLoadStatus)}`}
          data-testid="topology-v2-trace-status"
          data-trace-status={traceView.status}
          data-trace-load-status={traceLoadStatus}
        >
          {traceStatusLabel(traceView.status, traceLoadStatus, text)}
        </span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] font-semibold text-stone-700">
        <div className="rounded-md bg-white px-2 py-1.5">
          {executorCount} {text("노드", "nodes")}
        </div>
        <div className="rounded-md bg-white px-2 py-1.5">
          {connectionCount} {text("연결", "connections")}
        </div>
      </div>
      <div className="mt-2 rounded-md bg-white px-2 py-1.5 text-[11px] font-semibold text-stone-600">
        {text("저장 상태", "Save status")}: {flowStatusLabel(loadStatus, saveStatus, text)}
      </div>
      <p className="mt-2 text-[11px] leading-5 text-stone-500">
        {selectedExecutor
          ? text(`${selectedExecutor.name} 노드를 편집 중입니다.`, `Editing ${selectedExecutor.name}.`)
          : text("노드를 선택하면 이름과 성격을 바로 수정할 수 있습니다.", "Select a node to edit its name and character.")}
      </p>
      <div className="mt-3 space-y-2" data-testid="topology-v2-trace-events">
        {visibleTraceEvents.length > 0 ? visibleTraceEvents.map((event) => (
          <TraceEventRow key={event.id} event={event} text={text} />
        )) : (
          <div
            className="rounded-md border border-dashed border-stone-200 bg-white px-2 py-2 text-[11px] leading-5 text-stone-500"
            data-testid="topology-v2-trace-empty"
          >
            {traceEmptyMessage(traceLoadStatus, traceEmptyReason, text)}
          </div>
        )}
      </div>
      {traceView.selfSolveMode ? (
        <div
          className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] leading-5 text-amber-800"
          data-testid="topology-v2-self-solve-mode"
          data-self-solve-mode={traceView.selfSolveMode}
        >
          {traceView.selfSolveMode === "self_solve_after_delegation_failure"
            ? text("위임 실패 후 자체 처리로 전환되었습니다.", "The current agent switched to self solving after delegation failed.")
            : text("처음부터 현재 에이전트가 직접 처리했습니다.", "The current agent handled it directly from the start.")}
        </div>
      ) : null}
      {traceView.failedExecutors.length > 0 ? (
        <div className="mt-2 space-y-1.5" data-testid="topology-v2-trace-failures">
          {traceView.failedExecutors.map((failure) => (
            <div
              key={`${failure.executorId}:${failure.failureCode}`}
              className="rounded-md border border-rose-200 bg-rose-50 px-2 py-1.5 text-[11px] leading-5 text-rose-800"
              data-testid="topology-v2-trace-failure"
              data-executor-id={failure.executorId}
              data-failure-code={failure.failureCode}
            >
              <span className="font-semibold">{failure.executorName}</span>
              <span className="ml-1">{failure.failureCode}</span>
              <div className="text-rose-700">{failure.summary}</div>
            </div>
          ))}
        </div>
      ) : null}
      {errorMessage ? (
        <div className="mt-2 rounded-md border border-rose-200 bg-rose-50 px-2 py-1.5 text-[11px] leading-5 text-rose-700">
          {errorMessage}
        </div>
      ) : null}
      {traceErrorMessage ? (
        <div
          className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] leading-5 text-amber-800"
          data-testid="topology-v2-trace-error"
        >
          {traceErrorMessage}
        </div>
      ) : null}
    </section>
  )
}

function traceEmptyMessage(
  loadStatus: TopologyLoadStatus,
  reason: TopologyTraceEmptyReason,
  text: ReturnType<typeof useUiI18n>["text"],
): string {
  if (loadStatus === "loading") {
    return text("최근 실행 흐름을 불러오는 중입니다.", "Loading the latest execution flow.")
  }
  if (reason === "no_recent_task") {
    return text("실행 현황에서 확인할 최근 요청이 아직 없습니다.", "No recent request exists in the activity monitor yet.")
  }
  if (reason === "no_topology_run_for_latest_task") {
    return text(
      "실행 현황의 최근 요청에 연결된 토폴로지 실행 기록이 없습니다.",
      "The latest activity-monitor request has no linked topology execution record.",
    )
  }
  return text("최근 실행 기록이 아직 없습니다.", "There is no recent execution record yet.")
}

function validationIssueShortLabel(
  issues: readonly ExecutorTopologyV2ValidationIssue[],
  text: ReturnType<typeof useUiI18n>["text"],
): string {
  if (issues.some((issue) => issue.code === "duplicate_node_name")) {
    return text("이름 중복", "Duplicate name")
  }
  return text("입력 필요", "Needs input")
}

function validationIssueMessage(
  issues: readonly ExecutorTopologyV2ValidationIssue[],
  text: ReturnType<typeof useUiI18n>["text"],
): string {
  if (issues.some((issue) => issue.code === "duplicate_node_name")) {
    return text(
      "같은 이름의 실행자가 있습니다. 실행자 이름은 서로 달라야 저장할 수 있습니다.",
      "Executor names must be unique before saving.",
    )
  }
  return text("이름과 성격과 하는 일을 입력한 뒤 저장하세요.", "Enter name and work description before saving.")
}

function nextExecutorNodeName(topology: ExecutorTopologyV2): string {
  const usedNames = new Set(
    topology.nodes
      .filter((node) => node.status === "active")
      .map((node) => normalizeExecutorNodeNameForUi(node.name))
      .filter((name) => name.length > 0),
  )
  let index = topology.nodes.length + 1
  while (usedNames.has(normalizeExecutorNodeNameForUi(`새 실행자 ${index}`))) index += 1
  return `새 실행자 ${index}`
}

function normalizeExecutorNodeNameForUi(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLocaleLowerCase()
}

function TraceEventRow({
  event,
  text,
}: {
  event: TopologyExecutionTraceEventViewModel
  text: ReturnType<typeof useUiI18n>["text"]
}) {
  return (
    <div
      className={`rounded-md border px-2 py-1.5 text-[11px] leading-5 ${traceToneClassName(event.tone)}`}
      data-testid="topology-v2-trace-event"
      data-trace-kind={event.kind}
      data-executor-id={event.executorId ?? ""}
      data-edge-id={event.edgeId ?? ""}
      data-reason-code={event.reasonCode}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold">
          {text(event.labelKo, event.labelEn)}
        </span>
        {event.executorName ? (
          <span className="truncate rounded-full bg-white/70 px-2 py-0.5 text-[10px] font-semibold">
            {event.executorName}
          </span>
        ) : null}
      </div>
      <div className="mt-0.5 text-current/80">
        {text(event.summaryKo, event.summaryEn)}
      </div>
    </div>
  )
}

function traceToneClassName(tone: TopologyExecutionTraceEventViewModel["tone"]): string {
  if (tone === "rose") return "border-rose-200 bg-rose-50 text-rose-800"
  if (tone === "amber") return "border-amber-200 bg-amber-50 text-amber-800"
  if (tone === "emerald") return "border-emerald-200 bg-emerald-50 text-emerald-800"
  if (tone === "sky") return "border-sky-200 bg-sky-50 text-sky-800"
  if (tone === "violet") return "border-violet-200 bg-violet-50 text-violet-800"
  if (tone === "blue") return "border-blue-200 bg-blue-50 text-blue-800"
  return "border-stone-200 bg-white text-stone-700"
}

function traceStatusChipClassName(
  status: TopologyExecutionTraceViewModel["status"],
  loadStatus: TopologyLoadStatus,
): string {
  if (loadStatus === "loading") return "bg-blue-50 text-blue-700"
  if (loadStatus === "failed") return "bg-amber-50 text-amber-800"
  if (status === "failed") return "bg-rose-100 text-rose-800"
  if (status === "blocked" || status === "trace_missing" || status === "self_solved") return "bg-amber-100 text-amber-800"
  if (status === "completed") return "bg-emerald-100 text-emerald-800"
  if (status === "running") return "bg-blue-100 text-blue-800"
  return "bg-white text-stone-700"
}

function traceStatusLabel(
  status: TopologyExecutionTraceViewModel["status"],
  loadStatus: TopologyLoadStatus,
  text: ReturnType<typeof useUiI18n>["text"],
): string {
  if (loadStatus === "loading") return text("불러오는 중", "Loading")
  if (loadStatus === "failed") return text("trace 오류", "Trace error")
  if (status === "failed") return text("실패", "Failed")
  if (status === "blocked") return text("안전 차단", "Blocked")
  if (status === "self_solved") return text("직접 처리", "Self solved")
  if (status === "trace_missing") return text("trace 없음", "No trace")
  if (status === "completed") return text("완료", "Completed")
  if (status === "running") return text("실행 중", "Running")
  return text("대기", "Idle")
}

function saveStatusLabel(
  saveStatus: TopologySaveStatus,
  loadStatus: TopologyLoadStatus,
  text: ReturnType<typeof useUiI18n>["text"],
): string {
  if (saveStatus === "loading") return text("저장 중", "Saving")
  if (saveStatus === "saved") return text("저장됨", "Saved")
  if (saveStatus === "failed") return text("저장 실패", "Save failed")
  if (loadStatus === "loading") return text("불러오는 중", "Loading")
  if (loadStatus === "failed") return text("불러오기 실패", "Load failed")
  return text("편집 중", "Editing")
}

function flowStatusLabel(
  loadStatus: TopologyLoadStatus,
  saveStatus: TopologySaveStatus,
  text: ReturnType<typeof useUiI18n>["text"],
): string {
  if (saveStatus === "loading") return text("저장 중", "Saving")
  if (saveStatus === "failed") return text("오류", "Error")
  if (loadStatus === "loading") return text("불러오는 중", "Loading")
  if (loadStatus === "failed") return text("오류", "Error")
  if (saveStatus === "saved") return text("저장됨", "Saved")
  return text("대기", "Idle")
}

function activeExecutorNodes(topology: ExecutorTopologyV2): ExecutorNodeV2[] {
  return topology.nodes.filter((node) => node.status === "active")
}

function executorDraftFromExecutorNodeV2(node: ExecutorNodeV2, now: number | string): ExecutorDraft {
  const profile = executorProfileFromExecutorNodeV2(node)
  const inferred = createExecutorDraftFromInference({
    id: node.id,
    sourceNodeId: node.id,
    name: node.name,
    description: node.description,
    executorProfile: profile,
    now,
  })
  const confirmed = executorUnderstandingConfirmed(node.metadata)
  return {
    ...inferred,
    name: node.name,
    description: node.description,
    ...(node.definitionQuickChips?.length ? { definitionQuickChips: [...node.definitionQuickChips] } : {}),
    position: node.position,
    executorProfile: profile,
    ...(confirmed ? {
      userConfirmed: true,
      confirmedUnderstandingVersion: confirmed.version,
    } : {}),
  }
}

function executorProfileFromExecutorNodeV2(node: ExecutorNodeV2): ExecutorProfileDraft {
  const profile = node.profile as unknown
  if (isExecutorProfile(profile)) return profile
  return defaultExecutorProfile({
    id: node.id,
    name: node.name,
    roleName: node.roleName ?? "실행자",
    description: node.description,
  })
}

function defaultExecutorProfile(input: {
  id: string
  name: string
  roleName: string
  description: string
}): ExecutorProfileDraft {
  const definition = input.description.trim() || input.name.trim() || input.id
  return {
    schemaVersion: 1,
    executorId: input.id,
    displayName: input.name,
    roleName: input.roleName,
    definition,
    does: [definition],
    delegationScope: [],
    expectedOutputs: ["처리 결과"],
    handoffStyle: "structured_handoff",
    declineCriteria: [],
    riskBoundary: [],
  }
}

function isExecutorProfile(value: unknown): value is ExecutorProfileDraft {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return typeof record.executorId === "string" &&
    typeof record.displayName === "string" &&
    typeof record.roleName === "string" &&
    typeof record.definition === "string" &&
    Array.isArray(record.does)
}

function enterpriseNodeFromExecutorNodeV2(node: ExecutorNodeV2, now: number | string): NodeContract {
  const profile = executorProfileFromExecutorNodeV2(node)
  const name = node.name.trim() || node.id
  const description = node.description.trim() || name
  const metadata: EnterpriseMetadata = {
    roleName: profile.roleName,
    executorProfile: profile as unknown as EnterpriseMetadataValue,
    executorGraph: {
      position: node.position as unknown as EnterpriseMetadataValue,
      ...(node.definitionQuickChips?.length
        ? { definitionQuickChips: node.definitionQuickChips as unknown as EnterpriseMetadataValue }
        : {}),
    },
    executorTopologyV2: {
      schemaVersion: EXECUTOR_TOPOLOGY_V2_SCHEMA_VERSION,
      nodeId: node.id,
    },
  }
  const understanding = executorUnderstandingMetadata(node.metadata)
  if (understanding) metadata.understanding = understanding
  return {
    schemaVersion: 1,
    entityType: "node",
    id: node.id,
    name,
    displayName: name,
    status: node.status === "archived" ? "archived" : "active",
    createdAt: now,
    updatedAt: now,
    nodeType: "function",
    description,
    instruction: description,
    tags: [],
    children: [],
    allowedToolIds: [],
    allowedSystemIds: [],
    metadata,
  }
}

function mergeExecutorNodeMetadata(
  metadata: ExecutorNodeV2["metadata"],
  executor: ExecutorDraft,
): ExecutorNodeV2["metadata"] | undefined {
  const next = { ...(metadata ?? {}) }
  if (executor.userConfirmed) {
    next.understanding = {
      userConfirmed: true,
      ...(executor.confirmedUnderstandingVersion ? { version: executor.confirmedUnderstandingVersion } : {}),
    }
  } else {
    delete next.understanding
  }
  return Object.keys(next).length > 0 ? next : undefined
}

function executorUnderstandingConfirmed(metadata: ExecutorNodeV2["metadata"]): { version?: string } | null {
  const record = executorUnderstandingRecord(metadata)
  if (record?.userConfirmed !== true) return null
  return typeof record.version === "string" && record.version.trim()
    ? { version: record.version.trim() }
    : {}
}

function executorUnderstandingMetadata(metadata: ExecutorNodeV2["metadata"]): EnterpriseMetadataValue | undefined {
  const record = executorUnderstandingRecord(metadata)
  if (!record) return undefined
  const result: EnterpriseMetadata = {}
  if (record.userConfirmed === true) result.userConfirmed = true
  if (typeof record.version === "string" && record.version.trim()) result.version = record.version.trim()
  return Object.keys(result).length > 0 ? result : undefined
}

function executorUnderstandingRecord(metadata: ExecutorNodeV2["metadata"]): Record<string, unknown> | undefined {
  if (!metadata || typeof metadata.understanding !== "object" || metadata.understanding === null || Array.isArray(metadata.understanding)) {
    return undefined
  }
  return metadata.understanding as Record<string, unknown>
}

function nextExecutorNodeId(topology: ExecutorTopologyV2, now: number | string): string {
  const usedIds = new Set(topology.nodes.map((node) => node.id))
  const timestamp = typeof now === "number" ? now : Date.parse(now) || Date.now()
  let suffix = topology.nodes.length + 1
  let id = `node:executor-${timestamp}-${suffix}`
  while (usedIds.has(id)) {
    suffix += 1
    id = `node:executor-${timestamp}-${suffix}`
  }
  return id
}

function nextExecutorEdgeId(
  topology: ExecutorTopologyV2,
  sourceNodeId: string,
  targetNodeId: string,
  now: number | string,
): string {
  const usedIds = new Set(topology.edges.map((edge) => edge.id))
  const timestamp = typeof now === "number" ? now : Date.parse(now) || Date.now()
  let suffix = topology.edges.length + 1
  let id = `edge:${sourceNodeId}:${targetNodeId}:${timestamp}:${suffix}`
  while (usedIds.has(id)) {
    suffix += 1
    id = `edge:${sourceNodeId}:${targetNodeId}:${timestamp}:${suffix}`
  }
  return id
}

function nextExecutorPosition(index: number): ExecutorNodeV2["position"] {
  return {
    x: 120 + (index % 3) * 320,
    y: 80 + Math.floor(index / 3) * 210,
  }
}
