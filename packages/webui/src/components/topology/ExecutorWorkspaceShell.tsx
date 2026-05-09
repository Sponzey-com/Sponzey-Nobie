import * as React from "react"
import {
  topologyWorkspaceVisibleLayers,
  type TopologyWorkspaceLayer,
  type TopologyWorkspaceLayerCopy,
} from "../../lib/topology-workspace-copy"
import { useUiI18n } from "../../lib/ui-i18n"

export interface ExecutorWorkspaceRecommendedExecutor {
  id: string
  labelKo: string
  labelEn: string
  descriptionKo: string
  descriptionEn: string
}

export const EXECUTOR_WORKSPACE_RECOMMENDED_EXECUTORS: ExecutorWorkspaceRecommendedExecutor[] = [
  {
    id: "customer-intake",
    labelKo: "고객 접수 담당자",
    labelEn: "Customer intake executor",
    descriptionKo: "요청을 접수하고 필요한 정보를 확인한다.",
    descriptionEn: "Receives the request and checks required information.",
  },
  {
    id: "reviewer",
    labelKo: "검토자",
    labelEn: "Reviewer",
    descriptionKo: "결과를 확인하고 다음 단계로 넘긴다.",
    descriptionEn: "Reviews the result and moves it to the next step.",
  },
  {
    id: "operator",
    labelKo: "운영 담당자",
    labelEn: "Operations executor",
    descriptionKo: "정해진 절차에 따라 업무를 처리한다.",
    descriptionEn: "Handles work according to the agreed process.",
  },
  {
    id: "exception-handler",
    labelKo: "예외 처리 담당자",
    labelEn: "Exception handler",
    descriptionKo: "실패나 보류 상황을 확인하고 정리한다.",
    descriptionEn: "Handles failures or blocked cases.",
  },
]

export interface ExecutorWorkspaceShellProps {
  selectedLayer?: TopologyWorkspaceLayer
  visibleLayers?: TopologyWorkspaceLayerCopy[]
  savedStatusLabel?: string
  validationLabel?: string
  executorCount?: number
  connectionCount?: number
  recommendedExecutors?: ExecutorWorkspaceRecommendedExecutor[]
  showFirstStart?: boolean
  showLeftRail?: boolean
  firstStartSlot?: React.ReactNode
  validateDisabled?: boolean
  prepareRunDisabled?: boolean
  saveDisabled?: boolean
  deleteDisabled?: boolean
  onSelectLayer?: (layer: TopologyWorkspaceLayer) => void
  onValidate?: () => void
  onPrepareRun?: () => void
  onSaveDraft?: () => void
  onAddExecutor?: () => void
  onDeleteExecutor?: () => void
  onAutoLayout?: () => void
  onAddSection?: () => void
  onStartRecommendedFlow?: () => void
  children?: React.ReactNode
}

export function ExecutorWorkspaceShell({
  selectedLayer = "build",
  visibleLayers = topologyWorkspaceVisibleLayers("simple"),
  savedStatusLabel,
  validationLabel,
  executorCount = 0,
  connectionCount = 0,
  recommendedExecutors = EXECUTOR_WORKSPACE_RECOMMENDED_EXECUTORS,
  showFirstStart = true,
  showLeftRail = true,
  firstStartSlot,
  validateDisabled = false,
  prepareRunDisabled = false,
  saveDisabled = false,
  deleteDisabled,
  onSelectLayer,
  onValidate,
  onPrepareRun,
  onSaveDraft,
  onAddExecutor,
  onDeleteExecutor,
  onAutoLayout,
  onAddSection,
  onStartRecommendedFlow,
  children,
}: ExecutorWorkspaceShellProps) {
  const { text } = useUiI18n()
  const resolvedSavedLabel = savedStatusLabel ?? text("저장됨", "Saved")
  const resolvedValidationLabel = validationLabel ?? text("검증 대기", "Ready for validation")
  const hasWorkflow = executorCount > 0 || connectionCount > 0
  const isDeleteDisabled = deleteDisabled ?? (!hasWorkflow || !onDeleteExecutor)
  const guideSteps = [
    text("1. 실행자 추가", "1. Add executor"),
    text("2. 노드끼리 연결", "2. Connect nodes"),
    text("3. 요청이 오면 자동 실행", "3. Auto-run on request"),
  ]

  return (
    <div
      className="flex h-full min-h-0 flex-col bg-stone-100 text-stone-950"
      data-testid="executor-workspace-shell"
    >
      <header
        className="shrink-0 border-b border-stone-200 bg-white px-4 py-3"
        data-testid="executor-workspace-topbar"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-stone-400">
              {text("업무 흐름", "Workflow")}
            </div>
            <h1 className="mt-0.5 text-lg font-semibold leading-6">
              {text("업무 흐름 만들기", "Build a workflow")}
            </h1>
            <p className="mt-1 text-xs leading-5 text-stone-500">
              {text(
                "실행자를 추가하고 노드끼리는 선으로 바로 연결하세요. 채널이나 사용자 요청이 오면 노비가 이 흐름으로 자동 실행합니다.",
                "Add executors and connect nodes directly with lines. Nobie follows this flow automatically when a channel or user request arrives.",
              )}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {hasWorkflow ? (
              <>
                <span
                  className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-800"
                  data-testid="executor-workspace-save-status"
                >
                  {resolvedSavedLabel}
                </span>
                <span
                  className="rounded-full bg-stone-100 px-2 py-0.5 text-[11px] font-semibold text-stone-700"
                  data-testid="executor-workspace-validation-status"
                >
                  {resolvedValidationLabel}
                </span>
              </>
            ) : null}
            <button
              type="button"
              onClick={onAddExecutor}
              className="h-8 rounded-md bg-stone-900 px-3 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
              data-testid="executor-workspace-top-add-executor"
            >
              {text("노드 추가", "Add node")}
            </button>
            <button
              type="button"
              onClick={onDeleteExecutor}
              disabled={isDeleteDisabled}
              className="h-8 rounded-md border border-stone-200 bg-white px-3 text-xs font-semibold text-stone-800 disabled:cursor-not-allowed disabled:opacity-50"
              data-testid="executor-workspace-top-delete-executor"
            >
              {text("삭제", "Delete")}
            </button>
            <button
              type="button"
              onClick={onSaveDraft ?? onValidate}
              disabled={saveDisabled || (!onSaveDraft && !onValidate)}
              className="h-8 rounded-md bg-stone-900 px-3 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
              data-testid="executor-workspace-top-save"
            >
              {text("저장", "Save")}
            </button>
            <button
              type="button"
              onClick={onAutoLayout}
              disabled={!onAutoLayout || !hasWorkflow}
              className="h-8 rounded-md border border-stone-200 bg-white px-3 text-xs font-semibold text-stone-800 disabled:cursor-not-allowed disabled:opacity-50"
              data-testid="executor-workspace-top-auto-layout"
            >
              {text("자동 정렬", "Auto layout")}
            </button>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1.5" data-testid="executor-workspace-guide-steps">
            {guideSteps.map((step, index) => (
              <span
                key={step}
                className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                  index === 0 && !hasWorkflow
                    ? "bg-stone-900 text-white"
                    : "bg-stone-100 text-stone-700"
                }`}
              >
                {step}
              </span>
            ))}
          </div>
        </div>
      </header>

      <div className={showLeftRail ? "grid min-h-0 flex-1 overflow-hidden lg:grid-cols-[220px_minmax(0,1fr)]" : "flex min-h-0 flex-1 overflow-hidden"}>
        {showLeftRail ? (
          <aside
            className="min-h-0 overflow-y-auto border-r border-stone-200 bg-white p-3"
            data-testid="executor-workspace-left-rail"
          >
          <div className="grid gap-2">
            <button
              type="button"
              onClick={onAddExecutor}
              className="h-10 rounded-md bg-stone-900 px-3 text-left text-sm font-semibold text-white"
              data-testid="executor-workspace-add-executor"
            >
              {text("+ 실행자 추가", "+ Add executor")}
            </button>
            <button
              type="button"
              onClick={onAddSection}
              className="h-9 rounded-md border border-stone-200 bg-white px-3 text-left text-xs font-semibold text-stone-800"
              data-testid="executor-workspace-add-section"
            >
              {text("+ 영역 추가", "+ Add section")}
            </button>
          </div>

          <section className="mt-4" data-testid="executor-workspace-executor-list">
            <div className="text-xs font-semibold text-stone-950">
              {text("실행자 목록", "Executors")}
            </div>
            <div className="mt-1 rounded-md border border-stone-200 bg-stone-50 px-2.5 py-2 text-[11px] leading-4 text-stone-600">
              {executorCount === 0
                ? text("아직 실행자가 없습니다.", "No executors yet.")
                : text(`${executorCount}명 실행자 / ${connectionCount}개 연결`, `${executorCount} executors / ${connectionCount} connections`)}
            </div>
          </section>

          <section className="mt-4" data-testid="executor-workspace-recommended-executors">
            <div className="text-xs font-semibold text-stone-950">
              {text("추천 실행자", "Recommended executors")}
            </div>
            <div className="mt-2 grid gap-1.5">
              {recommendedExecutors.map((executor) => (
                <button
                  key={executor.id}
                  type="button"
                  onClick={onAddExecutor}
                  title={text(executor.descriptionKo, executor.descriptionEn)}
                  className="rounded-md border border-stone-200 bg-white px-2.5 py-1.5 text-left text-[11px] font-semibold text-stone-700 hover:border-sky-200 hover:bg-sky-50"
                  data-testid={`executor-workspace-recommended-${executor.id}`}
                >
                  {text(executor.labelKo, executor.labelEn)}
                </button>
              ))}
            </div>
          </section>
          </aside>
        ) : null}

        <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-4 md:overflow-hidden md:pb-0" data-testid="executor-workspace-main">
          {showFirstStart
            ? firstStartSlot ?? (
              <ExecutorWorkspaceEmptyStart
                recommendedExecutors={recommendedExecutors}
                onAddExecutor={onAddExecutor}
                onStartRecommendedFlow={onStartRecommendedFlow}
              />
            )
            : null}
          {children}
        </main>
      </div>
    </div>
  )
}

function ExecutorWorkspaceEmptyStart({
  recommendedExecutors,
  onAddExecutor,
  onStartRecommendedFlow,
}: {
  recommendedExecutors: ExecutorWorkspaceRecommendedExecutor[]
  onAddExecutor?: () => void
  onStartRecommendedFlow?: () => void
}) {
  const { text } = useUiI18n()
  return (
    <section
      className="border-b border-stone-200 bg-white px-4 py-3"
      data-testid="executor-workspace-first-start"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-stone-950">
            {text("첫 업무 흐름 만들기", "Create your first workflow")}
          </h2>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {recommendedExecutors.slice(0, 4).map((executor) => (
              <span
                key={executor.id}
                className="rounded-full bg-stone-100 px-2 py-0.5 text-[11px] font-semibold text-stone-700"
              >
                {text(executor.labelKo, executor.labelEn)}
              </span>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={onAddExecutor}
            className="h-9 rounded-md bg-stone-900 px-3 text-xs font-semibold text-white"
            data-testid="executor-workspace-first-add-executor"
          >
            {text("+ 실행자 추가", "+ Add executor")}
          </button>
          <button
            type="button"
            onClick={onStartRecommendedFlow}
            className="h-9 rounded-md border border-stone-200 bg-white px-3 text-xs font-semibold text-stone-800"
            data-testid="executor-workspace-start-recommended-flow"
          >
            {text("추천 흐름으로 시작", "Start from recommended flow")}
          </button>
        </div>
      </div>
    </section>
  )
}
