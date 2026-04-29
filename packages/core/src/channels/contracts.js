export function defineChannelAdapter(adapter) {
    return adapter;
}
export function defineChannelCapabilities(capabilities) {
    return capabilities;
}
const INTERNAL_CHANNEL_SURFACES = new Set(["webui", "cli"]);
const BUILT_IN_CHANNEL_PROVIDERS = new Set([
    "telegram",
    "slack",
    "discord",
    "google_chat",
    "imessage",
    "kakaotalk",
]);
export function isInternalChannelSurface(source) {
    return INTERNAL_CHANNEL_SURFACES.has(source);
}
export function isBuiltInChannelProvider(source) {
    return BUILT_IN_CHANNEL_PROVIDERS.has(source);
}
export function isExternalChannelProvider(source) {
    return !isInternalChannelSurface(source);
}
export function resolveChannelSurface(source) {
    return isInternalChannelSurface(source) ? source : "external_provider";
}
export function normalizeChannelSource(source, fallback = "webui") {
    const trimmed = source?.trim();
    return trimmed ? trimmed : fallback;
}
export function resolveDeliveryReceiptStatus(input) {
    if (input.unsupportedCapability)
        return "unsupported_capability";
    if (input.blockedByPolicy)
        return "blocked_by_policy";
    if (input.rateLimited)
        return "rate_limited";
    if (input.failed)
        return "failed";
    if (input.partial)
        return "partial";
    if (input.delivered)
        return input.providerSupportsDelivered === false ? "sent" : "delivered";
    if (input.sent)
        return "sent";
    return "accepted";
}
export function isPositiveDeliveryReceipt(receipt) {
    return receipt.status === "accepted"
        || receipt.status === "sent"
        || receipt.status === "delivered"
        || receipt.status === "partial";
}
export function buildUnsupportedCapabilityReceipt(params) {
    return {
        channelId: params.channelId,
        provider: params.provider,
        connectionId: params.connectionId,
        target: params.target,
        status: "unsupported_capability",
        timestamp: params.timestamp ?? Date.now(),
        idempotencyKey: params.idempotencyKey,
        capability: params.capability,
    };
}
export function createRawPayloadRef(input) {
    const createdAt = input.createdAt ?? Date.now();
    const ref = input.ref?.trim();
    if (ref) {
        return {
            storage: "external_ref",
            redactionState: "externalized",
            provider: input.provider,
            createdAt,
            ref,
        };
    }
    if (Object.prototype.hasOwnProperty.call(input, "payload")) {
        return {
            storage: "redacted_inline",
            redactionState: "redacted",
            provider: input.provider,
            createdAt,
            preview: sanitizeChannelContractValue(input.payload),
        };
    }
    return {
        storage: "none",
        redactionState: "not_stored",
        provider: input.provider,
        createdAt,
    };
}
const SECRET_KEY_PATTERN = /token|secret|authorization|cookie|api[_-]?key|password|credential|raw[_-]?(body|response)|bot[_-]?token/i;
const SECRET_TEXT_PATTERNS = [
    [/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]"],
    [/xox[abpr]-[A-Za-z0-9-]+/gi, "xox*-redacted"],
    [/\b\d{6,}:[A-Za-z0-9_-]{20,}\b/g, "[redacted-telegram-token]"],
];
export function sanitizeChannelContractValue(value, options = {}) {
    const maxDepth = options.maxDepth ?? 6;
    const maxArrayItems = options.maxArrayItems ?? 50;
    const maxObjectKeys = options.maxObjectKeys ?? 80;
    const maxStringLength = options.maxStringLength ?? 2_000;
    function sanitizeNested(current, depth) {
        if (depth > maxDepth)
            return "[truncated-depth]";
        if (current === null || current === undefined)
            return null;
        if (typeof current === "string")
            return sanitizeString(current, maxStringLength);
        if (typeof current === "boolean")
            return current;
        if (typeof current === "number")
            return Number.isFinite(current) ? current : String(current);
        if (typeof current === "bigint")
            return current.toString();
        if (typeof current === "symbol" || typeof current === "function")
            return `[${typeof current}]`;
        if (Array.isArray(current)) {
            return current.slice(0, maxArrayItems).map((item) => sanitizeNested(item, depth + 1));
        }
        if (typeof current === "object") {
            const output = {};
            for (const [key, entryValue] of Object.entries(current).slice(0, maxObjectKeys)) {
                output[key] = SECRET_KEY_PATTERN.test(key)
                    ? "[redacted]"
                    : sanitizeNested(entryValue, depth + 1);
            }
            return output;
        }
        return String(current);
    }
    return sanitizeNested(value, 0);
}
function sanitizeString(value, maxLength) {
    const redacted = SECRET_TEXT_PATTERNS.reduce((next, [pattern, replacement]) => next.replace(pattern, replacement), value);
    if (redacted.length <= maxLength)
        return redacted;
    return `${redacted.slice(0, maxLength)}...[truncated]`;
}
//# sourceMappingURL=contracts.js.map