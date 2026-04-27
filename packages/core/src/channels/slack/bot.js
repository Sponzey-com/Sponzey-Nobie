import { eventBus } from "../../events/index.js";
import { createLogger } from "../../logger/index.js";
import { cancelRootRun, getRootRun } from "../../runs/store.js";
import { startIngressRun } from "../../runs/ingress.js";
import { createInboundMessageRecord } from "../../runs/request-isolation.js";
import { recordMessageLedgerEvent } from "../../runs/message-ledger.js";
import { findChannelMessageRef, findLatestChannelMessageRefForThread, insertChannelMessageRef } from "../../db/index.js";
import { createSlackChunkDeliveryHandler } from "./chunk-delivery.js";
import { clearActiveSlackConversationForSession, handleSlackApprovalAction, handleSlackApprovalMessage, registerSlackApprovalHandler, setActiveSlackConversationForSession } from "./approval-handler.js";
import { SlackResponder } from "./responder.js";
import { getOrCreateSlackSession, resolveSlackSessionKey } from "./session.js";
const log = createLogger("channel:slack");
export function findSlackReplyTaskRef(params) {
    const exactMessageRef = findChannelMessageRef({
        source: "slack",
        externalChatId: params.channelId,
        externalMessageId: params.messageTs,
        externalThreadId: params.threadTs,
    });
    if (exactMessageRef)
        return exactMessageRef;
    if (params.threadTs === params.messageTs)
        return undefined;
    const threadRootRef = findChannelMessageRef({
        source: "slack",
        externalChatId: params.channelId,
        externalMessageId: params.threadTs,
        externalThreadId: params.threadTs,
    });
    if (threadRootRef)
        return threadRootRef;
    return findLatestChannelMessageRefForThread({
        source: "slack",
        externalChatId: params.channelId,
        externalThreadId: params.threadTs,
    });
}
export class SlackChannel {
    config;
    socket = null;
    runningRuns = new Map();
    sessionIds = new Map();
    seenInboundEvents = new Map();
    constructor(config) {
        this.config = config;
    }
    async start() {
        log.info(`Starting Slack channel (Socket Mode, allowedUsers=${this.config.allowedUserIds.length || "all"}, allowedChannels=${this.config.allowedChannelIds.length || "all"})`);
        registerSlackApprovalHandler({
            sendApprovalRequest: async ({ channelId, threadTs, runId, text }) => {
                const responder = new SlackResponder(this.config, channelId, threadTs);
                await responder.sendApprovalRequest(runId, text);
            },
        });
        const openResponse = await fetch("https://slack.com/api/apps.connections.open", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${this.config.appToken}`,
            },
        });
        const openPayload = await openResponse.json();
        if (!openResponse.ok || openPayload.ok !== true || !openPayload.url) {
            throw new Error(openPayload.error ?? "Slack Socket Mode 연결 URL을 가져오지 못했습니다.");
        }
        const SocketCtor = globalThis.WebSocket;
        if (!SocketCtor) {
            throw new Error("이 환경에서는 WebSocket 런타임을 사용할 수 없습니다.");
        }
        this.socket = new SocketCtor(openPayload.url);
        await new Promise((resolve, reject) => {
            if (!this.socket) {
                reject(new Error("Slack WebSocket 생성에 실패했습니다."));
                return;
            }
            const timer = setTimeout(() => reject(new Error("Slack Socket Mode 연결 시간이 초과되었습니다.")), 15_000);
            this.socket.addEventListener("open", () => {
                clearTimeout(timer);
                log.info("Slack Socket Mode connected");
                eventBus.emit("channel.connected", { channel: "slack", detail: { transport: "socket_mode" } });
                resolve();
            });
            this.socket.addEventListener("error", () => {
                clearTimeout(timer);
                reject(new Error("Slack Socket Mode 연결에 실패했습니다."));
            });
            this.socket.addEventListener("message", (event) => {
                void this.handleSocketMessage(String(event.data ?? "")).catch((error) => {
                    log.error(`Slack message handling failed: ${error instanceof Error ? error.message : String(error)}`);
                });
            });
        });
    }
    stop() {
        this.socket?.close();
        this.socket = null;
    }
    addSessionRun(sessionKey, runId) {
        const existing = this.runningRuns.get(sessionKey);
        if (existing) {
            existing.add(runId);
            return;
        }
        this.runningRuns.set(sessionKey, new Set([runId]));
    }
    removeSessionRun(sessionKey, runId) {
        const existing = this.runningRuns.get(sessionKey);
        if (!existing)
            return false;
        existing.delete(runId);
        if (existing.size === 0) {
            this.runningRuns.delete(sessionKey);
            return false;
        }
        return true;
    }
    isAllowedUser(userId) {
        return this.config.allowedUserIds.length === 0 || this.config.allowedUserIds.includes(userId);
    }
    isAllowedChannel(channelId) {
        return this.config.allowedChannelIds.length === 0 || this.config.allowedChannelIds.includes(channelId);
    }
    markInboundEventSeen(eventKey) {
        const now = Date.now();
        const previous = this.seenInboundEvents.get(eventKey);
        for (const [key, seenAt] of this.seenInboundEvents.entries()) {
            if (now - seenAt > 60_000)
                this.seenInboundEvents.delete(key);
        }
        if (typeof previous === "number" && now - previous < 60_000) {
            return true;
        }
        this.seenInboundEvents.set(eventKey, now);
        return false;
    }
    recordOutgoingMessageRef(params) {
        const run = getRootRun(params.runId);
        if (!run)
            return;
        insertChannelMessageRef({
            source: "slack",
            session_id: params.sessionId,
            root_run_id: params.runId,
            request_group_id: run.requestGroupId,
            external_chat_id: params.channelId,
            external_thread_id: params.threadTs,
            external_message_id: params.messageId,
            role: params.role,
            created_at: Date.now(),
        });
    }
    async handleSocketMessage(raw) {
        const envelope = JSON.parse(raw);
        if (envelope.envelope_id && this.socket) {
            this.socket.send(JSON.stringify({ envelope_id: envelope.envelope_id }));
        }
        if (envelope.payload?.type === "block_actions") {
            await this.handleBlockActions(envelope.payload);
            return;
        }
        const event = envelope.payload?.event;
        if (!event)
            return;
        if (event.bot_id)
            return;
        const eventType = event.type?.trim();
        if (eventType !== "message" && eventType !== "app_mention") {
            log.info(`Ignored Slack event type=${eventType ?? "unknown"}`);
            return;
        }
        if (eventType === "message" && event.subtype) {
            log.info(`Ignored Slack message subtype=${event.subtype}`);
            return;
        }
        const userId = event.user?.trim();
        const channelId = event.channel?.trim();
        const rawText = event.text?.trim() ?? "";
        const text = eventType === "app_mention"
            ? rawText.replace(/<@[^>]+>/g, "").trim()
            : rawText;
        const messageTs = event.ts?.trim();
        const threadTs = (event.thread_ts?.trim() || messageTs || "").trim();
        if (!userId || !channelId || !text || !messageTs || !threadTs)
            return;
        const inboundEventKey = `${channelId}:${messageTs}`;
        if (this.markInboundEventSeen(inboundEventKey)) {
            log.info(`Ignored duplicate Slack inbound event channel=${channelId} ts=${messageTs} type=${eventType}`);
            return;
        }
        if (!this.isAllowedUser(userId)) {
            log.warn(`Ignored Slack message from disallowed user=${userId} channel=${channelId}`);
            return;
        }
        if (!this.isAllowedChannel(channelId)) {
            log.warn(`Ignored Slack message from disallowed channel=${channelId} user=${userId}`);
            return;
        }
        log.info(`Accepted Slack message user=${userId} channel=${channelId} thread=${threadTs}`);
        const approvalHandled = await handleSlackApprovalMessage({
            channelId,
            threadTs,
            userId,
            text,
            reply: async (message) => {
                const responder = new SlackResponder(this.config, channelId, threadTs);
                await responder.sendReceipt(message);
            },
        });
        if (approvalHandled)
            return;
        const sessionKey = resolveSlackSessionKey(channelId, threadTs);
        const sessionId = getOrCreateSlackSession(sessionKey);
        this.sessionIds.set(sessionKey, sessionId);
        eventBus.emit("message.inbound", {
            source: "slack",
            sessionId,
            content: text,
            userId,
        });
        setActiveSlackConversationForSession(sessionId, channelId, userId, threadTs);
        const responder = new SlackResponder(this.config, channelId, threadTs);
        let startedRunId = "";
        const repliedTaskRef = findSlackReplyTaskRef({ channelId, messageTs, threadTs });
        try {
            if (repliedTaskRef) {
                const cancelled = cancelRootRun(repliedTaskRef.root_run_id);
                if (cancelled) {
                    log.info(`Reply override detected for Slack requestGroup=${repliedTaskRef.request_group_id}`);
                }
            }
            const onChunk = createSlackChunkDeliveryHandler({
                responder,
                sessionId,
                channelId,
                threadTs,
                getRunId: () => startedRunId || undefined,
                recordOutgoingMessageRef: (params) => this.recordOutgoingMessageRef(params),
                logError: (message) => log.error(message),
            });
            const { started, receipt } = startIngressRun({
                message: text,
                sessionId,
                ...(repliedTaskRef ? { requestGroupId: repliedTaskRef.request_group_id, forceRequestGroupReuse: true } : {}),
                model: undefined,
                source: "slack",
                inboundMessage: createInboundMessageRecord({
                    source: "slack",
                    sessionId,
                    channelEventId: inboundEventKey,
                    externalChatId: channelId,
                    externalThreadId: threadTs,
                    externalMessageId: messageTs,
                    userId,
                    rawText: text,
                }),
                onChunk,
            });
            startedRunId = started.runId;
            this.addSessionRun(sessionKey, started.runId);
            if (receipt.text.trim()) {
                const receiptMessageId = await responder.sendReceipt(receipt.text);
                const startedRun = getRootRun(started.runId);
                recordMessageLedgerEvent({
                    runId: started.runId,
                    requestGroupId: startedRun?.requestGroupId ?? started.runId,
                    sessionKey: sessionId,
                    threadKey: sessionKey,
                    channel: "slack",
                    eventKind: "fast_receipt_sent",
                    deliveryKey: `slack:receipt:${channelId}:${threadTs ?? "channel"}:${receiptMessageId}`,
                    idempotencyKey: `slack:receipt:${started.runId}:${receiptMessageId}`,
                    status: "sent",
                    summary: "Slack 접수 메시지를 전송했습니다.",
                    detail: {
                        channelId,
                        ...(threadTs ? { threadTs } : {}),
                        messageId: receiptMessageId,
                    },
                });
                this.recordOutgoingMessageRef({
                    sessionId,
                    runId: started.runId,
                    channelId,
                    threadTs,
                    messageId: receiptMessageId,
                    role: "assistant",
                });
            }
            void started.finished.finally(() => {
                const hasRemainingRuns = this.removeSessionRun(sessionKey, started.runId);
                if (!hasRemainingRuns) {
                    clearActiveSlackConversationForSession(sessionId);
                }
            });
        }
        catch (error) {
            clearActiveSlackConversationForSession(sessionId);
            const message = error instanceof Error ? error.message : String(error);
            log.error(`Slack ingress failed: ${message}`);
            await responder.sendError(message);
        }
    }
    async handleBlockActions(payload) {
        const action = payload.actions?.[0];
        const actionId = action?.action_id?.trim();
        const runId = action?.value?.trim();
        const userId = payload.user?.id?.trim();
        const channelId = payload.channel?.id?.trim() || payload.container?.channel_id?.trim();
        const threadTs = payload.message?.thread_ts?.trim()
            || payload.container?.thread_ts?.trim()
            || payload.message?.ts?.trim()
            || payload.container?.message_ts?.trim();
        if (!actionId || !runId || !userId || !channelId || !threadTs) {
            log.warn("Ignored Slack block action with incomplete payload");
            return;
        }
        const decision = actionId === "approval_allow_run"
            ? "allow_run"
            : actionId === "approval_allow_once"
                ? "allow_once"
                : actionId === "approval_deny"
                    ? "deny"
                    : null;
        if (!decision) {
            log.info(`Ignored Slack block action actionId=${actionId}`);
            return;
        }
        const responder = new SlackResponder(this.config, channelId, threadTs);
        const handled = await handleSlackApprovalAction({
            runId,
            decision,
            channelId,
            threadTs,
            userId,
            reply: async (message) => {
                await responder.sendReceipt(message);
            },
        });
        if (!handled) {
            log.warn(`Ignored Slack approval action runId=${runId} user=${userId} channel=${channelId}`);
        }
    }
}
//# sourceMappingURL=bot.js.map
