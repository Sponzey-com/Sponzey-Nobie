import { deliverArtifactOnce } from "../../runs/delivery.js";
import { decideIsolatedToolResponse } from "../../runs/isolated-tool-response.js";
function isArtifactDeliveryDetails(value) {
    if (!value || typeof value !== "object")
        return false;
    const candidate = value;
    return candidate.kind === "artifact_delivery"
        && candidate.channel === "slack"
        && typeof candidate.filePath === "string"
        && typeof candidate.size === "number";
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
    return async (chunk) => {
        if (chunk.type === "text") {
            if (toolOwnedResponseActive)
                return;
            bufferedText += chunk.delta;
            return;
        }
        if (chunk.type === "tool_start") {
            const messageId = await context.responder.sendToolStatus(chunk.toolName);
            toolMessageIds.set(chunk.toolName, messageId);
            recordIfRunPresent(messageId, "tool");
            return;
        }
        if (chunk.type === "tool_end") {
            const toolMessageId = toolMessageIds.get(chunk.toolName);
            if (toolMessageId) {
                await context.responder.updateToolStatus(toolMessageId, chunk.toolName, chunk.success);
                toolMessageIds.delete(chunk.toolName);
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
                            const sentMessageId = await context.responder.sendFile(details.filePath, details.caption);
                            recordIfRunPresent(sentMessageId, "assistant");
                            return {
                                artifactDeliveries: [{
                                        toolName: chunk.toolName,
                                        channel: "slack",
                                        filePath: details.filePath,
                                        ...(details.caption ? { caption: details.caption } : {}),
                                    }],
                            };
                        }
                        catch (error) {
                            const message = error instanceof Error ? error.message : String(error);
                            context.logError(`Failed to send Slack file: ${message}`);
                            return undefined;
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
            const sentMessageIds = await context.responder.sendFinalResponse(bufferedText);
            for (const messageId of sentMessageIds) {
                recordIfRunPresent(messageId, "assistant");
            }
            bufferedText = "";
            return {
                textDeliveries: [{
                        channel: "slack",
                        text: deliveredText,
                    }],
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