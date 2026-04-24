import { randomUUID } from "node:crypto";
import { reviewSubAgentResult, } from "../agent/sub-agent-result-review.js";
import { CONTRACT_SCHEMA_VERSION } from "../contracts/index.js";
import { normalizeNicknameSnapshot, } from "../contracts/sub-agent-orchestration.js";
import { recordControlEvent } from "../control-plane/timeline.js";
import { getRunSubSessionByIdempotencyKey, insertRunSubSession, updateRunSubSession, } from "../db/index.js";
import { recordLatencyMetric } from "../observability/latency.js";
import { recordMessageLedgerEvent } from "../runs/message-ledger.js";
import { appendRunEvent, getRootRun } from "../runs/store.js";
import { buildModelExecutionAuditSummary, estimateTokenCount, resolveFallbackModelExecutionPolicy, resolveModelExecutionPolicy, } from "./model-execution-policy.js";
import { createSubSessionProgressAggregator, } from "./sub-session-progress-aggregation.js";
export const SUB_SESSION_STATUS_TRANSITIONS = {
    created: ["queued", "failed", "cancelled"],
    queued: ["running", "failed", "cancelled"],
    running: [
        "waiting_for_input",
        "awaiting_approval",
        "completed",
        "needs_revision",
        "failed",
        "cancelled",
    ],
    waiting_for_input: ["running", "completed", "needs_revision", "failed", "cancelled"],
    awaiting_approval: ["running", "completed", "needs_revision", "failed", "cancelled"],
    completed: [],
    needs_revision: [],
    failed: [],
    cancelled: [],
};
export class InvalidSubSessionStatusTransitionError extends Error {
    from;
    to;
    subSessionId;
    constructor(input) {
        super(`Invalid sub-session status transition: ${input.from} -> ${input.to}`);
        this.name = "InvalidSubSessionStatusTransitionError";
        this.from = input.from;
        this.to = input.to;
        if (input.subSessionId !== undefined) {
            this.subSessionId = input.subSessionId;
        }
    }
}
const ACTIVE_RECOVERY_STATUSES = new Set([
    "created",
    "queued",
    "running",
    "waiting_for_input",
    "awaiting_approval",
]);
const REPLAY_STATUSES = new Set([
    "completed",
    "needs_revision",
    "failed",
    "cancelled",
]);
function isReplayableStatus(status) {
    return REPLAY_STATUSES.has(status);
}
export function canTransitionSubSessionStatus(from, to) {
    return from === to || SUB_SESSION_STATUS_TRANSITIONS[from].includes(to);
}
export function transitionSubSessionStatus(subSession, status, now) {
    if (!canTransitionSubSessionStatus(subSession.status, status)) {
        throw new InvalidSubSessionStatusTransitionError({
            from: subSession.status,
            to: status,
            subSessionId: subSession.subSessionId,
        });
    }
    subSession.status = status;
    if (status === "running" && subSession.startedAt === undefined) {
        subSession.startedAt = now;
    }
    if (status === "completed" ||
        status === "needs_revision" ||
        status === "failed" ||
        status === "cancelled") {
        subSession.finishedAt = now;
    }
    return subSession;
}
function isAbortLike(error) {
    if (!error || typeof error !== "object")
        return false;
    const record = error;
    return record.name === "AbortError" || record.code === "ABORT_ERR";
}
function asErrorMessage(error) {
    return error instanceof Error && error.message.trim()
        ? error.message
        : "sub-session execution failed";
}
function parseStoredSubSession(value) {
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === "object" ? parsed : undefined;
    }
    catch {
        return undefined;
    }
}
function defaultIdProvider() {
    return randomUUID();
}
function buildProgressEvent(input) {
    const speaker = commandTargetNicknameSnapshot(input.command);
    return {
        identity: {
            ...input.command.identity,
            entityType: "sub_session",
            entityId: input.command.subSessionId,
            idempotencyKey: `sub-session-progress:${input.command.subSessionId}:${input.idProvider()}`,
            parent: {
                ...input.command.identity.parent,
                parentRunId: input.command.parentRunId,
            },
        },
        eventId: input.idProvider(),
        parentRunId: input.command.parentRunId,
        subSessionId: input.command.subSessionId,
        ...(speaker ? { speaker } : {}),
        status: input.status,
        summary: input.summary,
        at: input.now,
    };
}
function commandTargetNicknameSnapshot(command) {
    const nicknameSnapshot = command.targetNicknameSnapshot
        ? normalizeNicknameSnapshot(command.targetNicknameSnapshot)
        : "";
    if (!nicknameSnapshot)
        return undefined;
    return {
        entityType: "sub_agent",
        entityId: command.targetAgentId,
        nicknameSnapshot,
    };
}
function normalizeTargetNicknameSnapshot(input) {
    const nickname = input.command.targetNicknameSnapshot ?? input.agent.nickname;
    const normalized = nickname ? normalizeNicknameSnapshot(nickname) : "";
    return normalized || undefined;
}
function withEffectiveNicknameSnapshots(input) {
    if (input.command.targetNicknameSnapshot || !input.agent.nickname)
        return input;
    return {
        ...input,
        command: {
            ...input.command,
            targetNicknameSnapshot: normalizeNicknameSnapshot(input.agent.nickname),
        },
    };
}
function parentAgentIdSnapshot(input) {
    if (input.parentAgent?.agentId)
        return input.parentAgent.agentId;
    const owner = input.command.identity.owner;
    if ((owner.ownerType === "nobie" || owner.ownerType === "sub_agent") &&
        owner.ownerId !== input.command.targetAgentId) {
        return owner.ownerId;
    }
    return undefined;
}
function parentAgentNicknameSnapshot(input) {
    const normalized = input.parentAgent?.nickname
        ? normalizeNicknameSnapshot(input.parentAgent.nickname)
        : "";
    return normalized || undefined;
}
function buildErrorReport(input) {
    return {
        identity: {
            ...input.command.identity,
            entityType: "sub_session",
            entityId: input.command.subSessionId,
            idempotencyKey: `sub-session-error:${input.command.subSessionId}:${input.reasonCode}:${input.idProvider()}`,
            parent: {
                ...input.command.identity.parent,
                parentRunId: input.command.parentRunId,
            },
        },
        errorReportId: input.idProvider(),
        parentRunId: input.command.parentRunId,
        subSessionId: input.command.subSessionId,
        reasonCode: input.reasonCode,
        safeMessage: input.safeMessage,
        retryable: input.retryable,
    };
}
function promptBundlePreflightIssueCodes(input) {
    const issueCodes = new Set();
    if (input.promptBundle.validation && !input.promptBundle.validation.ok) {
        for (const issueCode of input.promptBundle.validation.issueCodes) {
            issueCodes.add(issueCode);
        }
        if (input.promptBundle.validation.issueCodes.length === 0) {
            issueCodes.add("prompt_bundle_validation_failed");
        }
    }
    if (input.command.expectedOutputs.length === 0)
        issueCodes.add("expected_output_required");
    if (input.promptBundle.completionCriteria && input.promptBundle.completionCriteria.length === 0) {
        issueCodes.add("expected_output_required");
    }
    return [...issueCodes].sort();
}
export function buildSubSessionContract(input) {
    const agentNickname = normalizeTargetNicknameSnapshot(input);
    const parentAgentId = parentAgentIdSnapshot(input);
    const parentAgentNickname = parentAgentNicknameSnapshot(input);
    const identity = {
        ...input.command.identity,
        schemaVersion: CONTRACT_SCHEMA_VERSION,
        entityType: "sub_session",
        entityId: input.command.subSessionId,
        owner: { ownerType: "sub_agent", ownerId: input.command.targetAgentId },
        idempotencyKey: input.command.identity.idempotencyKey ||
            `sub-session:${input.command.parentRunId}:${input.command.subSessionId}`,
        parent: {
            ...input.command.identity.parent,
            parentRunId: input.command.parentRunId,
            parentSessionId: input.parentSessionId,
        },
    };
    return {
        identity,
        subSessionId: input.command.subSessionId,
        parentSessionId: input.parentSessionId,
        parentRunId: input.command.parentRunId,
        ...(parentAgentId ? { parentAgentId } : {}),
        ...(input.parentAgent?.displayName
            ? { parentAgentDisplayName: input.parentAgent.displayName }
            : {}),
        ...(parentAgentNickname ? { parentAgentNickname } : {}),
        agentId: input.agent.agentId,
        agentDisplayName: input.agent.displayName,
        ...(agentNickname ? { agentNickname } : {}),
        commandRequestId: input.command.commandRequestId,
        status: "created",
        retryBudgetRemaining: input.command.retryBudget,
        promptBundleId: input.promptBundle.bundleId,
        promptBundleSnapshot: input.promptBundle,
        ...(input.modelExecutionPolicy ? { modelExecutionSnapshot: input.modelExecutionPolicy } : {}),
    };
}
export class ResourceLockManager {
    holders = new Map();
    canAcquire(locks) {
        const conflicts = [];
        for (const lock of locks) {
            const existing = this.holders.get(this.lockKey(lock)) ?? [];
            for (const holder of existing) {
                if (holder.lock.mode === "exclusive" || lock.mode === "exclusive") {
                    conflicts.push(holder.lock);
                }
            }
        }
        return { ok: conflicts.length === 0, conflicts };
    }
    acquire(holderId, locks) {
        const check = this.canAcquire(locks);
        if (!check.ok)
            return check;
        for (const lock of locks) {
            const key = this.lockKey(lock);
            const existing = this.holders.get(key) ?? [];
            existing.push({ holderId, lock });
            this.holders.set(key, existing);
        }
        return check;
    }
    release(holderId) {
        for (const [key, holders] of this.holders.entries()) {
            const remaining = holders.filter((holder) => holder.holderId !== holderId);
            if (remaining.length === 0)
                this.holders.delete(key);
            else
                this.holders.set(key, remaining);
        }
    }
    lockKey(lock) {
        return `${lock.kind}:${lock.target}`;
    }
}
function normalizedPositiveLimit(value) {
    if (value === undefined || !Number.isFinite(value) || value <= 0)
        return undefined;
    return Math.floor(value);
}
function countLimitExceeded(key, counts, explicitLimits, defaultLimit) {
    if (!key)
        return false;
    const limit = normalizedPositiveLimit(explicitLimits?.[key] ?? defaultLimit);
    if (limit === undefined)
        return false;
    return (counts.get(key) ?? 0) >= limit;
}
function addCount(key, counts) {
    if (!key)
        return;
    counts.set(key, (counts.get(key) ?? 0) + 1);
}
function uniqueValues(values) {
    return [...new Set((values ?? []).filter((value) => value.trim()))];
}
function concurrencyLimitReasons(item, counts, options) {
    const reasons = new Set();
    if (countLimitExceeded(item.agentId, counts.agents, options.agentConcurrencyLimits, options.defaultAgentConcurrencyLimit)) {
        reasons.add("agent_concurrency_limit");
    }
    for (const toolName of uniqueValues(item.toolNames)) {
        if (countLimitExceeded(toolName, counts.tools, options.toolConcurrencyLimits, options.defaultToolConcurrencyLimit)) {
            reasons.add("tool_concurrency_limit");
        }
    }
    for (const serverId of uniqueValues(item.mcpServerIds)) {
        if (countLimitExceeded(serverId, counts.mcpServers, options.mcpServerConcurrencyLimits, options.defaultMcpServerConcurrencyLimit)) {
            reasons.add("mcp_concurrency_limit");
        }
    }
    return [...reasons];
}
function reserveConcurrency(item, counts) {
    addCount(item.agentId, counts.agents);
    for (const toolName of uniqueValues(item.toolNames))
        addCount(toolName, counts.tools);
    for (const serverId of uniqueValues(item.mcpServerIds))
        addCount(serverId, counts.mcpServers);
}
export function planSubSessionExecutionWaves(items, group, options = {}) {
    const byTaskId = new Map(items.map((item) => [item.taskId, item]));
    const pending = new Set(items.map((item) => item.taskId));
    const completed = new Set();
    const dependencyMap = new Map();
    const deferredReasonCodesByTask = new Map();
    const limit = Math.max(1, group?.concurrencyLimit ?? items.length);
    for (const item of items) {
        dependencyMap.set(item.taskId, new Set(item.dependencies ?? []));
    }
    for (const edge of group?.dependencyEdges ?? []) {
        const deps = dependencyMap.get(edge.toTaskId) ?? new Set();
        deps.add(edge.fromTaskId);
        dependencyMap.set(edge.toTaskId, deps);
    }
    const waves = [];
    while (pending.size > 0) {
        const waveLocks = new ResourceLockManager();
        const waveCounts = {
            agents: new Map(),
            tools: new Map(),
            mcpServers: new Map(),
        };
        const waveItems = [];
        const candidates = [...pending]
            .map((taskId) => byTaskId.get(taskId))
            .filter((item) => Boolean(item))
            .filter((item) => {
            const deps = dependencyMap.get(item.taskId) ?? new Set();
            return [...deps].every((dep) => completed.has(dep));
        });
        for (const item of candidates) {
            if (waveItems.length >= limit) {
                rememberDeferredReason(deferredReasonCodesByTask, item.taskId, "concurrency_limit");
                continue;
            }
            const concurrencyReasons = concurrencyLimitReasons(item, waveCounts, options);
            if (concurrencyReasons.length > 0) {
                rememberDeferredReasons(deferredReasonCodesByTask, item.taskId, concurrencyReasons);
                continue;
            }
            const locks = item.resourceLocks ?? [];
            const acquired = waveLocks.acquire(item.taskId, locks);
            if (!acquired.ok) {
                rememberDeferredReason(deferredReasonCodesByTask, item.taskId, "resource_lock");
                continue;
            }
            reserveConcurrency(item, waveCounts);
            waveItems.push(item);
        }
        if (waveItems.length === 0) {
            const fallback = [...pending]
                .map((taskId) => byTaskId.get(taskId))
                .find((item) => Boolean(item));
            if (!fallback)
                break;
            waveItems.push(fallback);
        }
        const reasonCodes = waveItems.length > 1 ? ["parallel_sub_sessions"] : ["sequential_or_blocked_sub_session"];
        const waitReasonCodesByTask = {};
        for (const item of waveItems) {
            const waitReasonCodes = deferredReasonCodesByTask.get(item.taskId);
            if (waitReasonCodes && waitReasonCodes.size > 0) {
                waitReasonCodesByTask[item.taskId] = [...waitReasonCodes];
            }
        }
        waves.push({
            waveIndex: waves.length,
            items: waveItems,
            reasonCodes,
            ...(Object.keys(waitReasonCodesByTask).length > 0 ? { waitReasonCodesByTask } : {}),
        });
        for (const item of waveItems) {
            pending.delete(item.taskId);
            completed.add(item.taskId);
            deferredReasonCodesByTask.delete(item.taskId);
        }
    }
    return waves;
}
function rememberDeferredReason(map, taskId, reasonCode) {
    rememberDeferredReasons(map, taskId, [reasonCode]);
}
function rememberDeferredReasons(map, taskId, reasonCodes) {
    const existing = map.get(taskId) ?? new Set();
    for (const reasonCode of reasonCodes)
        existing.add(reasonCode);
    map.set(taskId, existing);
}
export function planOrchestrationExecutionWaves(plan, items, options = {}) {
    const matchingGroup = plan.parallelGroups.find((group) => items.some((item) => group.subSessionIds.includes(item.subSessionId)));
    const dependencyEdges = [...plan.dependencyEdges, ...(matchingGroup?.dependencyEdges ?? [])];
    return planSubSessionExecutionWaves(items, {
        dependencyEdges,
        concurrencyLimit: matchingGroup?.concurrencyLimit ?? items.length,
    }, options);
}
function buildDeferredWaveSummary(groupId, waves) {
    const waitingEntries = [];
    for (const wave of waves) {
        for (const item of wave.items) {
            const waitReasonCodes = wave.waitReasonCodesByTask?.[item.taskId];
            if (!waitReasonCodes || waitReasonCodes.length === 0)
                continue;
            waitingEntries.push(`${item.taskId}(${waitReasonCodes.join("+")})`);
        }
    }
    if (waitingEntries.length === 0)
        return null;
    return `sub_session_waiting:${groupId}:${waitingEntries.join(", ")}`;
}
function buildNamedHandoffLabel(input, subSession) {
    const sender = subSession.parentAgentNickname ??
        input.parentAgent?.displayName ??
        subSession.parentAgentId ??
        "parent";
    const recipient = subSession.agentNickname ?? subSession.agentDisplayName ?? subSession.agentId;
    return `sub_session_handoff:${subSession.subSessionId}:${sender}->${recipient}:${input.command.commandRequestId}`;
}
function numericEstimate(value) {
    return Number.isFinite(value) && value !== undefined && value > 0 ? value : 0;
}
function positiveBudgetValue(value) {
    if (value === undefined || !Number.isFinite(value) || value < 0)
        return undefined;
    return value;
}
function budgetExceededReason(item, totals, budget) {
    if (!budget)
        return undefined;
    const maxChildren = normalizedPositiveLimit(budget.maxChildren);
    if (maxChildren !== undefined && totals.childCount >= maxChildren) {
        return "max_child_budget_exceeded";
    }
    const maxCost = positiveBudgetValue(budget.maxEstimatedCost);
    if (maxCost !== undefined &&
        totals.estimatedCost + numericEstimate(item.estimatedCost) > maxCost) {
        return "cost_budget_exceeded";
    }
    const maxDuration = positiveBudgetValue(budget.maxEstimatedDurationMs);
    if (maxDuration !== undefined &&
        totals.estimatedDurationMs + numericEstimate(item.estimatedDurationMs) > maxDuration) {
        return "time_budget_exceeded";
    }
    return undefined;
}
export function applyParallelSubSessionBudget(items, budget) {
    const selected = [];
    const skipped = [];
    const totals = {
        childCount: 0,
        estimatedCost: 0,
        estimatedDurationMs: 0,
    };
    for (const item of items) {
        const reasonCode = budgetExceededReason(item, totals, budget);
        if (reasonCode) {
            skipped.push({ taskId: item.taskId, subSessionId: item.subSessionId, reasonCode });
            continue;
        }
        selected.push(item);
        totals.childCount += 1;
        totals.estimatedCost += numericEstimate(item.estimatedCost);
        totals.estimatedDurationMs += numericEstimate(item.estimatedDurationMs);
    }
    const reasonCodes = [...new Set(skipped.map((item) => item.reasonCode))];
    const status = skipped.length === 0 ? "ok" : selected.length > 0 ? "shrunk" : "blocked";
    return {
        items: selected,
        decision: {
            status,
            reasonCodes,
            selectedTaskIds: selected.map((item) => item.taskId),
            skipped,
            totals,
        },
    };
}
export class SubSessionRunner {
    now;
    idProvider;
    dependencies;
    customReviewResultReport;
    progressAggregator;
    recordLedgerEvent;
    activeControllers = new Map();
    firstProgressRecorded = new Set();
    constructor(dependencies = {}) {
        this.now = dependencies.now ?? (() => Date.now());
        this.idProvider = dependencies.idProvider ?? defaultIdProvider;
        this.dependencies = {
            now: this.now,
            idProvider: this.idProvider,
            loadSubSessionByIdempotencyKey: dependencies.loadSubSessionByIdempotencyKey ?? defaultLoadSubSessionByIdempotencyKey,
            persistSubSession: dependencies.persistSubSession ?? defaultPersistSubSession,
            updateSubSession: dependencies.updateSubSession ?? defaultUpdateSubSession,
            appendParentEvent: dependencies.appendParentEvent ?? defaultAppendParentEvent,
            isParentCancelled: dependencies.isParentCancelled ?? defaultIsParentCancelled,
            isParentFinalized: dependencies.isParentFinalized ?? defaultIsParentFinalized,
            progressAggregator: dependencies.progressAggregator ?? createSubSessionProgressAggregator({ now: this.now }),
            recordLedgerEvent: dependencies.recordLedgerEvent ?? recordMessageLedgerEvent,
            recordReviewEvent: dependencies.recordReviewEvent ?? defaultRecordSubSessionReviewEvent,
        };
        this.customReviewResultReport = dependencies.reviewResultReport;
        this.progressAggregator = this.dependencies.progressAggregator;
        this.recordLedgerEvent = this.dependencies.recordLedgerEvent;
    }
    async runSubSession(input, handler) {
        const namedInput = withEffectiveNicknameSnapshots(input);
        const modelPolicy = resolveModelExecutionPolicy({
            agentId: namedInput.agent.agentId,
            promptBundle: namedInput.promptBundle,
            ...(namedInput.providerModelMatrix ? { providerMatrix: namedInput.providerModelMatrix } : {}),
            ...(namedInput.modelAvailabilityDoctor ? { doctor: namedInput.modelAvailabilityDoctor } : {}),
            estimatedInputTokens: estimateTokenCount(namedInput.promptBundle.renderedPrompt ?? namedInput.promptBundle.promptChecksum),
        });
        const effectiveInput = {
            ...namedInput,
            ...(modelPolicy.snapshot ? { modelExecutionPolicy: modelPolicy.snapshot } : {}),
        };
        const queuedAt = this.now();
        const subSession = buildSubSessionContract(effectiveInput);
        if (modelPolicy.status === "blocked") {
            subSession.status = "failed";
            const errorReport = buildErrorReport({
                idProvider: this.idProvider,
                command: effectiveInput.command,
                reasonCode: modelPolicy.reasonCode,
                safeMessage: modelPolicy.userMessage,
                retryable: false,
            });
            await this.dependencies.appendParentEvent(subSession.parentRunId, `sub_session_model_blocked:${subSession.subSessionId}:${modelPolicy.reasonCode}`);
            this.recordSubSessionLifecycleEvent(subSession, "sub_session_failed", "failed", modelPolicy.userMessage, { reasonCode: modelPolicy.reasonCode, modelDiagnostics: modelPolicy.diagnostics });
            return { subSession, status: "failed", errorReport, replayed: false };
        }
        const preflightIssueCodes = promptBundlePreflightIssueCodes(effectiveInput);
        if (preflightIssueCodes.length > 0) {
            subSession.status = "failed";
            const errorReport = buildErrorReport({
                idProvider: this.idProvider,
                command: effectiveInput.command,
                reasonCode: "prompt_bundle_preflight_failed",
                safeMessage: `Prompt bundle preflight failed: ${preflightIssueCodes.join(", ")}`,
                retryable: false,
            });
            await this.dependencies.appendParentEvent(subSession.parentRunId, `sub_session_blocked_by_prompt_preflight:${subSession.subSessionId}:${preflightIssueCodes.join("+")}`);
            return { subSession, status: "failed", errorReport, replayed: false };
        }
        const existing = await this.dependencies.loadSubSessionByIdempotencyKey(subSession.identity.idempotencyKey);
        if (existing && isReplayableStatus(existing.status)) {
            await this.dependencies.appendParentEvent(existing.parentRunId, `sub_session_replay:${existing.subSessionId}:${existing.status}`);
            return { subSession: existing, status: existing.status, replayed: true };
        }
        const inserted = await this.dependencies.persistSubSession(subSession);
        if (!inserted) {
            const replayed = await this.dependencies.loadSubSessionByIdempotencyKey(subSession.identity.idempotencyKey);
            if (replayed) {
                await this.dependencies.appendParentEvent(replayed.parentRunId, `sub_session_replay:${replayed.subSessionId}:${replayed.status}`);
                return { subSession: replayed, status: replayed.status, replayed: true };
            }
        }
        await this.dependencies.appendParentEvent(subSession.parentRunId, `sub_session_created:${subSession.subSessionId}`);
        await this.dependencies.appendParentEvent(subSession.parentRunId, buildNamedHandoffLabel(effectiveInput, subSession));
        this.recordSubSessionLifecycleEvent(subSession, "sub_session_created", "started", "서브 세션을 생성했습니다.");
        await this.changeStatus(subSession, "queued");
        await this.dependencies.appendParentEvent(subSession.parentRunId, `sub_session_queued:${subSession.subSessionId}`);
        if (modelPolicy.snapshot) {
            await this.dependencies.appendParentEvent(subSession.parentRunId, `sub_session_model_resolved:${subSession.subSessionId}:${modelPolicy.snapshot.providerId}:${modelPolicy.snapshot.modelId}:${modelPolicy.reasonCode}`);
        }
        if (effectiveInput.parentAbortSignal?.aborted ||
            (await this.dependencies.isParentCancelled(subSession.parentRunId))) {
            return this.cancelBeforeStart(effectiveInput, subSession);
        }
        const controller = new AbortController();
        const parentAbortHandler = () => controller.abort();
        effectiveInput.parentAbortSignal?.addEventListener("abort", parentAbortHandler, { once: true });
        this.activeControllers.set(subSession.subSessionId, {
            parentRunId: subSession.parentRunId,
            controller,
        });
        let timeout;
        let lastModelExecution;
        try {
            recordLatencyMetric({
                name: "sub_session_queue_wait_ms",
                durationMs: Math.max(0, this.now() - queuedAt),
                runId: subSession.parentRunId,
                sessionId: subSession.parentSessionId,
                detail: {
                    subSessionId: subSession.subSessionId,
                    agentId: subSession.agentId,
                },
            });
            await this.changeStatus(subSession, "running");
            await this.dependencies.appendParentEvent(subSession.parentRunId, `sub_session_started:${subSession.subSessionId}`);
            const execution = await this.executeWithModelPolicy({
                input: effectiveInput,
                subSession,
                handler,
                modelPolicy,
                rootController: controller,
                setTimer: (timer) => {
                    timeout = timer;
                },
            });
            const result = execution.result;
            const modelExecution = execution.audit;
            lastModelExecution = modelExecution;
            subSession.modelExecutionSnapshot = modelExecution;
            if (controller.signal.aborted) {
                const outcome = await this.markCancelled(effectiveInput, subSession, "sub_session_cancelled");
                return outcome;
            }
            if (await this.dependencies.isParentFinalized(subSession.parentRunId)) {
                await this.changeStatus(subSession, "completed");
                await this.flushProgressBatch(subSession.parentRunId, "terminal_flush");
                await this.dependencies.appendParentEvent(subSession.parentRunId, `sub_session_late_result_suppressed:${subSession.subSessionId}:parent_finalized`);
                this.recordSubSessionLifecycleEvent(subSession, "sub_session_result_suppressed", "suppressed", "Parent finalizer was already committed; late sub-session result was not integrated.", { resultReportId: result.resultReportId, reasonCode: "parent_finalized" });
                return {
                    subSession,
                    status: subSession.status,
                    integrationSuppressed: true,
                    suppressionReasonCode: "parent_finalized",
                    modelExecution,
                    replayed: false,
                };
            }
            const finalizationStartedAt = this.now();
            const review = await this.reviewResultReport(effectiveInput, result, subSession);
            const terminalStatus = review.status;
            if (terminalStatus === "failed") {
                subSession.retryBudgetRemaining = Math.max(0, subSession.retryBudgetRemaining - 1);
            }
            else if (terminalStatus === "needs_revision") {
                subSession.retryBudgetRemaining = Math.max(0, review.feedbackRequest?.retryBudgetRemaining ?? subSession.retryBudgetRemaining - 1);
            }
            await this.changeStatus(subSession, terminalStatus);
            await this.flushProgressBatch(subSession.parentRunId, "terminal_flush");
            recordLatencyMetric({
                name: "finalization_latency_ms",
                durationMs: Math.max(0, this.now() - finalizationStartedAt),
                runId: subSession.parentRunId,
                sessionId: subSession.parentSessionId,
                detail: {
                    subSessionId: subSession.subSessionId,
                    reviewStatus: review.status,
                },
            });
            await this.dependencies.appendParentEvent(subSession.parentRunId, `sub_session_review_verdict:${subSession.subSessionId}:${review.verdict}:${review.parentIntegrationStatus}`);
            try {
                this.dependencies.recordReviewEvent({
                    parentRunId: subSession.parentRunId,
                    subSessionId: subSession.subSessionId,
                    resultReportId: result.resultReportId,
                    status: review.status,
                    verdict: review.verdict,
                    parentIntegrationStatus: review.parentIntegrationStatus,
                    accepted: review.accepted,
                    issues: review.issues,
                    ...(review.normalizedFailureKey
                        ? { normalizedFailureKey: review.normalizedFailureKey }
                        : {}),
                    risksOrGaps: review.risksOrGaps,
                    ...(review.impossibleReason ? { impossibleReason: review.impossibleReason } : {}),
                });
            }
            catch {
                // Review audit hooks are diagnostic only; parent lifecycle must still finish.
            }
            await this.dependencies.appendParentEvent(subSession.parentRunId, `sub_session_result:${subSession.subSessionId}:${terminalStatus}`);
            this.recordSubSessionLifecycleEvent(subSession, terminalStatus === "failed" ? "sub_session_failed" : "sub_session_completed", terminalStatus === "failed" ? "failed" : "succeeded", `서브 세션 결과를 parent review로 회수했습니다: ${terminalStatus}`, { resultReportId: result.resultReportId, reviewStatus: review.status, modelExecution });
            this.recordSubSessionLifecycleEvent(subSession, "sub_session_result_suppressed", "suppressed", "서브 세션 결과 직접 전달을 차단하고 parent final answer 합성 대상으로 보관했습니다.", { resultReportId: result.resultReportId, reviewStatus: review.status });
            await this.dependencies.appendParentEvent(subSession.parentRunId, `sub_session_result_suppressed:${subSession.subSessionId}:${result.resultReportId}`);
            if (review.feedbackRequest) {
                await this.dependencies.appendParentEvent(subSession.parentRunId, `sub_session_feedback_requested:${subSession.subSessionId}:${review.normalizedFailureKey ?? "unknown"}`);
            }
            return {
                subSession,
                status: subSession.status,
                resultReport: result,
                review,
                modelExecution,
                ...(review.feedbackRequest ? { feedbackRequest: review.feedbackRequest } : {}),
                replayed: false,
            };
        }
        catch (error) {
            if (!(error instanceof SubSessionTimeoutError) &&
                (controller.signal.aborted || isAbortLike(error))) {
                return this.markCancelled(effectiveInput, subSession, "sub_session_cancelled");
            }
            subSession.retryBudgetRemaining = Math.max(0, subSession.retryBudgetRemaining - 1);
            const errorReport = buildErrorReport({
                idProvider: this.idProvider,
                command: effectiveInput.command,
                reasonCode: error instanceof SubSessionTimeoutError
                    ? "sub_session_timeout"
                    : "sub_session_handler_error",
                safeMessage: asErrorMessage(error),
                retryable: subSession.retryBudgetRemaining > 0,
            });
            const failedModelExecution = lastModelExecution ??
                (subSession.modelExecutionSnapshot && "status" in subSession.modelExecutionSnapshot
                    ? subSession.modelExecutionSnapshot
                    : undefined);
            await this.changeStatus(subSession, "failed");
            await this.flushProgressBatch(subSession.parentRunId, "terminal_flush");
            await this.dependencies.appendParentEvent(subSession.parentRunId, `sub_session_failed:${subSession.subSessionId}:${errorReport.reasonCode}`);
            this.recordSubSessionLifecycleEvent(subSession, "sub_session_failed", "failed", errorReport.safeMessage, {
                reasonCode: errorReport.reasonCode,
                retryable: errorReport.retryable,
                ...(failedModelExecution ? { modelExecution: failedModelExecution } : {}),
            });
            return {
                subSession,
                status: "failed",
                errorReport,
                ...(failedModelExecution ? { modelExecution: failedModelExecution } : {}),
                replayed: false,
            };
        }
        finally {
            if (timeout)
                clearTimeout(timeout);
            effectiveInput.parentAbortSignal?.removeEventListener("abort", parentAbortHandler);
            this.activeControllers.delete(subSession.subSessionId);
        }
    }
    cancelParentRun(parentRunId) {
        return this.abortActiveChildren(parentRunId).length;
    }
    async cascadeStopParentRun(parentRunId) {
        const affectedSubSessionIds = this.abortActiveChildren(parentRunId);
        await this.dependencies.appendParentEvent(parentRunId, `sub_session_cascade_stop:${parentRunId}:${affectedSubSessionIds.length}:${affectedSubSessionIds.join(",")}`);
        return {
            parentRunId,
            affectedSubSessionIds,
            reasonCode: "parent_run_cancelled",
        };
    }
    abortActiveChildren(parentRunId) {
        const affectedSubSessionIds = [];
        for (const [subSessionId, entry] of this.activeControllers.entries()) {
            if (entry.parentRunId !== parentRunId)
                continue;
            entry.controller.abort();
            affectedSubSessionIds.push(subSessionId);
        }
        return affectedSubSessionIds;
    }
    async cancelBeforeStart(input, subSession) {
        const errorReport = buildErrorReport({
            idProvider: this.idProvider,
            command: input.command,
            reasonCode: "parent_run_cancelled",
            safeMessage: "Parent run was cancelled before the sub-session started.",
            retryable: false,
        });
        await this.changeStatus(subSession, "cancelled");
        await this.flushProgressBatch(subSession.parentRunId, "terminal_flush");
        await this.dependencies.appendParentEvent(subSession.parentRunId, `sub_session_cancelled:${subSession.subSessionId}`);
        this.recordSubSessionLifecycleEvent(subSession, "sub_session_failed", "degraded", errorReport.safeMessage, {
            reasonCode: errorReport.reasonCode,
        });
        return { subSession, status: "cancelled", errorReport, replayed: false };
    }
    async markCancelled(input, subSession, reasonCode) {
        const errorReport = buildErrorReport({
            idProvider: this.idProvider,
            command: input.command,
            reasonCode,
            safeMessage: "Sub-session execution was cancelled.",
            retryable: false,
        });
        await this.changeStatus(subSession, "cancelled");
        await this.flushProgressBatch(subSession.parentRunId, "terminal_flush");
        await this.dependencies.appendParentEvent(subSession.parentRunId, `sub_session_cancelled:${subSession.subSessionId}`);
        this.recordSubSessionLifecycleEvent(subSession, "sub_session_failed", "degraded", errorReport.safeMessage, {
            reasonCode,
        });
        return { subSession, status: "cancelled", errorReport, replayed: false };
    }
    async recordSubSessionProgress(subSession, progress) {
        if (!this.firstProgressRecorded.has(subSession.subSessionId)) {
            this.firstProgressRecorded.add(subSession.subSessionId);
            recordLatencyMetric({
                name: "first_progress_latency_ms",
                durationMs: Math.max(0, progress.at - (subSession.startedAt ?? progress.at)),
                runId: subSession.parentRunId,
                sessionId: subSession.parentSessionId,
                detail: {
                    subSessionId: subSession.subSessionId,
                    agentId: subSession.agentId,
                },
            });
        }
        const batch = this.progressAggregator.push({
            parentRunId: subSession.parentRunId,
            subSessionId: subSession.subSessionId,
            agentId: subSession.agentId,
            agentDisplayName: subSession.agentDisplayName,
            ...(subSession.agentNickname ? { agentNickname: subSession.agentNickname } : {}),
            status: progress.status,
            summary: progress.summary,
            at: progress.at,
        });
        if (batch)
            await this.publishProgressBatch(batch);
    }
    async flushProgressBatch(parentRunId, reason) {
        const batch = this.progressAggregator.flush(parentRunId, reason, this.now());
        if (batch)
            await this.publishProgressBatch(batch);
    }
    async publishProgressBatch(batch) {
        await this.dependencies.appendParentEvent(batch.parentRunId, `sub_session_progress_summary:${batch.text}`);
        this.recordLedgerEvent({
            parentRunId: batch.parentRunId,
            eventKind: "sub_session_progress_summarized",
            deliveryKind: "progress",
            status: "delivered",
            summary: batch.text,
            idempotencyKey: `sub-session-progress-summary:${batch.parentRunId}:${batch.windowStartedAt}:${batch.windowClosedAt}`,
            detail: {
                reason: batch.reason,
                windowStartedAt: batch.windowStartedAt,
                windowClosedAt: batch.windowClosedAt,
                windowMs: batch.windowMs,
                items: batch.items.map((item) => ({
                    subSessionId: item.subSessionId,
                    agentId: item.agentId,
                    agentDisplayName: item.agentDisplayName,
                    agentNickname: item.agentNickname ?? null,
                    status: item.status,
                    summary: item.summary,
                    at: item.at,
                })),
            },
        });
    }
    recordSubSessionLifecycleEvent(subSession, eventKind, status, summary, detail = {}) {
        this.recordLedgerEvent({
            parentRunId: subSession.parentRunId,
            subSessionId: subSession.subSessionId,
            agentId: subSession.agentId,
            eventKind,
            deliveryKind: eventKind === "sub_session_result_suppressed" ? "final" : "diagnostic",
            status,
            summary,
            idempotencyKey: `${eventKind}:${subSession.parentRunId}:${subSession.subSessionId}:${subSession.status}`,
            detail: {
                agentDisplayName: subSession.agentDisplayName,
                agentNickname: subSession.agentNickname ?? null,
                agentNicknameSnapshot: subSession.agentNickname ?? null,
                status: subSession.status,
                retryBudgetRemaining: subSession.retryBudgetRemaining,
                ...detail,
            },
        });
    }
    async changeStatus(subSession, status) {
        transitionSubSessionStatus(subSession, status, this.now());
        await this.dependencies.updateSubSession(subSession);
    }
    async reviewResultReport(input, resultReport, subSession) {
        if (this.customReviewResultReport) {
            return this.customReviewResultReport({ input, resultReport, subSession });
        }
        return reviewSubAgentResult({
            resultReport,
            expectedOutputs: input.command.expectedOutputs,
            retryBudgetRemaining: subSession.retryBudgetRemaining,
            retryClass: classifyRetryClass(input),
            additionalContextRefs: input.command.contextPackageIds,
        });
    }
    async executeWithModelPolicy(input) {
        if (!input.modelPolicy.snapshot) {
            throw new Error(input.modelPolicy.userMessage);
        }
        const initialSnapshot = input.modelPolicy.snapshot;
        let policy = { ...input.modelPolicy, snapshot: initialSnapshot };
        let attempts = 0;
        let maxAttempts = Math.max(1, initialSnapshot.retryCount + 1);
        const startedAt = this.now();
        let lastError;
        while (attempts < maxAttempts) {
            attempts += 1;
            const attemptSnapshot = policy.snapshot;
            if (!attemptSnapshot)
                break;
            const attemptController = new AbortController();
            const abortAttempt = () => attemptController.abort();
            input.rootController.signal.addEventListener("abort", abortAttempt, { once: true });
            if (input.rootController.signal.aborted)
                attemptController.abort();
            try {
                const result = await this.runWithTimeout(() => input.handler({ ...input.input, modelExecutionPolicy: attemptSnapshot }, {
                    signal: attemptController.signal,
                    modelExecution: attemptSnapshot,
                    emitProgress: async (summary, status = input.subSession.status) => {
                        if (status !== input.subSession.status) {
                            await this.changeStatus(input.subSession, status);
                        }
                        const progress = buildProgressEvent({
                            idProvider: this.idProvider,
                            now: this.now(),
                            command: input.input.command,
                            status,
                            summary,
                        });
                        await this.dependencies.appendParentEvent(input.subSession.parentRunId, `sub_session_progress:${input.subSession.subSessionId}:${summary}`);
                        await this.recordSubSessionProgress(input.subSession, progress);
                        return progress;
                    },
                }), attemptController, input.input.timeoutMs ?? attemptSnapshot.timeoutMs, input.setTimer);
                const latencyMs = Math.max(0, this.now() - startedAt);
                const audit = buildModelExecutionAuditSummary({
                    snapshot: attemptSnapshot,
                    status: "completed",
                    attemptCount: attempts,
                    latencyMs,
                    outputText: JSON.stringify(result.outputs),
                });
                recordLatencyMetric({
                    name: "model_execution_latency_ms",
                    durationMs: latencyMs,
                    runId: input.subSession.parentRunId,
                    sessionId: input.subSession.parentSessionId,
                    detail: {
                        subSessionId: input.subSession.subSessionId,
                        agentId: input.subSession.agentId,
                        providerId: audit.providerId,
                        modelId: audit.modelId,
                        fallbackApplied: audit.fallbackApplied,
                        attemptCount: attempts,
                        estimatedCost: audit.estimatedCost,
                        tokenUsage: audit.tokenUsage,
                    },
                });
                this.recordSubSessionLifecycleEvent(input.subSession, "sub_session_completed", "succeeded", `model_execution_completed:${audit.providerId}:${audit.modelId}`, { modelExecution: audit });
                return { result, audit };
            }
            catch (error) {
                lastError = error;
                input.rootController.signal.removeEventListener("abort", abortAttempt);
                if (input.rootController.signal.aborted || isAbortLike(error))
                    throw error;
                if (error instanceof SubSessionTimeoutError) {
                    const fallback = resolveFallbackModelExecutionPolicy({
                        current: policy,
                        reasonCode: "sub_session_timeout",
                        promptBundle: input.input.promptBundle,
                        ...(input.input.providerModelMatrix
                            ? { providerMatrix: input.input.providerModelMatrix }
                            : {}),
                        ...(input.input.modelAvailabilityDoctor
                            ? { doctor: input.input.modelAvailabilityDoctor }
                            : {}),
                    });
                    if (fallback.snapshot && fallback.snapshot !== policy.snapshot) {
                        policy = fallback;
                        maxAttempts += 1;
                        await this.dependencies.appendParentEvent(input.subSession.parentRunId, `sub_session_model_fallback:${input.subSession.subSessionId}:${fallback.snapshot.modelId}:sub_session_timeout`);
                        continue;
                    }
                }
                if (attempts < maxAttempts) {
                    await this.dependencies.appendParentEvent(input.subSession.parentRunId, `sub_session_model_retry:${input.subSession.subSessionId}:${attempts}:${error instanceof SubSessionTimeoutError ? "sub_session_timeout" : "sub_session_handler_error"}`);
                }
            }
            finally {
                input.rootController.signal.removeEventListener("abort", abortAttempt);
            }
        }
        const snapshot = policy.snapshot ?? input.modelPolicy.snapshot;
        if (snapshot) {
            const audit = buildModelExecutionAuditSummary({
                snapshot,
                status: "failed",
                attemptCount: attempts,
                latencyMs: Math.max(0, this.now() - startedAt),
            });
            input.subSession.modelExecutionSnapshot = audit;
        }
        throw lastError instanceof Error ? lastError : new Error(String(lastError ?? "model failed"));
    }
    async runWithTimeout(run, controller, timeoutMs, setTimer) {
        if (!timeoutMs || timeoutMs <= 0)
            return run();
        return Promise.race([
            Promise.resolve().then(run),
            new Promise((_resolve, reject) => {
                const timer = setTimeout(() => {
                    controller.abort();
                    reject(new SubSessionTimeoutError());
                }, timeoutMs);
                setTimer(timer);
            }),
        ]);
    }
}
function classifyRetryClass(input) {
    const outputKinds = new Set(input.command.expectedOutputs.map((output) => output.kind));
    if (outputKinds.has("state_change") ||
        outputKinds.has("tool_result") ||
        input.command.contextPackageIds.some((ref) => ref.startsWith("cost:high") || ref.startsWith("external:"))) {
        return "risk_or_external";
    }
    if (input.command.expectedOutputs.every((output) => !output.acceptance.artifactRequired &&
        output.acceptance.requiredEvidenceKinds.length === 0 &&
        output.kind === "text")) {
        return "format_only";
    }
    return "default";
}
export async function runParallelSubSessionGroup(group, items, options = {}) {
    const now = options.now ?? (() => Date.now());
    const budgeted = applyParallelSubSessionBudget(items, options.budget);
    const waves = planSubSessionExecutionWaves(budgeted.items, group, options.concurrency ?? {});
    const outcomes = [];
    const skipped = [...budgeted.decision.skipped];
    const completedTasks = new Set();
    const blockedTasks = new Set();
    const skippedTaskIds = new Set(skipped.map((item) => item.taskId));
    const groupStartedAt = now();
    const appendParentEvent = options.appendParentEvent ?? appendRunEvent;
    if (options.runId) {
        const waitSummary = buildDeferredWaveSummary(group.groupId, waves);
        if (waitSummary)
            await appendParentEvent(options.runId, waitSummary);
        if (budgeted.decision.status !== "ok") {
            await appendParentEvent(options.runId, `sub_session_budget_${budgeted.decision.status}:${group.groupId}:${budgeted.decision.reasonCodes.join("+")}`);
        }
    }
    if (budgeted.items.length === 0) {
        return {
            groupId: group.groupId,
            status: "blocked",
            waves: [],
            outcomes,
            skipped,
            budget: budgeted.decision,
        };
    }
    for (const wave of waves) {
        if (await isParallelGroupCancelled(options)) {
            await skipRemainingWaveItems({
                groupId: group.groupId,
                ...(options.runId ? { runId: options.runId } : {}),
                appendParentEvent,
                waves,
                completedTasks,
                blockedTasks,
                skippedTaskIds,
                skipped,
                reasonCode: "parent_run_cancelled",
            });
            break;
        }
        const waveStartedAt = now();
        const dependencyReady = wave.items.filter((item) => {
            if (skippedTaskIds.has(item.taskId))
                return false;
            const dependencies = new Set(item.dependencies ?? []);
            for (const edge of group.dependencyEdges ?? []) {
                if (edge.toTaskId === item.taskId)
                    dependencies.add(edge.fromTaskId);
            }
            const blocked = [...dependencies].some((dep) => blockedTasks.has(dep) || !completedTasks.has(dep));
            if (blocked) {
                skipped.push({
                    taskId: item.taskId,
                    subSessionId: item.subSessionId,
                    reasonCode: "dependency_not_completed",
                });
                blockedTasks.add(item.taskId);
            }
            return !blocked;
        });
        const runnable = [];
        for (const item of dependencyReady) {
            const waitReasonCodes = wave.waitReasonCodesByTask?.[item.taskId] ?? [];
            if (waitReasonCodes.includes("resource_lock")) {
                const waitMs = Math.max(0, waveStartedAt - groupStartedAt);
                recordLatencyMetric({
                    name: "resource_lock_wait_ms",
                    durationMs: waitMs,
                    timeout: options.resourceLockWaitTimeoutMs !== undefined &&
                        waitMs > options.resourceLockWaitTimeoutMs,
                    ...(options.runId ? { runId: options.runId } : {}),
                    ...(options.sessionId ? { sessionId: options.sessionId } : {}),
                    ...(options.requestGroupId ? { requestGroupId: options.requestGroupId } : {}),
                    ...(options.source ? { source: options.source } : {}),
                    detail: {
                        groupId: group.groupId,
                        taskId: item.taskId,
                        subSessionId: item.subSessionId,
                        waveIndex: wave.waveIndex,
                        waitReasonCodes,
                        resourceLockWaitMs: waitMs,
                        resourceLocks: formatResourceLockSummary(item.resourceLocks ?? []),
                    },
                });
                if (options.runId) {
                    await appendParentEvent(options.runId, `sub_session_lock_wait:${group.groupId}:${item.taskId}:${waitMs}ms:${waitReasonCodes.join("+")}`);
                }
                if (options.resourceLockWaitTimeoutMs !== undefined &&
                    waitMs > options.resourceLockWaitTimeoutMs) {
                    skipped.push({
                        taskId: item.taskId,
                        subSessionId: item.subSessionId,
                        reasonCode: "resource_lock_timeout",
                    });
                    skippedTaskIds.add(item.taskId);
                    blockedTasks.add(item.taskId);
                    if (options.runId) {
                        await appendParentEvent(options.runId, `sub_session_lock_timeout:${group.groupId}:${item.taskId}:${waitMs}ms`);
                    }
                    continue;
                }
            }
            runnable.push(item);
        }
        for (const item of runnable) {
            if ((item.resourceLocks ?? []).length === 0 || !options.runId)
                continue;
            await appendParentEvent(options.runId, `sub_session_lock_acquired:${group.groupId}:${item.taskId}:${formatResourceLockSummary(item.resourceLocks ?? [])}`);
        }
        const settled = await Promise.allSettled(runnable.map((item) => item.run()));
        for (const [index, result] of settled.entries()) {
            const item = runnable[index];
            if (!item)
                continue;
            if (result.status === "fulfilled") {
                outcomes.push(result.value);
                if (result.value.status === "completed")
                    completedTasks.add(item.taskId);
                else
                    blockedTasks.add(item.taskId);
            }
            else {
                blockedTasks.add(item.taskId);
            }
        }
        for (const item of runnable) {
            if ((item.resourceLocks ?? []).length === 0 || !options.runId)
                continue;
            await appendParentEvent(options.runId, `sub_session_lock_released:${group.groupId}:${item.taskId}:${formatResourceLockSummary(item.resourceLocks ?? [])}`);
        }
    }
    const status = resolveParallelGroupStatus(outcomes, skipped, budgeted.decision);
    return {
        groupId: group.groupId,
        status,
        waves: waves.map((wave) => ({
            waveIndex: wave.waveIndex,
            taskIds: wave.items.map((item) => item.taskId),
            subSessionIds: wave.items.map((item) => item.subSessionId),
            reasonCodes: wave.reasonCodes,
        })),
        outcomes,
        skipped,
        budget: budgeted.decision,
    };
}
async function isParallelGroupCancelled(options) {
    if (options.parentAbortSignal?.aborted)
        return true;
    if (!options.runId || !options.isParentCancelled)
        return false;
    return Boolean(await options.isParentCancelled(options.runId));
}
async function skipRemainingWaveItems(input) {
    for (const wave of input.waves) {
        for (const item of wave.items) {
            if (input.completedTasks.has(item.taskId) ||
                input.blockedTasks.has(item.taskId) ||
                input.skippedTaskIds.has(item.taskId)) {
                continue;
            }
            input.skipped.push({
                taskId: item.taskId,
                subSessionId: item.subSessionId,
                reasonCode: input.reasonCode,
            });
            input.skippedTaskIds.add(item.taskId);
            input.blockedTasks.add(item.taskId);
        }
    }
    if (input.runId) {
        await input.appendParentEvent(input.runId, `sub_session_group_cancelled:${input.groupId}:${input.reasonCode}`);
    }
}
function formatResourceLockSummary(locks) {
    return locks.map((lock) => `${lock.kind}:${lock.target}:${lock.mode}`).join("|");
}
function isBlockingSkip(reasonCode) {
    return [
        "max_child_budget_exceeded",
        "cost_budget_exceeded",
        "time_budget_exceeded",
        "resource_lock_timeout",
        "parent_run_cancelled",
    ].includes(reasonCode);
}
function resolveParallelGroupStatus(outcomes, skipped, budget) {
    if (budget.status === "blocked")
        return "blocked";
    if (outcomes.some((outcome) => outcome.status !== "completed"))
        return "failed";
    if (skipped.some((item) => isBlockingSkip(item.reasonCode)))
        return "blocked";
    return skipped.length > 0 ? "failed" : "completed";
}
export function classifySubSessionRecovery(subSession) {
    if (!ACTIVE_RECOVERY_STATUSES.has(subSession.status)) {
        return {
            subSessionId: subSession.subSessionId,
            previousStatus: subSession.status,
            nextStatus: subSession.status,
            action: "unchanged",
            reasonCode: "sub_session_status_not_active_on_restart",
        };
    }
    return {
        subSessionId: subSession.subSessionId,
        previousStatus: subSession.status,
        nextStatus: "failed",
        action: "mark_failed",
        reasonCode: "sub_session_recovery_degraded",
    };
}
export async function recoverInterruptedSubSessions(input) {
    const now = input.now ?? (() => Date.now());
    const decisions = [];
    const updatedSubSessions = [];
    for (const subSession of input.subSessions) {
        const decision = classifySubSessionRecovery(subSession);
        decisions.push(decision);
        if (decision.action !== "mark_failed")
            continue;
        const updated = {
            ...subSession,
            status: decision.nextStatus,
            finishedAt: now(),
        };
        await input.updateSubSession(updated);
        await input.appendParentEvent?.(updated.parentRunId, `sub_session_recovered_degraded:${updated.subSessionId}`);
        updatedSubSessions.push(updated);
    }
    return { decisions, updatedSubSessions };
}
export function createSubSessionRunner(dependencies = {}) {
    return new SubSessionRunner(dependencies);
}
function defaultRecordSubSessionReviewEvent(input) {
    return recordControlEvent({
        eventType: "sub_session_review_verdict",
        runId: input.parentRunId,
        component: "subsession.review",
        severity: input.accepted ? "info" : "warning",
        summary: `Sub-session review verdict: ${input.verdict}`,
        detail: {
            subSessionId: input.subSessionId,
            resultReportId: input.resultReportId,
            status: input.status,
            verdict: input.verdict,
            parentIntegrationStatus: input.parentIntegrationStatus,
            accepted: input.accepted,
            normalizedFailureKey: input.normalizedFailureKey ?? null,
            issueCodes: input.issues.map((issue) => issue.code),
            risksOrGaps: input.risksOrGaps,
            impossibleReason: input.impossibleReason ?? null,
        },
    });
}
export function createDryRunSubSessionHandler(input = {}) {
    return async (runInput, controls) => {
        for (const summary of input.progressSummaries ?? []) {
            await controls.emitProgress(summary);
        }
        return createTextResultReport({
            command: runInput.command,
            text: input.text ?? "dry-run result",
            ...(input.status ? { status: input.status } : {}),
            ...(input.risksOrGaps ? { risksOrGaps: input.risksOrGaps } : {}),
            ...(input.impossibleReason ? { impossibleReason: input.impossibleReason } : {}),
        });
    };
}
export function loadSubSessionByIdempotencyKey(idempotencyKey) {
    return defaultLoadSubSessionByIdempotencyKey(idempotencyKey);
}
function defaultLoadSubSessionByIdempotencyKey(idempotencyKey) {
    const row = getRunSubSessionByIdempotencyKey(idempotencyKey);
    return row ? parseStoredSubSession(row.contract_json) : undefined;
}
function defaultPersistSubSession(subSession) {
    return insertRunSubSession(subSession);
}
function defaultUpdateSubSession(subSession) {
    updateRunSubSession(subSession);
}
function defaultAppendParentEvent(parentRunId, label) {
    appendRunEvent(parentRunId, label);
}
function defaultIsParentCancelled(parentRunId) {
    try {
        const run = getRootRun(parentRunId);
        return run?.status === "cancelled" || run?.status === "interrupted";
    }
    catch {
        return false;
    }
}
function defaultIsParentFinalized(parentRunId) {
    try {
        const run = getRootRun(parentRunId);
        return run?.status === "completed";
    }
    catch {
        return false;
    }
}
class SubSessionTimeoutError extends Error {
    constructor() {
        super("sub-session execution timed out");
        this.name = "SubSessionTimeoutError";
    }
}
export function createTextResultReport(input) {
    const idProvider = input.idProvider ?? defaultIdProvider;
    const value = input.text ?? "";
    const source = commandTargetNicknameSnapshot(input.command);
    return {
        identity: {
            ...input.command.identity,
            entityType: "sub_session",
            entityId: input.command.subSessionId,
            idempotencyKey: `sub-session-result:${input.command.subSessionId}:${idProvider()}`,
            parent: {
                ...input.command.identity.parent,
                parentRunId: input.command.parentRunId,
            },
        },
        resultReportId: idProvider(),
        parentRunId: input.command.parentRunId,
        subSessionId: input.command.subSessionId,
        ...(source ? { source } : {}),
        status: input.status ?? "completed",
        outputs: [
            {
                outputId: input.command.expectedOutputs[0]?.outputId ?? "answer",
                status: input.status === "failed" ? "missing" : "satisfied",
                value,
            },
        ],
        evidence: [],
        artifacts: [],
        risksOrGaps: input.risksOrGaps ?? [],
        ...(input.impossibleReason ? { impossibleReason: input.impossibleReason } : {}),
    };
}
//# sourceMappingURL=sub-session-runner.js.map