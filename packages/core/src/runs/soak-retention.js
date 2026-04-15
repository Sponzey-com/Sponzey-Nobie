import { readdirSync } from "node:fs";
import { sanitizeUserFacingError } from "./error-sanitizer.js";
export const DEFAULT_SOAK_PROFILES = {
    short: {
        id: "short",
        title: "Short development stability check",
        durationMs: 5 * 60 * 1000,
        sampleIntervalMs: 30 * 1000,
        operationIntervalMs: 30 * 1000,
        operationMix: [
            { kind: "safe_tool", weight: 3 },
            { kind: "memory_write", weight: 1 },
            { kind: "memory_read", weight: 1 },
            { kind: "schedule_tick", weight: 1 },
            { kind: "yeonjang_status", weight: 1 },
        ],
    },
    one_hour: {
        id: "one_hour",
        title: "One-hour operational stability check",
        durationMs: 60 * 60 * 1000,
        sampleIntervalMs: 60 * 1000,
        operationIntervalMs: 30 * 1000,
        operationMix: [
            { kind: "model_call", weight: 4 },
            { kind: "safe_tool", weight: 3 },
            { kind: "approval_tool", weight: 1 },
            { kind: "artifact_tool", weight: 1 },
            { kind: "memory_write", weight: 2 },
            { kind: "memory_read", weight: 2 },
            { kind: "schedule_tick", weight: 1 },
            { kind: "yeonjang_status", weight: 1 },
        ],
    },
    eight_hour: {
        id: "eight_hour",
        title: "Eight-hour operational stability check",
        durationMs: 8 * 60 * 60 * 1000,
        sampleIntervalMs: 5 * 60 * 1000,
        operationIntervalMs: 60 * 1000,
        operationMix: [
            { kind: "model_call", weight: 5 },
            { kind: "safe_tool", weight: 4 },
            { kind: "approval_tool", weight: 1 },
            { kind: "artifact_tool", weight: 2 },
            { kind: "memory_write", weight: 3 },
            { kind: "memory_read", weight: 3 },
            { kind: "schedule_tick", weight: 2 },
            { kind: "yeonjang_status", weight: 2 },
        ],
    },
    twenty_four_hour: {
        id: "twenty_four_hour",
        title: "Twenty-four-hour operational stability check",
        durationMs: 24 * 60 * 60 * 1000,
        sampleIntervalMs: 10 * 60 * 1000,
        operationIntervalMs: 2 * 60 * 1000,
        operationMix: [
            { kind: "model_call", weight: 5 },
            { kind: "safe_tool", weight: 4 },
            { kind: "approval_tool", weight: 1 },
            { kind: "artifact_tool", weight: 2 },
            { kind: "memory_write", weight: 3 },
            { kind: "memory_read", weight: 3 },
            { kind: "schedule_tick", weight: 3 },
            { kind: "yeonjang_status", weight: 3 },
        ],
    },
};
const RETENTION_DATA_KINDS = [
    "audit_log",
    "artifact",
    "temp_file",
    "short_term_memory",
    "schedule_history",
];
export const DEFAULT_RETENTION_POLICY = {
    audit_log: { maxAgeMs: 90 * 24 * 60 * 60 * 1000, maxCount: 50_000, maxBytes: 256 * 1024 * 1024 },
    artifact: { maxAgeMs: 30 * 24 * 60 * 60 * 1000, maxCount: 10_000, maxBytes: 10 * 1024 * 1024 * 1024 },
    temp_file: { maxAgeMs: 24 * 60 * 60 * 1000, maxCount: 5_000, maxBytes: 1024 * 1024 * 1024 },
    short_term_memory: { maxAgeMs: 7 * 24 * 60 * 60 * 1000, maxCount: 20_000, maxBytes: 512 * 1024 * 1024 },
    schedule_history: { maxAgeMs: 90 * 24 * 60 * 60 * 1000, maxCount: 10_000, maxBytes: 256 * 1024 * 1024 },
};
export const DEFAULT_RETRY_POLICIES = {
    model: { maxAttempts: 3, baseDelayMs: 1_000, maxDelayMs: 30_000 },
    channel: { maxAttempts: 3, baseDelayMs: 2_000, maxDelayMs: 60_000 },
    yeonjang: { maxAttempts: 6, baseDelayMs: 5_000, maxDelayMs: 60_000 },
    tool: { maxAttempts: 2, baseDelayMs: 1_000, maxDelayMs: 15_000 },
    delivery: { maxAttempts: 3, baseDelayMs: 2_000, maxDelayMs: 60_000 },
    scheduler: { maxAttempts: 3, baseDelayMs: 5_000, maxDelayMs: 120_000 },
};
export const DEFAULT_SOAK_HEALTH_THRESHOLDS = {
    runLatencyP95Ms: 15_000,
    memoryRetrievalP95Ms: 2_000,
    dbQueryP95Ms: 500,
    eventLoopLagP95Ms: 250,
    rssBytes: 1536 * 1024 * 1024,
    artifactCount: 10_000,
    auditRowCount: 100_000,
};
export function getSoakProfile(profile) {
    if (typeof profile !== "string")
        return profile;
    return DEFAULT_SOAK_PROFILES[profile];
}
export function expandSoakOperationMix(profile) {
    const operations = [];
    for (const entry of profile.operationMix) {
        const weight = Math.max(0, Math.trunc(entry.weight));
        for (let index = 0; index < weight; index += 1)
            operations.push(entry.kind);
    }
    return operations.length > 0 ? operations : ["safe_tool"];
}
export function collectSoakResourceMetrics(input = {}) {
    const cpu = process.cpuUsage();
    const memory = process.memoryUsage();
    const openFileDescriptorCount = input.openFileDescriptorCount ?? countOpenFileDescriptors();
    const metrics = {
        collectedAt: input.now ?? Date.now(),
        cpuUserMicros: cpu.user,
        cpuSystemMicros: cpu.system,
        rssBytes: memory.rss,
        heapUsedBytes: memory.heapUsed,
        heapTotalBytes: memory.heapTotal,
        externalBytes: memory.external,
        arrayBuffersBytes: memory.arrayBuffers,
        queueLength: input.queueLength ?? 0,
        activeRunCount: input.activeRunCount ?? 0,
        channelHealth: input.channelHealth ?? [],
    };
    if (openFileDescriptorCount !== undefined)
        metrics.openFileDescriptorCount = openFileDescriptorCount;
    if (input.mqttConnected !== undefined)
        metrics.mqttConnected = input.mqttConnected;
    return metrics;
}
export async function runSoakProfile(options) {
    const profile = getSoakProfile(options.profile);
    const operations = expandSoakOperationMix(profile);
    const now = options.now ?? Date.now;
    const wait = options.wait ?? ((durationMs) => new Promise((resolve) => setTimeout(resolve, durationMs)));
    const operationLimit = options.maxOperations ?? Math.max(1, Math.ceil(profile.durationMs / profile.operationIntervalMs));
    const startedAt = now();
    const deadline = startedAt + profile.durationMs;
    const metrics = [];
    const executions = [];
    let requestedStop = false;
    let lastSuccess;
    let lastFailure;
    const collectMetrics = options.collectMetrics ?? (() => collectSoakResourceMetrics({ now: now() }));
    metrics.push(collectMetrics());
    for (let iteration = 0; iteration < operationLimit; iteration += 1) {
        if (options.shouldStop?.()) {
            requestedStop = true;
            break;
        }
        if (iteration > 0 && now() >= deadline)
            break;
        const operation = operations[iteration % operations.length] ?? "safe_tool";
        const operationStartedAt = now();
        const context = { profile, operation, iteration, startedAt: operationStartedAt };
        let execution;
        try {
            const result = await options.executeOperation(operation, context);
            execution = buildSoakExecution(operation, iteration, operationStartedAt, now(), result);
        }
        catch (error) {
            execution = buildSoakExecution(operation, iteration, operationStartedAt, now(), {
                ok: false,
                errorMessage: error instanceof Error ? error.message : String(error),
            });
        }
        executions.push(execution);
        if (execution.ok)
            lastSuccess = execution;
        else {
            lastFailure = execution;
            if (options.stopOnFailure)
                break;
        }
        metrics.push(collectMetrics());
        if (options.waitBetweenOperations !== false && iteration + 1 < operationLimit) {
            await wait(profile.operationIntervalMs);
        }
    }
    const finishedAt = now();
    const summaryInput = {
        profile,
        startedAt,
        finishedAt,
        requestedStop,
        operations: executions,
        metrics,
    };
    if (lastSuccess)
        summaryInput.lastSuccess = lastSuccess;
    if (lastFailure)
        summaryInput.lastFailure = lastFailure;
    const summary = buildSoakRunSummary(summaryInput);
    return summary;
}
export function calculateSoakLatencyStats(samples) {
    if (samples.length === 0) {
        return { count: 0, minMs: 0, maxMs: 0, averageMs: 0, p50Ms: 0, p95Ms: 0, p99Ms: 0 };
    }
    const sorted = [...samples].sort((a, b) => a - b);
    const sum = sorted.reduce((total, value) => total + value, 0);
    return {
        count: sorted.length,
        minMs: sorted[0] ?? 0,
        maxMs: sorted.at(-1) ?? 0,
        averageMs: sum / sorted.length,
        p50Ms: percentile(sorted, 50),
        p95Ms: percentile(sorted, 95),
        p99Ms: percentile(sorted, 99),
    };
}
export function buildSoakHealthSummary(input) {
    const thresholds = { ...DEFAULT_SOAK_HEALTH_THRESHOLDS, ...input.thresholds };
    const runLatency = calculateSoakLatencyStats(input.runLatencyMs ?? []);
    const memoryRetrievalLatency = calculateSoakLatencyStats(input.memoryRetrievalLatencyMs ?? []);
    const dbQueryLatency = calculateSoakLatencyStats(input.dbQueryLatencyMs ?? []);
    const eventLoopLag = calculateSoakLatencyStats(input.eventLoopLagMs ?? []);
    const degradedReasons = [];
    if (runLatency.p95Ms > thresholds.runLatencyP95Ms)
        degradedReasons.push("run_latency_p95");
    if (memoryRetrievalLatency.p95Ms > thresholds.memoryRetrievalP95Ms)
        degradedReasons.push("memory_retrieval_p95");
    if (dbQueryLatency.p95Ms > thresholds.dbQueryP95Ms)
        degradedReasons.push("db_query_p95");
    if (eventLoopLag.p95Ms > thresholds.eventLoopLagP95Ms)
        degradedReasons.push("event_loop_lag_p95");
    if (input.rssBytes !== undefined && input.rssBytes > thresholds.rssBytes)
        degradedReasons.push("rss_bytes");
    if (input.artifactCount !== undefined && input.artifactCount > thresholds.artifactCount)
        degradedReasons.push("artifact_count");
    if (input.auditRowCount !== undefined && input.auditRowCount > thresholds.auditRowCount)
        degradedReasons.push("audit_row_count");
    const summary = {
        status: degradedReasons.length > 0 ? "degraded" : "healthy",
        degradedReasons,
        runLatency,
        memoryRetrievalLatency,
        dbQueryLatency,
        eventLoopLag,
    };
    if (input.rssBytes !== undefined)
        summary.rssBytes = input.rssBytes;
    if (input.artifactCount !== undefined)
        summary.artifactCount = input.artifactCount;
    if (input.auditRowCount !== undefined)
        summary.auditRowCount = input.auditRowCount;
    return summary;
}
export function buildSoakReportPayload(summary, health) {
    return {
        profileId: summary.profile.id,
        startedAt: summary.startedAt,
        finishedAt: summary.finishedAt,
        totalOperations: summary.totalOperations,
        succeededOperations: summary.succeededOperations,
        failedOperations: summary.failedOperations,
        metricSampleCount: summary.metrics.length,
        auditSummary: summary.auditSummary,
        health,
    };
}
export function buildSoakReportArtifact(summary, health) {
    return JSON.stringify(buildSoakReportPayload(summary, health), null, 2);
}
export function buildRetentionCleanupPlan(options) {
    const now = options.now ?? Date.now();
    const dryRun = options.dryRun ?? true;
    const activeRunIds = new Set(options.activeRunIds ?? []);
    const policy = mergeRetentionPolicy(options.policy);
    const candidateById = new Map();
    const skippedActive = [];
    for (const item of options.items) {
        if (isActiveRetentionItem(item, activeRunIds))
            skippedActive.push(item);
    }
    for (const kind of RETENTION_DATA_KINDS) {
        const items = options.items.filter((item) => item.kind === kind && !isActiveRetentionItem(item, activeRunIds));
        const limits = policy[kind];
        if (limits.maxAgeMs !== undefined && limits.maxAgeMs >= 0) {
            const cutoff = now - limits.maxAgeMs;
            for (const item of items) {
                if (item.createdAt <= cutoff)
                    markRetentionCandidate(candidateById, item, "max_age");
            }
        }
        if (limits.maxCount !== undefined && limits.maxCount >= 0) {
            const byNewest = [...items].sort(compareRetentionNewestFirst);
            for (const item of byNewest.slice(limits.maxCount))
                markRetentionCandidate(candidateById, item, "max_count");
        }
        if (limits.maxBytes !== undefined && limits.maxBytes >= 0) {
            const byNewest = [...items].sort(compareRetentionNewestFirst);
            let totalBytes = 0;
            for (const item of byNewest) {
                totalBytes += item.sizeBytes;
                if (totalBytes > limits.maxBytes)
                    markRetentionCandidate(candidateById, item, "max_bytes");
            }
        }
    }
    const candidates = [...candidateById.values()].sort(compareRetentionOldestFirst);
    const byKind = buildRetentionKindSummary(candidates, skippedActive);
    const estimatedBytes = candidates.reduce((sum, candidate) => sum + candidate.sizeBytes, 0);
    return {
        dryRun,
        now,
        candidates,
        skippedActive,
        estimatedBytes,
        byKind,
        auditSummary: formatRetentionAuditSummary({ dryRun, candidates, skippedActive, estimatedBytes }),
    };
}
export async function runRetentionCleanup(options) {
    const plan = buildRetentionCleanupPlan(options);
    const deleted = [];
    const failures = [];
    if (!plan.dryRun) {
        for (const candidate of plan.candidates) {
            try {
                if (!options.deleteCandidate)
                    throw new Error("retention cleanup delete handler is not configured");
                await options.deleteCandidate(candidate);
                deleted.push(candidate);
            }
            catch (error) {
                const sanitized = sanitizeUserFacingError(error instanceof Error ? error.message : String(error));
                failures.push({ candidate, errorKind: sanitized.kind, userMessage: sanitized.userMessage });
            }
        }
    }
    const result = { plan, deleted, failures, auditRecorded: false };
    if (options.recordAudit) {
        await options.recordAudit(result);
        result.auditRecorded = true;
    }
    return result;
}
export function buildRetryFailureFingerprint(input) {
    const sanitized = sanitizeUserFacingError(input.errorMessage);
    const parts = [
        ["domain", input.domain],
        ["kind", sanitized.kind],
        ["channel", input.channel],
        ["provider", input.provider],
        ["model", input.model],
        ["tool", input.toolName],
        ["target", input.targetId],
        ["extension", input.extensionId],
    ];
    return parts
        .filter(([, value]) => value !== undefined && value.trim().length > 0)
        .map(([key, value]) => `${key}=${normalizeFingerprintComponent(value ?? "unknown")}`)
        .join("|");
}
export function evaluateRetryBackoff(input) {
    const defaultPolicy = input.domain ? DEFAULT_RETRY_POLICIES[input.domain] : DEFAULT_RETRY_POLICIES.tool;
    const attempt = Math.max(1, Math.trunc(input.attempt));
    const maxAttempts = Math.max(1, Math.trunc(input.maxAttempts ?? defaultPolicy.maxAttempts));
    const baseDelayMs = Math.max(0, input.baseDelayMs ?? defaultPolicy.baseDelayMs);
    const maxDelayMs = Math.max(baseDelayMs, input.maxDelayMs ?? defaultPolicy.maxDelayMs);
    const exhausted = attempt >= maxAttempts;
    const decision = {
        attempt,
        maxAttempts,
        shouldRetry: !exhausted,
        exhausted,
        reason: exhausted ? "retry_exhausted" : "retry_scheduled",
    };
    if (!exhausted)
        decision.nextDelayMs = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
    return decision;
}
export function shouldStopRepeatedFailure(input) {
    const threshold = Math.max(1, Math.trunc(input.threshold));
    const seenCount = Math.max(0, Math.trunc(input.seenCount));
    return {
        fingerprint: input.fingerprint,
        seenCount,
        threshold,
        shouldStop: seenCount >= threshold,
    };
}
function buildSoakExecution(operation, iteration, startedAt, completedAt, result) {
    const execution = {
        operation,
        iteration,
        startedAt,
        completedAt,
        ok: result.ok,
    };
    if (result.summary)
        execution.summary = result.summary;
    if (!result.ok) {
        const sanitized = sanitizeUserFacingError(result.errorMessage);
        execution.errorKind = sanitized.kind;
        execution.userMessage = sanitized.userMessage;
        if (!execution.summary)
            execution.summary = sanitized.reason;
    }
    return execution;
}
function buildSoakRunSummary(input) {
    const succeededOperations = input.operations.filter((operation) => operation.ok).length;
    const failedOperations = input.operations.length - succeededOperations;
    const summary = {
        profile: input.profile,
        startedAt: input.startedAt,
        finishedAt: input.finishedAt,
        requestedStop: input.requestedStop,
        totalOperations: input.operations.length,
        succeededOperations,
        failedOperations,
        operations: input.operations,
        metrics: input.metrics,
        auditSummary: `soak:${input.profile.id} operations=${input.operations.length} success=${succeededOperations} failed=${failedOperations}`,
    };
    if (input.lastSuccess)
        summary.lastSuccess = input.lastSuccess;
    if (input.lastFailure)
        summary.lastFailure = input.lastFailure;
    return summary;
}
function countOpenFileDescriptors() {
    try {
        return readdirSync("/proc/self/fd").length;
    }
    catch {
        return undefined;
    }
}
function percentile(sortedAscending, percentileRank) {
    if (sortedAscending.length === 0)
        return 0;
    const boundedRank = Math.min(100, Math.max(0, percentileRank));
    const index = Math.max(0, Math.ceil((boundedRank / 100) * sortedAscending.length) - 1);
    return sortedAscending[index] ?? 0;
}
function mergeRetentionPolicy(policy) {
    return {
        audit_log: { ...DEFAULT_RETENTION_POLICY.audit_log, ...policy?.audit_log },
        artifact: { ...DEFAULT_RETENTION_POLICY.artifact, ...policy?.artifact },
        temp_file: { ...DEFAULT_RETENTION_POLICY.temp_file, ...policy?.temp_file },
        short_term_memory: { ...DEFAULT_RETENTION_POLICY.short_term_memory, ...policy?.short_term_memory },
        schedule_history: { ...DEFAULT_RETENTION_POLICY.schedule_history, ...policy?.schedule_history },
    };
}
function isActiveRetentionItem(item, activeRunIds) {
    return item.active === true || (item.runId !== undefined && activeRunIds.has(item.runId));
}
function markRetentionCandidate(candidateById, item, reason) {
    const existing = candidateById.get(item.id);
    if (existing) {
        if (!existing.reasons.includes(reason))
            existing.reasons.push(reason);
        return;
    }
    candidateById.set(item.id, { ...item, reasons: [reason] });
}
function compareRetentionNewestFirst(a, b) {
    return b.createdAt - a.createdAt || a.id.localeCompare(b.id);
}
function compareRetentionOldestFirst(a, b) {
    return a.createdAt - b.createdAt || a.id.localeCompare(b.id);
}
function buildRetentionKindSummary(candidates, skippedActive) {
    const summary = Object.fromEntries(RETENTION_DATA_KINDS.map((kind) => [kind, { candidateCount: 0, skippedActiveCount: 0, estimatedBytes: 0 }]));
    for (const candidate of candidates) {
        const entry = summary[candidate.kind];
        entry.candidateCount += 1;
        entry.estimatedBytes += candidate.sizeBytes;
    }
    for (const item of skippedActive)
        summary[item.kind].skippedActiveCount += 1;
    return summary;
}
function formatRetentionAuditSummary(input) {
    return `retention:${input.dryRun ? "dry-run" : "apply"} candidates=${input.candidates.length} bytes=${input.estimatedBytes} skipped_active=${input.skippedActive.length}`;
}
function normalizeFingerprintComponent(value) {
    return value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 120) || "unknown";
}
