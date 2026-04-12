import { startRootRun } from "./start.js";
function detectIngressReceiptLanguage(message) {
    const hangulCount = (message.match(/[가-힣]/gu) ?? []).length;
    const latinCount = (message.match(/[A-Za-z]/g) ?? []).length;
    if (hangulCount > 0 && latinCount > 0)
        return "mixed";
    if (hangulCount > 0)
        return "ko";
    if (latinCount > 0)
        return "en";
    return "unknown";
}
// Ingress receipt stays generic on purpose so the request is acknowledged immediately
// without trying to interpret or complete the user's task in the channel layer.
export function buildIngressReceipt(message) {
    const language = detectIngressReceiptLanguage(message);
    if (language === "ko" || language === "mixed") {
        return {
            language,
            text: "요청을 접수했습니다. 분석을 시작합니다.",
        };
    }
    return {
        language,
        text: "Request received. Starting analysis.",
    };
}
// Ingress is responsible for fixing the external request identity before the
// heavier run loop begins. Downstream code should receive resolved identifiers.
export function resolveIngressStartParams(params) {
    return {
        ...params,
        runId: params.runId ?? crypto.randomUUID(),
        sessionId: params.sessionId ?? crypto.randomUUID(),
    };
}
// Ingress owns the immediate acknowledgement boundary.
// Downstream execution keeps using startRootRun, but channel/API entry points
// should start from this helper instead of assembling receipt logic themselves.
export function startIngressRun(params) {
    const resolved = resolveIngressStartParams(params);
    return {
        requestId: resolved.runId,
        sessionId: resolved.sessionId,
        source: resolved.source,
        receipt: buildIngressReceipt(resolved.message),
        started: startRootRun(resolved),
    };
}
//# sourceMappingURL=ingress.js.map