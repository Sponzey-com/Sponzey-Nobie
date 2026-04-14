function isArtifactDeliveryDetails(value) {
    if (!value || typeof value !== "object")
        return false;
    const candidate = value;
    return candidate.kind === "artifact_delivery"
        && (candidate.channel === "telegram" || candidate.channel === "webui" || candidate.channel === "slack")
        && typeof candidate.filePath === "string"
        && typeof candidate.size === "number"
        && typeof candidate.source === "string";
}
function hasExplicitFinalTextOwnership(value) {
    if (!value || typeof value !== "object")
        return false;
    const candidate = value;
    return candidate.responseOwnership === "final_text";
}
export function decideIsolatedToolResponse(chunk) {
    if (chunk.type !== "tool_end" || !chunk.success) {
        return { kind: "none" };
    }
    if (isArtifactDeliveryDetails(chunk.details)) {
        return { kind: "artifact" };
    }
    if (hasExplicitFinalTextOwnership(chunk.details)) {
        const text = chunk.output.trim();
        if (text) {
            return {
                kind: "text",
                text,
            };
        }
    }
    return { kind: "none" };
}
export function shouldTerminateRunAfterSuccessfulTool(chunk) {
    if (chunk.type !== "tool_end" || !chunk.success)
        return false;
    return decideIsolatedToolResponse(chunk).kind !== "none";
}
//# sourceMappingURL=isolated-tool-response.js.map