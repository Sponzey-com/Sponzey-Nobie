import * as React from "react"
import { useEffect, useMemo, useState } from "react"
import { SetupVisualizationCanvas, SetupVisualizationLegend } from "../setup/SetupVisualizationCanvas"
import type { VisualizationScene } from "../../lib/setup-visualization"
import type { OrchestrationSummaryCard } from "../../lib/orchestration-ui"
import type { TopologyEditorGate, TopologyInspectorModel, YeonjangAgentRelation } from "../../lib/setup-visualization-topology"
import { pickUiText, type UiLanguage } from "../../stores/uiLanguage"

type TopologyFilterId = "all" | "teams" | "agents" | "capabilities" | "attention"

const FILTER_ORDER: TopologyFilterId[] = ["all", "teams", "agents", "capabilities", "attention"]

export function OrchestrationTopologyPanel({
  scene,
  summary,
  language,
  selectedNodeId,
  onSelectNode,
  onDismissSelection,
  selectedEdgeId,
  onSelectEdge,
  yeonjangRelations = [],
  inspector,
  editorGate,
}: {
  scene: VisualizationScene
  summary: OrchestrationSummaryCard[]
  language: UiLanguage
  selectedNodeId?: string | null
  onSelectNode?: (nodeId: string) => void
  onDismissSelection?: () => void
  selectedEdgeId?: string | null
  onSelectEdge?: (edgeId: string) => void
  yeonjangRelations?: YeonjangAgentRelation[]
  inspector?: TopologyInspectorModel | null
  editorGate?: TopologyEditorGate | null
}) {
  const [modeCard, agentsCard, membershipCard] = [
    summary.find((card) => card.id === "mode") ?? null,
    summary.find((card) => card.id === "agents") ?? null,
    summary.find((card) => card.id === "membership") ?? null,
  ]
  const [selectedFilter, setSelectedFilter] = useState<TopologyFilterId>(() => inferDefaultFilter(scene))
  const filteredScene = useMemo(() => filterScene(scene, selectedFilter), [scene, selectedFilter])

  useEffect(() => {
    setSelectedFilter(inferDefaultFilter(scene))
  }, [scene])

  return (
    <section className="rounded-[2rem] border border-stone-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">
            {pickUiText(language, "Read-only topology", "Read-only topology")}
          </div>
          <h2 className="mt-2 text-xl font-semibold text-stone-950">{scene.label}</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-stone-600">
            {pickUiText(language, "기존 편집기보다 먼저 구조를 읽을 수 있게 하고, setup draft와는 분리된 projection만 보여줍니다.", "Puts the structure ahead of the editor and keeps the projection separate from the setup draft.")}
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {[modeCard, agentsCard, membershipCard].filter(Boolean).map((card) => (
            <article key={card!.id} className={`rounded-2xl border px-4 py-3 ${summaryToneClass(card!.tone)}`}>
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] opacity-70">{card!.label}</div>
              <div className="mt-2 text-lg font-semibold">{card!.value}</div>
            </article>
          ))}
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        {FILTER_ORDER.map((filterId) => (
          <button
            key={filterId}
            type="button"
            onClick={() => setSelectedFilter(filterId)}
            className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
              selectedFilter === filterId
                ? "border-stone-900 bg-stone-900 text-white"
                : "border-stone-200 bg-white text-stone-700 hover:border-stone-300"
            }`}
          >
            {filterLabel(filterId, language)} {filterCount(scene, filterId)}
          </button>
        ))}
      </div>

      <div className="mt-5 grid gap-4">
        <SetupVisualizationLegend scene={filteredScene} language={language} />
        <SetupVisualizationCanvas
          scene={filteredScene}
          language={language}
          selectedNodeId={selectedNodeId}
          onSelectNode={onSelectNode}
          onDismissSelection={onDismissSelection}
        />
      </div>

      {editorGate && editorGate.status !== "ready" ? (
        <div className={`mt-5 rounded-2xl border px-4 py-3 text-sm leading-6 ${editorGate.status === "disabled" ? "border-red-200 bg-red-50 text-red-900" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
          <div className="font-semibold">{editorGate.title}</div>
          <div className="mt-1">{editorGate.message}</div>
        </div>
      ) : null}

      {yeonjangRelations.length > 0 ? (
        <div className="mt-5 space-y-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-500">
            {pickUiText(language, "Yeonjang 관계선", "Yeonjang relations")}
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" data-orchestration-yeonjang-relations="">
            {yeonjangRelations.map((relation) => (
              <button
                key={relation.edgeId}
                type="button"
                onClick={() => onSelectEdge?.(relation.edgeId)}
                data-orchestration-yeonjang-relation={relation.edgeId}
                className={`rounded-2xl border px-4 py-3 text-left transition ${
                  selectedEdgeId === relation.edgeId
                    ? "border-stone-900 bg-stone-900 text-white"
                    : "border-stone-200 bg-stone-50 text-stone-900 hover:border-stone-300"
                }`}
              >
                <div className="text-sm font-semibold">{relation.agentLabel} - Yeonjang</div>
                <div className="mt-1 text-xs opacity-80">{relation.label}</div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {relation.badges.map((badge) => (
                    <span key={badge} className={`rounded-full px-2 py-1 text-[11px] font-semibold ${selectedEdgeId === relation.edgeId ? "bg-white/15 text-white" : "bg-white text-stone-600 ring-1 ring-stone-200"}`}>
                      {badge}
                    </span>
                  ))}
                </div>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {inspector ? (
        <section className={`mt-5 rounded-[1.5rem] border p-5 ${inspectorToneClass(inspector.tone)}`} data-orchestration-topology-inspector={inspector.id}>
          <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] opacity-70">
                {pickUiText(language, "Permission inspector", "Permission inspector")}
              </div>
              <h3 className="mt-2 text-lg font-semibold">{inspector.title}</h3>
              <p className="mt-2 text-sm leading-6 opacity-85">{inspector.summary}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {inspector.badges.map((badge) => (
                <span key={badge} className="rounded-full bg-white/70 px-3 py-1 text-[11px] font-semibold ring-1 ring-black/5">
                  {badge}
                </span>
              ))}
            </div>
          </div>
          <div className="mt-4 space-y-2 text-sm leading-6">
            {inspector.details.map((detail) => (
              <div key={detail}>{detail}</div>
            ))}
          </div>
        </section>
      ) : null}
    </section>
  )
}

function inferDefaultFilter(scene: VisualizationScene): TopologyFilterId {
  return scene.nodes.some((node) => node.status === "warning" || node.status === "error") ? "attention" : "all"
}

function filterScene(scene: VisualizationScene, filterId: TopologyFilterId): VisualizationScene {
  if (filterId === "all") return scene

  const keepNodeIds = new Set(
    scene.nodes
      .filter((node) => {
        if (node.id === "node:orchestration:coordinator") return true
        if (filterId === "teams") return node.clusterId === "cluster:orchestration:teams" || node.clusterId === "cluster:orchestration:unresolved"
        if (filterId === "agents") return node.clusterId === "cluster:orchestration:agents"
        if (filterId === "capabilities") return node.clusterId === "cluster:orchestration:capabilities" || node.clusterId === "cluster:orchestration:agents"
        return node.status === "warning" || node.status === "error" || node.status === "disabled" || node.clusterId === "cluster:orchestration:unresolved"
      })
      .map((node) => node.id),
  )

  const nodes = scene.nodes.filter((node) => keepNodeIds.has(node.id))
  const edges = scene.edges.filter((edge) => keepNodeIds.has(edge.from) && keepNodeIds.has(edge.to))
  const relatedNodeIds = new Set([...nodes.map((node) => node.id), ...edges.flatMap((edge) => [edge.from, edge.to])])
  const alerts = scene.alerts?.filter((alert) => {
    if (!alert.relatedNodeIds?.length) return filterId === "attention"
    return alert.relatedNodeIds.some((nodeId) => relatedNodeIds.has(nodeId))
  })

  return {
    ...scene,
    nodes,
    edges,
    clusters: scene.clusters
      ?.map((cluster) => ({
        ...cluster,
        nodeIds: cluster.nodeIds.filter((nodeId) => keepNodeIds.has(nodeId)),
      }))
      .filter((cluster) => cluster.nodeIds.length > 0),
    alerts,
  }
}

function filterLabel(filterId: TopologyFilterId, language: UiLanguage): string {
  switch (filterId) {
    case "teams":
      return pickUiText(language, "팀", "Teams")
    case "agents":
      return pickUiText(language, "에이전트", "Agents")
    case "capabilities":
      return pickUiText(language, "Capability", "Capabilities")
    case "attention":
      return pickUiText(language, "주의/오류", "Attention")
    case "all":
    default:
      return pickUiText(language, "전체", "All")
  }
}

function filterCount(scene: VisualizationScene, filterId: TopologyFilterId): number {
  if (filterId === "all") return scene.nodes.length
  return filterScene(scene, filterId).nodes.length
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

function inspectorToneClass(tone: TopologyInspectorModel["tone"]): string {
  switch (tone) {
    case "ready":
      return "border-emerald-200 bg-emerald-50 text-emerald-950"
    case "error":
      return "border-red-200 bg-red-50 text-red-950"
    case "warning":
    default:
      return "border-amber-200 bg-amber-50 text-amber-950"
  }
}
