import { buildUnsupportedCapabilityReceipt, createRawPayloadRef, defineChannelAdapter, defineChannelCapabilities, resolveDeliveryReceiptStatus, } from "../contracts.js";
import { TelegramChannel } from "./bot.js";
import { getActiveTelegramChannel, getTelegramRuntimeStatus, setActiveTelegramChannel, setTelegramRuntimeError, stopActiveTelegramChannel, } from "./runtime.js";
const DEFAULT_CHANNEL_ID = "telegram:primary";
const DEFAULT_CONNECTION_ID = "telegram:primary";
const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;
const TELEGRAM_MAX_ATTACHMENT_SIZE_BYTES = 50 * 1024 * 1024;
const DEFAULT_CONTINUATION_LOOKUP_WINDOW_MS = 24 * 60 * 60 * 1000;
export function buildTelegramCapabilityManifest() {
    return defineChannelCapabilities({
        provider: "telegram",
        connectionKind: "bot_api",
        supportsThreads: true,
        supportsReplies: true,
        supportsEdits: true,
        supportsDeletes: false,
        supportsReactions: false,
        supportsButtons: true,
        supportsModals: false,
        supportsFiles: true,
        supportsImages: true,
        supportsTypingIndicator: true,
        maxMessageLength: TELEGRAM_MAX_MESSAGE_LENGTH,
        maxAttachmentSizeBytes: TELEGRAM_MAX_ATTACHMENT_SIZE_BYTES,
        rateLimitPolicy: { strategy: "provider_default" },
        requiresWebhook: false,
        requiresLocalBridge: false,
        requiresUserSession: false,
        riskLevel: "low",
        deliveryStates: {
            supportsAccepted: true,
            supportsSent: true,
            supportsDelivered: false,
            supportsReadReceipt: false,
        },
    });
}
export function resolveTelegramConnectionPolicy(input) {
    const mode = input.mode ?? "polling";
    if (mode === "webhook") {
        return {
            mode,
            supported: false,
            canStart: false,
            healthStatus: "failed",
            reason: "webhook_unsupported",
            message: "Telegram webhook mode is not configured in this runtime; use polling.",
        };
    }
    if (!input.config?.botToken?.trim()) {
        return {
            mode,
            supported: true,
            canStart: false,
            healthStatus: "failed",
            reason: "missing_token",
            message: "Telegram bot token is missing.",
        };
    }
    if (input.activePolling === true) {
        return {
            mode,
            supported: true,
            canStart: false,
            healthStatus: "degraded",
            reason: "duplicate_polling",
            message: "Telegram polling runtime is already active.",
        };
    }
    return {
        mode,
        supported: true,
        canStart: true,
        healthStatus: "healthy",
        reason: "ready",
        message: "Telegram polling runtime is ready.",
    };
}
export function validateTelegramWebhookSecretToken(input) {
    const configured = input.configuredSecret?.trim();
    const received = input.receivedSecret?.trim();
    if (!configured)
        return { valid: false, reason: "missing_configured_secret" };
    if (!received)
        return { valid: false, reason: "missing_received_secret" };
    if (configured !== received)
        return { valid: false, reason: "mismatch" };
    return { valid: true, reason: "matched" };
}
export function normalizeTelegramInboundUpdate(rawPayload, options = {}) {
    const update = asTelegramUpdate(rawPayload);
    const message = update.message ?? update.edited_message;
    if (!message?.message_id || !message.chat?.id || !message.from?.id)
        return [];
    const timestamp = resolveTelegramTimestamp(message, options.now);
    const threadId = toOptionalString(message.message_thread_id ?? message.reply_to_message?.message_thread_id);
    const replyToMessageId = toOptionalString(message.reply_to_message?.message_id);
    const chatId = String(message.chat.id);
    const messageId = String(message.message_id);
    const sender = normalizeTelegramUser(message.from);
    const text = normalizeTelegramMessageText(message);
    return [{
            channelId: options.channelId ?? DEFAULT_CHANNEL_ID,
            provider: "telegram",
            connectionId: options.connectionId ?? DEFAULT_CONNECTION_ID,
            messageId,
            ...(threadId ? { threadId } : {}),
            ...(replyToMessageId ? { replyToMessageId } : {}),
            sender,
            room: normalizeTelegramRoom(message.chat),
            text,
            attachments: normalizeTelegramAttachments(message),
            mentions: normalizeTelegramMentions(text, [...(message.entities ?? []), ...(message.caption_entities ?? [])]),
            timestamp,
            rawPayloadRef: createRawPayloadRef({ provider: "telegram", payload: rawPayload, createdAt: timestamp }),
            ...(replyToMessageId
                ? { continuationContext: { parentMessageId: replyToMessageId, source: "reply" } }
                : {}),
            dedupeKey: `telegram:${chatId}:${threadId ?? "main"}:${messageId}`,
        }];
}
export function normalizeTelegramInteractionUpdate(rawPayload, options = {}) {
    const update = asTelegramUpdate(rawPayload);
    const callback = update.callback_query;
    if (!callback?.id || !callback.from?.id)
        return [];
    const message = callback.message;
    const timestamp = message ? resolveTelegramTimestamp(message, options.now) : options.now?.() ?? Date.now();
    const parsedAction = parseTelegramCallbackData(callback.data);
    const threadId = toOptionalString(message?.message_thread_id ?? message?.reply_to_message?.message_thread_id);
    return [{
            channelId: options.channelId ?? DEFAULT_CHANNEL_ID,
            provider: "telegram",
            connectionId: options.connectionId ?? DEFAULT_CONNECTION_ID,
            interactionId: callback.id,
            kind: parsedAction.kind,
            sender: normalizeTelegramUser(callback.from),
            timestamp,
            rawPayloadRef: createRawPayloadRef({ provider: "telegram", payload: rawPayload, createdAt: timestamp }),
            ...(message?.message_id ? { messageId: String(message.message_id) } : {}),
            ...(threadId ? { threadId } : {}),
            ...(message?.chat ? { room: normalizeTelegramRoom(message.chat) } : {}),
            ...(parsedAction.actionId ? { actionId: parsedAction.actionId } : {}),
            ...(callback.data ? { value: callback.data } : {}),
            ...(parsedAction.approvalDecision ? { approvalDecision: parsedAction.approvalDecision } : {}),
            ...(parsedAction.correlationId ? { correlationId: parsedAction.correlationId } : {}),
        }];
}
export function buildTelegramContinuationLookupCandidate(envelope, options = {}) {
    if (envelope.provider !== "telegram" || !envelope.replyToMessageId || !envelope.room?.id)
        return null;
    return {
        provider: "telegram",
        chatId: envelope.room.id,
        ...(envelope.threadId ? { threadId: envelope.threadId } : {}),
        messageId: envelope.replyToMessageId,
        senderId: envelope.sender.id,
        timestamp: envelope.timestamp,
        lookupWindowMs: options.lookupWindowMs ?? DEFAULT_CONTINUATION_LOOKUP_WINDOW_MS,
    };
}
export class TelegramChannelAdapter {
    channelId;
    provider = "telegram";
    connectionId;
    config;
    connectionMode;
    transport;
    now;
    channel = null;
    constructor(options = {}) {
        this.channelId = options.channelId ?? DEFAULT_CHANNEL_ID;
        this.connectionId = options.connectionId ?? DEFAULT_CONNECTION_ID;
        this.config = options.config;
        this.connectionMode = options.connectionMode ?? "polling";
        this.transport = options.transport;
        this.now = options.now ?? Date.now;
    }
    async start() {
        const policy = resolveTelegramConnectionPolicy({
            config: this.config,
            mode: this.connectionMode,
            activePolling: getActiveTelegramChannel() !== null && this.channel === null,
        });
        if (!policy.canStart) {
            setTelegramRuntimeError(policy.message);
            throw new Error(policy.message);
        }
        if (this.transport?.start) {
            await this.transport.start();
            setTelegramRuntimeError(null);
            return;
        }
        if (!this.config)
            throw new Error("Telegram config is missing.");
        const channel = new TelegramChannel(this.config);
        try {
            await channel.start();
            this.channel = channel;
            setActiveTelegramChannel(channel);
            setTelegramRuntimeError(null);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            setTelegramRuntimeError(message);
            throw error;
        }
    }
    async stop() {
        if (this.transport?.stop) {
            await this.transport.stop();
            return;
        }
        if (this.channel && getActiveTelegramChannel() === this.channel) {
            stopActiveTelegramChannel();
        }
        else {
            this.channel?.stop();
        }
        this.channel = null;
    }
    async healthCheck() {
        const policy = resolveTelegramConnectionPolicy({
            config: this.config,
            mode: this.connectionMode,
            activePolling: false,
        });
        if (!policy.supported || policy.reason === "missing_token") {
            return { status: policy.healthStatus, checkedAt: this.now(), message: policy.message };
        }
        if (this.transport?.healthCheck) {
            return this.transport.healthCheck();
        }
        const runtime = getTelegramRuntimeStatus();
        if (runtime.isRunning)
            return { status: "healthy", checkedAt: this.now(), message: "Runtime is running." };
        if (runtime.lastError)
            return { status: "failed", checkedAt: this.now(), message: runtime.lastError };
        return { status: "stopped", checkedAt: this.now(), message: "Runtime is stopped." };
    }
    getCapabilities() {
        return buildTelegramCapabilityManifest();
    }
    async normalizeInbound(rawPayload) {
        return normalizeTelegramInboundUpdate(rawPayload, {
            channelId: this.channelId,
            connectionId: this.connectionId,
            now: this.now,
        });
    }
    async normalizeInteraction(rawPayload) {
        return normalizeTelegramInteractionUpdate(rawPayload, {
            channelId: this.channelId,
            connectionId: this.connectionId,
            now: this.now,
        });
    }
    async sendMessage(message) {
        const unsupportedCapability = resolveUnsupportedMessageCapability(this.getCapabilities(), message);
        if (unsupportedCapability) {
            return buildUnsupportedCapabilityReceipt({
                channelId: message.channelId,
                provider: message.provider,
                connectionId: message.connectionId,
                target: message.target,
                capability: unsupportedCapability,
                idempotencyKey: message.idempotencyKey,
                timestamp: this.now(),
            });
        }
        if (!message.target.roomId) {
            return {
                channelId: message.channelId,
                provider: message.provider,
                connectionId: message.connectionId,
                target: message.target,
                status: "blocked_by_policy",
                timestamp: this.now(),
                idempotencyKey: message.idempotencyKey,
                errorCode: "telegram_room_id_required",
                errorMessage: "Telegram outbound delivery requires target.roomId.",
            };
        }
        if (!this.transport?.sendMessage) {
            return {
                channelId: message.channelId,
                provider: message.provider,
                connectionId: message.connectionId,
                target: message.target,
                status: "accepted",
                timestamp: this.now(),
                idempotencyKey: message.idempotencyKey,
            };
        }
        try {
            const sent = await this.transport.sendMessage(message);
            return {
                channelId: message.channelId,
                provider: message.provider,
                connectionId: message.connectionId,
                target: message.target,
                status: resolveDeliveryReceiptStatus({
                    sent: true,
                    providerSupportsDelivered: this.getCapabilities().deliveryStates.supportsDelivered,
                }),
                timestamp: this.now(),
                idempotencyKey: message.idempotencyKey,
                messageId: String(sent.messageId),
                ...(sent.threadId !== undefined ? { threadId: String(sent.threadId) } : message.target.threadId
                    ? { threadId: message.target.threadId }
                    : {}),
                ...(sent.providerResponse !== undefined
                    ? {
                        providerResponseRef: createRawPayloadRef({
                            provider: "telegram",
                            payload: sent.providerResponse,
                            createdAt: this.now(),
                        }),
                    }
                    : {}),
            };
        }
        catch (error) {
            const messageText = error instanceof Error ? error.message : String(error);
            return {
                channelId: message.channelId,
                provider: message.provider,
                connectionId: message.connectionId,
                target: message.target,
                status: "failed",
                timestamp: this.now(),
                idempotencyKey: message.idempotencyKey,
                errorCode: "telegram_send_failed",
                errorMessage: messageText,
            };
        }
    }
    async handleInteraction(interaction) {
        return {
            channelId: interaction.channelId,
            provider: interaction.provider,
            connectionId: interaction.connectionId,
            target: {
                ...(interaction.room?.id ? { roomId: interaction.room.id } : {}),
                ...(interaction.threadId ? { threadId: interaction.threadId } : {}),
                ...(interaction.messageId ? { messageId: interaction.messageId } : {}),
            },
            status: "accepted",
            timestamp: this.now(),
            idempotencyKey: `interaction:${interaction.interactionId}`,
        };
    }
}
export function createTelegramChannelAdapter(options = {}) {
    return defineChannelAdapter(new TelegramChannelAdapter(options));
}
function asTelegramUpdate(rawPayload) {
    if (!isRecord(rawPayload))
        return {};
    return rawPayload;
}
function normalizeTelegramUser(user) {
    const displayName = displayNameFromUser(user);
    return {
        id: String(user.id),
        ...(displayName ? { displayName } : {}),
        ...(user.username ? { username: user.username } : {}),
        ...(typeof user.is_bot === "boolean" ? { isBot: user.is_bot } : {}),
        providerType: user.is_bot ? "bot" : "user",
    };
}
function normalizeTelegramRoom(chat) {
    const displayName = displayNameFromChat(chat);
    return {
        id: String(chat.id),
        ...(displayName ? { displayName } : {}),
        type: normalizeTelegramRoomType(chat.type),
    };
}
function normalizeTelegramRoomType(type) {
    if (type === "private")
        return "direct";
    if (type === "group" || type === "supergroup")
        return "group";
    if (type === "channel")
        return "channel";
    return "unknown";
}
function normalizeTelegramMessageText(message) {
    return message.text ?? message.caption ?? "";
}
function normalizeTelegramMentions(text, entities) {
    const mentions = [];
    for (const entity of entities) {
        if (entity.type === "text_mention" && entity.user?.id !== undefined) {
            const displayName = displayNameFromUser(entity.user);
            mentions.push({
                id: String(entity.user.id),
                ...(displayName ? { displayName } : {}),
                kind: entity.user.is_bot ? "agent" : "user",
            });
            continue;
        }
        if (entity.type === "mention" && entity.offset !== undefined && entity.length !== undefined) {
            const mentionText = text.slice(entity.offset, entity.offset + entity.length);
            if (mentionText) {
                mentions.push({
                    id: mentionText.replace(/^@/, ""),
                    displayName: mentionText,
                    kind: "user",
                });
            }
        }
    }
    return mentions;
}
function normalizeTelegramAttachments(message) {
    const attachments = [];
    if (message.document?.file_id) {
        attachments.push({
            id: message.document.file_id,
            ...(message.document.file_name ? { name: message.document.file_name } : {}),
            ...(message.document.mime_type ? { mimeType: message.document.mime_type } : {}),
            ...(typeof message.document.file_size === "number" ? { sizeBytes: message.document.file_size } : {}),
            kind: resolveAttachmentKind(message.document.mime_type),
            contentRef: `telegram:file:${message.document.file_id}`,
        });
    }
    const largestPhoto = selectLargestTelegramPhoto(message.photo);
    if (largestPhoto?.file_id) {
        attachments.push({
            id: largestPhoto.file_id,
            ...(typeof largestPhoto.file_size === "number" ? { sizeBytes: largestPhoto.file_size } : {}),
            kind: "image",
            contentRef: `telegram:file:${largestPhoto.file_id}`,
            altText: "Telegram photo",
        });
    }
    return attachments;
}
function selectLargestTelegramPhoto(photos) {
    if (!photos || photos.length === 0)
        return undefined;
    return photos.reduce((largest, photo) => {
        if (!largest)
            return photo;
        return (photo.file_size ?? 0) > (largest.file_size ?? 0) ? photo : largest;
    }, undefined);
}
function resolveAttachmentKind(mimeType) {
    if (!mimeType)
        return "file";
    if (mimeType.startsWith("image/"))
        return "image";
    if (mimeType.startsWith("audio/"))
        return "audio";
    if (mimeType.startsWith("video/"))
        return "video";
    return "file";
}
function resolveTelegramTimestamp(message, now) {
    return typeof message.date === "number" ? message.date * 1000 : now?.() ?? Date.now();
}
function parseTelegramCallbackData(data) {
    if (!data)
        return { kind: "choose_option" };
    const [scope, actionId, ...rest] = data.split(":");
    const correlationId = rest.join(":") || undefined;
    if (scope === "approve" && actionId) {
        const approvalDecision = rest[0] === "all" ? "allow_run" : rest[0] === "once" ? "allow_once" : undefined;
        return {
            kind: "approval",
            actionId: approvalDecision ?? "approve",
            ...(approvalDecision ? { approvalDecision } : {}),
            correlationId: actionId,
        };
    }
    if (scope === "deny" && actionId) {
        return {
            kind: "approval",
            actionId: "deny",
            approvalDecision: "deny",
            correlationId: actionId,
        };
    }
    if (scope === "approval") {
        const approvalDecision = toApprovalDecision(actionId);
        return {
            kind: "approval",
            ...(actionId ? { actionId } : {}),
            ...(approvalDecision ? { approvalDecision } : {}),
            ...(correlationId ? { correlationId } : {}),
        };
    }
    if (scope === "cancel")
        return { kind: "cancel", actionId: actionId || scope, ...(correlationId ? { correlationId } : {}) };
    if (scope === "retry")
        return { kind: "retry", actionId: actionId || scope, ...(correlationId ? { correlationId } : {}) };
    return { kind: "choose_option", actionId: actionId || scope || "unknown", ...(correlationId ? { correlationId } : {}) };
}
function toApprovalDecision(actionId) {
    if (actionId === "allow_once" || actionId === "allow_run" || actionId === "deny")
        return actionId;
    return undefined;
}
function resolveUnsupportedMessageCapability(capabilities, message) {
    if ((message.actions?.length ?? 0) > 0 && !capabilities.supportsButtons)
        return "supportsButtons";
    if ((message.attachments?.length ?? 0) > 0 && !capabilities.supportsFiles)
        return "supportsFiles";
    return null;
}
function displayNameFromUser(user) {
    return [user.first_name, user.last_name].filter(Boolean).join(" ").trim() || user.username;
}
function displayNameFromChat(chat) {
    return chat.title ?? ([chat.first_name, chat.last_name].filter(Boolean).join(" ").trim() || chat.username);
}
function toOptionalString(value) {
    return value === undefined ? undefined : String(value);
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
//# sourceMappingURL=adapter.js.map