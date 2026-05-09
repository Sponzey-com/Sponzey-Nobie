import type Database from "better-sqlite3"
import { getDb } from "../db/index.js"
import type {
  EnterpriseEntityRef,
  EnterpriseTimestamp,
  EnterpriseTopology,
} from "../contracts/enterprise-topology.js"

export interface TopologyMetricsDailyRecord {
  metricDate: string
  topologyId: string
  topologyVersion: number
  topologyRunCount: number
  nodeRunCount: number
  completedCount: number
  failedCount: number
  partialSuccessCount: number
  toolCallCount: number
  failureCount: number
  updatedAt: number
}

export interface ObservedTopologyEdgeRecord {
  edgeId: string
  topologyId: string
  topologyRunId: string
  fromNodeId: string
  toNodeId: string
  edgeKind: string
  source: string
  confidence: number
  firstSeenAt: number
  lastSeenAt: number
  evidence: unknown
}

export interface TopologyGapFindingRecord {
  findingId: string
  topologyId: string
  topologyRunId?: string
  findingKind: string
  severity: string
  status: string
  summary: string
  detail: unknown
  createdAt: number
  updatedAt: number
}

export interface EnterpriseOrgWorkloadMetric {
  topologyId: string
  orgUnitId: string
  orgUnitName: string
  positionCount: number
  personCount: number
  activeMembershipCount: number
  allocatedPercent: number
  ownedNodeCount: number
  responsibilityCount: number
  approvalTargetCount: number
  processCount: number
  criticalSystemCount: number
  workloadScore: number
  capacityScore: number
  bottleneckScore: number
  bottleneckReasons: string[]
}

export interface ProjectTopologyMetricsDailyOptions {
  db?: Database.Database
  metricDate?: string
  topologyId?: string
  topologyVersion?: number
  now?: number
}

export interface ListTopologyMetricsDailyOptions {
  db?: Database.Database
  metricDate?: string
  topologyId?: string
  limit?: number
}

export interface ListTopologyObservabilityOptions {
  db?: Database.Database
  topologyId?: string
  topologyRunId?: string
  limit?: number
}

export interface ProjectEnterpriseOrgWorkloadMetricsOptions {
  asOf?: EnterpriseTimestamp
  bottleneckThreshold?: number
}

interface MetricsGroupRow {
  metric_date: string
  topology_id: string
  topology_version: number | null
}

interface TopologyMetricsDailyRow {
  metric_date: string
  topology_id: string
  topology_version: number
  topology_run_count: number
  node_run_count: number
  completed_count: number
  failed_count: number
  partial_success_count: number
  tool_call_count: number
  failure_count: number
  updated_at: number
}

interface ObservedTopologyEdgeRow {
  edge_id: string
  topology_id: string
  topology_run_id: string
  from_node_id: string
  to_node_id: string
  edge_kind: string
  source: string
  confidence: number
  first_seen_at: number
  last_seen_at: number
  evidence_json: string
}

interface TopologyGapFindingRow {
  finding_id: string
  topology_id: string
  topology_run_id: string | null
  finding_kind: string
  severity: string
  status: string
  summary: string
  detail_json: string
  created_at: number
  updated_at: number
}

function parseJson(value: string | null | undefined): unknown {
  if (value === null || value === undefined || value.trim().length === 0) return null
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function metricDateForTimestamp(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10)
}

function dateRange(metricDate: string): { start: number; end: number } {
  const start = Date.parse(`${metricDate}T00:00:00.000Z`)
  if (!Number.isFinite(start)) throw new Error(`invalid metricDate: ${metricDate}`)
  return { start, end: start + 24 * 60 * 60 * 1000 }
}

function countRows(db: Database.Database, sql: string, params: unknown[]): number {
  const row = db.prepare(sql).get(...params) as { count: number } | undefined
  return Number(row?.count ?? 0)
}

function mapMetricsRow(row: TopologyMetricsDailyRow): TopologyMetricsDailyRecord {
  return {
    metricDate: row.metric_date,
    topologyId: row.topology_id,
    topologyVersion: row.topology_version,
    topologyRunCount: row.topology_run_count,
    nodeRunCount: row.node_run_count,
    completedCount: row.completed_count,
    failedCount: row.failed_count,
    partialSuccessCount: row.partial_success_count,
    toolCallCount: row.tool_call_count,
    failureCount: row.failure_count,
    updatedAt: row.updated_at,
  }
}

function mapObservedEdgeRow(row: ObservedTopologyEdgeRow): ObservedTopologyEdgeRecord {
  return {
    edgeId: row.edge_id,
    topologyId: row.topology_id,
    topologyRunId: row.topology_run_id,
    fromNodeId: row.from_node_id,
    toNodeId: row.to_node_id,
    edgeKind: row.edge_kind,
    source: row.source,
    confidence: row.confidence,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    evidence: parseJson(row.evidence_json),
  }
}

function mapGapFindingRow(row: TopologyGapFindingRow): TopologyGapFindingRecord {
  const mapped: TopologyGapFindingRecord = {
    findingId: row.finding_id,
    topologyId: row.topology_id,
    findingKind: row.finding_kind,
    severity: row.severity,
    status: row.status,
    summary: row.summary,
    detail: parseJson(row.detail_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
  if (row.topology_run_id !== null) mapped.topologyRunId = row.topology_run_id
  return mapped
}

export function projectEnterpriseOrgWorkloadMetrics(
  topology: EnterpriseTopology,
  options: ProjectEnterpriseOrgWorkloadMetricsOptions = {},
): EnterpriseOrgWorkloadMetric[] {
  const asOf = options.asOf !== undefined ? timestampToMillis(options.asOf) : undefined
  const threshold = options.bottleneckThreshold ?? 1.5
  const nodeOwnerKeysByOrg = new Map<string, Set<string>>()

  for (const orgUnit of topology.orgUnits) {
    const positionIds = positionsForOrg(topology, orgUnit.id).map((position) => position.id)
    const personIds = personsForOrg(topology, orgUnit.id).map((person) => person.id)
    nodeOwnerKeysByOrg.set(orgUnit.id, new Set<string>([
      refKey({ entityType: "org_unit", id: orgUnit.id }),
      ...positionIds.map((positionId) => refKey({ entityType: "position", id: positionId })),
      ...personIds.map((personId) => refKey({ entityType: "person", id: personId })),
    ]))
  }

  return topology.orgUnits.map((orgUnit) => {
    const positions = positionsForOrg(topology, orgUnit.id)
    const persons = personsForOrg(topology, orgUnit.id)
    const ownerKeys = nodeOwnerKeysByOrg.get(orgUnit.id) ?? new Set<string>()
    const ownedNodeIds = topology.nodes
      .filter((node) => node.owner !== undefined && ownerKeys.has(refKey(node.owner)))
      .map((node) => node.id)
    const ownedNodeIdSet = new Set(ownedNodeIds)
    const activeMemberships = topology.memberships.filter((membership) => {
      const belongsToOrg = membership.orgUnitId === orgUnit.id
        || (membership.positionId !== undefined && positions.some((position) => position.id === membership.positionId))
        || persons.some((person) => person.id === membership.personId)
      if (!belongsToOrg) return false
      return asOf === undefined || membershipEffectiveAt(membership, asOf)
    })
    const allocatedPercent = activeMemberships.reduce((sum, membership) => {
      return sum + (typeof membership.allocationPercent === "number" && Number.isFinite(membership.allocationPercent)
        ? membership.allocationPercent
        : 0)
    }, 0)
    const responsibilityCount = topology.responsibilities.filter((entry) => {
      return ownerKeys.has(refKey(entry.responsible))
        || (entry.accountable !== undefined && ownerKeys.has(refKey(entry.accountable)))
        || (entry.scope.entityType === "node" && ownedNodeIdSet.has(entry.scope.id))
    }).length
    const approvalTargetCount = [
      ...topology.relations.filter((relation) => relation.relationType === "approves" && ownerKeys.has(refKey(relation.from))),
      ...topology.authorityRules.filter((rule) => isApprovalAction(rule.action) && ownerKeys.has(refKey(rule.subject))),
    ].length
    const processCount = topology.processes.filter((process) => {
      return (process.ownerNodeId !== undefined && ownedNodeIdSet.has(process.ownerNodeId))
        || (process.accountablePositionId !== undefined && positions.some((position) => position.id === process.accountablePositionId))
        || process.stepNodeIds.some((nodeId) => ownedNodeIdSet.has(nodeId))
    }).length
    const criticalSystemCount = topology.systems.filter((system) => {
      if (system.criticality !== "critical") return false
      return topology.relations.some((relation) => {
        return relation.relationType === "owns"
          && relation.to.entityType === "enterprise_system"
          && relation.to.id === system.id
          && ownerKeys.has(refKey(relation.from))
      })
    }).length
    const workloadScore = roundMetric(
      ownedNodeIds.length * 2
      + responsibilityCount
      + approvalTargetCount * 2
      + processCount * 1.5
      + criticalSystemCount * 2,
    )
    const capacityScore = roundMetric(Math.max(1, persons.length * 4 + positions.length))
    const bottleneckScore = roundMetric(workloadScore / capacityScore)
    const bottleneckReasons = [
      ...(bottleneckScore >= threshold ? ["org_workload_over_threshold"] : []),
      ...(approvalTargetCount >= 2 ? ["approval_load_concentrated"] : []),
      ...(allocatedPercent > 100 ? ["membership_allocation_over_capacity"] : []),
      ...(criticalSystemCount > 0 ? ["critical_system_owner_load"] : []),
    ]

    return {
      topologyId: topology.id,
      orgUnitId: orgUnit.id,
      orgUnitName: orgUnit.displayName ?? orgUnit.name,
      positionCount: positions.length,
      personCount: persons.length,
      activeMembershipCount: activeMemberships.length,
      allocatedPercent: roundMetric(allocatedPercent),
      ownedNodeCount: ownedNodeIds.length,
      responsibilityCount,
      approvalTargetCount,
      processCount,
      criticalSystemCount,
      workloadScore,
      capacityScore,
      bottleneckScore,
      bottleneckReasons,
    }
  }).sort((left, right) => right.bottleneckScore - left.bottleneckScore || left.orgUnitId.localeCompare(right.orgUnitId))
}

export function refreshTopologyMetricsDaily(
  db: Database.Database,
  input: {
    metricDate: string
    topologyId: string
    topologyVersion?: number | null
    now?: number
  },
): TopologyMetricsDailyRecord {
  const topologyVersion = input.topologyVersion ?? 0
  const { start, end } = dateRange(input.metricDate)
  const runFilter = `
    r.topology_id = ?
    AND COALESCE(r.topology_version, 0) = ?
    AND r.started_at >= ?
    AND r.started_at < ?
  `
  const params = [input.topologyId, topologyVersion, start, end]
  const topologyRunCount = countRows(
    db,
    `SELECT COUNT(*) AS count FROM topology_runs r WHERE ${runFilter}`,
    params,
  )
  const nodeRunCount = countRows(
    db,
    `SELECT COUNT(*) AS count
     FROM topology_node_runs nr
     JOIN topology_runs r ON r.topology_run_id = nr.topology_run_id
     WHERE ${runFilter}`,
    params,
  )
  const completedCount = countRows(
    db,
    `SELECT COUNT(*) AS count FROM topology_runs r WHERE ${runFilter} AND r.status = 'completed'`,
    params,
  )
  const failedCount = countRows(
    db,
    `SELECT COUNT(*) AS count
     FROM topology_runs r
     WHERE ${runFilter}
       AND r.status IN ('failed', 'failed_candidate', 'permission_limited')`,
    params,
  )
  const partialSuccessCount = countRows(
    db,
    `SELECT COUNT(*) AS count
     FROM topology_runs r
     WHERE ${runFilter}
       AND r.status IN ('partial_success', 'needs_revision')`,
    params,
  )
  const toolCallCount = countRows(
    db,
    `SELECT COUNT(*) AS count
     FROM topology_tool_calls tc
     JOIN topology_runs r ON r.topology_run_id = tc.topology_run_id
     WHERE ${runFilter}`,
    params,
  )
  const failureCount = countRows(
    db,
    `SELECT COUNT(*) AS count
     FROM topology_failure_reports fr
     JOIN topology_runs r ON r.topology_run_id = fr.topology_run_id
     WHERE ${runFilter}`,
    params,
  )
  const updatedAt = input.now ?? Date.now()

  db.prepare(
    `INSERT INTO topology_metrics_daily
     (metric_date, topology_id, topology_version, topology_run_count, node_run_count,
      completed_count, failed_count, partial_success_count, tool_call_count, failure_count, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(metric_date, topology_id, topology_version) DO UPDATE SET
       topology_run_count = excluded.topology_run_count,
       node_run_count = excluded.node_run_count,
       completed_count = excluded.completed_count,
       failed_count = excluded.failed_count,
       partial_success_count = excluded.partial_success_count,
       tool_call_count = excluded.tool_call_count,
       failure_count = excluded.failure_count,
       updated_at = excluded.updated_at`,
  ).run(
    input.metricDate,
    input.topologyId,
    topologyVersion,
    topologyRunCount,
    nodeRunCount,
    completedCount,
    failedCount,
    partialSuccessCount,
    toolCallCount,
    failureCount,
    updatedAt,
  )

  return {
    metricDate: input.metricDate,
    topologyId: input.topologyId,
    topologyVersion,
    topologyRunCount,
    nodeRunCount,
    completedCount,
    failedCount,
    partialSuccessCount,
    toolCallCount,
    failureCount,
    updatedAt,
  }
}

export function projectTopologyMetricsDaily(
  options: ProjectTopologyMetricsDailyOptions = {},
): TopologyMetricsDailyRecord[] {
  const db = options.db ?? getDb()
  const now = options.now ?? Date.now()
  const clauses: string[] = []
  const params: unknown[] = []

  if (options.metricDate !== undefined) {
    const { start, end } = dateRange(options.metricDate)
    clauses.push("started_at >= ? AND started_at < ?")
    params.push(start, end)
  }
  if (options.topologyId !== undefined) {
    clauses.push("topology_id = ?")
    params.push(options.topologyId)
  }
  if (options.topologyVersion !== undefined) {
    clauses.push("COALESCE(topology_version, 0) = ?")
    params.push(options.topologyVersion)
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : ""
  const groups = db.prepare(
    `SELECT DISTINCT
       strftime('%Y-%m-%d', started_at / 1000, 'unixepoch') AS metric_date,
       topology_id,
       COALESCE(topology_version, 0) AS topology_version
     FROM topology_runs
     ${where}
     ORDER BY metric_date DESC, topology_id ASC, topology_version DESC`,
  ).all(...params) as MetricsGroupRow[]

  return groups.map((group) => refreshTopologyMetricsDaily(db, {
    metricDate: group.metric_date,
    topologyId: group.topology_id,
    topologyVersion: group.topology_version ?? 0,
    now,
  }))
}

export function projectTopologyRunMetricsDaily(
  db: Database.Database,
  input: {
    topologyId: string
    topologyVersion?: number | null
    startedAt: number
    now?: number
  },
): TopologyMetricsDailyRecord {
  return refreshTopologyMetricsDaily(db, {
    metricDate: metricDateForTimestamp(input.startedAt),
    topologyId: input.topologyId,
    topologyVersion: input.topologyVersion ?? 0,
    ...(input.now !== undefined ? { now: input.now } : {}),
  })
}

export function listTopologyMetricsDaily(
  options: ListTopologyMetricsDailyOptions = {},
): TopologyMetricsDailyRecord[] {
  const db = options.db ?? getDb()
  const clauses: string[] = []
  const params: unknown[] = []

  if (options.metricDate !== undefined) {
    clauses.push("metric_date = ?")
    params.push(options.metricDate)
  }
  if (options.topologyId !== undefined) {
    clauses.push("topology_id = ?")
    params.push(options.topologyId)
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : ""
  const limit = Math.max(1, Math.min(366, Math.floor(options.limit ?? 90)))
  const rows = db.prepare(
    `SELECT *
     FROM topology_metrics_daily
     ${where}
     ORDER BY metric_date DESC, topology_id ASC, topology_version DESC
     LIMIT ?`,
  ).all(...params, limit) as TopologyMetricsDailyRow[]
  return rows.map(mapMetricsRow)
}

export function listObservedTopologyEdges(
  options: ListTopologyObservabilityOptions = {},
): ObservedTopologyEdgeRecord[] {
  const db = options.db ?? getDb()
  const clauses: string[] = []
  const params: unknown[] = []

  if (options.topologyId !== undefined) {
    clauses.push("topology_id = ?")
    params.push(options.topologyId)
  }
  if (options.topologyRunId !== undefined) {
    clauses.push("topology_run_id = ?")
    params.push(options.topologyRunId)
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : ""
  const limit = Math.max(1, Math.min(1000, Math.floor(options.limit ?? 200)))
  const rows = db.prepare(
    `SELECT *
     FROM observed_topology_edges
     ${where}
     ORDER BY last_seen_at DESC, edge_id ASC
     LIMIT ?`,
  ).all(...params, limit) as ObservedTopologyEdgeRow[]
  return rows.map(mapObservedEdgeRow)
}

export function listTopologyGapFindings(
  options: ListTopologyObservabilityOptions = {},
): TopologyGapFindingRecord[] {
  const db = options.db ?? getDb()
  const clauses: string[] = []
  const params: unknown[] = []

  if (options.topologyId !== undefined) {
    clauses.push("topology_id = ?")
    params.push(options.topologyId)
  }
  if (options.topologyRunId !== undefined) {
    clauses.push("topology_run_id = ?")
    params.push(options.topologyRunId)
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : ""
  const limit = Math.max(1, Math.min(1000, Math.floor(options.limit ?? 200)))
  const rows = db.prepare(
    `SELECT *
     FROM topology_gap_findings
     ${where}
     ORDER BY updated_at DESC, finding_id ASC
     LIMIT ?`,
  ).all(...params, limit) as TopologyGapFindingRow[]
  return rows.map(mapGapFindingRow)
}

function positionsForOrg(topology: EnterpriseTopology, orgUnitId: string): EnterpriseTopology["positions"] {
  const descendantOrgIds = new Set([orgUnitId, ...descendantOrgUnitIds(topology, orgUnitId)])
  return topology.positions.filter((position) => descendantOrgIds.has(position.orgUnitId))
}

function personsForOrg(topology: EnterpriseTopology, orgUnitId: string): EnterpriseTopology["persons"] {
  const positions = positionsForOrg(topology, orgUnitId)
  const positionPersonIds = new Set(positions.flatMap((position) => position.personIds))
  const descendantOrgIds = new Set([orgUnitId, ...descendantOrgUnitIds(topology, orgUnitId)])
  return topology.persons.filter((person) => {
    return person.orgUnitIds.some((candidate) => descendantOrgIds.has(candidate)) || positionPersonIds.has(person.id)
  })
}

function descendantOrgUnitIds(topology: EnterpriseTopology, orgUnitId: string): string[] {
  const result: string[] = []
  const queue = [orgUnitId]
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index]
    if (current === undefined) continue
    for (const orgUnit of topology.orgUnits) {
      if (orgUnit.parentOrgUnitId !== current || result.includes(orgUnit.id)) continue
      result.push(orgUnit.id)
      queue.push(orgUnit.id)
    }
  }
  return result
}

function membershipEffectiveAt(
  membership: EnterpriseTopology["memberships"][number],
  asOf: number,
): boolean {
  const from = membership.validFrom !== undefined ? timestampToMillis(membership.validFrom) : undefined
  const to = membership.validTo !== undefined ? timestampToMillis(membership.validTo) : undefined
  if (from !== undefined && from > asOf) return false
  if (to !== undefined && to < asOf) return false
  return true
}

function timestampToMillis(value: EnterpriseTimestamp): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : undefined
}

function isApprovalAction(action: string): boolean {
  const normalized = action.trim().toLowerCase()
  return normalized.includes("approve") || normalized.includes("approval")
}

function refKey(reference: EnterpriseEntityRef): string {
  return `${reference.entityType}:${reference.id}`
}

function roundMetric(value: number): number {
  return Math.round(value * 100) / 100
}
