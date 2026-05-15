const REDACTION_PATTERNS = [
    {
        reasonCode: "email_redacted",
        pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
        replacement: "[redacted-email]",
    },
    {
        reasonCode: "phone_redacted",
        pattern: /(?<!\d)(?:\+?\d{1,3}[-.\s]?)?(?:\(?\d{2,4}\)?[-.\s]?)?\d{3,4}[-.\s]?\d{4}(?!\d)/g,
        replacement: "[redacted-phone]",
    },
    {
        reasonCode: "api_key_redacted",
        pattern: /\b(?:sk|pk|api|key|token|secret)[-_]?[A-Za-z0-9]{12,}\b/gi,
        replacement: "[redacted-secret]",
    },
    {
        reasonCode: "credential_value_redacted",
        pattern: /\b(?:password|passwd|pwd|secret|credential|api[_-]?key|access[_-]?token)\b\s*[:=]\s*['"]?[^'",\s]+/gi,
        replacement: "[redacted-credential]",
    },
    {
        reasonCode: "absolute_path_redacted",
        pattern: /(?:\/Users\/[^\s'",]+|\/home\/[^\s'",]+|\/var\/[^\s'",]+|\/private\/[^\s'",]+|[A-Za-z]:\\[^\s'",]+)/g,
        replacement: "[redacted-path]",
    },
    {
        reasonCode: "internal_host_redacted",
        pattern: /\b(?:localhost|127\.0\.0\.1|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3})(?::\d{2,5})?\b/gi,
        replacement: "[redacted-host]",
    },
    {
        reasonCode: "channel_id_redacted",
        pattern: /\b(?:chat|channel|room|space|group|workspace)[_-]?id\s*[:=]\s*['"]?[\w:.-]{4,}/gi,
        replacement: "[redacted-channel-id]",
    },
];
export function redactNodeDefinitionSuggestionRequest(input) {
    const mode = resolveRedactionMode(input);
    if (mode === "disabled_for_local_model") {
        return {
            request: structuredClone(input.request),
            report: {
                mode,
                redactedFields: [],
                reasonCodes: [],
                warnings: [],
            },
        };
    }
    const redactedFields = new Set();
    const reasonCodes = new Set();
    const request = redactValue(input.request, "$", redactedFields, reasonCodes);
    const report = {
        mode,
        redactedFields: [...redactedFields].sort(),
        reasonCodes: [...reasonCodes].sort(),
        warnings: reasonCodes.size > 0
            ? [{
                    code: "redaction_applied",
                    message: "일부 민감해 보이는 값은 제안 요청 전에 가렸습니다.",
                }]
            : [],
    };
    return { request, report };
}
export function redactNodeDefinitionText(value) {
    let current = value;
    const reasonCodes = new Set();
    for (const pattern of REDACTION_PATTERNS) {
        const next = current.replace(pattern.pattern, () => {
            reasonCodes.add(pattern.reasonCode);
            return pattern.replacement;
        });
        current = next;
    }
    return { value: current, reasonCodes: [...reasonCodes].sort() };
}
function resolveRedactionMode(input) {
    if (input.mode === "strict")
        return "strict";
    if (input.workspaceStrict === true)
        return "strict";
    if (input.isLocalModel === true && input.mode === "disabled_for_local_model")
        return "disabled_for_local_model";
    if (input.isLocalModel === true)
        return "workspace_default";
    return "strict";
}
function redactValue(value, path, redactedFields, reasonCodes) {
    if (typeof value === "string") {
        const redacted = redactNodeDefinitionText(value);
        for (const reasonCode of redacted.reasonCodes)
            reasonCodes.add(reasonCode);
        if (redacted.reasonCodes.length > 0)
            redactedFields.add(path);
        return redacted.value;
    }
    if (Array.isArray(value)) {
        return value.map((item, index) => redactValue(item, `${path}[${index}]`, redactedFields, reasonCodes));
    }
    if (value && typeof value === "object") {
        const output = {};
        for (const [key, child] of Object.entries(value)) {
            output[key] = redactValue(child, `${path}.${key}`, redactedFields, reasonCodes);
        }
        return output;
    }
    return value;
}
//# sourceMappingURL=node-definition-redaction.js.map