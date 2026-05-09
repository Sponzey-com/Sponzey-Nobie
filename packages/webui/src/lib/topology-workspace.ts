import type { FeatureCapability } from "../contracts/capabilities"
import type { EnterpriseTopology, EnterpriseTopologyValidationIssue } from "../contracts/enterprise-topology"
import type { AgentTopologyProjection } from "../contracts/topology"
import type { TopologyRelationTemplateCatalog } from "../contracts/relation-templates"
import type { TopologyTemplateCatalog } from "../contracts/topology-templates"
import type {
  EnterpriseTopologyGuiDraftCompiledPreviewResponse,
  EnterpriseTopologyGuiValidation,
  EnterpriseTopologyRunRecord,
  EnterpriseTopologyRunTraceProjection,
  WorkOrderTemplateCatalog,
} from "./enterprise-topology-operations"
import type { TopologyWorkspaceLayer } from "./topology-workspace-copy"

export type { TopologyWorkspaceLayer } from "./topology-workspace-copy"

export type TopologyWorkspaceSelection =
  | { kind: "none" }
  | { kind: "node"; nodeId: string; entityType?: string }
  | { kind: "edge"; edgeId: string; relationType?: string }
  | { kind: "run"; topologyRunId: string }
  | { kind: "issue"; issueId: string; source: "validation" | "compile" | "runtime" | "gap"; targetId?: string }

export type TopologyWorkspaceFeatureFlagMode =
  | "off"
  | "shadow"
  | "dual_write"
  | "enforced"
  | "rollback"

export interface TopologyWorkspaceFeatureFlag {
  featureKey: string
  mode: TopologyWorkspaceFeatureFlagMode | string
  reason?: string
}

export interface TopologyWorkspaceRuntimeProjection {
  source: "agent_topology"
  projection: AgentTopologyProjection | null
  nodeCount: number
  edgeCount: number
  diagnosticCount: number
}

export interface TopologyWorkspaceObservedProjection {
  source: "topology_trace_store"
  latestTrace: EnterpriseTopologyRunTraceProjection | null
  observedEdgeCount: number
  traceEventCount: number
}

export interface TopologyWorkspaceLayerState {
  layer: TopologyWorkspaceLayer
  enabled: boolean
  readOnly: boolean
  reason: string | null
}

export interface TopologyWorkspaceSourceOfTruth {
  topology: "enterprise_topology_registry"
  draft: "enterprise_topology_gui_draft"
  compiled: "compiled_topology_snapshot"
  runtimeResources: "agent_team_registry"
  traces: "topology_trace_store"
  projectionOnly: true
}

export interface TopologyWorkspaceCatalogs {
  topologyTemplates: TopologyTemplateCatalog | null
  relationTemplates: TopologyRelationTemplateCatalog | null
  workOrderTemplates: WorkOrderTemplateCatalog | null
}

export interface TopologyWorkspaceSnapshot {
  schemaVersion: 1
  topologyId: string
  topology: EnterpriseTopology | null
  validation: EnterpriseTopologyGuiValidation | null
  issues: EnterpriseTopologyValidationIssue[]
  compiledPreview: EnterpriseTopologyGuiDraftCompiledPreviewResponse | null
  runtimeResources: AgentTopologyProjection | null
  recentRuns: EnterpriseTopologyRunRecord[]
  latestTrace: EnterpriseTopologyRunTraceProjection | null
  gapFindings: unknown[]
  capabilities: FeatureCapability[]
  featureFlags: TopologyWorkspaceFeatureFlag[]
  catalogs: TopologyWorkspaceCatalogs
  sourceOfTruth: TopologyWorkspaceSourceOfTruth
}

export interface TopologyWorkspaceModel {
  schemaVersion: 1
  topologyId: string
  topology: EnterpriseTopology | null
  compiled: EnterpriseTopologyGuiDraftCompiledPreviewResponse | null
  runtimeResources: TopologyWorkspaceRuntimeProjection
  observed: TopologyWorkspaceObservedProjection
  gaps: unknown[]
  runs: EnterpriseTopologyRunRecord[]
  selectedLayer: TopologyWorkspaceLayer
  selection: TopologyWorkspaceSelection
  layers: Record<TopologyWorkspaceLayer, TopologyWorkspaceLayerState>
  capabilities: FeatureCapability[]
  featureFlags: TopologyWorkspaceFeatureFlag[]
  catalogs: TopologyWorkspaceCatalogs
  sourceOfTruth: TopologyWorkspaceSourceOfTruth
}

export interface TopologyWorkspaceSnapshotInput {
  topologyId?: string
  topology?: EnterpriseTopology | null
  validation?: EnterpriseTopologyGuiValidation | null
  issues?: EnterpriseTopologyValidationIssue[]
  compiledPreview?: EnterpriseTopologyGuiDraftCompiledPreviewResponse | null
  runtimeResources?: AgentTopologyProjection | null
  recentRuns?: EnterpriseTopologyRunRecord[]
  latestTrace?: EnterpriseTopologyRunTraceProjection | null
  gapFindings?: unknown[]
  capabilities?: FeatureCapability[]
  featureFlags?: TopologyWorkspaceFeatureFlag[]
  catalogs?: Partial<TopologyWorkspaceCatalogs>
}

export interface TopologyWorkspaceSnapshotLoadRequest {
  topologyId?: string
  topology?: EnterpriseTopology | null
  latestTrace?: EnterpriseTopologyRunTraceProjection | null
  recentRuns?: EnterpriseTopologyRunRecord[]
  featureFlags?: TopologyWorkspaceFeatureFlag[]
}

export interface TopologyWorkspaceModelInput {
  snapshot: TopologyWorkspaceSnapshot
  selectedLayer?: TopologyWorkspaceLayer
  selection?: TopologyWorkspaceSelection
}

export const TOPOLOGY_WORKSPACE_SOURCE_OF_TRUTH: TopologyWorkspaceSourceOfTruth = {
  topology: "enterprise_topology_registry",
  draft: "enterprise_topology_gui_draft",
  compiled: "compiled_topology_snapshot",
  runtimeResources: "agent_team_registry",
  traces: "topology_trace_store",
  projectionOnly: true,
}

export const TOPOLOGY_WORKSPACE_LAYERS: TopologyWorkspaceLayer[] = [
  "build",
  "run",
  "trace",
  "improve",
  "resources",
]

const EMPTY_SELECTION: TopologyWorkspaceSelection = { kind: "none" }

export function buildTopologyWorkspaceSnapshot(input: TopologyWorkspaceSnapshotInput = {}): TopologyWorkspaceSnapshot {
  const topologyId = input.topologyId ?? input.topology?.id ?? "workspace:draft"
  const latestTrace =
    input.latestTrace && input.latestTrace.run.topologyId === topologyId
      ? input.latestTrace
      : null
  const recentRuns = input.recentRuns ?? (latestTrace ? [latestTrace.run] : [])
  return {
    schemaVersion: 1,
    topologyId,
    topology: input.topology ?? null,
    validation: input.validation ?? null,
    issues: input.issues ?? [],
    compiledPreview: input.compiledPreview ?? null,
    runtimeResources: input.runtimeResources ?? null,
    recentRuns,
    latestTrace,
    gapFindings: input.gapFindings ?? latestTrace?.gapFindings ?? [],
    capabilities: input.capabilities ?? [],
    featureFlags: input.featureFlags ?? [],
    catalogs: {
      topologyTemplates: input.catalogs?.topologyTemplates ?? null,
      relationTemplates: input.catalogs?.relationTemplates ?? null,
      workOrderTemplates: input.catalogs?.workOrderTemplates ?? null,
    },
    sourceOfTruth: TOPOLOGY_WORKSPACE_SOURCE_OF_TRUTH,
  }
}

export function buildTopologyWorkspaceModel(input: TopologyWorkspaceModelInput): TopologyWorkspaceModel {
  const { snapshot } = input
  const selectedLayer = input.selectedLayer ?? "build"
  const selection = input.selection ?? EMPTY_SELECTION
  const layers = Object.fromEntries(
    TOPOLOGY_WORKSPACE_LAYERS.map((layer) => [layer, resolveTopologyWorkspaceLayerState(snapshot, layer)]),
  ) as Record<TopologyWorkspaceLayer, TopologyWorkspaceLayerState>

  return {
    schemaVersion: 1,
    topologyId: snapshot.topologyId,
    topology: snapshot.topology,
    compiled: snapshot.compiledPreview,
    runtimeResources: buildRuntimeProjection(snapshot.runtimeResources),
    observed: buildObservedProjection(snapshot.latestTrace),
    gaps: snapshot.gapFindings,
    runs: snapshot.recentRuns,
    selectedLayer,
    selection,
    layers,
    capabilities: snapshot.capabilities,
    featureFlags: snapshot.featureFlags,
    catalogs: snapshot.catalogs,
    sourceOfTruth: snapshot.sourceOfTruth,
  }
}

export function selectTopologyWorkspaceLayer(
  model: TopologyWorkspaceModel,
  selectedLayer: TopologyWorkspaceLayer,
): TopologyWorkspaceModel {
  return { ...model, selectedLayer, selection: preserveSelectionForLayer(model.selection, selectedLayer) }
}

export function selectTopologyWorkspaceItem(
  model: TopologyWorkspaceModel,
  selection: TopologyWorkspaceSelection,
): TopologyWorkspaceModel {
  return { ...model, selection }
}

export function resolveTopologyWorkspaceLayerState(
  snapshot: Pick<TopologyWorkspaceSnapshot, "capabilities" | "featureFlags">,
  layer: TopologyWorkspaceLayer,
): TopologyWorkspaceLayerState {
  if (layer === "resources") {
    return { layer, enabled: true, readOnly: true, reason: null }
  }

  if (layer === "build") {
    const capability = resolveCapability(snapshot.capabilities, "enterprise_topology_builder_ui")
    if (!capability.enabled) {
      return {
        layer,
        enabled: false,
        readOnly: true,
        reason: capability.reason ?? "Topology builder capability is not ready.",
      }
    }
    return { layer, enabled: true, readOnly: false, reason: null }
  }

  if (layer === "run" || layer === "trace") {
    const runtimeFlag = resolveFeatureFlag(snapshot.featureFlags, "topology_runtime_enabled")
    if (!runtimeFlag.enabled) {
      return {
        layer,
        enabled: false,
        readOnly: true,
        reason: runtimeFlag.reason ?? "Topology runtime routing is disabled.",
      }
    }
    return { layer, enabled: true, readOnly: layer === "trace", reason: null }
  }

  const observedFlag = resolveFeatureFlag(snapshot.featureFlags, "declared_observed_topology_analysis")
  if (!observedFlag.enabled) {
    return {
      layer,
      enabled: false,
      readOnly: true,
      reason: observedFlag.reason ?? "Declared versus observed topology analysis is disabled.",
    }
  }
  return { layer, enabled: true, readOnly: true, reason: null }
}

function buildRuntimeProjection(runtimeResources: AgentTopologyProjection | null): TopologyWorkspaceRuntimeProjection {
  return {
    source: "agent_topology",
    projection: runtimeResources,
    nodeCount: runtimeResources?.nodes.length ?? 0,
    edgeCount: runtimeResources?.edges.length ?? 0,
    diagnosticCount: runtimeResources?.diagnostics.length ?? 0,
  }
}

function buildObservedProjection(latestTrace: EnterpriseTopologyRunTraceProjection | null): TopologyWorkspaceObservedProjection {
  return {
    source: "topology_trace_store",
    latestTrace,
    observedEdgeCount: latestTrace?.observedEdges.length ?? 0,
    traceEventCount: latestTrace?.traceEvents.length ?? 0,
  }
}

function preserveSelectionForLayer(
  selection: TopologyWorkspaceSelection,
  _layer: TopologyWorkspaceLayer,
): TopologyWorkspaceSelection {
  return selection
}

function resolveCapability(
  capabilities: readonly FeatureCapability[],
  key: string,
): { enabled: boolean; reason: string | null } {
  const capability = capabilities.find((item) => item.key === key)
  if (!capability) return { enabled: true, reason: null }
  if (capability.status === "ready" && capability.enabled) return { enabled: true, reason: null }
  return { enabled: false, reason: capability.reason ?? `${key} capability is ${capability.status}.` }
}

function resolveFeatureFlag(
  featureFlags: readonly TopologyWorkspaceFeatureFlag[],
  featureKey: string,
): { enabled: boolean; reason: string | null } {
  const flag = featureFlags.find((item) => item.featureKey === featureKey)
  if (!flag) return { enabled: true, reason: null }
  if (flag.mode === "off" || flag.mode === "rollback") {
    return { enabled: false, reason: flag.reason ?? `${featureKey} is ${flag.mode}.` }
  }
  return { enabled: true, reason: null }
}

