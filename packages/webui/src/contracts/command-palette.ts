export type CommandPaletteResultKind =
  | "agent"
  | "team"
  | "sub_session"
  | "command"
  | "agent_template"
  | "team_template"

export type FocusTargetKind = "agent" | "team" | "sub_session"

export interface FocusTarget {
  kind: FocusTargetKind
  id: string
  label?: string
}

export interface FocusBinding {
  schemaVersion: 1
  threadId: string
  parentAgentId: string
  target: FocusTarget
  source: "api" | "command_palette" | "webui"
  reasonCode: "focus_bound_explicit_planner_target"
  finalAnswerOwner: "unchanged_parent"
  memoryIsolation: "unchanged"
  createdAt: number
  updatedAt: number
}

export interface FocusResolveSuccess {
  ok: true
  binding: FocusBinding
  plannerIntent: { explicitAgentId?: string; explicitTeamId?: string }
  plannerTarget: {
    kind: "explicit_agent" | "explicit_team"
    id: string
    sourceTarget: FocusTarget
  }
  enforcement: {
    directChildVisibility: "checked"
    permissionVisibility: "checked"
    finalAnswerOwnerUnchanged: true
    memoryIsolationUnchanged: true
    reasonCodes: string[]
  }
}

export interface CommandPaletteSearchResult {
  id: string
  kind: CommandPaletteResultKind
  title: string
  subtitle?: string
  status?: string
  target?: FocusTarget
  command?: string
  route?: string
  reasonCodes: string[]
}

export interface CommandPaletteSearchResponse {
  query: string
  generatedAt: number
  results: CommandPaletteSearchResult[]
}

export interface CommandExecuteResponse {
  ok: boolean
  command: string
  reasonCode: string
  result?: unknown
  statusCode?: number
}

export interface AgentDescriptionLintWarning {
  code:
    | "description_too_short"
    | "description_too_broad"
    | "missing_domain_or_specialty"
    | "missing_boundaries"
  severity: "warning"
  message: string
  matched?: string
}
