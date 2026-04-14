export const SESSION_COMPACTION_TOKEN_THRESHOLD = 120_000;
export const SESSION_COMPACTION_MESSAGE_THRESHOLD = 40;
const DEFAULT_SNAPSHOT_SUMMARY_CHARS = 1_200;
function normalizeWhitespace(value) {
    return value.replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}
export function estimateContextTokens(value) {
    if (typeof value === "string")
        return Math.max(1, Math.ceil(value.length / 4));
    const text = value.map((message) => {
        if (typeof message.content === "string")
            return message.content;
        return message.content.map((block) => {
            if (block.type === "text")
                return block.text;
            if (block.type === "tool_result")
                return block.content;
            if (block.type === "tool_use")
                return `${block.name} ${JSON.stringify(block.input)}`;
            return "";
        }).join("\n");
    }).join("\n");
    return estimateContextTokens(text);
}
export function needsSessionCompaction(messages, totalTokens) {
    return totalTokens > SESSION_COMPACTION_TOKEN_THRESHOLD
        || messages.length > SESSION_COMPACTION_MESSAGE_THRESHOLD;
}
export function truncateSnapshotSummary(summary, maxChars = DEFAULT_SNAPSHOT_SUMMARY_CHARS) {
    const normalized = normalizeWhitespace(summary);
    if (normalized.length <= maxChars)
        return normalized;
    return `${normalized.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}
export function buildSessionCompactionSnapshot(input) {
    const pendingApprovals = input.pendingApprovals?.filter((item) => item.trim()) ?? [];
    const pendingDelivery = input.pendingDelivery?.filter((item) => item.trim()) ?? [];
    const activeTaskIds = new Set();
    if (input.requestGroupId?.trim())
        activeTaskIds.add(input.requestGroupId.trim());
    for (const taskId of input.activeTaskIds ?? []) {
        const trimmed = taskId.trim();
        if (trimmed)
            activeTaskIds.add(trimmed);
    }
    return {
        sessionId: input.sessionId,
        summary: truncateSnapshotSummary(input.summary),
        preservedFacts: [
            ...pendingApprovals.map((item) => `pending_approval:${item}`),
            ...pendingDelivery.map((item) => `pending_delivery:${item}`),
        ],
        activeTaskIds: [...activeTaskIds],
    };
}
export function hasBalancedToolUsePairs(messages) {
    const pendingToolUseIds = [];
    for (const message of messages) {
        if (!Array.isArray(message.content))
            continue;
        for (const block of message.content) {
            if (block.type === "tool_use")
                pendingToolUseIds.push(block.id);
            if (block.type === "tool_result") {
                const index = pendingToolUseIds.indexOf(block.tool_use_id);
                if (index >= 0)
                    pendingToolUseIds.splice(index, 1);
            }
        }
    }
    return pendingToolUseIds.length === 0;
}
//# sourceMappingURL=compaction.js.map