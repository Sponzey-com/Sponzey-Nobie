import { type SanitizedErrorKind } from "./error-sanitizer.js";
export type SoakProfileId = "short" | "one_hour" | "eight_hour" | "twenty_four_hour";
export type SoakOperationKind = "model_call" | "safe_tool" | "approval_tool" | "artifact_tool" | "memory_write" | "memory_read" | "schedule_tick" | "yeonjang_status";
export interface SoakOperationWeight {
    kind: SoakOperationKind;
    weight: number;
}
export interface SoakProfile {
    id: SoakProfileId;
    title: string;
    durationMs: number;
    sampleIntervalMs: number;
    operationIntervalMs: number;
    operationMix: SoakOperationWeight[];
}
export interface SoakChannelHealth {
    name: "webui" | "telegram" | "slack" | "mqtt" | "yeonjang" | string;
    healthy: boolean;
    connected?: boolean;
    queueLength?: number;
    lastEventAt?: number;
    reason?: string;
}
export interface SoakResourceMetrics {
    collectedAt: number;
    cpuUserMicros: number;
    cpuSystemMicros: number;
    rssBytes: number;
    heapUsedBytes: number;
    heapTotalBytes: number;
    externalBytes: number;
    arrayBuffersBytes: number;
    queueLength: number;
    activeRunCount: number;
    channelHealth: SoakChannelHealth[];
    openFileDescriptorCount?: number;
    mqttConnected?: boolean;
}
export interface SoakLatencyStats {
    count: number;
    minMs: number;
    maxMs: number;
    averageMs: number;
    p50Ms: number;
    p95Ms: number;
    p99Ms: number;
}
export type SoakHealthStatus = "healthy" | "degraded";
export interface SoakHealthThresholds {
    runLatencyP95Ms: number;
    memoryRetrievalP95Ms: number;
    dbQueryP95Ms: number;
    eventLoopLagP95Ms: number;
    rssBytes: number;
    artifactCount: number;
    auditRowCount: number;
}
export interface SoakHealthInput {
    runLatencyMs?: number[];
    memoryRetrievalLatencyMs?: number[];
    dbQueryLatencyMs?: number[];
    eventLoopLagMs?: number[];
    rssBytes?: number;
    artifactCount?: number;
    auditRowCount?: number;
    thresholds?: Partial<SoakHealthThresholds>;
}
export interface SoakHealthSummary {
    status: SoakHealthStatus;
    degradedReasons: string[];
    runLatency: SoakLatencyStats;
    memoryRetrievalLatency: SoakLatencyStats;
    dbQueryLatency: SoakLatencyStats;
    eventLoopLag: SoakLatencyStats;
    rssBytes?: number;
    artifactCount?: number;
    auditRowCount?: number;
}
export interface SoakReportPayload {
    profileId: SoakProfileId;
    startedAt: number;
    finishedAt: number;
    totalOperations: number;
    succeededOperations: number;
    failedOperations: number;
    metricSampleCount: number;
    auditSummary: string;
    health: SoakHealthSummary;
}
export interface SoakOperationContext {
    profile: SoakProfile;
    operation: SoakOperationKind;
    iteration: number;
    startedAt: number;
}
export interface SoakOperationResult {
    ok: boolean;
    summary?: string;
    errorMessage?: string;
}
export interface SoakOperationExecution {
    operation: SoakOperationKind;
    iteration: number;
    startedAt: number;
    completedAt: number;
    ok: boolean;
    summary?: string;
    errorKind?: SanitizedErrorKind;
    userMessage?: string;
}
export interface SoakRunSummary {
    profile: SoakProfile;
    startedAt: number;
    finishedAt: number;
    requestedStop: boolean;
    totalOperations: number;
    succeededOperations: number;
    failedOperations: number;
    operations: SoakOperationExecution[];
    metrics: SoakResourceMetrics[];
    auditSummary: string;
    lastSuccess?: SoakOperationExecution;
    lastFailure?: SoakOperationExecution;
}
export interface SoakRunnerOptions {
    profile: SoakProfileId | SoakProfile;
    maxOperations?: number;
    waitBetweenOperations?: boolean;
    stopOnFailure?: boolean;
    now?: () => number;
    wait?: (durationMs: number) => Promise<void>;
    collectMetrics?: () => SoakResourceMetrics;
    shouldStop?: () => boolean;
    executeOperation: (operation: SoakOperationKind, context: SoakOperationContext) => Promise<SoakOperationResult>;
}
export declare const DEFAULT_SOAK_PROFILES: Record<SoakProfileId, SoakProfile>;
export type RetentionDataKind = "audit_log" | "artifact" | "temp_file" | "short_term_memory" | "schedule_history";
export type RetentionCleanupReason = "max_age" | "max_count" | "max_bytes";
export interface RetentionKindPolicy {
    maxAgeMs?: number;
    maxCount?: number;
    maxBytes?: number;
}
export type RetentionPolicy = Record<RetentionDataKind, RetentionKindPolicy>;
export interface RetentionItem {
    id: string;
    kind: RetentionDataKind;
    createdAt: number;
    sizeBytes: number;
    path?: string;
    runId?: string;
    active?: boolean;
}
export interface RetentionCleanupCandidate extends RetentionItem {
    reasons: RetentionCleanupReason[];
}
export interface RetentionCleanupKindSummary {
    candidateCount: number;
    skippedActiveCount: number;
    estimatedBytes: number;
}
export interface RetentionCleanupPlan {
    dryRun: boolean;
    now: number;
    candidates: RetentionCleanupCandidate[];
    skippedActive: RetentionItem[];
    estimatedBytes: number;
    byKind: Record<RetentionDataKind, RetentionCleanupKindSummary>;
    auditSummary: string;
}
export interface RetentionCleanupFailure {
    candidate: RetentionCleanupCandidate;
    errorKind: SanitizedErrorKind;
    userMessage: string;
}
export interface RetentionCleanupResult {
    plan: RetentionCleanupPlan;
    deleted: RetentionCleanupCandidate[];
    failures: RetentionCleanupFailure[];
    auditRecorded: boolean;
}
export interface RetentionCleanupOptions {
    items: RetentionItem[];
    activeRunIds?: Iterable<string>;
    policy?: Partial<Record<RetentionDataKind, RetentionKindPolicy>>;
    now?: number;
    dryRun?: boolean;
}
export interface RetentionCleanupApplyOptions extends RetentionCleanupOptions {
    deleteCandidate?: (candidate: RetentionCleanupCandidate) => Promise<void> | void;
    recordAudit?: (result: RetentionCleanupResult) => Promise<void> | void;
}
export type RetryFailureDomain = "model" | "channel" | "yeonjang" | "tool" | "delivery" | "scheduler";
export interface RetryPolicy {
    maxAttempts: number;
    baseDelayMs: number;
    maxDelayMs: number;
}
export interface RetryFailureFingerprintInput {
    domain: RetryFailureDomain;
    channel?: string;
    provider?: string;
    model?: string;
    toolName?: string;
    targetId?: string;
    extensionId?: string;
    errorMessage?: string;
}
export interface RetryBackoffInput {
    domain?: RetryFailureDomain;
    attempt: number;
    maxAttempts?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
}
export interface RetryBackoffDecision {
    attempt: number;
    maxAttempts: number;
    shouldRetry: boolean;
    exhausted: boolean;
    reason: "retry_scheduled" | "retry_exhausted";
    nextDelayMs?: number;
}
export interface RepeatedFailureStopDecision {
    fingerprint: string;
    seenCount: number;
    threshold: number;
    shouldStop: boolean;
}
export declare const DEFAULT_RETENTION_POLICY: RetentionPolicy;
export declare const DEFAULT_RETRY_POLICIES: Record<RetryFailureDomain, RetryPolicy>;
export declare const DEFAULT_SOAK_HEALTH_THRESHOLDS: SoakHealthThresholds;
export declare function getSoakProfile(profile: SoakProfileId | SoakProfile): SoakProfile;
export declare function expandSoakOperationMix(profile: SoakProfile): SoakOperationKind[];
export declare function collectSoakResourceMetrics(input?: {
    now?: number;
    queueLength?: number;
    activeRunCount?: number;
    mqttConnected?: boolean;
    channelHealth?: SoakChannelHealth[];
    openFileDescriptorCount?: number;
}): SoakResourceMetrics;
export declare function runSoakProfile(options: SoakRunnerOptions): Promise<SoakRunSummary>;
export declare function calculateSoakLatencyStats(samples: readonly number[]): SoakLatencyStats;
export declare function buildSoakHealthSummary(input: SoakHealthInput): SoakHealthSummary;
export declare function buildSoakReportPayload(summary: SoakRunSummary, health: SoakHealthSummary): SoakReportPayload;
export declare function buildSoakReportArtifact(summary: SoakRunSummary, health: SoakHealthSummary): string;
export declare function buildRetentionCleanupPlan(options: RetentionCleanupOptions): RetentionCleanupPlan;
export declare function runRetentionCleanup(options: RetentionCleanupApplyOptions): Promise<RetentionCleanupResult>;
export declare function buildRetryFailureFingerprint(input: RetryFailureFingerprintInput): string;
export declare function evaluateRetryBackoff(input: RetryBackoffInput): RetryBackoffDecision;
export declare function shouldStopRepeatedFailure(input: {
    fingerprint: string;
    seenCount: number;
    threshold: number;
}): RepeatedFailureStopDecision;
