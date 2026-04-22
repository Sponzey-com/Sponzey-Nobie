import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type WheelEvent as ReactWheelEvent } from "react"
import { Link, useLocation } from "react-router-dom"
import { api } from "../../api/client"
import { OrchestrationBoardEditor } from "./OrchestrationBoardEditor"
import { OrchestrationContentShell } from "./OrchestrationContentShell"
import { OrchestrationDashboardShell } from "./OrchestrationDashboardShell"
import { OrchestrationKeyboardMoveDialog } from "./OrchestrationKeyboardMoveDialog"
import { OrchestrationLegacyOverlay } from "./OrchestrationLegacyOverlay"
import { OrchestrationMobileSheet } from "./OrchestrationMobileSheet"
import { OrchestrationPolicyParityPanel } from "./OrchestrationPolicyParityPanel"
import { OrchestrationQuickEditSheet } from "./OrchestrationQuickEditSheet"
import { type OrchestrationSaveResultState } from "./OrchestrationSaveResultToast"
import { OrchestrationStudioPreview } from "./OrchestrationStudioPreview"
import { OrchestrationStudioShell } from "./OrchestrationStudioShell"
import { OrchestrationStudioTopBar } from "./OrchestrationStudioTopBar"
import { OrchestrationTopBar } from "./OrchestrationTopBar"
import { OrchestrationTopologyPanel } from "./OrchestrationTopologyPanel"
import { OrchestrationValidationRibbon } from "./OrchestrationValidationRibbon"
import { OrchestrationFloatingInspector } from "./OrchestrationFloatingInspector"
import { OrchestrationMapToolbar } from "./OrchestrationMapToolbar"
import type {
  OrchestrationAgentRegistryEntry,
  OrchestrationGraphResponse,
  OrchestrationImportResult,
  OrchestrationRegistrySnapshot,
  OrchestrationSubSessionListResponse,
  OrchestrationTeamRegistryEntry,
} from "../../contracts/orchestration-api"
import type { AgentConfig, CapabilityRiskLevel, SubAgentConfig, TeamConfig } from "../../contracts/sub-agent-orchestration"
import {
  beginnerAgentTemplates,
  beginnerTeamTemplates,
  buildOrchestrationSummary,
  buildOrchestrationTopologyScene,
  buildProfilePreviewWarnings,
  buildRelationshipGraphView,
  createSubAgentConfig,
  createTeamConfig,
  EDGE_TYPE_LABELS,
  formatCommaList,
  parseCommaList,
  riskText,
} from "../../lib/orchestration-ui"
import { buildOrchestrationBoardProjection } from "../../lib/orchestration-board-projection"
import { createOrchestrationBoardDraft, type OrchestrationBoardDraft, type PendingDropActionOption } from "../../lib/orchestration-board"
import { createBoardAgentDraft, createBoardTeamDraft, patchBoardAgentDraft, patchBoardTeamDraft } from "../../lib/orchestration-board-editing"
import {
  buildOrchestrationDashboardActivityItems,
  buildOrchestrationDashboardFallback,
  buildOrchestrationDashboardInspector,
  filterOrchestrationDashboardActivityItems,
  type OrchestrationDashboardTab,
} from "../../lib/orchestration-dashboard-projection"
import { buildBoardViewStateFromDraft, reconcileOrchestrationBoardDraft, reduceOrchestrationBoardDraft, resolveReducerActionFromPendingDrop } from "../../lib/orchestration-board-reducer"
import { buildPendingDropAction } from "../../lib/orchestration-drop-actions"
import { BOARD_ARCHIVE_LANE_ID, BOARD_CANVAS_LANE_ID, BOARD_UNASSIGNED_LANE_ID, beginBoardDrag, beginBoardTeamDrag, canDropAgentOnLane, canDropTeamOnLane, inferAgentSourceLaneId, updateBoardDragTarget } from "../../lib/orchestration-dnd"
import { findValidationIssuesForAgent, findValidationIssuesForTeam, validateOrchestrationBoard } from "../../lib/orchestration-board-validation"
import { buildOrchestrationSavePlan, mergeBoardDraftWithRemoteState, summarizeRemainingInstructionKeys } from "../../lib/orchestration-save-plan"
import { resolveOrchestrationShortcut, shouldIgnoreOrchestrationShortcutTarget } from "../../lib/orchestration-shortcuts"
import {
  createDefaultOrchestrationViewportState,
  fitAllOrchestrationViewport,
  fitSelectionOrchestrationViewport,
  formatOrchestrationViewportTransform,
  panOrchestrationViewport,
  zoomOrchestrationViewport,
} from "../../lib/orchestration-viewport"
import {
  buildOrchestrationTopologyInspector,
  buildYeonjangCapabilityProjection,
  resolveTopologyEditorGate,
  type TopologyEditorGate,
} from "../../lib/setup-visualization-topology"
import {
  buildOrchestrationPolicyParityFields,
  resolveOrchestrationSurfacePolicy,
  type OrchestrationLegacyToolId,
} from "../../lib/orchestration-surface-policy"
import { useUiI18n } from "../../lib/ui-i18n"
import { useUiLanguageStore } from "../../stores/uiLanguage"
import { useCapability } from "../../stores/capabilities"
import { useUiModeStore } from "../../stores/uiMode"

type Surface = "page" | "settings"
type WriteResult = {
  ok: boolean
  validationOnly: boolean
  stored: boolean
  approvalRequired: boolean
  effectSummary: string[]
  config: AgentConfig | TeamConfig
}

interface AgentFormState {
  agentId: string
  displayName: string
  nickname: string
  role: string
  personality: string
  specialtyTags: string
  avoidTasks: string
  teamIds: string
  riskCeiling: CapabilityRiskLevel
  allowExternalNetwork: boolean
  allowFilesystemWrite: boolean
  allowShellExecution: boolean
  allowScreenControl: boolean
  allowedPaths: string
  enabledSkillIds: string
  enabledMcpServerIds: string
  enabledToolNames: string
}

interface TeamFormState {
  teamId: string
  displayName: string
  nickname: string
  purpose: string
  memberAgentIds: string
  roleHints: string
}

const DEFAULT_AGENT_FORM: AgentFormState = {
  agentId: "",
  displayName: "",
  nickname: "",
  role: "",
  personality: "",
  specialtyTags: "",
  avoidTasks: "",
  teamIds: "",
  riskCeiling: "moderate",
  allowExternalNetwork: false,
  allowFilesystemWrite: false,
  allowShellExecution: false,
  allowScreenControl: false,
  allowedPaths: "",
  enabledSkillIds: "",
  enabledMcpServerIds: "",
  enabledToolNames: "",
}

const DEFAULT_TEAM_FORM: TeamFormState = {
  teamId: "",
  displayName: "",
  nickname: "",
  purpose: "",
  memberAgentIds: "",
  roleHints: "",
}

export function resolveDefaultDashboardTab(_pathname: string): OrchestrationDashboardTab {
  return "map"
}

export function OrchestrationControlPanel({ surface = "page" }: { surface?: Surface }) {
  const location = useLocation()
  const { text, displayText, formatDateTime } = useUiI18n()
  const language = useUiLanguageStore((state) => state.language)
  const mode = useUiModeStore((state) => state.mode)
  const adminEnabled = useUiModeStore((state) => state.adminEnabled)
  const shell = useUiModeStore((state) => state.shell)
  const [registry, setRegistry] = useState<OrchestrationRegistrySnapshot | null>(null)
  const [agents, setAgents] = useState<OrchestrationAgentRegistryEntry[]>([])
  const [teams, setTeams] = useState<OrchestrationTeamRegistryEntry[]>([])
  const [graph, setGraph] = useState<OrchestrationGraphResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [agentForm, setAgentForm] = useState<AgentFormState>(DEFAULT_AGENT_FORM)
  const [teamForm, setTeamForm] = useState<TeamFormState>(DEFAULT_TEAM_FORM)
  const [selectedAgentId, setSelectedAgentId] = useState("")
  const [selectedTeamId, setSelectedTeamId] = useState("")
  const [agentResult, setAgentResult] = useState<WriteResult | null>(null)
  const [teamResult, setTeamResult] = useState<WriteResult | null>(null)
  const [actionError, setActionError] = useState("")
  const [exportTarget, setExportTarget] = useState("")
  const [exportText, setExportText] = useState("")
  const [importContent, setImportContent] = useState("")
  const [importFormat, setImportFormat] = useState<"json" | "yaml">("json")
  const [importResult, setImportResult] = useState<OrchestrationImportResult | null>(null)
  const [parentRunId, setParentRunId] = useState("")
  const [subSessions, setSubSessions] = useState<OrchestrationSubSessionListResponse | null>(null)
  const [selectedTopologyNodeId, setSelectedTopologyNodeId] = useState<string | null>(null)
  const [selectedTopologyEdgeId, setSelectedTopologyEdgeId] = useState<string | null>(null)
  const [boardDraft, setBoardDraft] = useState<OrchestrationBoardDraft | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const [boardSaveResult, setBoardSaveResult] = useState<OrchestrationSaveResultState | null>(null)
  const [boardSaveRunning, setBoardSaveRunning] = useState(false)
  const [dashboardTab, setDashboardTab] = useState<OrchestrationDashboardTab>(() => resolveDefaultDashboardTab(location.pathname))
  const boardNodeMode: "card" = "card"
  const [viewport, setViewport] = useState(createDefaultOrchestrationViewportState)
  const [dragPanOrigin, setDragPanOrigin] = useState<{ x: number; y: number } | null>(null)
  const [allowEmptySelection, setAllowEmptySelection] = useState(false)
  const [legacySurfaceOpen, setLegacySurfaceOpen] = useState(false)
  const [activeLegacyToolId, setActiveLegacyToolId] = useState<OrchestrationLegacyToolId>("topology")
  const [keyboardMoveOpen, setKeyboardMoveOpen] = useState(false)
  const [keyboardMoveSourceLaneId, setKeyboardMoveSourceLaneId] = useState<string>(BOARD_UNASSIGNED_LANE_ID)
  const [keyboardMoveTargetLaneId, setKeyboardMoveTargetLaneId] = useState<string>(BOARD_UNASSIGNED_LANE_ID)
  const boardMouseDragCandidateRef = useRef<{
    entityType: "agent" | "team"
    entityId: string
    sourceLaneId: string
    startX: number
    startY: number
  } | null>(null)
  const boardPointerDragActiveRef = useRef(false)
  const suppressBoardSelectionRef = useRef<string | null>(null)

  const buildDraftFromRemoteState = useCallback((input: {
    snapshot: OrchestrationRegistrySnapshot | null
    agents: OrchestrationAgentRegistryEntry[]
    teams: OrchestrationTeamRegistryEntry[]
  }) => createOrchestrationBoardDraft({
    agents: input.agents
      .map((agent) => agent.config)
      .filter((config): config is SubAgentConfig => config.agentType === "sub_agent"),
    teams: input.teams.map((team) => team.config),
    snapshot: input.snapshot,
  }), [])

  const applyRemoteState = useCallback((input: {
    snapshot: OrchestrationRegistrySnapshot
    agents: OrchestrationAgentRegistryEntry[]
    teams: OrchestrationTeamRegistryEntry[]
    graph: OrchestrationGraphResponse
    draftOverride?: OrchestrationBoardDraft | null
  }) => {
    setRegistry(input.snapshot)
    setAgents(input.agents)
    setTeams(input.teams)
    setGraph(input.graph)
    if (surface === "page") {
      setBoardDraft(input.draftOverride ?? buildDraftFromRemoteState({
        snapshot: input.snapshot,
        agents: input.agents,
        teams: input.teams,
      }))
    } else {
      setBoardDraft(null)
    }
  }, [surface, buildDraftFromRemoteState])

  const fetchOrchestrationState = useCallback(async () => {
    const [registryResponse, agentPage, teamPage, graphResponse] = await Promise.all([
      api.orchestrationRegistry(),
      api.orchestrationAgents({ limit: 100 }),
      api.orchestrationTeams({ limit: 100 }),
      api.orchestrationRelationshipGraph(),
    ])
    return {
      snapshot: registryResponse.snapshot,
      agents: agentPage.items,
      teams: teamPage.items,
      graph: graphResponse,
    }
  }, [])

  const load = useCallback(async (options?: { draftOverride?: OrchestrationBoardDraft | null }) => {
    setLoading(true)
    try {
      const remoteState = await fetchOrchestrationState()
      applyRemoteState({
        ...remoteState,
        ...(options?.draftOverride !== undefined ? { draftOverride: options.draftOverride } : {}),
      })
      setError("")
    } catch (err) {
      setError(formatError(err))
    } finally {
      setLoading(false)
    }
  }, [applyRemoteState, fetchOrchestrationState])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!exportTarget) {
      if (agents[0]) setExportTarget(`agent:${agents[0].agentId}`)
      else if (teams[0]) setExportTarget(`team:${teams[0].teamId}`)
    }
  }, [agents, teams, exportTarget])

  useEffect(() => {
    if (surface !== "page") {
      setBoardDraft(null)
      return
    }
    if (!boardDraft && registry) {
      setBoardDraft(buildDraftFromRemoteState({
        snapshot: registry,
        agents,
        teams,
      }))
    }
  }, [surface, boardDraft, registry, agents, teams, buildDraftFromRemoteState])

  useEffect(() => {
    if (surface === "page" && allowEmptySelection && !selectedAgentId && !selectedTeamId) return
    const hasSelectedAgent = Boolean(selectedAgentId && agents.some((agent) => agent.agentId === selectedAgentId))
    const hasSelectedTeam = Boolean(selectedTeamId && teams.some((team) => team.teamId === selectedTeamId))

    if (hasSelectedAgent && selectedTeamId) {
      setSelectedTeamId("")
      return
    }
    if (hasSelectedTeam && selectedAgentId) {
      setSelectedAgentId("")
      return
    }
    if (hasSelectedAgent || hasSelectedTeam) return

    if (agents[0]) {
      setSelectedAgentId(agents[0].agentId)
      if (selectedTeamId) setSelectedTeamId("")
      return
    }
    if (teams[0]) {
      setSelectedTeamId(teams[0].teamId)
      if (selectedAgentId) setSelectedAgentId("")
      return
    }
    if (selectedAgentId) setSelectedAgentId("")
    if (selectedTeamId) setSelectedTeamId("")
  }, [surface, allowEmptySelection, agents, teams, selectedAgentId, selectedTeamId])

  useEffect(() => {
    if (!boardSaveResult) return
    if (boardSaveResult.status !== "stored" && boardSaveResult.status !== "validated") return
    const timeout = window.setTimeout(() => {
      setBoardSaveResult((current) => (
        current?.status === boardSaveResult.status ? null : current
      ))
    }, 2600)
    return () => window.clearTimeout(timeout)
  }, [boardSaveResult])

  const boardView = useMemo(
    () => surface === "page" && boardDraft
      ? buildBoardViewStateFromDraft({
          draft: boardDraft,
          baseAgents: agents,
          baseTeams: teams,
          generatedAt: registry?.generatedAt,
        })
      : null,
    [surface, boardDraft, agents, teams, registry],
  )
  const viewSnapshot = boardView?.snapshot ?? registry
  const viewAgents = boardView?.agents ?? agents
  const viewTeams = boardView?.teams ?? teams
  const selectedAgent = viewAgents.find((agent) => agent.agentId === selectedAgentId) ?? null
  const selectedTeam = viewTeams.find((team) => team.teamId === selectedTeamId) ?? null
  const selectedBoardAgentDraft = boardDraft?.agents.find((agent) => agent.agentId === selectedAgentId) ?? null
  const selectedBoardTeamDraft = boardDraft?.teams.find((team) => team.teamId === selectedTeamId) ?? null
  const hiddenArchivedCount = (viewAgents.filter((agent) => agent.status === "archived").length + viewTeams.filter((team) => team.status === "archived").length)
  const summary = useMemo(() => buildOrchestrationSummary({ snapshot: viewSnapshot, language }), [viewSnapshot, language])
  const graphView = useMemo(() => buildRelationshipGraphView({ graph, agents: viewAgents, teams: viewTeams, language }), [graph, viewAgents, viewTeams, language])
  const previewConfig = selectedAgent?.config ?? selectedTeam?.config ?? null
  const previewWarnings = useMemo(() => buildProfilePreviewWarnings(previewConfig, language), [previewConfig, language])
  const showAdminDiagnostics = adminEnabled && (mode === "admin" || surface === "page")
  const compact = surface === "settings"
  const settingsCapability = useCapability("settings.control")
  const mqttCapability = useCapability("mqtt.broker")
  const entryHref = mode === "advanced" || mode === "admin" ? "/advanced/agents" : "/agents"
  const surfacePolicy = useMemo(
    () => resolveOrchestrationSurfacePolicy({
      surface,
      pathname: location.pathname,
      language,
    }),
    [surface, location.pathname, language],
  )

  useEffect(() => {
    if (surface !== "page") return
    setDashboardTab(resolveDefaultDashboardTab(location.pathname))
  }, [surface, location.pathname])
  const topologyEditorGate = useMemo(
    () => resolveTopologyEditorGate({ surface, settingsCapability, mqttCapability, language }),
    [surface, settingsCapability, mqttCapability, language],
  )
  const policyParityFields = useMemo(
    () => buildOrchestrationPolicyParityFields(language),
    [language],
  )
  const yeonjangProjection = useMemo(
    () => buildYeonjangCapabilityProjection({ agents: viewAgents, mqttCapability, shell, language }),
    [viewAgents, mqttCapability, shell, language],
  )
  const topologyScene = useMemo(
    () => buildOrchestrationTopologyScene({
      snapshot: viewSnapshot,
      graph,
      agents: viewAgents,
      teams: viewTeams,
      language,
      mode: mode === "beginner" ? "beginner" : "advanced",
      yeonjang: yeonjangProjection,
    }),
    [viewSnapshot, graph, viewAgents, viewTeams, language, mode, yeonjangProjection],
  )
  const selectedBoardEntityId = selectedAgentId
    ? `agent:${selectedAgentId}`
    : selectedTeamId
      ? `team:${selectedTeamId}`
      : null
  const boardValidation = useMemo(
    () => boardDraft
      ? validateOrchestrationBoard({
          draft: boardDraft,
          gate: topologyEditorGate,
          language,
        })
      : null,
    [boardDraft, topologyEditorGate, language],
  )
  const boardSavePlan = useMemo(
    () => boardDraft ? buildOrchestrationSavePlan({ draft: boardDraft }) : null,
    [boardDraft],
  )
  const boardProjection = useMemo(
    () => buildOrchestrationBoardProjection({
      snapshot: viewSnapshot,
      agents: viewAgents,
      teams: viewTeams,
      language,
      selectedEntityId: selectedBoardEntityId,
      showArchived,
      validationSnapshot: boardValidation?.snapshot ?? boardDraft?.lastValidation ?? null,
      preserveTeamOrder: surface === "page",
      preserveAgentOrder: surface === "page",
    }),
    [viewSnapshot, viewAgents, viewTeams, language, selectedBoardEntityId, showArchived, boardValidation?.snapshot, boardDraft?.lastValidation, surface],
  )
  const boardDropAvailability = useMemo(() => {
    if (!boardDraft?.dragState) return {} as Record<string, boolean>
    if (boardDraft.dragState.entityType === "agent") {
      const candidateLaneIds = [
        BOARD_CANVAS_LANE_ID,
        BOARD_ARCHIVE_LANE_ID,
        ...boardProjection.lanes.map((lane) => lane.id),
      ]
      return Object.fromEntries(candidateLaneIds.map((laneId) => [
        laneId,
        canDropAgentOnLane({
          draft: boardDraft,
          agentId: boardDraft.dragState!.entityId,
          sourceLaneId: boardDraft.dragState!.sourceLaneId,
          targetLaneId: laneId,
        }),
      ]))
    }
    const candidateLaneIds = [
      BOARD_ARCHIVE_LANE_ID,
      ...boardProjection.lanes.filter((lane) => lane.kind === "team").map((lane) => lane.id),
    ]
    return Object.fromEntries(candidateLaneIds.map((laneId) => [
      laneId,
      canDropTeamOnLane({
        draft: boardDraft,
        teamId: boardDraft.dragState!.entityId,
        sourceLaneId: boardDraft.dragState!.sourceLaneId,
        targetLaneId: laneId,
      }),
    ]))
  }, [boardDraft, boardProjection.lanes])

  useEffect(() => {
    if (!topologyScene.nodes.length) {
      setSelectedTopologyNodeId(null)
      return
    }
    if (selectedTopologyNodeId && topologyScene.nodes.some((node) => node.id === selectedTopologyNodeId)) return
    setSelectedTopologyNodeId(topologyScene.nodes.find((node) => node.status === "warning" || node.status === "error")?.id ?? topologyScene.nodes[0]!.id)
  }, [topologyScene, selectedTopologyNodeId])

  useEffect(() => {
    if (!yeonjangProjection.relations.length) {
      setSelectedTopologyEdgeId(null)
      return
    }
    if (selectedTopologyEdgeId && yeonjangProjection.relations.some((relation) => relation.edgeId === selectedTopologyEdgeId)) return
    setSelectedTopologyEdgeId(
      yeonjangProjection.relations.find((relation) => relation.state !== "approved_to_control")?.edgeId
      ?? yeonjangProjection.relations[0]!.edgeId,
    )
  }, [selectedTopologyEdgeId, yeonjangProjection])

  useEffect(() => {
    if (surface !== "page" || !boardDraft?.selectedNodeId) return
    if (boardDraft.selectedNodeId.startsWith("agent:")) {
      setAllowEmptySelection(false)
      const agentId = boardDraft.selectedNodeId.slice("agent:".length)
      const agent = viewAgents.find((entry) => entry.agentId === agentId)
      if (!agent) return
      setAgentFormFromConfig(agent.config)
      setSelectedAgentId(agent.agentId)
      setSelectedTeamId("")
      return
    }
    if (boardDraft.selectedNodeId.startsWith("team:")) {
      setAllowEmptySelection(false)
      const teamId = boardDraft.selectedNodeId.slice("team:".length)
      const team = viewTeams.find((entry) => entry.teamId === teamId)
      if (!team) return
      setTeamFormFromConfig(team.config)
      setSelectedTeamId(team.teamId)
      setSelectedAgentId("")
    }
  }, [surface, boardDraft?.selectedNodeId, viewAgents, viewTeams])

  const topologyInspector = useMemo(
    () => buildOrchestrationTopologyInspector({
      selectedNodeId: selectedTopologyNodeId,
      selectedEdgeId: selectedTopologyEdgeId,
      relations: yeonjangProjection.relations,
      runtime: yeonjangProjection.runtime,
      gate: topologyEditorGate,
      language,
    }),
    [selectedTopologyNodeId, selectedTopologyEdgeId, yeonjangProjection, topologyEditorGate, language],
  )
  const quickEditIssues = useMemo(
    () => selectedBoardAgentDraft
      ? findValidationIssuesForAgent(boardValidation?.snapshot ?? boardDraft?.lastValidation, selectedBoardAgentDraft.agentId)
        .map((issue) => ({
          severity: issue.severity === "error" ? "error" : "warning",
          message: issue.message,
          ...(issue.field ? { field: issue.field } : {}),
          category: issue.category,
        }))
      : selectedBoardTeamDraft
        ? findValidationIssuesForTeam(boardValidation?.snapshot ?? boardDraft?.lastValidation, selectedBoardTeamDraft.teamId)
          .map((issue) => ({
            severity: issue.severity === "error" ? "error" : "warning",
            message: issue.message,
            ...(issue.field ? { field: issue.field } : {}),
            category: issue.category,
          }))
        : [],
    [selectedBoardAgentDraft, selectedBoardTeamDraft, boardDraft?.lastValidation, boardValidation?.snapshot],
  )
  const quickEditSheet = surface !== "page"
    ? null
    : selectedBoardAgentDraft
      ? (
          <OrchestrationQuickEditSheet
            language={language}
            editingLocked={!topologyEditorGate.canEdit}
            onRequestKeyboardMove={handleOpenKeyboardMoveDialog}
            selection={{
              kind: "agent",
              agent: selectedBoardAgentDraft,
              runtimeAgent: selectedAgent,
              teamLabels: selectedBoardAgentDraft.config.teamIds.map((teamId) =>
                boardDraft?.teams.find((team) => team.teamId === teamId)?.config.displayName ?? teamId),
              issues: quickEditIssues,
              onPatch: handlePatchBoardAgent,
            }}
          />
        )
      : selectedBoardTeamDraft
        ? (
            <OrchestrationQuickEditSheet
              language={language}
              editingLocked={!topologyEditorGate.canEdit}
            selection={{
              kind: "team",
              team: selectedBoardTeamDraft,
              issues: quickEditIssues,
              onPatch: handlePatchBoardTeam,
            }}
            onRequestCreateAgentInTeam={handlePrepareAgentForTeam}
          />
        )
        : <OrchestrationQuickEditSheet language={language} editingLocked={!topologyEditorGate.canEdit} selection={null} />
  const dashboardFallback = useMemo(
    () => buildOrchestrationDashboardFallback({
      snapshot: viewSnapshot,
      graphView,
      summary,
      language,
    }),
    [viewSnapshot, graphView, summary, language],
  )
  const dashboardActivityItems = useMemo(
    () => buildOrchestrationDashboardActivityItems({
      agents: viewAgents,
      summary,
      boardProjection,
      graphView,
      yeonjangProjection,
      language,
    }),
    [viewAgents, summary, boardProjection, graphView, yeonjangProjection, language],
  )
  const filteredDashboardActivityItems = useMemo(
    () => dashboardTab === "approvals"
      ? filterOrchestrationDashboardActivityItems(dashboardActivityItems, "approvals")
      : filterOrchestrationDashboardActivityItems(dashboardActivityItems, "activity"),
    [dashboardActivityItems, dashboardTab],
  )
  const dashboardInspector = useMemo(
    () => buildOrchestrationDashboardInspector({
      selectedAgent,
      selectedTeam,
      boardProjection,
      topologyInspector,
      summary,
      language,
    }),
    [selectedAgent, selectedTeam, boardProjection, topologyInspector, summary, language],
  )
  const dashboardSelectedLabel = selectedAgent?.displayName
    ?? selectedTeam?.displayName
    ?? displayText(dashboardInspector.title)
  const keyboardMoveSourceOptions = useMemo(() => {
    if (!selectedBoardAgentDraft) return []
    const lanes = boardProjection.lanes.filter((lane) => lane.cards.some((card) => card.agentId === selectedBoardAgentDraft.agentId))
    if (lanes.length > 0) {
      return lanes.map((lane) => ({
        laneId: lane.id,
        label: lane.displayName,
        description: lane.description,
      }))
    }
    return [{
      laneId: BOARD_UNASSIGNED_LANE_ID,
      label: text("미배치", "Unassigned"),
      description: text("현재 미배치 영역에서 시작합니다.", "The current source is the unassigned lane."),
    }]
  }, [selectedBoardAgentDraft, boardProjection.lanes, text])
  const keyboardMoveTargetOptions = useMemo(() => {
    const base = boardProjection.lanes.map((lane) => ({
      laneId: lane.id,
      label: lane.displayName,
      description: lane.description,
    }))
    return [
      ...base,
      {
        laneId: BOARD_CANVAS_LANE_ID,
        label: text("새 팀 생성", "Create new team"),
        description: text("canvas drop target과 같은 의미로 새 disabled 팀 lane을 준비합니다.", "Matches the canvas drop target and prepares a new disabled team lane."),
      },
      {
        laneId: BOARD_ARCHIVE_LANE_ID,
        label: text("보관", "Archive"),
        description: text("현재 소속을 정리하고 agent를 archived 상태로 보냅니다.", "Clears the current membership and moves the agent into archived state."),
      },
    ]
  }, [boardProjection.lanes, text])

  useEffect(() => {
    if (!selectedBoardAgentDraft) {
      setKeyboardMoveOpen(false)
      return
    }
    const inferredSourceLaneId = boardDraft
      ? inferAgentSourceLaneId(boardDraft, selectedBoardAgentDraft.agentId)
      : keyboardMoveSourceOptions[0]?.laneId ?? BOARD_UNASSIGNED_LANE_ID
    setKeyboardMoveSourceLaneId(inferredSourceLaneId)
    setKeyboardMoveTargetLaneId((current) => (
      current && current !== inferredSourceLaneId
        ? current
        : keyboardMoveTargetOptions.find((option) => option.laneId !== inferredSourceLaneId)?.laneId ?? inferredSourceLaneId
    ))
  }, [selectedBoardAgentDraft, boardDraft, keyboardMoveSourceOptions, keyboardMoveTargetOptions])

  useEffect(() => {
    setLegacySurfaceOpen(surfacePolicy.legacySurfaceDefaultOpen)
    setActiveLegacyToolId(surfacePolicy.defaultLegacyToolId)
  }, [surfacePolicy.id, surfacePolicy.legacySurfaceDefaultOpen, surfacePolicy.defaultLegacyToolId])

  function handleSelectTopologyNode(nodeId: string) {
    setSelectedTopologyNodeId(nodeId)
    const relation = yeonjangProjection.relations.find((item) => item.nodeId === nodeId)
    if (relation) {
      setSelectedTopologyEdgeId(relation.edgeId)
      return
    }
    if (nodeId === yeonjangProjection.hubNode.id) {
      setSelectedTopologyEdgeId(null)
    }
  }

  function guardTopologyWrite() {
    if (topologyEditorGate.canEdit) return false
    setActionError(topologyEditorGate.message)
    return true
  }

  function patchAgentForm(patch: Partial<AgentFormState>) {
    setAgentForm((current) => ({ ...current, ...patch }))
  }

  function patchTeamForm(patch: Partial<TeamFormState>) {
    setTeamForm((current) => ({ ...current, ...patch }))
  }

  function setAgentFormFromConfig(config: AgentConfig | SubAgentConfig) {
    setAgentForm({
      agentId: config.agentId,
      displayName: config.displayName,
      nickname: config.nickname ?? "",
      role: config.role,
      personality: config.personality,
      specialtyTags: formatCommaList(config.specialtyTags),
      avoidTasks: formatCommaList(config.avoidTasks),
      teamIds: formatCommaList("teamIds" in config ? config.teamIds : []),
      riskCeiling: config.capabilityPolicy.permissionProfile.riskCeiling,
      allowExternalNetwork: config.capabilityPolicy.permissionProfile.allowExternalNetwork,
      allowFilesystemWrite: config.capabilityPolicy.permissionProfile.allowFilesystemWrite,
      allowShellExecution: config.capabilityPolicy.permissionProfile.allowShellExecution,
      allowScreenControl: config.capabilityPolicy.permissionProfile.allowScreenControl,
      allowedPaths: formatCommaList(config.capabilityPolicy.permissionProfile.allowedPaths),
      enabledSkillIds: formatCommaList(config.capabilityPolicy.skillMcpAllowlist.enabledSkillIds),
      enabledMcpServerIds: formatCommaList(config.capabilityPolicy.skillMcpAllowlist.enabledMcpServerIds),
      enabledToolNames: formatCommaList(config.capabilityPolicy.skillMcpAllowlist.enabledToolNames),
    })
  }

  function setTeamFormFromConfig(config: TeamConfig) {
    setTeamForm({
      teamId: config.teamId,
      displayName: config.displayName,
      nickname: config.nickname ?? "",
      purpose: config.purpose,
      memberAgentIds: formatCommaList(config.memberAgentIds),
      roleHints: formatCommaList(config.roleHints),
    })
  }

  function fillAgentFromSelected(agent: OrchestrationAgentRegistryEntry) {
    setAllowEmptySelection(false)
    const config = agent.config
    setAgentFormFromConfig(config)
    setSelectedAgentId(agent.agentId)
    setSelectedTeamId("")
  }

  function fillTeamFromSelected(team: OrchestrationTeamRegistryEntry) {
    setAllowEmptySelection(false)
    const config = team.config
    setTeamFormFromConfig(config)
    setSelectedTeamId(team.teamId)
    setSelectedAgentId("")
  }

  function handleBoardSelectAgent(agentId: string) {
    if (suppressBoardSelectionRef.current === `agent:${agentId}`) {
      suppressBoardSelectionRef.current = null
      return
    }
    setAllowEmptySelection(false)
    const agent = viewAgents.find((entry) => entry.agentId === agentId)
    if (!agent) return
    fillAgentFromSelected(agent)
    setBoardDraft((current) => current ? { ...current, selectedNodeId: `agent:${agentId}` } : current)
    setSelectedTopologyNodeId(`node:orchestration:agent:${agentId}`)
    setSelectedTopologyEdgeId(null)
  }

  function handleBoardSelectTeam(teamId: string) {
    if (suppressBoardSelectionRef.current === `team:${teamId}`) {
      suppressBoardSelectionRef.current = null
      return
    }
    setAllowEmptySelection(false)
    const team = viewTeams.find((entry) => entry.teamId === teamId)
    if (!team) return
    fillTeamFromSelected(team)
    setBoardDraft((current) => current ? { ...current, selectedNodeId: `team:${teamId}` } : current)
    setSelectedTopologyNodeId(`node:orchestration:team:${teamId}`)
    setSelectedTopologyEdgeId(null)
  }

  function handleBoardDragStart(agentId: string, sourceLaneId: string) {
    if (!topologyEditorGate.canEdit) return
    setBoardDraft((current) => current ? {
      ...current,
      dragState: beginBoardDrag(agentId, sourceLaneId),
      pendingDrop: null,
      selectedNodeId: `agent:${agentId}`,
    } : current)
  }

  function handleBoardTeamDragStart(teamId: string, sourceLaneId: string) {
    if (!topologyEditorGate.canEdit) return
    setBoardDraft((current) => current ? {
      ...current,
      dragState: beginBoardTeamDrag(teamId, sourceLaneId),
      pendingDrop: null,
      selectedNodeId: `team:${teamId}`,
    } : current)
  }

  function handleBoardDragMouseDown(event: ReactMouseEvent<HTMLElement>, agentId: string, sourceLaneId: string) {
    if (!topologyEditorGate.canEdit) return
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    boardMouseDragCandidateRef.current = {
      entityType: "agent",
      entityId: agentId,
      sourceLaneId,
      startX: event.clientX,
      startY: event.clientY,
    }
  }

  function handleBoardTeamDragMouseDown(event: ReactMouseEvent<HTMLElement>, teamId: string, sourceLaneId: string) {
    if (!topologyEditorGate.canEdit) return
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    boardMouseDragCandidateRef.current = {
      entityType: "team",
      entityId: teamId,
      sourceLaneId,
      startX: event.clientX,
      startY: event.clientY,
    }
  }

  function handleBoardDrop(
    laneId: string,
    fallbackDrag?: {
      entityType: "agent" | "team"
      entityId: string
      sourceLaneId: string
    } | null,
  ) {
    if (!topologyEditorGate.canEdit) return
    if (laneId === BOARD_ARCHIVE_LANE_ID) setShowArchived(true)
    setBoardDraft((current) => {
      if (!current) return current
      const activeDrag = current.dragState ?? (fallbackDrag
        ? {
            entityType: fallbackDrag.entityType,
            entityId: fallbackDrag.entityId,
            sourceLaneId: fallbackDrag.sourceLaneId,
            overLaneId: laneId,
            phase: "dragging" as const,
          }
        : null)
      if (!activeDrag) return current
      if (activeDrag.entityType === "team") {
        if (!canDropTeamOnLane({
          draft: current,
          teamId: activeDrag.entityId,
          sourceLaneId: activeDrag.sourceLaneId,
          targetLaneId: laneId,
        })) {
          return {
            ...current,
            dragState: null,
            pendingDrop: null,
          }
        }
        if (laneId === BOARD_ARCHIVE_LANE_ID) {
          return patchBoardTeamDraft({
            draft: {
              ...current,
              dragState: null,
              pendingDrop: null,
            },
            teamId: activeDrag.entityId,
            patch: { status: "archived" },
          })
        }
        const targetTeamId = laneId.startsWith("lane:team:") ? laneId.slice("lane:team:".length) : null
        if (!targetTeamId || targetTeamId === activeDrag.entityId) {
          return {
            ...current,
            dragState: null,
            pendingDrop: null,
          }
        }
        const sourceIndex = current.teams.findIndex((team) => team.teamId === activeDrag.entityId)
        const targetIndex = current.teams.findIndex((team) => team.teamId === targetTeamId)
        if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) {
          return {
            ...current,
            dragState: null,
            pendingDrop: null,
          }
        }
        const reorderedTeams = [...current.teams]
        const [movedTeam] = reorderedTeams.splice(sourceIndex, 1)
        if (!movedTeam) return current
        reorderedTeams.splice(targetIndex, 0, movedTeam)
        return reconcileOrchestrationBoardDraft({
          draft: {
            ...current,
            teams: reorderedTeams,
            dragState: null,
            pendingDrop: null,
          },
          teams: reorderedTeams,
          memberships: current.memberships,
          selectedNodeId: `team:${movedTeam.teamId}`,
        })
      }
      if (!canDropAgentOnLane({
        draft: current,
        agentId: activeDrag.entityId,
        sourceLaneId: activeDrag.sourceLaneId,
        targetLaneId: laneId,
      })) {
        return {
          ...current,
          dragState: null,
          pendingDrop: null,
        }
      }
      const sourceTeamId = activeDrag.sourceLaneId?.startsWith("lane:team:")
        ? activeDrag.sourceLaneId.slice("lane:team:".length)
        : null
      const targetTeamId = laneId.startsWith("lane:team:")
        ? laneId.slice("lane:team:".length)
        : null

      if (laneId === BOARD_ARCHIVE_LANE_ID) {
        return reduceOrchestrationBoardDraft({
          ...current,
          dragState: null,
          pendingDrop: null,
        }, {
          type: "archive_agent",
          agentId: activeDrag.entityId,
        })
      }

      if (laneId === BOARD_UNASSIGNED_LANE_ID) {
        return reduceOrchestrationBoardDraft({
          ...current,
          dragState: null,
          pendingDrop: null,
        }, {
          type: "unassign",
          agentId: activeDrag.entityId,
          sourceTeamId,
        })
      }

      if (laneId === BOARD_CANVAS_LANE_ID) {
        return reduceOrchestrationBoardDraft({
          ...current,
          dragState: null,
          pendingDrop: null,
        }, {
          type: "create_team_and_add",
          agentId: activeDrag.entityId,
          language,
        })
      }

      if (targetTeamId) {
        return reduceOrchestrationBoardDraft({
          ...current,
          dragState: null,
          pendingDrop: null,
        }, sourceTeamId
          ? {
              type: "move_to_team",
              agentId: activeDrag.entityId,
              sourceTeamId,
              targetTeamId,
            }
          : {
              type: "add_to_team",
              agentId: activeDrag.entityId,
              targetTeamId,
            })
      }

      return {
        ...current,
        dragState: null,
        pendingDrop: null,
      }
    })
  }

  function handleBoardDragEnd() {
    setBoardDraft((current) => current ? {
      ...current,
      dragState: current.pendingDrop ? current.dragState : null,
    } : current)
  }

  function resolveHoveredBoardLaneId(clientX: number, clientY: number): string | null {
    const hovered = document.elementFromPoint(clientX, clientY)
    if (!hovered) return null
    const dropZone = hovered.closest("[data-orchestration-drop-zone]")
    if (dropZone) return dropZone.getAttribute("data-orchestration-drop-zone")
    const lane = hovered.closest("[data-orchestration-board-lane]")
    return lane?.getAttribute("data-orchestration-board-lane") ?? null
  }

  function handleChooseDropOption(optionId: PendingDropActionOption["id"]) {
    setBoardSaveResult(null)
    setBoardDraft((current) => {
      if (!current?.pendingDrop) return current
      const reducerAction = resolveReducerActionFromPendingDrop({
        pendingDrop: current.pendingDrop,
        optionId,
        language,
      })
      return reduceOrchestrationBoardDraft(current, reducerAction)
    })
  }

  function handleToggleShowArchived() {
    setShowArchived((current) => !current)
  }

  function handleDashboardTabChange(tab: OrchestrationDashboardTab) {
    setDashboardTab(tab)
    setDragPanOrigin(null)
  }

  function handleViewportMouseDown(event: ReactMouseEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    const target = event.target as HTMLElement | null
    if (target?.closest("[data-orchestration-map-node-draggable='true']")) return
    if (target?.closest("[data-orchestration-board-lane-draggable='true']")) return
    if (target?.closest("[data-orchestration-map-toolbar]")) return
    setDragPanOrigin({ x: event.clientX, y: event.clientY })
  }

  function handleViewportMouseMove(event: ReactMouseEvent<HTMLDivElement>) {
    if (!dragPanOrigin) return
    setViewport((current) => panOrchestrationViewport(current, {
      x: event.clientX - dragPanOrigin.x,
      y: event.clientY - dragPanOrigin.y,
    }))
    setDragPanOrigin({ x: event.clientX, y: event.clientY })
  }

  function handleViewportMouseUp() {
    setDragPanOrigin(null)
  }

  function handleViewportWheel(event: ReactWheelEvent<HTMLDivElement>) {
    event.preventDefault()
    setViewport((current) => zoomOrchestrationViewport(current, event.deltaY < 0 ? "in" : "out"))
  }

  function handleFitAllViewport() {
    setViewport(fitAllOrchestrationViewport())
  }

  function handleFitSelectionViewport() {
    const selection = selectedAgentId
      ? { kind: "agent" as const, id: selectedAgentId }
      : selectedTeamId
        ? { kind: "team" as const, id: selectedTeamId }
        : null
    setViewport(fitSelectionOrchestrationViewport(selection))
  }

  function handleResetViewport() {
    setViewport(createDefaultOrchestrationViewportState())
  }

  function handleCloseQuickEditSheet() {
    setAllowEmptySelection(true)
    setSelectedAgentId("")
    setSelectedTeamId("")
    setKeyboardMoveOpen(false)
    setBoardDraft((current) => current ? { ...current, selectedNodeId: null } : current)
  }

  function handlePrepareAgentForTeam(teamId: string | null) {
    if (!teamId) {
      setAllowEmptySelection(true)
      setSelectedAgentId("")
      setSelectedTeamId("")
      setBoardDraft((current) => current ? { ...current, selectedNodeId: null } : current)
      return
    }
    handleBoardSelectTeam(teamId)
  }

  function handleOpenKeyboardMoveDialog() {
    if (!selectedBoardAgentDraft || !boardDraft) return
    setKeyboardMoveSourceLaneId(inferAgentSourceLaneId(boardDraft, selectedBoardAgentDraft.agentId))
    setKeyboardMoveTargetLaneId(
      keyboardMoveTargetOptions.find((option) => option.laneId !== inferAgentSourceLaneId(boardDraft, selectedBoardAgentDraft.agentId))?.laneId
      ?? BOARD_UNASSIGNED_LANE_ID,
    )
    setKeyboardMoveOpen(true)
  }

  function handleConfirmKeyboardMove() {
    if (!selectedBoardAgentDraft || !boardDraft) return
    const pendingDrop = buildPendingDropAction({
      draft: boardDraft,
      agentId: selectedBoardAgentDraft.agentId,
      sourceLaneId: keyboardMoveSourceLaneId,
      targetLaneId: keyboardMoveTargetLaneId,
      language,
    })
    if (!pendingDrop) {
      setKeyboardMoveOpen(false)
      return
    }
    setBoardDraft((current) => current ? {
      ...current,
      dragState: {
        ...beginBoardDrag(selectedBoardAgentDraft.agentId, keyboardMoveSourceLaneId),
        overLaneId: keyboardMoveTargetLaneId,
        phase: "pending_drop",
      },
      pendingDrop,
    } : current)
    setKeyboardMoveOpen(false)
  }

  function handleRevertBoardDraft() {
    if (surface !== "page" || !registry) return
    setBoardSaveResult(null)
    setBoardDraft(buildDraftFromRemoteState({
      snapshot: registry,
      agents,
      teams,
    }))
  }

  function handleQuickCreateTeam() {
    if (!topologyEditorGate.canEdit) return
    setBoardSaveResult(null)
    setBoardDraft((current) => {
      if (!current) return current
      const created = createBoardTeamDraft({
        draft: current,
        displayName: "",
      })
      const createdTeamId = created.selectedNodeId?.startsWith("team:")
        ? created.selectedNodeId.slice("team:".length)
        : created.teams[created.teams.length - 1]?.teamId
      if (!createdTeamId) return created
      return patchBoardTeamDraft({
        draft: created,
        teamId: createdTeamId,
        patch: {
          purpose: "",
        },
      })
    })
  }

  function handleQuickCreateAgent() {
    if (!topologyEditorGate.canEdit) return
    setBoardSaveResult(null)
    setBoardDraft((current) => {
      if (!current) return current
      const created = createBoardAgentDraft({
        draft: current,
        displayName: "",
      })
      const createdAgentId = created.selectedNodeId?.startsWith("agent:")
        ? created.selectedNodeId.slice("agent:".length)
        : created.agents[created.agents.length - 1]?.agentId
      if (!createdAgentId) return created
      const assigned = selectedTeamId && created.teams.some((team) => team.teamId === selectedTeamId)
        ? reduceOrchestrationBoardDraft(created, {
            type: "add_to_team",
            agentId: createdAgentId,
            targetTeamId: selectedTeamId,
          })
        : created
      return patchBoardAgentDraft({
        draft: assigned,
        agentId: createdAgentId,
        patch: {
          role: "",
          personality: "",
        },
      })
    })
  }

  useEffect(() => {
    if (surface !== "page") return

    function clearBoardPointerDragSession() {
      boardMouseDragCandidateRef.current = null
      boardPointerDragActiveRef.current = false
      document.body.style.removeProperty("user-select")
      document.body.style.removeProperty("cursor")
    }

    function handleWindowMouseMove(event: MouseEvent) {
      const candidate = boardMouseDragCandidateRef.current
      if (!candidate) return
      const distance = Math.hypot(event.clientX - candidate.startX, event.clientY - candidate.startY)
      if (!boardPointerDragActiveRef.current) {
        if (distance < 6) return
        boardPointerDragActiveRef.current = true
        suppressBoardSelectionRef.current = `${candidate.entityType}:${candidate.entityId}`
        document.body.style.setProperty("user-select", "none")
        document.body.style.setProperty("cursor", "grabbing")
        if (candidate.entityType === "agent") handleBoardDragStart(candidate.entityId, candidate.sourceLaneId)
        else handleBoardTeamDragStart(candidate.entityId, candidate.sourceLaneId)
      }
      if (event.cancelable) event.preventDefault()
      const overLaneId = resolveHoveredBoardLaneId(event.clientX, event.clientY)
      setBoardDraft((current) => {
        if (!current?.dragState) return current
        if ((current.dragState.overLaneId ?? null) === (overLaneId ?? null)) return current
        return {
          ...current,
          dragState: updateBoardDragTarget(current.dragState, overLaneId),
        }
      })
    }

    function handleWindowMouseUp(event: MouseEvent) {
      const candidate = boardMouseDragCandidateRef.current
      if (!candidate) return
      const activeDrag = boardPointerDragActiveRef.current
      clearBoardPointerDragSession()
      if (!activeDrag) return
      if (event.cancelable) event.preventDefault()
      const overLaneId = resolveHoveredBoardLaneId(event.clientX, event.clientY)
      if (overLaneId) {
        handleBoardDrop(overLaneId, candidate)
        return
      }
      handleBoardDragEnd()
    }

    window.addEventListener("mousemove", handleWindowMouseMove, { passive: false })
    window.addEventListener("mouseup", handleWindowMouseUp, { passive: false })
    return () => {
      window.removeEventListener("mousemove", handleWindowMouseMove)
      window.removeEventListener("mouseup", handleWindowMouseUp)
      clearBoardPointerDragSession()
    }
  }, [surface, topologyEditorGate.canEdit, handleBoardDragStart, handleBoardTeamDragStart, handleBoardDrop, handleBoardDragEnd])

  function handlePatchBoardAgent(patch: Parameters<typeof patchBoardAgentDraft>[0]["patch"]) {
    if (!topologyEditorGate.canEdit) return
    if (patch.status === "archived") setShowArchived(true)
    setBoardSaveResult(null)
    setBoardDraft((current) => {
      if (!current || !selectedAgentId) return current
      return patchBoardAgentDraft({
        draft: current,
        agentId: selectedAgentId,
        patch,
      })
    })
  }

  function handlePatchBoardTeam(patch: Parameters<typeof patchBoardTeamDraft>[0]["patch"]) {
    if (!topologyEditorGate.canEdit) return
    if (patch.status === "archived") setShowArchived(true)
    setBoardSaveResult(null)
    setBoardDraft((current) => {
      if (!current || !selectedTeamId) return current
      return patchBoardTeamDraft({
        draft: current,
        teamId: selectedTeamId,
        patch,
      })
    })
  }

  function handleArchiveBoardTeam(teamId: string) {
    if (!topologyEditorGate.canEdit) return
    setShowArchived(true)
    setBoardSaveResult(null)
    setAllowEmptySelection(false)
    setSelectedAgentId("")
    setSelectedTeamId(teamId)
    setBoardDraft((current) => current
      ? patchBoardTeamDraft({
          draft: current,
          teamId,
          patch: { status: "archived" },
        })
      : current)
  }

  function applyBoardValidationSnapshot(snapshot: NonNullable<typeof boardValidation>["snapshot"]) {
    setBoardDraft((current) => current ? { ...current, lastValidation: snapshot } : current)
  }

  async function runBoardPreflight(currentDraft: OrchestrationBoardDraft) {
    const validation = validateOrchestrationBoard({
      draft: currentDraft,
      gate: topologyEditorGate,
      language,
    })
    applyBoardValidationSnapshot(validation.snapshot)
    if (validation.summary.blocking) {
      return {
        ok: false as const,
        validation,
        plan: buildOrchestrationSavePlan({ draft: currentDraft }),
        entities: validation.snapshot.issues.map((issue) => ({
          key: `${issue.targetType}:${issue.targetId}`,
          targetType: issue.targetType === "team" ? "team" as const : "agent" as const,
          targetId: issue.targetId,
          phase: "preflight" as const,
          status: issue.severity === "error" ? "failed" as const : "skipped" as const,
          message: issue.message,
        })),
      }
    }

    const plan = buildOrchestrationSavePlan({ draft: currentDraft })
    const entities: OrchestrationSaveResultState["entities"] = []
    const effects: string[] = []

    for (const instruction of plan.instructions) {
      try {
        const result = await executeBoardInstruction(instruction, true)
        entities.push({
          key: instruction.key,
          targetType: instruction.targetType,
          targetId: instruction.targetId,
          phase: "preflight",
          status: "succeeded",
          message: result.effectSummary.join(" | ") || "validated",
        })
        effects.push(...result.effectSummary)
      } catch (error) {
        entities.push({
          key: instruction.key,
          targetType: instruction.targetType,
          targetId: instruction.targetId,
          phase: "preflight",
          status: "failed",
          message: formatError(error),
        })
        return {
          ok: false as const,
          validation,
          plan,
          entities,
        }
      }
    }

    return {
      ok: true as const,
      validation,
      plan,
      entities,
      effects,
    }
  }

  async function validateBoard() {
    if (guardTopologyWrite() || !boardDraft) return
    setActionError("")
    setBoardSaveRunning(true)
    setBoardSaveResult({
      status: "running",
      summary: text("보드 preflight 검증 중...", "Running board preflight validation..."),
      effects: [],
      entities: [],
    })
    try {
      const preflight = await runBoardPreflight(boardDraft)
      if (!preflight.ok) {
        setBoardSaveResult({
          status: "blocked",
          summary: text("보드 검증에서 차단되는 오류가 발견되었습니다.", "Board validation found blocking issues."),
          effects: [],
          entities: preflight.entities,
          remainingInstructionKeys: preflight.plan.instructions.map((instruction) => instruction.key),
          recommendedActions: [
            text("Review blocking issues", "Review blocking issues"),
            text("Validate again", "Validate again"),
          ],
        })
        return
      }
      setBoardSaveResult({
        status: "validated",
        summary: text("보드 preflight 검증이 통과했습니다.", "Board preflight validation passed."),
        effects: preflight.effects,
        entities: preflight.entities,
        recommendedActions: [text("Save draft", "Save draft")],
      })
    } catch (error) {
      setBoardSaveResult({
        status: "blocked",
        summary: text("보드 검증 중 오류가 발생했습니다.", "Board validation failed."),
        effects: [],
        entities: [{
          key: "board:validate",
          targetType: "agent",
          targetId: "board",
          phase: "preflight",
          status: "failed",
          message: formatError(error),
        }],
        recommendedActions: [
          text("Review validation error", "Review validation error"),
          text("Validate again", "Validate again"),
        ],
      })
    } finally {
      setBoardSaveRunning(false)
    }
  }

  async function saveBoard() {
    if (guardTopologyWrite() || !boardDraft) return
    setActionError("")
    setBoardSaveRunning(true)
    setBoardSaveResult({
      status: "running",
      summary: text("보드 저장 preflight를 준비 중입니다.", "Preparing board save preflight."),
      effects: [],
      entities: [],
    })
    try {
      const currentDraft = boardDraft
      const preflight = await runBoardPreflight(currentDraft)
      if (!preflight.ok) {
        setBoardSaveResult({
          status: "blocked",
          summary: text("저장 전에 해결해야 할 오류가 있습니다.", "There are blocking issues to resolve before save."),
          effects: [],
          entities: preflight.entities,
          remainingInstructionKeys: preflight.plan.instructions.map((instruction) => instruction.key),
          recommendedActions: [
            text("Review blocking issues", "Review blocking issues"),
            text("Validate again", "Validate again"),
          ],
        })
        return
      }

      const persistEntities: OrchestrationSaveResultState["entities"] = [...preflight.entities]
      const persistEffects = [...preflight.effects]
      let firstFailedKey: string | null = null

      for (const instruction of preflight.plan.instructions) {
        try {
          const result = await executeBoardInstruction(instruction, false)
          persistEntities.push({
            key: instruction.key,
            targetType: instruction.targetType,
            targetId: instruction.targetId,
            phase: "persist",
            status: "succeeded",
            message: result.effectSummary.join(" | ") || "stored",
          })
          persistEffects.push(...result.effectSummary)
        } catch (error) {
          firstFailedKey = instruction.key
          persistEntities.push({
            key: instruction.key,
            targetType: instruction.targetType,
            targetId: instruction.targetId,
            phase: "persist",
            status: "failed",
            message: formatError(error),
          })
          break
        }
      }

      const remoteState = await fetchOrchestrationState()
      if (firstFailedKey) {
        const remainingInstructionKeys = summarizeRemainingInstructionKeys({
          plan: preflight.plan,
          firstUnstoredKey: firstFailedKey,
        })
        const pendingRetryKeys = remainingInstructionKeys.filter((key) => key !== firstFailedKey)
        for (const key of pendingRetryKeys) {
          const [targetType, ...idParts] = key.split(":")
          persistEntities.push({
            key,
            targetType: targetType === "team" ? "team" : "agent",
            targetId: idParts.join(":"),
            phase: "persist",
            status: "skipped",
            message: text("pending retry after first failure", "pending retry after first failure"),
          })
        }
        const mergedDraft = mergeBoardDraftWithRemoteState({
          currentDraft,
          remoteSnapshot: remoteState.snapshot,
          remoteAgents: remoteState.agents,
          remoteTeams: remoteState.teams,
          remainingInstructionKeys,
          validationSnapshot: preflight.validation.snapshot,
          selectedNodeId: currentDraft.selectedNodeId,
        })
        applyRemoteState({
          ...remoteState,
          draftOverride: mergedDraft,
        })
        setBoardSaveResult({
          status: "partial",
          summary: text("일부 항목만 저장되었습니다. 실패한 항목은 보드에 남겨 다시 시도할 수 있습니다.", "Only part of the board was stored. Failed entries remain on the board for retry."),
          effects: persistEffects,
          entities: persistEntities,
          remainingInstructionKeys: pendingRetryKeys,
          recommendedActions: [
            text("Retry save draft", "Retry save draft"),
            text("Review failed items", "Review failed items"),
            text("Keep merged draft", "Keep merged draft"),
          ],
        })
        return
      }

      const reloadedDraft = createOrchestrationBoardDraft({
        agents: remoteState.agents
          .map((agent) => agent.config)
          .filter((config): config is SubAgentConfig => config.agentType === "sub_agent"),
        teams: remoteState.teams.map((team) => team.config),
        snapshot: remoteState.snapshot,
        selectedNodeId: resolveSelectedNodeIdAfterReload(currentDraft.selectedNodeId, remoteState.agents, remoteState.teams),
        lastValidation: preflight.validation.snapshot,
      })
      applyRemoteState({
        ...remoteState,
        draftOverride: reloadedDraft,
      })
      setBoardSaveResult({
        status: "stored",
        summary: text("보드가 validation -> ordered persist -> reload 순서로 저장되었습니다.", "The board completed validation -> ordered persist -> reload."),
        effects: persistEffects,
        entities: persistEntities,
        recommendedActions: [text("Continue editing", "Continue editing")],
      })
    } catch (error) {
      setBoardSaveResult({
        status: "blocked",
        summary: text("보드 저장 중 오류가 발생했습니다.", "Board save failed."),
        effects: [],
        entities: [{
          key: "board:save",
          targetType: "agent",
          targetId: "board",
          phase: "persist",
          status: "failed",
          message: formatError(error),
        }],
        recommendedActions: [
          text("Review save error", "Review save error"),
          text("Retry save draft", "Retry save draft"),
        ],
      })
    } finally {
      setBoardSaveRunning(false)
    }
  }

  function buildAgentConfig(): SubAgentConfig {
    const existing = viewAgents.find((agent) => agent.agentId === agentForm.agentId.trim())?.config
    return createSubAgentConfig({
      agentId: agentForm.agentId,
      displayName: agentForm.displayName,
      nickname: agentForm.nickname,
      role: agentForm.role,
      personality: agentForm.personality,
      specialtyTags: parseCommaList(agentForm.specialtyTags),
      avoidTasks: parseCommaList(agentForm.avoidTasks),
      teamIds: parseCommaList(agentForm.teamIds),
      riskCeiling: agentForm.riskCeiling,
      allowExternalNetwork: agentForm.allowExternalNetwork,
      allowFilesystemWrite: agentForm.allowFilesystemWrite,
      allowShellExecution: agentForm.allowShellExecution,
      allowScreenControl: agentForm.allowScreenControl,
      allowedPaths: parseCommaList(agentForm.allowedPaths),
      enabledSkillIds: parseCommaList(agentForm.enabledSkillIds),
      enabledMcpServerIds: parseCommaList(agentForm.enabledMcpServerIds),
      enabledToolNames: parseCommaList(agentForm.enabledToolNames),
      existing: existing && existing.agentType === "sub_agent" ? existing : undefined,
    })
  }

  function buildTeamConfig(): TeamConfig {
    const existing = viewTeams.find((team) => team.teamId === teamForm.teamId.trim())?.config
    return createTeamConfig({
      teamId: teamForm.teamId,
      displayName: teamForm.displayName,
      nickname: teamForm.nickname,
      purpose: teamForm.purpose,
      memberAgentIds: parseCommaList(teamForm.memberAgentIds),
      roleHints: parseCommaList(teamForm.roleHints),
      existing,
    })
  }

  async function validateAgent() {
    if (guardTopologyWrite()) return
    setActionError("")
    try {
      const config = buildAgentConfig()
      const result = await api.upsertOrchestrationAgent(config.agentId, config, { validationOnly: true, idempotencyKey: `webui:agent:validate:${config.agentId}` })
      setAgentResult(result)
    } catch (err) {
      setActionError(formatError(err))
    }
  }

  async function saveAgent() {
    if (guardTopologyWrite()) return
    setActionError("")
    try {
      const config = buildAgentConfig()
      const result = await api.upsertOrchestrationAgent(config.agentId, config, { idempotencyKey: `webui:agent:save:${config.agentId}:${Date.now()}` })
      setAgentResult(result)
      await load()
      setSelectedAgentId(config.agentId)
    } catch (err) {
      setActionError(formatError(err))
    }
  }

  async function setAgentStatus(agentId: string, status: OrchestrationAgentRegistryEntry["status"]) {
    if (guardTopologyWrite()) return
    setActionError("")
    try {
      await api.setOrchestrationAgentStatus(agentId, status, { idempotencyKey: `webui:agent:status:${agentId}:${status}:${Date.now()}` })
      await load()
    } catch (err) {
      setActionError(formatError(err))
    }
  }

  async function validateTeam() {
    if (guardTopologyWrite()) return
    setActionError("")
    try {
      const config = buildTeamConfig()
      const result = await api.upsertOrchestrationTeam(config.teamId, config, { validationOnly: true, idempotencyKey: `webui:team:validate:${config.teamId}` })
      setTeamResult(result)
    } catch (err) {
      setActionError(formatError(err))
    }
  }

  async function saveTeam() {
    if (guardTopologyWrite()) return
    setActionError("")
    try {
      const config = buildTeamConfig()
      const result = await api.upsertOrchestrationTeam(config.teamId, config, { idempotencyKey: `webui:team:save:${config.teamId}:${Date.now()}` })
      setTeamResult(result)
      await load()
      setSelectedTeamId(config.teamId)
    } catch (err) {
      setActionError(formatError(err))
    }
  }

  async function setTeamStatus(teamId: string, status: OrchestrationTeamRegistryEntry["status"]) {
    if (guardTopologyWrite()) return
    setActionError("")
    try {
      await api.setOrchestrationTeamStatus(teamId, status, { idempotencyKey: `webui:team:status:${teamId}:${status}:${Date.now()}` })
      await load()
    } catch (err) {
      setActionError(formatError(err))
    }
  }

  async function executeBoardInstruction(
    instruction: ReturnType<typeof buildOrchestrationSavePlan>["instructions"][number],
    validationOnly: boolean,
  ) {
    const idempotencyKey = `webui:board:${validationOnly ? "validate" : "save"}:${instruction.key}:${Date.now()}`
    if (instruction.targetType === "agent") {
      return api.upsertOrchestrationAgent(instruction.targetId, instruction.config as AgentConfig, { validationOnly, idempotencyKey })
    }
    return api.upsertOrchestrationTeam(instruction.targetId, instruction.config as TeamConfig, { validationOnly, idempotencyKey })
  }

  async function exportConfig() {
    const [targetType, ...idParts] = exportTarget.split(":")
    const targetId = idParts.join(":")
    if ((targetType !== "agent" && targetType !== "team") || !targetId) return
    setActionError("")
    try {
      const result = await api.exportOrchestrationConfig(targetType, targetId)
      setExportText(result.canonicalJson)
    } catch (err) {
      setActionError(formatError(err))
    }
  }

  async function importConfig(validationOnly: boolean) {
    if (guardTopologyWrite()) return
    setActionError("")
    try {
      const result = await api.importOrchestrationConfig({
        content: importContent,
        format: importFormat,
        validationOnly,
        conflictStrategy: "overwrite",
        idempotencyKey: `webui:orchestration:import:${validationOnly ? "validate" : "save"}:${Date.now()}`,
      })
      setImportResult(result)
      if (!validationOnly && result.ok) await load()
    } catch (err) {
      setActionError(formatError(err))
    }
  }

  async function loadSubSessions() {
    if (!parentRunId.trim()) return
    setActionError("")
    try {
      const result = await api.orchestrationSubSessions(parentRunId.trim())
      setSubSessions(result)
    } catch (err) {
      setActionError(formatError(err))
    }
  }

  useEffect(() => {
    if (surface !== "page") return

    function handleWindowShortcut(event: KeyboardEvent) {
      const action = resolveOrchestrationShortcut(event)
      if (!action || shouldIgnoreOrchestrationShortcutTarget(event.target, action)) return

      if (action === "zoom_in") {
        event.preventDefault()
        setViewport((current) => zoomOrchestrationViewport(current, "in"))
        return
      }
      if (action === "zoom_out") {
        event.preventDefault()
        setViewport((current) => zoomOrchestrationViewport(current, "out"))
        return
      }
      if (action === "reset_view") {
        event.preventDefault()
        handleResetViewport()
        return
      }
      if (action === "save_draft") {
        if (!topologyEditorGate.canEdit || !boardDraft?.dirty || boardSaveRunning) return
        event.preventDefault()
        void saveBoard()
        return
      }
      if (action === "close_overlay") {
        if (boardDraft?.pendingDrop) {
          event.preventDefault()
          handleChooseDropOption("cancel")
          return
        }
        if (keyboardMoveOpen) {
          event.preventDefault()
          setKeyboardMoveOpen(false)
          return
        }
        if (selectedBoardAgentDraft || selectedBoardTeamDraft) {
          event.preventDefault()
          handleCloseQuickEditSheet()
          return
        }
        if (legacySurfaceOpen) {
          event.preventDefault()
          setLegacySurfaceOpen(false)
        }
      }
    }

    window.addEventListener("keydown", handleWindowShortcut)
    return () => window.removeEventListener("keydown", handleWindowShortcut)
  }, [
    surface,
    topologyEditorGate.canEdit,
    boardDraft,
    boardSaveRunning,
    keyboardMoveOpen,
    selectedBoardAgentDraft,
    selectedBoardTeamDraft,
    legacySurfaceOpen,
  ])

  const studioView = (
    <>
      <OrchestrationStudioShell
        language={language}
        surface="page"
        sheetOpen={Boolean(selectedBoardAgentDraft || selectedBoardTeamDraft)}
        topBar={(
          <OrchestrationStudioTopBar
            language={language}
            dirty={boardDraft?.dirty ?? false}
            selectionLabel={dashboardSelectedLabel}
          />
        )}
        mapToolbar={(
          <OrchestrationMapToolbar
            language={language}
            viewport={viewport}
            nodeMode={boardNodeMode}
            canEdit={topologyEditorGate.canEdit}
            dirty={boardDraft?.dirty ?? false}
            running={boardSaveRunning}
            showArchived={showArchived}
            hiddenArchivedCount={hiddenArchivedCount}
            onCreateAgent={handleQuickCreateAgent}
            onCreateTeam={handleQuickCreateTeam}
            onToggleShowArchived={handleToggleShowArchived}
            onValidateBoard={() => void validateBoard()}
            onSaveBoard={() => void saveBoard()}
            onRevert={handleRevertBoardDraft}
            onZoomIn={() => setViewport((current) => zoomOrchestrationViewport(current, "in"))}
            onZoomOut={() => setViewport((current) => zoomOrchestrationViewport(current, "out"))}
            onFitSelection={handleFitSelectionViewport}
            onFitAll={handleFitAllViewport}
            onReset={handleResetViewport}
          />
        )}
        validationRibbon={(
        <OrchestrationValidationRibbon
          language={language}
          validationSnapshot={boardValidation?.snapshot ?? boardDraft?.lastValidation ?? null}
          validationSummary={boardValidation ? {
            errorCount: boardValidation.summary.errorCount,
            warningCount: boardValidation.summary.warningCount,
          } : null}
          saveResult={boardSaveResult}
          savePlanCount={boardSavePlan?.instructions.length ?? null}
        />
        )}
        mapView={(
          <OrchestrationBoardEditor
            projection={boardProjection}
            gate={topologyEditorGate}
            language={language}
            surface={surface}
            entryHref={entryHref}
            layout="dashboard"
            nodeMode={boardNodeMode}
            dragState={boardDraft?.dragState ?? null}
            dropAvailability={boardDropAvailability}
            pendingDrop={boardDraft?.pendingDrop ?? null}
            onChooseDropOption={handleChooseDropOption}
            onCancelDropOption={() => handleChooseDropOption("cancel")}
            onDragStartAgent={handleBoardDragMouseDown}
            onDragStartTeam={handleBoardTeamDragMouseDown}
            onSelectAgent={handleBoardSelectAgent}
            onSelectTeam={handleBoardSelectTeam}
            onCreateAgentInTeam={handlePrepareAgentForTeam}
            onArchiveTeam={handleArchiveBoardTeam}
          />
        )}
        quickEditSheet={quickEditSheet}
        mobileSheet={(
          <OrchestrationMobileSheet
            language={language}
            open={Boolean(selectedBoardAgentDraft || selectedBoardTeamDraft)}
            title={text("Quick sheet", "Quick sheet")}
            onClose={handleCloseQuickEditSheet}
          >
            {quickEditSheet}
          </OrchestrationMobileSheet>
        )}
        viewportTransform={formatOrchestrationViewportTransform(viewport)}
        onViewportMouseDown={handleViewportMouseDown}
        onViewportMouseMove={handleViewportMouseMove}
        onViewportMouseUp={handleViewportMouseUp}
        onViewportWheel={handleViewportWheel}
        onCloseQuickEdit={handleCloseQuickEditSheet}
      />

      {mode === "beginner" ? <BeginnerGuide summary={summary} /> : null}

      <OrchestrationKeyboardMoveDialog
        language={language}
        open={keyboardMoveOpen}
        agentLabel={selectedBoardAgentDraft?.displayName ?? text("선택된 에이전트", "Selected agent")}
        sourceLaneId={keyboardMoveSourceLaneId}
        targetLaneId={keyboardMoveTargetLaneId}
        sourceOptions={keyboardMoveSourceOptions}
        targetOptions={keyboardMoveTargetOptions}
        onSourceChange={setKeyboardMoveSourceLaneId}
        onTargetChange={setKeyboardMoveTargetLaneId}
        onConfirm={handleConfirmKeyboardMove}
        onClose={() => setKeyboardMoveOpen(false)}
      />
    </>
  )

  const legacyOverlayTools = [
    {
      id: "topology" as const,
      panel: (
        <OrchestrationTopologyPanel
          scene={topologyScene}
          summary={summary}
          language={language}
          selectedNodeId={selectedTopologyNodeId}
          onSelectNode={handleSelectTopologyNode}
          onDismissSelection={() => setSelectedTopologyNodeId(null)}
          selectedEdgeId={selectedTopologyEdgeId}
          onSelectEdge={setSelectedTopologyEdgeId}
          yeonjangRelations={yeonjangProjection.relations}
          inspector={topologyInspector}
          editorGate={topologyEditorGate}
        />
      ),
    },
    {
      id: "advanced_editor" as const,
      panel: (
        <AdvancedEditor
          agents={agents}
          teams={teams}
          agentForm={agentForm}
          teamForm={teamForm}
          selectedAgent={selectedAgent}
          selectedTeam={selectedTeam}
          agentResult={agentResult}
          teamResult={teamResult}
          onPatchAgent={patchAgentForm}
          onPatchTeam={patchTeamForm}
          onFillAgent={fillAgentFromSelected}
          onFillTeam={fillTeamFromSelected}
          onValidateAgent={() => void validateAgent()}
          onSaveAgent={() => void saveAgent()}
          onSetAgentStatus={(agentId, status) => void setAgentStatus(agentId, status)}
          onValidateTeam={() => void validateTeam()}
          onSaveTeam={() => void saveTeam()}
          onSetTeamStatus={(teamId, status) => void setTeamStatus(teamId, status)}
          topologyEditorGate={topologyEditorGate}
        />
      ),
    },
    {
      id: "import_export" as const,
      panel: (
        <ImportExportPanel
          agents={agents}
          teams={teams}
          exportTarget={exportTarget}
          exportText={exportText}
          importContent={importContent}
          importFormat={importFormat}
          importResult={importResult}
          onExportTargetChange={setExportTarget}
          onExport={() => void exportConfig()}
          onImportContentChange={setImportContent}
          onImportFormatChange={setImportFormat}
          onImport={(validationOnly) => void importConfig(validationOnly)}
          topologyEditorGate={topologyEditorGate}
        />
      ),
    },
    {
      id: "relationship_graph" as const,
      panel: <RelationshipGraphPanel graphView={graphView} />,
    },
    {
      id: "profile_preview" as const,
      panel: <ProfilePreviewPanel config={previewConfig} warnings={previewWarnings} />,
    },
    {
      id: "runtime_sub_sessions" as const,
      panel: (
        <RuntimeSubSessionPanel
          parentRunId={parentRunId}
          subSessions={subSessions}
          onParentRunIdChange={setParentRunId}
          onLoad={() => void loadSubSessions()}
        />
      ),
    },
  ]

  const legacyUtilitySurface = compact ? null : (
    <OrchestrationLegacyOverlay
      language={language}
      policy={surfacePolicy}
      open={legacySurfaceOpen}
      activeToolId={activeLegacyToolId}
      tools={legacyOverlayTools}
      footer={(
        <OrchestrationPolicyParityPanel
          language={language}
          surfacePolicy={surfacePolicy}
          fields={policyParityFields}
        />
      )}
      onToggleOpen={() => setLegacySurfaceOpen((current) => !current)}
      onSelectTool={setActiveLegacyToolId}
    />
  )

  return (
    <OrchestrationContentShell surface={surface}>
      {!compact ? (
        <OrchestrationTopBar
          language={language}
          activeTab={dashboardTab}
          onChange={handleDashboardTabChange}
          summary={summary}
          fallback={dashboardFallback}
        />
      ) : null}

      {error ? <Notice tone="error" title={text("오케스트레이션 정보를 불러오지 못했습니다.", "Could not load orchestration state.")} message={displayText(error)} /> : null}
      {actionError ? <Notice tone="error" title={text("작업 실패", "Action failed")} message={displayText(actionError)} /> : null}
      {loading ? <Notice tone="info" title={text("불러오는 중", "Loading")} message={text("에이전트, 팀, 관계도를 확인하고 있습니다.", "Loading agents, teams, and relationships.")} /> : null}
      {settingsCapability && settingsCapability.status !== "ready" ? (
        <Notice
          tone={settingsCapability.status === "error" ? "error" : "info"}
          title={text("현재는 soft gate 상태입니다.", "This surface is currently soft-gated.")}
          message={displayText(settingsCapability.reason ?? text("route는 유지하지만, 상태에 따라 preview 또는 notice만 먼저 보일 수 있습니다.", "The route stays available, but depending on current state you may see a preview or notice first."))}
        />
      ) : null}
      {topologyEditorGate.status !== "ready" && dashboardTab === "map" ? (
        <Notice
          tone={topologyEditorGate.status === "disabled" ? "error" : "info"}
          title={topologyEditorGate.title}
          message={displayText(topologyEditorGate.message)}
        />
      ) : null}

      {compact ? (
        <OrchestrationStudioPreview
          language={language}
          projection={boardProjection}
          gate={topologyEditorGate}
          entryHref={entryHref}
          selectedTitle={dashboardSelectedLabel}
          secondaryBadges={surfacePolicy.badges}
          secondaryNote={surfacePolicy.secondarySummary}
          onSelectAgent={handleBoardSelectAgent}
          onSelectTeam={handleBoardSelectTeam}
        />
      ) : dashboardTab === "map" ? (
        studioView
      ) : dashboardTab === "utilities" ? (
        legacyUtilitySurface
      ) : (
        <OrchestrationDashboardShell
          language={language}
          activeTab={dashboardTab === "approvals" ? "approvals" : "activity" === dashboardTab ? "activity" : "map"}
          viewport={viewport}
          nodeMode={boardNodeMode}
          inspector={dashboardInspector}
          activityItems={filteredDashboardActivityItems}
          mapView={(
            <OrchestrationBoardEditor
              projection={boardProjection}
              gate={topologyEditorGate}
              language={language}
              surface={surface}
              entryHref={entryHref}
              layout="dashboard"
              nodeMode={boardNodeMode}
              onSelectAgent={handleBoardSelectAgent}
              onSelectTeam={handleBoardSelectTeam}
            />
          )}
          onZoomIn={() => setViewport((current) => zoomOrchestrationViewport(current, "in"))}
          onZoomOut={() => setViewport((current) => zoomOrchestrationViewport(current, "out"))}
          onFitSelection={handleFitSelectionViewport}
          onFitAll={handleFitAllViewport}
          onReset={handleResetViewport}
          onViewportMouseDown={handleViewportMouseDown}
          onViewportMouseMove={handleViewportMouseMove}
          onViewportMouseUp={handleViewportMouseUp}
          onViewportWheel={handleViewportWheel}
          mobileInspector={<OrchestrationFloatingInspector language={language} inspector={dashboardInspector} />}
        />
      )}
      {showAdminDiagnostics ? (
        <AdminDiagnosticsPanel
          registry={registry}
          graph={graph}
          generatedAt={registry?.generatedAt}
          formatDateTime={formatDateTime}
        />
      ) : null}
    </OrchestrationContentShell>
  )
}

function BeginnerGuide({ summary }: { summary: ReturnType<typeof buildOrchestrationSummary> }) {
  const { text } = useUiI18n()
  const language = useUiLanguageStore((state) => state.language)
  const templates = beginnerAgentTemplates(language)
  const teams = beginnerTeamTemplates(language)
  const focusCards = summary.filter((card) => card.id === "mode" || card.id === "agents" || card.id === "membership")
  return (
    <section className="rounded-[2rem] border border-stone-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="text-sm font-semibold text-stone-950">{text("초보 사용자 구성", "Beginner setup")}</div>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-stone-600">
            {text("처음에는 노비 단독 모드가 기본입니다. 필요할 때만 추천 템플릿을 켜고, 권한 이름 대신 실제 위험과 목적을 확인한 뒤 활성화하세요.", "Single Nobie mode is the default. Enable recommended templates only when needed, and review practical risk and purpose instead of raw permission names.")}
          </p>
        </div>
        <Link to="/advanced/agents" className="rounded-2xl border border-stone-200 px-4 py-2.5 text-sm font-semibold text-stone-700">
          {text("고급 구성 열기", "Open advanced setup")}
        </Link>
      </div>
      <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
        {text("베타 기능입니다. 서브 에이전트 활성화 전에는 메모리 분리, 스킬/MCP 허용 범위, 외부 네트워크와 파일 쓰기 위험을 반드시 확인해야 합니다.", "This is a beta feature. Before enabling sub-agents, review memory isolation, skill/MCP allowlists, external network, and file-write risk.")}
      </div>
      <div className="mt-4 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm leading-6 text-sky-900">
        {text("Yeonjang은 특정 agent 전용이 아니라 shared capability hub입니다. 초보 surface에서는 현재 허용 상태만 요약하고, 직접 편집은 전용 topology surface에서만 다룹니다.", "Yeonjang is a shared capability hub, not a dedicated-agent add-on. Beginner surfaces summarize the current access state only, while direct editing stays on the dedicated topology surface.")}
      </div>
      <div className="mt-5 grid gap-4 md:grid-cols-3">
        {focusCards.map((card) => (
          <article key={card.id} className={`rounded-3xl border p-5 ${summaryToneClass(card.tone)}`}>
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] opacity-70">{card.label}</div>
            <div className="mt-2 text-2xl font-semibold">{card.value}</div>
            <p className="mt-2 text-sm leading-6 opacity-80">{card.description}</p>
          </article>
        ))}
      </div>
      <div className="mt-5 grid gap-4 lg:grid-cols-3">
        {templates.map((item) => (
          <article key={item.id} className="rounded-3xl border border-stone-200 bg-stone-50 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="text-sm font-semibold text-stone-950">{item.title}</div>
              <span className={`rounded-full px-2 py-1 text-xs font-semibold ${item.risk === "low" ? "bg-emerald-100 text-emerald-700" : item.risk === "medium" ? "bg-amber-100 text-amber-800" : "bg-red-100 text-red-700"}`}>{item.risk}</span>
            </div>
            <p className="mt-2 text-sm leading-6 text-stone-600">{item.purpose}</p>
            <div className="mt-3 text-xs leading-5 text-stone-500">Skill: {item.recommendedSkills.join(", ") || "-"}</div>
            <div className="text-xs leading-5 text-stone-500">MCP: {item.recommendedMcpServers.join(", ") || "-"}</div>
          </article>
        ))}
      </div>
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        {teams.map((item) => (
          <article key={item.id} className="rounded-3xl border border-stone-200 bg-white p-4">
            <div className="text-sm font-semibold text-stone-950">{item.title}</div>
            <p className="mt-2 text-sm leading-6 text-stone-600">{item.purpose}</p>
            <div className="mt-3 text-xs font-semibold text-stone-500">{item.members.join(" + ")}</div>
          </article>
        ))}
      </div>
    </section>
  )
}

function AdvancedEditor(props: {
  agents: OrchestrationAgentRegistryEntry[]
  teams: OrchestrationTeamRegistryEntry[]
  agentForm: AgentFormState
  teamForm: TeamFormState
  selectedAgent: OrchestrationAgentRegistryEntry | null
  selectedTeam: OrchestrationTeamRegistryEntry | null
  agentResult: WriteResult | null
  teamResult: WriteResult | null
  onPatchAgent: (patch: Partial<AgentFormState>) => void
  onPatchTeam: (patch: Partial<TeamFormState>) => void
  onFillAgent: (agent: OrchestrationAgentRegistryEntry) => void
  onFillTeam: (team: OrchestrationTeamRegistryEntry) => void
  onValidateAgent: () => void
  onSaveAgent: () => void
  onSetAgentStatus: (agentId: string, status: OrchestrationAgentRegistryEntry["status"]) => void
  onValidateTeam: () => void
  onSaveTeam: () => void
  onSetTeamStatus: (teamId: string, status: OrchestrationTeamRegistryEntry["status"]) => void
  topologyEditorGate: TopologyEditorGate
}) {
  const { text } = useUiI18n()
  const editingLocked = !props.topologyEditorGate.canEdit
  return (
    <section className="rounded-[2rem] border border-stone-200 bg-white p-6 shadow-sm">
      <div>
        <div className="text-sm font-semibold text-stone-950">{text("고급 사용자 구성", "Advanced configuration")}</div>
        <p className="mt-2 text-sm leading-6 text-stone-600">
          {text("에이전트와 팀은 저장 전 검증을 먼저 실행할 수 있습니다. 저장된 항목도 비활성화 또는 보관 상태로 바꿀 수 있습니다.", "Agents and teams can be validated before saving. Saved entries can also be disabled or archived.")}
        </p>
      </div>
      {editingLocked ? (
        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
          <div className="font-semibold">{props.topologyEditorGate.title}</div>
          <div className="mt-1">{props.topologyEditorGate.message}</div>
        </div>
      ) : null}

      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <div className="space-y-4">
          <ListPanel title={text("서브 에이전트", "Sub-agents")} empty={text("아직 등록된 서브 에이전트가 없습니다.", "No sub-agents registered yet.")}>
            {props.agents.map((agent) => (
              <div key={agent.agentId} className="rounded-2xl border border-stone-200 bg-stone-50 p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <button type="button" onClick={() => props.onFillAgent(agent)} className="text-left">
                    <div className="text-sm font-semibold text-stone-950">{agent.displayName}</div>
                    <div className="mt-1 text-xs text-stone-500">{agent.agentId} · {agent.status} · {riskText(agent.permissionProfile.riskCeiling, useUiLanguageStore.getState().language)}</div>
                  </button>
                  <div className="flex flex-wrap gap-2">
                    <StatusButton label="enable" onClick={() => props.onSetAgentStatus(agent.agentId, "enabled")} disabled={editingLocked} />
                    <StatusButton label="disable" onClick={() => props.onSetAgentStatus(agent.agentId, "disabled")} disabled={editingLocked} />
                    <StatusButton label="archive" onClick={() => props.onSetAgentStatus(agent.agentId, "archived")} disabled={editingLocked} />
                  </div>
                </div>
              </div>
            ))}
          </ListPanel>

          <div className="rounded-3xl border border-stone-200 bg-stone-50 p-4">
            <FormTitle title={text("에이전트 생성/수정", "Create or edit agent")} />
            <TextInput label="agentId" value={props.agentForm.agentId} onChange={(value) => props.onPatchAgent({ agentId: value })} placeholder="agent:researcher" />
            <TextInput label={text("표시 이름", "Display name")} value={props.agentForm.displayName} onChange={(value) => props.onPatchAgent({ displayName: value })} />
            <TextInput label={text("닉네임", "Nickname")} value={props.agentForm.nickname} onChange={(value) => props.onPatchAgent({ nickname: value })} />
            <TextArea label={text("역할", "Role")} value={props.agentForm.role} onChange={(value) => props.onPatchAgent({ role: value })} />
            <TextArea label={text("성격/분위기", "Personality")} value={props.agentForm.personality} onChange={(value) => props.onPatchAgent({ personality: value })} />
            <TextInput label={text("전문 태그", "Specialty tags")} value={props.agentForm.specialtyTags} onChange={(value) => props.onPatchAgent({ specialtyTags: value })} placeholder="research, weather, finance" />
            <TextInput label={text("피해야 할 작업", "Avoid tasks")} value={props.agentForm.avoidTasks} onChange={(value) => props.onPatchAgent({ avoidTasks: value })} />
            <TextInput label={text("소속 팀", "Team IDs")} value={props.agentForm.teamIds} onChange={(value) => props.onPatchAgent({ teamIds: value })} />
            <label className="mt-3 block text-xs font-semibold text-stone-600">
              {text("위험 한도", "Risk ceiling")}
              <select value={props.agentForm.riskCeiling} onChange={(event) => props.onPatchAgent({ riskCeiling: event.target.value as CapabilityRiskLevel })} className="mt-1 w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm">
                {(["safe", "moderate", "external", "sensitive", "dangerous"] as CapabilityRiskLevel[]).map((risk) => <option key={risk} value={risk}>{risk}</option>)}
              </select>
            </label>
            <div className="mt-3 rounded-2xl border border-stone-200 bg-white p-3">
              <div className="text-xs font-semibold text-stone-600">{text("권한 프로필", "Permission profile")}</div>
              <div className="mt-2 grid gap-2 text-xs text-stone-700 sm:grid-cols-2">
                <CheckboxInput label={text("외부 네트워크", "External network")} checked={props.agentForm.allowExternalNetwork} onChange={(value) => props.onPatchAgent({ allowExternalNetwork: value })} />
                <CheckboxInput label={text("파일 쓰기", "File write")} checked={props.agentForm.allowFilesystemWrite} onChange={(value) => props.onPatchAgent({ allowFilesystemWrite: value })} />
                <CheckboxInput label={text("쉘 실행", "Shell execution")} checked={props.agentForm.allowShellExecution} onChange={(value) => props.onPatchAgent({ allowShellExecution: value })} />
                <CheckboxInput label={text("화면 제어", "Screen control")} checked={props.agentForm.allowScreenControl} onChange={(value) => props.onPatchAgent({ allowScreenControl: value })} />
              </div>
            </div>
            <TextInput label={text("허용 경로", "Allowed paths")} value={props.agentForm.allowedPaths} onChange={(value) => props.onPatchAgent({ allowedPaths: value })} />
            <TextInput label="Skill allowlist" value={props.agentForm.enabledSkillIds} onChange={(value) => props.onPatchAgent({ enabledSkillIds: value })} />
            <TextInput label="MCP allowlist" value={props.agentForm.enabledMcpServerIds} onChange={(value) => props.onPatchAgent({ enabledMcpServerIds: value })} />
            <TextInput label="Tool allowlist" value={props.agentForm.enabledToolNames} onChange={(value) => props.onPatchAgent({ enabledToolNames: value })} />
            <ActionRow onValidate={props.onValidateAgent} onSave={props.onSaveAgent} disabled={editingLocked || !props.agentForm.agentId.trim()} />
            <EffectSummary result={props.agentResult} />
          </div>
        </div>

        <div className="space-y-4">
          <ListPanel title={text("팀", "Teams")} empty={text("아직 등록된 팀이 없습니다.", "No teams registered yet.")}>
            {props.teams.map((team) => (
              <div key={team.teamId} className="rounded-2xl border border-stone-200 bg-stone-50 p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <button type="button" onClick={() => props.onFillTeam(team)} className="text-left">
                    <div className="text-sm font-semibold text-stone-950">{team.displayName}</div>
                    <div className="mt-1 text-xs text-stone-500">{team.teamId} · {team.status} · members {team.memberAgentIds.length}</div>
                  </button>
                  <div className="flex flex-wrap gap-2">
                    <StatusButton label="enable" onClick={() => props.onSetTeamStatus(team.teamId, "enabled")} disabled={editingLocked} />
                    <StatusButton label="disable" onClick={() => props.onSetTeamStatus(team.teamId, "disabled")} disabled={editingLocked} />
                    <StatusButton label="archive" onClick={() => props.onSetTeamStatus(team.teamId, "archived")} disabled={editingLocked} />
                  </div>
                </div>
              </div>
            ))}
          </ListPanel>

          <div className="rounded-3xl border border-stone-200 bg-stone-50 p-4">
            <FormTitle title={text("팀 생성/수정", "Create or edit team")} />
            <TextInput label="teamId" value={props.teamForm.teamId} onChange={(value) => props.onPatchTeam({ teamId: value })} placeholder="team:research" />
            <TextInput label={text("표시 이름", "Display name")} value={props.teamForm.displayName} onChange={(value) => props.onPatchTeam({ displayName: value })} />
            <TextInput label={text("닉네임", "Nickname")} value={props.teamForm.nickname} onChange={(value) => props.onPatchTeam({ nickname: value })} />
            <TextArea label={text("목적", "Purpose")} value={props.teamForm.purpose} onChange={(value) => props.onPatchTeam({ purpose: value })} />
            <TextInput label={text("멤버 에이전트", "Member agent IDs")} value={props.teamForm.memberAgentIds} onChange={(value) => props.onPatchTeam({ memberAgentIds: value })} />
            <TextInput label={text("역할 힌트", "Role hints")} value={props.teamForm.roleHints} onChange={(value) => props.onPatchTeam({ roleHints: value })} />
            <ActionRow onValidate={props.onValidateTeam} onSave={props.onSaveTeam} disabled={editingLocked || !props.teamForm.teamId.trim()} />
            <EffectSummary result={props.teamResult} />
          </div>
        </div>
      </div>
    </section>
  )
}

function RelationshipGraphPanel({ graphView }: { graphView: ReturnType<typeof buildRelationshipGraphView> }) {
  const { text } = useUiI18n()
  const language = useUiLanguageStore((state) => state.language)
  return (
    <section className="rounded-[2rem] border border-stone-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-stone-950">{text("관계도", "Relationship graph")}</div>
          <p className="mt-2 text-sm leading-6 text-stone-600">
            {text("노비, 서브 에이전트, 팀, 데이터 교환, 권한 위임 관계를 같은 화면에서 확인합니다.", "Inspect Nobie, sub-agents, teams, data exchange, and capability delegation in one view.")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          {(Object.keys(EDGE_TYPE_LABELS) as Array<keyof typeof EDGE_TYPE_LABELS>).map((edgeType) => (
            <span key={edgeType} className={`rounded-full px-2 py-1 font-semibold ${edgeToneClass(EDGE_TYPE_LABELS[edgeType].tone)}`}>
              {text(EDGE_TYPE_LABELS[edgeType].ko, EDGE_TYPE_LABELS[edgeType].en)} {graphView.edgeCounts[edgeType]}
            </span>
          ))}
        </div>
      </div>

      {graphView.singleNobieMode ? (
        <div className="mt-5 rounded-3xl border border-stone-200 bg-stone-50 p-5">
          <div className="text-sm font-semibold text-stone-950">{text("현재는 단일 노비 모드입니다.", "Currently in single Nobie mode.")}</div>
          <p className="mt-2 text-sm leading-6 text-stone-600">
            {text("서브 에이전트나 팀이 없으므로 기존 동작처럼 노비가 직접 처리합니다.", "There are no sub-agents or teams, so Nobie handles work directly as before.")}
          </p>
        </div>
      ) : null}

      <div className="mt-5 grid gap-3 md:grid-cols-2">
        {graphView.nodes.map((node) => (
          <article key={node.nodeId} className={`rounded-3xl border p-4 ${nodeToneClass(node.uiTone)}`}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">{node.label}</div>
                <div className="mt-1 text-xs opacity-70">{node.entityType} · {node.entityId}</div>
              </div>
              {node.status ? <span className="rounded-full bg-white/70 px-2 py-1 text-xs font-semibold">{node.status}</span> : null}
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <Link to={`/advanced/settings?target=${encodeURIComponent(node.entityId)}`} className="rounded-full bg-white/70 px-2 py-1 font-semibold">settings</Link>
              <Link to={`/advanced/audit?q=${encodeURIComponent(node.entityId)}`} className="rounded-full bg-white/70 px-2 py-1 font-semibold">audit</Link>
            </div>
          </article>
        ))}
      </div>

      <div className="mt-5 space-y-2">
        {graphView.edges.length === 0 ? <p className="text-sm text-stone-500">{text("표시할 관계선이 없습니다.", "No relationship edges to show.")}</p> : null}
        {graphView.edges.map((edge) => (
          <div key={edge.edgeId} className="rounded-2xl border border-stone-200 bg-stone-50 p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-2 py-1 text-xs font-semibold ${edgeToneClass(edge.tone)}`}>{text(EDGE_TYPE_LABELS[edge.edgeType].ko, EDGE_TYPE_LABELS[edge.edgeType].en)}</span>
              <span className="font-semibold text-stone-900">{edge.fromNodeId}</span>
              <span className="text-stone-400">→</span>
              <span className="font-semibold text-stone-900">{edge.toNodeId}</span>
            </div>
            <div className="mt-1 text-xs text-stone-500">{edge.labelText}</div>
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              <Link to={`/advanced/audit?q=${encodeURIComponent(`${edge.edgeType} ${edge.edgeId}`)}`} className="rounded-full bg-white px-2 py-1 font-semibold text-stone-700 ring-1 ring-stone-200">audit</Link>
              <Link to={`/advanced/agents?edge=${encodeURIComponent(edge.edgeId)}`} className="rounded-full bg-white px-2 py-1 font-semibold text-stone-700 ring-1 ring-stone-200">relationship</Link>
            </div>
          </div>
        ))}
      </div>

      {graphView.diagnostics.length ? (
        <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-900">
          {graphView.diagnostics.map((item) => <div key={item}>{item}</div>)}
        </div>
      ) : null}
      <div className="sr-only">{language}</div>
    </section>
  )
}

function ProfilePreviewPanel({ config, warnings }: { config: AgentConfig | TeamConfig | null; warnings: string[] }) {
  const { text } = useUiI18n()
  return (
    <section className="rounded-[2rem] border border-stone-200 bg-white p-6 shadow-sm">
      <div className="text-sm font-semibold text-stone-950">{text("프롬프트/프로필 미리보기", "Prompt/Profile preview")}</div>
      {!config ? <p className="mt-3 text-sm text-stone-500">{text("미리볼 에이전트 또는 팀을 선택하세요.", "Select an agent or team to preview.")}</p> : null}
      {config ? (
        <div className="mt-4 space-y-3">
          <PreviewRow label="id" value={"agentType" in config ? config.agentId : config.teamId} />
          <PreviewRow label={text("이름", "Name")} value={config.displayName} />
          <PreviewRow label={text("닉네임", "Nickname")} value={config.nickname ?? "-"} />
          {"agentType" in config ? (
            <>
              <PreviewRow label={text("역할", "Role")} value={config.role} />
              <PreviewRow label={text("성격", "Personality")} value={config.personality} />
              <PreviewRow label={text("메모리 범위", "Memory scope")} value={`${config.memoryPolicy.owner.ownerType}:${config.memoryPolicy.owner.ownerId} / ${config.memoryPolicy.visibility}`} />
              <PreviewRow label={text("스킬/MCP", "Skill/MCP")} value={[...config.capabilityPolicy.skillMcpAllowlist.enabledSkillIds, ...config.capabilityPolicy.skillMcpAllowlist.enabledMcpServerIds, ...config.capabilityPolicy.skillMcpAllowlist.enabledToolNames].join(", ") || "-"} />
            </>
          ) : (
            <>
              <PreviewRow label={text("목적", "Purpose")} value={config.purpose} />
              <PreviewRow label={text("멤버", "Members")} value={config.memberAgentIds.join(", ") || "-"} />
            </>
          )}
          {warnings.length ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-900">
              {warnings.map((item) => <div key={item}>{item}</div>)}
            </div>
          ) : (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{text("즉시 확인할 위험 경고는 없습니다.", "No immediate profile warnings.")}</div>
          )}
        </div>
      ) : null}
    </section>
  )
}

function ImportExportPanel(props: {
  agents: OrchestrationAgentRegistryEntry[]
  teams: OrchestrationTeamRegistryEntry[]
  exportTarget: string
  exportText: string
  importContent: string
  importFormat: "json" | "yaml"
  importResult: OrchestrationImportResult | null
  onExportTargetChange: (value: string) => void
  onExport: () => void
  onImportContentChange: (value: string) => void
  onImportFormatChange: (value: "json" | "yaml") => void
  onImport: (validationOnly: boolean) => void
  topologyEditorGate: TopologyEditorGate
}) {
  const { text } = useUiI18n()
  const editingLocked = !props.topologyEditorGate.canEdit
  const options = [
    ...props.agents.map((agent) => ({ value: `agent:${agent.agentId}`, label: `agent: ${agent.displayName}` })),
    ...props.teams.map((team) => ({ value: `team:${team.teamId}`, label: `team: ${team.displayName}` })),
  ]
  return (
    <section className="rounded-[2rem] border border-stone-200 bg-white p-6 shadow-sm">
      <div className="text-sm font-semibold text-stone-950">{text("설정 업로드/다운로드", "Import / export configuration")}</div>
      <p className="mt-2 text-sm leading-6 text-stone-600">
        {text("노비와 서브 에이전트 설정은 파일로 내려받고, UI에서 업로드하거나 직접 붙여넣어 검증 후 저장할 수 있습니다.", "Nobie and sub-agent settings can be downloaded, uploaded, or pasted directly, then validated before saving.")}
      </p>
      {editingLocked ? (
        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
          <div className="font-semibold">{props.topologyEditorGate.title}</div>
          <div className="mt-1">{props.topologyEditorGate.message}</div>
        </div>
      ) : null}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="rounded-3xl border border-stone-200 bg-stone-50 p-4">
          <FormTitle title={text("다운로드", "Export")} />
          <select value={props.exportTarget} onChange={(event) => props.onExportTargetChange(event.target.value)} className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm">
            <option value="">{text("대상을 선택하세요", "Select a target")}</option>
            {options.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
          <button type="button" onClick={props.onExport} disabled={!props.exportTarget} className="mt-3 rounded-xl bg-stone-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{text("내보내기", "Export")}</button>
          {props.exportText ? <pre className="mt-3 max-h-80 overflow-auto rounded-2xl bg-stone-900 p-3 text-xs text-stone-100">{props.exportText}</pre> : null}
        </div>
        <div className="rounded-3xl border border-stone-200 bg-stone-50 p-4">
          <FormTitle title={text("업로드/직접 입력", "Import / paste")} />
          <select value={props.importFormat} onChange={(event) => props.onImportFormatChange(event.target.value as "json" | "yaml")} className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm">
            <option value="json">JSON</option>
            <option value="yaml">YAML</option>
          </select>
          <textarea value={props.importContent} onChange={(event) => props.onImportContentChange(event.target.value)} className="mt-3 min-h-48 w-full rounded-2xl border border-stone-200 bg-white px-3 py-2 font-mono text-xs" placeholder="{ ... }" />
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => props.onImport(true)} disabled={editingLocked || !props.importContent.trim()} className="rounded-xl border border-stone-200 bg-white px-4 py-2.5 text-sm font-semibold text-stone-700 disabled:opacity-50">{text("검증만", "Validate only")}</button>
            <button type="button" onClick={() => props.onImport(false)} disabled={editingLocked || !props.importContent.trim()} className="rounded-xl bg-stone-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{text("저장", "Save")}</button>
          </div>
          {props.importResult ? <EffectSummary result={props.importResult} /> : null}
        </div>
      </div>
    </section>
  )
}

function RuntimeSubSessionPanel(props: {
  parentRunId: string
  subSessions: OrchestrationSubSessionListResponse | null
  onParentRunIdChange: (value: string) => void
  onLoad: () => void
}) {
  const { text } = useUiI18n()
  const items = props.subSessions?.items ?? []
  return (
    <section className="rounded-[2rem] border border-stone-200 bg-white p-6 shadow-sm">
      <div className="text-sm font-semibold text-stone-950">{text("실행 중 서브 세션", "Runtime sub-sessions")}</div>
      <p className="mt-2 text-sm leading-6 text-stone-600">
        {text("부모 runId를 입력하면 running, waiting, blocked, needs_revision 같은 상태를 확인할 수 있습니다.", "Enter a parent runId to inspect running, waiting, blocked, and needs_revision sub-session states.")}
      </p>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <input value={props.parentRunId} onChange={(event) => props.onParentRunIdChange(event.target.value)} className="min-h-11 flex-1 rounded-xl border border-stone-200 px-3 py-2 text-sm" placeholder="run:..." />
        <button type="button" onClick={props.onLoad} disabled={!props.parentRunId.trim()} className="rounded-xl bg-stone-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{text("조회", "Load")}</button>
      </div>
      <div className="mt-4 space-y-2">
        {items.length === 0 ? <p className="text-sm text-stone-500">{text("표시할 서브 세션이 없습니다.", "No sub-sessions to show.")}</p> : null}
        {items.map((item, index) => {
          const record = item as Record<string, unknown>
          return (
            <div key={String(record.subSessionId ?? index)} className="rounded-2xl border border-stone-200 bg-stone-50 p-3 text-sm">
              <div className="font-semibold text-stone-950">{String(record.agentDisplayName ?? record.agentId ?? "sub-session")}</div>
              <div className="mt-1 text-xs text-stone-500">{String(record.subSessionId ?? "-")} · {String(record.status ?? "-")}</div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function AdminDiagnosticsPanel(props: {
  registry: OrchestrationRegistrySnapshot | null
  graph: OrchestrationGraphResponse | null
  generatedAt?: number
  formatDateTime: (value: number) => string
}) {
  const { text } = useUiI18n()
  return (
    <section className="rounded-[2rem] border border-stone-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-stone-950">{text("어드민 진단 데이터", "Admin diagnostics")}</div>
          <p className="mt-2 text-sm text-stone-600">{text("명시적으로 관리자 모드가 열린 경우에만 원본 구조를 확인합니다.", "Raw structures are shown only when admin mode is explicitly available.")}</p>
        </div>
        {props.generatedAt ? <span className="rounded-full bg-stone-100 px-3 py-1 text-xs font-semibold text-stone-600">{props.formatDateTime(props.generatedAt)}</span> : null}
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <pre className="max-h-96 overflow-auto rounded-2xl bg-stone-900 p-4 text-xs text-stone-100">{JSON.stringify(props.registry, null, 2)}</pre>
        <pre className="max-h-96 overflow-auto rounded-2xl bg-stone-900 p-4 text-xs text-stone-100">{JSON.stringify(props.graph, null, 2)}</pre>
      </div>
    </section>
  )
}

function ListPanel({ title, empty, children }: { title: string; empty: string; children: React.ReactNode }) {
  return (
    <div className="rounded-3xl border border-stone-200 bg-white p-4">
      <div className="text-sm font-semibold text-stone-950">{title}</div>
      <div className="mt-3 space-y-2">
        {children}
        {Array.isArray(children) && children.length === 0 ? <p className="text-sm text-stone-500">{empty}</p> : null}
      </div>
    </div>
  )
}

function ActionRow({ onValidate, onSave, disabled }: { onValidate: () => void; onSave: () => void; disabled: boolean }) {
  const { text } = useUiI18n()
  return (
    <div className="mt-4 flex flex-wrap gap-2">
      <button type="button" onClick={onValidate} disabled={disabled} className="rounded-xl border border-stone-200 bg-white px-4 py-2.5 text-sm font-semibold text-stone-700 disabled:opacity-50">{text("검증만", "Validate only")}</button>
      <button type="button" onClick={onSave} disabled={disabled} className="rounded-xl bg-stone-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{text("저장", "Save")}</button>
    </div>
  )
}

function EffectSummary({ result }: { result: { validationOnly?: boolean; stored?: boolean; effectSummary?: string[]; safeMessage?: string; issues?: Array<{ message: string }> } | null }) {
  if (!result) return null
  return (
    <div className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm leading-6 text-emerald-900">
      <div className="font-semibold">{result.validationOnly ? "validation-only" : result.stored ? "stored" : "result"}</div>
      {result.safeMessage ? <div>{result.safeMessage}</div> : null}
      {(result.effectSummary ?? []).map((item) => <div key={item}>- {item}</div>)}
      {(result.issues ?? []).map((item) => <div key={item.message}>! {item.message}</div>)}
    </div>
  )
}

function TextInput({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
  return (
    <label className="mt-3 block text-xs font-semibold text-stone-600">
      {label}
      <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="mt-1 min-h-10 w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm" />
    </label>
  )
}

function TextArea({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="mt-3 block text-xs font-semibold text-stone-600">
      {label}
      <textarea value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 min-h-24 w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm" />
    </label>
  )
}

function CheckboxInput({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="flex min-h-10 items-center gap-2 rounded-xl border border-stone-200 bg-stone-50 px-3 py-2">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="h-4 w-4 rounded border-stone-300" />
      <span>{label}</span>
    </label>
  )
}

function FormTitle({ title }: { title: string }) {
  return <div className="text-sm font-semibold text-stone-950">{title}</div>
}

function StatusButton({ label, onClick, disabled = false }: { label: string; onClick: () => void; disabled?: boolean }) {
  return <button type="button" onClick={onClick} disabled={disabled} className="rounded-full border border-stone-200 bg-white px-2 py-1 text-xs font-semibold text-stone-700 disabled:opacity-50">{label}</button>
}

function PreviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-stone-200 bg-stone-50 p-3">
      <div className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-400">{label}</div>
      <div className="mt-1 whitespace-pre-wrap text-sm leading-6 text-stone-800">{value}</div>
    </div>
  )
}

function Notice({ tone, title, message }: { tone: "info" | "error"; title: string; message: string }) {
  return (
    <div className={`rounded-2xl border px-4 py-3 text-sm leading-6 ${tone === "error" ? "border-red-200 bg-red-50 text-red-800" : "border-sky-200 bg-sky-50 text-sky-900"}`}>
      <div className="font-semibold">{title}</div>
      <div className="mt-1">{message}</div>
    </div>
  )
}

function resolveSelectedNodeIdAfterReload(
  selectedNodeId: string | undefined,
  agents: OrchestrationAgentRegistryEntry[],
  teams: OrchestrationTeamRegistryEntry[],
): string | undefined {
  if (!selectedNodeId) return undefined
  if (selectedNodeId.startsWith("agent:")) {
    const agentId = selectedNodeId.slice("agent:".length)
    return agents.some((agent) => agent.agentId === agentId) ? selectedNodeId : undefined
  }
  if (selectedNodeId.startsWith("team:")) {
    const teamId = selectedNodeId.slice("team:".length)
    return teams.some((team) => team.teamId === teamId) ? selectedNodeId : undefined
  }
  return undefined
}

function summaryToneClass(tone: "neutral" | "ready" | "warning" | "danger"): string {
  switch (tone) {
    case "ready": return "border-emerald-200 bg-emerald-50 text-emerald-950"
    case "warning": return "border-amber-200 bg-amber-50 text-amber-950"
    case "danger": return "border-red-200 bg-red-50 text-red-950"
    case "neutral": return "border-stone-200 bg-white text-stone-950"
  }
}

function nodeToneClass(tone: "coordinator" | "agent" | "team" | "runtime" | "disabled"): string {
  switch (tone) {
    case "coordinator": return "border-stone-900 bg-stone-900 text-white"
    case "agent": return "border-sky-200 bg-sky-50 text-sky-950"
    case "team": return "border-emerald-200 bg-emerald-50 text-emerald-950"
    case "runtime": return "border-violet-200 bg-violet-50 text-violet-950"
    case "disabled": return "border-stone-200 bg-stone-100 text-stone-500"
  }
}

function edgeToneClass(tone: "delegation" | "data" | "permission" | "capability" | "team"): string {
  switch (tone) {
    case "delegation": return "bg-sky-100 text-sky-800"
    case "data": return "bg-cyan-100 text-cyan-800"
    case "permission": return "bg-amber-100 text-amber-800"
    case "capability": return "bg-fuchsia-100 text-fuchsia-800"
    case "team": return "bg-emerald-100 text-emerald-800"
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
