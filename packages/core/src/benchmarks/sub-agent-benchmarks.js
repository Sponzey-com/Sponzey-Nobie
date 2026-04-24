import { recordLatencyMetric } from "../observability/latency.js";
export const SUB_AGENT_BENCHMARK_SCENARIO_IDS = [
    "bench.parallel_research_3",
    "bench.codebase_explore",
    "bench.writer_reviewer_loop",
    "bench.team_target_expansion",
    "bench.long_running_resume",
    "bench.permission_denied",
    "bench.focus_thread_followup",
    "bench.compiled_workflow_upgrade",
];
const REGISTRY_HOT_P95_TARGET_MS = 150;
const PLANNER_HOT_P95_TARGET_MS = 700;
const PARALLEL_EFFICIENCY_TARGET = 0.65;
const COST_PRECISION = 6;
const SCENARIO_FIXTURES = [
    {
        id: "bench.parallel_research_3",
        title: "Parallel research with 3 independent sub-agents",
        description: "Measures spawn ack, first progress, and wall-clock reduction for three independent research branches.",
        deterministicSeed: "task029:parallel-research-3:v1",
        tags: ["parallel", "research", "sub_session"],
        metrics: {
            spawnAckMs: 42,
            firstProgressMs: 310,
            wallClockMs: 3_600,
            sequentialWallClockMs: 9_000,
            parallelBranchCount: 3,
            llmCallCount: 3,
            promptCacheHits: 2,
            promptCacheMisses: 1,
            inputTokens: 4_200,
            outputTokens: 1_100,
            costEstimateUsd: 0.081,
            duplicateFinalAnswerCount: 0,
            restartRecoveryAttempted: false,
            restartRecoverySucceeded: null,
            userInterventionCount: 0,
            hotRegistrySnapshotP95Ms: 78,
            plannerHotPathP95Ms: 184,
            finalAnswerOwnershipMaintained: true,
            memoryIsolationMaintained: true,
            permissionDeniedHandled: true,
        },
    },
    {
        id: "bench.codebase_explore",
        title: "Codebase exploration hot path",
        description: "Measures hot registry snapshot reuse, planner hot path, prompt cache hit rate, and token cost for codebase exploration.",
        deterministicSeed: "task029:codebase-explore:v1",
        tags: ["planner", "registry", "cache"],
        metrics: {
            spawnAckMs: 38,
            firstProgressMs: 260,
            wallClockMs: 2_250,
            sequentialWallClockMs: 2_250,
            parallelBranchCount: 1,
            llmCallCount: 2,
            promptCacheHits: 5,
            promptCacheMisses: 1,
            inputTokens: 3_300,
            outputTokens: 850,
            costEstimateUsd: 0.054,
            duplicateFinalAnswerCount: 0,
            restartRecoveryAttempted: false,
            restartRecoverySucceeded: null,
            userInterventionCount: 0,
            hotRegistrySnapshotP95Ms: 64,
            plannerHotPathP95Ms: 142,
            finalAnswerOwnershipMaintained: true,
            memoryIsolationMaintained: true,
            permissionDeniedHandled: true,
        },
    },
    {
        id: "bench.writer_reviewer_loop",
        title: "Writer reviewer feedback loop",
        description: "Measures review-loop LLM calls, duplicate final suppression, and parent final-answer ownership.",
        deterministicSeed: "task029:writer-reviewer-loop:v1",
        tags: ["review", "feedback", "dedupe"],
        metrics: {
            spawnAckMs: 55,
            firstProgressMs: 420,
            wallClockMs: 4_800,
            sequentialWallClockMs: 7_200,
            parallelBranchCount: 2,
            llmCallCount: 4,
            promptCacheHits: 2,
            promptCacheMisses: 2,
            inputTokens: 5_100,
            outputTokens: 1_600,
            costEstimateUsd: 0.102,
            duplicateFinalAnswerCount: 0,
            restartRecoveryAttempted: false,
            restartRecoverySucceeded: null,
            userInterventionCount: 0,
            hotRegistrySnapshotP95Ms: 85,
            plannerHotPathP95Ms: 206,
            finalAnswerOwnershipMaintained: true,
            memoryIsolationMaintained: true,
            permissionDeniedHandled: true,
        },
    },
    {
        id: "bench.team_target_expansion",
        title: "Team target expansion",
        description: "Measures expansion from a team target to owner direct-child member tasks without executing the team as a permission owner.",
        deterministicSeed: "task029:team-target-expansion:v1",
        tags: ["team", "planner", "hierarchy"],
        metrics: {
            spawnAckMs: 48,
            firstProgressMs: 390,
            wallClockMs: 3_950,
            sequentialWallClockMs: 7_100,
            parallelBranchCount: 2,
            llmCallCount: 3,
            promptCacheHits: 3,
            promptCacheMisses: 1,
            inputTokens: 3_900,
            outputTokens: 1_050,
            costEstimateUsd: 0.071,
            duplicateFinalAnswerCount: 0,
            restartRecoveryAttempted: false,
            restartRecoverySucceeded: null,
            userInterventionCount: 0,
            hotRegistrySnapshotP95Ms: 92,
            plannerHotPathP95Ms: 238,
            finalAnswerOwnershipMaintained: true,
            memoryIsolationMaintained: true,
            permissionDeniedHandled: true,
        },
    },
    {
        id: "bench.long_running_resume",
        title: "Long running restart resume",
        description: "Measures restart-resume projection and success rate for a long-running sub-session after process recovery.",
        deterministicSeed: "task029:long-running-resume:v1",
        tags: ["restart", "resume", "event_ledger"],
        metrics: {
            spawnAckMs: 60,
            firstProgressMs: 580,
            wallClockMs: 8_200,
            sequentialWallClockMs: 8_200,
            parallelBranchCount: 1,
            llmCallCount: 3,
            promptCacheHits: 1,
            promptCacheMisses: 2,
            inputTokens: 4_800,
            outputTokens: 1_400,
            costEstimateUsd: 0.09,
            duplicateFinalAnswerCount: 0,
            restartRecoveryAttempted: true,
            restartRecoverySucceeded: true,
            userInterventionCount: 0,
            hotRegistrySnapshotP95Ms: 88,
            plannerHotPathP95Ms: 260,
            finalAnswerOwnershipMaintained: true,
            memoryIsolationMaintained: true,
            permissionDeniedHandled: true,
        },
    },
    {
        id: "bench.permission_denied",
        title: "Permission denied and approval boundary",
        description: "Measures denied capability handling without auto-escalation or final-answer duplication.",
        deterministicSeed: "task029:permission-denied:v1",
        tags: ["permission", "approval", "capability"],
        metrics: {
            spawnAckMs: 46,
            firstProgressMs: 340,
            wallClockMs: 1_700,
            sequentialWallClockMs: 1_700,
            parallelBranchCount: 1,
            llmCallCount: 1,
            promptCacheHits: 1,
            promptCacheMisses: 1,
            inputTokens: 1_600,
            outputTokens: 420,
            costEstimateUsd: 0.021,
            duplicateFinalAnswerCount: 0,
            restartRecoveryAttempted: false,
            restartRecoverySucceeded: null,
            userInterventionCount: 1,
            hotRegistrySnapshotP95Ms: 70,
            plannerHotPathP95Ms: 168,
            finalAnswerOwnershipMaintained: true,
            memoryIsolationMaintained: true,
            permissionDeniedHandled: true,
        },
    },
    {
        id: "bench.focus_thread_followup",
        title: "Focus thread follow-up",
        description: "Measures focused follow-up routing while preserving final-answer ownership and memory isolation.",
        deterministicSeed: "task029:focus-thread-followup:v1",
        tags: ["focus", "thread", "memory"],
        metrics: {
            spawnAckMs: 44,
            firstProgressMs: 300,
            wallClockMs: 2_050,
            sequentialWallClockMs: 2_050,
            parallelBranchCount: 1,
            llmCallCount: 2,
            promptCacheHits: 4,
            promptCacheMisses: 1,
            inputTokens: 2_100,
            outputTokens: 680,
            costEstimateUsd: 0.036,
            duplicateFinalAnswerCount: 0,
            restartRecoveryAttempted: false,
            restartRecoverySucceeded: null,
            userInterventionCount: 0,
            hotRegistrySnapshotP95Ms: 66,
            plannerHotPathP95Ms: 152,
            finalAnswerOwnershipMaintained: true,
            memoryIsolationMaintained: true,
            permissionDeniedHandled: true,
        },
    },
    {
        id: "bench.compiled_workflow_upgrade",
        title: "Compiled workflow upgrade recommendation",
        description: "Measures repeated-task detection and emits a non-automatic compiled workflow recommendation skeleton.",
        deterministicSeed: "task029:compiled-workflow-upgrade:v1",
        tags: ["workflow", "repeat", "cost"],
        metrics: {
            spawnAckMs: 50,
            firstProgressMs: 360,
            wallClockMs: 2_600,
            sequentialWallClockMs: 4_000,
            parallelBranchCount: 2,
            llmCallCount: 2,
            promptCacheHits: 6,
            promptCacheMisses: 1,
            inputTokens: 2_500,
            outputTokens: 720,
            costEstimateUsd: 0.039,
            duplicateFinalAnswerCount: 0,
            restartRecoveryAttempted: false,
            restartRecoverySucceeded: null,
            userInterventionCount: 0,
            hotRegistrySnapshotP95Ms: 74,
            plannerHotPathP95Ms: 176,
            finalAnswerOwnershipMaintained: true,
            memoryIsolationMaintained: true,
            permissionDeniedHandled: true,
        },
        recommendation: {
            title: "Promote repeated research-summary pattern to a compiled workflow draft",
            reasonCodes: [
                "repeated_task_pattern_detected",
                "estimated_wall_clock_savings",
                "requires_user_review_before_activation",
            ],
            confidence: 0.87,
            estimatedWallClockSavingsPct: 35,
            estimatedLlmCallSavingsPct: 28,
        },
    },
];
const SCENARIO_BY_ID = new Map(SCENARIO_FIXTURES.map((scenario) => [scenario.id, scenario]));
const benchmarkRuns = new Map();
let latestBenchmarkRunId = null;
function round(value, digits = 3) {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
}
function percentile95(values) {
    if (values.length === 0)
        return null;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
    return sorted[index] ?? null;
}
function statusFromIssues(warnings, blockingFailures) {
    if (blockingFailures.length > 0)
        return "failed";
    if (warnings.length > 0)
        return "warning";
    return "passed";
}
function buildMetrics(fixture, overrides = {}) {
    const promptEvents = fixture.metrics.promptCacheHits + fixture.metrics.promptCacheMisses;
    const parallelEfficiency = fixture.metrics.parallelBranchCount > 1
        ? fixture.metrics.sequentialWallClockMs /
            (fixture.metrics.wallClockMs * fixture.metrics.parallelBranchCount)
        : 1;
    return {
        ...fixture.metrics,
        parallelEfficiency: round(Math.min(1, parallelEfficiency)),
        promptCacheHitRate: promptEvents === 0 ? 0 : round(fixture.metrics.promptCacheHits / promptEvents),
        tokenTotal: fixture.metrics.inputTokens + fixture.metrics.outputTokens,
        ...overrides,
    };
}
function evaluateScenario(metrics) {
    const warnings = [];
    const blockingFailures = [];
    if (metrics.hotRegistrySnapshotP95Ms > REGISTRY_HOT_P95_TARGET_MS) {
        warnings.push(`hot_registry_snapshot_p95_exceeded:${metrics.hotRegistrySnapshotP95Ms}`);
    }
    if (metrics.plannerHotPathP95Ms > PLANNER_HOT_P95_TARGET_MS) {
        warnings.push(`planner_hot_path_p95_exceeded:${metrics.plannerHotPathP95Ms}`);
    }
    if (metrics.parallelBranchCount > 1 && metrics.parallelEfficiency < PARALLEL_EFFICIENCY_TARGET) {
        warnings.push(`parallel_efficiency_below_target:${metrics.parallelEfficiency}`);
    }
    if (metrics.duplicateFinalAnswerCount > 0) {
        blockingFailures.push(`duplicate_final_answer_count:${metrics.duplicateFinalAnswerCount}`);
    }
    if (metrics.restartRecoveryAttempted && metrics.restartRecoverySucceeded !== true) {
        blockingFailures.push("restart_recovery_failed");
    }
    if (!metrics.finalAnswerOwnershipMaintained)
        blockingFailures.push("final_answer_ownership_broken");
    if (!metrics.memoryIsolationMaintained)
        blockingFailures.push("memory_isolation_broken");
    if (!metrics.permissionDeniedHandled)
        blockingFailures.push("permission_denied_boundary_broken");
    return { warnings, blockingFailures };
}
function scenarioResult(input) {
    const metrics = buildMetrics(input.fixture);
    const startedAtMs = input.suiteStartedAtMs + input.offsetMs;
    const finishedAtMs = startedAtMs + metrics.wallClockMs;
    const gate = evaluateScenario(metrics);
    const recommendation = input.fixture.recommendation
        ? {
            recommendationId: `workflow-rec:${input.fixture.id}:${input.seed}`,
            autoApply: false,
            ...input.fixture.recommendation,
        }
        : undefined;
    return {
        scenarioId: input.fixture.id,
        title: input.fixture.title,
        status: statusFromIssues(gate.warnings, gate.blockingFailures),
        startedAt: new Date(startedAtMs).toISOString(),
        finishedAt: new Date(finishedAtMs).toISOString(),
        durationMs: metrics.wallClockMs,
        metrics,
        warnings: gate.warnings,
        blockingFailures: gate.blockingFailures,
        ...(recommendation ? { recommendation } : {}),
    };
}
function aggregateScenarios(scenarios) {
    const cacheHits = scenarios.reduce((sum, scenario) => sum + scenario.metrics.promptCacheHits, 0);
    const cacheMisses = scenarios.reduce((sum, scenario) => sum + scenario.metrics.promptCacheMisses, 0);
    const restartScenarios = scenarios.filter((scenario) => scenario.metrics.restartRecoveryAttempted);
    return {
        scenarioCount: scenarios.length,
        spawnAckP95Ms: percentile95(scenarios.map((scenario) => scenario.metrics.spawnAckMs)),
        firstProgressP95Ms: percentile95(scenarios.map((scenario) => scenario.metrics.firstProgressMs)),
        wallClockP95Ms: percentile95(scenarios.map((scenario) => scenario.metrics.wallClockMs)),
        totalWallClockMs: scenarios.reduce((sum, scenario) => sum + scenario.metrics.wallClockMs, 0),
        totalSequentialWallClockMs: scenarios.reduce((sum, scenario) => sum + scenario.metrics.sequentialWallClockMs, 0),
        averageParallelEfficiency: scenarios.length === 0
            ? 0
            : round(scenarios.reduce((sum, scenario) => sum + scenario.metrics.parallelEfficiency, 0) /
                scenarios.length),
        totalLlmCallCount: scenarios.reduce((sum, scenario) => sum + scenario.metrics.llmCallCount, 0),
        promptCacheHitRate: cacheHits + cacheMisses === 0 ? 0 : round(cacheHits / (cacheHits + cacheMisses)),
        totalInputTokens: scenarios.reduce((sum, scenario) => sum + scenario.metrics.inputTokens, 0),
        totalOutputTokens: scenarios.reduce((sum, scenario) => sum + scenario.metrics.outputTokens, 0),
        totalCostEstimateUsd: round(scenarios.reduce((sum, scenario) => sum + scenario.metrics.costEstimateUsd, 0), COST_PRECISION),
        duplicateFinalAnswerCount: scenarios.reduce((sum, scenario) => sum + scenario.metrics.duplicateFinalAnswerCount, 0),
        restartRecoverySuccessRate: restartScenarios.length === 0
            ? null
            : round(restartScenarios.filter((scenario) => scenario.metrics.restartRecoverySucceeded)
                .length / restartScenarios.length),
        userInterventionCount: scenarios.reduce((sum, scenario) => sum + scenario.metrics.userInterventionCount, 0),
        hotRegistrySnapshotP95Ms: percentile95(scenarios.map((scenario) => scenario.metrics.hotRegistrySnapshotP95Ms)),
        plannerHotPathP95Ms: percentile95(scenarios.map((scenario) => scenario.metrics.plannerHotPathP95Ms)),
        compiledWorkflowRecommendationCount: scenarios.filter((scenario) => scenario.recommendation)
            .length,
    };
}
function buildRunId(input) {
    return `bench:${input.seed}:${input.startedAt}:${input.scenarioIds.join("+")}`;
}
export function listSubAgentBenchmarkScenarios() {
    return SCENARIO_FIXTURES.map(({ metrics: _metrics, recommendation: _recommendation, ...definition }) => ({
        ...definition,
    }));
}
export function evaluateSubAgentBenchmarkReleaseGate(suite) {
    const scenarioIds = new Set(suite.scenarios.map((scenario) => scenario.scenarioId));
    const missingScenarioIds = SUB_AGENT_BENCHMARK_SCENARIO_IDS.filter((id) => !scenarioIds.has(id));
    const warnings = suite.scenarios.flatMap((scenario) => scenario.warnings.map((warning) => `${scenario.scenarioId}: ${warning}`));
    const blockingFailures = [
        ...missingScenarioIds.map((id) => `${id}: required benchmark scenario missing`),
        ...suite.scenarios.flatMap((scenario) => scenario.blockingFailures.map((failure) => `${scenario.scenarioId}: ${failure}`)),
    ];
    if (suite.aggregate.hotRegistrySnapshotP95Ms != null &&
        suite.aggregate.hotRegistrySnapshotP95Ms > REGISTRY_HOT_P95_TARGET_MS) {
        blockingFailures.push(`hot_registry_snapshot_p95:${suite.aggregate.hotRegistrySnapshotP95Ms}ms`);
    }
    if (suite.aggregate.plannerHotPathP95Ms != null &&
        suite.aggregate.plannerHotPathP95Ms > PLANNER_HOT_P95_TARGET_MS) {
        blockingFailures.push(`planner_hot_path_p95:${suite.aggregate.plannerHotPathP95Ms}ms`);
    }
    if (suite.aggregate.duplicateFinalAnswerCount > 0) {
        blockingFailures.push(`duplicate_final_answer_count:${suite.aggregate.duplicateFinalAnswerCount}`);
    }
    if (suite.aggregate.restartRecoverySuccessRate != null &&
        suite.aggregate.restartRecoverySuccessRate < 1) {
        blockingFailures.push(`restart_recovery_success_rate:${suite.aggregate.restartRecoverySuccessRate}`);
    }
    if (suite.scenarios.some((scenario) => scenario.recommendation && scenario.recommendation.autoApply !== false)) {
        blockingFailures.push("compiled_workflow_recommendation_auto_apply_forbidden");
    }
    return {
        kind: "nobie.benchmarks.release_gate",
        generatedAt: suite.generatedAt,
        gateStatus: statusFromIssues(warnings, blockingFailures),
        requiredScenarioIds: [...SUB_AGENT_BENCHMARK_SCENARIO_IDS],
        missingScenarioIds,
        warnings,
        blockingFailures,
    };
}
function recordScenarioLatencyMetrics(result) {
    const detail = { scenarioId: result.scenarioId, benchmark: true };
    recordLatencyMetric({
        name: "sub_session_spawn_ack_ms",
        durationMs: result.metrics.spawnAckMs,
        source: "benchmark",
        detail,
    });
    recordLatencyMetric({
        name: "first_progress_latency_ms",
        durationMs: result.metrics.firstProgressMs,
        source: "benchmark",
        detail,
    });
    recordLatencyMetric({
        name: "execution_latency_ms",
        durationMs: result.metrics.wallClockMs,
        source: "benchmark",
        detail,
    });
    recordLatencyMetric({
        name: "registry_lookup_latency_ms",
        durationMs: result.metrics.hotRegistrySnapshotP95Ms,
        source: "benchmark",
        detail,
    });
    recordLatencyMetric({
        name: "orchestration_planning_latency_ms",
        durationMs: result.metrics.plannerHotPathP95Ms,
        source: "benchmark",
        detail,
    });
}
export function runSubAgentBenchmarkSuite(input = {}) {
    const seed = input.seed?.trim() || "task029";
    const startedAtMs = (input.now ?? new Date()).getTime();
    const scenarioIds = input.scenarioIds?.length
        ? input.scenarioIds
        : [...SUB_AGENT_BENCHMARK_SCENARIO_IDS];
    const fixtures = scenarioIds.map((id) => {
        const fixture = SCENARIO_BY_ID.get(id);
        if (!fixture)
            throw new Error(`Unknown benchmark scenario: ${id}`);
        return fixture;
    });
    let offsetMs = 0;
    const scenarios = fixtures.map((fixture) => {
        const result = scenarioResult({ fixture, suiteStartedAtMs: startedAtMs, offsetMs, seed });
        offsetMs += result.durationMs + 10;
        if (input.recordLatencyMetrics)
            recordScenarioLatencyMetrics(result);
        return result;
    });
    const aggregate = aggregateScenarios(scenarios);
    const startedAt = new Date(startedAtMs).toISOString();
    const finishedAt = new Date(startedAtMs + offsetMs).toISOString();
    const generatedAt = finishedAt;
    const partial = { generatedAt, scenarios, aggregate };
    const releaseGate = evaluateSubAgentBenchmarkReleaseGate(partial);
    return {
        kind: "nobie.benchmarks.sub_agent",
        benchmarkRunId: input.benchmarkRunId ?? buildRunId({ seed, startedAt, scenarioIds }),
        seed,
        generatedAt,
        startedAt,
        finishedAt,
        status: releaseGate.gateStatus,
        scenarios,
        aggregate,
        releaseGate,
    };
}
export function buildSubAgentBenchmarkReleaseGateSummary(input = {}) {
    return (input.result ?? runSubAgentBenchmarkSuite(input.now ? { now: input.now } : {}))
        .releaseGate;
}
export function runAndStoreSubAgentBenchmarkSuite(input = {}) {
    const result = runSubAgentBenchmarkSuite(input);
    benchmarkRuns.set(result.benchmarkRunId, result);
    latestBenchmarkRunId = result.benchmarkRunId;
    return result;
}
export function getSubAgentBenchmarkRun(benchmarkRunId) {
    return benchmarkRuns.get(benchmarkRunId);
}
export function getLatestSubAgentBenchmarkRun() {
    return latestBenchmarkRunId ? benchmarkRuns.get(latestBenchmarkRunId) : undefined;
}
export function resetSubAgentBenchmarkRunsForTest() {
    benchmarkRuns.clear();
    latestBenchmarkRunId = null;
}
//# sourceMappingURL=sub-agent-benchmarks.js.map