import { detectAvailableProvider, getDefaultModel, getProvider } from "../ai/index.js";
import { buildDeliveryProjection, buildScheduleIdentityProjection, buildSchedulePayloadProjection, toCanonicalJson, } from "../contracts/index.js";
const DEFAULT_TIMEOUT_MS = 2_000;
function comparisonProjection(contract) {
    // nobie-critical-decision-audit: schedules.comparison.contract_projection_only
    // Comparator input must remain contract-only. Raw prompt, display title, and candidate metadata are excluded.
    return {
        schemaVersion: contract.schemaVersion,
        identity: buildScheduleIdentityProjection(contract),
        time: contract.time,
        payload: buildSchedulePayloadProjection(contract.payload),
        delivery: buildDeliveryProjection(contract.delivery),
    };
}
function buildComparisonPrompt(params) {
    return [{
            role: "user",
            content: [
                "Incoming schedule contract:",
                toCanonicalJson(comparisonProjection(params.incoming)),
                "",
                "Candidate schedule contracts:",
                toCanonicalJson(params.candidates.map((candidate) => ({
                    id: candidate.id,
                    contract: comparisonProjection(candidate.contract),
                }))),
            ].join("\n"),
        }];
}
export function buildScheduleContractComparisonSystemPrompt() {
    return [
        "You are Nobie's isolated schedule-contract comparator.",
        "You are memoryless. Use only the provided JSON contracts.",
        "Do not compare natural-language prompt meaning. Compare structured time, payload, and delivery fields.",
        "Return valid JSON only.",
        "JSON shape:",
        "{",
        '  "decision": "same | different | clarify",',
        '  "candidateId": "required only when decision is same",',
        '  "reasonCode": "same_schedule_identity | different_payload | different_time | different_destination | target_ambiguous",',
        '  "userMessage": "short explanation"',
        "}",
        "Rules:",
        "- Choose same only when one candidate has the same schedule identity.",
        "- Choose different when all candidates clearly differ by time, payload, or delivery destination.",
        "- Choose clarify when more than one candidate is plausible or the structure is insufficient.",
        "- Never invent candidateId. Use only ids from the candidate list.",
    ].join("\n");
}
function extractJsonObject(text) {
    const withoutFence = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
    const start = withoutFence.indexOf("{");
    const end = withoutFence.lastIndexOf("}");
    if (start < 0 || end <= start)
        return null;
    return withoutFence.slice(start, end + 1);
}
export function parseScheduleContractComparisonResult(raw, allowedCandidateIds) {
    const json = extractJsonObject(raw);
    if (!json) {
        return {
            decision: "clarify",
            reasonCode: "invalid_ai_response",
            userMessage: "예약 비교 결과를 구조화할 수 없어 사용자의 확인이 필요합니다.",
        };
    }
    try {
        const parsed = JSON.parse(json);
        const decision = parsed.decision;
        if (decision !== "same" && decision !== "different" && decision !== "clarify") {
            return {
                decision: "clarify",
                reasonCode: "invalid_ai_response",
                userMessage: "예약 비교 결과가 올바르지 않아 사용자의 확인이 필요합니다.",
            };
        }
        const candidateId = typeof parsed.candidateId === "string"
            ? parsed.candidateId
            : typeof parsed.candidate_id === "string"
                ? parsed.candidate_id
                : undefined;
        if (decision === "same" && (!candidateId || !allowedCandidateIds.has(candidateId))) {
            return {
                decision: "clarify",
                reasonCode: "invalid_candidate_selection",
                userMessage: "비교 결과가 존재하지 않는 예약을 가리켜 사용자의 확인이 필요합니다.",
            };
        }
        const rawReasonCode = typeof parsed.reasonCode === "string"
            ? parsed.reasonCode
            : typeof parsed.reason_code === "string"
                ? parsed.reason_code
                : undefined;
        const reasonCode = normalizeReasonCode(rawReasonCode, decision);
        const userMessage = typeof parsed.userMessage === "string"
            ? parsed.userMessage
            : typeof parsed.user_message === "string"
                ? parsed.user_message
                : "예약 비교가 완료되었습니다.";
        return {
            decision,
            ...(candidateId && decision === "same" ? { candidateId } : {}),
            reasonCode,
            userMessage,
        };
    }
    catch {
        return {
            decision: "clarify",
            reasonCode: "invalid_ai_response",
            userMessage: "예약 비교 결과 JSON을 읽을 수 없어 사용자의 확인이 필요합니다.",
        };
    }
}
function normalizeReasonCode(value, decision) {
    if (value === "same_schedule_identity"
        || value === "different_payload"
        || value === "different_time"
        || value === "different_destination"
        || value === "target_ambiguous")
        return value;
    if (decision === "same")
        return "same_schedule_identity";
    if (decision === "different")
        return "different_payload";
    return "target_ambiguous";
}
export async function compareScheduleContractsWithAI(params) {
    if (params.candidates.length === 0) {
        return {
            decision: "different",
            reasonCode: "no_candidates",
            userMessage: "비교할 기존 예약 후보가 없습니다.",
        };
    }
    const model = params.model?.trim() || getDefaultModel();
    const providerId = params.providerId?.trim() || detectAvailableProvider();
    if (!model || !providerId) {
        return {
            decision: "clarify",
            reasonCode: "no_configured_provider",
            userMessage: "예약 비교에 사용할 AI 연결이 없어 사용자의 확인이 필요합니다.",
        };
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.max(250, params.timeoutMs ?? DEFAULT_TIMEOUT_MS));
    const provider = params.provider ?? getProvider(providerId);
    let raw = "";
    try {
        for await (const chunk of provider.chat({
            model,
            messages: buildComparisonPrompt({ incoming: params.incoming, candidates: params.candidates }),
            system: buildScheduleContractComparisonSystemPrompt(),
            tools: [],
            maxTokens: 260,
            signal: controller.signal,
        })) {
            if (chunk.type === "text_delta")
                raw += chunk.delta;
        }
    }
    catch (err) {
        if (controller.signal.aborted) {
            return {
                decision: "clarify",
                reasonCode: "comparator_timeout",
                userMessage: "예약 비교가 제한 시간 안에 끝나지 않아 사용자의 확인이 필요합니다.",
            };
        }
        return {
            decision: "clarify",
            reasonCode: "provider_error",
            userMessage: err instanceof Error ? err.message : "예약 비교 AI 호출이 실패했습니다.",
        };
    }
    finally {
        clearTimeout(timeout);
    }
    return parseScheduleContractComparisonResult(raw, new Set(params.candidates.map((candidate) => candidate.id)));
}
//# sourceMappingURL=comparison.js.map