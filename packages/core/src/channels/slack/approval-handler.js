import { eventBus } from "../../events/index.js";
import { getRootRun } from "../../runs/store.js";
import { attachApprovalChannelMessage, describeLateApproval, findLatestApprovalByChannelMessage, getLatestApprovalForRun, } from "../../runs/approval-registry.js";
import { recordMessageLedgerEvent } from "../../runs/message-ledger.js";
import { recordLatencyMetric } from "../../observability/latency.js";
import { appendApprovalAggregateItem, buildApprovalAggregateText, resolveApprovalAggregate, } from "../approval-aggregation.js";
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
    const detachRequest = eventBus.on("approval.request", async ({ approvalId, runId, parentRunId, subSessionId, agentId, teamId, toolName, params, kind = "approval", guidance, riskSummary, resolve }) => {
        const run = getRootRun(runId);
        if (run?.source !== "slack")
            return;
        const target = activeConversations.get(run.sessionId) ?? latestActiveConversation;
        if (!target) {
            return;
        }
        const observedAt = Date.now();
        const paramsPreview = JSON.stringify(params, null, 2).slice(0, 300);
        const existing = pendingApprovals.get(runId);
        const aggregated = appendApprovalAggregateItem(existing?.context, {
            ...(approvalId ? { approvalId } : {}),
            runId,
            ...(parentRunId ? { parentRunId } : {}),
            ...(subSessionId ? { subSessionId } : {}),
            ...(agentId ? { agentId } : {}),
            ...(teamId ? { teamId } : {}),
            toolName,
            kind,
            ...(riskSummary ? { riskSummary } : {}),
            ...(guidance ? { guidance } : {}),
            paramsPreview,
            resolve,
        }, target.userId, observedAt);
        const text = buildApprovalAggregateText({ context: aggregated.context, channel: "slack" });
        pendingApprovals.set(runId, {
            requesterId: target.userId,
            channelId: target.channelId,
            threadTs: target.threadTs,
            context: aggregated.context,
        });
        if (existing && aggregated.appended && aggregated.aggregationLatencyMs !== null) {
            recordLatencyMetric({
                name: "approval_aggregation_latency_ms",
                durationMs: aggregated.aggregationLatencyMs,
                runId,
                sessionId: run.sessionId,
                detail: {
                    channel: "slack",
                    approvalCount: aggregated.context.items.length,
                    toolName,
                    kind,
                    approvalId: approvalId ?? null,
                },
            });
        }
        recordMessageLedgerEvent({
            runId,
            ...(parentRunId ? { parentRunId } : {}),
            ...(subSessionId ? { subSessionId } : {}),
            ...(agentId ? { agentId } : {}),
            ...(teamId ? { teamId } : {}),
            channel: "slack",
            eventKind: existing ? "approval_aggregated" : "approval_requested",
            deliveryKind: "approval",
            status: "pending",
            summary: existing ? "Slack 승인 요청을 기존 pending 항목에 집계했습니다." : "Slack 승인 요청을 전송했습니다.",
            detail: {
                approvalId: approvalId ?? null,
                approvalCount: aggregated.context.items.length,
                aggregationLatencyMs: aggregated.aggregationLatencyMs,
                toolName,
                kind,
                riskSummary: riskSummary ?? null,
            },
        });
        const channelMessageId = slackApprovalChannelMessageId(target.channelId, target.threadTs);
        if (approvalId)
            attachApprovalChannelMessage(approvalId, channelMessageId);
        if (existing && messenger.updateApprovalRequest) {
            await messenger.updateApprovalRequest({ channelId: target.channelId, threadTs: target.threadTs, runId, text });
        }
        else if (!existing) {
            const sentTs = await messenger.sendApprovalRequest({
                channelId: target.channelId,
                threadTs: target.threadTs,
                runId,
                text,
            });
            if (approvalId && typeof sentTs === "string" && sentTs.trim()) {
                attachApprovalChannelMessage(approvalId, channelMessageId);
            }
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
    const resolvedItems = resolveApprovalAggregate(pending.context, params.decision, "user");
    for (const item of resolvedItems) {
        eventBus.emit("approval.resolved", {
            ...(item.approvalId ? { approvalId: item.approvalId } : {}),
            runId: params.runId,
            decision: params.decision,
            toolName: item.toolName,
            kind: item.kind,
            reason: "user",
        });
    }
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