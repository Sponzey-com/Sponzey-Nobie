import { decideIsolatedToolResponse } from "../../runs/isolated-tool-response.js";
function isArtifactDeliveryDetails(value) {
    if (!value || typeof value !== "object")
        return false;
    const candidate = value;
    return candidate.kind === "artifact_delivery"
        && candidate.channel === "telegram"
        && typeof candidate.filePath === "string"
        && typeof candidate.size === "number"
        && typeof candidate.source === "string";
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
    return async (chunk) => {
        if (chunk.type === "text") {
            if (toolOwnedResponseActive)
                return;
            bufferedText += chunk.delta;
            return;
        }
        if (chunk.type === "tool_start") {
            const msgId = await context.responder.sendToolStatus(chunk.toolName);
            toolMessageIds.set(chunk.toolName, msgId);
            recordIfRunPresent(msgId, "tool");
            return;
        }
        if (chunk.type === "tool_end") {
            const msgId = toolMessageIds.get(chunk.toolName);
            if (msgId !== undefined) {
                await context.responder.updateToolStatus(msgId, chunk.toolName, chunk.success);
                toolMessageIds.delete(chunk.toolName);
            }
            const isolatedToolResponse = decideIsolatedToolResponse(chunk);
            if (isolatedToolResponse.kind === "artifact" && isArtifactDeliveryDetails(chunk.details)) {
                try {
                    const sentMessageId = await context.responder.sendFile(chunk.details.filePath, chunk.details.caption);
                    toolOwnedResponseActive = true;
                    bufferedText = "";
                    recordIfRunPresent(sentMessageId, "assistant");
                    return {
                        artifactDeliveries: [{
                                toolName: chunk.toolName,
                                channel: "telegram",
                                filePath: chunk.details.filePath,
                                ...(chunk.details.caption ? { caption: chunk.details.caption } : {}),
                                messageId: sentMessageId,
                            }],
                    };
                }
                catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    context.logError(`Failed to send file: ${message}`);
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
            const sentMessageIds = await context.responder.sendFinalResponse(bufferedText);
            for (const messageId of sentMessageIds) {
                recordIfRunPresent(messageId, "assistant");
            }
            bufferedText = "";
            return {
                textDeliveries: [{
                        channel: "telegram",
                        text: deliveredText,
                        messageIds: sentMessageIds,
                    }],
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