import * as React from "react"
import { api } from "../../api/client"
import {
  NODE_DEFINITION_ROLE_CHIPS,
  NODE_DEFINITION_STYLE_CHIPS,
  applyNodeDefinitionAlternative,
  fieldLocksForNodeDefinitionTrigger,
  initialNodeDefinitionQuickChipsFromDraft,
  type ApplyNodeDefinitionAlternativeResult,
  type NodeDefinitionAlternative,
  type NodeDefinitionDialogState,
  type NodeDefinitionDraft,
  type NodeDefinitionField,
  type NodeDefinitionFieldLocks,
  type NodeDefinitionGraphContext,
  type NodeDefinitionSuggestionHistoryItem,
  type NodeDefinitionSuggestionRequest,
  type NodeDefinitionSuggestionResult,
  type NodeDefinitionTriggerField,
} from "../../lib/node-definition-suggestion"
import { NODE_DEFINITION_FIELD_LABELS, NodeDefinitionAlternativeCard } from "./NodeDefinitionAlternativeCard"

export interface NodeDefinitionAiDialogProps {
  open: boolean
  workspaceId: string
  topologyId: string
  draft: NodeDefinitionDraft
  graphContext: NodeDefinitionGraphContext
  triggerField: NodeDefinitionTriggerField
  initialFieldLocks?: Partial<NodeDefinitionFieldLocks>
  onClose: () => void
  onApply: (draft: NodeDefinitionDraft, result: ApplyNodeDefinitionAlternativeResult) => void
  suggest?: (payload: Partial<NodeDefinitionSuggestionRequest>) => Promise<NodeDefinitionSuggestionResult>
}

export function NodeDefinitionAiDialog({
  open,
  workspaceId,
  topologyId,
  draft,
  graphContext,
  triggerField,
  initialFieldLocks = {},
  onClose,
  onApply,
  suggest,
}: NodeDefinitionAiDialogProps) {
  const effectiveTriggerField: NodeDefinitionTriggerField = "description"
  const [state, setState] = React.useState<NodeDefinitionDialogState>("idle")
  const [quickChips, setQuickChips] = React.useState<string[]>(() =>
    initialNodeDefinitionQuickChipsFromDraft(draft),
  )
  const [nodeOverview, setNodeOverview] = React.useState(() => draft.description)
  const [fieldLocks, setFieldLocks] = React.useState<NodeDefinitionFieldLocks>(() =>
    descriptionOnlyFieldLocks(initialFieldLocks),
  )
  const [targetFields, setTargetFields] = React.useState<NodeDefinitionField[]>(() =>
    ["name", "description"],
  )
  const [alternatives, setAlternatives] = React.useState<NodeDefinitionAlternative[]>([])
  const [activeAlternativeId, setActiveAlternativeId] = React.useState("")
  const [history, setHistory] = React.useState<NodeDefinitionSuggestionHistoryItem[]>([])
  const [errorMessage, setErrorMessage] = React.useState("")
  const [warnings, setWarnings] = React.useState<string[]>([])
  const initialFieldLocksKey = JSON.stringify(initialFieldLocks)

  React.useEffect(() => {
    if (!open) return
    const locks = descriptionOnlyFieldLocks(initialFieldLocks)
    setState("editing_prompt")
    setQuickChips(initialNodeDefinitionQuickChipsFromDraft(draft))
    setNodeOverview(draft.description)
    setFieldLocks(locks)
    setTargetFields(["name", "description"])
    setAlternatives([])
    setActiveAlternativeId("")
    setHistory([])
    setErrorMessage("")
    setWarnings([])
  }, [draft.executorId, initialFieldLocksKey, open, triggerField])

  React.useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") handleClose()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  })

  if (!open) return null

  const loading = state === "loading" || state === "applying"
  const canSuggest = !loading && targetFields.length > 0
  const effectiveSuggest = suggest ?? ((payload) => api.suggestExecutorNodeDefinition(workspaceId, topologyId, payload))
  const initialQuickChips = initialNodeDefinitionQuickChipsFromDraft(draft)
  const hasQuickChipChanges = !sameStringList(quickChips, initialQuickChips)
  const hasOverviewChanges = nodeOverview.trim() !== draft.description.trim()
  const canSaveSettings = !loading
  const activeAlternativeIndex = alternatives.length > 0
    ? Math.max(0, alternatives.findIndex((alternative) => alternative.alternativeId === activeAlternativeId))
    : -1
  const activeAlternative = activeAlternativeIndex >= 0 ? alternatives[activeAlternativeIndex] : undefined

  const submitSuggestion = async (refresh = false) => {
    if (!canSuggest) return
    setState("loading")
    setErrorMessage("")
    setWarnings([])
    const promptText = nodeOverview.trim()
    const nextHistory = refresh && alternatives.length > 0
      ? [
          ...history,
          {
            userPrompt: promptText,
            alternativeSummaries: alternatives.map((alternative) => alternative.summary),
            rejectedAlternativeIds: alternatives.map((alternative) => alternative.alternativeId),
          },
        ]
      : history
    setHistory(nextHistory)
    try {
      const result = await effectiveSuggest({
        workspaceId,
        topologyId,
        executorId: draft.executorId,
        triggerField: effectiveTriggerField,
        targetFields,
        userPrompt: promptText,
        quickChips,
        currentDraft: { ...draft, quickChips, fieldLocks },
        fieldLocks,
        graphContext,
        redaction: { mode: "workspace_default", redactedFields: [] },
        suggestionHistory: nextHistory,
      })
      if (result.ok) {
        setAlternatives(result.alternatives)
        setActiveAlternativeId(result.alternatives[0]?.alternativeId ?? "")
        setWarnings(result.warnings.map((warning) => warning.message))
        setState("showing_alternatives")
        return
      }
      setErrorMessage(result.message)
      setWarnings(result.warnings.map((warning) => warning.message))
      setState("error")
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "AI 제안을 가져오지 못했습니다.")
      setState("error")
    }
  }

  const saveQuickChipSettings = () => {
    if (!canSaveSettings) return
    setState("applying")
    const previousDraft = cloneNodeDefinitionDraft(draft)
    const nextDraft = cloneNodeDefinitionDraft({
      ...draft,
      quickChips: [...quickChips],
      fieldLocks,
    })
    const result: ApplyNodeDefinitionAlternativeResult = {
      draft: nextDraft,
      previousDraft,
      diff: [],
      appliedFields: [],
      ignoredLockedFields: [],
    }
    onApply(nextDraft, result)
    onClose()
  }

  const applyAlternative = (alternative: NodeDefinitionAlternative) => {
    setState("applying")
    const result = applyNodeDefinitionAlternative({
      executorId: draft.executorId,
      alternativeId: alternative.alternativeId,
      draft: { ...draft, quickChips, fieldLocks },
      patch: alternative.patch,
      fieldLocks,
    })
    setHistory((items) => [
      ...items,
      {
        userPrompt: quickChips.join(", "),
        alternativeSummaries: alternatives.map((item) => item.summary),
        selectedAlternativeId: alternative.alternativeId,
        rejectedAlternativeIds: alternatives
          .map((item) => item.alternativeId)
          .filter((id) => id !== alternative.alternativeId),
      },
    ])
    onApply(result.draft, result)
    onClose()
  }

  const toggleChip = (chip: string) => {
    setQuickChips((current) => current.includes(chip)
      ? current.filter((item) => item !== chip)
      : [...current, chip])
  }

  function handleClose() {
    const hasDialogWork = hasQuickChipChanges || hasOverviewChanges || alternatives.length > 0
    if (hasDialogWork && typeof window !== "undefined" && !window.confirm("AI 제안 창을 닫을까요? 선택하지 않은 제안은 반영되지 않습니다.")) {
      return
    }
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/35 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="node-definition-ai-dialog-title"
      data-testid="node-definition-ai-dialog"
    >
      <div className="flex max-h-[calc(100vh-32px)] w-full max-w-[820px] flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        <header className="border-b border-stone-200 px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 id="node-definition-ai-dialog-title" className="text-sm font-semibold text-stone-950">
                {dialogTitle(effectiveTriggerField)}
              </h2>
              <p className="mt-1 text-xs leading-5 text-stone-500">
                역할과 스타일을 고르면 3가지 대안을 만듭니다. 선택 전에는 노드가 바뀌지 않습니다.
              </p>
            </div>
            <button
              type="button"
              onClick={handleClose}
              className="h-8 rounded-md border border-stone-200 bg-white px-3 text-xs font-semibold text-stone-700"
              data-testid="node-definition-dialog-close"
            >
              닫기
            </button>
          </div>
        </header>

        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto px-4 py-4">
          <ChipGroup title="역할" chips={NODE_DEFINITION_ROLE_CHIPS} selected={quickChips} onToggle={toggleChip} />
          <ChipGroup title="스타일" chips={NODE_DEFINITION_STYLE_CHIPS} selected={quickChips} onToggle={toggleChip} />

          <section className="grid gap-2 rounded-lg border border-stone-200 bg-stone-50 p-3" data-testid="node-definition-overview-section">
            <div className="text-xs font-semibold text-stone-700">노드 개요</div>
            <p className="text-xs leading-5 text-stone-500">
              이 노드가 어떤 사람처럼 일해야 하는지 짧게 적어 주세요. AI는 이 개요를 바탕으로 역할, 판단 기준, 처리 방식, 연결된 실행자에게 넘길 내용을 상세한 성격과 하는 일로 확장합니다.
            </p>
            <textarea
              value={nodeOverview}
              onChange={(event) => setNodeOverview(event.currentTarget.value)}
              className="min-h-24 resize-y rounded-md border border-stone-200 bg-white px-3 py-2 text-sm leading-6 text-stone-900 outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
              placeholder="예: 백엔드 이슈를 분석하고 작업을 작게 나눠서 다음 담당자에게 넘기는 시니어 백엔드 엔지니어"
              data-testid="node-definition-dialog-overview"
            />
          </section>

          {warnings.length > 0 ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800" data-testid="node-definition-dialog-warnings">
              {warnings.slice(0, 3).join(" / ")}
            </div>
          ) : null}

          {state === "error" ? (
            <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs leading-5 text-rose-800" data-testid="node-definition-dialog-error">
              {errorMessage || "AI 제안을 가져오지 못했습니다."}
            </div>
          ) : null}

          {alternatives.length > 0 ? (
            <section
              className="grid min-w-0 gap-3"
              data-testid="node-definition-alternative-list"
              aria-label="AI 제안 대안"
            >
              <div className="flex min-w-0 gap-2 overflow-x-auto pb-1" role="tablist" aria-label="AI 제안 선택">
                {alternatives.map((alternative, index) => {
                  const active = index === activeAlternativeIndex
                  const tabId = `node-definition-alternative-tab-${index}`
                  const panelId = `node-definition-alternative-panel-${index}`
                  return (
                    <button
                      key={alternative.alternativeId}
                      type="button"
                      id={tabId}
                      role="tab"
                      aria-selected={active}
                      aria-controls={panelId}
                      onClick={() => setActiveAlternativeId(alternative.alternativeId)}
                      className={`min-w-[144px] rounded-lg border px-3 py-2 text-left ${
                        active
                          ? "border-stone-950 bg-stone-950 text-white"
                          : "border-stone-200 bg-white text-stone-700 hover:border-stone-300"
                      }`}
                      data-testid="node-definition-alternative-tab"
                    >
                      <span className="block text-[11px] font-semibold">대안 {index + 1}</span>
                      <span className={`mt-0.5 block truncate text-xs font-semibold ${active ? "text-white" : "text-stone-950"}`}>
                        {alternative.title}
                      </span>
                    </button>
                  )
                })}
              </div>
              {activeAlternative ? (
                <div
                  role="tabpanel"
                  id={`node-definition-alternative-panel-${activeAlternativeIndex}`}
                  aria-labelledby={`node-definition-alternative-tab-${activeAlternativeIndex}`}
                  data-testid="node-definition-alternative-panel"
                >
                  <NodeDefinitionAlternativeCard
                    alternative={activeAlternative}
                    currentDraft={draft}
                    fieldLocks={fieldLocks}
                    onSelect={applyAlternative}
                  />
                </div>
              ) : null}
            </section>
          ) : null}
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-stone-200 bg-white px-4 py-3">
          <div className="text-xs text-stone-500">
            {targetFields.length > 0 ? "이름과 성격과 하는 일 갱신 가능" : "갱신할 항목이 없습니다"}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleClose}
              className="h-9 rounded-md border border-stone-200 bg-white px-3 text-xs font-semibold text-stone-700"
              data-testid="node-definition-dialog-cancel"
            >
              취소
            </button>
            <button
              type="button"
              onClick={saveQuickChipSettings}
              disabled={!canSaveSettings}
              className="h-9 rounded-md border border-stone-200 bg-white px-3 text-xs font-semibold text-stone-800 disabled:cursor-not-allowed disabled:opacity-50"
              data-testid="node-definition-dialog-save"
            >
              저장
            </button>
            {alternatives.length > 0 ? (
              <button
                type="button"
                onClick={() => void submitSuggestion(true)}
                disabled={!canSuggest}
                className="h-9 rounded-md border border-stone-200 bg-white px-3 text-xs font-semibold text-stone-800 disabled:cursor-not-allowed disabled:opacity-50"
                data-testid="node-definition-dialog-refresh"
              >
                다시 제안
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => void submitSuggestion(false)}
              disabled={!canSuggest}
              className="h-9 rounded-md bg-stone-950 px-3 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
              data-testid="node-definition-dialog-submit"
            >
              {loading ? "제안 중" : "제안 받기"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}

function ChipGroup({
  title,
  chips,
  selected,
  onToggle,
}: {
  title: string
  chips: readonly string[]
  selected: string[]
  onToggle: (chip: string) => void
}) {
  return (
    <section className="grid gap-1.5" data-testid="node-definition-chip-group">
      <div className="text-xs font-semibold text-stone-700">{title}</div>
      <div className="flex flex-wrap gap-1.5">
        {chips.map((chip) => {
          const active = selected.includes(chip)
          return (
            <button
              key={chip}
              type="button"
              onClick={() => onToggle(chip)}
              className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                active
                  ? "border-stone-950 bg-stone-950 text-white"
                  : "border-stone-200 bg-white text-stone-700"
              }`}
              aria-pressed={active}
              data-testid="node-definition-quick-chip"
            >
              {chip}
            </button>
          )
        })}
      </div>
    </section>
  )
}

function dialogTitle(triggerField: NodeDefinitionTriggerField): string {
  if (triggerField === "whole_node") return "실행자 전체를 AI로 다듬기"
  return `${NODE_DEFINITION_FIELD_LABELS[triggerField]} AI 제안`
}

function descriptionOnlyFieldLocks(
  initialFieldLocks: Partial<NodeDefinitionFieldLocks>,
): NodeDefinitionFieldLocks {
  return fieldLocksForNodeDefinitionTrigger("description", {
    ...initialFieldLocks,
    name: false,
    description: false,
    expectedOutput: true,
    successCriteria: true,
    capabilityHints: true,
    toolHints: true,
    understandingSummary: true,
  })
}

function sameStringList(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false
  return left.every((item, index) => item === right[index])
}

function cloneNodeDefinitionDraft(draft: NodeDefinitionDraft): NodeDefinitionDraft {
  return {
    ...draft,
    ...(draft.quickChips ? { quickChips: [...draft.quickChips] } : {}),
    successCriteria: [...draft.successCriteria],
    capabilityHints: [...draft.capabilityHints],
    toolHints: [...draft.toolHints],
    fieldLocks: { ...draft.fieldLocks },
    ...(draft.aiSuggestionState ? {
      aiSuggestionState: {
        ...draft.aiSuggestionState,
        ...(draft.aiSuggestionState.appliedFieldNames ? {
          appliedFieldNames: [...draft.aiSuggestionState.appliedFieldNames],
        } : {}),
      },
    } : {}),
  }
}
