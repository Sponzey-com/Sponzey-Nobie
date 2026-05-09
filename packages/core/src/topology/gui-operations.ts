import type {
  EnterpriseEntityRef,
  EnterpriseRelation,
  EnterpriseRelationType,
  EnterpriseTimestamp,
  EnterpriseTopology,
  EnterpriseEntityStatus,
  FailurePolicy,
  NodeTemplateRef,
  NodeContract,
  NodeType,
  RecoveryPolicy,
} from "../contracts/enterprise-topology.js"
import {
  ENTERPRISE_RELATION_TYPES,
  ENTERPRISE_TOPOLOGY_SCHEMA_VERSION,
} from "../contracts/enterprise-topology.js"
import { repairTopologyForPersistence } from "./repair.js"
import { validateTopology, type TopologyValidationResult } from "./validator.js"

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

export interface EnterpriseTopologyGuiPendingDeletes {
  nodeIds: string[]
  relationIds: string[]
}

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
  validation: TopologyValidationResult
  revision: number
  structuralRevision: number
  layoutRevision: number
  createdAt: EnterpriseTimestamp
  updatedAt: EnterpriseTimestamp
}

export interface CreateEnterpriseTopologyGuiDraftInput {
  topology: EnterpriseTopology
  draftId?: string
  layout?: EnterpriseTopologyGuiLayout
  now?: EnterpriseTimestamp
}

export interface ApplyEnterpriseTopologyGuiCommandsResult {
  draft: EnterpriseTopologyGuiDraft
  applied: EnterpriseTopologyGuiCommand[]
  structuralChanged: boolean
  layoutChanged: boolean
}

export type EnterpriseTopologyGuiOperationIssueCode =
  | "invalid_gui_operation_payload"
  | "duplicate_node"
  | "node_not_found"
  | "duplicate_relation"
  | "relation_not_found"
  | "empty_undo_stack"
  | "empty_redo_stack"

export interface EnterpriseTopologyGuiOperationIssue {
  path: string
  reasonCode: EnterpriseTopologyGuiOperationIssueCode
  message: string
}

export class EnterpriseTopologyGuiOperationError extends Error {
  readonly issue: EnterpriseTopologyGuiOperationIssue

  constructor(issue: EnterpriseTopologyGuiOperationIssue) {
    super(issue.message)
    this.name = "EnterpriseTopologyGuiOperationError"
    this.issue = issue
  }
}

function cloneTopology(topology: EnterpriseTopology): EnterpriseTopology {
  return structuredClone(topology)
}

function cloneLayout(layout: EnterpriseTopologyGuiLayout): EnterpriseTopologyGuiLayout {
  return structuredClone(layout)
}

function defaultDraftId(topologyId: string): string {
  return `gui-draft:${topologyId}`
}

function operationIssue(
  path: string,
  reasonCode: EnterpriseTopologyGuiOperationIssueCode,
  message: string,
): EnterpriseTopologyGuiOperationIssue {
  return { path, reasonCode, message }
}

function throwOperationIssue(
  path: string,
  reasonCode: EnterpriseTopologyGuiOperationIssueCode,
  message: string,
): never {
  throw new EnterpriseTopologyGuiOperationError(operationIssue(path, reasonCode, message))
}

function updateTopologyTimestamp(topology: EnterpriseTopology, at: EnterpriseTimestamp): void {
  topology.updatedAt = at
}

function uniqueValues(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))]
}

function findNode(topology: EnterpriseTopology, nodeId: string): NodeContract | undefined {
  return topology.nodes.find((node) => node.id === nodeId)
}

function findRelation(topology: EnterpriseTopology, relationId: string): EnterpriseRelation | undefined {
  return topology.relations.find((relation) => relation.id === relationId)
}

function hasTopologyEntity(topology: EnterpriseTopology, entity: EnterpriseEntityRef): boolean {
  if (entity.entityType === "topology") return topology.id === entity.id
  if (entity.entityType === "node") return topology.nodes.some((item) => item.id === entity.id)
  if (entity.entityType === "team") return topology.teams.some((item) => item.id === entity.id)
  if (entity.entityType === "org_unit") return topology.orgUnits.some((item) => item.id === entity.id)
  if (entity.entityType === "position") return topology.positions.some((item) => item.id === entity.id)
  if (entity.entityType === "person") return topology.persons.some((item) => item.id === entity.id)
  if (entity.entityType === "membership") return topology.memberships.some((item) => item.id === entity.id)
  if (entity.entityType === "authority_rule") return topology.authorityRules.some((item) => item.id === entity.id)
  if (entity.entityType === "responsibility_matrix_entry") return topology.responsibilities.some((item) => item.id === entity.id)
  if (entity.entityType === "enterprise_system") return topology.systems.some((item) => item.id === entity.id)
  if (entity.entityType === "enterprise_tool") return topology.tools.some((item) => item.id === entity.id)
  if (entity.entityType === "process_definition") return topology.processes.some((item) => item.id === entity.id)
  if (entity.entityType === "relation") return topology.relations.some((item) => item.id === entity.id)
  if (entity.entityType === "topology_version") return false
  return false
}

function relationDisplayName(operation: EnterpriseTopologyGuiCreateRelationOperation): string {
  return operation.name ?? operation.label ?? `${operation.from.id} ${operation.relationType} ${operation.to.id}`
}

function defaultNode(operation: EnterpriseTopologyGuiCreateNodeOperation): NodeContract {
  return {
    schemaVersion: ENTERPRISE_TOPOLOGY_SCHEMA_VERSION,
    entityType: "node",
    id: operation.nodeId,
    name: operation.name ?? "새 업무 노드",
    status: "draft",
    createdAt: operation.at,
    updatedAt: operation.at,
    nodeType: operation.nodeType ?? "function",
    tags: [],
    children: [],
    ...(operation.templateId
      ? {
          template: {
            templateId: operation.templateId,
            source: "user_preset",
            fixedRoleCatalog: false,
          },
        }
      : {}),
    allowedToolIds: [],
    allowedSystemIds: [],
    failurePolicy: {
      failureReportRequired: true,
      allowPartialSuccess: true,
      fallbackNodeIds: [],
    },
    recoveryPolicy: {
      retryAllowed: false,
      redelegationAllowed: true,
      fallbackAllowed: false,
      partialSuccessAllowed: true,
    },
  }
}

function operationScope(operation: EnterpriseTopologyGuiCommand): EnterpriseTopologyGuiOperationScope {
  if (operation.op === "moveNode") return "layout"
  return "structural"
}

export function enterpriseTopologyGuiOperationScope(
  operation: EnterpriseTopologyGuiCommand,
): EnterpriseTopologyGuiOperationScope {
  return operationScope(operation)
}

function createRelation(operation: EnterpriseTopologyGuiCreateRelationOperation): EnterpriseRelation {
  return {
    schemaVersion: ENTERPRISE_TOPOLOGY_SCHEMA_VERSION,
    entityType: "relation",
    id: operation.relationId,
    name: relationDisplayName(operation),
    status: "draft",
    createdAt: operation.at,
    updatedAt: operation.at,
    relationType: operation.relationType,
    from: operation.from,
    to: operation.to,
    ...(operation.label ? { label: operation.label } : {}),
  }
}

function addRelationSideEffects(topology: EnterpriseTopology, relation: EnterpriseRelation): void {
  if (relation.status === "archived") return
  if (relation.from.entityType !== "node") return
  const node = findNode(topology, relation.from.id)
  if (!node) return

  if (relation.relationType === "delegates_to" && relation.to.entityType === "node") {
    node.children = uniqueValues([...node.children, relation.to.id])
  }
  if (relation.relationType === "uses_tool" && relation.to.entityType === "enterprise_tool") {
    node.allowedToolIds = uniqueValues([...node.allowedToolIds, relation.to.id])
  }
  if (relation.relationType === "uses_system" && relation.to.entityType === "enterprise_system") {
    node.allowedSystemIds = uniqueValues([...node.allowedSystemIds, relation.to.id])
  }
}

function hasAnotherActiveRelation(
  topology: EnterpriseTopology,
  relation: EnterpriseRelation,
  relationIdToIgnore: string,
): boolean {
  return topology.relations.some((candidate) =>
    candidate.id !== relationIdToIgnore &&
    candidate.status !== "archived" &&
    candidate.relationType === relation.relationType &&
    candidate.from.entityType === relation.from.entityType &&
    candidate.from.id === relation.from.id &&
    candidate.to.entityType === relation.to.entityType &&
    candidate.to.id === relation.to.id,
  )
}

function removeRelationSideEffects(topology: EnterpriseTopology, relation: EnterpriseRelation): void {
  if (relation.from.entityType !== "node") return
  if (hasAnotherActiveRelation(topology, relation, relation.id)) return
  const node = findNode(topology, relation.from.id)
  if (!node) return

  if (relation.relationType === "delegates_to" && relation.to.entityType === "node") {
    node.children = node.children.filter((childId) => childId !== relation.to.id)
  }
  if (relation.relationType === "uses_tool" && relation.to.entityType === "enterprise_tool") {
    node.allowedToolIds = node.allowedToolIds.filter((toolId) => toolId !== relation.to.id)
  }
  if (relation.relationType === "uses_system" && relation.to.entityType === "enterprise_system") {
    node.allowedSystemIds = node.allowedSystemIds.filter((systemId) => systemId !== relation.to.id)
  }
}

function applyCreateNode(
  topology: EnterpriseTopology,
  layout: EnterpriseTopologyGuiLayout,
  operation: EnterpriseTopologyGuiCreateNodeOperation,
): void {
  if (findNode(topology, operation.nodeId)) {
    throwOperationIssue("$.nodeId", "duplicate_node", `Node already exists: ${operation.nodeId}`)
  }
  topology.nodes.push(defaultNode(operation))
  if (operation.position) {
    layout.nodes[operation.nodeId] = { ...operation.position }
  }
  updateTopologyTimestamp(topology, operation.at)
}

function applyUpdateNode(topology: EnterpriseTopology, operation: EnterpriseTopologyGuiUpdateNodeOperation): void {
  const node = findNode(topology, operation.nodeId)
  if (!node) throwOperationIssue("$.nodeId", "node_not_found", `Node not found: ${operation.nodeId}`)
  const patch = operation.patch
  if (patch.name !== undefined) node.name = patch.name
  if (patch.displayName !== undefined) node.displayName = patch.displayName
  if (patch.description !== undefined) node.description = patch.description
  if (patch.nodeType !== undefined) node.nodeType = patch.nodeType
  if (patch.status !== undefined) node.status = patch.status
  if (patch.tags !== undefined) node.tags = uniqueValues(patch.tags)
  if (patch.children !== undefined) node.children = uniqueValues(patch.children)
  if (patch.template !== undefined) node.template = patch.template
  if (patch.allowedToolIds !== undefined) node.allowedToolIds = uniqueValues(patch.allowedToolIds)
  if (patch.allowedSystemIds !== undefined) node.allowedSystemIds = uniqueValues(patch.allowedSystemIds)
  if (patch.owner !== undefined) node.owner = patch.owner
  if (patch.failurePolicy !== undefined) node.failurePolicy = patch.failurePolicy
  if (patch.recoveryPolicy !== undefined) node.recoveryPolicy = patch.recoveryPolicy
  node.updatedAt = operation.at
  updateTopologyTimestamp(topology, operation.at)
}

function applyMoveNode(
  topology: EnterpriseTopology,
  layout: EnterpriseTopologyGuiLayout,
  operation: EnterpriseTopologyGuiMoveNodeOperation,
): void {
  if (!hasTopologyEntity(topology, { entityType: "node", id: operation.nodeId })) {
    throwOperationIssue("$.nodeId", "node_not_found", `Node not found: ${operation.nodeId}`)
  }
  layout.nodes[operation.nodeId] = {
    ...operation.position,
    ...(operation.collapsed !== undefined ? { collapsed: operation.collapsed } : {}),
  }
}

function applyDeleteNode(topology: EnterpriseTopology, operation: EnterpriseTopologyGuiDeleteNodeOperation): void {
  const node = findNode(topology, operation.nodeId)
  if (!node) throwOperationIssue("$.nodeId", "node_not_found", `Node not found: ${operation.nodeId}`)
  node.status = "archived"
  node.updatedAt = operation.at
  updateTopologyTimestamp(topology, operation.at)
}

function applyCreateRelation(topology: EnterpriseTopology, operation: EnterpriseTopologyGuiCreateRelationOperation): void {
  if (findRelation(topology, operation.relationId)) {
    throwOperationIssue("$.relationId", "duplicate_relation", `Relation already exists: ${operation.relationId}`)
  }
  const relation = createRelation(operation)
  topology.relations.push(relation)
  addRelationSideEffects(topology, relation)
  updateTopologyTimestamp(topology, operation.at)
}

function applyUpdateRelation(topology: EnterpriseTopology, operation: EnterpriseTopologyGuiUpdateRelationOperation): void {
  const relation = findRelation(topology, operation.relationId)
  if (!relation) throwOperationIssue("$.relationId", "relation_not_found", `Relation not found: ${operation.relationId}`)
  const before = structuredClone(relation)
  removeRelationSideEffects(topology, before)
  if (operation.patch.relationType !== undefined) relation.relationType = operation.patch.relationType
  if (operation.patch.from !== undefined) relation.from = operation.patch.from
  if (operation.patch.to !== undefined) relation.to = operation.patch.to
  if (operation.patch.name !== undefined) relation.name = operation.patch.name
  if (operation.patch.label !== undefined) relation.label = operation.patch.label
  if (operation.patch.status !== undefined) relation.status = operation.patch.status
  relation.updatedAt = operation.at
  addRelationSideEffects(topology, relation)
  updateTopologyTimestamp(topology, operation.at)
}

function applyDeleteRelation(topology: EnterpriseTopology, operation: EnterpriseTopologyGuiDeleteRelationOperation): void {
  const relation = findRelation(topology, operation.relationId)
  if (!relation) throwOperationIssue("$.relationId", "relation_not_found", `Relation not found: ${operation.relationId}`)
  removeRelationSideEffects(topology, relation)
  relation.status = "archived"
  relation.updatedAt = operation.at
  updateTopologyTimestamp(topology, operation.at)
}

function applyOperation(
  topology: EnterpriseTopology,
  layout: EnterpriseTopologyGuiLayout,
  operation: EnterpriseTopologyGuiOperation,
): void {
  if (operation.schemaVersion !== ENTERPRISE_TOPOLOGY_GUI_DRAFT_SCHEMA_VERSION) {
    throwOperationIssue("$.schemaVersion", "invalid_gui_operation_payload", "Unsupported GUI operation schema version.")
  }
  if (!operation.operationId.trim()) {
    throwOperationIssue("$.operationId", "invalid_gui_operation_payload", "GUI operation requires operationId.")
  }
  switch (operation.op) {
    case "createNode":
      applyCreateNode(topology, layout, operation)
      return
    case "updateNode":
      applyUpdateNode(topology, operation)
      return
    case "moveNode":
      applyMoveNode(topology, layout, operation)
      return
    case "deleteNode":
      applyDeleteNode(topology, operation)
      return
    case "createRelation":
      applyCreateRelation(topology, operation)
      return
    case "updateRelation":
      applyUpdateRelation(topology, operation)
      return
    case "deleteRelation":
      applyDeleteRelation(topology, operation)
      return
  }
}

function collectPendingDeletes(
  topology: EnterpriseTopology,
  operationLog: readonly EnterpriseTopologyGuiOperation[],
): EnterpriseTopologyGuiPendingDeletes {
  const deletedNodeIds = new Set<string>()
  const deletedRelationIds = new Set<string>()
  for (const operation of operationLog) {
    if (operation.op === "deleteNode") deletedNodeIds.add(operation.nodeId)
    if (operation.op === "deleteRelation") deletedRelationIds.add(operation.relationId)
    if (operation.op === "updateNode" && operation.patch.status && operation.patch.status !== "archived") {
      deletedNodeIds.delete(operation.nodeId)
    }
    if (operation.op === "updateRelation" && operation.patch.status && operation.patch.status !== "archived") {
      deletedRelationIds.delete(operation.relationId)
    }
  }

  return {
    nodeIds: [...deletedNodeIds].filter((nodeId) => findNode(topology, nodeId)?.status === "archived").sort(),
    relationIds: [...deletedRelationIds]
      .filter((relationId) => findRelation(topology, relationId)?.status === "archived")
      .sort(),
  }
}

function rebuildDraftFromOperationLog(input: {
  draft: EnterpriseTopologyGuiDraft
  operationLog: EnterpriseTopologyGuiOperation[]
  redoStack: EnterpriseTopologyGuiOperation[]
  structuralChanged: boolean
  updatedAt: EnterpriseTimestamp
}): EnterpriseTopologyGuiDraft {
  const topology = cloneTopology(input.draft.baseTopology)
  const layout = cloneLayout(input.draft.baseLayout)
  let structuralRevision = 0
  let layoutRevision = 0
  for (const operation of input.operationLog) {
    applyOperation(topology, layout, operation)
    if (operationScope(operation) === "layout") layoutRevision += 1
    else structuralRevision += 1
  }
  const validation = input.structuralChanged ? validateTopology(topology) : input.draft.validation

  return {
    ...input.draft,
    topology,
    layout,
    operationLog: [...input.operationLog],
    redoStack: [...input.redoStack],
    pendingDeletes: collectPendingDeletes(topology, input.operationLog),
    validation,
    revision: input.operationLog.length,
    structuralRevision,
    layoutRevision,
    updatedAt: input.updatedAt,
  }
}

export function createEnterpriseTopologyGuiDraft(
  input: CreateEnterpriseTopologyGuiDraftInput,
): EnterpriseTopologyGuiDraft {
  const now = input.now ?? Date.now()
  const baseTopology = repairTopologyForPersistence(input.topology).topology
  const layout = input.layout ? cloneLayout(input.layout) : { nodes: {} }
  const validation = validateTopology(baseTopology)
  return {
    schemaVersion: ENTERPRISE_TOPOLOGY_GUI_DRAFT_SCHEMA_VERSION,
    draftId: input.draftId ?? defaultDraftId(baseTopology.id),
    topologyId: baseTopology.id,
    baseTopology,
    baseLayout: cloneLayout(layout),
    topology: cloneTopology(baseTopology),
    layout,
    operationLog: [],
    redoStack: [],
    pendingDeletes: { nodeIds: [], relationIds: [] },
    validation,
    revision: 0,
    structuralRevision: 0,
    layoutRevision: 0,
    createdAt: now,
    updatedAt: now,
  }
}

export function applyEnterpriseTopologyGuiCommands(
  draft: EnterpriseTopologyGuiDraft,
  commands: EnterpriseTopologyGuiCommand[],
  options: { now?: EnterpriseTimestamp } = {},
): ApplyEnterpriseTopologyGuiCommandsResult {
  let operationLog = [...draft.operationLog]
  let redoStack = [...draft.redoStack]
  let structuralChanged = false
  let layoutChanged = false
  const applied: EnterpriseTopologyGuiCommand[] = []

  for (const command of commands) {
    if (command.schemaVersion !== ENTERPRISE_TOPOLOGY_GUI_DRAFT_SCHEMA_VERSION) {
      throwOperationIssue("$.schemaVersion", "invalid_gui_operation_payload", "Unsupported GUI operation schema version.")
    }
    if (command.op === "undo") {
      const last = operationLog.pop()
      if (!last) throwOperationIssue("$.op", "empty_undo_stack", "There is no GUI operation to undo.")
      redoStack = [...redoStack, last]
      applied.push(command)
      if (operationScope(last) === "layout") layoutChanged = true
      else structuralChanged = true
      continue
    }
    if (command.op === "redo") {
      const redo = redoStack.pop()
      if (!redo) throwOperationIssue("$.op", "empty_redo_stack", "There is no GUI operation to redo.")
      operationLog = [...operationLog, redo]
      applied.push(command)
      if (operationScope(redo) === "layout") layoutChanged = true
      else structuralChanged = true
      continue
    }

    operationLog = [...operationLog, command]
    redoStack = []
    applied.push(command)
    if (operationScope(command) === "layout") layoutChanged = true
    else structuralChanged = true
  }

  const updatedAt = options.now ?? applied[applied.length - 1]?.at ?? Date.now()
  return {
    draft: rebuildDraftFromOperationLog({ draft, operationLog, redoStack, structuralChanged, updatedAt }),
    applied,
    structuralChanged,
    layoutChanged,
  }
}

export function previewEnterpriseTopologyGuiOperation(
  operation: EnterpriseTopologyGuiOperation,
): EnterpriseTopologyQuickFixOperationPreview {
  if (operation.op === "createNode") {
    return {
      operationId: operation.operationId,
      op: operation.op,
      targetId: operation.nodeId,
      summary: `Create node ${operation.nodeId}`,
    }
  }
  if (operation.op === "updateNode") {
    return {
      operationId: operation.operationId,
      op: operation.op,
      targetId: operation.nodeId,
      summary: `Update node ${operation.nodeId}`,
    }
  }
  if (operation.op === "moveNode") {
    return {
      operationId: operation.operationId,
      op: operation.op,
      targetId: operation.nodeId,
      summary: `Move node ${operation.nodeId}`,
    }
  }
  if (operation.op === "deleteNode") {
    return {
      operationId: operation.operationId,
      op: operation.op,
      targetId: operation.nodeId,
      summary: `Archive node ${operation.nodeId}`,
    }
  }
  if (operation.op === "createRelation") {
    return {
      operationId: operation.operationId,
      op: operation.op,
      targetId: operation.relationId,
      summary: `Create ${operation.relationType} relation ${operation.from.id} -> ${operation.to.id}`,
    }
  }
  if (operation.op === "updateRelation") {
    return {
      operationId: operation.operationId,
      op: operation.op,
      targetId: operation.relationId,
      summary: `Update relation ${operation.relationId}`,
    }
  }
  return {
    operationId: operation.operationId,
    op: operation.op,
    targetId: operation.relationId,
    summary: `Archive relation ${operation.relationId}`,
  }
}

export function buildEnterpriseTopologyQuickFixOperationPlan(input: {
  quickFixId: EnterpriseTopologyQuickFixId
  label: string
  operations: EnterpriseTopologyGuiOperation[]
}): EnterpriseTopologyQuickFixOperationPlan {
  return {
    quickFixId: input.quickFixId,
    label: input.label,
    operations: [...input.operations],
    preview: input.operations.map((operation) => previewEnterpriseTopologyGuiOperation(operation)),
  }
}

export function createGuiDraftOperationId(prefix: string, at: EnterpriseTimestamp = Date.now()): string {
  return `${prefix}:${at}:${Math.random().toString(36).slice(2, 10)}`
}

export function isEnterpriseTopologyGuiOperationKind(value: string): value is EnterpriseTopologyGuiOperationKind {
  return (
    value === "createNode" ||
    value === "updateNode" ||
    value === "moveNode" ||
    value === "deleteNode" ||
    value === "createRelation" ||
    value === "updateRelation" ||
    value === "deleteRelation"
  )
}

export function isEnterpriseTopologyGuiCommandKind(value: string): value is EnterpriseTopologyGuiCommandKind {
  return isEnterpriseTopologyGuiOperationKind(value) || value === "undo" || value === "redo"
}

export function isEnterpriseRelationType(value: string): value is EnterpriseRelationType {
  return (ENTERPRISE_RELATION_TYPES as readonly string[]).includes(value)
}
