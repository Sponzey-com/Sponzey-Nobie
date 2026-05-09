import * as React from "react"
import {
  confirmExecutorUnderstanding,
  createExecutorDraftFromInference,
  inferExecutorFromDescription,
  type ExecutorInferenceResult,
} from "../../lib/executor-inference"
import type {
  ExecutorAdvancedMapping,
  ExecutorConnectionDraft,
  ExecutorDraft,
  ExecutorGraphWorkspace,
  ExecutorRuntimeMode,
} from "../../lib/executor-graph"
import {
  buildNodeDefinitionGraphContext,
  executorFromNodeDefinitionDraft,
  nodeDefinitionDraftFromExecutor,
  type NodeDefinitionDraft,
  type NodeDefinitionTriggerField,
} from "../../lib/node-definition-suggestion"
import { buildExecutorGraphRelationInfoMap } from "../../lib/executor-graph-relations"
import { useUiI18n } from "../../lib/ui-i18n"
import { NodeDefinitionAiButton } from "./NodeDefinitionAiButton"
import { NodeDefinitionAiDialog } from "./NodeDefinitionAiDialog"
import { ExecutorUnderstandingPanel } from "./ExecutorUnderstandingPanel"

export type ExecutorFriendlyRuntimeLabel =
  | "자동 처리"
  | "최종 검토"
  | "도구 실행"
  | "외부 처리"

export interface ExecutorInspectorProps {
  executor?: ExecutorDraft | null
  graph?: ExecutorGraphWorkspace | null
  workspaceId?: string
  topologyId?: string
  onExecutorChange?: (executor: ExecutorDraft) => void
  onConfirmUnderstanding?: (executor: ExecutorDraft) => void
}

export function executorFriendlyRuntimeLabel(mode: ExecutorRuntimeMode): ExecutorFriendlyRuntimeLabel {
  if (mode === "tool_execution") return "도구 실행"
  if (mode === "external") return "외부 처리"
  if (mode === "approval" || mode === "human_check" || mode === "unknown") return "최종 검토"
  return "자동 처리"
}

export function updateExecutorDraftFromInspector(
  executor: ExecutorDraft,
  changes: { name?: string; roleName?: string; description?: string; now?: number | string },
): ExecutorDraft {
  const name = changes.name !== undefined ? changes.name : executor.name
  const roleName = changes.roleName !== undefined
    ? changes.roleName
    : executor.executorProfile?.roleName ?? ""
  const description = changes.description !== undefined ? changes.description : executor.description
  const changed = name !== executor.name || description !== executor.description || roleName !== (executor.executorProfile?.roleName ?? "")
  const executorProfile = executor.executorProfile
    ? {
        ...executor.executorProfile,
        displayName: name.trim() || executor.executorProfile.displayName,
        roleName,
        definition: description.trim() || executor.executorProfile.definition,
        does: description.trim() ? [description.trim()] : executor.executorProfile.does,
      }
    : undefined
  const inferred = createExecutorDraftFromInference({
    id: executor.id,
    name,
    description,
    ...(executorProfile ? { executorProfile } : {}),
    ...(executor.sourceNodeId ? { sourceNodeId: executor.sourceNodeId } : {}),
    ...(changes.now !== undefined ? { now: changes.now } : {}),
  })
  const advancedMapping = mergeAdvancedMappingAfterInference(executor.advancedMapping, inferred.advancedMapping)

  return {
    id: executor.id,
    name,
    description,
    ...(executor.definitionQuickChips?.length ? { definitionQuickChips: [...executor.definitionQuickChips] } : {}),
    inferredRuntimeMode: inferred.inferredRuntimeMode,
    inferredCapabilities: inferred.inferredCapabilities,
    inferredTools: inferred.inferredTools,
    inferredOutputs: inferred.inferredOutputs,
    inferredSuccessCriteria: inferred.inferredSuccessCriteria,
    executorProfile: executorProfile
      ? { ...inferred.executorProfile, roleName }
      : inferred.executorProfile,
    confidence: inferred.confidence,
    ...(changed ? {} : executor.userConfirmed ? { userConfirmed: executor.userConfirmed } : {}),
    ...(changed ? {} : executor.confirmedUnderstandingVersion ? { confirmedUnderstandingVersion: executor.confirmedUnderstandingVersion } : {}),
    ...(executor.sourceNodeId ? { sourceNodeId: executor.sourceNodeId } : {}),
    ...(executor.position ? { position: executor.position } : {}),
    ...(advancedMapping ? { advancedMapping } : {}),
  }
}

export interface ExecutorConnectionDescription {
  id: string
  direction: "outgoing" | "incoming"
  label: ExecutorConnectionDraft["label"]
  textKo: string
  textEn: string
}

export function describeExecutorConnections(
  graph: ExecutorGraphWorkspace | null | undefined,
  executorId: string,
): ExecutorConnectionDescription[] {
  if (!graph) return []
  const executorById = new Map(graph.executors.map((executor) => [executor.id, executor]))
  return graph.connections
    .filter((connection) => connection.fromExecutorId === executorId || connection.toExecutorId === executorId)
    .map((connection) => {
      const outgoing = connection.fromExecutorId === executorId
      const otherId = outgoing ? connection.toExecutorId : connection.fromExecutorId
      const otherName = executorById.get(otherId)?.name ?? otherId
      return {
        id: connection.id,
        direction: outgoing ? "outgoing" : "incoming",
        label: connection.label,
        textKo: outgoing ? `${otherName}에게 ${connection.label}` : `${otherName}에서 ${connection.label}`,
        textEn: outgoing ? `${connection.label} to ${otherName}` : `${connection.label} from ${otherName}`,
      }
    })
}

export function ExecutorInspector({
  executor,
  graph,
  workspaceId = "workspace:draft",
  topologyId = "workspace:draft",
  onExecutorChange,
  onConfirmUnderstanding,
}: ExecutorInspectorProps) {
  const { text } = useUiI18n()
  const [aiDialogTrigger, setAiDialogTrigger] = React.useState<NodeDefinitionTriggerField | null>(null)
  const inference = React.useMemo(() => inferenceForExecutor(executor), [executor])
  const friendlyInference = React.useMemo(() => friendlyInferenceForDisplay(inference), [inference])
  const connectedExecutors = React.useMemo(
    () => executor ? describeExecutorConnections(graph, executor.id) : [],
    [executor, graph],
  )
  const relationInfo = React.useMemo(
    () => executor ? buildExecutorGraphRelationInfoMap(graph).get(executor.id) : undefined,
    [executor, graph],
  )

  if (!executor || !inference) {
    return (
      <section
        className="rounded-lg border border-stone-200 bg-white p-4"
        data-testid="executor-inspector"
        data-empty="true"
      >
        <div className="text-sm font-semibold text-stone-950">
          {text("실행자 확인", "Executor inspector")}
        </div>
        <div className="mt-3 rounded-lg border border-dashed border-stone-200 p-4 text-sm text-stone-500">
          {text("실행자를 선택하면 여기에서 노비가 이해한 내용을 확인합니다.", "Select an executor to review what Nobie understood.")}
        </div>
      </section>
    )
  }

  const understandingState = executor.userConfirmed ? "confirmed" : "needs_review"
  const runtimeLabel = executorFriendlyRuntimeLabel(executor.inferredRuntimeMode)
  const definitionDraft = nodeDefinitionDraftFromExecutor(executor)
  const graphContext = buildNodeDefinitionGraphContext({ graph, executorId: executor.id })
  const applyAiDefinitionDraft = (nextDraft: NodeDefinitionDraft) => {
    onExecutorChange?.(executorFromNodeDefinitionDraft({
      executor,
      draft: nextDraft,
      now: Date.now(),
    }))
  }

  return (
    <section
      className="rounded-lg border border-stone-200 bg-white p-4"
      data-testid="executor-inspector"
      data-empty="false"
      data-understanding-state={understandingState}
      data-runtime-label={runtimeLabel}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-stone-950">
            {text("선택한 실행자", "Selected executor")}
          </div>
          <div className="mt-1 text-xs text-stone-500">
            {text("이름과 성격을 정하면 노비가 실행 구조를 안에서 정리합니다.", "Define the name and character; Nobie prepares the run structure internally.")}
          </div>
        </div>
        <span
          className="rounded-full bg-stone-100 px-2 py-0.5 text-[11px] font-semibold text-stone-700"
          title={text(
            "아래 노비가 이해한 내용에서 저장을 누르면 이 정의가 저장됩니다.",
            "Press Save in the understanding panel below to save this definition.",
          )}
        >
          {executor.userConfirmed ? text("확인됨", "Confirmed") : text("내용 검토 전", "Not reviewed")}
        </span>
      </div>
      {relationInfo ? (
        <div
          className="mt-3 rounded-md border border-stone-200 bg-stone-50 px-2.5 py-2"
          data-testid="executor-inspector-relation"
          data-relation-kind={relationInfo.relationKind}
          data-selectable-without-path={relationInfo.selectableWithoutPath}
        >
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-stone-800">
              {text(relationInfo.relationLabelKo, relationInfo.relationLabelEn)}
            </span>
            {relationInfo.duplicateName ? (
              <>
                <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-800">
                  {relationInfo.roleLabel}
                </span>
                <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-stone-600">
                  {relationInfo.shortId}
                </span>
              </>
            ) : null}
          </div>
          <div className="mt-1 text-[11px] leading-5 text-stone-500">
            {text(relationInfo.relationDetailKo, relationInfo.relationDetailEn)}
          </div>
        </div>
      ) : null}

      <div className="mt-3 grid gap-2">
        <label className="grid gap-1 text-xs font-semibold text-stone-500">
          <span>{text("이름", "Name")}</span>
          <input
            value={executor.name}
            onChange={(event) => onExecutorChange?.(updateExecutorDraftFromInspector(executor, { name: event.currentTarget.value }))}
            className="h-9 rounded-md border border-stone-200 px-2.5 text-sm font-semibold text-stone-900"
            data-testid="executor-inspector-name"
          />
        </label>
        <label className="grid gap-1 text-xs font-semibold text-stone-500">
          <span>{text("역할명", "Role name")}</span>
          <input
            value={executor.executorProfile?.roleName ?? ""}
            onChange={(event) => onExecutorChange?.(updateExecutorDraftFromInspector(executor, { roleName: event.currentTarget.value }))}
            className="h-9 rounded-md border border-stone-200 px-2.5 text-sm font-semibold text-stone-900"
            data-testid="executor-inspector-role-name"
          />
        </label>
        <div className="grid gap-1 text-xs font-semibold text-stone-500">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="executor-inspector-description-input">
              {text("성격과 하는 일", "Character and work")}
            </label>
            <NodeDefinitionAiButton
              ariaLabel={text("성격과 하는 일을 AI로 다듬기", "Refine character and work with AI")}
              onClick={() => setAiDialogTrigger("description")}
              testId="executor-inspector-description-ai"
            />
          </div>
          <textarea
            id="executor-inspector-description-input"
            value={executor.description}
            onChange={(event) => onExecutorChange?.(updateExecutorDraftFromInspector(executor, { description: event.currentTarget.value }))}
            rows={3}
            className="resize-none rounded-md border border-stone-200 px-2.5 py-2 text-sm leading-5 text-stone-900"
            data-testid="executor-inspector-description"
          />
        </div>
      </div>

      <section className="mt-3 rounded-md border border-stone-200 bg-stone-50 px-2.5 py-2" data-testid="executor-inspector-connections">
        <div className="text-[11px] font-semibold text-stone-500">
          {text("연결된 실행자", "Connected executors")}
        </div>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {(connectedExecutors.length > 0 ? connectedExecutors : [{
            id: "empty",
            direction: "outgoing" as const,
            label: "넘김" as const,
            textKo: text("아직 연결 없음", "No connections yet"),
            textEn: "No connections yet",
          }]).map((connection) => (
            <span
              key={connection.id}
              className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-stone-700"
              data-testid="executor-inspector-connection"
              data-direction={connection.direction}
            >
              {text(connection.textKo, connection.textEn)}
            </span>
          ))}
        </div>
      </section>

      <ExecutorUnderstandingPanel
        name={executor.name}
        description={executor.description}
        inference={friendlyInference}
        confirmDisabled={executor.userConfirmed === true}
        onConfirm={() => onConfirmUnderstanding?.(confirmExecutorUnderstanding(executor))}
      />

      <NodeDefinitionAiDialog
        open={aiDialogTrigger !== null}
        workspaceId={workspaceId}
        topologyId={topologyId}
        draft={definitionDraft}
        graphContext={graphContext}
        triggerField={aiDialogTrigger ?? "whole_node"}
        onClose={() => setAiDialogTrigger(null)}
        onApply={applyAiDefinitionDraft}
      />
    </section>
  )
}

function inferenceForExecutor(executor: ExecutorDraft | null | undefined): ExecutorInferenceResult | null {
  if (!executor) return null
  const inferred = inferExecutorFromDescription({
    name: executor.name,
    description: executor.description,
  })
  return {
    ...inferred,
    runtimeMode: executor.inferredRuntimeMode,
    toolHints: executor.inferredTools.length > 0 ? executor.inferredTools : inferred.toolHints,
    outputHints: executor.inferredOutputs.length > 0 ? executor.inferredOutputs : inferred.outputHints,
    successCriteria: executor.inferredSuccessCriteria.length > 0 ? executor.inferredSuccessCriteria : inferred.successCriteria,
    capabilityHints: executor.inferredCapabilities.length > 0 ? executor.inferredCapabilities : inferred.capabilityHints,
    confidence: executor.confidence,
  }
}

function friendlyInferenceForDisplay(inference: ExecutorInferenceResult | null): ExecutorInferenceResult | undefined {
  if (!inference) return undefined
  return {
    ...inference,
    toolHints: inference.toolHints.map(friendlyResourceLabel),
  }
}

function friendlyResourceLabel(resourceId: string): string {
  if (resourceId === "tool:crm-search") return "CRM 검색"
  if (resourceId === "system:crm") return "CRM"
  if (resourceId === "tool:web-research") return "웹 조사"
  if (resourceId === "tool:recommended") return "추천 도구"
  if (resourceId.startsWith("system:")) return "연결된 시스템"
  if (resourceId.startsWith("tool:")) return "연결된 도구"
  return resourceId
}

function mergeAdvancedMappingAfterInference(
  previous: ExecutorAdvancedMapping | undefined,
  inferred: ExecutorAdvancedMapping | undefined,
): ExecutorAdvancedMapping | undefined {
  if (!inferred) return previous
  if (previous?.executorKind === "agent" || previous?.executorKind === "team") {
    return {
      ...inferred,
      executorKind: previous.executorKind,
      ...(previous.executorId ? { executorId: previous.executorId } : {}),
      allowedToolIds: previous.allowedToolIds ?? inferred.allowedToolIds,
      allowedSystemIds: previous.allowedSystemIds ?? inferred.allowedSystemIds,
    }
  }
  return inferred
}
