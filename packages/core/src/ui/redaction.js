import { createHash } from "node:crypto";
import { basename } from "node:path";
const SECRET_KEY_PATTERN = /(api[_-]?key|token|secret|password|credential|authorization|auth[_-]?token)/iu;
const RAW_PAYLOAD_KEY_PATTERN = /raw[_-]?(body|response|html|payload)|provider[_-]?raw|htmlBody|apiBody/iu;
const RAW_HTML_PATTERN = /<!doctype\s+html|<html[\s>]|<body[\s>]|<script[\s>]/iu;
const LOCAL_PATH_PATTERN = /(?:\/Users\/[\w .@+-]+(?:\/[^\s"'<>]*)+|\/private\/[\w .@+-]+(?:\/[^\s"'<>]*)+|\/tmp\/[\w .@+-]+(?:\/[^\s"'<>]*)+|[A-Za-z]:\\[^\s"'<>]+(?:\\[^\s"'<>]+)*)/gu;
const SECRET_VALUE_PATTERNS = [
    /\bsk-[A-Za-z0-9_-]{16,}\b/gu,
    /\bxox[baprs]-[A-Za-z0-9-]{16,}\b/gu,
    /\bxapp-[A-Za-z0-9-]{16,}\b/gu,
    /\b\d{6,}:[A-Za-z0-9_-]{20,}\b/gu,
    /Bearer\s+[A-Za-z0-9._~+/=-]{12,}/giu,
    /([A-Za-z0-9_-]{12,})\.([A-Za-z0-9_-]{12,})\.([A-Za-z0-9_-]{12,})/gu,
];
function artifactIdForPath(path) {
    return `artifact:${createHash("sha256").update(path).digest("hex").slice(0, 12)}`;
}
function safePathReplacement(path, audience) {
    if (audience === "beginner" || audience === "advanced")
        return artifactIdForPath(path);
    return `[local-path:${basename(path)}]`;
}
function redactedRawPayload() {
    return "[redacted-raw-payload]";
}
function record(redactions, path, reason) {
    redactions.push({ path, reason });
}
function redactText(input, key, path, options, redactions) {
    if (!input)
        return input;
    if (RAW_PAYLOAD_KEY_PATTERN.test(key) || RAW_HTML_PATTERN.test(input)) {
        record(redactions, path, RAW_HTML_PATTERN.test(input) ? "raw_html" : "raw_payload");
        return redactedRawPayload();
    }
    if (SECRET_KEY_PATTERN.test(key)) {
        record(redactions, path, "secret");
        return "***MASKED***";
    }
    let output = input;
    for (const pattern of SECRET_VALUE_PATTERNS) {
        output = output.replace(pattern, (match) => {
            record(redactions, path, "secret");
            return match.startsWith("Bearer ") ? "Bearer ***" : "***MASKED***";
        });
    }
    output = output.replace(LOCAL_PATH_PATTERN, (match) => {
        record(redactions, path, "local_path");
        return safePathReplacement(match, options.audience);
    });
    return output;
}
function pathFor(parent, key) {
    return parent ? `${parent}.${key}` : key;
}
function redactRecursive(value, key, path, options, redactions) {
    if (RAW_PAYLOAD_KEY_PATTERN.test(key)) {
        record(redactions, path, "raw_payload");
        return redactedRawPayload();
    }
    if (typeof value === "string")
        return redactText(value, key, path, options, redactions);
    if (Array.isArray(value))
        return value.map((item, index) => redactRecursive(item, key, `${path}[${index}]`, options, redactions));
    if (value && typeof value === "object") {
        return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => {
            const childPath = pathFor(path, entryKey);
            return [entryKey, redactRecursive(entryValue, entryKey, childPath, options, redactions)];
        }));
    }
    return value;
}
export function redactUiValue(value, options) {
    const redactions = [];
    const redacted = redactRecursive(value, "", "", options, redactions);
    return { value: redacted, maskedCount: redactions.length, redactions };
}
//# sourceMappingURL=redaction.js.map