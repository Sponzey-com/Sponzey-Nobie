import crypto from "node:crypto";
import { getDb } from "../db/index.js";
const REQUESTED_STATUSES = new Set(["requested"]);
const APPROVED_STATUSES = new Set(["approved_once", "approved_run"]);
export function stableStringify(value) {
    if (value === null || typeof value !== "object")
        return JSON.stringify(value);
    if (Array.isArray(value))
        return `[${value.map((item) => stableStringify(item)).join(",")}]`;
    const entries = Object.entries(value)
        .filter(([, entryValue]) => entryValue !== undefined)
        .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`).join(",")}}`;
}
export function hashApprovalParams(params) {
    return crypto.createHash("sha256").update(stableStringify(params)).digest("hex");
}
export function createApprovalRegistryRequest(input) {
    const now = input.now ?? Date.now();
    const id = input.id ?? crypto.randomUUID();
    const paramsHash = hashApprovalParams(input.params);
    const preview = safeJsonPreview(input.params);
    const metadataJson = input.metadata ? JSON.stringify(input.metadata) : null;
    const db = getDb();
    if (input.supersedePending ?? true) {
        db.prepare(`UPDATE approval_registry
       SET status = 'superseded', superseded_by = ?, updated_at = ?
       WHERE run_id = ?
         AND tool_name = ?
         AND status = 'requested'`).run(id, now, input.runId, input.toolName);
    }
    db.prepare(`INSERT INTO approval_registry
     (id, run_id, request_group_id, channel, channel_message_id, tool_name, risk_level, kind,
      status, params_hash, params_preview_json, requested_at, expires_at, consumed_at,
      decision_at, decision_by, decision_source, superseded_by, metadata_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'requested', ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, ?, ?, ?)`).run(id, input.runId, input.requestGroupId ?? null, input.channel, input.channelMessageId ?? null, input.toolName, input.riskLevel, input.kind, paramsHash, preview, now, input.expiresAt ?? null, metadataJson, now, now);
    return getApprovalRegistryRow(id);
}
export function getApprovalRegistryRow(id) {
    return getDb()
        .prepare("SELECT * FROM approval_registry WHERE id = ?")
        .get(id);
}
export function getLatestApprovalForRun(runId) {
    return getDb()
        .prepare(`SELECT *
       FROM approval_registry
       WHERE run_id = ?
       ORDER BY created_at DESC, id DESC
       LIMIT 1`)
        .get(runId);
}
export function getActiveApprovalForRun(runId) {
    return getDb()
        .prepare(`SELECT *
       FROM approval_registry
       WHERE run_id = ?
         AND status = 'requested'
       ORDER BY created_at DESC, id DESC
       LIMIT 1`)
        .get(runId);
}
export function findLatestApprovalByChannelMessage(params) {
    return getDb()
        .prepare(`SELECT *
       FROM approval_registry
       WHERE channel = ?
         AND channel_message_id = ?
       ORDER BY created_at DESC, id DESC
       LIMIT 1`)
        .get(params.channel, params.channelMessageId);
}
export function attachApprovalChannelMessage(approvalId, channelMessageId, now = Date.now()) {
    const result = getDb()
        .prepare(`UPDATE approval_registry
       SET channel_message_id = ?, updated_at = ?
       WHERE id = ?`)
        .run(channelMessageId, now, approvalId);
    return result.changes > 0;
}
export function expireApprovalRegistryRequest(approvalId, now = Date.now()) {
    const row = getApprovalRegistryRow(approvalId);
    if (!row)
        return { accepted: false, status: "missing", reason: "timeout" };
    if (row.status !== "requested")
        return { accepted: false, status: row.status, row };
    getDb().prepare(`UPDATE approval_registry
     SET status = 'expired', decision_at = ?, decision_source = 'timeout', updated_at = ?
     WHERE id = ?
       AND status = 'requested'`).run(now, now, approvalId);
    return { accepted: false, status: "expired", reason: "timeout", row: getApprovalRegistryRow(approvalId) };
}
export function resolveApprovalRegistryDecision(params) {
    const now = params.now ?? Date.now();
    const row = getApprovalRegistryRow(params.approvalId);
    if (!row)
        return { accepted: false, status: "missing" };
    if (row.expires_at !== null && row.expires_at <= now && row.status === "requested") {
        expireApprovalRegistryRequest(row.id, now);
        return { accepted: false, status: "expired", reason: "late", row: getApprovalRegistryRow(row.id) };
    }
    if (!REQUESTED_STATUSES.has(row.status)) {
        const reason = row.status === "consumed" ? "already_consumed" : row.status === "superseded" ? "superseded" : "late";
        return { accepted: false, status: row.status, reason, row };
    }
    const status = params.decision === "allow_run"
        ? "approved_run"
        : params.decision === "allow_once"
            ? "approved_once"
            : "denied";
    getDb().prepare(`UPDATE approval_registry
     SET status = ?, decision_at = ?, decision_by = ?, decision_source = ?, updated_at = ?
     WHERE id = ?
       AND status = 'requested'`).run(status, now, params.decisionBy ?? null, params.decisionSource, now, params.approvalId);
    return { accepted: true, status, decision: params.decision, row: getApprovalRegistryRow(params.approvalId) };
}
export function consumeApprovalRegistryDecision(approvalId, now = Date.now()) {
    const row = getApprovalRegistryRow(approvalId);
    if (!row)
        return { accepted: false, status: "missing" };
    if (row.expires_at !== null && row.expires_at <= now && row.status === "requested") {
        expireApprovalRegistryRequest(row.id, now);
        return { accepted: false, status: "expired", reason: "late", row: getApprovalRegistryRow(row.id) };
    }
    if (!APPROVED_STATUSES.has(row.status)) {
        const reason = row.status === "consumed" ? "already_consumed" : row.status === "superseded" ? "superseded" : "late";
        return { accepted: false, status: row.status, reason, row };
    }
    getDb().prepare(`UPDATE approval_registry
     SET status = 'consumed', consumed_at = ?, updated_at = ?
     WHERE id = ?
       AND status IN ('approved_once', 'approved_run')`).run(now, now, approvalId);
    return {
        accepted: true,
        status: "consumed",
        decision: row.status === "approved_run" ? "allow_run" : "allow_once",
        row: getApprovalRegistryRow(approvalId),
    };
}
export function describeLateApproval(row) {
    if (!row)
        return "처리할 승인 요청을 찾을 수 없습니다. 필요한 경우 요청을 다시 실행해 주세요.";
    switch (row.status) {
        case "expired":
            return "이 승인 요청은 이미 만료되었습니다. 안전을 위해 실행하지 않았습니다. 요청을 다시 실행해 새 승인을 받아 주세요.";
        case "consumed":
            return "이 승인 요청은 이미 사용되었습니다. 같은 승인은 다시 사용할 수 없습니다.";
        case "superseded":
            return "이 승인 요청은 더 새 요청으로 대체되었습니다. 최신 승인 요청에 응답해 주세요.";
        case "denied":
            return "이 승인 요청은 이미 거부되었습니다. 필요한 경우 요청을 다시 실행해 주세요.";
        case "approved_once":
        case "approved_run":
            return "이 승인 요청은 이미 승인 처리되었습니다. 중복 실행은 하지 않습니다.";
        case "requested":
            return "승인 요청이 아직 대기 중입니다. 최신 승인 메시지에서 다시 응답해 주세요.";
    }
}
function safeJsonPreview(value) {
    try {
        return stableStringify(value).slice(0, 2000);
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=approval-registry.js.map