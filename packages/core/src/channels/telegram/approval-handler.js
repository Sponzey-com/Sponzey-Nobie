import { eventBus } from "../../events/index.js";
import { createLogger } from "../../logger/index.js";
import { getRootRun } from "../../runs/store.js";
import { attachApprovalChannelMessage, describeLateApproval, getLatestApprovalForRun } from "../../runs/approval-registry.js";
import { buildApprovalKeyboard, buildResultKeyboard } from "./keyboards.js";
const log = createLogger("channel:telegram:approval");
// Map from runId → pending approval data
const pending = new Map();
// Map from sessionId → active chat info (set by bot.ts before runAgent)
export const activeChats = new Map();
const activeChatRefs = new Map();
// Most recent active chat (for single-user cases when we don't have sessionId in event)
let latestActiveChat;
let detachTelegramApprovalRequestListener = null;
export function setActiveChatForSession(sessionId, chatId, userId, threadId) {
    const chat = { chatId, userId, ...(threadId !== undefined ? { threadId } : {}) };
    activeChats.set(sessionId, chat);
    activeChatRefs.set(sessionId, (activeChatRefs.get(sessionId) ?? 0) + 1);
    latestActiveChat = chat;
}
export function clearActiveChatForSession(sessionId) {
    const remaining = (activeChatRefs.get(sessionId) ?? 1) - 1;
    if (remaining > 0) {
        activeChatRefs.set(sessionId, remaining);
        return;
    }
    activeChatRefs.delete(sessionId);
    activeChats.delete(sessionId);
}
export function registerApprovalHandler(bot) {
    detachTelegramApprovalRequestListener?.();
    const detachRequest = eventBus.on("approval.request", async ({ approvalId, runId, toolName, params, kind = "approval", guidance, resolve }) => {
        const run = getRootRun(runId);
        if (run?.source !== "telegram") {
            return;
        }
        const target = (run ? activeChats.get(run.sessionId) : undefined) ?? latestActiveChat;
        if (target === undefined) {
            log.warn(`approval.request for runId=${runId} but no active chat`);
            return;
        }
        const paramsStr = JSON.stringify(params, null, 2).slice(0, 300);
        const text = `${kind === "screen_confirmation" ? "🖥️ 화면 조작 준비 확인" : "🔐 도구 실행 승인 요청"}\n\n` +
            `도구: ${toolName}\n` +
            `파라미터:\n${paramsStr}\n\n` +
            `${guidance ? `${guidance}\n\n` : ""}` +
            `${kind === "screen_confirmation" ? "준비가 끝났으면 계속 진행할 수 있습니다." : "허용하시겠습니까?"}`;
        let sentMsgId;
        try {
            const keyboard = buildApprovalKeyboard(runId);
            const sendOpts = target.threadId !== undefined
                ? { reply_markup: keyboard, message_thread_id: target.threadId }
                : { reply_markup: keyboard };
            const msg = await bot.api.sendMessage(target.chatId, text, sendOpts);
            sentMsgId = msg.message_id;
        }
        catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            log.error(`Failed to send approval message: ${errMsg}`);
            return;
        }
        if (approvalId) {
            attachApprovalChannelMessage(approvalId, telegramApprovalChannelMessageId(target.chatId, target.threadId, sentMsgId));
        }
        pending.set(runId, {
            ...(approvalId ? { approvalId } : {}),
            resolve,
            chatId: target.chatId,
            messageId: sentMsgId,
            requesterId: target.userId,
            toolName,
            kind,
            timeout: null,
        });
    });
    const detachResolved = eventBus.on("approval.resolved", ({ runId }) => {
        const entry = pending.get(runId);
        if (entry?.timeout)
            clearTimeout(entry.timeout);
        pending.delete(runId);
    });
    detachTelegramApprovalRequestListener = () => {
        detachRequest();
        detachResolved();
    };
    bot.on("callback_query:data", async (ctx) => {
        const data = ctx.callbackQuery.data;
        const from = ctx.from;
        if (data === "noop") {
            await ctx.answerCallbackQuery();
            return;
        }
        const approveOnceMatch = /^approve:([^:]+):once$/.exec(data);
        const approveAllMatch = /^approve:([^:]+):all$/.exec(data);
        const denyMatch = /^deny:([^:]+)$/.exec(data);
        const runId = approveOnceMatch?.[1] ?? approveAllMatch?.[1] ?? denyMatch?.[1];
        if (runId === undefined) {
            await ctx.answerCallbackQuery();
            return;
        }
        const entry = pending.get(runId);
        if (entry === undefined) {
            await ctx.answerCallbackQuery(describeLateApproval(getLatestApprovalForRun(runId)));
            return;
        }
        if (from.id !== entry.requesterId) {
            await ctx.answerCallbackQuery("⚠️ 권한 없음: 요청자만 응답할 수 있습니다.");
            return;
        }
        if (entry.timeout)
            clearTimeout(entry.timeout);
        pending.delete(runId);
        const decision = approveAllMatch !== null
            ? "allow_run"
            : approveOnceMatch !== null
                ? "allow_once"
                : "deny";
        const username = from.first_name ?? from.username ?? String(from.id);
        const resultLabel = entry.kind === "screen_confirmation"
            ? decision === "allow_run"
                ? `✅ ${username}이 준비 완료 후 전체 진행`
                : decision === "allow_once"
                    ? `🔹 ${username}이 이번 단계 진행 확인`
                    : `❌ ${username}이 준비 미완료로 요청 취소`
            : decision === "allow_run"
                ? `✅ ${username}이 이 요청 전체를 승인함`
                : decision === "allow_once"
                    ? `🔹 ${username}이 이번 단계만 승인함`
                    : `❌ ${username}이 거부하고 요청을 취소함`;
        try {
            await bot.api.editMessageReplyMarkup(entry.chatId, entry.messageId, {
                reply_markup: buildResultKeyboard(resultLabel),
            });
        }
        catch {
            // best-effort
        }
        await ctx.answerCallbackQuery(entry.kind === "screen_confirmation"
            ? decision === "allow_run"
                ? "✅ 준비 완료 후 전체 진행"
                : decision === "allow_once"
                    ? "🔹 이번 단계 진행"
                    : "❌ 준비 미완료, 취소"
            : decision === "allow_run"
                ? "✅ 이 요청 전체 승인"
                : decision === "allow_once"
                    ? "🔹 이번 단계 승인"
                    : "❌ 거부 후 취소");
        eventBus.emit("approval.resolved", { ...(entry.approvalId ? { approvalId: entry.approvalId } : {}), runId, decision, toolName: entry.toolName, kind: entry.kind, reason: "user" });
        entry.resolve(decision, "user");
    });
}
export function resetTelegramApprovalStateForTest() {
    detachTelegramApprovalRequestListener?.();
    detachTelegramApprovalRequestListener = null;
    for (const entry of pending.values()) {
        if (entry.timeout)
            clearTimeout(entry.timeout);
    }
    pending.clear();
    activeChats.clear();
    activeChatRefs.clear();
    latestActiveChat = undefined;
}
function telegramApprovalChannelMessageId(chatId, threadId, messageId) {
    return `telegram:${chatId}:${threadId ?? "main"}:${messageId}`;
}
//# sourceMappingURL=approval-handler.js.map