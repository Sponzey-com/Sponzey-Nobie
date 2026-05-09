import * as React from "react"
import type { TopologyWorkspaceStarterTemplate, TopologyWorkspaceStarterTemplateId } from "../../lib/topology-workspace-templates"
import { TOPOLOGY_WORKSPACE_FIRST_START_COPY } from "../../lib/topology-workspace-copy"
import { useUiI18n } from "../../lib/ui-i18n"

export interface TopologyWorkspaceFirstStartPanelProps {
  templates: TopologyWorkspaceStarterTemplate[]
  onSelectTemplate?: (templateId: TopologyWorkspaceStarterTemplateId) => void
  onAddFirstStep?: () => void
  onStartRecommendedFlow?: () => void
}

export function TopologyWorkspaceFirstStartPanel({
  templates,
  onSelectTemplate,
  onAddFirstStep,
  onStartRecommendedFlow,
}: TopologyWorkspaceFirstStartPanelProps) {
  const { text } = useUiI18n()
  const recommendedExecutorLabels = [
    text("고객 접수 담당자", "Customer intake executor"),
    text("검토자", "Reviewer"),
    text("운영 담당자", "Operations executor"),
    text("예외 처리 담당자", "Exception handler"),
  ]
  return (
    <section
      className="border-b border-stone-200 bg-white px-4 py-3"
      data-testid="topology-workspace-first-start"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-400">
            {text(TOPOLOGY_WORKSPACE_FIRST_START_COPY.templateSectionKo, TOPOLOGY_WORKSPACE_FIRST_START_COPY.templateSectionEn)}
          </div>
          <h2 className="mt-0.5 text-base font-semibold text-stone-950">
            {text("먼저 실행자 1명을 추가하세요", "Add one executor first")}
          </h2>
          <p className="mt-0.5 text-xs leading-5 text-stone-500">
            {text("누가 어떤 일을 하는지만 적으면 됩니다.", "Just describe who does what.")}
          </p>
          <div className="mt-1 flex flex-wrap gap-1.5" aria-label={text("실행자 예시", "Executor examples")}>
            {recommendedExecutorLabels.map((label) => (
              <span
                key={label}
                className="rounded-full bg-stone-100 px-2 py-0.5 text-[11px] font-semibold text-stone-700"
              >
                {label}
              </span>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={onAddFirstStep}
            className="h-9 rounded-md bg-stone-900 px-3 text-xs font-semibold text-white"
            data-testid="topology-workspace-add-first-step"
          >
            {text(TOPOLOGY_WORKSPACE_FIRST_START_COPY.primaryActionKo, TOPOLOGY_WORKSPACE_FIRST_START_COPY.primaryActionEn)}
          </button>
          <button
            type="button"
            onClick={onStartRecommendedFlow}
            className="h-9 rounded-md border border-stone-200 bg-white px-3 text-xs font-semibold text-stone-800"
            data-testid="topology-workspace-start-recommended-flow"
          >
            {text("추천 흐름으로 시작", "Start from recommended flow")}
          </button>
        </div>
      </div>

      <details className="mt-2" data-testid="topology-workspace-template-gallery">
        <summary
          className="inline-flex h-8 cursor-pointer items-center rounded-md border border-stone-200 bg-stone-50 px-3 text-xs font-semibold text-stone-800"
        >
          {text("추천 흐름 보기", "View recommended flows")}
        </summary>
        <div className="mt-2 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {templates.map((template) => (
            <button
              key={template.id}
              type="button"
              onClick={() => onSelectTemplate?.(template.id)}
              className="min-h-[64px] rounded-md border border-stone-200 bg-stone-50 px-3 py-2 text-left hover:border-sky-200 hover:bg-sky-50"
              data-testid={`topology-workspace-template-${template.id}`}
            >
              <span className="text-xs font-semibold text-stone-950">
                {text(template.labelKo, template.labelEn)}
              </span>
              <span className="mt-0.5 block text-[11px] leading-4 text-stone-600">
                {text(template.descriptionKo, template.descriptionEn)}
              </span>
            </button>
          ))}
        </div>
      </details>
    </section>
  )
}
