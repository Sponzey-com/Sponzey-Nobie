import * as React from "react"
import type { EnterpriseTopology } from "../../contracts/enterprise-topology"
import type {
  EnterpriseTopologyGuiDraftRunRequest,
  EnterpriseTopologyRunRecord,
  WorkOrderTemplatePreset,
  WorkOrderTemplateSimulationMode,
} from "../../lib/enterprise-topology-operations"
import {
  shouldShowTopologyWorkspaceAdvancedSurface,
  type TopologyWorkspaceExposureMode,
} from "../../lib/topology-workspace-copy"
import { ExecutorRunPanel } from "./ExecutorRunPanel"
import type { TopologyRunTraceOverlayInput } from "./TopologyRunTraceOverlay"
import {
  TopologyRunStrip,
  type TopologyRunTargetState,
} from "./TopologyRunStrip"

export {
  TOPOLOGY_RUN_CONTEXT_PRESETS,
  TopologyRunStrip,
  buildTopologyRunRequestPayload,
  resolveTopologyRunTargetState,
  topologyRunEntryNodeIds,
  type TopologyRunTargetIssue,
  type TopologyRunTargetSource,
  type TopologyRunTargetState,
} from "./TopologyRunStrip"

export function TopologyRunLauncher({
  exposureMode = "simple",
  simpleLayout = "wide",
  topology,
  templates,
  selectedTemplateId,
  selectedContextPresetId,
  simulationMode,
  advancedInstruction,
  runTargetNodeId,
  targetState,
  recentRuns,
  selectedRunId,
  traceOverlay,
  loading = false,
  onSelectTemplate,
  onSelectContextPreset,
  onSelectSimulationMode,
  onAdvancedInstructionChange,
  onRun,
  onSelectRunTarget,
  onSelectRunHistory,
  onTraceLayerRequest,
  onStartNodeQuickFix,
}: {
  exposureMode?: TopologyWorkspaceExposureMode
  simpleLayout?: "wide" | "sidebar"
  topology?: EnterpriseTopology | null
  templates: WorkOrderTemplatePreset[]
  selectedTemplateId?: string
  selectedContextPresetId?: string
  simulationMode: WorkOrderTemplateSimulationMode
  advancedInstruction: string
  runTargetNodeId?: string | null
  targetState?: TopologyRunTargetState | null
  recentRuns?: EnterpriseTopologyRunRecord[]
  selectedRunId?: string | null
  traceOverlay?: TopologyRunTraceOverlayInput | null
  loading?: boolean
  onSelectTemplate?: (templateId: string) => void
  onSelectContextPreset?: (contextPresetId: string) => void
  onSelectSimulationMode?: (mode: WorkOrderTemplateSimulationMode) => void
  onAdvancedInstructionChange?: (value: string) => void
  onRun?: (payload?: EnterpriseTopologyGuiDraftRunRequest) => void
  onSelectRunTarget?: (nodeId: string) => void
  onSelectRunHistory?: (topologyRunId: string) => void
  onTraceLayerRequest?: () => void
  onStartNodeQuickFix?: () => void
}) {
  if (!shouldShowTopologyWorkspaceAdvancedSurface(exposureMode)) {
    return (
      <ExecutorRunPanel
        topology={topology}
        templates={templates}
        layout={simpleLayout}
        selectedTemplateId={selectedTemplateId}
        selectedContextPresetId={selectedContextPresetId}
        selectedStartExecutorId={runTargetNodeId ?? targetState?.targetNodeId ?? null}
        targetState={targetState}
        runInput={advancedInstruction}
        simulationMode={simulationMode}
        loading={loading}
        recentRuns={recentRuns}
        selectedRunId={selectedRunId}
        traceOverlay={traceOverlay}
        onRunInputChange={onAdvancedInstructionChange}
        onSelectStartExecutor={onSelectRunTarget}
        onRun={onRun}
        onSelectRunHistory={onSelectRunHistory}
        onTraceLayerRequest={onTraceLayerRequest}
        onStartNodeQuickFix={onStartNodeQuickFix}
      />
    )
  }

  return (
    <TopologyRunStrip
      exposureMode={exposureMode}
      templates={templates}
      selectedTemplateId={selectedTemplateId}
      selectedContextPresetId={selectedContextPresetId}
      simulationMode={simulationMode}
      advancedInstruction={advancedInstruction}
      runTargetNodeId={runTargetNodeId}
      targetState={targetState}
      recentRuns={recentRuns}
      selectedRunId={selectedRunId}
      traceOverlay={traceOverlay}
      loading={loading}
      onSelectTemplate={onSelectTemplate}
      onSelectContextPreset={onSelectContextPreset}
      onSelectSimulationMode={onSelectSimulationMode}
      onAdvancedInstructionChange={onAdvancedInstructionChange}
      onRun={onRun}
      onSelectRunHistory={onSelectRunHistory}
      onTraceLayerRequest={onTraceLayerRequest}
      onStartNodeQuickFix={onStartNodeQuickFix}
    />
  )
}
