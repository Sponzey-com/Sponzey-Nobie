import { CONTRACT_SCHEMA_VERSION } from "./index.js";
function mapIntentType(value) {
    switch (value) {
        case "schedule_request":
            return "schedule_request";
        case "direct_answer":
            return "question";
        case "clarification":
            return "clarification";
        case "reject":
            return "impossible";
        default:
            return "execute_now";
    }
}
function inferActionType(envelope) {
    if (envelope.intent_type === "schedule_request") {
        if (envelope.schedule_spec.status === "needs_clarification")
            return "ask_user";
        if (envelope.schedule_spec.detected)
            return "create_schedule";
    }
    if (envelope.intent_type === "direct_answer")
        return "answer";
    if (envelope.intent_type === "clarification")
        return "ask_user";
    if (envelope.intent_type === "reject")
        return "none";
    return envelope.needs_tools ? "run_tool" : "answer";
}
function inferDeliveryMode(envelope, actionType) {
    if (envelope.delivery_mode === "direct")
        return "direct_artifact";
    if (actionType === "answer" || actionType === "ask_user" || actionType === "run_tool")
        return "reply";
    if (!envelope.destination.trim())
        return "reply";
    return "channel_message";
}
export function intentContractFromTaskIntentEnvelope(envelope) {
    const actionType = inferActionType(envelope);
    const target = {
        schemaVersion: CONTRACT_SCHEMA_VERSION,
        kind: envelope.preferred_target.trim() ? "extension" : "unknown",
        selector: envelope.target.trim() ? { description: envelope.target.trim() } : null,
        ...(envelope.preferred_target.trim() ? { id: envelope.preferred_target.trim() } : {}),
    };
    const delivery = {
        schemaVersion: CONTRACT_SCHEMA_VERSION,
        mode: inferDeliveryMode(envelope, actionType),
        channel: "current_session",
        ...(envelope.destination.trim() ? { rawText: envelope.destination.trim() } : {}),
    };
    return {
        schemaVersion: CONTRACT_SCHEMA_VERSION,
        intentType: mapIntentType(envelope.intent_type),
        actionType,
        target,
        delivery,
        constraints: envelope.complete_condition,
        requiresApproval: envelope.requires_approval,
        impossibility: envelope.intent_type === "reject"
            ? {
                reasonCode: "rejected_by_intake",
                message: envelope.normalized_english.trim() || "The request was rejected by intake.",
            }
            : null,
        ...(envelope.normalized_english.trim() ? { summary: envelope.normalized_english.trim() } : {}),
    };
}
//# sourceMappingURL=intake-adapter.js.map