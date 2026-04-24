import { createRequire } from "node:module"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { registerBenchmarkRoutes } from "../packages/core/src/api/routes/benchmarks.ts"
import {
  SUB_AGENT_BENCHMARK_SCENARIO_IDS,
  evaluateSubAgentBenchmarkReleaseGate,
  resetSubAgentBenchmarkRunsForTest,
  runSubAgentBenchmarkSuite,
} from "../packages/core/src/benchmarks/sub-agent-benchmarks.ts"
import {
  listLatencyMetrics,
  resetLatencyMetrics,
} from "../packages/core/src/observability/latency.js"
import { buildReleasePipelinePlan } from "../packages/core/src/release/package.ts"

const require = createRequire(import.meta.url)
const Fastify = require("../packages/core/node_modules/fastify") as (options: {
  logger: boolean
}) => {
  ready(): Promise<void>
  close(): Promise<void>
  inject(options: { method: string; url: string; payload?: unknown }): Promise<{
    statusCode: number
    json(): Record<string, unknown>
  }>
}

const now = new Date("2026-04-25T00:00:00.000Z")

beforeEach(() => {
  resetLatencyMetrics()
  resetSubAgentBenchmarkRunsForTest()
})

afterEach(() => {
  resetLatencyMetrics()
  resetSubAgentBenchmarkRunsForTest()
})

describe("task029 sub-agent benchmarks and release gate", () => {
  it("runs all deterministic benchmark fixtures and aggregates core product metrics", () => {
    const first = runSubAgentBenchmarkSuite({ now, seed: "task029" })
    const second = runSubAgentBenchmarkSuite({ now, seed: "task029" })

    expect(second).toEqual(first)
    expect(first.scenarios.map((scenario) => scenario.scenarioId)).toEqual([
      ...SUB_AGENT_BENCHMARK_SCENARIO_IDS,
    ])
    expect(first.status).toBe("passed")
    expect(first.releaseGate.gateStatus).toBe("passed")
    expect(first.aggregate).toEqual(
      expect.objectContaining({
        scenarioCount: SUB_AGENT_BENCHMARK_SCENARIO_IDS.length,
        duplicateFinalAnswerCount: 0,
        restartRecoverySuccessRate: 1,
        compiledWorkflowRecommendationCount: 1,
      }),
    )
    expect(first.aggregate.hotRegistrySnapshotP95Ms).toBeLessThanOrEqual(150)
    expect(first.aggregate.plannerHotPathP95Ms).toBeLessThanOrEqual(700)
    expect(first.aggregate.promptCacheHitRate).toBeGreaterThan(0.5)
    expect(first.aggregate.totalLlmCallCount).toBeGreaterThan(0)
    expect(first.aggregate.totalCostEstimateUsd).toBeGreaterThan(0)
  })

  it("reports parallel efficiency, restart resume, permission denial, and focus ownership signals", () => {
    const suite = runSubAgentBenchmarkSuite({ now })
    const parallel = suite.scenarios.find(
      (scenario) => scenario.scenarioId === "bench.parallel_research_3",
    )
    const resume = suite.scenarios.find(
      (scenario) => scenario.scenarioId === "bench.long_running_resume",
    )
    const permission = suite.scenarios.find(
      (scenario) => scenario.scenarioId === "bench.permission_denied",
    )
    const focus = suite.scenarios.find(
      (scenario) => scenario.scenarioId === "bench.focus_thread_followup",
    )
    const workflow = suite.scenarios.find(
      (scenario) => scenario.scenarioId === "bench.compiled_workflow_upgrade",
    )

    expect(parallel?.metrics.parallelEfficiency).toBeGreaterThanOrEqual(0.65)
    expect(parallel?.metrics.wallClockMs).toBeLessThan(parallel?.metrics.sequentialWallClockMs ?? 0)
    expect(resume?.metrics.restartRecoverySucceeded).toBe(true)
    expect(permission?.metrics.permissionDeniedHandled).toBe(true)
    expect(permission?.metrics.userInterventionCount).toBe(1)
    expect(focus?.metrics.finalAnswerOwnershipMaintained).toBe(true)
    expect(focus?.metrics.memoryIsolationMaintained).toBe(true)
    expect(workflow?.recommendation).toEqual(
      expect.objectContaining({
        autoApply: false,
        reasonCodes: expect.arrayContaining(["requires_user_review_before_activation"]),
      }),
    )
  })

  it("records benchmark latency metrics when requested", () => {
    runSubAgentBenchmarkSuite({ now, recordLatencyMetrics: true })

    expect(listLatencyMetrics()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "sub_session_spawn_ack_ms",
          source: "benchmark",
          detail: expect.objectContaining({ scenarioId: "bench.parallel_research_3" }),
        }),
        expect.objectContaining({
          name: "first_progress_latency_ms",
          source: "benchmark",
        }),
        expect.objectContaining({
          name: "execution_latency_ms",
          source: "benchmark",
        }),
        expect.objectContaining({
          name: "registry_lookup_latency_ms",
          source: "benchmark",
        }),
        expect.objectContaining({
          name: "orchestration_planning_latency_ms",
          source: "benchmark",
        }),
      ]),
    )
  })

  it("fails the benchmark release gate on duplicate finals or missing required scenarios", () => {
    const suite = runSubAgentBenchmarkSuite({ now })
    const duplicateFinalSuite = {
      ...suite,
      aggregate: { ...suite.aggregate, duplicateFinalAnswerCount: 1 },
    }
    expect(evaluateSubAgentBenchmarkReleaseGate(duplicateFinalSuite)).toEqual(
      expect.objectContaining({
        gateStatus: "failed",
        blockingFailures: expect.arrayContaining(["duplicate_final_answer_count:1"]),
      }),
    )

    const missingScenarioSuite = {
      ...suite,
      scenarios: suite.scenarios.filter(
        (scenario) => scenario.scenarioId !== "bench.permission_denied",
      ),
      aggregate: { ...suite.aggregate, scenarioCount: suite.aggregate.scenarioCount - 1 },
    }
    expect(evaluateSubAgentBenchmarkReleaseGate(missingScenarioSuite)).toEqual(
      expect.objectContaining({
        gateStatus: "failed",
        missingScenarioIds: ["bench.permission_denied"],
      }),
    )
  })

  it("exposes benchmark scenario, run, latest, and lookup API routes", async () => {
    const app = Fastify({ logger: false })
    registerBenchmarkRoutes(app)
    await app.ready()
    try {
      const scenarios = await app.inject({ method: "GET", url: "/api/benchmarks/scenarios" })
      expect(scenarios.statusCode).toBe(200)
      expect((scenarios.json().scenarios as unknown[]).length).toBe(
        SUB_AGENT_BENCHMARK_SCENARIO_IDS.length,
      )

      const run = await app.inject({
        method: "POST",
        url: "/api/benchmarks/run",
        payload: {
          benchmarkRunId: "bench-run-task029",
          seed: "task029-api",
          scenarioIds: ["bench.parallel_research_3", "bench.permission_denied"],
          recordLatencyMetrics: true,
        },
      })
      expect(run.statusCode).toBe(200)
      expect(run.json().result).toEqual(
        expect.objectContaining({
          benchmarkRunId: "bench-run-task029",
          aggregate: expect.objectContaining({ scenarioCount: 2 }),
        }),
      )

      const latest = await app.inject({ method: "GET", url: "/api/benchmarks/latest" })
      expect(latest.statusCode).toBe(200)
      expect(latest.json().result).toEqual(
        expect.objectContaining({ benchmarkRunId: "bench-run-task029" }),
      )

      const lookup = await app.inject({
        method: "GET",
        url: "/api/benchmarks/runs/bench-run-task029",
      })
      expect(lookup.statusCode).toBe(200)
      expect(lookup.json().result).toEqual(
        expect.objectContaining({ benchmarkRunId: "bench-run-task029" }),
      )
    } finally {
      await app.close()
    }
  })

  it("wires the benchmark regression into the release pipeline", () => {
    const pipeline = buildReleasePipelinePlan()

    expect(pipeline.order).toContain("sub-agent-benchmark-release-gate")
    expect(pipeline.steps.find((step) => step.id === "sub-agent-benchmark-release-gate")).toEqual(
      expect.objectContaining({
        required: true,
        command: ["pnpm", "test", "tests/task029-benchmarks-release-gate.test.ts"],
      }),
    )
  })
})
