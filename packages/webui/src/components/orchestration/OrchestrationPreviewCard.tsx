import { Link } from "react-router-dom"
import type { OrchestrationSummaryCard } from "../../lib/orchestration-ui"
import type { VisualizationNode, VisualizationScene } from "../../lib/setup-visualization"
import { pickUiText, type UiLanguage } from "../../stores/uiLanguage"

export function OrchestrationPreviewCard({
  title,
  description,
  summary,
  scene,
  language,
  href,
  actionLabel,
  loading = false,
  error = "",
  yeonjangRuntimeLabel = "",
}: {
  title: string
  description: string
  summary: OrchestrationSummaryCard[]
  scene: VisualizationScene | null
  language: UiLanguage
  href: string
  actionLabel: string
  loading?: boolean
  error?: string
  yeonjangRuntimeLabel?: string
}) {
  const summaryCards = [
    summary.find((card) => card.id === "mode"),
    summary.find((card) => card.id === "agents"),
    summary.find((card) => card.id === "membership"),
  ].filter(Boolean) as OrchestrationSummaryCard[]
  const coordinator = scene?.nodes.find((node) => node.id === "node:orchestration:coordinator") ?? null
  const teamNodes = takePreviewNodes(scene, "cluster:orchestration:teams")
  const agentNodes = takePreviewNodes(scene, "cluster:orchestration:agents")
  const yeonjangHub = scene?.nodes.find((node) => node.id === "node:orchestration:yeonjang_hub") ?? null
  const capabilityNodes = takePreviewNodes(scene, "cluster:orchestration:capabilities", 4).filter((node) => node.id !== yeonjangHub?.id).slice(0, 3)
  const attentionLabels = scene?.alerts?.slice(0, 2).map((item) => item.message) ?? []

  return (
    <section className="rounded-[1.75rem] border border-stone-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-4">
        <div>
          <div className="text-sm font-semibold text-stone-900">{title}</div>
          <p className="mt-2 text-sm leading-6 text-stone-600">{description}</p>
        </div>

        {loading ? (
          <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
            {pickUiText(language, "오케스트레이션 미리보기를 불러오는 중입니다.", "Loading the orchestration preview.")}
          </div>
        ) : null}
        {error ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
        ) : null}

        {summaryCards.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-3">
            {summaryCards.map((card) => (
              <article key={card.id} className={`rounded-2xl border px-4 py-3 ${summaryToneClass(card.tone)}`}>
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] opacity-70">{card.label}</div>
                <div className="mt-2 text-lg font-semibold">{card.value}</div>
              </article>
            ))}
          </div>
        ) : null}

        {scene ? (
          <div className="rounded-[1.5rem] border border-stone-200 bg-stone-50 p-4">
            <div className="grid gap-4 xl:grid-cols-[0.9fr_1fr_0.9fr]">
              <div className="space-y-2">
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-500">{pickUiText(language, "팀", "Teams")}</div>
                {teamNodes.length > 0 ? teamNodes.map((node) => <PreviewPill key={node.id} node={node} />) : (
                  <PreviewEmpty text={pickUiText(language, "아직 팀 없음", "No teams yet")} />
                )}
              </div>

              <div className="space-y-3">
                {coordinator ? (
                  <div className="rounded-[1.25rem] border border-stone-900 bg-stone-900 px-4 py-4 text-white">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-300">Nobie</div>
                    <div className="mt-2 text-lg font-semibold">{coordinator.label}</div>
                    <div className="mt-2 text-xs leading-5 text-stone-300">{coordinator.description}</div>
                  </div>
                ) : null}
                <div className="rounded-2xl border border-dashed border-stone-300 bg-white px-3 py-3 text-xs leading-5 text-stone-500">
                  {pickUiText(language, "이 미리보기는 setup draft와 분리된 read-only topology입니다.", "This preview is a read-only topology separate from the setup draft.")}
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-500">{pickUiText(language, "서브 에이전트", "Sub-agents")}</div>
                {agentNodes.length > 0 ? agentNodes.map((node) => <PreviewPill key={node.id} node={node} />) : (
                  <PreviewEmpty text={pickUiText(language, "아직 agent 없음", "No agents yet")} />
                )}
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {capabilityNodes.map((node) => (
                <PreviewPill key={node.id} node={node} compact />
              ))}
            </div>
            {yeonjangHub ? (
              <div className="mt-4 rounded-2xl border border-stone-200 bg-white px-4 py-3 text-xs leading-5 text-stone-600">
                <div className="font-semibold text-stone-800">{pickUiText(language, "Yeonjang shared capability", "Yeonjang shared capability")}</div>
                <div className="mt-1">
                  {pickUiText(language, "팀 소속만으로는 권한이 생기지 않으며, 승인된 agent만 shared hub를 사용할 수 있습니다.", "Team membership alone does not grant permission. Only approved agents can use the shared hub.")}
                </div>
                <div className="mt-2 font-semibold text-stone-700">{yeonjangRuntimeLabel || yeonjangHub.badges[0]}</div>
              </div>
            ) : null}
          </div>
        ) : null}

        {attentionLabels.length > 0 ? (
          <div className="space-y-2">
            {attentionLabels.map((message) => (
              <div key={message} className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-900">
                {message}
              </div>
            ))}
          </div>
        ) : null}

        <Link to={href} className="inline-flex items-center justify-center rounded-2xl border border-stone-200 px-4 py-3 text-sm font-semibold text-stone-700 transition hover:border-stone-300 hover:bg-stone-50">
          {actionLabel}
        </Link>
      </div>
    </section>
  )
}

function takePreviewNodes(scene: VisualizationScene | null, clusterId: string, limit = 2): VisualizationNode[] {
  if (!scene) return []
  return scene.nodes
    .filter((node) => node.clusterId === clusterId)
    .slice(0, limit)
}

function PreviewPill({ node, compact = false }: { node: VisualizationNode; compact?: boolean }) {
  return (
    <div className={`rounded-2xl border border-stone-200 bg-white px-3 py-2 ${compact ? "text-xs" : "text-sm"}`}>
      <div className="flex items-center gap-2">
        <span className={`h-2.5 w-2.5 rounded-full ${statusDotClass(node.status)}`} />
        <span className="font-semibold text-stone-800">{node.label}</span>
      </div>
      {node.badges[0] ? <div className="mt-1 text-[11px] leading-5 text-stone-500">{node.badges[0]}</div> : null}
    </div>
  )
}

function PreviewEmpty({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-stone-300 bg-white/70 px-3 py-2 text-xs text-stone-500">
      {text}
    </div>
  )
}

function summaryToneClass(tone: OrchestrationSummaryCard["tone"]): string {
  switch (tone) {
    case "ready":
      return "border-emerald-200 bg-emerald-50 text-emerald-950"
    case "warning":
      return "border-amber-200 bg-amber-50 text-amber-950"
    case "danger":
      return "border-red-200 bg-red-50 text-red-950"
    case "neutral":
    default:
      return "border-stone-200 bg-white text-stone-950"
  }
}

function statusDotClass(status: VisualizationNode["status"]): string {
  switch (status) {
    case "ready":
      return "bg-emerald-500"
    case "warning":
    case "required":
      return "bg-amber-500"
    case "error":
      return "bg-red-500"
    case "disabled":
      return "bg-stone-400"
    case "draft":
      return "bg-sky-500"
    case "planned":
    default:
      return "bg-slate-400"
  }
}
