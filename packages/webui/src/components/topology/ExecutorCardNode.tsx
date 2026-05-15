import * as React from "react"
import type { ExecutorDraft, ExecutorRuntimeMode } from "../../lib/executor-graph"
import type { ExecutorCardResourceChip } from "../../lib/executor-graph-viewmodel"
import { useUiI18n } from "../../lib/ui-i18n"

export type ExecutorCardExecutionStatus =
  | "planning"
  | "delegating"
  | "running"
  | "recovering"
  | "completed"
  | "failed"
  | "cancelled"

export interface ExecutorRuntimeStatusCopy {
  mode: ExecutorRuntimeMode
  labelKo: "자동 처리" | "최종 검토" | "도구 사용" | "외부 연동"
  labelEn: "Auto" | "Final review" | "Uses tools" | "External"
  tone: "auto" | "review" | "tool" | "external"
}

export function executorRuntimeStatusCopy(mode: ExecutorRuntimeMode): ExecutorRuntimeStatusCopy {
  if (mode === "approval" || mode === "human_check" || mode === "unknown") {
    return {
      mode,
      labelKo: "최종 검토",
      labelEn: "Final review",
      tone: "review",
    }
  }
  if (mode === "tool_execution") {
    return {
      mode,
      labelKo: "도구 사용",
      labelEn: "Uses tools",
      tone: "tool",
    }
  }
  if (mode === "external") {
    return {
      mode,
      labelKo: "외부 연동",
      labelEn: "External",
      tone: "external",
    }
  }
  return {
    mode,
    labelKo: "자동 처리",
    labelEn: "Auto",
    tone: "auto",
  }
}

export function selectExecutorCardCapabilities(
  summary: string,
  capabilities: readonly string[],
): string[] {
  const normalizedSummary = normalizeExecutorCardText(summary)
  const seen = new Set<string>()
  const visible: string[] = []
  for (const capability of capabilities) {
    const trimmed = capability.trim()
    const normalized = normalizeExecutorCardText(trimmed)
    if (!trimmed || !normalized) continue
    if (normalized === normalizedSummary) continue
    if (normalized.includes(normalizedSummary) || normalizedSummary.includes(normalized)) {
      if (normalized.length > 16) continue
    }
    if (normalized.length > 36) continue
    if (seen.has(normalized)) continue
    seen.add(normalized)
    visible.push(trimmed)
    if (visible.length >= 3) break
  }
  return visible
}

function normalizeExecutorCardText(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

export function ExecutorCardNode({
  executor,
  resources = [],
  selected = false,
  working = false,
  executionStatus,
  relationLabel,
  relationDescription,
  roleLabel,
  shortId,
  duplicateName = false,
  selectableWithoutPath = true,
  onSelect,
}: {
  executor: ExecutorDraft
  resources?: ExecutorCardResourceChip[]
  selected?: boolean
  working?: boolean
  executionStatus?: ExecutorCardExecutionStatus
  relationLabel?: string
  relationDescription?: string
  roleLabel?: string
  shortId?: string
  duplicateName?: boolean
  selectableWithoutPath?: boolean
  onSelect?: (executorId: string) => void
}) {
  const { text } = useUiI18n()
  const summary = executor.description.trim() || text("하는 일이 아직 정리되지 않았습니다.", "Work is not described yet.")
  const capabilities = selectExecutorCardCapabilities(summary, executor.inferredCapabilities)
  const roleName = executor.executorProfile?.roleName?.trim()

  return (
    <article
      className={`min-h-[132px] max-h-[168px] overflow-hidden rounded-lg border bg-white p-3 shadow-sm ${
        selected ? "border-stone-900 ring-2 ring-stone-200" : "border-stone-200"
      } ${onSelect ? "cursor-pointer" : ""}`}
      data-testid="executor-card-node"
      data-executor-id={executor.id}
      data-runtime-mode={executor.inferredRuntimeMode}
      data-selected={selected}
      data-working={working}
      data-execution-status={executionStatus ?? "idle"}
      role={onSelect ? "button" : undefined}
      tabIndex={onSelect ? 0 : undefined}
      onClick={() => onSelect?.(executor.id)}
      onKeyDown={(event) => {
        if (!onSelect || (event.key !== "Enter" && event.key !== " ")) return
        event.preventDefault()
        onSelect(executor.id)
      }}
    >
      <div className="min-w-0">
        <h3 className="truncate text-sm font-semibold text-stone-950">
          {executor.name}
        </h3>
        {(roleName || relationLabel || duplicateName) ? (
          <div className="mt-1 flex flex-wrap gap-1" data-testid="executor-card-relation-badges">
            {roleName ? (
              <span
                className="rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-semibold text-sky-800"
                data-testid="executor-card-role-name"
              >
                {roleName}
              </span>
            ) : null}
            {relationLabel ? (
              <span
                className="rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-semibold text-stone-700"
                title={relationDescription}
                data-testid="executor-card-relation"
                data-selectable-without-path={selectableWithoutPath}
              >
                {relationLabel}
              </span>
            ) : null}
            {duplicateName && roleLabel ? (
              <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-semibold text-sky-800">
                {roleLabel}
              </span>
            ) : null}
            {duplicateName && shortId ? (
              <span className="rounded-full bg-stone-50 px-2 py-0.5 text-[10px] font-semibold text-stone-600">
                {shortId}
              </span>
            ) : null}
          </div>
        ) : null}
        <p className="mt-1 max-h-10 overflow-hidden text-xs leading-5 text-stone-600">
          {summary}
        </p>
      </div>

      {executionStatus ? (
        <div className="mt-2">
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${executionStatusClassName(executionStatus)}`}>
            {executionStatusLabel(executionStatus, text)}
          </span>
        </div>
      ) : null}

      {resources.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5" data-testid="executor-card-resource-chips">
          {resources.slice(0, 4).map((resource) => (
            <span
              key={resource.id}
              className="rounded-full border border-stone-200 bg-stone-50 px-2 py-0.5 text-[10px] font-semibold text-stone-600"
              data-testid="executor-resource-chip"
              data-resource-kind={resource.kind}
              data-resource-id={resource.id}
            >
              {resource.label}
            </span>
          ))}
        </div>
      ) : null}

      {capabilities.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1" aria-label={text("노비가 이해한 내용", "What Nobie understood")}>
          {capabilities.map((capability) => (
            <span
              key={capability}
              className="rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-medium text-sky-800"
              data-testid="executor-card-capability"
            >
              {capability}
            </span>
          ))}
        </div>
      ) : null}
    </article>
  )
}

function executionStatusLabel(
  status: ExecutorCardExecutionStatus,
  text: ReturnType<typeof useUiI18n>["text"],
): string {
  if (status === "planning") return text("계획 중", "Planning")
  if (status === "delegating") return text("위임 중", "Delegating")
  if (status === "running") return text("작업 중", "Running")
  if (status === "recovering") return text("복구 중", "Recovering")
  if (status === "completed") return text("완료", "Completed")
  if (status === "failed") return text("실패", "Failed")
  return text("중단됨", "Cancelled")
}

function executionStatusClassName(status: ExecutorCardExecutionStatus): string {
  if (status === "recovering") return "bg-violet-100 text-violet-800"
  if (status === "completed") return "bg-emerald-100 text-emerald-800"
  if (status === "failed") return "bg-rose-100 text-rose-800"
  if (status === "cancelled") return "bg-stone-200 text-stone-700"
  if (status === "delegating") return "bg-sky-100 text-sky-800"
  return "bg-blue-100 text-blue-800"
}
