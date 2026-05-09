import type {
  EnterpriseEntityRef,
  EnterpriseEntityStatus,
  EnterpriseRelationType,
  EnterpriseTimestamp,
  EnterpriseTopology,
  EnterpriseTopologyValidationIssue,
  EnterpriseTopologyValidationResult,
  FailurePolicy,
  FailureReport,
  NodeTemplateRef,
  NodeType,
  RecoveryPolicy,
  TraceEvent,
  WorkOrder,
} from "../contracts/enterprise-topology"
import { ENTERPRISE_RELATION_TYPES } from "../contracts/enterprise-topology"

export const ENTERPRISE_TOPOLOGY_GUI_DRAFT_SCHEMA_VERSION = 1 as const

export type EnterpriseTopologyGuiDraftSchemaVersion = typeof ENTERPRISE_TOPOLOGY_GUI_DRAFT_SCHEMA_VERSION
export type EnterpriseTopologyGuiOperationScope = "structural" | "layout"
export type EnterpriseTopologyGuiOperationKind =
  | "createNode"
  | "updateNode"
  | "moveNode"
  | "deleteNode"
  | "createRelation"
  | "updateRelation"
  | "deleteRelation"
export type EnterpriseTopologyGuiCommandKind = EnterpriseTopologyGuiOperationKind | "undo" | "redo"

export interface EnterpriseTopologyGuiPosition {
  x: number
  y: number
}

export interface EnterpriseTopologyGuiNodeLayout extends EnterpriseTopologyGuiPosition {
  collapsed?: boolean
}

export interface EnterpriseTopologyGuiLayout {
  nodes: Record<string, EnterpriseTopologyGuiNodeLayout>
  viewport?: {
    x: number
    y: number
    zoom: number
  }
}

export interface EnterpriseTopologyGuiOperationBase {
  schemaVersion: EnterpriseTopologyGuiDraftSchemaVersion
  operationId: string
  op: EnterpriseTopologyGuiOperationKind
  at: EnterpriseTimestamp
  actor?: string
  label?: string
}

export interface EnterpriseTopologyGuiCreateNodeOperation extends EnterpriseTopologyGuiOperationBase {
  op: "createNode"
  nodeId: string
  name?: string
  nodeType?: NodeType
  position?: EnterpriseTopologyGuiPosition
  templateId?: string
}

export interface EnterpriseTopologyGuiUpdateNodePatch {
  name?: string
  displayName?: string
  description?: string
  nodeType?: NodeType
  status?: EnterpriseEntityStatus
  tags?: string[]
  children?: string[]
  template?: NodeTemplateRef
  allowedToolIds?: string[]
  allowedSystemIds?: string[]
  owner?: EnterpriseEntityRef<"position" | "org_unit" | "person" | "enterprise_system">
  failurePolicy?: FailurePolicy
  recoveryPolicy?: RecoveryPolicy
}

export interface EnterpriseTopologyGuiUpdateNodeOperation extends EnterpriseTopologyGuiOperationBase {
  op: "updateNode"
  nodeId: string
  patch: EnterpriseTopologyGuiUpdateNodePatch
}

export interface EnterpriseTopologyGuiMoveNodeOperation extends EnterpriseTopologyGuiOperationBase {
  op: "moveNode"
  nodeId: string
  position: EnterpriseTopologyGuiPosition
  collapsed?: boolean
}

export interface EnterpriseTopologyGuiDeleteNodeOperation extends EnterpriseTopologyGuiOperationBase {
  op: "deleteNode"
  nodeId: string
}

export interface EnterpriseTopologyGuiCreateRelationOperation extends EnterpriseTopologyGuiOperationBase {
  op: "createRelation"
  relationId: string
  relationType: EnterpriseRelationType
  from: EnterpriseEntityRef
  to: EnterpriseEntityRef
  name?: string
  label?: string
}

export interface EnterpriseTopologyGuiUpdateRelationPatch {
  relationType?: EnterpriseRelationType
  from?: EnterpriseEntityRef
  to?: EnterpriseEntityRef
  name?: string
  label?: string
  status?: EnterpriseEntityStatus
}

export interface EnterpriseTopologyGuiUpdateRelationOperation extends EnterpriseTopologyGuiOperationBase {
  op: "updateRelation"
  relationId: string
  patch: EnterpriseTopologyGuiUpdateRelationPatch
}

export interface EnterpriseTopologyGuiDeleteRelationOperation extends EnterpriseTopologyGuiOperationBase {
  op: "deleteRelation"
  relationId: string
}

export type EnterpriseTopologyGuiOperation =
  | EnterpriseTopologyGuiCreateNodeOperation
  | EnterpriseTopologyGuiUpdateNodeOperation
  | EnterpriseTopologyGuiMoveNodeOperation
  | EnterpriseTopologyGuiDeleteNodeOperation
  | EnterpriseTopologyGuiCreateRelationOperation
  | EnterpriseTopologyGuiUpdateRelationOperation
  | EnterpriseTopologyGuiDeleteRelationOperation

export interface EnterpriseTopologyGuiUndoCommand {
  schemaVersion: EnterpriseTopologyGuiDraftSchemaVersion
  operationId: string
  op: "undo"
  at: EnterpriseTimestamp
  actor?: string
}

export interface EnterpriseTopologyGuiRedoCommand {
  schemaVersion: EnterpriseTopologyGuiDraftSchemaVersion
  operationId: string
  op: "redo"
  at: EnterpriseTimestamp
  actor?: string
}

export type EnterpriseTopologyGuiCommand =
  | EnterpriseTopologyGuiOperation
  | EnterpriseTopologyGuiUndoCommand
  | EnterpriseTopologyGuiRedoCommand

export type EnterpriseTopologyQuickFixId =
  | "set_start_node"
  | "add_child_task"
  | "add_approval_step"
  | "connect_selected_nodes"
  | "add_tool_permission"
  | "add_fallback_path"
  | "set_output_preset"

export interface EnterpriseTopologyQuickFixOperationPreview {
  operationId: string
  op: EnterpriseTopologyGuiOperationKind
  targetId: string
  summary: string
}

export interface EnterpriseTopologyQuickFixOperationPlan {
  quickFixId: EnterpriseTopologyQuickFixId
  label: string
  operations: EnterpriseTopologyGuiOperation[]
  preview: EnterpriseTopologyQuickFixOperationPreview[]
}

export interface EnterpriseTopologyGuiPendingState {
  operationLog: EnterpriseTopologyGuiOperation[]
  redoStack: EnterpriseTopologyGuiOperation[]
}

export interface EnterpriseTopologyGuiPendingDeletes {
  nodeIds: string[]
  relationIds: string[]
}

export type EnterpriseTopologyGuiValidation = EnterpriseTopologyValidationResult

export interface EnterpriseTopologyGuiDraft {
  schemaVersion: EnterpriseTopologyGuiDraftSchemaVersion
  draftId: string
  topologyId: string
  baseTopology: EnterpriseTopology
  baseLayout: EnterpriseTopologyGuiLayout
  topology: EnterpriseTopology
  layout: EnterpriseTopologyGuiLayout
  operationLog: EnterpriseTopologyGuiOperation[]
  redoStack: EnterpriseTopologyGuiOperation[]
  pendingDeletes: EnterpriseTopologyGuiPendingDeletes
  validation: EnterpriseTopologyGuiValidation
  revision: number
  structuralRevision: number
  layoutRevision: number
  createdAt: EnterpriseTimestamp
  updatedAt: EnterpriseTimestamp
}

export interface EnterpriseTopologyGuiDraftStartRequest {
  topology?: EnterpriseTopology
  version?: number
  reset?: boolean
  persist?: boolean
  createdBy?: string
  importSource?: string
}

export interface EnterpriseTopologyGuiDraftResponse {
  ok: true
  draft: EnterpriseTopologyGuiDraft | null
  reused?: boolean
  source?: "memory" | "registry" | "empty"
  version?: number
  persisted?: boolean
  persistError?: string
  persistIssues?: unknown
  persistedVersion?: {
    version: number
    versionId: string
    topologyId: string
  }
}

export interface EnterpriseTopologyGuiDraftOperationsRequest {
  operations: EnterpriseTopologyGuiCommand[]
}

export interface EnterpriseTopologyGuiDraftOperationsResponse {
  ok: true
  draft: EnterpriseTopologyGuiDraft
  applied: EnterpriseTopologyGuiCommand[]
  structuralChanged: boolean
  layoutChanged: boolean
  validation: EnterpriseTopologyGuiValidation
}

export interface EnterpriseTopologyGuiDraftIssuesResponse {
  ok: true
  topologyId: string
  draftId: string
  validation: EnterpriseTopologyGuiValidation
  issues: EnterpriseTopologyValidationIssue[]
}

export interface EnterpriseTopologyCompiledDelegationTree {
  rootNodeIds: string[]
  entryNodeId: string | null
  exitNodeIds: string[]
  edges: Record<string, string[]>
  parents: Record<string, string[]>
}

export interface EnterpriseTopologyRuntimeProfilePreview {
  nodeId: string
  name: string
  nodeType: NodeType
  childNodeIds: string[]
  parentNodeIds: string[]
  allowedToolIds: string[]
  allowedSystemIds: string[]
  failureReportRequired: boolean
}

export interface EnterpriseTopologyWorkOrderPreview {
  workOrderId: string
  topologyRunId: string
  parentWorkOrderId: string | null
  fromNodeId: string
  to: { type: string; id: string }
  objective: string
  scope: { included: string[]; excluded: string[] }
  successCriteria: Array<{
    criterionId: string
    description: string
    required: boolean
    validationKind: string
  }>
  permissionScope: {
    allowedToolIds: string[]
    allowedSystemIds: string[]
    dataDomainIds: string[]
    riskLevel?: string
  }
  authorityScope: {
    requiredAuthorityRuleIds: string[]
    approvalRequired: boolean
  }
  failureReportRequired: boolean
  delegationPath: string[]
  createdAt: EnterpriseTimestamp
}

export type EnterpriseTopologyGuiDraftCompiledPreviewResponse =
  | {
      ok: true
      topologyId: string
      draftId: string
      compiledTopologySnapshotId: string
      validation: EnterpriseTopologyGuiValidation
      delegationTree: EnterpriseTopologyCompiledDelegationTree
      runtimeExecutionContext: {
        topologyId: string
        entryNodeId: string | null
        exitNodeIds: string[]
        nodeCount: number
        delegationEdgeCount: number
      }
      runtimeProfiles: EnterpriseTopologyRuntimeProfilePreview[]
      workOrderPreview: EnterpriseTopologyWorkOrderPreview | null
      snapshot?: unknown
    }
  | {
      ok: false
      topologyId: string
      draftId: string
      validation: EnterpriseTopologyGuiValidation
      issues: EnterpriseTopologyValidationIssue[]
    }

export interface GraphExecutionPlanPreviewResponse {
  ok: true
  topologyId: string
  draftId: string
  graphExecutionPlanId: string
  plan: unknown
  validationWarnings: string[]
  record: {
    graphExecutionPlanId: string
    status: string
    createdAt: number
    updatedAt: number
  }
}

export interface EnterpriseTopologyGuiDraftValidateResponse {
  ok: true
  topologyId: string
  draftId: string
  validation: EnterpriseTopologyGuiValidation
  issues: EnterpriseTopologyValidationIssue[]
}

export type TopologyImportExportFormat = "json" | "yaml"

export interface EnterpriseTopologyExportResponse {
  ok: true
  format: TopologyImportExportFormat
  filename: string
  content: string
  topology: EnterpriseTopology
  export: unknown
}

export interface EnterpriseTopologyImportRequest {
  topology?: EnterpriseTopology
  content?: string
  format?: TopologyImportExportFormat
  sourceRef?: string
  activate?: boolean
  dryRun?: boolean
  createdBy?: string
  importSource?: string
}

export interface EnterpriseTopologyImportResponse {
  ok: true
  dryRun?: boolean
  format: TopologyImportExportFormat
  topology?: EnterpriseTopology
  imported?: unknown
  activation?: unknown
  validation: EnterpriseTopologyGuiValidation
  issues: EnterpriseTopologyValidationIssue[]
}

export type AgentTeamImportMode = "team" | "skip"

export interface AgentTeamTopologyImportTransformation {
  sourceType: "AgentConfig" | "TeamConfig" | "AgentRelationship"
  sourceId: string
  targetType: "NodeContract" | "Team" | "Relation"
  targetId: string
  summary: string
}

export interface AgentTeamTopologyImportPreviewResponse {
  ok: true
  topology: EnterpriseTopology
  validation: EnterpriseTopologyGuiValidation
  transformations: AgentTeamTopologyImportTransformation[]
  metadata: {
    agentCount: number
    teamCount: number
    relationshipCount: number
    teamImportMode: AgentTeamImportMode
    teamRequiresExplicitChoice: boolean
    sourceOfTruth: "enterprise_topology_draft"
    legacySourceRole: "migration_source_only"
  }
}

export type WorkOrderTemplateSimulationMode = "success" | "failure"

export interface WorkOrderTemplateContextPreset {
  id: string
  labelKo: string
  labelEn: string
  input: Record<string, unknown>
}

export interface WorkOrderTemplatePreset {
  templateId: string
  labelKo: string
  labelEn: string
  descriptionKo: string
  descriptionEn: string
  objective: string
  scopeIncluded: string[]
  scopeExcluded: string[]
  expectedOutputSchema: Record<string, unknown>
  successCriteria: Array<{
    criterionId: string
    description: string
    required: boolean
    validationKind: string
  }>
  contextPresets: WorkOrderTemplateContextPreset[]
  defaultSimulationMode: WorkOrderTemplateSimulationMode
}

export interface WorkOrderTemplateCatalog {
  schemaVersion: 1
  templates: WorkOrderTemplatePreset[]
}

export interface WorkOrderTemplateCatalogResponse {
  ok: true
  catalog: WorkOrderTemplateCatalog
  templates: WorkOrderTemplatePreset[]
}

export interface EnterpriseTopologyRunRecord {
  topologyRunId: string
  topologyId: string
  status: string
  entryNodeId?: string
  startedAt: number
  finishedAt?: number
  createdAt: number
  updatedAt: number
  metadata?: unknown
}

export interface EnterpriseTopologyTraceEventRecord {
  traceEventId: string
  topologyRunId: string
  nodeRunId: string
  workOrderId: string
  parentWorkOrderId?: string
  phase: TraceEvent["phase"]
  component: string
  reasonCode: string
  delegationPath: string[]
  payload?: unknown
  event: TraceEvent
  at: number
  sequence: number
}

export interface EnterpriseTopologyFailureReportRecord {
  failureReportId: string
  topologyRunId: string
  nodeRunId: string
  workOrderId: string
  nodeId: string
  failurePhase: string
  report: FailureReport
  createdAt: number
}

export interface EnterpriseTopologyToolCallRecord {
  toolCallId: string
  topologyRunId: string
  nodeRunId: string
  workOrderId: string
  toolId: string
  dispatcherToolName: string
  status: string
  reasonCode: string
  retryPossible: boolean
  fallbackPossible: boolean
  startedAt: number
  completedAt?: number
  result: unknown
}

export interface EnterpriseTopologyWorkOrderRecord {
  workOrderId: string
  topologyRunId: string
  nodeRunId?: string
  parentWorkOrderId?: string
  fromNodeId: string
  toType: string
  toId: string
  delegationPath: string[]
  workOrder: WorkOrder
  createdAt: number
}

export interface EnterpriseTopologyObservedEdgeRecord {
  edgeId: string
  topologyId: string
  topologyRunId?: string
  fromNodeId: string
  toNodeId: string
  edgeKind: string
  source: string
  confidence: number
  firstSeenAt: number
  lastSeenAt: number
  evidence?: unknown
}

export interface EnterpriseTopologyRunTraceProjection {
  run: EnterpriseTopologyRunRecord
  nodeRuns: unknown[]
  workOrders: EnterpriseTopologyWorkOrderRecord[]
  resultReports: unknown[]
  failureReports: EnterpriseTopologyFailureReportRecord[]
  traceEvents: EnterpriseTopologyTraceEventRecord[]
  toolCalls: EnterpriseTopologyToolCallRecord[]
  observedEdges: EnterpriseTopologyObservedEdgeRecord[]
  gapFindings: unknown[]
}

export interface EnterpriseTopologyGuiDraftRunRequest {
  entryNodeId: string
  templateId: string
  contextPresetId?: string
  input?: Record<string, unknown>
  advancedInstruction?: string
  simulationMode?: WorkOrderTemplateSimulationMode
}

export interface EnterpriseTopologyGuiDraftRunResponse {
  ok: true
  topologyId: string
  draftId: string
  topologyRunId: string
  entryNodeId: string
  templateId: string
  contextPresetId: string
  simulationMode: WorkOrderTemplateSimulationMode
  topologyRun: EnterpriseTopologyRunTraceProjection
}

export interface EnterpriseTopologyRunListResponse {
  ok: true
  topologyRuns: EnterpriseTopologyRunRecord[]
}

export interface EnterpriseTopologyRunProjectionResponse {
  ok: true
  topologyRun: EnterpriseTopologyRunTraceProjection
}

export interface EnterpriseTopologyRunTraceResponse {
  ok: true
  traceEvents: EnterpriseTopologyTraceEventRecord[]
}

export interface EnterpriseTopologyRunFailureReportsResponse {
  ok: true
  failureReports: EnterpriseTopologyFailureReportRecord[]
}

export function enterpriseTopologyGuiOperationScope(
  operation: EnterpriseTopologyGuiCommand,
): EnterpriseTopologyGuiOperationScope {
  return operation.op === "moveNode" ? "layout" : "structural"
}

export function isEnterpriseRelationType(value: string): value is EnterpriseRelationType {
  return (ENTERPRISE_RELATION_TYPES as readonly string[]).includes(value)
}

export function createGuiDraftOperationId(prefix: string, at: EnterpriseTimestamp = Date.now()): string {
  return `${prefix}:${at}:${Math.random().toString(36).slice(2, 10)}`
}

export function createGuiDraftOperationBase<TKind extends EnterpriseTopologyGuiOperationKind>(
  op: TKind,
  input: { operationId?: string; at?: EnterpriseTimestamp; actor?: string; label?: string } = {},
): Omit<EnterpriseTopologyGuiOperationBase, "op"> & { op: TKind } {
  const at = input.at ?? Date.now()
  return {
    schemaVersion: ENTERPRISE_TOPOLOGY_GUI_DRAFT_SCHEMA_VERSION,
    operationId: input.operationId ?? createGuiDraftOperationId(op, at),
    op,
    at,
    ...(input.actor ? { actor: input.actor } : {}),
    ...(input.label ? { label: input.label } : {}),
  }
}

export function buildCreateNodeGuiOperation(input: {
  nodeId: string
  name?: string
  nodeType?: NodeType
  position?: EnterpriseTopologyGuiPosition
  templateId?: string
  operationId?: string
  at?: EnterpriseTimestamp
  actor?: string
}): EnterpriseTopologyGuiCreateNodeOperation {
  return {
    ...createGuiDraftOperationBase("createNode", input),
    nodeId: input.nodeId,
    ...(input.name ? { name: input.name } : {}),
    ...(input.nodeType ? { nodeType: input.nodeType } : {}),
    ...(input.position ? { position: input.position } : {}),
    ...(input.templateId ? { templateId: input.templateId } : {}),
  }
}

export function buildMoveNodeGuiOperation(input: {
  nodeId: string
  position: EnterpriseTopologyGuiPosition
  collapsed?: boolean
  operationId?: string
  at?: EnterpriseTimestamp
  actor?: string
}): EnterpriseTopologyGuiMoveNodeOperation {
  return {
    ...createGuiDraftOperationBase("moveNode", input),
    nodeId: input.nodeId,
    position: input.position,
    ...(input.collapsed !== undefined ? { collapsed: input.collapsed } : {}),
  }
}

export function reduceEnterpriseTopologyGuiPendingState(
  state: EnterpriseTopologyGuiPendingState,
  command: EnterpriseTopologyGuiCommand,
): EnterpriseTopologyGuiPendingState {
  if (command.op === "undo") {
    const operationLog = state.operationLog.slice(0, -1)
    const undone = state.operationLog[state.operationLog.length - 1]
    return undone
      ? { operationLog, redoStack: [...state.redoStack, undone] }
      : state
  }
  if (command.op === "redo") {
    const redoStack = state.redoStack.slice(0, -1)
    const redone = state.redoStack[state.redoStack.length - 1]
    return redone
      ? { operationLog: [...state.operationLog, redone], redoStack }
      : state
  }
  return { operationLog: [...state.operationLog, command], redoStack: [] }
}
