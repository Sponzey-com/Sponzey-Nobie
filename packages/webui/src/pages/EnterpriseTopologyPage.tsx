import * as React from "react"
import { useEffect, useMemo, useState } from "react"
import type { Connection } from "@xyflow/react"
import { api } from "../api/client"
import { buildEnterpriseTopologyCanvasModel } from "../components/topology/EnterpriseTopologyCanvas"
import {
  createEmptyEnterpriseTopologyForPalette,
  createEnterpriseTopologyPaletteEntity,
  type EnterpriseTopologyPaletteKind,
} from "../components/topology/EnterpriseTopologyPalette"
import type { EnterpriseTopology, EnterpriseTopologyValidationIssue } from "../contracts/enterprise-topology"
import type { EnterpriseRelationType } from "../contracts/enterprise-topology"
import type { AgentTopologyProjection } from "../contracts/topology"
import type { RootRun } from "../contracts/runs"
import type { TopologyRelationTemplateCatalog } from "../contracts/relation-templates"
import type { TopologyTemplateCatalog } from "../contracts/topology-templates"
import { useUiI18n } from "../lib/ui-i18n"
import {
  type TopologyWorkspaceExposureMode,
} from "../lib/topology-workspace-copy"
import {
  buildEnterpriseTopologyRelationDraft,
  type EnterpriseRelationModeIssue,
  type TopologyRelationModeId,
} from "../components/topology/RelationModeToolbar"
import {
  buildTopologyRunRequestPayload,
  resolveTopologyRunTargetState,
} from "../components/topology/TopologyRunLauncher"
import { ExecutorCreatePanel, type ExecutorCreatePanelSubmit } from "../components/topology/ExecutorCreatePanel"
import { ExecutorWorkspaceShell } from "../components/topology/ExecutorWorkspaceShell"
import type { TopologyRunTraceOverlayInput } from "../components/topology/TopologyRunTraceOverlay"
import { TopologyWorkspaceCanvas } from "../components/topology/TopologyWorkspaceCanvas"
import {
  applyTopologyWorkspaceExecutorMappingToNode,
  type TopologyWorkspaceExecutorMapping,
} from "../components/topology/TopologyWorkspaceInspector"
import { createExecutorDraftFromInference } from "../lib/executor-inference"
import { createExecutorConnectionDraft } from "../lib/executor-relation-inference"
import {
  buildExecutorGraphFromEnterpriseTopology,
  compileExecutorGraphToEnterpriseTopology,
  type ExecutorDraft,
  type ExecutorGraphWorkspace,
} from "../lib/executor-graph"
import type { TopologyWorkspaceLayer } from "../lib/topology-workspace"
import { TOPOLOGY_WORKSPACE_STARTER_TEMPLATES, buildTopologyWorkspaceStarterDraft, type TopologyWorkspaceStarterTemplateId } from "../lib/topology-workspace-templates"
import type {
  EnterpriseTopologyGuiDraftRunRequest,
  EnterpriseTopologyGuiDraftCompiledPreviewResponse,
  EnterpriseTopologyGuiOperation,
  EnterpriseTopologyRunRecord,
  WorkOrderTemplateCatalog,
  WorkOrderTemplateSimulationMode,
} from "../lib/enterprise-topology-operations"

const DRAFT_TOPOLOGY_OPTIONS = [
  {
    id: "workspace:draft",
    labelKo: "첫 토폴로지",
    labelEn: "First topology",
  },
]

function topologyUpdatedAt(topology: EnterpriseTopology | null | undefined): number {
  return typeof topology?.updatedAt === "number" && Number.isFinite(topology.updatedAt)
    ? topology.updatedAt
    : 0
}

export function sameTopologyRuntimeIds(current: string[], next: string[]): boolean {
  if (current.length !== next.length) return false
  return current.every((value, index) => value === next[index])
}

export function topologyRunningStatusMap(ids: string[]): Record<string, "running"> {
  return ids.reduce<Record<string, "running">>((statuses, id) => {
    statuses[id] = "running"
    return statuses
  }, {})
}

function applyExecutorDraftToTopology(
  current: EnterpriseTopology,
  executor: ExecutorDraft,
  now = Date.now(),
): EnterpriseTopology {
  const graph = buildExecutorGraphFromEnterpriseTopology(current, { mode: "simple", now })
  const nextGraph: ExecutorGraphWorkspace = {
    ...graph,
    executors: graph.executors.map((item) =>
      item.id === executor.id || item.sourceNodeId === executor.sourceNodeId
        ? {
          ...executor,
          sourceNodeId: item.sourceNodeId ?? executor.sourceNodeId ?? item.id,
          position: executor.position ?? item.position,
        }
        : item
    ),
    selectedId: executor.id,
    inference: {
      ...graph.inference,
      confidence: executor.confidence,
      generatedAt: now,
    },
  }
  const compiled = compileExecutorGraphToEnterpriseTopology(nextGraph, {
    baseTopology: current,
    now,
  })
  return compiled.ok ? compiled.topology : current
}

export function shouldRestoreServerTopology(
  current: EnterpriseTopology | null,
  restored: EnterpriseTopology,
): boolean {
  if (!current) return true
  if (current.id !== restored.id) return true
  const currentUpdatedAt = topologyUpdatedAt(current)
  const restoredUpdatedAt = topologyUpdatedAt(restored)
  if (restoredUpdatedAt > currentUpdatedAt) return true
  if (current.nodes.length === 0 && restored.nodes.length > 0 && restoredUpdatedAt >= currentUpdatedAt) return true
  return false
}

export function LegacyEnterpriseTopologyPage({
  workspaceLayer = "build",
  workspaceExposureMode: _workspaceExposureMode = "simple",
  onWorkspaceLayerChange,
}: {
  workspaceLayer?: TopologyWorkspaceLayer
  workspaceExposureMode?: TopologyWorkspaceExposureMode
  onWorkspaceLayerChange?: (layer: TopologyWorkspaceLayer) => void
} = {}) {
  const { text } = useUiI18n()
  const [topologyId, setTopologyId] = useState(DRAFT_TOPOLOGY_OPTIONS[0].id)
  const [draftTopology, setDraftTopology] = useState<EnterpriseTopology | null>(null)
  const [templateCatalog, setTemplateCatalog] = useState<TopologyTemplateCatalog | null>(null)
  const [relationCatalog, setRelationCatalog] = useState<TopologyRelationTemplateCatalog | null>(null)
  const [workOrderTemplateCatalog, setWorkOrderTemplateCatalog] = useState<WorkOrderTemplateCatalog | null>(null)
  const [runtimeResources, setRuntimeResources] = useState<AgentTopologyProjection | null>(null)
  const [templateCatalogStatus, setTemplateCatalogStatus] = useState<"loading" | "ready" | "failed">("loading")
  const [relationCatalogStatus, setRelationCatalogStatus] = useState<"loading" | "ready" | "failed">("loading")
  const [workOrderTemplateStatus, setWorkOrderTemplateStatus] = useState<"loading" | "ready" | "failed">("loading")
  const [runtimeResourceStatus, setRuntimeResourceStatus] = useState<"loading" | "ready" | "failed">("loading")
  const [selectedRelationType, setSelectedRelationType] = useState<EnterpriseRelationType>("delegates_to")
  const [selectedRelationMode, setSelectedRelationMode] = useState<TopologyRelationModeId>("smart_connect")
  const [relationIssue, setRelationIssue] = useState<EnterpriseRelationModeIssue | null>(null)
  const [draftIssues, setDraftIssues] = useState<EnterpriseTopologyValidationIssue[]>([])
  const [draftApiStatus, setDraftApiStatus] = useState<"idle" | "syncing" | "ready" | "failed">("idle")
  const [compilePreview, setCompilePreview] =
    useState<EnterpriseTopologyGuiDraftCompiledPreviewResponse | null>(null)
  const [compilePreviewLoading, setCompilePreviewLoading] = useState(false)
  const [runTargetNodeId, setRunTargetNodeId] = useState<string | null>(null)
  const [selectedWorkOrderTemplateId, setSelectedWorkOrderTemplateId] = useState<string>("")
  const [selectedContextPresetId, setSelectedContextPresetId] = useState<string>("")
  const [simulationMode, setSimulationMode] = useState<WorkOrderTemplateSimulationMode>("success")
  const [advancedInstruction, setAdvancedInstruction] = useState("")
  const [executorCreateOpen, setExecutorCreateOpen] = useState(false)
  const [selectedExecutorId, setSelectedExecutorId] = useState<string | null>(null)
  const [topologyRunLoading, setTopologyRunLoading] = useState(false)
  const [runningExecutorIds, setRunningExecutorIds] = useState<string[]>([])
  const [runningEdgeIds, setRunningEdgeIds] = useState<string[]>([])
  const [runtimeActiveExecutorIds, setRuntimeActiveExecutorIds] = useState<string[]>([])
  const [runtimeActiveEdgeIds, setRuntimeActiveEdgeIds] = useState<string[]>([])
  const [traceOverlay, setTraceOverlay] = useState<TopologyRunTraceOverlayInput | null>(null)
  const [runHistory, setRunHistory] = useState<EnterpriseTopologyRunRecord[]>([])
  const [traceOverlayByRunId, setTraceOverlayByRunId] = useState<Record<string, TopologyRunTraceOverlayInput>>({})
  const model = useMemo(
    () => buildEnterpriseTopologyCanvasModel(draftTopology, draftIssues, relationCatalog),
    [draftTopology, draftIssues, relationCatalog],
  )
  const runTargetState = useMemo(
    () => resolveTopologyRunTargetState({
      topology: draftTopology,
      currentTargetNodeId: runTargetNodeId,
    }),
    [draftTopology, runTargetNodeId],
  )
  const visibleActiveExecutorIds = topologyRunLoading ? runningExecutorIds : runtimeActiveExecutorIds
  const visibleActiveEdgeIds = topologyRunLoading ? runningEdgeIds : runtimeActiveEdgeIds
  const visibleExecutorStatuses = useMemo(
    () => topologyRunningStatusMap(visibleActiveExecutorIds),
    [visibleActiveExecutorIds],
  )
  const visibleEdgeStatuses = useMemo(
    () => topologyRunningStatusMap(visibleActiveEdgeIds),
    [visibleActiveEdgeIds],
  )

  useEffect(() => {
    if (runTargetState.source !== "auto_entry" || !runTargetState.targetNodeId) return
    if (runTargetNodeId === runTargetState.targetNodeId) return
    setRunTargetNodeId(runTargetState.targetNodeId)
  }, [runTargetNodeId, runTargetState.source, runTargetState.targetNodeId])

  useEffect(() => {
    let cancelled = false
    api.enterpriseTopologyGuiDraft(topologyId)
      .then((response) => {
        if (cancelled) return
        if (!response.draft) return
        const restoredTopology = response.draft.topology
        setDraftTopology((current) =>
          shouldRestoreServerTopology(current, restoredTopology) ? restoredTopology : current
        )
        setDraftIssues((current) => current.length > 0 ? current : response.draft.validation.issues)
        setRunTargetNodeId((current) =>
          current && restoredTopology.nodes.some((node) => node.id === current)
            ? current
            : restoredTopology.nodes[0]?.id ?? null
        )
        setSelectedExecutorId((current) =>
          current && restoredTopology.nodes.some((node) => node.id === current)
            ? current
            : restoredTopology.nodes[0]?.id ?? null
        )
      })
      .catch(() => {
        if (cancelled) return
      })
    return () => {
      cancelled = true
    }
  }, [topologyId])

  useEffect(() => {
    let cancelled = false
    api.topologyTemplates()
      .then((response) => {
        if (cancelled) return
        setTemplateCatalog(response.catalog)
        setTemplateCatalogStatus("ready")
      })
      .catch(() => {
        if (cancelled) return
        setTemplateCatalogStatus("failed")
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    api.workOrderTemplates()
      .then((response) => {
        if (cancelled) return
        setWorkOrderTemplateCatalog(response.catalog)
        const first = response.templates[0]
        if (first) {
          setSelectedWorkOrderTemplateId((current) => current || first.templateId)
          setSelectedContextPresetId((current) => current || first.contextPresets[0]?.id || "")
          setSimulationMode(first.defaultSimulationMode)
        }
        setWorkOrderTemplateStatus("ready")
      })
      .catch(() => {
        if (cancelled) return
        setWorkOrderTemplateStatus("failed")
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    api.relationTemplates()
      .then((response) => {
        if (cancelled) return
        setRelationCatalog(response.catalog)
        setRelationCatalogStatus("ready")
      })
      .catch(() => {
        if (cancelled) return
        setRelationCatalogStatus("failed")
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    api.agentTopology()
      .then((response) => {
        if (cancelled) return
        setRuntimeResources(response)
        setRuntimeResourceStatus("ready")
      })
      .catch(() => {
        if (cancelled) return
        setRuntimeResources(null)
        setRuntimeResourceStatus("failed")
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setInterval> | undefined

    const refreshActiveTopologyRuns = async () => {
      if (!draftTopology) {
        setRuntimeActiveExecutorIds((current) => sameTopologyRuntimeIds(current, []) ? current : [])
        setRuntimeActiveEdgeIds((current) => sameTopologyRuntimeIds(current, []) ? current : [])
        return
      }
      try {
        const response = await api.runs()
        if (cancelled) return
        const active = runtimeActiveStateFromRuns(response.runs, draftTopology)
        setRuntimeActiveExecutorIds((current) =>
          sameTopologyRuntimeIds(current, active.executorIds) ? current : active.executorIds
        )
        setRuntimeActiveEdgeIds((current) =>
          sameTopologyRuntimeIds(current, active.edgeIds) ? current : active.edgeIds
        )
      } catch {
        if (cancelled) return
        setRuntimeActiveExecutorIds((current) => sameTopologyRuntimeIds(current, []) ? current : [])
        setRuntimeActiveEdgeIds((current) => sameTopologyRuntimeIds(current, []) ? current : [])
      }
    }

    void refreshActiveTopologyRuns()
    timer = setInterval(() => {
      void refreshActiveTopologyRuns()
    }, 2500)

    return () => {
      cancelled = true
      if (timer) clearInterval(timer)
    }
  }, [draftTopology])

  useEffect(() => {
    let cancelled = false
    if (!draftTopology) {
      setDraftIssues([])
      setCompilePreview(null)
      setCompilePreviewLoading(false)
      setDraftApiStatus("idle")
      return () => {
        cancelled = true
      }
    }

    setDraftApiStatus("syncing")
    setCompilePreview(null)
    setCompilePreviewLoading(false)
    api.startEnterpriseTopologyGuiDraft(draftTopology.id, { topology: draftTopology, reset: true })
      .then(() => api.enterpriseTopologyGuiDraftIssues(draftTopology.id))
      .then(async (response) => {
        if (cancelled) return
        setDraftIssues(response.issues)
        setDraftApiStatus("ready")
        if (!response.validation.executable) return
        setCompilePreviewLoading(true)
        try {
          const preview = await api.enterpriseTopologyGuiDraftCompiledPreview(draftTopology.id)
          if (!cancelled) setCompilePreview(preview)
        } catch {
          if (!cancelled) setCompilePreview(null)
        } finally {
          if (!cancelled) setCompilePreviewLoading(false)
        }
      })
      .catch(() => {
        if (cancelled) return
        setDraftIssues([])
        setCompilePreview(null)
        setCompilePreviewLoading(false)
        setDraftApiStatus("failed")
      })

    return () => {
      cancelled = true
    }
  }, [draftTopology])

  const handleCreateEntity = (kind: EnterpriseTopologyPaletteKind, templateId?: string) => {
    setCompilePreview(null)
    setTraceOverlay(null)
    setDraftTopology((current) => {
      const base = current ?? createEmptyEnterpriseTopologyForPalette({
        topologyId,
        name: text("기업 업무 구조 초안", "Enterprise work model draft"),
      })
      return createEnterpriseTopologyPaletteEntity(base, { kind, ...(templateId ? { templateId } : {}) }, templateCatalog).topology
    })
  }

  const addExecutorToDraft = (input: Pick<ExecutorCreatePanelSubmit, "name" | "description" | "userConfirmed">) => {
    const now = Date.now()
    const base = draftTopology ?? createEmptyEnterpriseTopologyForPalette({
      topologyId,
      name: text("기업 업무 구조 초안", "Enterprise work model draft"),
      now,
    })
    const nodeId = nextExecutorNodeId(base)
    const graph = buildExecutorGraphFromEnterpriseTopology(base, { mode: "simple", now })
    const executor = createExecutorDraftFromInference({
      id: nodeId,
      sourceNodeId: nodeId,
      name: input.name,
      description: input.description,
      now,
      userConfirmed: input.userConfirmed,
    })
    const nextGraph = {
      ...graph,
      executors: [...graph.executors, executor],
      selectedId: executor.id,
      inference: {
        ...graph.inference,
        executorCount: graph.executors.length + 1,
        issueCount: 0,
        generatedAt: now,
      },
    }
    const compiled = compileExecutorGraphToEnterpriseTopology(nextGraph, {
      baseTopology: base,
      now,
    })
    if (!compiled.ok) {
      setDraftApiStatus("failed")
      return
    }
    setCompilePreview(null)
    setTraceOverlay(null)
    setRelationIssue(null)
    setDraftTopology(compiled.topology)
    setRunTargetNodeId((current) => current ?? nodeId)
    setSelectedExecutorId(executor.id)
    setExecutorCreateOpen(false)
  }

  const handleCreateInferredExecutor = (input: ExecutorCreatePanelSubmit) => {
    addExecutorToDraft(input)
  }

  const handleAddExecutorNode = () => {
    const nextIndex = (draftTopology?.nodes.length ?? 0) + 1
    addExecutorToDraft({
      name: text(`새 노드 ${nextIndex}`, `New node ${nextIndex}`),
      description: text(
        "오른쪽 카드에서 이 노드의 성격과 하는 일을 정합니다.",
        "Define this node's character and work in the card on the right.",
      ),
      userConfirmed: false,
    })
  }

  const handleCreateStarterTopology = (templateId: TopologyWorkspaceStarterTemplateId) => {
    setCompilePreview(null)
    setTraceOverlay(null)
    setRelationIssue(null)
    const starterTemplate = TOPOLOGY_WORKSPACE_STARTER_TEMPLATES.find((template) => template.id === templateId)
    const starter = buildTopologyWorkspaceStarterDraft(templateId, {
      topologyId,
      name: text("첫 토폴로지", "First topology"),
      now: Date.now(),
    })
    if (starterTemplate) {
      const workOrderTemplate = workOrderTemplateCatalog?.templates.find((template) =>
        template.templateId === starterTemplate.defaultWorkOrderTemplateId
      )
      setSelectedWorkOrderTemplateId(starterTemplate.defaultWorkOrderTemplateId)
      setSelectedContextPresetId(starterTemplate.defaultContextPresetId)
      setSimulationMode(workOrderTemplate?.defaultSimulationMode ?? starterTemplate.defaultSimulationMode)
    }
    setDraftTopology(starter)
    setRunTargetNodeId(starter.nodes[0]?.id ?? null)
    setSelectedExecutorId(starter.nodes[0]?.id ?? null)
  }

  const handleCreateRelation = (connection: Connection, relationMode: TopologyRelationModeId) => {
    if (!connection.source || !connection.target) return
    setCompilePreview(null)
    setTraceOverlay(null)
    setDraftTopology((current) => {
      const base = current ?? createEmptyEnterpriseTopologyForPalette({
        topologyId,
        name: text("기업 업무 구조 초안", "Enterprise work model draft"),
      })
      const result = buildEnterpriseTopologyRelationDraft({
        topology: base,
        sourceNodeId: connection.source!,
        targetNodeId: connection.target!,
        relationMode,
        catalog: relationCatalog,
      })
      if (!result.ok) {
        setRelationIssue(result.issue)
        return base
      }
      setRelationIssue(null)
      return result.topology
    })
  }

  const persistAndValidateDraft = async (topology: EnterpriseTopology) => {
    setDraftApiStatus("syncing")
    setCompilePreview(null)
    try {
      const saved = await api.startEnterpriseTopologyGuiDraft(topology.id, {
        topology,
        reset: true,
        persist: true,
        importSource: "enterprise_topology_simple_builder",
      })
      if (saved.persisted === false) {
        setDraftIssues(saved.draft?.validation.issues ?? [])
        setDraftApiStatus("failed")
        return
      }
      const response = await api.validateEnterpriseTopologyGuiDraft(topology.id)
      setDraftIssues(response.issues)
      setDraftApiStatus("ready")
    } catch {
      setDraftApiStatus("failed")
    }
  }

  const handleValidateDraft = async () => {
    if (!draftTopology) return
    await persistAndValidateDraft(draftTopology)
  }

  const handleCompileDraft = async () => {
    if (!draftTopology) return
    setDraftApiStatus("syncing")
    setCompilePreviewLoading(true)
    try {
      await api.startEnterpriseTopologyGuiDraft(draftTopology.id, { topology: draftTopology, reset: true })
      const response = await api.compileEnterpriseTopologyGuiDraft(draftTopology.id)
      setDraftIssues(response.validation.issues)
      setCompilePreview(response)
      setDraftApiStatus("ready")
    } catch {
      setCompilePreview(null)
      setDraftApiStatus("failed")
    } finally {
      setCompilePreviewLoading(false)
    }
  }

  const handleApplyQuickFix = async (operations: EnterpriseTopologyGuiOperation[]) => {
    if (!draftTopology || operations.length === 0) return
    setDraftApiStatus("syncing")
    setCompilePreview(null)
    try {
      let response
      try {
        response = await api.patchEnterpriseTopologyGuiDraftOperations(draftTopology.id, { operations })
      } catch {
        await api.startEnterpriseTopologyGuiDraft(draftTopology.id, { topology: draftTopology, reset: true })
        response = await api.patchEnterpriseTopologyGuiDraftOperations(draftTopology.id, { operations })
      }
      setDraftTopology(response.draft.topology)
      setDraftIssues(response.validation.issues)
      setDraftApiStatus("ready")
    } catch {
      setDraftApiStatus("failed")
    }
  }

  const handleSelectWorkOrderTemplate = (templateId: string) => {
    const template = workOrderTemplateCatalog?.templates.find((item) => item.templateId === templateId)
    setSelectedWorkOrderTemplateId(templateId)
    setSelectedContextPresetId(template?.contextPresets[0]?.id ?? "")
    setSimulationMode(template?.defaultSimulationMode ?? "success")
  }

  const handleRunStartNodeQuickFix = () => {
    const firstEntryNodeId = runTargetState.entryNodeIds[0]
    if (firstEntryNodeId) {
      setRunTargetNodeId(firstEntryNodeId)
      return
    }
    handleCreateEntity("task")
  }

  const handleExecutorMappingChange = (nodeId: string, mapping: TopologyWorkspaceExecutorMapping) => {
    setCompilePreview(null)
    setTraceOverlay(null)
    setDraftTopology((current) => {
      if (!current) return current
      const now = Date.now()
      return {
        ...current,
        nodes: current.nodes.map((node) =>
          node.id === nodeId ? applyTopologyWorkspaceExecutorMappingToNode(node, mapping) : node
        ),
        updatedAt: now,
      }
    })
  }

  const handleExecutorDraftChange = (executor: ExecutorDraft) => {
    setCompilePreview(null)
    setTraceOverlay(null)
    setDraftTopology((current) => {
      if (!current) return current
      return applyExecutorDraftToTopology(current, executor)
    })
  }

  const handleExecutorUnderstandingSave = async (executor: ExecutorDraft) => {
    if (!draftTopology) {
      handleExecutorDraftChange(executor)
      return
    }
    const nextTopology = applyExecutorDraftToTopology(draftTopology, executor)
    setCompilePreview(null)
    setTraceOverlay(null)
    setDraftTopology(nextTopology)
    await persistAndValidateDraft(nextTopology)
  }

  const handleConnectExecutors = (sourceExecutorId: string, targetExecutorId: string) => {
    if (sourceExecutorId === targetExecutorId) return
    setCompilePreview(null)
    setTraceOverlay(null)
    setRelationIssue(null)
    setSelectedExecutorId(targetExecutorId)
    setDraftTopology((current) => {
      if (!current) return current
      const now = Date.now()
      const graph = buildExecutorGraphFromEnterpriseTopology(current, { mode: "simple", now })
      const source = graph.executors.find((executor) =>
        executor.id === sourceExecutorId || executor.sourceNodeId === sourceExecutorId
      )
      const target = graph.executors.find((executor) =>
        executor.id === targetExecutorId || executor.sourceNodeId === targetExecutorId
      )
      if (!source || !target) return current
      const sourceNodeId = source.sourceNodeId ?? source.id
      const targetNodeId = target.sourceNodeId ?? target.id
      if (graph.connections.some((connection) =>
        connection.fromExecutorId === sourceNodeId && connection.toExecutorId === targetNodeId
      )) {
        return current
      }
      const connection = createExecutorConnectionDraft({
        source: { ...source, id: sourceNodeId },
        target: { ...target, id: targetNodeId },
      })
      const nextGraph = {
        ...graph,
        connections: [...graph.connections, connection],
        selectedId: targetNodeId,
        inference: {
          ...graph.inference,
          connectionCount: graph.connections.length + 1,
          generatedAt: now,
        },
      }
      const compiled = compileExecutorGraphToEnterpriseTopology(nextGraph, {
        baseTopology: current,
        now,
      })
      return compiled.ok ? compiled.topology : current
    })
  }

  const handleMoveExecutorNode = (executorId: string, position: { x: number; y: number }) => {
    setCompilePreview(null)
    setTraceOverlay(null)
    setDraftTopology((current) => {
      if (!current) return current
      const now = Date.now()
      const graph = buildExecutorGraphFromEnterpriseTopology(current, { mode: "simple", now })
      let changed = false
      const nextGraph = {
        ...graph,
        executors: graph.executors.map((executor) => {
          if (executor.id !== executorId && executor.sourceNodeId !== executorId) return executor
          if (executor.position?.x === position.x && executor.position.y === position.y) return executor
          changed = true
          return { ...executor, position }
        }),
        selectedId: executorId,
        inference: {
          ...graph.inference,
          generatedAt: now,
        },
      }
      if (!changed) return current
      const compiled = compileExecutorGraphToEnterpriseTopology(nextGraph, {
        baseTopology: current,
        now,
      })
      return compiled.ok ? compiled.topology : current
    })
  }

  const handleSelectExecutor = (executorId: string | null) => {
    setSelectedExecutorId(executorId)
  }

  const handleDeleteSelectedExecutor = () => {
    if (!draftTopology || draftTopology.nodes.length === 0) return
    const now = Date.now()
    const graph = buildExecutorGraphFromEnterpriseTopology(draftTopology, { mode: "simple", now })
    const targetExecutor =
      graph.executors.find((executor) => executor.id === selectedExecutorId) ??
      graph.executors[0] ??
      null
    if (!targetExecutor) return
    const nodeId = targetExecutor.sourceNodeId ?? targetExecutor.id
    setCompilePreview(null)
    setTraceOverlay(null)
    setRelationIssue(null)
    setSelectedExecutorId(null)
    setRunTargetNodeId((currentTarget) => currentTarget === nodeId ? null : currentTarget)
    setDraftTopology({
      ...draftTopology,
      updatedAt: now,
      nodes: draftTopology.nodes.filter((node) => node.id !== nodeId),
      teams: draftTopology.teams.map((team) => ({
        ...team,
        nodeIds: team.nodeIds.filter((id) => id !== nodeId),
        updatedAt: now,
      })),
      processes: draftTopology.processes.map((process) => {
        const nextProcess = {
          ...process,
          stepNodeIds: process.stepNodeIds.filter((id) => id !== nodeId),
          updatedAt: now,
        }
        if (process.ownerNodeId !== nodeId) return nextProcess
        const { ownerNodeId: _ownerNodeId, ...withoutOwner } = nextProcess
        return withoutOwner
      }),
      authorityRules: draftTopology.authorityRules.filter((rule) =>
        !entityRefMatchesNode(rule.subject, nodeId) && !entityRefMatchesNode(rule.object, nodeId)
      ),
      responsibilities: draftTopology.responsibilities.filter((responsibility) =>
        !entityRefMatchesNode(responsibility.scope, nodeId) &&
        !entityRefMatchesNode(responsibility.responsible, nodeId) &&
        !entityRefMatchesNode(responsibility.accountable, nodeId) &&
        !responsibility.consulted.some((ref) => entityRefMatchesNode(ref, nodeId)) &&
        !responsibility.informed.some((ref) => entityRefMatchesNode(ref, nodeId))
      ),
      relations: draftTopology.relations.filter((relation) =>
        !entityRefMatchesNode(relation.from, nodeId) && !entityRefMatchesNode(relation.to, nodeId)
      ),
    })
  }

  const handleSelectRunHistory = (topologyRunId: string) => {
    const overlay = traceOverlayByRunId[topologyRunId]
    if (overlay) setTraceOverlay(overlay)
  }

  const handleRunTopology = async (payloadOverride?: EnterpriseTopologyGuiDraftRunRequest) => {
    const entryNodeId = payloadOverride?.entryNodeId ?? runTargetState.targetNodeId ?? runTargetNodeId
    const templateId = payloadOverride?.templateId ?? selectedWorkOrderTemplateId
    if (!draftTopology || !entryNodeId || !templateId) return
    const graph = buildExecutorGraphFromEnterpriseTopology(draftTopology, { mode: "simple" })
    setRunningExecutorIds(executorRunPathIds(graph, entryNodeId))
    setRunningEdgeIds(executorRunPathEdgeIds(graph, entryNodeId))
    setTopologyRunLoading(true)
    try {
      await api.startEnterpriseTopologyGuiDraft(draftTopology.id, { topology: draftTopology, reset: true })
      await api.createEnterpriseTopologyGuiDraftExecutionPlan(draftTopology.id)
      const payload = payloadOverride ?? buildTopologyRunRequestPayload({
        entryNodeId,
        templateId,
        ...(selectedContextPresetId ? { contextPresetId: selectedContextPresetId } : {}),
        simulationMode,
        advancedInstruction,
      })
      const run = await api.runEnterpriseTopologyGuiDraft(draftTopology.id, payload)
      const [trace, failures] = await Promise.all([
        api.topologyRunTrace(run.topologyRunId),
        api.topologyRunFailureReports(run.topologyRunId),
      ])
      const overlay = {
        run: run.topologyRun.run,
        traceEvents: trace.traceEvents,
        toolCalls: run.topologyRun.toolCalls,
        failureReports: failures.failureReports,
        observedEdges: run.topologyRun.observedEdges,
        gapFindings: run.topologyRun.gapFindings,
      }
      setTraceOverlay(overlay)
      setTraceOverlayByRunId((current) => ({ ...current, [run.topologyRunId]: overlay }))
      setRunHistory((current) => [
        run.topologyRun.run,
        ...current.filter((item) => item.topologyRunId !== run.topologyRunId),
      ].slice(0, 5))
    } catch {
      setTraceOverlay(null)
    } finally {
      setTopologyRunLoading(false)
      setRunningExecutorIds([])
      setRunningEdgeIds([])
    }
  }

  const validationBadgeLabel =
    draftApiStatus === "syncing"
      ? text("동기화 중", "Syncing")
      : draftApiStatus === "failed"
        ? text("검증 연결 실패", "Validation offline")
        : !draftTopology
          ? text("검증 대기", "Ready for validation")
          : draftIssues.length === 0
            ? text("검증 통과", "Validation passed")
            : text(`${draftIssues.length}개 이슈`, `${draftIssues.length} issues`)

  const simpleEmptyStart = workspaceLayer === "build" && (!draftTopology || model.nodes.length === 0)
  const simpleCreatePanel = (simpleEmptyStart || executorCreateOpen) ? (
    <ExecutorCreatePanel
      titleKo="실행자 이름과 성격 정하기"
      titleEn="Define the executor"
      helperKo="첫 화면에서는 이것만 정합니다. 어떤 이름의 실행자가 어떤 성격으로 일할지만 적어 주세요."
      helperEn="Start with this only. Enter the executor name and the character of how it works."
      descriptionLabelKo="성격과 하는 일"
      descriptionLabelEn="Character and work"
      descriptionPlaceholderKo="예: 고객 문의를 차분하게 정리하고 CRM을 확인하는 담당자"
      descriptionPlaceholderEn="e.g. Calmly triages customer requests and checks CRM."
      showCancel={!simpleEmptyStart}
      showDraftButton={false}
      showExamples={false}
      hideUnderstandingUntilReady
      surface="card"
      workspaceId={topologyId}
      topologyId={topologyId}
      onCreate={handleCreateInferredExecutor}
      onCancel={() => setExecutorCreateOpen(false)}
    />
  ) : null
  const content = (
    <div className="flex h-full flex-col bg-stone-100 text-stone-950">
      <TopologyWorkspaceCanvas
        topologyId={topologyId}
        selectedLayer={workspaceLayer}
        exposureMode="simple"
        topology={draftTopology}
        runtimeResources={runtimeResources}
        validationIssues={draftIssues}
        templateCatalog={templateCatalog}
        onCreateEntity={handleCreateEntity}
        relationCatalog={relationCatalog}
        selectedRelationType={selectedRelationType}
        selectedRelationMode={selectedRelationMode}
        onSelectRelationType={setSelectedRelationType}
        onSelectRelationMode={setSelectedRelationMode}
        relationIssue={relationIssue}
        onCreateRelation={handleCreateRelation}
        compilePreview={compilePreview}
        compilePreviewLoading={compilePreviewLoading}
        onApplyQuickFix={handleApplyQuickFix}
        traceOverlay={traceOverlay}
        runTargetNodeId={runTargetNodeId}
        onRunTargetChange={setRunTargetNodeId}
        onSelectedRunnableTargetChange={setRunTargetNodeId}
        onExecutorMappingChange={handleExecutorMappingChange}
        onExecutorDraftChange={handleExecutorDraftChange}
        onExecutorUnderstandingConfirm={handleExecutorUnderstandingSave}
        onExecutorConnect={handleConnectExecutors}
        onExecutorMove={handleMoveExecutorNode}
        activeExecutorIds={visibleActiveExecutorIds}
        activeEdgeIds={visibleActiveEdgeIds}
        executorStatuses={visibleExecutorStatuses}
        edgeStatuses={visibleEdgeStatuses}
        selectedExecutorId={selectedExecutorId}
        onSelectedExecutorChange={handleSelectExecutor}
        onRunLayerRequest={() => onWorkspaceLayerChange?.("run")}
        simpleCreatePanel={simpleCreatePanel}
      />
    </div>
  )

  return (
    <ExecutorWorkspaceShell
      selectedLayer={workspaceLayer}
      savedStatusLabel={text("저장됨", "Saved")}
      validationLabel={validationBadgeLabel}
      executorCount={draftTopology?.nodes.length ?? 0}
      connectionCount={draftTopology?.relations.length ?? 0}
      showFirstStart={false}
      showLeftRail={false}
      validateDisabled={!draftTopology || draftApiStatus === "syncing"}
      prepareRunDisabled={!draftTopology}
      saveDisabled={!draftTopology}
      deleteDisabled={!draftTopology || draftTopology.nodes.length === 0}
      onSelectLayer={onWorkspaceLayerChange}
      onValidate={handleValidateDraft}
      onPrepareRun={() => onWorkspaceLayerChange?.("run")}
      onSaveDraft={handleValidateDraft}
      onAddExecutor={handleAddExecutorNode}
      onDeleteExecutor={handleDeleteSelectedExecutor}
      onAddSection={() => handleCreateEntity("group")}
      onStartRecommendedFlow={() => handleCreateStarterTopology("customer-request-flow")}
    >
      {content}
    </ExecutorWorkspaceShell>
  )
}

export const EnterpriseTopologyPage = LegacyEnterpriseTopologyPage

function nextExecutorNodeId(topology: EnterpriseTopology): string {
  const used = new Set(topology.nodes.map((node) => node.id))
  let index = topology.nodes.length + 1
  while (used.has(`node:executor-${index}`)) index += 1
  return `node:executor-${index}`
}

function executorRunPathIds(graph: ExecutorGraphWorkspace, startExecutorId: string): string[] {
  const executorIds = new Set(graph.executors.map((executor) => executor.id))
  const start = executorIds.has(startExecutorId)
    ? startExecutorId
    : graph.executors.find((executor) => executor.sourceNodeId === startExecutorId)?.id
  if (!start) return []

  const outgoing = new Map<string, string[]>()
  for (const connection of graph.connections) {
    outgoing.set(connection.fromExecutorId, [
      ...(outgoing.get(connection.fromExecutorId) ?? []),
      connection.toExecutorId,
    ])
  }

  const visited = new Set<string>()
  const queue = [start]
  while (queue.length > 0) {
    const current = queue.shift()
    if (!current || visited.has(current)) continue
    visited.add(current)
    for (const next of outgoing.get(current) ?? []) {
      if (!visited.has(next)) queue.push(next)
    }
  }
  return [...visited]
}

function executorRunPathEdgeIds(graph: ExecutorGraphWorkspace, startExecutorId: string): string[] {
  const executorIds = new Set(graph.executors.map((executor) => executor.id))
  const start = executorIds.has(startExecutorId)
    ? startExecutorId
    : graph.executors.find((executor) => executor.sourceNodeId === startExecutorId)?.id
  if (!start) return []

  const outgoing = new Map<string, ExecutorGraphWorkspace["connections"]>()
  for (const connection of graph.connections) {
    outgoing.set(connection.fromExecutorId, [
      ...(outgoing.get(connection.fromExecutorId) ?? []),
      connection,
    ])
  }

  const visited = new Set<string>()
  const edgeIds: string[] = []
  const queue = [start]
  while (queue.length > 0) {
    const current = queue.shift()
    if (!current || visited.has(current)) continue
    visited.add(current)
    for (const edge of outgoing.get(current) ?? []) {
      edgeIds.push(edge.id)
      if (!visited.has(edge.toExecutorId)) queue.push(edge.toExecutorId)
    }
  }
  return [...new Set(edgeIds)]
}

function runtimeActiveStateFromRuns(
  runs: RootRun[],
  topology: EnterpriseTopology,
): { executorIds: string[]; edgeIds: string[] } {
  const graph = buildExecutorGraphFromEnterpriseTopology(topology, { mode: "simple" })
  const executorIds = new Set<string>()
  const edgeIds = new Set<string>()
  for (const run of runs) {
    if (!isActiveRunStatus(run.status)) continue
    const routing = topologyRoutingFromRun(run)
    if (routing?.mode !== "route" || routing.topologyId !== topology.id) continue
    if (routing.entryNodeId) {
      for (const executorId of executorRunPathIds(graph, routing.entryNodeId)) executorIds.add(executorId)
      for (const edgeId of executorRunPathEdgeIds(graph, routing.entryNodeId)) edgeIds.add(edgeId)
    }
    for (const executorId of topologyAssignedExecutorIdsFromRun(run, topology.id)) {
      executorIds.add(executorId)
    }
  }

  for (const connection of graph.connections) {
    if (
      executorIds.has(connection.fromExecutorId) &&
      executorIds.has(connection.toExecutorId)
    ) {
      edgeIds.add(connection.id)
    }
  }

  return {
    executorIds: [...executorIds].sort(),
    edgeIds: [...edgeIds].sort(),
  }
}

function isActiveRunStatus(status: RootRun["status"]): boolean {
  return status === "queued" ||
    status === "running" ||
    status === "awaiting_approval" ||
    status === "awaiting_user"
}

function topologyRoutingFromRun(
  run: RootRun,
): { mode?: string; topologyId?: string; entryNodeId?: string } | null {
  const snapshot = isRecord(run.promptSourceSnapshot) ? run.promptSourceSnapshot : {}
  const routing = isRecord(snapshot.topologyRouting) ? snapshot.topologyRouting : {}
  const mode = stringValue(routing.mode)
  const topologyId = stringValue(routing.topologyId)
  const entryNodeId = stringValue(routing.entryNodeId)
  if (!mode && !topologyId && !entryNodeId) return null
  return { mode, topologyId, entryNodeId }
}

function topologyAssignedExecutorIdsFromRun(run: RootRun, topologyId: string): string[] {
  const plan = isRecord(run.orchestrationPlanSnapshot)
    ? run.orchestrationPlanSnapshot
    : isRecord(run.promptSourceSnapshot) && isRecord(run.promptSourceSnapshot.orchestrationPlan)
      ? run.promptSourceSnapshot.orchestrationPlan
      : null
  if (!plan) return []
  const tasks = [...recordArray(plan.directNobieTasks), ...recordArray(plan.delegatedTasks)]
  return tasks
    .map((task) => topologyExecutorIdFromAgentId(stringValue(task.assignedAgentId), topologyId))
    .filter((executorId): executorId is string => Boolean(executorId))
}

function topologyExecutorIdFromAgentId(agentId: string | undefined, topologyId: string): string | undefined {
  if (!agentId?.startsWith(`${topologyId}:`)) return undefined
  const executorId = agentId.slice(topologyId.length + 1)
  return executorId.startsWith("node:") ? executorId : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function recordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : []
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function entityRefMatchesNode(ref: { entityType: string; id: string } | undefined, nodeId: string): boolean {
  return ref?.entityType === "node" && ref.id === nodeId
}
