import {
  Background,
  type Connection,
  Controls,
  type Edge,
  type EdgeChange,
  Handle,
  MiniMap,
  type Node,
  type NodeChange,
  type NodeProps,
  Position,
  ReactFlow,
  ReactFlowProvider,
  applyEdgeChanges,
  applyNodeChanges,
  useEdgesState,
  useNodesState,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import { type MouseEvent as ReactMouseEvent, useCallback, useEffect, useMemo, useState } from "react"
import { api } from "../api/client"
import type {
  AgentTopologyAgentInspector,
  AgentTopologyEdge,
  AgentTopologyProjection,
  AgentTopologyTeamInspector,
} from "../contracts/topology"
import {
  type TopologyAgentComposition,
  type TopologyFlowEdgeData,
  type TopologyFlowNodeData,
  type TopologySelection,
  type TopologyTeamCompositionSummary,
  buildTeamBuilderDraft,
  buildTeamLeadershipDraft,
  buildTeamMembershipDraftForAgent,
  buildTopologyAgentCreatePayload,
  buildTopologyAgentComposition,
  buildTopologyAgentTeamAssignments,
  buildTeamMembersPayload,
  buildTopologyTeamCreatePayload,
  buildTopologyFlowElements,
  buildTopologySummaryCards,
  buildTopologyTeamCompositionSummary,
  buildTopologyWorkingAgentIds,
  canArchiveTopologySelection,
  mergeTopologyFlowNodesWithCurrentPositions,
  resolveTopologyConnectionIntent,
  resolveTopologyNodeDragDropIntent,
  selectionFromTopologyNode,
  topologyNodeTone,
} from "../lib/topology"
import { useRunsStore } from "../stores/runs"
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
  const workingClassName = data.working ? "topology-working-node" : ""
  if (data.kind === "team" && data.group) {
    return (
      <div
        className={`relative h-full w-full rounded-lg border-2 border-dashed px-4 py-3 shadow-sm ${toneClassName(tone)} ${workingClassName} ${props.selected ? "ring-2 ring-sky-700" : ""}`}
      >
        <Handle
          type="target"
          position={Position.Top}
          className="!h-3 !w-3 !border-2 !border-white !bg-sky-700"
          title="Team lead input"
        />
        <Handle
          type="source"
          position={Position.Bottom}
          className="!h-3 !w-3 !border-2 !border-white !bg-teal-700"
          title="Team membership output"
        />
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 truncate text-sm font-semibold">{data.label}</div>
          <span className="shrink-0 rounded-full bg-white/80 px-2 py-0.5 text-[10px] font-semibold uppercase text-sky-700">
            Team
          </span>
        </div>
        <div className="mt-1 text-[11px] text-sky-700">
          {typeof data.groupMemberCount === "number"
            ? `${data.groupMemberCount} members`
            : data.entityId}
        </div>
      </div>
    )
  }
  const groupedInsideTeam = Boolean(data.teamGroupId)
  const showTopHandle = !groupedInsideTeam && (data.kind === "sub_agent" || data.kind === "team")
  const showBottomHandle =
    !groupedInsideTeam && (data.kind === "nobie" || data.kind === "sub_agent" || data.kind === "team")
  return (
    <div
      className={`relative min-w-40 max-w-64 rounded-lg border px-3 py-2 shadow-sm ${toneClassName(tone)} ${workingClassName} ${props.selected ? "ring-2 ring-stone-900" : ""}`}
    >
      {showTopHandle ? (
        <Handle
          type="target"
          position={Position.Top}
          className={
            data.kind === "team"
              ? "!h-3 !w-3 !border-2 !border-white !bg-sky-700"
              : "!h-3 !w-3 !border-2 !border-white !bg-stone-700"
          }
          title={data.kind === "team" ? "Team input" : "Parent input"}
        />
      ) : null}
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 truncate text-sm font-semibold">{data.label}</div>
        <span className="shrink-0 rounded-full bg-white/70 px-2 py-0.5 text-[10px] font-semibold uppercase text-stone-600">
          {data.kind.replace("_", " ")}
        </span>
      </div>
      {data.kind === "team" ? (
        <div className="mt-1 truncate text-[11px] text-stone-600">{data.entityId}</div>
      ) : null}
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
      {showBottomHandle ? (
        <Handle
          type="source"
          position={Position.Bottom}
          className={
            data.kind === "team"
              ? "!h-3 !w-3 !border-2 !border-white !bg-teal-700"
              : "!h-3 !w-3 !border-2 !border-white !bg-stone-900"
          }
          title={data.kind === "team" ? "Team member output" : "Child output"}
        />
      ) : null}
    </div>
  )
}

const nodeTypes = { topologyNode: TopologyNodeView }
const AGENT_PROFILE_STATUS_OPTIONS = ["enabled", "disabled", "degraded"] as const

interface PendingTopologyNodeDeletion {
  nodeId: string
  kind: "sub_agent" | "team"
  entityId: string
  label: string
}

type PendingTopologyEdgeDeletion =
  | {
      edgeId: string
      kind: "parent_child"
      label: string
    }
  | {
      edgeId: string
      kind: "team_membership"
      teamId: string
      agentId: string
      label: string
    }

function listText(values: string[], empty = "-"): string {
  return values.length > 0 ? values.join(", ") : empty
}

function uniqueValues(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))]
}

function splitTopologyListDraft(value: string): string[] {
  return uniqueValues(value.split(/[,\n]/u).map((item) => item.trim()))
}

function applyTopologyNodeChanges(
  changes: Array<NodeChange<Node<TopologyFlowNodeData>>>,
  current: Array<Node<TopologyFlowNodeData>>,
): Array<Node<TopologyFlowNodeData>> {
  const currentById = new Map(current.map((node) => [node.id, node]))
  const movedNodeIds = new Set<string>()
  const teamMoves = new Map<string, { x: number; y: number }>()
  for (const change of changes) {
    if (change.type !== "position" || !change.position) continue
    movedNodeIds.add(change.id)
    const before = currentById.get(change.id)
    if (!before || before.data.kind !== "team") continue
    const move = {
      x: change.position.x - before.position.x,
      y: change.position.y - before.position.y,
    }
    if (move.x === 0 && move.y === 0) continue
    teamMoves.set(before.data.entityId, move)
  }

  const next = applyNodeChanges(changes, current)
  if (teamMoves.size === 0) return next

  return next.map((node) => {
    if (movedNodeIds.has(node.id) || !node.data.teamGroupId) return node
    const move = teamMoves.get(node.data.teamGroupId)
    if (!move) return node
    return {
      ...node,
      position: {
        x: node.position.x + move.x,
        y: node.position.y + move.y,
      },
    }
  })
}

function InspectorField({ label, value }: { label: string; value: string | number | boolean }) {
  return (
    <div className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2">
      <div className="text-[11px] font-semibold uppercase text-stone-400">{label}</div>
      <div className="mt-1 break-words text-sm text-stone-800">{String(value)}</div>
    </div>
  )
}

function CompositionItemList({
  title,
  items,
  empty,
}: {
  title: string
  items: Array<{ id: string; label: string; status?: string }>
  empty: string
}) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase text-stone-400">{title}</div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {items.length > 0 ? (
          items.map((item) => (
            <span
              key={`${title}:${item.id}`}
              className="max-w-full rounded-full border border-stone-200 bg-stone-50 px-2.5 py-1 text-[11px] text-stone-700"
              title={item.id}
            >
              <span className="font-semibold text-stone-900">{item.label}</span>
              {item.status ? <span className="ml-1 text-stone-500">{item.status}</span> : null}
            </span>
          ))
        ) : (
          <span className="text-xs text-stone-400">{empty}</span>
        )}
      </div>
    </div>
  )
}

function AgentCompositionPanel({
  composition,
  parentEmpty,
  text,
}: {
  composition: TopologyAgentComposition
  parentEmpty: string
  text: (ko: string, en: string) => string
}) {
  return (
    <section className="rounded-lg border border-stone-200 bg-white p-4">
      <div className="text-sm font-semibold text-stone-900">
        {text("Topology 구성", "Topology Composition")}
      </div>
      <div className="mt-3 grid gap-3">
        <CompositionItemList
          title={text("Parent", "Parent")}
          items={composition.parent ? [composition.parent] : []}
          empty={parentEmpty}
        />
        <CompositionItemList
          title={text("Direct sub-agents", "Direct sub-agents")}
          items={composition.children}
          empty={text("없음", "None")}
        />
        <CompositionItemList
          title={text("Owned teams", "Owned teams")}
          items={composition.ownedTeams}
          empty={text("없음", "None")}
        />
        <CompositionItemList
          title={text("Team memberships", "Team memberships")}
          items={[...composition.activeTeams, ...composition.referenceTeams]}
          empty={text("없음", "None")}
        />
      </div>
    </section>
  )
}

function TeamCompositionPanel({
  summary,
  text,
}: {
  summary: TopologyTeamCompositionSummary
  text: (ko: string, en: string) => string
}) {
  return (
    <section className="rounded-lg border border-stone-200 bg-white p-4">
      <div className="text-sm font-semibold text-stone-900">
        {text("구성 기준", "Composition Basis")}
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <InspectorField label={text("Owner", "Owner")} value={summary.owner.label} />
        <InspectorField
          label={text("실행 가능", "Execution candidate")}
          value={summary.executionCandidate}
        />
        <InspectorField
          label={text("Direct children", "Direct children")}
          value={summary.directChildCount}
        />
        <InspectorField label={text("후보", "Candidates")} value={summary.candidateCount} />
        <InspectorField
          label={text("Active members", "Active members")}
          value={summary.activeMemberCount}
        />
        <InspectorField
          label={text("Reference members", "Reference members")}
          value={summary.referenceMemberCount}
        />
      </div>
      {summary.blockedCandidateCount > 0 ? (
        <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {text("활성화 불가 후보", "Blocked candidates")}: {summary.blockedCandidateCount}
        </div>
      ) : null}
    </section>
  )
}

function SimpleTeamEditor({
  team,
  reload,
  deleting,
  deleteTeam,
  text,
}: {
  team: AgentTopologyTeamInspector
  reload: () => Promise<void>
  deleting: boolean
  deleteTeam: (teamId: string) => Promise<void>
  text: (ko: string, en: string) => string
}) {
  const candidates = useMemo(
    () => team.builder.candidates.filter((candidate) => candidate.canActivate),
    [team],
  )
  const [memberAgentIds, setMemberAgentIds] = useState<string[]>(() =>
    team.activeMemberAgentIds.filter((agentId) =>
      candidates.some((candidate) => candidate.agentId === agentId),
    ),
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    setMemberAgentIds(
      team.activeMemberAgentIds.filter((agentId) =>
        candidates.some((candidate) => candidate.agentId === agentId),
      ),
    )
    setError("")
  }, [candidates, team.activeMemberAgentIds])

  function toggleMember(agentId: string, active: boolean) {
    setMemberAgentIds((current) =>
      active ? uniqueValues([agentId, ...current]) : current.filter((memberAgentId) => memberAgentId !== agentId),
    )
  }

  async function save() {
    if (memberAgentIds.length === 0) {
      setError(text("팀원이 필요합니다.", "Team members are required."))
      return
    }
    const activeMembers = uniqueValues(memberAgentIds)
    const result = buildTeamLeadershipDraft(team, team.ownerAgentId, activeMembers)
    if (result.blockedReason) {
      setError(result.blockedReason)
      return
    }
    setSaving(true)
    setError("")
    try {
      const membersPayload = buildTeamMembersPayload(team, result.draft)
      await api.updateTopologyTeam(team.teamId, {
        leadAgentId: team.ownerAgentId,
        requiredTeamRoles: ["member"],
        ...membersPayload,
      })
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-lg border border-stone-200 bg-stone-50 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-stone-900">
            {team.nickname ?? team.displayName}
          </div>
          <div className="mt-1 text-xs text-stone-500">{team.teamId}</div>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={() => void deleteTeam(team.teamId)}
            disabled={deleting}
            className="rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-700 disabled:opacity-50"
          >
            {deleting ? text("삭제 중", "Deleting") : text("팀 삭제", "Delete")}
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || candidates.length === 0}
            className="rounded-lg bg-stone-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
          >
            {saving ? text("저장 중", "Saving") : text("저장", "Save")}
          </button>
        </div>
      </div>
      {error ? (
        <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
      ) : null}
      {candidates.length > 0 ? (
        <div className="mt-3 grid gap-3">
          <div className="rounded-lg border border-stone-200 bg-white px-3 py-2 text-xs">
            <div className="font-semibold text-stone-600">
            {text("팀장", "Team lead")}
            </div>
            <div className="mt-1 break-all font-semibold text-stone-900">{team.ownerAgentId}</div>
          </div>
          <div>
            <div className="text-xs font-semibold text-stone-600">{text("팀원", "Members")}</div>
            <div className="mt-2 grid gap-1">
              {candidates.map((candidate) => {
                const checked = memberAgentIds.includes(candidate.agentId)
                return (
                  <label
                    key={candidate.agentId}
                    className="flex items-center justify-between gap-3 rounded-lg border border-stone-200 bg-white px-3 py-2 text-xs"
                  >
                      <span>
                        <span className="font-semibold text-stone-900">{candidate.label}</span>
                      <span className="ml-2 text-stone-500">member</span>
                      </span>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(event) =>
                          toggleMember(candidate.agentId, event.currentTarget.checked)
                        }
                      className="h-4 w-4"
                    />
                  </label>
                )
              })}
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {text(
            "직접 연결된 하위 에이전트가 있어야 팀원을 추가할 수 있습니다.",
            "Direct child agents are required before adding team members.",
          )}
        </div>
      )}
    </div>
  )
}

function AgentTeamSetupPanel({
  agent,
  composition,
  projection,
  reload,
  deletingTeamId,
  deleteTeam,
  text,
}: {
  agent: AgentTopologyAgentInspector
  composition: TopologyAgentComposition
  projection: AgentTopologyProjection
  reload: () => Promise<void>
  deletingTeamId: string
  deleteTeam: (teamId: string) => Promise<void>
  text: (ko: string, en: string) => string
}) {
  const directChildren = useMemo(
    () =>
      composition.children
        .map((child) => projection.inspectors.agents[child.id])
        .filter((child): child is AgentTopologyAgentInspector => Boolean(child)),
    [composition.children, projection.inspectors.agents],
  )
  const ownedTeams = useMemo(
    () =>
      Object.values(projection.inspectors.teams).filter(
        (team) => team.ownerAgentId === agent.agentId,
      ),
    [agent.agentId, projection.inspectors.teams],
  )
  const [teamName, setTeamName] = useState("")
  const [purpose, setPurpose] = useState("")
  const [memberAgentIds, setMemberAgentIds] = useState<string[]>([])
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState("")
  const directChildKey = directChildren.map((child) => child.agentId).join("|")

  useEffect(() => {
    setMemberAgentIds((current) => {
      const allowed = new Set(directChildren.map((child) => child.agentId))
      const next = current.filter((agentId) => allowed.has(agentId))
      return next.length > 0 ? next : directChildren.map((child) => child.agentId)
    })
    setError("")
  }, [directChildKey])

  function toggleNewTeamMember(agentId: string, active: boolean) {
    setMemberAgentIds((current) =>
      active ? uniqueValues([agentId, ...current]) : current.filter((memberAgentId) => memberAgentId !== agentId),
    )
  }

  async function createTeam() {
    const name = teamName.trim()
    if (!name) {
      setError(text("팀 이름이 필요합니다.", "Team name is required."))
      return
    }
    if (memberAgentIds.length === 0) {
      setError(text("팀원이 필요합니다.", "Team members are required."))
      return
    }
    setCreating(true)
    setError("")
    try {
      const payload = buildTopologyTeamCreatePayload({
        kind: "team",
        name,
        detail: purpose,
        parentAgentId: agent.agentId,
        leadAgentId: agent.agentId,
        memberAgentIds: uniqueValues(memberAgentIds),
      })
      await api.createTopologyTeam(payload.team)
      setTeamName("")
      setPurpose("")
      setMemberAgentIds(directChildren.map((child) => child.agentId))
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setCreating(false)
    }
  }

  return (
    <section className="rounded-lg border border-stone-200 bg-white p-4">
      <div className="text-sm font-semibold text-stone-900">{text("팀 설정", "Team Settings")}</div>
      {error ? (
        <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
      ) : null}
      <div className="mt-3 rounded-lg border border-stone-200 bg-stone-50 p-3">
        <div className="text-xs font-semibold uppercase text-stone-500">
          {text("새 팀", "New team")}
        </div>
        {directChildren.length > 0 ? (
          <div className="mt-3 grid gap-2">
            <input
              value={teamName}
              onChange={(event) => setTeamName(event.currentTarget.value)}
              className="h-9 rounded-lg border border-stone-200 bg-white px-3 text-xs text-stone-800"
              placeholder={text("팀 이름", "Team name")}
              aria-label={text("팀 이름", "Team name")}
            />
            <input
              value={purpose}
              onChange={(event) => setPurpose(event.currentTarget.value)}
              className="h-9 rounded-lg border border-stone-200 bg-white px-3 text-xs text-stone-800"
              placeholder={text("목적", "Purpose")}
              aria-label={text("목적", "Purpose")}
            />
            <div className="rounded-lg border border-stone-200 bg-white px-3 py-2 text-xs">
              <div className="font-semibold text-stone-600">{text("팀장", "Team lead")}</div>
              <div className="mt-1 font-semibold text-stone-900">
                {agent.nickname ?? agent.displayName}
              </div>
            </div>
            <div>
              <div className="text-xs font-semibold text-stone-600">{text("팀원", "Members")}</div>
              <div className="mt-2 grid gap-1">
                {directChildren.map((child) => {
                  const checked = memberAgentIds.includes(child.agentId)
                  return (
                    <label
                      key={child.agentId}
                      className="flex items-center justify-between gap-3 rounded-lg border border-stone-200 bg-white px-3 py-2 text-xs"
                    >
                      <span>
                        <span className="font-semibold text-stone-900">
                          {child.nickname ?? child.displayName}
                        </span>
                        <span className="ml-2 text-stone-500">member</span>
                      </span>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(event) =>
                          toggleNewTeamMember(child.agentId, event.currentTarget.checked)
                        }
                        className="h-4 w-4"
                      />
                    </label>
                  )
                })}
              </div>
            </div>
            <button
              type="button"
              onClick={() => void createTeam()}
              disabled={creating || !teamName.trim() || memberAgentIds.length === 0}
              className="h-9 rounded-lg bg-stone-900 px-3 text-xs font-semibold text-white disabled:opacity-50"
            >
              {creating ? text("추가 중", "Adding") : text("팀 만들기", "Create team")}
            </button>
          </div>
        ) : (
          <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
            {text(
              "이 노드에 하위 에이전트를 연결하면 팀을 만들 수 있습니다.",
              "Connect child agents to this node before creating a team.",
            )}
          </div>
        )}
      </div>
      {ownedTeams.length > 0 ? (
        <div className="mt-3 grid gap-2">
          {ownedTeams.map((team) => (
            <SimpleTeamEditor
              key={team.teamId}
              team={team}
              reload={reload}
              deleting={deletingTeamId === team.teamId}
              deleteTeam={deleteTeam}
              text={text}
            />
          ))}
        </div>
      ) : null}
    </section>
  )
}

function AgentInspector({
  agent,
  composition,
  projection,
  reload,
  deletingTeamId,
  deleteTeam,
  text,
}: {
  agent: AgentTopologyAgentInspector
  composition: TopologyAgentComposition
  projection: AgentTopologyProjection
  reload: () => Promise<void>
  deletingTeamId: string
  deleteTeam: (teamId: string) => Promise<void>
  text: (ko: string, en: string) => string
}) {
  const assignedTeams = buildTopologyAgentTeamAssignments(composition)
  const canEditAgentProfile = agent.source !== "synthetic"
  const [editingProfile, setEditingProfile] = useState(false)
  const [displayNameDraft, setDisplayNameDraft] = useState(agent.displayName)
  const [nicknameDraft, setNicknameDraft] = useState(agent.nickname ?? agent.displayName)
  const [roleDraft, setRoleDraft] = useState(agent.role)
  const [specialtyDraft, setSpecialtyDraft] = useState(agent.specialtyTags.join(", "))
  const [statusDraft, setStatusDraft] = useState(agent.status)
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileError, setProfileError] = useState("")

  useEffect(() => {
    setEditingProfile(false)
    setDisplayNameDraft(agent.displayName)
    setNicknameDraft(agent.nickname ?? agent.displayName)
    setRoleDraft(agent.role)
    setSpecialtyDraft(agent.specialtyTags.join(", "))
    setStatusDraft(agent.status)
    setProfileError("")
  }, [agent.agentId, agent.displayName, agent.nickname, agent.role, agent.specialtyTags, agent.status])

  async function saveAgentProfile() {
    const displayName = displayNameDraft.trim()
    const nickname = nicknameDraft.trim() || displayName
    const role = roleDraft.trim()
    const specialtyTags = splitTopologyListDraft(specialtyDraft)
    if (!displayName) {
      setProfileError(text("표시 이름이 필요합니다.", "Display name is required."))
      return
    }
    if (!role) {
      setProfileError(text("역할이 필요합니다.", "Role is required."))
      return
    }
    setProfileSaving(true)
    setProfileError("")
    try {
      await api.updateTopologyAgent(agent.agentId, {
        displayName,
        nickname,
        role,
        specialtyTags,
        status: AGENT_PROFILE_STATUS_OPTIONS.some((status) => status === statusDraft)
          ? statusDraft
          : "enabled",
      })
      setEditingProfile(false)
      await reload()
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : String(err))
    } finally {
      setProfileSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-400">
          {text("Agent Inspector", "Agent Inspector")}
        </div>
        <h2 className="mt-2 break-words text-xl font-semibold text-stone-950">
          {agent.nickname ?? agent.displayName}
        </h2>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <InspectorField label={text("상태", "Status")} value={agent.status} />
        <InspectorField label={text("역할", "Role")} value={agent.role} />
        <InspectorField label={text("전문성", "Specialty")} value={listText(agent.specialtyTags)} />
        <InspectorField
          label={text("팀", "Teams")}
          value={
            assignedTeams.length > 0
              ? listText(assignedTeams.map((team) => team.label))
              : text("미배정", "Unassigned")
          }
        />
      </div>
      <section className="rounded-lg border border-stone-200 bg-white p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-semibold text-stone-900">
            {text("프로필 설정", "Profile Settings")}
          </div>
          <button
            type="button"
            onClick={() => {
              if (!canEditAgentProfile) return
              setEditingProfile((current) => !current)
              setProfileError("")
            }}
            disabled={!canEditAgentProfile}
            className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-1.5 text-xs font-semibold text-stone-700"
          >
            {editingProfile ? text("취소", "Cancel") : text("수정", "Edit")}
          </button>
        </div>
        {!canEditAgentProfile ? (
          <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
            {text(
              "저장된 에이전트 설정이 없는 노드는 여기서 수정할 수 없습니다.",
              "Nodes without stored agent configuration cannot be edited here.",
            )}
          </div>
        ) : null}
        {profileError ? (
          <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
            {profileError}
          </div>
        ) : null}
        {editingProfile ? (
          <div className="mt-3 grid gap-3">
            <label className="grid gap-1 text-xs font-semibold text-stone-600">
              {text("표시 이름", "Display name")}
              <input
                value={displayNameDraft}
                onChange={(event) => setDisplayNameDraft(event.currentTarget.value)}
                className="h-9 rounded-lg border border-stone-200 bg-white px-3 text-sm font-normal text-stone-900"
              />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-stone-600">
              {text("별칭", "Nickname")}
              <input
                value={nicknameDraft}
                onChange={(event) => setNicknameDraft(event.currentTarget.value)}
                className="h-9 rounded-lg border border-stone-200 bg-white px-3 text-sm font-normal text-stone-900"
              />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-stone-600">
              {text("상태", "Status")}
              <select
                value={statusDraft}
                onChange={(event) => setStatusDraft(event.currentTarget.value)}
                className="h-9 rounded-lg border border-stone-200 bg-white px-3 text-sm font-normal text-stone-900"
              >
                {AGENT_PROFILE_STATUS_OPTIONS.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-xs font-semibold text-stone-600">
              {text("역할", "Role")}
              <input
                value={roleDraft}
                onChange={(event) => setRoleDraft(event.currentTarget.value)}
                className="h-9 rounded-lg border border-stone-200 bg-white px-3 text-sm font-normal text-stone-900"
              />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-stone-600">
              {text("전문성", "Specialty")}
              <textarea
                value={specialtyDraft}
                onChange={(event) => setSpecialtyDraft(event.currentTarget.value)}
                rows={3}
                className="resize-none rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm font-normal text-stone-900"
              />
            </label>
            <button
              type="button"
              onClick={() => void saveAgentProfile()}
              disabled={profileSaving || !displayNameDraft.trim() || !roleDraft.trim()}
              className="h-9 rounded-lg bg-stone-900 px-3 text-xs font-semibold text-white disabled:opacity-50"
            >
              {profileSaving ? text("저장 중", "Saving") : text("저장", "Save")}
            </button>
          </div>
        ) : (
          <div className="mt-3 grid gap-2 text-xs leading-5 text-stone-600">
            <div>
              {text("표시 이름", "Display name")}: {agent.displayName}
            </div>
            <div>
              {text("별칭", "Nickname")}: {agent.nickname ?? "-"}
            </div>
            <div>
              {text("전문성", "Specialty")}: {listText(agent.specialtyTags)}
            </div>
          </div>
        )}
      </section>
      <AgentCompositionPanel
        composition={composition}
        parentEmpty={agent.kind === "nobie" ? text("Root", "Root") : text("미배치", "Unassigned")}
        text={text}
      />
      <AgentTeamSetupPanel
        agent={agent}
        composition={composition}
        projection={projection}
        reload={reload}
        deletingTeamId={deletingTeamId}
        deleteTeam={deleteTeam}
        text={text}
      />
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
        </div>
      </section>
    </div>
  )
}

function TeamInspector({
  team,
  composition,
  reload,
  deleting,
  deleteTeam,
  text,
}: {
  team: AgentTopologyTeamInspector
  composition: TopologyTeamCompositionSummary
  reload: () => Promise<void>
  deleting: boolean
  deleteTeam: (teamId: string) => Promise<void>
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
      <TeamCompositionPanel summary={composition} text={text} />
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
      <SimpleTeamEditor
        team={team}
        reload={reload}
        deleting={deleting}
        deleteTeam={deleteTeam}
        text={text}
      />
    </div>
  )
}

function ConnectionInspector({
  edge,
  projection,
  membershipUpdating,
  deactivateTeamMember,
  text,
}: {
  edge: AgentTopologyEdge
  projection: AgentTopologyProjection
  membershipUpdating: boolean
  deactivateTeamMember: (teamId: string, agentId: string) => Promise<void>
  text: (ko: string, en: string) => string
}) {
  const source = projection.nodes.find((node) => node.id === edge.source)
  const target = projection.nodes.find((node) => node.id === edge.target)
  const teamId = typeof edge.data.teamId === "string" ? edge.data.teamId : ""
  const agentId = typeof edge.data.agentId === "string" ? edge.data.agentId : ""
  const active = edge.data.active === true
  const canDeactivate = edge.kind === "team_membership" && edge.style !== "lead" && active
  return (
    <div className="space-y-4">
      <div>
        <div className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-400">
          {text("Connection Inspector", "Connection Inspector")}
        </div>
        <h2 className="mt-2 break-words text-xl font-semibold text-stone-950">
          {edge.kind === "parent_child"
            ? text("계층 연결", "Hierarchy connection")
            : edge.style === "lead"
              ? text("팀장 연결", "Team lead connection")
            : text("팀 멤버십", "Team membership")}
        </h2>
        <div className="mt-2 break-all text-xs text-stone-500">{edge.id}</div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <InspectorField label={text("Source", "Source")} value={source?.label ?? edge.source} />
        <InspectorField label={text("Target", "Target")} value={target?.label ?? edge.target} />
        <InspectorField label={text("Style", "Style")} value={edge.style} />
        <InspectorField label={text("Valid", "Valid")} value={edge.valid} />
      </div>
      {edge.kind === "team_membership" ? (
        <section className="rounded-lg border border-stone-200 bg-white p-4">
          <div className="text-sm font-semibold text-stone-900">
            {text("멤버십 구성", "Membership Composition")}
          </div>
          <div className="mt-3 grid gap-2 text-xs leading-5 text-stone-600">
            <div>
              {text("Team", "Team")}: {teamId || "-"}
            </div>
            <div>
              {text("Agent", "Agent")}: {agentId || "-"}
            </div>
            <div>
              {text("Role", "Role")}:{" "}
              {typeof edge.data.role === "string" ? edge.data.role : (edge.label ?? "-")}
            </div>
            <div>
              {text("State", "State")}:{" "}
              {typeof edge.data.executionState === "string"
                ? edge.data.executionState
                : active
                  ? "active"
                  : "-"}
            </div>
          </div>
          {canDeactivate && teamId && agentId ? (
            <button
              type="button"
              onClick={() => void deactivateTeamMember(teamId, agentId)}
              disabled={membershipUpdating}
              className="mt-4 rounded-lg border border-amber-200 bg-white px-3 py-2 text-xs font-semibold text-amber-800 disabled:opacity-50"
            >
              {membershipUpdating
                ? text("변경 중", "Updating")
                : text("멤버 비활성화", "Deactivate member")}
            </button>
          ) : null}
        </section>
      ) : null}
      {edge.diagnostics.length > 0 ? (
        <section className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <div className="text-sm font-semibold text-amber-900">{text("진단", "Diagnostics")}</div>
          <div className="mt-2 space-y-1 text-xs text-amber-800">
            {edge.diagnostics.map((diagnostic) => (
              <div key={`${edge.id}:${diagnostic.reasonCode}`}>{diagnostic.reasonCode}</div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  )
}

function InspectorPanel({
  projection,
  selection,
  edgeSelection,
  reload,
  membershipUpdating,
  deactivateTeamMember,
  deletingTeamId,
  deleteTeam,
  text,
}: {
  projection: AgentTopologyProjection | null
  selection: TopologySelection | null
  edgeSelection: AgentTopologyEdge | null
  reload: () => Promise<void>
  membershipUpdating: boolean
  deactivateTeamMember: (teamId: string, agentId: string) => Promise<void>
  deletingTeamId: string
  deleteTeam: (teamId: string) => Promise<void>
  text: (ko: string, en: string) => string
}) {
  if (projection && edgeSelection) {
    return (
      <ConnectionInspector
        edge={edgeSelection}
        projection={projection}
        membershipUpdating={membershipUpdating}
        deactivateTeamMember={deactivateTeamMember}
        text={text}
      />
    )
  }
  if (!projection || !selection) {
    return (
      <div className="rounded-lg border border-stone-200 bg-white p-5 text-sm text-stone-500">
        {text("노드를 선택하세요.", "Select a node.")}
      </div>
    )
  }
  if (selection.kind === "team") {
    const team = projection.inspectors.teams[selection.entityId]
    return team ? (
      <TeamInspector
        team={team}
        composition={buildTopologyTeamCompositionSummary(projection, team)}
        reload={reload}
        deleting={deletingTeamId === team.teamId}
        deleteTeam={deleteTeam}
        text={text}
      />
    ) : null
  }
  if (selection.kind === "team_role" || selection.kind === "team_lead") {
    const team = selection.teamId ? projection.inspectors.teams[selection.teamId] : undefined
    return team ? (
      <TeamInspector
        team={team}
        composition={buildTopologyTeamCompositionSummary(projection, team)}
        reload={reload}
        deleting={deletingTeamId === team.teamId}
        deleteTeam={deleteTeam}
        text={text}
      />
    ) : null
  }
  const agent = projection.inspectors.agents[selection.entityId]
  return agent ? (
    <AgentInspector
      agent={agent}
      composition={buildTopologyAgentComposition(projection, agent.agentId)}
      projection={projection}
      reload={reload}
      deletingTeamId={deletingTeamId}
      deleteTeam={deleteTeam}
      text={text}
    />
  ) : null
}

function TopologyPageInner() {
  const { text } = useUiI18n()
  const runs = useRunsStore((state) => state.runs)
  const [projection, setProjection] = useState<AgentTopologyProjection | null>(null)
  const [selection, setSelection] = useState<TopologySelection | null>(null)
  const [loadError, setLoadError] = useState("")
  const [actionError, setActionError] = useState("")
  const [savingLayout, setSavingLayout] = useState(false)
  const [creatingNode, setCreatingNode] = useState(false)
  const [archivingNode, setArchivingNode] = useState(false)
  const [membershipUpdating, setMembershipUpdating] = useState(false)
  const [deletingTeamId, setDeletingTeamId] = useState("")
  const [edgeSelection, setEdgeSelection] = useState<AgentTopologyEdge | null>(null)
  const [draftName, setDraftName] = useState("")
  const [draftDetail, setDraftDetail] = useState("")
  const [viewport, setViewport] = useState<{ x: number; y: number; zoom: number } | undefined>()
  const workingAgentIds = useMemo(
    () => buildTopologyWorkingAgentIds(runs, projection?.rootAgentId ?? "agent:nobie"),
    [projection?.rootAgentId, runs],
  )
  const elements = useMemo(
    () => buildTopologyFlowElements(projection, { workingAgentIds }),
    [projection, workingAgentIds],
  )
  const [nodes, setNodes] = useNodesState<TopologyFlowNodeData>([])
  const [edges, setEdges] = useEdgesState<TopologyFlowEdgeData>([])
  const [pendingNodeDeletions, setPendingNodeDeletions] = useState<
    PendingTopologyNodeDeletion[]
  >([])
  const [pendingEdgeDeletions, setPendingEdgeDeletions] = useState<
    PendingTopologyEdgeDeletion[]
  >([])
  const pendingDeletedNodeIds = useMemo(
    () => new Set(pendingNodeDeletions.map((deletion) => deletion.nodeId)),
    [pendingNodeDeletions],
  )
  const pendingDeletedEdgeIds = useMemo(
    () => new Set(pendingEdgeDeletions.map((deletion) => deletion.edgeId)),
    [pendingEdgeDeletions],
  )
  const visibleElements = useMemo(
    () => ({
      nodes: elements.nodes.filter((node) => !pendingDeletedNodeIds.has(node.id)),
      edges: elements.edges.filter(
        (edge) =>
          !pendingDeletedEdgeIds.has(edge.id) &&
          !pendingDeletedNodeIds.has(edge.source) && !pendingDeletedNodeIds.has(edge.target),
      ),
    }),
    [elements, pendingDeletedEdgeIds, pendingDeletedNodeIds],
  )

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
    setNodes((current) => {
      return mergeTopologyFlowNodesWithCurrentPositions(visibleElements.nodes, current)
    })
    setEdges(visibleElements.edges)
  }, [setEdges, setNodes, visibleElements])

  const activateTeamMembership = useCallback(
    async (teamId: string, agentId: string) => {
      if (!projection) return
      const team = projection.inspectors.teams[teamId]
      if (!team) {
        setActionError(text("팀을 찾을 수 없습니다.", "Team was not found."))
        return
      }
      setMembershipUpdating(true)
      setActionError("")
      try {
        const candidate = team.builder.candidates.find((item) => item.agentId === agentId)
        if (!candidate?.canActivate) {
          await api.createAgentRelationship({
            parentAgentId: team.ownerAgentId,
            childAgentId: agentId,
          })
        }
        const draft = buildTeamMembershipDraftForAgent(team, agentId, true)
        await api.updateTeamMembers(teamId, buildTeamMembersPayload(team, draft))
        await load()
      } catch (err) {
        setActionError(err instanceof Error ? err.message : String(err))
      } finally {
        setMembershipUpdating(false)
      }
    },
    [load, projection, text],
  )

  const deactivateTeamMember = useCallback(
    async (teamId: string, agentId: string) => {
      if (!projection) return
      const team = projection.inspectors.teams[teamId]
      if (!team) {
        setActionError(text("팀을 찾을 수 없습니다.", "Team was not found."))
        return
      }
      setMembershipUpdating(true)
      setActionError("")
      try {
        const draft = buildTeamBuilderDraft(team).filter((item) => item.agentId !== agentId)
        await api.updateTeamMembers(teamId, buildTeamMembersPayload(team, draft))
        setEdgeSelection(null)
        await load()
      } catch (err) {
        setActionError(err instanceof Error ? err.message : String(err))
      } finally {
        setMembershipUpdating(false)
      }
    },
    [load, projection, text],
  )

  const deleteTeam = useCallback(
    async (teamId: string) => {
      if (!teamId) return
      const team = projection?.inspectors.teams[teamId]
      const label = team?.nickname ?? team?.displayName ?? teamId
      if (
        typeof window !== "undefined" &&
        !window.confirm(
          text(
            `${label} 팀을 완전히 삭제할까요?`,
            `Permanently delete team ${label}?`,
          ),
        )
      ) {
        return
      }
      setDeletingTeamId(teamId)
      setActionError("")
      try {
        await api.deleteTopologyTeam(teamId)
        setSelection((current) => (current?.entityId === teamId ? null : current))
        setEdgeSelection(null)
        await load()
      } catch (err) {
        setActionError(err instanceof Error ? err.message : String(err))
      } finally {
        setDeletingTeamId("")
      }
    },
    [load, projection, text],
  )

  const onNodesChange = useCallback(
    (changes: Array<NodeChange<Node<TopologyFlowNodeData>>>) => {
      const removedNodeIds = new Set(
        changes
          .filter((change) => change.type === "remove")
          .map((change) => change.id),
      )
      if (removedNodeIds.size === 0) {
        setNodes((current) => applyTopologyNodeChanges(changes, current))
        return
      }

      const removedNodes = nodes.filter((node) => removedNodeIds.has(node.id))
      const deletableNodes = removedNodes.filter((node) =>
        canArchiveTopologySelection(selectionFromTopologyNode(node)),
      )
      const blockedNodes = removedNodes.filter((node) => node.data.kind === "nobie")
      if (blockedNodes.length > 0) {
        setActionError(
          text(
            "메인 노비 노드는 삭제할 수 없습니다.",
            "The main Nobie node cannot be deleted.",
          ),
        )
      } else if (deletableNodes.length > 0) {
        setActionError(
          text(
            "삭제는 Layout 저장 시 반영됩니다.",
            "Deletion will be applied when saving the layout.",
          ),
        )
      }

      if (deletableNodes.length > 0) {
        setPendingNodeDeletions((current) => {
          const byId = new Map(current.map((deletion) => [deletion.nodeId, deletion]))
          for (const node of deletableNodes) {
            byId.set(node.id, {
              nodeId: node.id,
              kind: node.data.kind as "sub_agent" | "team",
              entityId: node.data.entityId,
              label: node.data.label,
            })
          }
          return [...byId.values()]
        })
        setSelection((current) =>
          current && removedNodeIds.has(current.nodeId) ? null : current,
        )
        setEdgeSelection(null)
      }

      const deletableNodeIds = new Set(deletableNodes.map((node) => node.id))
      const filteredChanges = changes.filter(
        (change) => change.type !== "remove" || deletableNodeIds.has(change.id),
      )
      setNodes((current) => applyTopologyNodeChanges(filteredChanges, current))
    },
    [nodes, setNodes, text],
  )

  const onEdgesChange = useCallback(
    (changes: Array<EdgeChange<Edge<TopologyFlowEdgeData>>>) => {
      const removedEdgeIds = new Set(
        changes
          .filter((change) => change.type === "remove")
          .map((change) => change.id),
      )
      if (removedEdgeIds.size === 0) {
        setEdges((current) => applyEdgeChanges(changes, current))
        return
      }

      const removedEdges = edges.filter((edge) => removedEdgeIds.has(edge.id))
      const deletableEdges: PendingTopologyEdgeDeletion[] = []
      let blockedLeadEdge = false
      for (const edge of removedEdges) {
        const raw = edge.data?.raw
        if (!raw) continue
        if (raw.kind === "parent_child") {
          deletableEdges.push({
            edgeId: raw.id,
            kind: "parent_child",
            label: raw.label ?? raw.id,
          })
          continue
        }
        if (raw.kind === "team_membership" && raw.style !== "lead") {
          const teamId = typeof raw.data.teamId === "string" ? raw.data.teamId : ""
          const agentId = typeof raw.data.agentId === "string" ? raw.data.agentId : ""
          if (teamId && agentId) {
            deletableEdges.push({
              edgeId: raw.id,
              kind: "team_membership",
              teamId,
              agentId,
              label: raw.label ?? raw.id,
            })
          }
          continue
        }
        if (raw.kind === "team_membership" && raw.style === "lead") blockedLeadEdge = true
      }

      if (blockedLeadEdge) {
        setActionError(
          text(
            "팀장 연결은 선 삭제로 제거할 수 없습니다. 팀 설정에서 팀을 변경하거나 삭제하세요.",
            "Team lead connections cannot be removed by deleting the edge. Change or delete the team from team settings.",
          ),
        )
      } else if (deletableEdges.length > 0) {
        setActionError(
          text(
            "관계 삭제는 Layout 저장 시 반영됩니다.",
            "Connection deletion will be applied when saving the layout.",
          ),
        )
      }

      if (deletableEdges.length > 0) {
        setPendingEdgeDeletions((current) => {
          const byId = new Map(current.map((deletion) => [deletion.edgeId, deletion]))
          for (const deletion of deletableEdges) byId.set(deletion.edgeId, deletion)
          return [...byId.values()]
        })
        setEdgeSelection((current) =>
          current && removedEdgeIds.has(current.id) ? null : current,
        )
      }

      const deletableEdgeIds = new Set(deletableEdges.map((edge) => edge.edgeId))
      const filteredChanges = changes.filter(
        (change) => change.type !== "remove" || deletableEdgeIds.has(change.id),
      )
      setEdges((current) => applyEdgeChanges(filteredChanges, current))
    },
    [edges, setEdges, text],
  )

  const onConnect = useCallback(
    async (connection: Connection) => {
      setActionError("")
      const source = nodes.find((node) => node.id === connection.source)
      const target = nodes.find((node) => node.id === connection.target)
      const intent = resolveTopologyConnectionIntent(source?.data, target?.data)
      if (intent.kind === "team_membership") {
        await activateTeamMembership(intent.teamId, intent.agentId)
        return
      }
      if (intent.kind === "invalid") {
        setActionError(
          text(
            "이 연결 조합은 저장할 수 없습니다.",
            "This connection combination cannot be saved.",
          ),
        )
        return
      }
      try {
        await api.createAgentRelationship({
          parentAgentId: intent.parentAgentId,
          childAgentId: intent.childAgentId,
        })
        await load()
      } catch (err) {
        setActionError(err instanceof Error ? err.message : String(err))
      }
    },
    [activateTeamMembership, load, nodes, text],
  )

  const onNodeDragStop = useCallback(
    async (_: ReactMouseEvent, node: Node<TopologyFlowNodeData>) => {
      const nextNodes = nodes.map((item) => (item.id === node.id ? node : item))
      const intent = resolveTopologyNodeDragDropIntent(node, nextNodes)
      if (intent.kind === "activate_team_membership") {
        await activateTeamMembership(intent.teamId, intent.agentId)
        return
      }
      if (intent.kind === "deactivate_team_membership") {
        await deactivateTeamMember(intent.teamId, intent.agentId)
        return
      }
      setNodes((current) => mergeTopologyFlowNodesWithCurrentPositions(visibleElements.nodes, current))
    },
    [activateTeamMembership, deactivateTeamMember, nodes, setNodes, visibleElements.nodes],
  )

  async function saveLayout() {
    if (!projection) return
    setSavingLayout(true)
    setActionError("")
    try {
      const edgeDeletions = pendingEdgeDeletions
      const relationshipDeletions = edgeDeletions.filter(
        (deletion): deletion is Extract<PendingTopologyEdgeDeletion, { kind: "parent_child" }> =>
          deletion.kind === "parent_child",
      )
      for (const deletion of relationshipDeletions) {
        await api.deleteAgentRelationship(deletion.edgeId)
      }
      const membershipDeletionsByTeam = new Map<string, Set<string>>()
      for (const deletion of edgeDeletions) {
        if (deletion.kind !== "team_membership") continue
        const agentIds = membershipDeletionsByTeam.get(deletion.teamId) ?? new Set<string>()
        agentIds.add(deletion.agentId)
        membershipDeletionsByTeam.set(deletion.teamId, agentIds)
      }
      for (const [teamId, agentIds] of membershipDeletionsByTeam.entries()) {
        const team = projection.inspectors.teams[teamId]
        if (!team) continue
        const draft = buildTeamBuilderDraft(team).filter((item) => !agentIds.has(item.agentId))
        await api.updateTeamMembers(teamId, buildTeamMembersPayload(team, draft))
      }
      const deletions = pendingNodeDeletions
      for (const deletion of deletions) {
        if (deletion.kind === "team") {
          await api.deleteTopologyTeam(deletion.entityId)
        } else {
          await api.archiveTopologyAgent(deletion.entityId)
        }
      }
      const deletedNodeIds = new Set(deletions.map((deletion) => deletion.nodeId))
      await api.saveAgentTopologyLayout({
        schemaVersion: projection.layout.schemaVersion,
        layout: "react-flow",
        nodes: Object.fromEntries(
          nodes
            .filter((node) => !deletedNodeIds.has(node.id))
            .map((node) => [
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
      setPendingNodeDeletions([])
      setPendingEdgeDeletions([])
      setSelection((current) =>
        current && deletedNodeIds.has(current.nodeId) ? null : current,
      )
      setEdgeSelection(null)
      await load()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
    } finally {
      setSavingLayout(false)
    }
  }

  async function createTopologyNode() {
    if (!projection) return
    const name = draftName.trim()
    if (!name) {
      setActionError(text("노드 이름이 필요합니다.", "Node name is required."))
      return
    }
    setCreatingNode(true)
    setActionError("")
    try {
      const payload = buildTopologyAgentCreatePayload({
        kind: "agent",
        name,
        detail: draftDetail,
      })
      await api.createTopologyAgent(payload.agent)
      setDraftName("")
      setDraftDetail("")
      await load()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
    } finally {
      setCreatingNode(false)
    }
  }

  async function archiveSelectedNode() {
    if (!selection || !canArchiveTopologySelection(selection)) return
    const label =
      selection.kind === "team"
        ? text("이 팀 노드를 아카이브할까요?", "Archive this team node?")
        : text("이 서브 에이전트 노드를 아카이브할까요?", "Archive this sub-agent node?")
    if (typeof window !== "undefined" && !window.confirm(label)) return
    setArchivingNode(true)
    setActionError("")
    try {
      if (selection.kind === "team") {
        await api.archiveTopologyTeam(selection.entityId)
      } else if (selection.kind === "sub_agent") {
        await api.archiveTopologyAgent(selection.entityId)
      }
      setSelection(null)
      setEdgeSelection(null)
      await load()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
    } finally {
      setArchivingNode(false)
    }
  }

  const cards = buildTopologySummaryCards(projection, text)
  const canArchiveSelection = canArchiveTopologySelection(selection)

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
            <button
              type="button"
              onClick={() => void archiveSelectedNode()}
              disabled={!canArchiveSelection || archivingNode}
              className="rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-700 disabled:cursor-not-allowed disabled:opacity-45"
            >
              {archivingNode
                ? text("아카이브 중", "Archiving")
                : text("선택 아카이브", "Archive selected")}
            </button>
          </div>
        </div>
        <div className="mt-4 grid gap-2 rounded-lg border border-stone-200 bg-stone-50 p-3 lg:grid-cols-[minmax(140px,1fr)_minmax(140px,1fr)_auto]">
          <input
            value={draftName}
            onChange={(event) => setDraftName(event.currentTarget.value)}
            className="h-10 rounded-lg border border-stone-200 bg-white px-3 text-sm text-stone-800"
            placeholder={text("에이전트 이름", "Agent name")}
            aria-label={text("에이전트 이름", "Agent name")}
          />
          <input
            value={draftDetail}
            onChange={(event) => setDraftDetail(event.currentTarget.value)}
            className="h-10 rounded-lg border border-stone-200 bg-white px-3 text-sm text-stone-800"
            placeholder={text("역할", "Role")}
            aria-label={text("역할", "Role")}
          />
          <button
            type="button"
            onClick={() => void createTopologyNode()}
            disabled={creatingNode || !draftName.trim()}
            className="h-10 rounded-lg bg-stone-900 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {creatingNode ? text("추가 중", "Adding") : text("에이전트 추가", "Add agent")}
          </button>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-stone-200 bg-white px-3 py-2 text-xs text-stone-600">
          <span className="font-semibold text-stone-900">
            {text("연결 구성", "Connection composition")}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-0.5 w-8 rounded bg-stone-700" />
            {text("부모-하위 에이전트", "Parent-child agents")}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-0.5 w-8 rounded border-t-2 border-dashed border-teal-700" />
            {text("활성 팀 멤버", "Active team member")}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-0.5 w-8 rounded border-t-2 border-dashed border-amber-700" />
            {text("참조 멤버", "Reference member")}
          </span>
          <span className="ml-auto text-stone-500">
            {text(
              "팀 구성은 선택한 노드의 설정에서 관리합니다.",
              "Manage teams from the selected node settings.",
            )}
          </span>
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
        {pendingNodeDeletions.length > 0 ? (
          <div className="mt-3 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-800">
            {text("삭제 대기", "Pending deletion")}: {pendingNodeDeletions.length}
          </div>
        ) : null}
        {pendingEdgeDeletions.length > 0 ? (
          <div className="mt-3 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {text("관계 삭제 대기", "Pending connection deletion")}:{" "}
            {pendingEdgeDeletions.length}
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
            onNodeClick={(_, node: Node<TopologyFlowNodeData>) => {
              setSelection(selectionFromTopologyNode(node))
              setEdgeSelection(null)
            }}
            onEdgeClick={(_, edge: Edge<TopologyFlowEdgeData>) => {
              setSelection(null)
              setEdgeSelection(edge.data?.raw ?? null)
            }}
            onPaneClick={() => {
              setSelection(null)
              setEdgeSelection(null)
            }}
            onNodeDragStop={(event, node) => void onNodeDragStop(event, node)}
            onMoveEnd={(_, nextViewport) => setViewport(nextViewport)}
            elevateNodesOnSelect={false}
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
          <InspectorPanel
            projection={projection}
            selection={selection}
            edgeSelection={edgeSelection}
            reload={load}
            membershipUpdating={membershipUpdating}
            deactivateTeamMember={deactivateTeamMember}
            deletingTeamId={deletingTeamId}
            deleteTeam={deleteTeam}
            text={text}
          />
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
