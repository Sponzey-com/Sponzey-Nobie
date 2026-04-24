import type { FastifyInstance } from "fastify"
import {
  SUB_AGENT_BENCHMARK_SCENARIO_IDS,
  getLatestSubAgentBenchmarkRun,
  getSubAgentBenchmarkRun,
  listSubAgentBenchmarkScenarios,
  runAndStoreSubAgentBenchmarkSuite,
  type SubAgentBenchmarkScenarioId,
} from "../../benchmarks/sub-agent-benchmarks.js"
import { authMiddleware } from "../middleware/auth.js"

interface BenchmarkRunBody {
  scenarioIds?: unknown
  seed?: unknown
  benchmarkRunId?: unknown
  recordLatencyMetrics?: unknown
}

function isScenarioId(value: unknown): value is SubAgentBenchmarkScenarioId {
  return SUB_AGENT_BENCHMARK_SCENARIO_IDS.includes(value as SubAgentBenchmarkScenarioId)
}

function parseScenarioIds(value: unknown): SubAgentBenchmarkScenarioId[] | undefined {
  if (!Array.isArray(value)) return undefined
  const ids = value.filter(isScenarioId)
  return ids.length === value.length && ids.length > 0 ? ids : undefined
}

function trimmedString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

export function registerBenchmarkRoutes(app: FastifyInstance): void {
  app.get("/api/benchmarks/scenarios", { preHandler: authMiddleware }, async () => ({
    ok: true,
    scenarios: listSubAgentBenchmarkScenarios(),
  }))

  app.post<{ Body: BenchmarkRunBody }>(
    "/api/benchmarks/run",
    { preHandler: authMiddleware },
    async (req) => {
      const scenarioIds = parseScenarioIds(req.body?.scenarioIds)
      const seed = trimmedString(req.body?.seed)
      const benchmarkRunId = trimmedString(req.body?.benchmarkRunId)
      return {
        ok: true,
        result: runAndStoreSubAgentBenchmarkSuite({
          ...(scenarioIds ? { scenarioIds } : {}),
          ...(seed ? { seed } : {}),
          ...(benchmarkRunId ? { benchmarkRunId } : {}),
          recordLatencyMetrics: req.body?.recordLatencyMetrics === true,
        }),
      }
    },
  )

  app.get("/api/benchmarks/latest", { preHandler: authMiddleware }, async (_req, reply) => {
    const result = getLatestSubAgentBenchmarkRun()
    if (!result) {
      return reply.status(404).send({
        ok: false,
        error: "benchmark_run_not_found",
        reasonCode: "benchmark_run_not_found",
      })
    }
    return { ok: true, result }
  })

  app.get<{ Params: { benchmarkRunId: string } }>(
    "/api/benchmarks/runs/:benchmarkRunId",
    { preHandler: authMiddleware },
    async (req, reply) => {
      const result = getSubAgentBenchmarkRun(req.params.benchmarkRunId)
      if (!result) {
        return reply.status(404).send({
          ok: false,
          error: "benchmark_run_not_found",
          reasonCode: "benchmark_run_not_found",
        })
      }
      return { ok: true, result }
    },
  )
}
