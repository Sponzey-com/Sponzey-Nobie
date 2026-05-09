import * as React from "react"
import {
  createExecutorDraftFromInference,
  inferExecutorFromDescription,
  type ExecutorInferenceResult,
} from "../../lib/executor-inference"
import {
  buildNodeDefinitionGraphContext,
  nodeDefinitionDraftFromExecutor,
  type NodeDefinitionDraft,
  type NodeDefinitionTriggerField,
} from "../../lib/node-definition-suggestion"
import { useUiI18n } from "../../lib/ui-i18n"
import { NodeDefinitionAiButton } from "./NodeDefinitionAiButton"
import { NodeDefinitionAiDialog } from "./NodeDefinitionAiDialog"
import { ExecutorUnderstandingPanel } from "./ExecutorUnderstandingPanel"

export interface ExecutorCreatePanelSubmit {
  name: string
  description: string
  inference: ExecutorInferenceResult
  userConfirmed: boolean
}

export interface ExecutorCreatePanelProps {
  initialName?: string
  initialDescription?: string
  titleKo?: string
  titleEn?: string
  helperKo?: string
  helperEn?: string
  descriptionLabelKo?: string
  descriptionLabelEn?: string
  descriptionPlaceholderKo?: string
  descriptionPlaceholderEn?: string
  showCancel?: boolean
  showDraftButton?: boolean
  showExamples?: boolean
  hideUnderstandingUntilReady?: boolean
  surface?: "bar" | "card"
  workspaceId?: string
  topologyId?: string
  onCreate?: (input: ExecutorCreatePanelSubmit) => void
  onCancel?: () => void
}

const DESCRIPTION_EXAMPLES = [
  "고객 요청을 읽고 CRM에서 고객 정보를 확인한 뒤 정리한다.",
  "승인 여부를 확인하고 승인 또는 반려 결과를 남긴다.",
  "실패나 예외 상황을 정리하고 다음 담당자에게 넘긴다.",
  "자료를 조사하고 핵심 내용을 요약해 보고한다.",
] as const

export function ExecutorCreatePanel({
  initialName = "",
  initialDescription = "",
  titleKo = "실행자 추가",
  titleEn = "Add executor",
  helperKo = "이름과 하는 일만 적으면 나머지는 노비가 먼저 추론합니다.",
  helperEn = "Enter only the name and what it does; Nobie infers the rest first.",
  descriptionLabelKo = "하는 일",
  descriptionLabelEn = "What it does",
  descriptionPlaceholderKo = "예: 고객 요청을 읽고 CRM에서 정보를 확인한다.",
  descriptionPlaceholderEn = "e.g. Reads the request and checks CRM.",
  showCancel = true,
  showDraftButton = true,
  showExamples = true,
  hideUnderstandingUntilReady = false,
  surface = "bar",
  workspaceId = "workspace:draft",
  topologyId = "workspace:draft",
  onCreate,
  onCancel,
}: ExecutorCreatePanelProps) {
  const { text } = useUiI18n()
  const [name, setName] = React.useState(initialName)
  const [description, setDescription] = React.useState(initialDescription)
  const [aiDialogTrigger, setAiDialogTrigger] = React.useState<NodeDefinitionTriggerField | null>(null)
  const trimmedName = name.trim()
  const trimmedDescription = description.trim()
  const canCreate = trimmedName.length > 0 && trimmedDescription.length > 0
  const inference = React.useMemo(
    () => inferExecutorFromDescription({ name: trimmedName, description: trimmedDescription }),
    [trimmedDescription, trimmedName],
  )
  const aiDraft = React.useMemo(() => {
    const executor = createExecutorDraftFromInference({
      id: "node:create-draft",
      name,
      description,
    })
    return nodeDefinitionDraftFromExecutor(executor)
  }, [description, name])
  const applyAiDefinitionDraft = (draft: NodeDefinitionDraft) => {
    setName(draft.name)
    setDescription(draft.description)
  }

  const submit = React.useCallback((userConfirmed: boolean) => {
    if (!canCreate) return
    onCreate?.({
      name: trimmedName,
      description: trimmedDescription,
      inference,
      userConfirmed,
    })
  }, [canCreate, inference, onCreate, trimmedDescription, trimmedName])

  return (
    <section
      className={surface === "card"
        ? "rounded-lg border border-stone-200 bg-white p-4"
        : "border-b border-stone-200 bg-white px-4 py-3"}
      data-testid="executor-create-panel"
      data-surface={surface}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-xs font-semibold text-stone-950">
            {text(titleKo, titleEn)}
          </div>
          <div className="mt-1 text-xs leading-5 text-stone-500">
            {text(helperKo, helperEn)}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <NodeDefinitionAiButton
            label={text("AI로 다듬기", "Refine with AI")}
            ariaLabel={text("성격과 하는 일을 AI로 다듬기", "Refine character and work with AI")}
            compact={false}
            onClick={() => setAiDialogTrigger("description")}
            testId="executor-create-ai-refine"
          />
          {showCancel ? (
            <button
              type="button"
              onClick={onCancel}
              className="h-8 rounded-md border border-stone-200 bg-white px-3 text-xs font-semibold text-stone-700"
              data-testid="executor-create-cancel"
            >
              {text("닫기", "Close")}
            </button>
          ) : null}
        </div>
      </div>

      <div className={surface === "card" ? "mt-3 grid gap-3" : "mt-3 grid gap-3 lg:grid-cols-[220px_minmax(0,1fr)]"}>
        <div className="grid gap-2">
          <label className="grid gap-1 text-xs font-semibold text-stone-700">
            <span>{text("이름", "Name")}</span>
            <input
              value={name}
              onChange={(event) => setName(event.currentTarget.value)}
              className="h-9 rounded-md border border-stone-200 bg-white px-3 text-sm font-medium text-stone-950"
              data-testid="executor-create-name"
              placeholder={text("예: 고객 접수 담당자", "e.g. Customer intake")}
            />
          </label>
          <div className="grid gap-1 text-xs font-semibold text-stone-700">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="executor-create-description-input">
                {text(descriptionLabelKo, descriptionLabelEn)}
              </label>
              <NodeDefinitionAiButton
                ariaLabel={text("하는 일을 AI로 다듬기", "Refine work description with AI")}
                onClick={() => setAiDialogTrigger("description")}
                testId="executor-create-description-ai"
              />
            </div>
            <textarea
              id="executor-create-description-input"
              value={description}
              onChange={(event) => setDescription(event.currentTarget.value)}
              rows={3}
              className="min-h-20 rounded-md border border-stone-200 bg-white px-3 py-2 text-sm leading-5 text-stone-950"
              data-testid="executor-create-description"
              placeholder={text(descriptionPlaceholderKo, descriptionPlaceholderEn)}
            />
          </div>
          {showExamples ? (
            <div className="flex flex-wrap gap-1.5" data-testid="executor-create-example-chips">
              {DESCRIPTION_EXAMPLES.map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => setDescription(example)}
                  className="rounded-full border border-stone-200 bg-stone-50 px-2 py-1 text-[11px] font-semibold text-stone-700"
                  data-testid="executor-create-example-chip"
                >
                  {example}
                </button>
              ))}
            </div>
          ) : null}
          {showDraftButton ? (
            <button
              type="button"
              onClick={() => submit(false)}
              disabled={!canCreate}
              className="h-9 rounded-md border border-stone-200 bg-white px-3 text-xs font-semibold text-stone-800 disabled:cursor-not-allowed disabled:opacity-50"
              data-testid="executor-create-draft"
            >
              {text("초안으로 추가", "Add as draft")}
            </button>
          ) : null}
        </div>

        {hideUnderstandingUntilReady && !canCreate ? (
          <div
            className="rounded-lg border border-dashed border-stone-200 bg-stone-50 p-3 text-xs leading-5 text-stone-500"
            data-testid="executor-create-waiting-understanding"
          >
            {text(
              "이름과 성격을 입력하면 노비가 이해한 내용을 바로 보여줍니다.",
              "Enter a name and character to preview what Nobie understood.",
            )}
          </div>
        ) : (
          <ExecutorUnderstandingPanel
            name={trimmedName}
            description={trimmedDescription}
            inference={inference}
            confirmDisabled={!canCreate}
            onConfirm={() => submit(true)}
          />
        )}
      </div>
      <NodeDefinitionAiDialog
        open={aiDialogTrigger !== null}
        workspaceId={workspaceId}
        topologyId={topologyId}
        draft={aiDraft}
        graphContext={buildNodeDefinitionGraphContext({ graph: null, executorId: aiDraft.executorId })}
        triggerField={aiDialogTrigger ?? "whole_node"}
        onClose={() => setAiDialogTrigger(null)}
        onApply={applyAiDefinitionDraft}
      />
    </section>
  )
}
