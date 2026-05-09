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
import { useUiI18n } from "../../lib/ui-i18n"
import type { TopologyRunTraceOverlayInput } from "./TopologyRunTraceOverlay"

export const TOPOLOGY_RUN_CONTEXT_PRESETS = [
  { id: "context:customer-general", labelKo: "일반 문의", labelEn: "General inquiry" },
  { id: "context:customer-urgent", labelKo: "긴급 고객 이슈", labelEn: "Urgent customer issue" },
  { id: "context:missing-data", labelKo: "필수 데이터 누락", labelEn: "Missing required data" },
  { id: "context:tool-timeout", labelKo: "도구 지연", labelEn: "Tool delay" },
] as const

export type TopologyRunTargetSource = "selection" | "current" | "auto_entry" | "none"
export type TopologyRunTargetIssue = "no_entry_node" | "ambiguous_entry_node" | "missing_target"

export interface TopologyRunTargetState {
  targetNodeId: string | null
  source: TopologyRunTargetSource
  entryNodeIds: string[]
  issue: TopologyRunTargetIssue | null
}

export function topologyRunEntryNodeIds(topology?: EnterpriseTopology | null): string[] {
  if (!topology || topology.nodes.length === 0) return []
  const nodeIds = new Set(topology.nodes.map((node) => node.id))
  const childIds = new Set<string>()
  for (const node of topology.nodes) {
    for (const childId of node.children) {
      if (nodeIds.has(childId)) childIds.add(childId)
    }
  }
  for (const relation of topology.relations) {
    if (relation.relationType !== "delegates_to") continue
    if (relation.from.entityType !== "node" || relation.to.entityType !== "node") continue
    if (nodeIds.has(relation.to.id)) childIds.add(relation.to.id)
  }
  const rootNodeIds = topology.nodes
    .map((node) => node.id)
    .filter((nodeId) => !childIds.has(nodeId))
  return rootNodeIds.length > 0 ? rootNodeIds : topology.nodes.map((node) => node.id)
}

export function resolveTopologyRunTargetState(input: {
  topology?: EnterpriseTopology | null
  selectedNodeId?: string | null
  currentTargetNodeId?: string | null
}): TopologyRunTargetState {
  const topologyNodeIds = new Set(input.topology?.nodes.map((node) => node.id) ?? [])
  const selectedNodeId =
    input.selectedNodeId && topologyNodeIds.has(input.selectedNodeId) ? input.selectedNodeId : null
  if (selectedNodeId) {
    return {
      targetNodeId: selectedNodeId,
      source: "selection",
      entryNodeIds: topologyRunEntryNodeIds(input.topology),
      issue: null,
    }
  }

  const currentTargetNodeId =
    input.currentTargetNodeId && topologyNodeIds.has(input.currentTargetNodeId) ? input.currentTargetNodeId : null
  if (currentTargetNodeId) {
    return {
      targetNodeId: currentTargetNodeId,
      source: "current",
      entryNodeIds: topologyRunEntryNodeIds(input.topology),
      issue: null,
    }
  }

  const entryNodeIds = topologyRunEntryNodeIds(input.topology)
  if (entryNodeIds.length === 1) {
    return {
      targetNodeId: entryNodeIds[0]!,
      source: "auto_entry",
      entryNodeIds,
      issue: null,
    }
  }
  return {
    targetNodeId: null,
    source: "none",
    entryNodeIds,
    issue: entryNodeIds.length === 0 ? "no_entry_node" : "ambiguous_entry_node",
  }
}

export function buildTopologyRunRequestPayload(input: {
  entryNodeId: string
  templateId: string
  contextPresetId?: string
  simulationMode: WorkOrderTemplateSimulationMode
  advancedInstruction?: string
  input?: Record<string, unknown>
}): EnterpriseTopologyGuiDraftRunRequest {
  const advancedInstruction = input.advancedInstruction?.trim()
  return {
    entryNodeId: input.entryNodeId,
    templateId: input.templateId,
    ...(input.contextPresetId ? { contextPresetId: input.contextPresetId } : {}),
    simulationMode: input.simulationMode,
    input: input.input ?? { launchedFrom: "enterprise_topology_builder" },
    ...(advancedInstruction ? { advancedInstruction } : {}),
  }
}

function runStatusTone(status: string | undefined): string {
  if (status === "failed") return "bg-red-100 text-red-800"
  if (status === "completed") return "bg-emerald-100 text-emerald-800"
  if (status === "running") return "bg-sky-100 text-sky-800"
  return "bg-stone-100 text-stone-700"
}

function formatRunTime(timestamp: number | undefined): string {
  if (!timestamp) return "-"
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

function targetIssueText(
  issue: TopologyRunTargetIssue | null | undefined,
  text: (ko: string, en: string) => string,
): string {
  if (issue === "no_entry_node") {
    return text("실행할 시작 노드가 없습니다.", "No runnable entry node exists.")
  }
  if (issue === "ambiguous_entry_node") {
    return text("시작 노드 후보가 여러 개입니다.", "Multiple entry candidates exist.")
  }
  return text("실행할 node를 선택합니다.", "Select a node to run.")
}

export function TopologyRunStrip({
  exposureMode = "simple",
  templates,
  selectedTemplateId,
  selectedContextPresetId,
  simulationMode,
  advancedInstruction,
  runTargetNodeId,
  targetState,
  recentRuns = [],
  selectedRunId,
  traceOverlay,
  loading = false,
  onSelectTemplate,
  onSelectContextPreset,
  onSelectSimulationMode,
  onAdvancedInstructionChange,
  onRun,
  onSelectRunHistory,
  onTraceLayerRequest,
  onStartNodeQuickFix,
}: {
  exposureMode?: TopologyWorkspaceExposureMode
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
  onRun?: () => void
  onSelectRunHistory?: (topologyRunId: string) => void
  onTraceLayerRequest?: () => void
  onStartNodeQuickFix?: () => void
}) {
  const { text } = useUiI18n()
  const selectedTemplate = templates.find((template) => template.templateId === selectedTemplateId) ?? templates[0]
  const contextPresets = selectedTemplate?.contextPresets ?? TOPOLOGY_RUN_CONTEXT_PRESETS
  const selectedContextId = selectedContextPresetId ?? contextPresets[0]?.id ?? ""
  const effectiveTargetNodeId = runTargetNodeId ?? targetState?.targetNodeId ?? null
  const targetIssue = targetState?.issue ?? (effectiveTargetNodeId ? null : "missing_target")
  const canRun = Boolean(effectiveTargetNodeId && selectedTemplate && !loading)
  const latestRun = recentRuns[0] ?? traceOverlay?.run ?? null

  if (!shouldShowTopologyWorkspaceAdvancedSurface(exposureMode)) {
    return (
      <section
        className="rounded-lg border border-stone-200 bg-white px-3 py-2.5"
        data-testid="topology-run-launcher"
        data-exposure-mode="simple"
      >
        <div
          className="grid gap-2 md:grid-cols-[minmax(140px,0.7fr)_minmax(220px,1fr)_auto]"
          data-testid="topology-run-simple-panel"
        >
          <div>
            <div className="text-sm font-semibold text-stone-950">
              {text("실행", "Run")}
            </div>
            <div
              className={`mt-1 flex h-9 items-center rounded-lg border px-2 text-xs font-semibold ${
                effectiveTargetNodeId
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : "border-stone-200 bg-stone-50 text-stone-600"
              }`}
              data-testid="topology-run-target"
            >
              <span className="max-w-48 truncate">
                {effectiveTargetNodeId ?? text("시작 실행자 자동 선택 대기", "Waiting for start executor")}
              </span>
            </div>
          </div>

          <label className="grid gap-1 text-xs font-semibold text-stone-500">
            <span>{text("입력", "Input")}</span>
            <textarea
              value={advancedInstruction}
              onChange={(event) => onAdvancedInstructionChange?.(event.currentTarget.value)}
              rows={1}
              className="min-h-9 resize-none rounded-lg border border-stone-200 bg-white px-3 py-2 text-xs text-stone-800"
              placeholder={text("실행할 요청을 넣으세요.", "Enter the request to run.")}
              data-testid="topology-run-simple-input"
            />
          </label>

          <button
            type="button"
            onClick={onRun}
            disabled={!canRun}
            className="h-9 self-end rounded-lg bg-stone-900 px-4 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
            data-testid="topology-run-submit"
          >
            {loading ? text("실행 중", "Running") : text("실행", "Run")}
          </button>
        </div>

        {targetIssue ? (
          <div
            className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900"
            data-testid="topology-run-entry-quick-fix"
          >
            <span>{targetIssueText(targetIssue, text)}</span>
            <button
              type="button"
              onClick={onStartNodeQuickFix}
              className="h-7 rounded-md border border-amber-300 bg-white px-2.5 text-[11px] font-semibold text-amber-900"
            >
              {text("시작 실행자 지정", "Set start executor")}
            </button>
          </div>
        ) : null}

        {latestRun ? (
          <div className="mt-2 flex flex-wrap items-center gap-1.5" data-testid="topology-run-history">
            <button
              type="button"
              onClick={onTraceLayerRequest}
              className="h-8 rounded-lg border border-sky-200 bg-sky-50 px-3 text-xs font-semibold text-sky-800"
              data-testid="topology-run-trace-cta"
            >
              {text("기록 보기", "View history")}
            </button>
            {recentRuns.slice(0, 5).map((run) => (
              <button
                key={run.topologyRunId}
                type="button"
                onClick={() => onSelectRunHistory?.(run.topologyRunId)}
                className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                  run.topologyRunId === selectedRunId
                    ? "bg-stone-900 text-white"
                    : runStatusTone(run.status)
                }`}
                data-testid="topology-run-history-item"
              >
                {run.entryNodeId ?? text("실행", "Run")} · {formatRunTime(run.startedAt)}
              </button>
            ))}
          </div>
        ) : null}
      </section>
    )
  }

  return (
    <section
      className="rounded-lg border border-stone-200 bg-white px-3 py-2.5"
      data-testid="topology-run-launcher"
    >
      <div
        className="flex flex-nowrap items-end gap-2 overflow-x-auto pb-1"
        data-testid="topology-run-strip-controls"
        data-layout="one-line"
      >
        <div className="min-w-36 shrink-0">
          <div className="text-sm font-semibold text-stone-950">
            {text("Manual Run", "Manual Run")}
          </div>
          <div className="mt-1 text-[11px] text-stone-500">
            {targetState?.source === "auto_entry"
              ? text("entry 자동 선택", "entry auto-selected")
              : text("workspace 실행", "workspace run")}
          </div>
        </div>

        <div className="min-w-44 shrink-0">
          <div className="text-[11px] font-semibold uppercase text-stone-500">
            {text("Target", "Target")}
          </div>
          <div
            className={`mt-1 flex h-9 items-center rounded-lg border px-2 text-xs font-semibold ${
              effectiveTargetNodeId
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border-stone-200 bg-stone-50 text-stone-600"
            }`}
            data-testid="topology-run-target"
          >
            <span className="max-w-40 truncate">
              {effectiveTargetNodeId ?? text("대상 없음", "No target")}
            </span>
          </div>
        </div>

        <label className="grid min-w-52 shrink-0 gap-1 text-xs font-semibold text-stone-500">
          <span>{text("WorkOrder Template", "WorkOrder Template")}</span>
          <select
            value={selectedTemplate?.templateId ?? ""}
            onChange={(event) => onSelectTemplate?.(event.currentTarget.value)}
            className="h-9 rounded-lg border border-stone-200 bg-white px-2 text-xs font-semibold text-stone-800"
            data-testid="topology-run-template-picker"
          >
            {templates.map((template) => (
              <option key={template.templateId} value={template.templateId}>
                {text(template.labelKo, template.labelEn)}
              </option>
            ))}
          </select>
        </label>

        <label className="grid min-w-44 shrink-0 gap-1 text-xs font-semibold text-stone-500">
          <span>{text("Context", "Context")}</span>
          <select
            value={selectedContextId}
            onChange={(event) => onSelectContextPreset?.(event.currentTarget.value)}
            className="h-9 rounded-lg border border-stone-200 bg-white px-2 text-xs font-semibold text-stone-800"
            data-testid="topology-run-context-picker"
          >
            {contextPresets.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {text(preset.labelKo, preset.labelEn)}
              </option>
            ))}
          </select>
        </label>

        <div className="grid h-9 w-44 shrink-0 grid-cols-2 gap-1" data-testid="topology-run-simulation-mode">
          {(["success", "failure"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => onSelectSimulationMode?.(mode)}
              className={`h-9 rounded-lg border px-2 text-xs font-semibold leading-tight ${
                simulationMode === mode
                  ? "border-stone-900 bg-stone-900 text-white"
                  : "border-stone-200 bg-white text-stone-700"
              }`}
            >
              {mode === "success" ? text("성공", "Success") : text("실패 점검", "Failure")}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={onRun}
          disabled={!canRun}
          className="h-9 w-24 shrink-0 rounded-lg bg-stone-900 px-3 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          data-testid="topology-run-submit"
        >
          {loading ? text("실행 중", "Running") : text("실행", "Run")}
        </button>

        {latestRun ? (
          <button
            type="button"
            onClick={onTraceLayerRequest}
            className="h-9 min-w-28 shrink-0 rounded-lg border border-sky-200 bg-sky-50 px-3 text-xs font-semibold text-sky-800"
            data-testid="topology-run-trace-cta"
          >
            {text("Trace 보기", "View trace")}
          </button>
        ) : null}
      </div>

      {targetIssue ? (
        <div
          className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900"
          data-testid="topology-run-entry-quick-fix"
        >
          <span>{targetIssueText(targetIssue, text)}</span>
          <button
            type="button"
            onClick={onStartNodeQuickFix}
            className="h-7 rounded-md border border-amber-300 bg-white px-2.5 text-[11px] font-semibold text-amber-900"
          >
            {text("시작 노드 지정", "Set start node")}
          </button>
        </div>
      ) : null}

      {recentRuns.length > 0 ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5" data-testid="topology-run-history">
          <span className="mr-1 text-[11px] font-semibold uppercase text-stone-500">
            {text("최근 실행", "Recent runs")}
          </span>
          {recentRuns.slice(0, 5).map((run) => (
            <button
              key={run.topologyRunId}
              type="button"
              onClick={() => onSelectRunHistory?.(run.topologyRunId)}
              className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                run.topologyRunId === selectedRunId
                  ? "bg-stone-900 text-white"
                  : runStatusTone(run.status)
              }`}
              data-testid="topology-run-history-item"
            >
              {run.entryNodeId ?? text("실행", "Run")} · {formatRunTime(run.startedAt)}
            </button>
          ))}
        </div>
      ) : null}

      <details className="mt-2 rounded-lg border border-stone-200 bg-stone-50 p-2.5" data-testid="topology-run-advanced-input">
        <summary className="cursor-pointer text-xs font-semibold text-stone-700">
          {text("고급 입력", "Advanced input")}
        </summary>
        <textarea
          value={advancedInstruction}
          onChange={(event) => onAdvancedInstructionChange?.(event.currentTarget.value)}
          className="mt-2 min-h-20 w-full resize-none rounded-lg border border-stone-200 bg-white p-2 text-xs text-stone-800"
          placeholder={text("부득이한 경우에만 직접 입력", "Only type when necessary")}
        />
      </details>
    </section>
  )
}
