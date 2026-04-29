import { buildArtifactAccessDescriptor } from "../../artifacts/lifecycle.js";
import { deliverArtifactOnce, } from "../../runs/delivery.js";
import { decideIsolatedToolResponse } from "../../runs/isolated-tool-response.js";
import { buildTextDeliveryKey, recordMessageLedgerEvent, } from "../../runs/message-ledger.js";
import { buildSlackFailedDeliveryReceipt, buildSlackSentDeliveryReceipt, } from "./message-delivery.js";
function isArtifactDeliveryDetails(value) {
    if (!value || typeof value !== "object")
        return false;
    const candidate = value;
    return (candidate.kind === "artifact_delivery" &&
        candidate.channel === "slack" &&
        typeof candidate.filePath === "string" &&
        typeof candidate.size === "number");
}
function buildSlackArtifactFallbackMessage(fileName, downloadUrl, caption) {
    const title = caption?.trim() || fileName;
    if (!downloadUrl) {
        return `파일 업로드가 실패했습니다. 안전한 다운로드 링크도 만들 수 없어 같은 Slack 스레드에서 완료할 수 없습니다.\n- 파일: ${title}`;
    }
    return `파일 업로드가 실패해 같은 Slack 스레드에 다운로드 링크로 대신 전달합니다.\n- 파일: ${title}\n- 다운로드: ${downloadUrl}`;
}
function shouldSendToolStartStatus(toolName) {
    return toolName !== "shell_exec";
}
export function createSlackChunkDeliveryHandler(context) {
    let bufferedText = "";
    let toolOwnedResponseActive = false;
    const toolMessageIds = new Map();
    const recordIfRunPresent = (messageId, role) => {
        const runId = context.getRunId();
        if (!runId)
            return;
        context.recordOutgoingMessageRef({
            sessionId: context.sessionId,
            runId,
            channelId: context.channelId,
            threadTs: context.threadTs,
            messageId,
            role,
        });
    };
    const target = () => ({
        channelId: context.channelId,
        threadTs: context.threadTs,
    });
    const textDeliveryIdempotencyPrefix = (kind) => {
        return `slack:${kind}:${context.getRunId() ?? "pending"}:${context.channelId}:${context.threadTs}`;
    };
    const recordSlackTextDeliveryFailure = (error, text, kind) => {
        const runId = context.getRunId();
        if (!runId)
            return;
        const failedReceipt = buildSlackFailedDeliveryReceipt({
            target: target(),
            idempotencyKey: `${textDeliveryIdempotencyPrefix(kind)}:failed`,
            error,
        });
        recordMessageLedgerEvent({
            runId,
            channel: "slack",
            eventKind: "text_delivery_failed",
            deliveryKind: context.deliveryKind ?? "final",
            deliveryKey: buildTextDeliveryKey("slack", JSON.stringify([context.channelId, context.threadTs]), text),
            idempotencyKey: failedReceipt.idempotencyKey,
            status: "failed",
            summary: failedReceipt.status === "rate_limited"
                ? "Slack text delivery was rate limited."
                : "Slack text delivery failed.",
            detail: {
                textLength: text.length,
                receiptStatus: failedReceipt.status,
                errorCode: failedReceipt.errorCode ?? null,
                errorMessage: failedReceipt.errorMessage ?? null,
                retryAfterMs: failedReceipt.retryAfterMs ?? null,
            },
        });
    };
    const sendFinalText = async (text, kind) => {
        const idempotencyPrefix = textDeliveryIdempotencyPrefix(kind);
        try {
            if (context.responder.sendFinalResponseWithReceipts) {
                const result = await context.responder.sendFinalResponseWithReceipts(text, idempotencyPrefix);
                return {
                    messageIds: result.messageIds,
                    deliveryReceipts: result.receipts,
                    deliveredText: text,
                };
            }
            const messageIds = await context.responder.sendFinalResponse(text);
            return {
                messageIds,
                deliveryReceipts: messageIds.map((messageId, index) => buildSlackSentDeliveryReceipt({
                    target: target(),
                    idempotencyKey: `${idempotencyPrefix}:part:${index + 1}`,
                    messageId,
                })),
                deliveredText: text,
            };
        }
        catch (error) {
            recordSlackTextDeliveryFailure(error, text, kind);
            context.logError(`Failed to send Slack text delivery: ${error instanceof Error ? error.message : String(error)}`);
            return undefined;
        }
    };
    const sendFileWithReceipt = async (filePath, idempotencyKey, caption) => {
        if (context.responder.sendFileWithReceipt) {
            return context.responder.sendFileWithReceipt(filePath, idempotencyKey, caption);
        }
        const messageId = await context.responder.sendFile(filePath, caption);
        return {
            messageId,
            receipt: buildSlackSentDeliveryReceipt({
                target: target(),
                idempotencyKey,
                messageId,
            }),
        };
    };
    return async (chunk) => {
        if (chunk.type === "text") {
            if (toolOwnedResponseActive)
                return;
            bufferedText += chunk.delta;
            return;
        }
        if (chunk.type === "tool_start") {
            if (!shouldSendToolStartStatus(chunk.toolName))
                return;
            const messageId = await context.responder.sendToolStatus(chunk.toolName);
            toolMessageIds.set(chunk.toolName, messageId);
            recordIfRunPresent(messageId, "tool");
            return;
        }
        if (chunk.type === "tool_end") {
            const toolMessageId = toolMessageIds.get(chunk.toolName);
            if (toolMessageId) {
                if (chunk.success) {
                    await context.responder.clearToolStatus?.(toolMessageId);
                }
                else {
                    await context.responder.updateToolStatus(toolMessageId, chunk.toolName, false);
                }
                toolMessageIds.delete(chunk.toolName);
            }
            else if (!chunk.success) {
                const failureMessageId = await context.responder.sendToolStatus(chunk.toolName);
                await context.responder.updateToolStatus(failureMessageId, chunk.toolName, false);
                recordIfRunPresent(failureMessageId, "tool");
            }
            const isolatedToolResponse = decideIsolatedToolResponse(chunk);
            if (isolatedToolResponse.kind === "artifact" && isArtifactDeliveryDetails(chunk.details)) {
                const details = chunk.details;
                const receipt = await deliverArtifactOnce({
                    runId: context.getRunId(),
                    channel: "slack",
                    filePath: details.filePath,
                    channelTarget: `${context.channelId}:${context.threadTs}`,
                    sizeBytes: details.size,
                    ...(details.mimeType ? { mimeType: details.mimeType } : {}),
                    task: async () => {
                        try {
                            const sent = await sendFileWithReceipt(details.filePath, `slack:file:${context.getRunId() ?? "pending"}:${details.filePath}`, details.caption);
                            recordIfRunPresent(sent.messageId, "assistant");
                            return {
                                artifactDeliveries: [
                                    {
                                        toolName: chunk.toolName,
                                        channel: "slack",
                                        filePath: details.filePath,
                                        ...(sent.permalink ? { url: sent.permalink } : {}),
                                        ...(details.caption ? { caption: details.caption } : {}),
                                        messageId: sent.messageId,
                                        deliveryReceipts: [sent.receipt],
                                    },
                                ],
                            };
                        }
                        catch (error) {
                            const message = error instanceof Error ? error.message : String(error);
                            context.logError(`Failed to send Slack file: ${message}`);
                            const artifact = buildArtifactAccessDescriptor({
                                filePath: details.filePath,
                                sizeBytes: details.size,
                                ...(details.mimeType ? { mimeType: details.mimeType } : {}),
                            });
                            const fallbackText = buildSlackArtifactFallbackMessage(artifact.fileName, artifact.ok ? artifact.downloadUrl : undefined, details.caption);
                            const sent = await sendFinalText(fallbackText, "artifact-fallback");
                            if (!sent)
                                throw error;
                            for (const fallbackMessageId of sent.messageIds) {
                                recordIfRunPresent(fallbackMessageId, "assistant");
                            }
                            return {
                                textDeliveries: [
                                    {
                                        channel: "slack",
                                        text: sent.deliveredText,
                                        messageIds: sent.messageIds,
                                        deliveryReceipts: sent.deliveryReceipts,
                                    },
                                ],
                                ...(artifact.ok && artifact.url
                                    ? {
                                        artifactDeliveries: [
                                            {
                                                toolName: chunk.toolName,
                                                channel: "slack",
                                                filePath: details.filePath,
                                                url: artifact.url,
                                                ...(artifact.previewUrl ? { previewUrl: artifact.previewUrl } : {}),
                                                ...(artifact.downloadUrl ? { downloadUrl: artifact.downloadUrl } : {}),
                                                previewable: artifact.previewable,
                                                mimeType: artifact.mimeType,
                                                sizeBytes: details.size,
                                                ...(details.caption ? { caption: details.caption } : {}),
                                                ...(sent.messageIds[0] !== undefined ? { messageId: sent.messageIds[0] } : {}),
                                                deliveryReceipts: sent.deliveryReceipts,
                                            },
                                        ],
                                    }
                                    : {}),
                            };
                        }
                    },
                });
                if (receipt) {
                    toolOwnedResponseActive = true;
                    bufferedText = "";
                    return receipt;
                }
            }
            if (isolatedToolResponse.kind === "text" && isolatedToolResponse.text) {
                toolOwnedResponseActive = true;
                bufferedText = isolatedToolResponse.text;
            }
            return;
        }
        if (chunk.type === "done") {
            if (!bufferedText)
                return;
            const deliveredText = bufferedText;
            const sent = await sendFinalText(bufferedText, "final");
            if (!sent) {
                bufferedText = "";
                return;
            }
            for (const messageId of sent.messageIds) {
                recordIfRunPresent(messageId, "assistant");
            }
            bufferedText = "";
            return {
                textDeliveries: [
                    {
                        channel: "slack",
                        text: deliveredText,
                        messageIds: sent.messageIds,
                        deliveryReceipts: sent.deliveryReceipts,
                        ...(context.deliveryKind ? { deliveryKind: context.deliveryKind } : {}),
                        ...(context.parentRunId ? { parentRunId: context.parentRunId } : {}),
                        ...(context.subSessionId ? { subSessionId: context.subSessionId } : {}),
                        ...(context.agentId ? { agentId: context.agentId } : {}),
                    },
                ],
            };
        }
        if (chunk.type === "error") {
            if (toolOwnedResponseActive)
                return;
            const messageId = await context.responder.sendError(chunk.message);
            recordIfRunPresent(messageId, "assistant");
            bufferedText = "";
        }
    };
}
//# sourceMappingURL=chunk-delivery.js.map