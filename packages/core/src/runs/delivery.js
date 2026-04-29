import crypto from "node:crypto";
import { homedir } from "node:os";
import { basename } from "node:path";
import { recordArtifactMetadata } from "../artifacts/lifecycle.js";
import { getTaskContinuity, hasArtifactReceipt, insertArtifactReceipt, insertChannelMessageRef, insertDiagnosticEvent, insertMessage, upsertTaskContinuity, } from "../db/index.js";
import { eventBus } from "../events/index.js";
import { sanitizeUserFacingError } from "./error-sanitizer.js";
import { buildArtifactDeliveryKey as buildLedgerArtifactDeliveryKey, buildTextDeliveryKey as buildLedgerTextDeliveryKey, findMessageLedgerEventByIdempotencyKey, messageLedgerEventSucceeded, recordMessageLedgerEvent, } from "./message-ledger.js";
import { enqueueBackpressureTask, recordRetryBudgetAttempt } from "./queue-backpressure.js";
import { getRootRun } from "./store.js";
const defaultAssistantTextDeliveryDependencies = {
    now: () => Date.now(),
    createId: () => crypto.randomUUID(),
    insertMessage,
    emitStart: (payload) => eventBus.emit("agent.start", payload),
    emitStream: (payload) => eventBus.emit("agent.stream", payload),
    emitEnd: (payload) => eventBus.emit("agent.end", payload),
    writeReplyLog: (source, text) => logAssistantReply(source, text),
};
const defaultDeliveryOutboxHooks = {
    now: () => Date.now(),
    sleep: (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
};
let deliveryOutboxHooks = defaultDeliveryOutboxHooks;
const providerSendQueues = new Map();
const providerBackoffUntil = new Map();
export function setDeliveryOutboxTestHooks(hooks) {
    deliveryOutboxHooks = {
        ...defaultDeliveryOutboxHooks,
        ...hooks,
    };
}
export function resetDeliveryOutboxForTest() {
    providerSendQueues.clear();
    providerBackoffUntil.clear();
    deliveryOutboxHooks = defaultDeliveryOutboxHooks;
}
const MAX_COMPLETED_ARTIFACT_DELIVERY_KEYS = 2_000;
const activeArtifactDeliveryLocks = new Map();
const completedArtifactDeliveryKeys = new Map();
export function buildArtifactDeliveryKey(params) {
    return `${params.runId}:${params.channel}:${params.filePath}`;
}
function rememberCompletedArtifactDelivery(key) {
    completedArtifactDeliveryKeys.set(key, Date.now());
    if (completedArtifactDeliveryKeys.size <= MAX_COMPLETED_ARTIFACT_DELIVERY_KEYS)
        return;
    const oldestKey = completedArtifactDeliveryKeys.keys().next().value;
    if (oldestKey)
        completedArtifactDeliveryKeys.delete(oldestKey);
}
export async function deliverArtifactOnce(params) {
    const runId = params.runId?.trim();
    if (!runId)
        return params.task();
    const key = buildArtifactDeliveryKey({
        runId,
        channel: params.channel,
        filePath: params.filePath,
    });
    if (!params.force && completedArtifactDeliveryKeys.has(key))
        return undefined;
    const run = getRootRun(runId);
    if (!params.force &&
        run &&
        hasArtifactReceipt({ runId, channel: params.channel, artifactPath: params.filePath })) {
        rememberCompletedArtifactDelivery(key);
        return undefined;
    }
    if (!params.force && run) {
        const continuity = getTaskContinuity(run.requestGroupId);
        const deliveryReceipts = [
            `${params.channel}:${params.filePath}`,
            `${params.channel}:${displayHomePath(params.filePath)}`,
        ];
        if (continuity?.lastDeliveryReceipt &&
            deliveryReceipts.includes(continuity.lastDeliveryReceipt)) {
            rememberCompletedArtifactDelivery(key);
            return undefined;
        }
    }
    const active = activeArtifactDeliveryLocks.get(key);
    if (active) {
        await active.catch(() => undefined);
        return undefined;
    }
    const delivery = params
        .task()
        .then((result) => {
        if (result !== undefined) {
            rememberCompletedArtifactDelivery(key);
            if (run) {
                try {
                    recordArtifactMetadata({
                        sourceRunId: runId,
                        requestGroupId: run.requestGroupId,
                        ownerChannel: params.channel,
                        artifactPath: params.filePath,
                        retentionPolicy: params.retentionPolicy ?? "standard",
                        metadata: {
                            dedupeKey: key,
                            ...(params.force ? { resend: true } : {}),
                            ...(params.forceReason ? { forceReason: params.forceReason } : {}),
                        },
                        ...(params.channelTarget ? { channelTarget: params.channelTarget } : {}),
                        ...(params.mimeType ? { mimeType: params.mimeType } : {}),
                        ...(params.sizeBytes !== undefined ? { sizeBytes: params.sizeBytes } : {}),
                    });
                    insertArtifactReceipt({
                        runId,
                        requestGroupId: run.requestGroupId,
                        channel: params.channel,
                        artifactPath: params.filePath,
                        deliveredAt: Date.now(),
                        deliveryReceipt: {
                            dedupeKey: key,
                            ...(params.channelTarget ? { channelTarget: params.channelTarget } : {}),
                            ...(params.force ? { resend: true } : {}),
                            ...(params.forceReason ? { forceReason: params.forceReason } : {}),
                        },
                        ...(params.mimeType ? { mimeType: params.mimeType } : {}),
                        ...(params.sizeBytes !== undefined ? { sizeBytes: params.sizeBytes } : {}),
                    });
                    if (params.force) {
                        insertDiagnosticEvent({
                            runId,
                            requestGroupId: run.requestGroupId,
                            kind: "artifact_resend",
                            summary: `artifact resent to ${params.channel}`,
                            detail: {
                                artifactPath: params.filePath,
                                channel: params.channel,
                                ...(params.channelTarget ? { channelTarget: params.channelTarget } : {}),
                                ...(params.forceReason ? { forceReason: params.forceReason } : {}),
                            },
                        });
                    }
                }
                catch {
                    // Delivery already succeeded; persistence is best-effort for restart dedupe.
                }
            }
            recordMessageLedgerEvent({
                runId,
                requestGroupId: run?.requestGroupId ?? runId,
                channel: params.channel,
                eventKind: "artifact_delivered",
                deliveryKey: buildLedgerArtifactDeliveryKey(params.channel, params.channelTarget, params.filePath),
                idempotencyKey: `artifact-delivered:${key}`,
                status: "delivered",
                summary: `${params.channel} artifact delivered: ${displayHomePath(params.filePath)}`,
                detail: {
                    filePath: displayHomePath(params.filePath),
                    channel: params.channel,
                    ...(params.channelTarget ? { channelTarget: params.channelTarget } : {}),
                    ...(params.mimeType ? { mimeType: params.mimeType } : {}),
                    ...(params.sizeBytes !== undefined ? { sizeBytes: params.sizeBytes } : {}),
                    ...(params.force ? { resend: true } : {}),
                },
            });
        }
        return result;
    })
        .catch((error) => {
        recordMessageLedgerEvent({
            runId,
            requestGroupId: run?.requestGroupId ?? runId,
            channel: params.channel,
            eventKind: "artifact_delivery_failed",
            deliveryKey: buildLedgerArtifactDeliveryKey(params.channel, params.channelTarget, params.filePath),
            idempotencyKey: `artifact-failed:${key}:${Date.now()}`,
            status: "failed",
            summary: `${params.channel} artifact delivery failed: ${displayHomePath(params.filePath)}`,
            detail: {
                filePath: displayHomePath(params.filePath),
                channel: params.channel,
                error: error instanceof Error ? error.message : String(error),
            },
        });
        throw error;
    })
        .finally(() => {
        if (activeArtifactDeliveryLocks.get(key) === delivery) {
            activeArtifactDeliveryLocks.delete(key);
        }
    });
    activeArtifactDeliveryLocks.set(key, delivery);
    return delivery;
}
export function resetArtifactDeliveryDedupeForTest() {
    activeArtifactDeliveryLocks.clear();
    completedArtifactDeliveryKeys.clear();
}
export function displayHomePath(value) {
    const home = homedir();
    return value.startsWith(home) ? value.replace(home, "~") : value;
}
function rememberDeliveryContinuity(runId, receipt) {
    try {
        const run = getRootRun(runId);
        if (!run)
            return;
        const lineageRootRunId = run?.lineageRootRunId ?? run?.requestGroupId ?? runId;
        upsertTaskContinuity({
            lineageRootRunId,
            ...(run?.parentRunId ? { parentRunId: run.parentRunId } : {}),
            ...(run?.handoffSummary ? { handoffSummary: run.handoffSummary } : {}),
            ...(receipt.lastToolReceipt ? { lastToolReceipt: receipt.lastToolReceipt } : {}),
            ...(receipt.lastDeliveryReceipt ? { lastDeliveryReceipt: receipt.lastDeliveryReceipt } : {}),
            ...(receipt.pendingDelivery ? { pendingDelivery: receipt.pendingDelivery } : {}),
            ...(receipt.status ? { status: receipt.status } : {}),
        });
    }
    catch {
        // Continuity telemetry is best-effort and must not affect delivery.
    }
}
export function buildSuccessfulDeliverySummary(deliveries) {
    if (deliveries.length === 0)
        return "파일 전달 완료";
    const last = deliveries[deliveries.length - 1];
    if (!last)
        return "파일 전달 완료";
    const channelLabel = last.channel === "telegram"
        ? "텔레그램"
        : last.channel === "webui"
            ? "WebUI"
            : last.channel === "slack"
                ? "Slack"
                : "채널";
    return `${channelLabel} 파일 전달 완료: ${describeArtifactForUser(last)}`;
}
export function describeArtifactForUser(delivery) {
    return delivery.url?.trim() || basename(delivery.filePath);
}
export async function resendArtifact(params) {
    return deliverArtifactOnce({
        ...params,
        force: true,
        forceReason: params.forceReason ?? "explicit_resend",
    });
}
export function resolveDeliveryOutcome(params) {
    const hasSuccessfulArtifactDelivery = params.deliveries.length > 0;
    const hasSuccessfulTextDelivery = (params.textDeliveries?.length ?? 0) > 0;
    const deliverySatisfied = params.wantsDirectArtifactDelivery
        ? hasSuccessfulArtifactDelivery
        : hasSuccessfulTextDelivery;
    const deliverySummary = hasSuccessfulArtifactDelivery
        ? buildSuccessfulDeliverySummary(params.deliveries)
        : undefined;
    return {
        mode: params.wantsDirectArtifactDelivery ? "direct_artifact" : "reply",
        directArtifactDeliveryRequested: params.wantsDirectArtifactDelivery,
        hasSuccessfulArtifactDelivery,
        hasSuccessfulTextDelivery,
        textDeliverySatisfied: hasSuccessfulTextDelivery,
        deliverySatisfied,
        ...(deliverySummary ? { deliverySummary } : {}),
        requiresDirectArtifactRecovery: params.wantsDirectArtifactDelivery && !hasSuccessfulArtifactDelivery,
    };
}
export async function emitAssistantTextDelivery(params) {
    const dependencies = {
        ...defaultAssistantTextDeliveryDependencies,
        ...params.dependencies,
    };
    const normalized = params.text.trim();
    if (!normalized) {
        return {
            persisted: false,
            textDelivered: false,
            doneDelivered: false,
        };
    }
    const deliveryKind = params.deliveryKind ?? "final";
    const deliveryKey = buildLedgerTextDeliveryKey(params.source, params.sessionId, normalized);
    const idempotencyKey = `text-delivery:${params.runId}:${params.source}:${deliveryKey}`;
    if (deliveryKind === "final" && params.subSessionId) {
        recordMessageLedgerEvent({
            runId: params.runId,
            ...(params.parentRunId ? { parentRunId: params.parentRunId } : {}),
            subSessionId: params.subSessionId,
            ...(params.agentId ? { agentId: params.agentId } : {}),
            sessionKey: params.sessionId,
            channel: params.source,
            eventKind: "text_delivery_suppressed",
            deliveryKind,
            deliveryKey,
            idempotencyKey: `${idempotencyKey}:child-direct-blocked`,
            status: "suppressed",
            summary: "child sub-session final delivery was blocked; parent finalizer must deliver.",
            detail: {
                reasonCode: "child_direct_final_delivery_blocked",
                textLength: normalized.length,
                ...(params.speaker ? { speaker: params.speaker } : {}),
                ...(params.sourceAttributions ? { sourceAttributions: params.sourceAttributions } : {}),
            },
        });
        return {
            persisted: false,
            textDelivered: false,
            doneDelivered: false,
        };
    }
    if (!params.force && deliveryKind === "final") {
        const previousDelivery = findMessageLedgerEventByIdempotencyKey(idempotencyKey);
        if (messageLedgerEventSucceeded(previousDelivery)) {
            recordMessageLedgerEvent({
                runId: params.runId,
                ...(params.parentRunId ? { parentRunId: params.parentRunId } : {}),
                ...(params.subSessionId ? { subSessionId: params.subSessionId } : {}),
                ...(params.agentId ? { agentId: params.agentId } : {}),
                sessionKey: params.sessionId,
                channel: params.source,
                eventKind: "text_delivery_suppressed",
                deliveryKind,
                deliveryKey,
                idempotencyKey: `${idempotencyKey}:suppressed:${dependencies.now()}`,
                status: "suppressed",
                summary: "중복 최종 응답 전송을 억제했습니다.",
                detail: {
                    duplicateLedgerEventId: previousDelivery?.id ?? null,
                    duplicateCreatedAt: previousDelivery?.created_at ?? null,
                    textLength: normalized.length,
                    ...(params.speaker ? { speaker: params.speaker } : {}),
                    ...(params.sourceAttributions ? { sourceAttributions: params.sourceAttributions } : {}),
                },
            });
            return {
                persisted: false,
                textDelivered: true,
                doneDelivered: params.emitDone !== false,
            };
        }
    }
    dependencies.emitStart({ sessionId: params.sessionId, runId: params.runId });
    if (params.persistMessage !== false) {
        dependencies.insertMessage({
            id: dependencies.createId(),
            session_id: params.sessionId,
            root_run_id: params.runId,
            role: "assistant",
            content: normalized,
            tool_calls: null,
            tool_call_id: null,
            created_at: dependencies.now(),
        });
    }
    dependencies.writeReplyLog(params.source, normalized);
    dependencies.emitStream({ sessionId: params.sessionId, runId: params.runId, delta: normalized });
    let textDeliveryFailed = false;
    await deliverChunk({
        onChunk: params.onChunk,
        chunk: { type: "text", delta: normalized },
        runId: params.runId,
        source: params.source,
        deliveryKind,
        targetKey: params.sessionId,
        onError: (message) => {
            textDeliveryFailed = true;
            params.onError?.(message);
        },
    });
    let doneDelivered = false;
    if (params.emitDone !== false) {
        dependencies.emitEnd({ sessionId: params.sessionId, runId: params.runId, durationMs: 0 });
        let doneDeliveryFailed = false;
        await deliverChunk({
            onChunk: params.onChunk,
            chunk: { type: "done", totalTokens: 0 },
            runId: params.runId,
            source: params.source,
            deliveryKind,
            targetKey: params.sessionId,
            onError: (message) => {
                doneDeliveryFailed = true;
                params.onError?.(message);
            },
        });
        doneDelivered = !doneDeliveryFailed;
    }
    const receipt = {
        persisted: params.persistMessage !== false,
        textDelivered: params.onChunk == null || !textDeliveryFailed,
        doneDelivered,
    };
    const delivered = receipt.textDelivered;
    recordMessageLedgerEvent({
        runId: params.runId,
        ...(params.parentRunId ? { parentRunId: params.parentRunId } : {}),
        ...(params.subSessionId ? { subSessionId: params.subSessionId } : {}),
        ...(params.agentId ? { agentId: params.agentId } : {}),
        sessionKey: params.sessionId,
        channel: params.source,
        eventKind: delivered ? "text_delivered" : "text_delivery_failed",
        deliveryKind,
        deliveryKey,
        idempotencyKey,
        status: delivered ? "delivered" : "failed",
        summary: delivered ? "응답 텍스트 전달 완료" : "응답 텍스트 전달 실패",
        detail: {
            persisted: receipt.persisted,
            textDelivered: receipt.textDelivered,
            doneDelivered: receipt.doneDelivered,
            textLength: normalized.length,
            ...(params.speaker ? { speaker: params.speaker } : {}),
            ...(params.sourceAttributions ? { sourceAttributions: params.sourceAttributions } : {}),
        },
    });
    return receipt;
}
export function resolveAssistantTextDeliveryOutcome(receipt) {
    const hasDeliveryFailure = !receipt.textDelivered || !receipt.doneDelivered;
    const failureStage = !receipt.textDelivered && !receipt.doneDelivered
        ? "text_and_done"
        : !receipt.textDelivered
            ? "text"
            : !receipt.doneDelivered
                ? "done"
                : "none";
    const summary = !hasDeliveryFailure
        ? "응답 전달 완료"
        : failureStage === "text_and_done"
            ? "응답 텍스트와 완료 신호 전달에 실패했습니다."
            : failureStage === "text"
                ? "응답 텍스트 전달에 실패했습니다."
                : "응답 완료 신호 전달에 실패했습니다.";
    return {
        persisted: receipt.persisted,
        textDelivered: receipt.textDelivered,
        doneDelivered: receipt.doneDelivered,
        hasDeliveryFailure,
        failureStage,
        summary,
    };
}
function inferChunkDeliveryKind(chunk) {
    if (chunk.type === "tool_end")
        return "artifact";
    if (chunk.type === "tool_start")
        return "progress";
    if (chunk.type === "error" || chunk.type === "execution_recovery" || chunk.type === "ai_recovery") {
        return "diagnostic";
    }
    return "final";
}
function getDeliveryProvider(params) {
    if (params.source)
        return params.source;
    return getRootRun(params.runId)?.source ?? "unknown";
}
function providerSendQueueKey(params) {
    return `${params.provider}:${params.targetKey ?? getRootRun(params.runId)?.sessionId ?? params.runId}`;
}
function getRetryAfterMs(error) {
    if (typeof error !== "object" || error === null)
        return undefined;
    const value = error["retryAfterMs"];
    return typeof value === "number" && Number.isFinite(value) && value > 0
        ? Math.trunc(value)
        : undefined;
}
function collectDeliveryReceipts(receipt) {
    return [
        ...(receipt?.artifactDeliveries ?? []).flatMap((delivery) => delivery.deliveryReceipts ?? []),
        ...(receipt?.textDeliveries ?? []).flatMap((delivery) => delivery.deliveryReceipts ?? []),
    ];
}
function resolveLedgerStatusFromReceipts(receipts) {
    if (receipts.length === 0)
        return "succeeded";
    if (receipts.some((receipt) => receipt.status === "failed" || receipt.status === "blocked_by_policy" || receipt.status === "unsupported_capability")) {
        return "failed";
    }
    if (receipts.some((receipt) => receipt.status === "rate_limited" || receipt.status === "partial")) {
        return "degraded";
    }
    if (receipts.some((receipt) => receipt.status === "delivered"))
        return "delivered";
    if (receipts.some((receipt) => receipt.status === "sent"))
        return "sent";
    return "pending";
}
function maxRetryAfterFromReceipts(receipts) {
    const values = receipts
        .map((receipt) => receipt.retryAfterMs)
        .filter((value) => typeof value === "number" && Number.isFinite(value) && value > 0);
    return values.length > 0 ? Math.max(...values) : undefined;
}
function rememberProviderBackoff(providerKey, retryAfterMs) {
    if (!retryAfterMs)
        return;
    const nextUntil = deliveryOutboxHooks.now() + retryAfterMs;
    providerBackoffUntil.set(providerKey, Math.max(providerBackoffUntil.get(providerKey) ?? 0, nextUntil));
}
function summarizeReceiptsForOutbox(receipts) {
    return receipts.map((receipt) => ({
        provider: receipt.provider,
        status: receipt.status,
        connectionId: receipt.connectionId,
        channelId: receipt.channelId,
        target: receipt.target,
        idempotencyKey: receipt.idempotencyKey,
        messageId: receipt.messageId ?? null,
        threadId: receipt.threadId ?? null,
        retryAfterMs: receipt.retryAfterMs ?? null,
        errorCode: receipt.errorCode ?? null,
        providerResponseRef: receipt.providerResponseRef ?? null,
    }));
}
async function runInProviderSendQueue(params) {
    const previous = providerSendQueues.get(params.providerKey) ?? Promise.resolve();
    let current;
    current = previous
        .catch(() => undefined)
        .then(params.task);
    const tracked = current
        .finally(() => {
        if (providerSendQueues.get(params.providerKey) === tracked) {
            providerSendQueues.delete(params.providerKey);
        }
    })
        .catch(() => undefined);
    providerSendQueues.set(params.providerKey, tracked);
    return current;
}
function recordOutboxEvent(input) {
    const run = getRootRun(input.runId);
    recordMessageLedgerEvent({
        runId: input.runId,
        requestGroupId: run?.requestGroupId ?? input.runId,
        sessionKey: run?.sessionId ?? null,
        channel: input.provider,
        eventKind: input.eventKind,
        deliveryKind: input.deliveryKind,
        deliveryKey: input.deliveryKey,
        idempotencyKey: input.idempotencyKey,
        status: input.status,
        summary: input.summary,
        detail: {
            providerKey: input.providerKey,
            ...(input.detail ?? {}),
        },
    });
}
export async function deliverChunk(params) {
    if (!params.onChunk)
        return undefined;
    const recoveryKey = buildChunkDeliveryRecoveryKey(params.runId, params.chunk);
    const provider = getDeliveryProvider(params);
    const providerKey = providerSendQueueKey({
        provider,
        runId: params.runId,
        ...(params.targetKey ? { targetKey: params.targetKey } : {}),
    });
    const deliveryKind = params.deliveryKind ?? inferChunkDeliveryKind(params.chunk);
    const deliveryKey = `chunk:${providerKey}:${recoveryKey}`;
    const priority = params.priority ?? "normal";
    try {
        return await runInProviderSendQueue({
            providerKey,
            task: async () => {
                const backoffDelayMs = Math.max(0, (providerBackoffUntil.get(providerKey) ?? 0) - deliveryOutboxHooks.now());
                if (backoffDelayMs > 0) {
                    recordOutboxEvent({
                        runId: params.runId,
                        provider,
                        providerKey,
                        eventKind: "delivery_backoff_scheduled",
                        deliveryKind,
                        deliveryKey,
                        idempotencyKey: `delivery-backoff:${deliveryKey}:${deliveryOutboxHooks.now()}`,
                        status: "pending",
                        summary: `${provider} delivery is waiting for provider backoff.`,
                        detail: {
                            delayMs: backoffDelayMs,
                            priority,
                            chunkType: params.chunk.type,
                        },
                    });
                    await deliveryOutboxHooks.sleep(backoffDelayMs);
                }
                recordOutboxEvent({
                    runId: params.runId,
                    provider,
                    providerKey,
                    eventKind: "delivery_attempted",
                    deliveryKind,
                    deliveryKey,
                    idempotencyKey: `delivery-attempt:${deliveryKey}`,
                    status: "started",
                    summary: `${provider} delivery attempt started.`,
                    detail: {
                        priority,
                        chunkType: params.chunk.type,
                    },
                });
                const receipt = ((await enqueueBackpressureTask({
                    queueName: "delivery",
                    runId: params.runId,
                    recoveryKey: deliveryKey,
                    task: async () => (await params.onChunk?.(params.chunk)) ?? undefined,
                })) ?? undefined);
                const deliveryReceipts = collectDeliveryReceipts(receipt);
                rememberProviderBackoff(providerKey, maxRetryAfterFromReceipts(deliveryReceipts));
                if (receipt || deliveryReceipts.length > 0) {
                    recordOutboxEvent({
                        runId: params.runId,
                        provider,
                        providerKey,
                        eventKind: "delivery_receipted",
                        deliveryKind,
                        deliveryKey,
                        idempotencyKey: `delivery-receipt:${deliveryKey}:${deliveryOutboxHooks.now()}`,
                        status: resolveLedgerStatusFromReceipts(deliveryReceipts),
                        summary: `${provider} delivery receipt recorded.`,
                        detail: {
                            priority,
                            chunkType: params.chunk.type,
                            receipts: summarizeReceiptsForOutbox(deliveryReceipts),
                        },
                    });
                }
                return receipt;
            },
        });
    }
    catch (error) {
        const retryAfterMs = getRetryAfterMs(error);
        rememberProviderBackoff(providerKey, retryAfterMs);
        recordOutboxEvent({
            runId: params.runId,
            provider,
            providerKey,
            eventKind: "delivery_receipted",
            deliveryKind,
            deliveryKey,
            idempotencyKey: `delivery-receipt:${deliveryKey}:${deliveryOutboxHooks.now()}:failed`,
            status: retryAfterMs ? "degraded" : "failed",
            summary: retryAfterMs
                ? `${provider} delivery was rate limited.`
                : `${provider} delivery failed.`,
            detail: {
                priority,
                chunkType: params.chunk.type,
                retryAfterMs: retryAfterMs ?? null,
                error: error instanceof Error ? error.message : String(error),
            },
        });
        const rawMessage = error instanceof Error ? error.message : String(error);
        const sanitized = sanitizeUserFacingError(`chunk delivery failed: ${rawMessage}`);
        const retryDecision = recordRetryBudgetAttempt({
            queueName: "delivery",
            runId: params.runId,
            recoveryKey,
            reason: sanitized.kind,
        });
        const message = retryDecision.allowed
            ? `runId=${params.runId} chunk delivery failed: ${sanitized.userMessage}`
            : `runId=${params.runId} chunk delivery failed: ${retryDecision.userMessage}`;
        params.onError?.(message);
        return undefined;
    }
}
function buildChunkDeliveryRecoveryKey(runId, chunk) {
    switch (chunk.type) {
        case "text":
            return `chunk:${runId}:text`;
        case "done":
            return `chunk:${runId}:done`;
        case "tool_start":
            return `chunk:${runId}:tool_start:${chunk.toolName}`;
        case "tool_end":
            return `chunk:${runId}:tool_end:${chunk.toolName}`;
        case "execution_recovery":
            return `chunk:${runId}:execution_recovery`;
        case "ai_recovery":
            return `chunk:${runId}:ai_recovery`;
        case "error":
            return `chunk:${runId}:error`;
    }
}
export async function deliverTrackedChunk(params) {
    const receipt = await deliverChunk({
        onChunk: params.onChunk,
        chunk: params.chunk,
        runId: params.runId,
        ...(params.onError ? { onError: params.onError } : {}),
        ...(params.source ? { source: params.source } : {}),
        ...(params.deliveryKind ? { deliveryKind: params.deliveryKind } : {}),
        ...(params.targetKey ? { targetKey: params.targetKey } : {}),
        ...(params.priority ? { priority: params.priority } : {}),
    });
    applyChunkDeliveryReceipt({
        runId: params.runId,
        receipt,
        successfulFileDeliveries: params.successfulFileDeliveries,
        successfulTextDeliveries: params.successfulTextDeliveries,
        appendEvent: params.appendEvent,
    });
    return receipt;
}
function channelRefTarget(receipt) {
    const externalChatId = receipt.target.roomId ?? receipt.target.userId ?? receipt.channelId;
    const externalMessageId = receipt.messageId ?? receipt.target.messageId;
    if (!externalChatId || !externalMessageId)
        return undefined;
    return {
        externalChatId,
        ...(receipt.threadId ?? receipt.target.threadId ?? receipt.target.topicId
            ? { externalThreadId: receipt.threadId ?? receipt.target.threadId ?? receipt.target.topicId }
            : {}),
        externalMessageId,
    };
}
function recordChannelMessageRefsFromReceipts(input) {
    if (input.receipts.length === 0)
        return;
    const run = getRootRun(input.runId);
    if (!run)
        return;
    for (const receipt of input.receipts) {
        const target = channelRefTarget(receipt);
        if (!target)
            continue;
        try {
            insertChannelMessageRef({
                source: input.source,
                session_id: run.sessionId,
                root_run_id: run.id,
                request_group_id: run.requestGroupId,
                external_chat_id: target.externalChatId,
                external_thread_id: target.externalThreadId ?? null,
                external_message_id: target.externalMessageId,
                role: input.role,
                created_at: receipt.timestamp || Date.now(),
            });
        }
        catch {
            // Channel refs are lookup aids. Duplicate or degraded writes must not affect delivery.
        }
    }
}
export function applyChunkDeliveryReceipt(params) {
    for (const delivery of params.receipt?.artifactDeliveries ?? []) {
        const alreadyRecorded = params.successfulFileDeliveries.some((existing) => existing.channel === delivery.channel &&
            existing.filePath === delivery.filePath &&
            existing.toolName === delivery.toolName);
        if (alreadyRecorded)
            continue;
        params.successfulFileDeliveries.push(delivery);
        recordChannelMessageRefsFromReceipts({
            runId: params.runId,
            source: delivery.channel,
            receipts: delivery.deliveryReceipts ?? [],
            role: "assistant",
        });
        if (delivery.channel === "telegram") {
            params.appendEvent(params.runId, `텔레그램 파일 전달 완료: ${describeArtifactForUser(delivery)}`);
        }
        else if (delivery.channel === "slack") {
            params.appendEvent(params.runId, `Slack 파일 전달 완료: ${describeArtifactForUser(delivery)}`);
        }
        else {
            params.appendEvent(params.runId, `WebUI 파일 전달 완료: ${describeArtifactForUser(delivery)}`);
        }
        rememberDeliveryContinuity(params.runId, {
            lastToolReceipt: `${delivery.toolName}:${delivery.channel}:${displayHomePath(delivery.filePath)}`,
            lastDeliveryReceipt: `${delivery.channel}:${displayHomePath(delivery.filePath)}`,
            pendingDelivery: [],
            status: "delivered",
        });
        recordMessageLedgerEvent({
            runId: params.runId,
            channel: delivery.channel,
            eventKind: "artifact_delivered",
            deliveryKey: buildLedgerArtifactDeliveryKey(delivery.channel, delivery.url ?? delivery.downloadUrl ?? delivery.previewUrl, delivery.filePath),
            idempotencyKey: `chunk-artifact:${params.runId}:${delivery.channel}:${delivery.toolName}:${delivery.filePath}`,
            status: "delivered",
            summary: `${delivery.channel} artifact delivered: ${describeArtifactForUser(delivery)}`,
            detail: {
                toolName: delivery.toolName,
                filePath: displayHomePath(delivery.filePath),
                ...(delivery.deliveryReceipts
                    ? { deliveryReceipts: summarizeDeliveryReceiptsForLedger(delivery.deliveryReceipts) }
                    : {}),
                ...(delivery.url ? { url: delivery.url } : {}),
                ...(delivery.previewUrl ? { previewUrl: delivery.previewUrl } : {}),
                ...(delivery.downloadUrl ? { downloadUrl: delivery.downloadUrl } : {}),
                ...(delivery.mimeType ? { mimeType: delivery.mimeType } : {}),
                ...(delivery.sizeBytes !== undefined ? { sizeBytes: delivery.sizeBytes } : {}),
            },
        });
    }
    for (const delivery of params.receipt?.textDeliveries ?? []) {
        if ((delivery.deliveryKind ?? "final") === "final" && delivery.subSessionId) {
            recordMessageLedgerEvent({
                runId: params.runId,
                ...(delivery.parentRunId ? { parentRunId: delivery.parentRunId } : {}),
                subSessionId: delivery.subSessionId,
                ...(delivery.agentId ? { agentId: delivery.agentId } : {}),
                channel: delivery.channel,
                eventKind: "text_delivery_suppressed",
                deliveryKind: "final",
                deliveryKey: buildLedgerTextDeliveryKey(delivery.channel, JSON.stringify(delivery.messageIds ?? []), delivery.text),
                idempotencyKey: `chunk-text-blocked:${params.runId}:${delivery.subSessionId}:${delivery.channel}:${JSON.stringify(delivery.messageIds ?? [])}`,
                status: "suppressed",
                summary: "child sub-session chunk final delivery was blocked; parent finalizer must deliver.",
                detail: {
                    reasonCode: "child_direct_final_delivery_blocked",
                    textLength: delivery.text.length,
                },
            });
            continue;
        }
        const alreadyRecorded = params.successfulTextDeliveries.some((existing) => existing.channel === delivery.channel &&
            existing.text === delivery.text &&
            JSON.stringify(existing.messageIds ?? []) === JSON.stringify(delivery.messageIds ?? []));
        if (alreadyRecorded)
            continue;
        params.successfulTextDeliveries.push(delivery);
        recordChannelMessageRefsFromReceipts({
            runId: params.runId,
            source: delivery.channel,
            receipts: delivery.deliveryReceipts ?? [],
            role: "assistant",
        });
        if (delivery.channel === "telegram") {
            params.appendEvent(params.runId, "텔레그램 텍스트 전달 완료");
        }
        else if (delivery.channel === "webui") {
            params.appendEvent(params.runId, "WebUI 텍스트 전달 완료");
        }
        else if (delivery.channel === "slack") {
            params.appendEvent(params.runId, "Slack 텍스트 전달 완료");
        }
        else {
            params.appendEvent(params.runId, "CLI 텍스트 출력 완료");
        }
        rememberDeliveryContinuity(params.runId, {
            lastDeliveryReceipt: `${delivery.channel}:text`,
            pendingDelivery: [],
            status: "delivered",
        });
        recordMessageLedgerEvent({
            runId: params.runId,
            ...(delivery.parentRunId ? { parentRunId: delivery.parentRunId } : {}),
            ...(delivery.subSessionId ? { subSessionId: delivery.subSessionId } : {}),
            ...(delivery.agentId ? { agentId: delivery.agentId } : {}),
            channel: delivery.channel,
            eventKind: "text_delivered",
            deliveryKind: delivery.deliveryKind ?? "final",
            deliveryKey: buildLedgerTextDeliveryKey(delivery.channel, JSON.stringify(delivery.messageIds ?? []), delivery.text),
            idempotencyKey: `chunk-text:${params.runId}:${delivery.channel}:${JSON.stringify(delivery.messageIds ?? [])}`,
            status: "delivered",
            summary: `${delivery.channel} text delivered`,
            detail: {
                textLength: delivery.text.length,
                ...(delivery.messageIds ? { messageIds: delivery.messageIds } : {}),
                ...(delivery.deliveryReceipts
                    ? { deliveryReceipts: summarizeDeliveryReceiptsForLedger(delivery.deliveryReceipts) }
                    : {}),
                ...(delivery.deliveryKind ? { deliveryKind: delivery.deliveryKind } : {}),
            },
        });
    }
}
function summarizeDeliveryReceiptsForLedger(receipts) {
    return receipts.map((receipt) => ({
        status: receipt.status,
        provider: receipt.provider,
        connectionId: receipt.connectionId,
        messageId: receipt.messageId ?? null,
        threadId: receipt.threadId ?? null,
        idempotencyKey: receipt.idempotencyKey,
        ...(receipt.errorCode ? { errorCode: receipt.errorCode } : {}),
        ...(receipt.capability ? { capability: receipt.capability } : {}),
    }));
}
export function logAssistantReply(source, text) {
    if (source !== "webui" && source !== "telegram")
        return;
    const normalized = text.trim();
    if (!normalized)
        return;
    process.stdout.write(`${normalized}\n`);
}
//# sourceMappingURL=delivery.js.map