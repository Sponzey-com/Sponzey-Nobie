import {
  Background,
  type Connection,
  Controls,
  type Edge,
  MiniMap,
  type Node,
  type NodeProps,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import { useCallback, useEffect, useMemo, useState } from "react"
import { api } from "../api/client"
import type {
  AgentTopologyAgentInspector,
  AgentTopologyEdge,
  AgentTopologyProjection,
  AgentTopologyTeamBuilderCandidate,
  AgentTopologyTeamInspector,
  AgentTopologyTeamMembershipDraft,
} from "../contracts/topology"
import {
  type TopologyFlowEdgeData,
  type TopologyFlowNodeData,
  type TopologySelection,
  buildTeamBuilderDraft,
  buildTeamMembersPayload,
  buildTopologyFlowElements,
  buildTopologySummaryCards,
  selectionFromTopologyNode,
  topologyEdgeVisualStyle,
  topologyNodeTone,
  updateTeamBuilderDraft,
} from "../lib/topology"
import { useUiI18n } from "../lib/ui-i18n"

function toneClassName(tone: string): string {
  switch (tone) {
    case "rose":
      return "border-rose-200 bg-rose-50 text-rose-950"
    case "amber":
      return "border-amber-200 bg-amber-50 text-amber-950"
    case "sky":
      return "border-sky-200 bg-sky-50 text-sky-950"
    case "blue":
      return "border-blue-200 bg-blue-50 text-blue-950"
    case "teal":
      return "border-teal-200 bg-teal-50 text-teal-950"
    case "emerald":
      return "border-emerald-200 bg-emerald-50 text-emerald-950"
    default:
      return "border-stone-300 bg-white text-stone-950"
  }
}

function cardToneClassName(tone: string): string {
  switch (tone) {
    case "red":
      return "border-red-100 bg-red-50 text-red-800"
    case "amber":
      return "border-amber-100 bg-amber-50 text-amber-800"
    case "emerald":
      return "border-emerald-100 bg-emerald-50 text-emerald-800"
    case "sky":
      return "border-sky-100 bg-sky-50 text-sky-800"
    default:
      return "border-stone-200 bg-white text-stone-700"
  }
}

function TopologyNodeView(props: NodeProps) {
  const data = props.data as TopologyFlowNodeData
  const tone = topologyNodeTone(data.kind, data.status)
  return (
    <div
      className={`min-w-40 max-w-64 rounded-lg border px-3 py-2 shadow-sm ${toneClassName(tone)} ${props.selected ? "ring-2 ring-stone-900" : ""}`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 truncate text-sm font-semibold">{data.label}</div>
        <span className="shrink-0 rounded-full bg-white/70 px-2 py-0.5 text-[10px] font-semibold uppercase text-stone-600">
          {data.kind.replace("_", " ")}
        </span>
      </div>
      <div className="mt-1 truncate text-[11px] text-stone-600">{data.entityId}</div>
      <div className="mt-2 flex flex-wrap gap-1">
        {data.badges.slice(0, 4).map((badge) => (
          <span
            key={badge}
            className="rounded-full bg-white/70 px-2 py-0.5 text-[10px] text-stone-700"
          >
            {badge}
          </span>
        ))}
        {data.diagnostics.length > 0 ? (
          <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-700">
            {data.diagnostics.length}
          </span>
        ) : null}
      </div>
    </div>
  )
}

const nodeTypes = { topologyNode: TopologyNodeView }

function listText(values: string[], empty = "-"): string {
  return values.length > 0 ? values.join(", ") : empty
}

function InspectorField({ label, value }: { label: string; value: string | number | boolean }) {
  return (
    <div className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2">
      <div className="text-[11px] font-semibold uppercase text-stone-400">{label}</div>
      <div className="mt-1 break-words text-sm text-stone-800">{String(value)}</div>
    </div>
  )
}

function AgentInspector({
  agent,
  text,
}: {
  agent: AgentTopologyAgentInspector
  text: (ko: string, en: string) => string
}) {
  return (
    <div className="space-y-4">
      <div>
        <div className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-400">
          {text("Agent Inspector", "Agent Inspector")}
        </div>
        <h2 className="mt-2 break-words text-xl font-semibold text-stone-950">
          {agent.nickname ?? agent.displayName}
        </h2>
        <div className="mt-2 text-xs text-stone-500">{agent.agentId}</div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <InspectorField label={text("상태", "Status")} value={agent.status} />
        <InspectorField label={text("역할", "Role")} value={agent.role} />
        <InspectorField label={text("전문성", "Specialty")} value={listText(agent.specialtyTags)} />
        <InspectorField label={text("팀", "Teams")} value={listText(agent.teamIds)} />
      </div>
      <section className="rounded-lg border border-stone-200 bg-white p-4">
        <div className="text-sm font-semibold text-stone-900">{text("Model", "Model")}</div>
        <div className="mt-3 grid gap-2 text-sm text-stone-700">
          <div>
            {agent.model.providerId ?? "-"} / {agent.model.modelId ?? "-"}
          </div>
          <div>
            {text("가용성", "Availability")}: {agent.model.availability ?? "-"}
          </div>
          <div>
            {text("Fallback", "Fallback")}: {agent.model.fallbackModelId ?? "-"}
          </div>
        </div>
      </section>
      <section className="rounded-lg border border-stone-200 bg-white p-4">
        <div className="text-sm font-semibold text-stone-900">Skill / MCP / Tool</div>
        <div className="mt-3 grid gap-2 text-xs leading-5 text-stone-600">
          <div>
            {text("Skills", "Skills")}: {listText(agent.skillMcp.enabledSkillIds)}
          </div>
          <div>
            {text("MCP", "MCP")}: {listText(agent.skillMcp.enabledMcpServerIds)}
          </div>
          <div>
            {text("Tools", "Tools")}: {listText(agent.tools.enabledToolNames)}
          </div>
          <div>
            {text("Secret Scope", "Secret Scope")}: {agent.skillMcp.secretScope}
          </div>
        </div>
      </section>
      <section className="rounded-lg border border-stone-200 bg-white p-4">
        <div className="text-sm font-semibold text-stone-900">{text("Memory", "Memory")}</div>
        <div className="mt-3 grid gap-2 text-xs leading-5 text-stone-600">
          <div>
            {text("Owner", "Owner")}: {agent.memory.owner}
          </div>
          <div>
            {text("Visibility", "Visibility")}: {agent.memory.visibility}
          </div>
          <div>
            {text("Read Scopes", "Read Scopes")}: {listText(agent.memory.readScopes)}
          </div>
          <div>
            {text("Write Scope", "Write Scope")}: {agent.memory.writeScope}
          </div>
          <div>
            {text("Retention", "Retention")}: {agent.memory.retentionPolicy}
          </div>
        </div>
      </section>
      <section className="rounded-lg border border-stone-200 bg-white p-4">
        <div className="text-sm font-semibold text-stone-900">
          {text("Delegation", "Delegation")}
        </div>
        <div className="mt-3 grid gap-2 text-xs leading-5 text-stone-600">
          <div>
            {text("활성", "Enabled")}: {String(agent.delegation.enabled)}
          </div>
          <div>
            {text("동시 실행", "Parallel")}: {agent.delegation.maxParallelSessions}
          </div>
          <div>
            {text("재시도", "Retry")}: {agent.delegation.retryBudget}
          </div>
        </div>
      </section>
    </div>
  )
}

function CoverageList({
  title,
  required,
  covered,
  missing,
}: {
  title: string
  required: string[]
  covered: string[]
  missing: string[]
}) {
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-4">
      <div className="text-sm font-semibold text-stone-900">{title}</div>
      <div className="mt-3 grid gap-2 text-xs text-stone-600">
        <div>required: {listText(required)}</div>
        <div>covered: {listText(covered)}</div>
        <div className={missing.length > 0 ? "text-amber-700" : "text-emerald-700"}>
          missing: {listText(missing)}
        </div>
      </div>
    </div>
  )
}

function TeamBuilder({
  team,
  reload,
  text,
}: {
  team: AgentTopologyTeamInspector
  reload: () => Promise<void>
  text: (ko: string, en: string) => string
}) {
  const [draft, setDraft] = useState<AgentTopologyTeamMembershipDraft[]>(() =>
    buildTeamBuilderDraft(team),
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    setDraft(buildTeamBuilderDraft(team))
    setError("")
  }, [team])

  function activeFor(candidate: AgentTopologyTeamBuilderCandidate): boolean {
    return draft.find((item) => item.agentId === candidate.agentId)?.active ?? false
  }

  function toggleCandidate(candidate: AgentTopologyTeamBuilderCandidate, active: boolean) {
    const result = updateTeamBuilderDraft(draft, candidate, active)
    if (result.blockedReason) {
      setError(`${candidate.label}: ${result.blockedReason}`)
      return
    }
    setError("")
    setDraft(result.draft)
  }

  async function save() {
    setSaving(true)
    setError("")
    try {
      for (const item of draft.filter((candidate) => candidate.active)) {
        const validation = await api.validateTopologyEdge({
          kind: "team_membership",
          teamId: team.teamId,
          agentId: item.agentId,
          memberStatus: "active",
        })
        if (!validation.valid) {
          throw new Error(validation.diagnostics[0]?.message ?? "invalid team membership")
        }
      }
      await api.updateTeamMembers(team.teamId, buildTeamMembersPayload(team, draft))
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      await reload()
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="rounded-lg border border-stone-200 bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-semibold text-stone-900">Team Builder</div>
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="rounded-lg bg-stone-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
        >
          {saving ? text("저장 중", "Saving") : text("저장", "Save")}
        </button>
      </div>
      {error ? (
        <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
      ) : null}
      <div className="mt-3 max-h-80 space-y-2 overflow-auto pr-1">
        {team.builder.candidates.map((candidate) => {
          const active = activeFor(candidate)
          return (
            <label
              key={candidate.agentId}
              className={`flex items-start justify-between gap-3 rounded-lg border px-3 py-2 text-xs ${
                candidate.canActivate
                  ? "border-stone-200 bg-stone-50"
                  : "border-amber-200 bg-amber-50"
              }`}
            >
              <span className="min-w-0">
                <span className="block break-words font-semibold text-stone-900">
                  {candidate.label}
                </span>
                <span className="mt-1 block break-all text-stone-500">{candidate.agentId}</span>
                <span className="mt-1 block text-stone-500">
                  {candidate.directChild ? "direct child" : "reference"} ·{" "}
                  {listText(candidate.reasonCodes)}
                </span>
              </span>
              <input
                type="checkbox"
                checked={active}
                disabled={!candidate.canActivate}
                onChange={(event) => toggleCandidate(candidate, event.currentTarget.checked)}
                className="mt-1 h-4 w-4"
              />
            </label>
          )
        })}
      </div>
    </section>
  )
}

function TeamInspector({
  team,
  reload,
  text,
}: {
  team: AgentTopologyTeamInspector
  reload: () => Promise<void>
  text: (ko: string, en: string) => string
}) {
  return (
    <div className="space-y-4">
      <div>
        <div className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-400">
          {text("Team Inspector", "Team Inspector")}
        </div>
        <h2 className="mt-2 break-words text-xl font-semibold text-stone-950">
          {team.nickname ?? team.displayName}
        </h2>
        <div className="mt-2 text-xs text-stone-500">{team.teamId}</div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <InspectorField label={text("상태", "Status")} value={team.status} />
        <InspectorField label={text("Owner", "Owner")} value={team.ownerAgentId} />
        <InspectorField label={text("Lead", "Lead")} value={team.leadAgentId ?? "-"} />
        <InspectorField label={text("Health", "Health")} value={team.health.status} />
      </div>
      <section className="rounded-lg border border-stone-200 bg-white p-4">
        <div className="text-sm font-semibold text-stone-900">{text("Members", "Members")}</div>
        <div className="mt-3 space-y-2">
          {team.members.map((member) => (
            <div
              key={member.agentId}
              className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-xs text-stone-600"
            >
              <div className="font-semibold text-stone-900">{member.label}</div>
              <div className="mt-1 break-all">{member.agentId}</div>
              <div className="mt-1">
                {member.primaryRole} · {member.executionState} ·{" "}
                {member.directChild ? "direct" : "reference"}
              </div>
              {member.reasonCodes.length > 0 ? (
                <div className="mt-1 text-amber-700">{listText(member.reasonCodes)}</div>
              ) : null}
            </div>
          ))}
        </div>
      </section>
      <CoverageList
        title={text("Role Coverage", "Role Coverage")}
        required={team.roleCoverage.required}
        covered={team.roleCoverage.covered}
        missing={team.roleCoverage.missing}
      />
      <CoverageList
        title={text("Capability Coverage", "Capability Coverage")}
        required={team.capabilityCoverage.required}
        covered={team.capabilityCoverage.covered}
        missing={team.capabilityCoverage.missing}
      />
      <TeamBuilder team={team} reload={reload} text={text} />
    </div>
  )
}

function InspectorPanel({
  projection,
  selection,
  reload,
  text,
}: {
  projection: AgentTopologyProjection | null
  selection: TopologySelection | null
  reload: () => Promise<void>
  text: (ko: string, en: string) => string
}) {
  if (!projection || !selection) {
    return (
      <div className="rounded-lg border border-stone-200 bg-white p-5 text-sm text-stone-500">
        {text("노드를 선택하세요.", "Select a node.")}
      </div>
    )
  }
  if (selection.kind === "team") {
    const team = projection.inspectors.teams[selection.entityId]
    return team ? <TeamInspector team={team} reload={reload} text={text} /> : null
  }
  if (selection.kind === "team_role" || selection.kind === "team_lead") {
    const team = selection.teamId ? projection.inspectors.teams[selection.teamId] : undefined
    return team ? <TeamInspector team={team} reload={reload} text={text} /> : null
  }
  const agent = projection.inspectors.agents[selection.entityId]
  return agent ? <AgentInspector agent={agent} text={text} /> : null
}

function optimisticHierarchyEdge(connection: Connection): Edge<TopologyFlowEdgeData> {
  const raw: AgentTopologyEdge = {
    id: `pending:${connection.source}->${connection.target}:${Date.now()}`,
    kind: "parent_child",
    source: connection.source ?? "",
    target: connection.target ?? "",
    valid: true,
    style: "hierarchy",
    data: {},
    diagnostics: [],
  }
  return {
    id: raw.id,
    source: raw.source,
    target: raw.target,
    type: "smoothstep",
    animated: true,
    style: topologyEdgeVisualStyle("hierarchy"),
    data: { kind: "parent_child", style: "hierarchy", valid: true, diagnostics: [], raw },
  }
}

function invalidPreviewEdge(
  connection: Connection,
  diagnostics: string[],
): Edge<TopologyFlowEdgeData> {
  const raw: AgentTopologyEdge = {
    id: `invalid:${connection.source}->${connection.target}:${Date.now()}`,
    kind: "parent_child",
    source: connection.source ?? "",
    target: connection.target ?? "",
    valid: false,
    style: "invalid",
    data: {},
    diagnostics: diagnostics.map((reasonCode) => ({
      reasonCode,
      severity: "blocked",
      message: reasonCode,
    })),
  }
  return {
    id: raw.id,
    source: raw.source,
    target: raw.target,
    type: "smoothstep",
    animated: true,
    style: topologyEdgeVisualStyle("invalid"),
    data: { kind: "parent_child", style: "invalid", valid: false, diagnostics, raw },
  }
}

function TopologyPageInner() {
  const { text } = useUiI18n()
  const [projection, setProjection] = useState<AgentTopologyProjection | null>(null)
  const [selection, setSelection] = useState<TopologySelection | null>(null)
  const [loadError, setLoadError] = useState("")
  const [actionError, setActionError] = useState("")
  const [savingLayout, setSavingLayout] = useState(false)
  const [viewport, setViewport] = useState<{ x: number; y: number; zoom: number } | undefined>()
  const elements = useMemo(() => buildTopologyFlowElements(projection), [projection])
  const [nodes, setNodes, onNodesChange] = useNodesState<TopologyFlowNodeData>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<TopologyFlowEdgeData>([])

  const load = useCallback(async () => {
    try {
      const response = await api.agentTopology()
      setProjection(response)
      setLoadError("")
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    setNodes(elements.nodes)
    setEdges(elements.edges)
  }, [elements, setEdges, setNodes])

  const onConnect = useCallback(
    async (connection: Connection) => {
      setActionError("")
      const source = nodes.find((node) => node.id === connection.source)
      const target = nodes.find((node) => node.id === connection.target)
      const sourceAgentId =
        source?.data.kind === "nobie" || source?.data.kind === "sub_agent"
          ? source.data.entityId
          : ""
      const targetAgentId = target?.data.kind === "sub_agent" ? target.data.entityId : ""
      if (!sourceAgentId || !targetAgentId) {
        setActionError(
          text(
            "Hierarchy edge는 agent 노드 사이에서만 만들 수 있습니다.",
            "Hierarchy edges must connect agent nodes.",
          ),
        )
        setEdges((current) =>
          addEdge(invalidPreviewEdge(connection, ["invalid_agent_edge"]), current),
        )
        return
      }
      const validation = await api.validateTopologyEdge({
        kind: "parent_child",
        relationship: { parentAgentId: sourceAgentId, childAgentId: targetAgentId },
      })
      if (!validation.valid) {
        const reasonCodes = validation.diagnostics.map((diagnostic) => diagnostic.reasonCode)
        setActionError(
          validation.diagnostics[0]?.message ??
            text("저장할 수 없는 edge입니다.", "Edge cannot be saved."),
        )
        setEdges((current) => addEdge(invalidPreviewEdge(connection, reasonCodes), current))
        return
      }
      setEdges((current) => addEdge(optimisticHierarchyEdge(connection), current))
      try {
        await api.createAgentRelationship(
          validation.relationship ?? { parentAgentId: sourceAgentId, childAgentId: targetAgentId },
        )
        await load()
      } catch (err) {
        setActionError(err instanceof Error ? err.message : String(err))
        await load()
      }
    },
    [load, nodes, setEdges, text],
  )

  async function saveLayout() {
    if (!projection) return
    setSavingLayout(true)
    setActionError("")
    try {
      await api.saveAgentTopologyLayout({
        schemaVersion: projection.layout.schemaVersion,
        layout: "react-flow",
        nodes: Object.fromEntries(
          nodes.map((node) => [
            node.id,
            {
              x: node.position.x,
              y: node.position.y,
              ...(projection.layout.nodes[node.id]?.collapsed === undefined
                ? {}
                : { collapsed: projection.layout.nodes[node.id]?.collapsed }),
            },
          ]),
        ),
        ...(viewport
          ? { viewport }
          : projection.layout.viewport
            ? { viewport: projection.layout.viewport }
            : {}),
      })
      await load()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
    } finally {
      setSavingLayout(false)
    }
  }

  const cards = buildTopologySummaryCards(projection, text)

  return (
    <div className="flex h-full flex-col bg-stone-100 text-stone-950">
      <header className="shrink-0 border-b border-stone-200 bg-white px-6 py-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">
              {text("Topology", "Topology")}
            </div>
            <h1 className="mt-2 text-2xl font-semibold">Agent Topology</h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void load()}
              className="rounded-lg border border-stone-200 bg-white px-4 py-2 text-sm font-semibold text-stone-700"
            >
              {text("새로고침", "Refresh")}
            </button>
            <button
              type="button"
              onClick={() => void saveLayout()}
              disabled={savingLayout}
              className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {savingLayout ? text("저장 중", "Saving") : text("Layout 저장", "Save layout")}
            </button>
          </div>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {cards.map((card) => (
            <div
              key={card.id}
              className={`rounded-lg border px-3 py-2 ${cardToneClassName(card.tone)}`}
            >
              <div className="text-[11px] font-semibold uppercase opacity-75">{card.label}</div>
              <div className="mt-1 text-lg font-semibold">{card.value}</div>
            </div>
          ))}
        </div>
        {loadError ? (
          <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {loadError}
          </div>
        ) : null}
        {actionError ? (
          <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {actionError}
          </div>
        ) : null}
      </header>

      <div className="grid min-h-0 flex-1 gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_400px]">
        <section className="min-h-[560px] overflow-hidden rounded-lg border border-stone-200 bg-white">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={(connection) => void onConnect(connection)}
            onNodeClick={(_, node: Node<TopologyFlowNodeData>) =>
              setSelection(selectionFromTopologyNode(node))
            }
            onMoveEnd={(_, nextViewport) => setViewport(nextViewport)}
            fitView
            minZoom={0.25}
            maxZoom={1.6}
          >
            <Background color="#d6d3d1" gap={22} />
            <Controls />
            <MiniMap
              pannable
              zoomable
              nodeColor={(node) => {
                const data = node.data as TopologyFlowNodeData
                const tone = topologyNodeTone(data.kind, data.status)
                if (tone === "rose") return "#fecdd3"
                if (tone === "amber") return "#fde68a"
                if (tone === "sky") return "#bae6fd"
                if (tone === "emerald") return "#bbf7d0"
                return "#e7e5e4"
              }}
            />
          </ReactFlow>
        </section>
        <aside className="min-h-0 overflow-y-auto rounded-lg border border-stone-200 bg-white p-5">
          <InspectorPanel projection={projection} selection={selection} reload={load} text={text} />
        </aside>
      </div>
    </div>
  )
}

export function TopologyPage() {
  return (
    <ReactFlowProvider>
      <TopologyPageInner />
    </ReactFlowProvider>
  )
}
