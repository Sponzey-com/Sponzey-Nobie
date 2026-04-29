import { buildArtifactAccessDescriptor } from "../../artifacts/lifecycle.js";
import { deliverArtifactOnce, } from "../../runs/delivery.js";
import { decideIsolatedToolResponse } from "../../runs/isolated-tool-response.js";
import { buildTextDeliveryKey, recordMessageLedgerEvent, } from "../../runs/message-ledger.js";
import { buildTelegramFailedDeliveryReceipt, buildTelegramSentDeliveryReceipt, } from "./message-delivery.js";
import { splitMessage } from "./markdown.js";
const DEFAULT_MAX_TEXT_CHUNKS = 20;
const FALLBACK_PREVIEW_LENGTH = 1200;
function isArtifactDeliveryDetails(value) {
    if (!value || typeof value !== "object")
        return false;
    const candidate = value;
    return (candidate.kind === "artifact_delivery" &&
        candidate.channel === "telegram" &&
        typeof candidate.filePath === "string" &&
        typeof candidate.size === "number" &&
        typeof candidate.source === "string");
}
function buildTelegramArtifactFallbackMessage(fileName, downloadUrl, caption) {
    const title = caption?.trim() || fileName;
    if (!downloadUrl) {
        return `파일 업로드가 실패했습니다. 안전한 다운로드 링크도 만들 수 없어 같은 대화에서 완료할 수 없습니다.\n- 파일: ${title}`;
    }
    return `파일 업로드가 실패해 같은 대화에 다운로드 링크로 대신 전달합니다.\n- 파일: ${title}\n- 다운로드: ${downloadUrl}`;
}
function shouldSendToolStartStatus(toolName) {
    return toolName !== "shell_exec";
}
export function buildTelegramTooManyChunksFallbackText(input) {
    const preview = input.text.trim().slice(0, FALLBACK_PREVIEW_LENGTH);
    const suffix = input.text.trim().length > FALLBACK_PREVIEW_LENGTH ? "\n\n...[truncated]" : "";
    return [
        `결과가 너무 길어 Telegram 메시지 ${input.estimatedChunks}개로 나뉠 수 있어 자동 분할 전송을 중단했습니다.`,
        `최대 허용 분할 수: ${input.maxChunks}`,
        "전체 결과는 WebUI 실행 상세 또는 생성된 artifact에서 확인해 주세요.",
        "",
        preview + suffix,
    ].join("\n");
}
export function createTelegramChunkDeliveryHandler(context) {
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
            chatId: context.chatId,
            ...(context.threadId !== undefined ? { threadId: context.threadId } : {}),
            messageId,
            role,
        });
    };
    const target = () => ({
        chatId: context.chatId,
        ...(context.threadId !== undefined ? { threadId: context.threadId } : {}),
    });
    const textDeliveryIdempotencyPrefix = (kind) => {
        return `telegram:${kind}:${context.getRunId() ?? "pending"}:${context.chatId}:${context.threadId ?? "main"}`;
    };
    const sendFinalText = async (text, kind) => {
        const estimatedChunks = splitMessage(text).length;
        const maxChunks = context.maxTextChunks ?? DEFAULT_MAX_TEXT_CHUNKS;
        const deliveredText = estimatedChunks > maxChunks
            ? buildTelegramTooManyChunksFallbackText({ text, estimatedChunks, maxChunks })
            : text;
        const idempotencyPrefix = textDeliveryIdempotencyPrefix(kind);
        try {
            if (context.responder.sendFinalResponseWithReceipts) {
                const result = await context.responder.sendFinalResponseWithReceipts(deliveredText, idempotencyPrefix);
                return {
                    messageIds: result.messageIds,
                    deliveryReceipts: result.receipts,
                    deliveredText,
                };
            }
            const messageIds = await context.responder.sendFinalResponse(deliveredText);
            return {
                messageIds,
                deliveryReceipts: messageIds.map((messageId, index) => buildTelegramSentDeliveryReceipt({
                    target: target(),
                    idempotencyKey: `${idempotencyPrefix}:part:${index + 1}`,
                    messageId,
                })),
                deliveredText,
            };
        }
        catch (error) {
            recordTelegramTextDeliveryFailure(error, deliveredText, kind);
            context.logError(`Failed to send Telegram text delivery: ${error instanceof Error ? error.message : String(error)}`);
            return undefined;
        }
    };
    const recordTelegramTextDeliveryFailure = (error, text, kind) => {
        const runId = context.getRunId();
        if (!runId)
            return;
        const failedReceipt = buildTelegramFailedDeliveryReceipt({
            target: target(),
            idempotencyKey: `${textDeliveryIdempotencyPrefix(kind)}:failed`,
            error,
        });
        recordMessageLedgerEvent({
            runId,
            channel: "telegram",
            eventKind: "text_delivery_failed",
            deliveryKind: context.deliveryKind ?? "final",
            deliveryKey: buildTextDeliveryKey("telegram", JSON.stringify([context.chatId, context.threadId ?? "main"]), text),
            idempotencyKey: failedReceipt.idempotencyKey,
            status: "failed",
            summary: "Telegram text delivery failed.",
            detail: {
                textLength: text.length,
                receiptStatus: failedReceipt.status,
                errorCode: failedReceipt.errorCode ?? null,
                errorMessage: failedReceipt.errorMessage ?? null,
            },
        });
    };
    const sendFileWithReceipt = async (filePath, idempotencyKey, caption) => {
        if (context.responder.sendFileWithReceipt) {
            return context.responder.sendFileWithReceipt(filePath, idempotencyKey, caption);
        }
        const messageId = await context.responder.sendFile(filePath, caption);
        return {
            messageId,
            receipt: buildTelegramSentDeliveryReceipt({
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
            const msgId = await context.responder.sendToolStatus(chunk.toolName);
            toolMessageIds.set(chunk.toolName, msgId);
            recordIfRunPresent(msgId, "tool");
            return;
        }
        if (chunk.type === "tool_end") {
            const msgId = toolMessageIds.get(chunk.toolName);
            if (msgId !== undefined) {
                if (chunk.success) {
                    await context.responder.clearToolStatus?.(msgId);
                }
                else {
                    await context.responder.updateToolStatus(msgId, chunk.toolName, false);
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
                    channel: "telegram",
                    filePath: details.filePath,
                    channelTarget: `${context.chatId}${context.threadId !== undefined ? `:${context.threadId}` : ""}`,
                    sizeBytes: details.size,
                    ...(details.mimeType ? { mimeType: details.mimeType } : {}),
                    task: async () => {
                        try {
                            const sent = await sendFileWithReceipt(details.filePath, `telegram:file:${context.getRunId() ?? "pending"}:${details.filePath}`, details.caption);
                            recordIfRunPresent(sent.messageId, "assistant");
                            return {
                                artifactDeliveries: [
                                    {
                                        toolName: chunk.toolName,
                                        channel: "telegram",
                                        filePath: details.filePath,
                                        ...(details.caption ? { caption: details.caption } : {}),
                                        messageId: sent.messageId,
                                        deliveryReceipts: [sent.receipt],
                                    },
                                ],
                            };
                        }
                        catch (error) {
                            const message = error instanceof Error ? error.message : String(error);
                            context.logError(`Failed to send file: ${message}`);
                            const artifact = buildArtifactAccessDescriptor({
                                filePath: details.filePath,
                                sizeBytes: details.size,
                                ...(details.mimeType ? { mimeType: details.mimeType } : {}),
                            });
                            const fallbackText = buildTelegramArtifactFallbackMessage(artifact.fileName, artifact.ok ? artifact.downloadUrl : undefined, details.caption);
                            const sent = await sendFinalText(fallbackText, "artifact-fallback");
                            if (!sent)
                                throw error;
                            for (const fallbackMessageId of sent.messageIds) {
                                recordIfRunPresent(fallbackMessageId, "assistant");
                            }
                            return {
                                textDeliveries: [
                                    {
                                        channel: "telegram",
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
                                                channel: "telegram",
                                                filePath: details.filePath,
                                                url: artifact.url,
                                                ...(artifact.previewUrl ? { previewUrl: artifact.previewUrl } : {}),
                                                ...(artifact.downloadUrl ? { downloadUrl: artifact.downloadUrl } : {}),
                                                previewable: artifact.previewable,
                                                mimeType: artifact.mimeType,
                                                sizeBytes: details.size,
                                                ...(details.caption ? { caption: details.caption } : {}),
                                                ...(sent.messageIds[0] !== undefined
                                                    ? { messageId: sent.messageIds[0] }
                                                    : {}),
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
                        channel: "telegram",
                        text: sent.deliveredText,
                        messageIds: sent.messageIds,
                        deliveryReceipts: sent.deliveryReceipts,
                        ...(sent.deliveredText !== deliveredText ? { deliveryKind: "diagnostic" } : {}),
                        ...(context.deliveryKind ? { deliveryKind: context.deliveryKind } : {}),
                        ...(context.parentRunId ? { parentRunId: context.parentRunId } : {}),
                        ...(context.subSessionId ? { subSessionId: context.subSessionId } : {}),
                        ...(context.agentId ? { agentId: context.agentId } : {}),
                    },
                ],
            };
        }
        if (chunk.type === "error") {
            if (toolOwnedResponseActive) {
                return;
            }
            const errorMessageId = await context.responder.sendError(chunk.message);
            recordIfRunPresent(errorMessageId, "assistant");
            bufferedText = "";
        }
    };
}
//# sourceMappingURL=chunk-delivery.js.map