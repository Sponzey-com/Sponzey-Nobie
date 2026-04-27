export function isArtifactDeliveryResultDetails(value) {
    if (!value || typeof value !== "object")
        return false;
    const candidate = value;
    return (candidate.kind === "artifact_delivery" &&
        (candidate.channel === "telegram" ||
            candidate.channel === "webui" ||
            candidate.channel === "slack") &&
        typeof candidate.filePath === "string" &&
        typeof candidate.size === "number" &&
        typeof candidate.source === "string");
}
//# sourceMappingURL=types.js.map