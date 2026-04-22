import { basename } from "node:path";
import { eventBus } from "../../events/index.js";
import { buildArtifactAccessDescriptor } from "../../artifacts/lifecycle.js";
import { deliverArtifactOnce } from "../../runs/delivery.js";
import { decideIsolatedToolResponse } from "../../runs/isolated-tool-response.js";
function isWebUiArtifactDeliveryDetails(value) {
    if (!value || typeof value !== "object")
        return false;
    const candidate = value;
    return candidate.kind === "artifact_delivery"
        && candidate.channel === "webui"
        && typeof candidate.filePath === "string"
        && typeof candidate.size === "number"
        && typeof candidate.source === "string";
}
export function createWebUiChunkDeliveryHandler(params) {
    let bufferedText = "";
    let toolOwnedResponseActive = false;
    return async (chunk) => {
        if (chunk.type === "text") {
            if (toolOwnedResponseActive)
                return;
            bufferedText += chunk.delta;
            return;
        }
        if (chunk.type === "tool_end") {
            const isolatedToolResponse = decideIsolatedToolResponse(chunk);
            if (isolatedToolResponse.kind === "artifact" && chunk.success && isWebUiArtifactDeliveryDetails(chunk.details)) {
                const details = chunk.details;
                const receipt = await deliverArtifactOnce({
                    runId: params.runId,
                    channel: "webui",
                    filePath: details.filePath,
                    channelTarget: params.sessionId,
                    sizeBytes: details.size,
                    ...(details.mimeType ? { mimeType: details.mimeType } : {}),
                    task: async () => {
                        const artifact = buildArtifactAccessDescriptor({
                            filePath: details.filePath,
                            sizeBytes: details.size,
                            ...(details.mimeType ? { mimeType: details.mimeType } : {}),
                        });
                        if (!artifact.ok || !artifact.url)
                            return undefined;
                        eventBus.emit("agent.artifact", {
                            sessionId: params.sessionId,
                            runId: params.runId,
                            url: artifact.url,
                            ...(artifact.previewUrl ? { previewUrl: artifact.previewUrl } : {}),
                            ...(artifact.downloadUrl ? { downloadUrl: artifact.downloadUrl } : {}),
                            previewable: artifact.previewable,
                            filePath: details.filePath,
                            fileName: basename(artifact.filePath),
                            mimeType: artifact.mimeType,
                            ...(details.caption ? { caption: details.caption } : {}),
                        });
                        return {
                            artifactDeliveries: [{
                                    toolName: chunk.toolName,
                                    channel: "webui",
                                    filePath: details.filePath,
                                    url: artifact.url,
                                    ...(artifact.previewUrl ? { previewUrl: artifact.previewUrl } : {}),
                                    ...(artifact.downloadUrl ? { downloadUrl: artifact.downloadUrl } : {}),
                                    previewable: artifact.previewable,
                                    mimeType: artifact.mimeType,
                                    sizeBytes: details.size,
                                    ...(details.caption ? { caption: details.caption } : {}),
                                }],
                        };
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
        }
        if (chunk.type === "done") {
            if (!bufferedText.trim())
                return;
            const deliveredText = bufferedText;
            bufferedText = "";
            return {
                textDeliveries: [{
                        channel: "webui",
                        text: deliveredText,
                        ...(params.deliveryKind ? { deliveryKind: params.deliveryKind } : {}),
                        ...(params.parentRunId ? { parentRunId: params.parentRunId } : {}),
                        ...(params.subSessionId ? { subSessionId: params.subSessionId } : {}),
                        ...(params.agentId ? { agentId: params.agentId } : {}),
                    }],
            };
        }
        if (chunk.type === "error") {
            if (toolOwnedResponseActive) {
                return;
            }
            bufferedText = "";
        }
    };
}
//# sourceMappingURL=chunk-delivery.js.map