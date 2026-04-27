import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { type OrchestrationConfig, PATHS, getConfig } from "../config/index.js"
import type { JsonObject } from "../contracts/index.js"
import {
  type AgentConfig,
  type AgentRelationship,
  type AgentRelationshipStatus,
  type AgentStatus,
  type RelationshipGraphEdge,
  type RelationshipGraphNode,
  validateAgentRelationship,
} from "../contracts/sub-agent-orchestration.js"
import {
  type DbAgentRelationship,
  getAgentRelationship,
  listAgentRelationships,
  upsertAgentRelationship,
} from "../db/index.js"
import { type RegistryServiceDependencies, createAgentRegistryService } from "./registry.js"

const DEFAULT_ROOT_AGENT_ID = "agent:nobie"
const DEFAULT_MAX_DEPTH = 5
const DEFAULT_MAX_CHILD_COUNT = 10
const LAYOUT_SCHEMA_VERSION = 1

export type HierarchyDiagnosticSeverity = "info" | "warning" | "blocked"

export interface AgentHierarchyDiagnostic {
  reasonCode: string
  severity: HierarchyDiagnosticSeverity
  message: string
  edgeId?: string
  parentAgentId?: string
  childAgentId?: string
  limit?: number
  value?: number
  path?: string
}

export interface AgentHierarchyValidationResult {
  ok: boolean
  relationship?: AgentRelationship
  diagnostics: AgentHierarchyDiagnostic[]
}

export interface AgentHierarchyAgentSummary {
  agentId: string
  agentType: AgentConfig["agentType"]
  displayName: string
  nickname?: string
  status: AgentStatus
  source: "db" | "config" | "synthetic"
}

export interface DirectChildProjection {
  relationship: AgentRelationship
  agent?: AgentHierarchyAgentSummary
  isExecutionCandidate: boolean
  blockedReason?: string
}

export interface AgentTreeLayoutPreference {
  schemaVersion: number
  layout: string
  nodes: Record<string, { x: number; y: number; collapsed?: boolean }>
  viewport?: { x: number; y: number; zoom: number }
  updatedAt: number | null
}

export interface AgentTreeProjection {
  rootAgentId: string
  generatedAt: number
  nodes: RelationshipGraphNode[]
  edges: RelationshipGraphEdge[]
  topLevelSubAgents: AgentHierarchyAgentSummary[]
  topLevelFallbackActive: boolean
  executionCandidateAgentIds: string[]
  diagnostics: AgentHierarchyDiagnostic[]
}

export interface AgentHierarchyServiceDependencies extends RegistryServiceDependencies {
  rootAgentId?: string
  maxDepth?: number
  maxChildCount?: number
  layoutPath?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined
}

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function asStatus(value: unknown): AgentRelationshipStatus | undefined {
  return value === "active" || value === "disabled" || value === "archived" ? value : undefined
}

function defaultEdgeId(parentAgentId: string, childAgentId: string): string {
  return `relationship:${parentAgentId}->${childAgentId}`
}

function nodeIdForAgent(agentId: string): string {
  return `agent:${agentId}`
}

function relationshipFromRow(row: DbAgentRelationship): AgentRelationship {
  return {
    edgeId: row.edge_id,
    parentAgentId: row.parent_agent_id,
    childAgentId: row.child_agent_id,
    relationshipType: row.relationship_type,
    status: row.status,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function normalizeRelationshipInput(
  input: unknown,
  now: number,
  nextSortOrder: number,
): AgentRelationship {
  const value = isRecord(input) ? input : {}
  const parentAgentId = asString(value.parentAgentId) ?? ""
  const childAgentId = asString(value.childAgentId) ?? ""
  const sortOrder = "sortOrder" in value ? value.sortOrder : nextSortOrder
  return {
    edgeId:
      asString(value.edgeId) ??
      (parentAgentId && childAgentId ? defaultEdgeId(parentAgentId, childAgentId) : ""),
    parentAgentId,
    childAgentId,
    relationshipType:
      "relationshipType" in value ? (value.relationshipType as "parent_child") : "parent_child",
    status:
      asStatus(value.status) ??
      ("status" in value ? (value.status as AgentRelationshipStatus) : "active"),
    sortOrder: typeof sortOrder === "number" ? sortOrder : (sortOrder as number),
    createdAt: asFiniteNumber(value.createdAt) ?? now,
    updatedAt: asFiniteNumber(value.updatedAt) ?? now,
  }
}

function contractIssueDiagnostic(
  issue: {
    path: string
    message: string
  },
  relationship?: AgentRelationship,
): AgentHierarchyDiagnostic {
  let reasonCode = "invalid_relationship_contract"
  if (issue.path === "$.childAgentId" && issue.message.includes("different")) {
    reasonCode = "self_parent_blocked"
  } else if (issue.path === "$.status") {
    reasonCode = "invalid_relationship_status"
  }
  return {
    reasonCode,
    severity: "blocked",
    message: issue.message,
    path: issue.path,
    ...(relationship?.edgeId ? { edgeId: relationship.edgeId } : {}),
    ...(relationship?.parentAgentId ? { parentAgentId: relationship.parentAgentId } : {}),
    ...(relationship?.childAgentId ? { childAgentId: relationship.childAgentId } : {}),
  }
}

function relationshipSort(left: AgentRelationship, right: AgentRelationship): number {
  return (
    left.parentAgentId.localeCompare(right.parentAgentId) ||
    left.sortOrder - right.sortOrder ||
    left.edgeId.localeCompare(right.edgeId)
  )
}

function agentFromConfig(config: AgentConfig, source: "db" | "config"): AgentHierarchyAgentSummary {
  return {
    agentId: config.agentId,
    agentType: config.agentType,
    displayName: config.displayName,
    ...(config.nickname ? { nickname: config.nickname } : {}),
    status: config.status,
    source,
  }
}

function agentMetadata(input: {
  agent: AgentHierarchyAgentSummary
  rootAgentId: string
  topLevel: boolean
  depth: number | null
  executionCandidate: boolean
  blockedReason?: string
}): JsonObject {
  return {
    agentType: input.agent.agentType,
    source: input.agent.source,
    root: input.agent.agentId === input.rootAgentId,
    topLevel: input.topLevel,
    depth: input.depth,
    executionCandidate: input.executionCandidate,
    ...(input.blockedReason ? { blockedReason: input.blockedReason } : {}),
  }
}

function layoutPath(dependencies: AgentHierarchyServiceDependencies): string {
  return dependencies.layoutPath ?? join(PATHS.stateDir, "agent-tree-layout.json")
}

function defaultLayoutPreference(): AgentTreeLayoutPreference {
  return {
    schemaVersion: LAYOUT_SCHEMA_VERSION,
    layout: "tree",
    nodes: {},
    updatedAt: null,
  }
}

function normalizeLayoutPreference(value: unknown, updatedAt: number): AgentTreeLayoutPreference {
  const input = isRecord(value) ? value : {}
  const nodesInput = isRecord(input.nodes) ? input.nodes : {}
  const nodes: AgentTreeLayoutPreference["nodes"] = {}
  for (const [nodeId, rawNode] of Object.entries(nodesInput)) {
    if (!isRecord(rawNode)) continue
    const x = asFiniteNumber(rawNode.x)
    const y = asFiniteNumber(rawNode.y)
    if (x === undefined || y === undefined) continue
    nodes[nodeId] = {
      x,
      y,
      ...(typeof rawNode.collapsed === "boolean" ? { collapsed: rawNode.collapsed } : {}),
    }
  }
  const viewportInput = isRecord(input.viewport) ? input.viewport : undefined
  const viewportX = viewportInput ? asFiniteNumber(viewportInput.x) : undefined
  const viewportY = viewportInput ? asFiniteNumber(viewportInput.y) : undefined
  const viewportZoom = viewportInput ? asFiniteNumber(viewportInput.zoom) : undefined
  return {
    schemaVersion: LAYOUT_SCHEMA_VERSION,
    layout: asString(input.layout) ?? "tree",
    nodes,
    ...(viewportX !== undefined && viewportY !== undefined && viewportZoom !== undefined
      ? { viewport: { x: viewportX, y: viewportY, zoom: viewportZoom } }
      : {}),
    updatedAt,
  }
}

function activeRelationships(): AgentRelationship[] {
  return listAgentRelationships({ status: "active" })
    .map(relationshipFromRow)
    .sort(relationshipSort)
}

function parentByChild(relationships: AgentRelationship[]): Map<string, AgentRelationship> {
  const result = new Map<string, AgentRelationship>()
  for (const relationship of relationships) {
    if (relationship.status === "active") result.set(relationship.childAgentId, relationship)
  }
  return result
}

function childrenByParent(relationships: AgentRelationship[]): Map<string, AgentRelationship[]> {
  const result = new Map<string, AgentRelationship[]>()
  for (const relationship of relationships) {
    if (relationship.status !== "active") continue
    const children = result.get(relationship.parentAgentId) ?? []
    children.push(relationship)
    result.set(relationship.parentAgentId, children)
  }
  for (const children of result.values()) children.sort(relationshipSort)
  return result
}

function descendantAgentIds(agentId: string, relationships: AgentRelationship[]): string[] {
  const byParent = childrenByParent(relationships)
  const descendants: string[] = []
  const visited = new Set<string>()
  const stack = [...(byParent.get(agentId) ?? [])].reverse()
  while (stack.length > 0) {
    const relationship = stack.pop()
    if (!relationship || visited.has(relationship.childAgentId)) continue
    visited.add(relationship.childAgentId)
    descendants.push(relationship.childAgentId)
    stack.push(...[...(byParent.get(relationship.childAgentId) ?? [])].reverse())
  }
  return descendants
}

function hasPath(
  fromAgentId: string,
  toAgentId: string,
  relationships: AgentRelationship[],
): boolean {
  return descendantAgentIds(fromAgentId, relationships).includes(toAgentId)
}

function depthOf(
  agentId: string,
  rootAgentId: string,
  byChild: Map<string, AgentRelationship>,
): number {
  if (agentId === rootAgentId) return 0
  let depth = 1
  let cursor = agentId
  const seen = new Set<string>([agentId])
  while (true) {
    const relationship = byChild.get(cursor)
    if (!relationship) return depth
    if (relationship.parentAgentId === rootAgentId) return depth
    if (seen.has(relationship.parentAgentId)) return Number.POSITIVE_INFINITY
    seen.add(relationship.parentAgentId)
    cursor = relationship.parentAgentId
    depth += 1
  }
}

function inactiveReasonFor(
  agentId: string,
  rootAgentId: string,
  agents: Map<string, AgentHierarchyAgentSummary>,
  relationships: AgentRelationship[],
): string | undefined {
  const agent = agents.get(agentId)
  if (!agent) return "missing_agent"
  if (agent.status !== "enabled") return `agent_${agent.status}`
  if (agentId === rootAgentId) return undefined

  const byChild = parentByChild(relationships)
  let cursor = agentId
  const seen = new Set<string>()
  while (cursor !== rootAgentId) {
    if (seen.has(cursor)) return "cycle_detected"
    seen.add(cursor)
    const relationship = byChild.get(cursor)
    if (!relationship) return cursor === agentId ? "agent_unassigned" : "ancestor_unassigned"
    const parent = agents.get(relationship.parentAgentId)
    if (!parent) return "missing_ancestor"
    if (parent.agentId !== rootAgentId && parent.status !== "enabled")
      return `ancestor_${parent.status}`
    cursor = parent.agentId
  }

  return undefined
}

function configFromDependencies(
  dependencies: AgentHierarchyServiceDependencies,
): Pick<{ orchestration: OrchestrationConfig }, "orchestration"> {
  return dependencies.getConfig?.() ?? getConfig()
}

function positiveIntegerOrDefault(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback
}

export function createAgentHierarchyService(dependencies: AgentHierarchyServiceDependencies = {}) {
  const now = () => dependencies.now?.() ?? Date.now()
  const config = () => configFromDependencies(dependencies)
  const rootAgentId = () =>
    dependencies.rootAgentId ?? config().orchestration.nobie?.agentId ?? DEFAULT_ROOT_AGENT_ID
  const maxDepth = () =>
    positiveIntegerOrDefault(
      dependencies.maxDepth ?? config().orchestration.maxDelegationTurns,
      DEFAULT_MAX_DEPTH,
    )
  const maxChildCount = () => dependencies.maxChildCount ?? DEFAULT_MAX_CHILD_COUNT
  const registry = () => createAgentRegistryService(dependencies)

  function agentSummaries(): Map<string, AgentHierarchyAgentSummary> {
    const result = new Map<string, AgentHierarchyAgentSummary>()
    const snapshot = registry().snapshot()
    for (const entry of snapshot.agents)
      result.set(entry.agentId, agentFromConfig(entry.config, entry.source))
    for (const agent of registry().list()) result.set(agent.agentId, agentFromConfig(agent, "db"))

    const root = config().orchestration.nobie
    const resolvedRootAgentId = rootAgentId()
    if (root) result.set(root.agentId, agentFromConfig(root, "config"))
    if (!result.has(resolvedRootAgentId)) {
      result.set(resolvedRootAgentId, {
        agentId: resolvedRootAgentId,
        agentType: "nobie",
        displayName: "Nobie",
        nickname: "Nobie",
        status: "enabled",
        source: "synthetic",
      })
    }
    return result
  }

  function relationshipWithDefaults(input: unknown): AgentRelationship {
    const parentAgentId = isRecord(input) ? asString(input.parentAgentId) : undefined
    const nextSortOrder = parentAgentId
      ? activeRelationships().filter((relationship) => relationship.parentAgentId === parentAgentId)
          .length
      : 0
    return normalizeRelationshipInput(input, now(), nextSortOrder)
  }

  function validateRelationship(input: unknown): AgentHierarchyValidationResult {
    const relationship = relationshipWithDefaults(input)
    const validation = validateAgentRelationship(relationship)
    const diagnostics: AgentHierarchyDiagnostic[] = validation.ok
      ? []
      : validation.issues.map((issue) => contractIssueDiagnostic(issue, relationship))
    if (!validation.ok) return { ok: false, relationship, diagnostics }

    const resolvedRootAgentId = rootAgentId()
    const agents = agentSummaries()
    if (relationship.childAgentId === resolvedRootAgentId) {
      diagnostics.push({
        reasonCode: "nobie_parent_forbidden",
        severity: "blocked",
        message: "Nobie must remain the parentless root and cannot be a child.",
        edgeId: relationship.edgeId,
        parentAgentId: relationship.parentAgentId,
        childAgentId: relationship.childAgentId,
      })
    }
    if (!agents.has(relationship.parentAgentId)) {
      diagnostics.push({
        reasonCode: "unknown_parent_agent",
        severity: "blocked",
        message: `Parent agent ${relationship.parentAgentId} is not defined.`,
        edgeId: relationship.edgeId,
        parentAgentId: relationship.parentAgentId,
        childAgentId: relationship.childAgentId,
      })
    }
    if (!agents.has(relationship.childAgentId)) {
      diagnostics.push({
        reasonCode: "unknown_child_agent",
        severity: "blocked",
        message: `Child agent ${relationship.childAgentId} is not defined.`,
        edgeId: relationship.edgeId,
        parentAgentId: relationship.parentAgentId,
        childAgentId: relationship.childAgentId,
      })
    }

    if (relationship.status === "active") {
      const active = activeRelationships().filter(
        (candidate) => candidate.edgeId !== relationship.edgeId,
      )
      const duplicateRelationship = active.find(
        (candidate) =>
          candidate.parentAgentId === relationship.parentAgentId &&
          candidate.childAgentId === relationship.childAgentId,
      )
      if (duplicateRelationship) {
        diagnostics.push({
          reasonCode: "duplicate_relationship_blocked",
          severity: "blocked",
          message: `${relationship.parentAgentId} already has ${relationship.childAgentId} as a direct child.`,
          edgeId: relationship.edgeId,
          parentAgentId: relationship.parentAgentId,
          childAgentId: relationship.childAgentId,
        })
      }

      const existingParent = active.find(
        (candidate) => candidate.childAgentId === relationship.childAgentId,
      )
      if (existingParent && existingParent.parentAgentId !== relationship.parentAgentId) {
        diagnostics.push({
          reasonCode: "child_multi_parent_blocked",
          severity: "blocked",
          message: `${relationship.childAgentId} already has parent ${existingParent.parentAgentId}.`,
          edgeId: relationship.edgeId,
          parentAgentId: relationship.parentAgentId,
          childAgentId: relationship.childAgentId,
        })
      }

      const nextChildCount = new Set(
        active
          .filter((candidate) => candidate.parentAgentId === relationship.parentAgentId)
          .map((candidate) => candidate.childAgentId),
      )
      nextChildCount.add(relationship.childAgentId)
      if (nextChildCount.size > maxChildCount()) {
        diagnostics.push({
          reasonCode: "max_child_count_exceeded",
          severity: "blocked",
          message: `${relationship.parentAgentId} would have ${nextChildCount.size} direct children.`,
          edgeId: relationship.edgeId,
          parentAgentId: relationship.parentAgentId,
          childAgentId: relationship.childAgentId,
          limit: maxChildCount(),
          value: nextChildCount.size,
        })
      }

      if (hasPath(relationship.childAgentId, relationship.parentAgentId, active)) {
        diagnostics.push({
          reasonCode: "cycle_detected",
          severity: "blocked",
          message: "Adding this relationship would create a cycle.",
          edgeId: relationship.edgeId,
          parentAgentId: relationship.parentAgentId,
          childAgentId: relationship.childAgentId,
        })
      }

      const future = [...active, relationship].sort(relationshipSort)
      const byChild = parentByChild(future)
      const affectedAgentIds = [
        relationship.childAgentId,
        ...descendantAgentIds(relationship.childAgentId, future),
      ]
      for (const agentId of affectedAgentIds) {
        const depth = depthOf(agentId, resolvedRootAgentId, byChild)
        if (depth > maxDepth()) {
          diagnostics.push({
            reasonCode: "max_depth_exceeded",
            severity: "blocked",
            message: `${agentId} would be at hierarchy depth ${depth}.`,
            edgeId: relationship.edgeId,
            parentAgentId: relationship.parentAgentId,
            childAgentId: relationship.childAgentId,
            limit: maxDepth(),
            value: depth,
          })
          break
        }
      }
    }

    return {
      ok: diagnostics.every((diagnostic) => diagnostic.severity !== "blocked"),
      relationship,
      diagnostics,
    }
  }

  function createRelationship(
    input: unknown,
    options: { auditId?: string | null } = {},
  ): AgentHierarchyValidationResult {
    const result = validateRelationship(input)
    if (!result.ok || !result.relationship) return result
    upsertAgentRelationship(result.relationship, { auditId: options.auditId ?? null, now: now() })
    const stored = getAgentRelationship(result.relationship.edgeId)
    return {
      ok: true,
      relationship: stored ? relationshipFromRow(stored) : result.relationship,
      diagnostics: result.diagnostics,
    }
  }

  function disableRelationship(
    edgeId: string,
    options: { auditId?: string | null } = {},
  ): AgentRelationship | undefined {
    const row = getAgentRelationship(edgeId)
    if (!row) return undefined
    const relationship = {
      ...relationshipFromRow(row),
      status: "disabled" as const,
      updatedAt: now(),
    }
    upsertAgentRelationship(relationship, {
      auditId: options.auditId ?? row.audit_id ?? null,
      now: relationship.updatedAt,
    })
    const stored = getAgentRelationship(edgeId)
    return stored ? relationshipFromRow(stored) : relationship
  }

  function relationships(): AgentRelationship[] {
    return listAgentRelationships().map(relationshipFromRow).sort(relationshipSort)
  }

  function directChildren(parentAgentId: string): DirectChildProjection[] {
    const agents = agentSummaries()
    const active = activeRelationships()
    return active
      .filter((relationship) => relationship.parentAgentId === parentAgentId)
      .sort(relationshipSort)
      .map((relationship) => {
        const blockedReason = inactiveReasonFor(
          relationship.childAgentId,
          rootAgentId(),
          agents,
          active,
        )
        const agent = agents.get(relationship.childAgentId)
        return {
          relationship,
          ...(agent ? { agent } : {}),
          isExecutionCandidate: blockedReason === undefined,
          ...(blockedReason ? { blockedReason } : {}),
        }
      })
  }

  function ancestors(agentId: string): AgentHierarchyAgentSummary[] {
    const agents = agentSummaries()
    const byChild = parentByChild(activeRelationships())
    const result: AgentHierarchyAgentSummary[] = []
    let cursor = agentId
    const seen = new Set<string>()
    while (true) {
      if (seen.has(cursor)) break
      seen.add(cursor)
      const relationship = byChild.get(cursor)
      if (!relationship) break
      const parent = agents.get(relationship.parentAgentId)
      if (parent) result.push(parent)
      cursor = relationship.parentAgentId
    }
    return result
  }

  function descendants(agentId: string): AgentHierarchyAgentSummary[] {
    const agents = agentSummaries()
    return descendantAgentIds(agentId, activeRelationships())
      .map((descendantId) => agents.get(descendantId))
      .filter((agent): agent is AgentHierarchyAgentSummary => agent != null)
  }

  function topLevelSubAgents(): {
    agents: AgentHierarchyAgentSummary[]
    fallbackActive: boolean
    diagnostics: AgentHierarchyDiagnostic[]
  } {
    const agents = agentSummaries()
    const active = activeRelationships()
    const diagnostics: AgentHierarchyDiagnostic[] = []
    return {
      agents: active
        .filter((relationship) => relationship.parentAgentId === rootAgentId())
        .map((relationship) => agents.get(relationship.childAgentId))
        .filter((agent): agent is AgentHierarchyAgentSummary => agent?.agentType === "sub_agent")
        .sort((left, right) => left.agentId.localeCompare(right.agentId)),
      fallbackActive: false,
      diagnostics,
    }
  }

  function buildProjection(): AgentTreeProjection {
    const generatedAt = now()
    const resolvedRootAgentId = rootAgentId()
    const agents = agentSummaries()
    const active = activeRelationships()
    const byChild = parentByChild(active)
    const topLevel = topLevelSubAgents()
    const topLevelIds = new Set(topLevel.agents.map((agent) => agent.agentId))
    const projectionEdges = active.map(
      (relationship): RelationshipGraphEdge => ({
        edgeId: relationship.edgeId,
        edgeType: "parent_child",
        fromNodeId: nodeIdForAgent(relationship.parentAgentId),
        toNodeId: nodeIdForAgent(relationship.childAgentId),
        label: "parent child",
        metadata: {
          source: "hierarchy",
          status: relationship.status,
          sortOrder: relationship.sortOrder,
        },
      }),
    )

    const projectionAgentIds = new Set<string>([resolvedRootAgentId])
    for (const agent of agents.values()) projectionAgentIds.add(agent.agentId)
    for (const relationship of active) {
      projectionAgentIds.add(relationship.parentAgentId)
      projectionAgentIds.add(relationship.childAgentId)
    }

    const nodes = [...projectionAgentIds]
      .map(
        (agentId) =>
          agents.get(agentId) ?? {
            agentId,
            agentType: "sub_agent" as const,
            displayName: agentId,
            status: "disabled" as const,
            source: "synthetic" as const,
          },
      )
      .sort((left, right) => {
        if (left.agentId === resolvedRootAgentId) return -1
        if (right.agentId === resolvedRootAgentId) return 1
        return left.agentId.localeCompare(right.agentId)
      })
      .map((agent): RelationshipGraphNode => {
        const blockedReason = inactiveReasonFor(agent.agentId, resolvedRootAgentId, agents, active)
        return {
          nodeId: nodeIdForAgent(agent.agentId),
          entityType: agent.agentType,
          entityId: agent.agentId,
          label: agent.nickname ?? agent.displayName,
          status: agent.status,
          metadata: agentMetadata({
            agent,
            rootAgentId: resolvedRootAgentId,
            topLevel: topLevelIds.has(agent.agentId),
            depth: active.length > 0 ? depthOf(agent.agentId, resolvedRootAgentId, byChild) : null,
            executionCandidate: blockedReason === undefined,
            ...(blockedReason ? { blockedReason } : {}),
          }),
        }
      })

    return {
      rootAgentId: resolvedRootAgentId,
      generatedAt,
      nodes,
      edges: projectionEdges,
      topLevelSubAgents: topLevel.agents,
      topLevelFallbackActive: topLevel.fallbackActive,
      executionCandidateAgentIds: nodes
        .filter(
          (node) => node.entityType === "sub_agent" && node.metadata?.executionCandidate === true,
        )
        .map((node) => node.entityId),
      diagnostics: topLevel.diagnostics,
    }
  }

  function readLayout(): AgentTreeLayoutPreference {
    try {
      const parsed = JSON.parse(readFileSync(layoutPath(dependencies), "utf-8"))
      if (!isRecord(parsed)) return defaultLayoutPreference()
      const updatedAt = asFiniteNumber(parsed.updatedAt)
      return normalizeLayoutPreference(parsed, updatedAt ?? now())
    } catch {
      return defaultLayoutPreference()
    }
  }

  function writeLayout(input: unknown): AgentTreeLayoutPreference {
    const preference = normalizeLayoutPreference(input, now())
    const target = layoutPath(dependencies)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, `${JSON.stringify(preference, null, 2)}\n`, "utf-8")
    return preference
  }

  return {
    rootAgentId: rootAgentId(),
    maxDepth: maxDepth(),
    maxChildCount: maxChildCount(),
    list: relationships,
    get(edgeId: string): AgentRelationship | undefined {
      const row = getAgentRelationship(edgeId)
      return row ? relationshipFromRow(row) : undefined
    },
    validate: validateRelationship,
    create: createRelationship,
    disable: disableRelationship,
    directChildren,
    ancestors,
    descendants,
    topLevelSubAgents,
    buildProjection,
    readLayout,
    writeLayout,
  }
}
