export declare const SUB_AGENT_BENCHMARK_SCENARIO_IDS: readonly ["bench.parallel_research_3", "bench.codebase_explore", "bench.writer_reviewer_loop", "bench.team_target_expansion", "bench.long_running_resume", "bench.permission_denied", "bench.focus_thread_followup", "bench.compiled_workflow_upgrade"];
export type SubAgentBenchmarkScenarioId = (typeof SUB_AGENT_BENCHMARK_SCENARIO_IDS)[number];
export type SubAgentBenchmarkStatus = "passed" | "warning" | "failed";
export interface SubAgentBenchmarkScenarioDefinition {
    id: SubAgentBenchmarkScenarioId;
    title: string;
    description: string;
    deterministicSeed: string;
    tags: string[];
}
export interface CompiledWorkflowRecommendation {
    recommendationId: string;
    title: string;
    reasonCodes: string[];
    confidence: number;
    estimatedWallClockSavingsPct: number;
    estimatedLlmCallSavingsPct: number;
    autoApply: false;
}
export interface SubAgentBenchmarkScenarioMetrics {
    spawnAckMs: number;
    firstProgressMs: number;
    wallClockMs: number;
    sequentialWallClockMs: number;
    parallelBranchCount: number;
    parallelEfficiency: number;
    llmCallCount: number;
    promptCacheHits: number;
    promptCacheMisses: number;
    promptCacheHitRate: number;
    inputTokens: number;
    outputTokens: number;
    tokenTotal: number;
    costEstimateUsd: number;
    duplicateFinalAnswerCount: number;
    restartRecoveryAttempted: boolean;
    restartRecoverySucceeded: boolean | null;
    userInterventionCount: number;
    hotRegistrySnapshotP95Ms: number;
    plannerHotPathP95Ms: number;
    finalAnswerOwnershipMaintained: boolean;
    memoryIsolationMaintained: boolean;
    permissionDeniedHandled: boolean;
}
export interface SubAgentBenchmarkScenarioResult {
    scenarioId: SubAgentBenchmarkScenarioId;
    title: string;
    status: SubAgentBenchmarkStatus;
    startedAt: string;
    finishedAt: string;
    durationMs: number;
    metrics: SubAgentBenchmarkScenarioMetrics;
    warnings: string[];
    blockingFailures: string[];
    recommendation?: CompiledWorkflowRecommendation;
}
export interface SubAgentBenchmarkAggregateMetrics {
    scenarioCount: number;
    spawnAckP95Ms: number | null;
    firstProgressP95Ms: number | null;
    wallClockP95Ms: number | null;
    totalWallClockMs: number;
    totalSequentialWallClockMs: number;
    averageParallelEfficiency: number;
    totalLlmCallCount: number;
    promptCacheHitRate: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCostEstimateUsd: number;
    duplicateFinalAnswerCount: number;
    restartRecoverySuccessRate: number | null;
    userInterventionCount: number;
    hotRegistrySnapshotP95Ms: number | null;
    plannerHotPathP95Ms: number | null;
    compiledWorkflowRecommendationCount: number;
}
export interface SubAgentBenchmarkReleaseGateSummary {
    kind: "nobie.benchmarks.release_gate";
    generatedAt: string;
    gateStatus: SubAgentBenchmarkStatus;
    requiredScenarioIds: SubAgentBenchmarkScenarioId[];
    missingScenarioIds: SubAgentBenchmarkScenarioId[];
    warnings: string[];
    blockingFailures: string[];
}
export interface SubAgentBenchmarkSuiteResult {
    kind: "nobie.benchmarks.sub_agent";
    benchmarkRunId: string;
    seed: string;
    generatedAt: string;
    startedAt: string;
    finishedAt: string;
    status: SubAgentBenchmarkStatus;
    scenarios: SubAgentBenchmarkScenarioResult[];
    aggregate: SubAgentBenchmarkAggregateMetrics;
    releaseGate: SubAgentBenchmarkReleaseGateSummary;
}
export interface RunSubAgentBenchmarkSuiteInput {
    scenarioIds?: SubAgentBenchmarkScenarioId[];
    now?: Date;
    seed?: string;
    benchmarkRunId?: string;
    recordLatencyMetrics?: boolean;
}
export declare function listSubAgentBenchmarkScenarios(): SubAgentBenchmarkScenarioDefinition[];
export declare function evaluateSubAgentBenchmarkReleaseGate(suite: Pick<SubAgentBenchmarkSuiteResult, "generatedAt" | "scenarios" | "aggregate">): SubAgentBenchmarkReleaseGateSummary;
export declare function runSubAgentBenchmarkSuite(input?: RunSubAgentBenchmarkSuiteInput): SubAgentBenchmarkSuiteResult;
export declare function buildSubAgentBenchmarkReleaseGateSummary(input?: {
    now?: Date;
    result?: SubAgentBenchmarkSuiteResult;
}): SubAgentBenchmarkReleaseGateSummary;
export declare function runAndStoreSubAgentBenchmarkSuite(input?: RunSubAgentBenchmarkSuiteInput): SubAgentBenchmarkSuiteResult;
export declare function getSubAgentBenchmarkRun(benchmarkRunId: string): SubAgentBenchmarkSuiteResult | undefined;
export declare function getLatestSubAgentBenchmarkRun(): SubAgentBenchmarkSuiteResult | undefined;
export declare function resetSubAgentBenchmarkRunsForTest(): void;
//# sourceMappingURL=sub-agent-benchmarks.d.ts.map