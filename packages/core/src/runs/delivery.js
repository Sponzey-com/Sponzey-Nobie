import crypto from "node:crypto";
import { homedir } from "node:os";
import { insertMessage, upsertTaskContinuity } from "../db/index.js";
import { eventBus } from "../events/index.js";
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
    return `${channelLabel} 파일 전달 완료: ${displayHomePath(last.filePath)}`;
}
export function resolveDeliveryOutcome(params) {
    const hasSuccessfulArtifactDelivery = params.deliveries.length > 0;
    const deliverySatisfied = params.wantsDirectArtifactDelivery && hasSuccessfulArtifactDelivery;
    const deliverySummary = hasSuccessfulArtifactDelivery
        ? buildSuccessfulDeliverySummary(params.deliveries)
        : undefined;
    return {
        directArtifactDeliveryRequested: params.wantsDirectArtifactDelivery,
        hasSuccessfulArtifactDelivery,
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
            onError: (message) => {
                doneDeliveryFailed = true;
                params.onError?.(message);
            },
        });
        doneDelivered = !doneDeliveryFailed;
    }
    return {
        persisted: params.persistMessage !== false,
        textDelivered: params.onChunk == null || !textDeliveryFailed,
        doneDelivered,
    };
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
export async function deliverChunk(params) {
    if (!params.onChunk)
        return undefined;
    try {
        return (await params.onChunk(params.chunk)) ?? undefined;
    }
    catch (error) {
        const message = `runId=${params.runId} chunk delivery failed: ${error instanceof Error ? error.message : String(error)}`;
        params.onError?.(message);
        return undefined;
    }
}
export async function deliverTrackedChunk(params) {
    const receipt = await deliverChunk({
        onChunk: params.onChunk,
        chunk: params.chunk,
        runId: params.runId,
        ...(params.onError ? { onError: params.onError } : {}),
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
export function applyChunkDeliveryReceipt(params) {
    for (const delivery of params.receipt?.artifactDeliveries ?? []) {
        const alreadyRecorded = params.successfulFileDeliveries.some((existing) => existing.channel === delivery.channel
            && existing.filePath === delivery.filePath
            && existing.messageId === delivery.messageId);
        if (alreadyRecorded)
            continue;
        params.successfulFileDeliveries.push(delivery);
        if (delivery.channel === "telegram") {
            params.appendEvent(params.runId, `텔레그램 파일 전달 완료: ${displayHomePath(delivery.filePath)}`);
        }
        else if (delivery.channel === "slack") {
            params.appendEvent(params.runId, `Slack 파일 전달 완료: ${displayHomePath(delivery.filePath)}`);
        }
        else {
            params.appendEvent(params.runId, `WebUI 파일 전달 완료: ${displayHomePath(delivery.filePath)}`);
        }
        rememberDeliveryContinuity(params.runId, {
            lastToolReceipt: `${delivery.toolName}:${delivery.channel}:${displayHomePath(delivery.filePath)}`,
            lastDeliveryReceipt: `${delivery.channel}:${displayHomePath(delivery.filePath)}`,
            pendingDelivery: [],
            status: "delivered",
        });
    }
    for (const delivery of params.receipt?.textDeliveries ?? []) {
        const alreadyRecorded = params.successfulTextDeliveries.some((existing) => existing.channel === delivery.channel
            && existing.text === delivery.text
            && JSON.stringify(existing.messageIds ?? []) === JSON.stringify(delivery.messageIds ?? []));
        if (alreadyRecorded)
            continue;
        params.successfulTextDeliveries.push(delivery);
        if (delivery.channel === "telegram") {
            params.appendEvent(params.runId, `텔레그램 텍스트 전달 완료`);
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
    }
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