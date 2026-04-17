import { eventBus } from "../../events/index.js";
import { getRootRun } from "../../runs/store.js";
import { attachApprovalChannelMessage, describeLateApproval, findLatestApprovalByChannelMessage, getLatestApprovalForRun, } from "../../runs/approval-registry.js";
const activeConversations = new Map();
const activeConversationRefs = new Map();
const pendingApprovals = new Map();
let detachSlackApprovalRequestListener = null;
let latestActiveConversation;
export function setActiveSlackConversationForSession(sessionId, channelId, userId, threadTs) {
    const conversation = { channelId, userId, threadTs };
    activeConversations.set(sessionId, conversation);
    activeConversationRefs.set(sessionId, (activeConversationRefs.get(sessionId) ?? 0) + 1);
    latestActiveConversation = conversation;
}
export function clearActiveSlackConversationForSession(sessionId) {
    const remaining = (activeConversationRefs.get(sessionId) ?? 1) - 1;
    if (remaining > 0) {
        activeConversationRefs.set(sessionId, remaining);
        return;
    }
    activeConversationRefs.delete(sessionId);
    activeConversations.delete(sessionId);
}
export function registerSlackApprovalHandler(messenger) {
    detachSlackApprovalRequestListener?.();
    const detachRequest = eventBus.on("approval.request", async ({ approvalId, runId, toolName, params, kind = "approval", guidance, resolve }) => {
        const run = getRootRun(runId);
        if (run?.source !== "slack")
            return;
        const target = activeConversations.get(run.sessionId) ?? latestActiveConversation;
        if (!target) {
            return;
        }
        const paramsPreview = JSON.stringify(params, null, 2).slice(0, 300);
        const text = [
            kind === "screen_confirmation" ? "*화면 조작 준비 확인이 필요합니다.*" : "*도구 실행 승인이 필요합니다.*",
            `도구: ${toolName}`,
            `파라미터:\n${paramsPreview}`,
            guidance ? `안내: ${guidance}` : "",
            "아래 버튼을 누르거나, 버튼이 보이지 않으면 이 스레드에 `approve`, `approve once`, `deny` 중 하나로 답해주세요.",
        ].filter(Boolean).join("\n\n");
        pendingApprovals.set(runId, {
            ...(approvalId ? { approvalId } : {}),
            requesterId: target.userId,
            channelId: target.channelId,
            threadTs: target.threadTs,
            toolName,
            kind,
            resolve,
        });
        const channelMessageId = slackApprovalChannelMessageId(target.channelId, target.threadTs);
        if (approvalId)
            attachApprovalChannelMessage(approvalId, channelMessageId);
        const sentTs = await messenger.sendApprovalRequest({
            channelId: target.channelId,
            threadTs: target.threadTs,
            runId,
            text,
        });
        if (approvalId && typeof sentTs === "string" && sentTs.trim()) {
            attachApprovalChannelMessage(approvalId, channelMessageId);
        }
    });
    const detachResolved = eventBus.on("approval.resolved", ({ runId }) => {
        pendingApprovals.delete(runId);
    });
    detachSlackApprovalRequestListener = () => {
        detachRequest();
        detachResolved();
    };
}
export function resetSlackApprovalStateForTest() {
    detachSlackApprovalRequestListener?.();
    detachSlackApprovalRequestListener = null;
    activeConversations.clear();
    activeConversationRefs.clear();
    pendingApprovals.clear();
    latestActiveConversation = undefined;
}
function resolveSlackApproval(params) {
    const pending = pendingApprovals.get(params.runId);
    if (!pending) {
        const row = getLatestApprovalForRun(params.runId);
        if (row) {
            return params.reply(describeLateApproval(row)).then(() => true);
        }
        return Promise.resolve(false);
    }
    if (pending.channelId !== params.channelId || pending.threadTs !== params.threadTs || pending.requesterId !== params.userId) {
        return Promise.resolve(false);
    }
    pendingApprovals.delete(params.runId);
    pending.resolve(params.decision, "user");
    eventBus.emit("approval.resolved", {
        ...(pending.approvalId ? { approvalId: pending.approvalId } : {}),
        runId: params.runId,
        decision: params.decision,
        toolName: pending.toolName,
        kind: pending.kind,
        reason: "user",
    });
    return params.reply(params.decision === "allow_run"
        ? "이 요청 전체를 승인했습니다."
        : params.decision === "allow_once"
            ? "이번 단계만 승인했습니다."
            : "요청을 거부하고 취소했습니다.").then(() => true);
}
export async function handleSlackApprovalMessage(params) {
    const normalized = params.text.trim().toLowerCase();
    const decision = normalized === "approve"
        ? "allow_run"
        : normalized === "approve once"
            ? "allow_once"
            : normalized === "deny"
                ? "deny"
                : null;
    if (!decision)
        return false;
    const entry = [...pendingApprovals.entries()].find(([, value]) => value.channelId === params.channelId
        && value.threadTs === params.threadTs
        && value.requesterId === params.userId);
    if (!entry) {
        const row = findLatestApprovalByChannelMessage({
            channel: "slack",
            channelMessageId: slackApprovalChannelMessageId(params.channelId, params.threadTs),
        });
        if (!row)
            return false;
        await params.reply(describeLateApproval(row));
        return true;
    }
    return resolveSlackApproval({
        runId: entry[0],
        decision,
        channelId: params.channelId,
        threadTs: params.threadTs,
        userId: params.userId,
        reply: params.reply,
    });
}
export async function handleSlackApprovalAction(params) {
    return resolveSlackApproval(params);
}
function slackApprovalChannelMessageId(channelId, threadTs) {
    return `slack:${channelId}:${threadTs}`;
}
//# sourceMappingURL=approval-handler.js.map