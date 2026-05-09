const DEFAULT_MAX_MESSAGE_LENGTH = 4000;
export function resolveChannelDeliveryFallbackPlan(input) {
    const maxLength = resolveMaxMessageLength(input);
    const text = input.message.text ?? "";
    const textParts = splitTextForChannel(text, maxLength);
    const issues = [];
    const notices = [];
    const unsupportedCapabilities = new Set();
    let action = "send_as_is";
    let artifactMode = "none";
    if (text.length > maxLength) {
        switch (input.message.chunkPolicy.mode) {
            case "summarize_then_link":
                action = "summarize_then_link";
                notices.push("Message exceeds the channel length limit; send a summary with an artifact link.");
                break;
            case "none":
                action = "download_link";
                notices.push("Message exceeds the channel length limit; deliver the full content as a downloadable artifact.");
                break;
            case "provider_default":
            case "split":
                action = "split_text";
                notices.push("Message exceeds the channel length limit; split it into channel-safe parts.");
                break;
        }
    }
    for (const capability of resolveRequestedCapabilities(input)) {
        if (!isCapabilitySupported(input.capabilities, capability)) {
            unsupportedCapabilities.add(capability);
            issues.push(buildUnsupportedCapabilityIssue(capability));
        }
    }
    const attachments = input.message.attachments ?? [];
    if (attachments.length > 0) {
        const mode = resolveArtifactMode({
            attachments,
            capabilities: input.capabilities,
            inlinePreviewSupported: input.inlinePreviewSupported === true,
        });
        artifactMode = mode;
        if (mode === "native_file") {
            action = action === "send_as_is" ? "native_file" : action;
            notices.push("Artifacts can be delivered through the channel file capability.");
        }
        else if (mode === "download_link" || mode === "inline_preview") {
            action = action === "send_as_is" ? "download_link" : action;
            notices.push("Artifacts will be delivered as a safe link because native file delivery is unavailable or not required.");
        }
        else {
            unsupportedCapabilities.add("supportsFiles");
            issues.push(buildUnsupportedCapabilityIssue("supportsFiles"));
        }
    }
    const requiresExplicitApproval = input.artifactSensitivity === "sensitive"
        || input.capabilities.manualConfirmationRequired === true
        || (attachments.length > 0 && input.message.deliveryMode === "artifact" && input.message.redactionPolicy === "strict");
    if (requiresExplicitApproval) {
        notices.push("Sensitive or locally mediated artifacts require explicit approval before delivery.");
    }
    if (unsupportedCapabilities.size > 0 && action === "send_as_is") {
        action = "unsupported_capability";
    }
    return {
        action,
        textParts,
        notices: uniqueValues(notices),
        issues: dedupeIssues(issues),
        artifactMode,
        requiresExplicitApproval,
        unsupportedCapabilities: [...unsupportedCapabilities],
    };
}
export function splitTextForChannel(text, maxLength) {
    const safeMax = Math.max(1, Math.floor(maxLength || DEFAULT_MAX_MESSAGE_LENGTH));
    if (text.length <= safeMax)
        return text ? [text] : [];
    const parts = [];
    let remaining = text;
    while (remaining.length > safeMax) {
        const slice = remaining.slice(0, safeMax);
        const breakAt = findBreakPoint(slice, safeMax);
        const part = remaining.slice(0, breakAt).trimEnd();
        parts.push(part || remaining.slice(0, safeMax));
        remaining = remaining.slice(breakAt).trimStart();
    }
    if (remaining.length > 0)
        parts.push(remaining);
    return parts;
}
export function describeUnsupportedCapability(capability) {
    switch (capability) {
        case "supportsThreads":
            return "This channel does not support threads. The reply will be sent in the main conversation.";
        case "supportsReplies":
            return "This channel does not support direct replies. The response will be sent as a normal message.";
        case "supportsEdits":
            return "This channel does not support message edits. A new corrected message is required.";
        case "supportsDeletes":
            return "This channel does not support message deletion through Nobie.";
        case "supportsButtons":
            return "This channel does not support interactive buttons. Nobie must use a text fallback or Web UI approval.";
        case "supportsFiles":
            return "This channel does not support native file delivery. Nobie must use a download link or another channel.";
        case "supportsTypingIndicator":
            return "This channel does not support typing indicators. Progress must be shown with normal status messages.";
        default:
            return capability
                ? `This channel does not support ${capability}.`
                : "This channel does not support the requested delivery capability.";
    }
}
export function buildCapabilityFallbackNotice(receipt) {
    if (receipt.status !== "unsupported_capability")
        return undefined;
    return {
        title: "Unsupported channel capability",
        message: receipt.errorMessage ?? describeUnsupportedCapability(receipt.capability),
        severity: "warning",
    };
}
function resolveMaxMessageLength(input) {
    return input.message.chunkPolicy.maxLength
        ?? input.capabilities.maxMessageLength
        ?? DEFAULT_MAX_MESSAGE_LENGTH;
}
function resolveRequestedCapabilities(input) {
    const requested = new Set(input.requestedCapabilities ?? []);
    if ((input.message.actions?.length ?? 0) > 0)
        requested.add("supportsButtons");
    if ((input.message.attachments?.length ?? 0) > 0)
        requested.add("supportsFiles");
    if (input.message.threadPolicy.mode !== "none")
        requested.add("supportsThreads");
    return [...requested];
}
function isCapabilitySupported(capabilities, capability) {
    if (!Object.prototype.hasOwnProperty.call(capabilities, capability))
        return false;
    return capabilities[capability] === true;
}
function buildUnsupportedCapabilityIssue(capability) {
    return {
        code: `unsupported_capability:${capability}`,
        severity: "warning",
        capability,
        message: describeUnsupportedCapability(capability),
    };
}
function resolveArtifactMode(input) {
    if (input.capabilities.supportsFiles)
        return "native_file";
    if (input.inlinePreviewSupported && input.attachments.every((attachment) => attachment.kind === "image")) {
        return "inline_preview";
    }
    if (input.attachments.every((attachment) => Boolean(attachment.url || attachment.contentRef))) {
        return "download_link";
    }
    return "none";
}
function findBreakPoint(text, maxLength) {
    const preferred = [
        text.lastIndexOf("\n\n"),
        text.lastIndexOf("\n"),
        text.lastIndexOf(". "),
        text.lastIndexOf(" "),
    ].filter((index) => index > 0);
    const breakAt = preferred.find((index) => index >= Math.floor(maxLength * 0.5));
    return breakAt && breakAt > 0 ? breakAt + 1 : maxLength;
}
function uniqueValues(values) {
    return [...new Set(values)];
}
function dedupeIssues(issues) {
    const seen = new Set();
    return issues.filter((issue) => {
        if (seen.has(issue.code))
            return false;
        seen.add(issue.code);
        return true;
    });
}
//# sourceMappingURL=delivery-fallback.js.map