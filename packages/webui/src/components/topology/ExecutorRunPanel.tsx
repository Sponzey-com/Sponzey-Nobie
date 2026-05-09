import * as React from "react"
import type { EnterpriseTopology } from "../../contracts/enterprise-topology"
import type {
  EnterpriseTopologyGuiDraftRunRequest,
  EnterpriseTopologyRunRecord,
  WorkOrderTemplateContextPreset,
  WorkOrderTemplatePreset,
  WorkOrderTemplateSimulationMode,
} from "../../lib/enterprise-topology-operations"
import {
  buildExecutorGraphFromEnterpriseTopology,
  type ExecutorDraft,
  type ExecutorGraphWorkspace,
} from "../../lib/executor-graph"
import { useUiI18n } from "../../lib/ui-i18n"
import type { TopologyRunTraceOverlayInput } from "./TopologyRunTraceOverlay"
import {
  buildTopologyRunRequestPayload,
  type TopologyRunTargetState,
} from "./TopologyRunStrip"

export type ExecutorRunStartSource =
  | "selected"
  | "single_executor"
  | "single_entry"
  | "ambiguous"
  | "none"

export interface ExecutorRunStartCandidate {
  executorId: string
  label: string
  description: string
  confidence: number
  incomingConnectionCount: number
}

export interface ExecutorRunInferenceMetadata {
  source: "executor_run_panel"
  startSource: ExecutorRunStartSource
  inferredTemplateId: string
  inferredContextPresetId: string
  templateConfidence: number
  contextConfidence: number
  lowConfidenceExecutorIds: string[]
}

export interface ExecutorRunResolvedState {
  graph: ExecutorGraphWorkspace | null
  candidates: ExecutorRunStartCandidate[]
  selectedStartExecutorId: string | null
  startSource: ExecutorRunStartSource
  requiresStartChoice: boolean
  lowConfidenceExecutors: ExecutorDraft[]
  requiresConfirmation: boolean
  inferredTemplate: WorkOrderTemplatePreset | null
  inferredContextPreset: WorkOrderTemplateContextPreset | null
  payload: EnterpriseTopologyGuiDraftRunRequest | null
  payloadMetadata: ExecutorRunInferenceMetadata | null
}

export interface ExecutorRunPanelProps {
  topology?: EnterpriseTopology | null
  templates: WorkOrderTemplatePreset[]
  layout?: "wide" | "sidebar"
  selectedTemplateId?: string
  selectedContextPresetId?: string
  selectedStartExecutorId?: string | null
  targetState?: TopologyRunTargetState | null
  runInput?: string
  simulationMode?: WorkOrderTemplateSimulationMode
  loading?: boolean
  recentRuns?: EnterpriseTopologyRunRecord[]
  selectedRunId?: string | null
  traceOverlay?: TopologyRunTraceOverlayInput | null
  onRunInputChange?: (value: string) => void
  onSelectStartExecutor?: (executorId: string) => void
  onRun?: (payload: EnterpriseTopologyGuiDraftRunRequest) => void
  onSelectRunHistory?: (topologyRunId: string) => void
  onTraceLayerRequest?: () => void
  onStartNodeQuickFix?: () => void
}

export function resolveExecutorRunState(input: {
  topology?: EnterpriseTopology | null
  templates: WorkOrderTemplatePreset[]
  selectedTemplateId?: string
  selectedContextPresetId?: string
  selectedStartExecutorId?: string | null
  targetState?: TopologyRunTargetState | null
  runInput?: string
  simulationMode?: WorkOrderTemplateSimulationMode
}): ExecutorRunResolvedState {
  const graph = input.topology
    ? buildExecutorGraphFromEnterpriseTopology(input.topology, { mode: "simple" })
    : null
  const candidates = graph ? executorRunStartCandidates(graph) : fallbackCandidates(input.targetState)
  const selected = resolveSelectedStartExecutor({
    graph,
    candidates,
    selectedStartExecutorId: input.selectedStartExecutorId ?? input.targetState?.targetNodeId ?? null,
  })
  const lowConfidenceExecutors = selected.executorId && graph
    ? executorRunPathExecutors(graph, selected.executorId).filter((executor) => executor.confidence < 0.58)
    : []
  const requiresConfirmation = false
  const template = resolveExecutorRunTemplate({
    templates: input.templates,
    selectedTemplateId: input.selectedTemplateId,
  })
  const contextPreset = template
    ? resolveExecutorRunContextPreset({
      template,
      selectedContextPresetId: input.selectedContextPresetId,
    })
    : null
  const payloadResult = selected.executorId && template && contextPreset
    ? buildExecutorRunRequestPayload({
      entryNodeId: selected.executorId,
      template,
      contextPreset,
      runInput: input.runInput ?? "",
      simulationMode: input.simulationMode ?? template.defaultSimulationMode,
      metadata: {
        source: "executor_run_panel",
        startSource: selected.source,
        inferredTemplateId: template.templateId,
        inferredContextPresetId: contextPreset.id,
        templateConfidence: 1,
        contextConfidence: 1,
        lowConfidenceExecutorIds: lowConfidenceExecutors.map((executor) => executor.id),
      },
    })
    : null

  return {
    graph,
    candidates,
    selectedStartExecutorId: selected.executorId,
    startSource: selected.source,
    requiresStartChoice: selected.source === "ambiguous",
    lowConfidenceExecutors,
    requiresConfirmation,
    inferredTemplate: template,
    inferredContextPreset: contextPreset,
    payload: payloadResult?.payload ?? null,
    payloadMetadata: payloadResult?.metadata ?? null,
  }
}

export function executorRunStartCandidates(graph: ExecutorGraphWorkspace): ExecutorRunStartCandidate[] {
  const incoming = new Map(graph.executors.map((executor) => [executor.id, 0]))
  for (const connection of graph.connections) {
    incoming.set(connection.toExecutorId, (incoming.get(connection.toExecutorId) ?? 0) + 1)
  }
  const roots = graph.executors.filter((executor) => (incoming.get(executor.id) ?? 0) === 0)
  const source = roots.length > 0 ? roots : graph.executors
  return source.map((executor) => ({
    executorId: executor.id,
    label: executor.name,
    description: executor.description,
    confidence: executor.confidence,
    incomingConnectionCount: incoming.get(executor.id) ?? 0,
  }))
}

export function buildExecutorRunRequestPayload(input: {
  entryNodeId: string
  template: WorkOrderTemplatePreset
  contextPreset: WorkOrderTemplateContextPreset
  runInput: string
  simulationMode: WorkOrderTemplateSimulationMode
  metadata: ExecutorRunInferenceMetadata
}): {
  payload: EnterpriseTopologyGuiDraftRunRequest
  metadata: ExecutorRunInferenceMetadata
} {
  const requestText = input.runInput.trim()
  return {
    payload: buildTopologyRunRequestPayload({
      entryNodeId: input.entryNodeId,
      templateId: input.template.templateId,
      contextPresetId: input.contextPreset.id,
      simulationMode: input.simulationMode,
      advancedInstruction: requestText,
      input: {
        launchedFrom: "executor_run_panel",
        requestText,
        inferredTemplateId: input.template.templateId,
        inferredContextPresetId: input.contextPreset.id,
        executorRun: input.metadata,
      },
    }),
    metadata: input.metadata,
  }
}

export function ExecutorRunPanel({
  topology,
  templates,
  layout = "wide",
  selectedTemplateId,
  selectedContextPresetId,
  selectedStartExecutorId,
  targetState,
  runInput = "",
  simulationMode,
  loading = false,
  recentRuns = [],
  selectedRunId,
  traceOverlay,
  onRunInputChange,
  onSelectStartExecutor,
  onRun,
  onSelectRunHistory,
  onTraceLayerRequest,
  onStartNodeQuickFix,
}: ExecutorRunPanelProps) {
  const { text } = useUiI18n()
  const resolved = React.useMemo(
    () => resolveExecutorRunState({
      topology,
      templates,
      selectedTemplateId,
      selectedContextPresetId,
      selectedStartExecutorId,
      targetState,
      runInput,
      simulationMode,
    }),
    [runInput, selectedContextPresetId, selectedStartExecutorId, selectedTemplateId, simulationMode, targetState, templates, topology],
  )
  const latestRun = recentRuns[0] ?? traceOverlay?.run ?? null
  const previewExecutors = React.useMemo(
    () => resolved.graph && resolved.selectedStartExecutorId
      ? executorRunPathExecutors(resolved.graph, resolved.selectedStartExecutorId)
      : [],
    [resolved.graph, resolved.selectedStartExecutorId],
  )
  const runState = loading ? "running" : latestRun?.status ?? "waiting"
  const canSendRequest = Boolean(
    resolved.payload &&
    runInput.trim().length > 0 &&
    !resolved.requiresStartChoice &&
    !loading,
  )

  return (
    <section
      className="rounded-lg border border-stone-200 bg-white px-3 py-2.5"
      data-testid="executor-run-panel"
      data-start-source={resolved.startSource}
      data-requires-start-choice={resolved.requiresStartChoice}
      data-requires-confirmation={resolved.requiresConfirmation}
      data-layout={layout}
    >
      <div
        className={layout === "sidebar" ? "grid gap-2" : "grid gap-2 md:grid-cols-[minmax(160px,0.7fr)_minmax(240px,1fr)_auto]"}
        data-testid="topology-run-simple-panel"
      >
        <div>
          <div className="text-sm font-semibold text-stone-950">
            {layout === "sidebar" ? text("요청 흐름", "Request flow") : text("채널 요청", "Channel request")}
          </div>
          <div
            className={`mt-1 flex h-9 items-center rounded-lg border px-2 text-xs font-semibold ${
              resolved.selectedStartExecutorId
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border-stone-200 bg-stone-50 text-stone-600"
            }`}
            data-testid="topology-run-target"
          >
            <span className="max-w-48 truncate">
              {startLabel(resolved) ?? text("시작 실행자 자동 선택 대기", "Waiting for start executor")}
            </span>
          </div>
        </div>

        <label className="grid gap-1 text-xs font-semibold text-stone-500">
          <span>{text("요청", "Request")}</span>
          <textarea
            value={runInput}
            onChange={(event) => onRunInputChange?.(event.currentTarget.value)}
            rows={1}
            className="min-h-9 resize-none rounded-lg border border-stone-200 bg-white px-3 py-2 text-xs text-stone-800"
            placeholder={text("채널에서 들어온 요청을 써 보세요.", "Enter a channel request to test.")}
            data-testid="topology-run-simple-input"
          />
        </label>

        <button
          type="button"
          onClick={() => {
            if (resolved.payload) onRun?.(resolved.payload)
          }}
          disabled={!canSendRequest}
          className="h-9 self-end rounded-lg bg-stone-900 px-4 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          data-testid="topology-run-request-send"
        >
          {loading ? text("전송 중", "Sending") : text("요청 보내기", "Send request")}
        </button>
      </div>

      <div
        className="mt-2 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2"
        data-testid="executor-test-flow-preview"
        data-simulation-state={runState}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs font-semibold text-stone-900">
            {text("요청 흐름", "Request flow")}
          </div>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${runStatusTone(runState)}`}>
            {runStatusLabel(runState, text)}
          </span>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {previewExecutors.length > 0 ? previewExecutors.map((executor, index) => (
            <React.Fragment key={executor.id}>
              {index > 0 ? (
                <span className="text-[11px] font-semibold text-stone-400" aria-hidden="true">
                  →
                </span>
              ) : null}
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                  latestRun?.entryNodeId === executor.id
                    ? "bg-sky-100 text-sky-800"
                    : "bg-white text-stone-700"
                }`}
                data-testid="executor-test-flow-step"
                data-executor-id={executor.id}
              >
                {executor.name}
              </span>
            </React.Fragment>
          )) : (
            <span className="text-xs text-stone-500" data-testid="executor-test-flow-empty">
              {text("실행자를 만들면 채널 요청이 흐를 경로가 여기에 표시됩니다.", "Create executors to preview the channel request path here.")}
            </span>
          )}
        </div>
      </div>

      {resolved.requiresStartChoice ? (
        <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2" data-testid="executor-run-start-choice">
          <div className="text-xs font-semibold text-amber-950">
            {text("어디서 시작할까요?", "Where should this start?")}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {resolved.candidates.map((candidate) => (
              <button
                key={candidate.executorId}
                type="button"
                onClick={() => onSelectStartExecutor?.(candidate.executorId)}
                className="h-8 rounded-full border border-amber-300 bg-white px-3 text-xs font-semibold text-amber-950"
                data-testid="executor-run-start-chip"
                data-executor-id={candidate.executorId}
              >
                {candidate.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {!resolved.selectedStartExecutorId && onStartNodeQuickFix ? (
        <div
          className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900"
          data-testid="topology-run-entry-quick-fix"
        >
          <span>{text("요청을 받을 시작 실행자가 없습니다.", "No start executor is available.")}</span>
          <button
            type="button"
            onClick={onStartNodeQuickFix}
            className="h-7 rounded-md border border-amber-300 bg-white px-2.5 text-[11px] font-semibold text-amber-900"
          >
            {text("시작 실행자 지정", "Set start executor")}
          </button>
        </div>
      ) : null}

      {resolved.payloadMetadata ? (
        <div
          className="mt-2 hidden"
          data-testid="executor-run-payload-summary"
          data-template-id={resolved.payloadMetadata.inferredTemplateId}
          data-context-preset-id={resolved.payloadMetadata.inferredContextPresetId}
        />
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

function resolveSelectedStartExecutor(input: {
  graph: ExecutorGraphWorkspace | null
  candidates: ExecutorRunStartCandidate[]
  selectedStartExecutorId: string | null
}): { executorId: string | null; source: ExecutorRunStartSource } {
  const executorIds = new Set(input.graph?.executors.map((executor) => executor.id) ?? input.candidates.map((candidate) => candidate.executorId))
  if (input.selectedStartExecutorId && executorIds.has(input.selectedStartExecutorId)) {
    return { executorId: input.selectedStartExecutorId, source: "selected" }
  }
  if (input.graph?.executors.length === 1) {
    return { executorId: input.graph.executors[0]!.id, source: "single_executor" }
  }
  if (input.candidates.length === 1) {
    return { executorId: input.candidates[0]!.executorId, source: "single_entry" }
  }
  if (input.candidates.length > 1) return { executorId: null, source: "ambiguous" }
  return { executorId: null, source: "none" }
}

function fallbackCandidates(targetState?: TopologyRunTargetState | null): ExecutorRunStartCandidate[] {
  return (targetState?.entryNodeIds ?? []).map((executorId) => ({
    executorId,
    label: executorId,
    description: "",
    confidence: 0.72,
    incomingConnectionCount: 0,
  }))
}

function executorRunPathExecutors(graph: ExecutorGraphWorkspace, startExecutorId: string): ExecutorDraft[] {
  const byId = new Map(graph.executors.map((executor) => [executor.id, executor]))
  const outgoing = new Map<string, string[]>()
  for (const connection of graph.connections) {
    outgoing.set(connection.fromExecutorId, [
      ...(outgoing.get(connection.fromExecutorId) ?? []),
      connection.toExecutorId,
    ])
  }
  const visited = new Set<string>()
  const queue = [startExecutorId]
  while (queue.length > 0) {
    const current = queue.shift()!
    if (visited.has(current)) continue
    visited.add(current)
    for (const next of outgoing.get(current) ?? []) queue.push(next)
  }
  return [...visited].map((id) => byId.get(id)).filter((executor): executor is ExecutorDraft => Boolean(executor))
}

function resolveExecutorRunTemplate(input: {
  templates: WorkOrderTemplatePreset[]
  selectedTemplateId?: string
}): WorkOrderTemplatePreset | null {
  if (input.templates.length === 0) return null
  return input.templates.find((template) => template.templateId === input.selectedTemplateId)
    ?? input.templates[0]!
}

function resolveExecutorRunContextPreset(input: {
  template: WorkOrderTemplatePreset
  selectedContextPresetId?: string
}): WorkOrderTemplateContextPreset | null {
  return input.template.contextPresets.find((preset) => preset.id === input.selectedContextPresetId)
    ?? input.template.contextPresets[0] ?? null
}

function startLabel(state: ExecutorRunResolvedState): string | null {
  const id = state.selectedStartExecutorId
  if (!id) return null
  return state.candidates.find((candidate) => candidate.executorId === id)?.label ??
    state.graph?.executors.find((executor) => executor.id === id)?.name ??
    id
}

function runStatusTone(status: string | undefined): string {
  if (status === "failed") return "bg-red-100 text-red-800"
  if (status === "completed") return "bg-emerald-100 text-emerald-800"
  if (status === "running") return "bg-sky-100 text-sky-800"
  return "bg-stone-100 text-stone-700"
}

function runStatusLabel(status: string | undefined, text: (ko: string, en: string) => string): string {
  if (status === "failed") return text("실패", "Failed")
  if (status === "completed") return text("완료", "Done")
  if (status === "running") return text("진행 중", "Running")
  return text("대기", "Waiting")
}

function formatRunTime(timestamp: number | undefined): string {
  if (!timestamp) return "-"
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}
