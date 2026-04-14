import { emitAssistantTextDelivery, resolveAssistantTextDeliveryOutcome, } from "./delivery.js";
import { describeAssistantTextDeliveryFailure, summarizeRawErrorActionHintForUser, summarizeRawErrorForUser } from "./recovery.js";
export function markRunCompleted(params) {
    const executingSummary = params.executingSummary ?? params.text ?? "응답 생성을 마쳤습니다.";
    const completedSummary = params.completedSummary ?? params.text ?? "실행을 완료했습니다.";
    params.dependencies.rememberRunSuccess({
        runId: params.runId,
        sessionId: params.sessionId,
        source: params.source,
        text: params.text,
        summary: params.summary,
    });
    params.dependencies.setRunStepStatus(params.runId, "executing", "completed", executingSummary);
    params.dependencies.setRunStepStatus(params.runId, "reviewing", "completed", params.reviewingSummary ?? params.summary);
    params.dependencies.setRunStepStatus(params.runId, "finalizing", "completed", params.finalizingSummary ?? "실행 결과를 저장했습니다.");
    params.dependencies.setRunStepStatus(params.runId, "completed", "completed", completedSummary);
    params.dependencies.updateRunStatus(params.runId, "completed", completedSummary, false);
    params.dependencies.appendRunEvent(params.runId, params.eventLabel ?? "실행 완료");
}
export async function completeRunWithAssistantMessage(params) {
    if (params.text) {
        const deliveryReceipt = await emitAssistantTextDelivery({
            runId: params.runId,
            sessionId: params.sessionId,
            text: params.text,
            source: params.source,
            onChunk: params.onChunk,
            ...(params.dependencies.onDeliveryError ? { onError: params.dependencies.onDeliveryError } : {}),
            ...(params.dependencies.deliveryDependencies
                ? { dependencies: params.dependencies.deliveryDependencies }
                : {}),
        });
        const deliveryOutcome = resolveAssistantTextDeliveryOutcome(deliveryReceipt);
        if (deliveryOutcome.hasDeliveryFailure) {
            params.dependencies.appendRunEvent(params.runId, describeAssistantTextDeliveryFailure({ source: params.source, outcome: deliveryOutcome }));
        }
    }
    const fallbackText = params.text || "실행을 완료했습니다.";
    markRunCompleted({
        runId: params.runId,
        sessionId: params.sessionId,
        source: params.source,
        text: params.text,
        summary: fallbackText,
        reviewingSummary: params.text || "응답을 정리했습니다.",
        dependencies: params.dependencies,
    });
}
export async function emitStandaloneAssistantMessage(params) {
    if (!params.text.trim())
        return;
    const deliveryReceipt = await emitAssistantTextDelivery({
        runId: params.runId,
        sessionId: params.sessionId,
        text: params.text,
        source: params.source,
        onChunk: params.onChunk,
        ...(params.dependencies.onDeliveryError ? { onError: params.dependencies.onDeliveryError } : {}),
        ...(params.dependencies.deliveryDependencies
            ? { dependencies: params.dependencies.deliveryDependencies }
            : {}),
    });
    const deliveryOutcome = resolveAssistantTextDeliveryOutcome(deliveryReceipt);
    if (deliveryOutcome.hasDeliveryFailure) {
        params.dependencies.appendRunEvent(params.runId, describeAssistantTextDeliveryFailure({ source: params.source, outcome: deliveryOutcome }));
    }
}
export async function moveRunToAwaitingUser(params) {
    const message = buildAwaitingUserMessage(params.awaitingUser);
    if (message) {
        await emitStandaloneAssistantMessage({
            runId: params.runId,
            sessionId: params.sessionId,
            text: message,
            source: params.source,
            onChunk: params.onChunk,
            dependencies: params.dependencies,
        });
    }
    const summary = params.awaitingUser.summary || "추가 입력이 필요해 자동 진행을 멈췄습니다.";
    params.dependencies.setRunStepStatus(params.runId, "reviewing", "completed", summary);
    params.dependencies.setRunStepStatus(params.runId, "awaiting_user", "running", summary);
    params.dependencies.updateRunStatus(params.runId, "awaiting_user", summary, true);
    params.dependencies.appendRunEvent(params.runId, "사용자 추가 입력 대기");
}
export async function moveRunToCancelledAfterStop(params) {
    const message = buildAwaitingUserMessage(params.cancellation);
    if (message) {
        await emitStandaloneAssistantMessage({
            runId: params.runId,
            sessionId: params.sessionId,
            text: message,
            source: params.source,
            onChunk: params.onChunk,
            dependencies: params.dependencies,
        });
    }
    const summary = params.cancellation.summary || "자동 진행을 중단하고 요청을 취소했습니다.";
    params.dependencies.rememberRunFailure({
        runId: params.runId,
        sessionId: params.sessionId,
        source: params.source,
        summary,
        detail: buildCancelledAfterStopDetail(params.cancellation),
        title: "cancelled_after_stop",
    });
    params.dependencies.setRunStepStatus(params.runId, "reviewing", "completed", summary);
    params.dependencies.setRunStepStatus(params.runId, "finalizing", "completed", "중단 결과를 사용자에게 안내했습니다.");
    params.dependencies.updateRunStatus(params.runId, "cancelled", summary, false);
    params.dependencies.appendRunEvent(params.runId, "자동 진행 중단 후 요청 취소");
}
export function buildAwaitingUserMessage(params) {
    const remainingItems = params.remainingItems?.filter((item) => item.trim()) ?? [];
    const lines = [
        params.userMessage?.trim() || params.summary.trim(),
        params.preview.trim() ? `현재까지 결과:\n${params.preview.trim()}` : "",
        remainingItems.length > 0 ? `남은 항목:\n- ${remainingItems.join("\n- ")}` : "",
        params.reason?.trim() ? `중단 사유: ${params.reason.trim()}` : "",
        summarizeRawErrorForUser(params.rawMessage) ? `오류 세부:\n${summarizeRawErrorForUser(params.rawMessage)}` : "",
        summarizeRawErrorActionHintForUser(params.rawMessage) ? `권장 조치:\n${summarizeRawErrorActionHintForUser(params.rawMessage)}` : "",
    ].filter(Boolean);
    return lines.join("\n\n");
}
function buildCancelledAfterStopDetail(params) {
    return [params.reason, params.rawMessage, params.userMessage, params.preview, params.remainingItems?.join("\n")].filter(Boolean).join("\n");
}
//# sourceMappingURL=finalization.js.map