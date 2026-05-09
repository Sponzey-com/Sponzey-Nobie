import type { FastifyInstance } from "fastify"
import {
  analyzeTopologyGaps,
} from "../../topology/gap-analysis.js"
import {
  listTopologyGapFindings,
} from "../../topology/metrics.js"
import {
  extractObservedTopologyEdges,
} from "../../topology/observed.js"
import {
  createEnterpriseTopologyRegistry,
} from "../../topology/registry.js"
import { authMiddleware } from "../middleware/auth.js"

interface TopologyAnalysisQuery {
  version?: string
  topologyRunId?: string
  limit?: string
}

interface TopologyAnalyzeBody {
  persist?: unknown
  topologyRunId?: unknown
}

function asPositiveInteger(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const parsed = Number.parseInt(value, 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
}

function asLimit(value: string | undefined, fallback: number): number {
  const parsed = asPositiveInteger(value)
  return parsed === undefined ? fallback : parsed
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function resolveTopology(topologyId: string, version?: string) {
  const registry = createEnterpriseTopologyRegistry()
  const requestedVersion = asPositiveInteger(version)
  const exported = registry.exportTopology(topologyId, requestedVersion)
  return exported
}

export function registerTopologyAnalysisRoutes(app: FastifyInstance): void {
  app.get<{ Params: { topologyId: string }; Querystring: TopologyAnalysisQuery }>(
    "/api/topologies/:topologyId/observed",
    { preHandler: authMiddleware },
    async (req, reply) => {
      const exported = resolveTopology(req.params.topologyId, req.query.version)
      if (exported === null) return reply.status(404).send({ ok: false, error: "topology_not_found" })
      const topologyRunId = nonEmpty(req.query.topologyRunId)
      return {
        ok: true,
        observedEdges: extractObservedTopologyEdges({
          topology: exported.version.topology,
          ...(topologyRunId !== undefined ? { topologyRunId } : {}),
        }).slice(0, asLimit(req.query.limit, 500)),
      }
    },
  )

  app.get<{ Params: { topologyId: string }; Querystring: TopologyAnalysisQuery }>(
    "/api/topologies/:topologyId/gaps",
    { preHandler: authMiddleware },
    async (req, reply) => {
      if (resolveTopology(req.params.topologyId, req.query.version) === null) {
        return reply.status(404).send({ ok: false, error: "topology_not_found" })
      }
      const topologyRunId = nonEmpty(req.query.topologyRunId)
      return {
        ok: true,
        findings: listTopologyGapFindings({
          topologyId: req.params.topologyId,
          ...(topologyRunId !== undefined ? { topologyRunId } : {}),
          limit: asLimit(req.query.limit, 500),
        }),
      }
    },
  )

  app.post<{
    Params: { topologyId: string }
    Querystring: TopologyAnalysisQuery
    Body: TopologyAnalyzeBody
  }>(
    "/api/topologies/:topologyId/analyze",
    { preHandler: authMiddleware },
    async (req, reply) => {
      const exported = resolveTopology(req.params.topologyId, req.query.version)
      if (exported === null) return reply.status(404).send({ ok: false, error: "topology_not_found" })
      const body = isRecord(req.body) ? req.body : {}
      const bodyTopologyRunId = nonEmpty(body.topologyRunId)
      const queryTopologyRunId = nonEmpty(req.query.topologyRunId)
      const topologyRunId = bodyTopologyRunId ?? queryTopologyRunId
      const persist = body.persist !== false
      return {
        ok: true,
        analysis: analyzeTopologyGaps({
          topology: exported.version.topology,
          ...(topologyRunId !== undefined ? { topologyRunId } : {}),
          persist,
        }),
      }
    },
  )
}
