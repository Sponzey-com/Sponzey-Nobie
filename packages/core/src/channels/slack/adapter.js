import { buildUnsupportedCapabilityReceipt, createRawPayloadRef, defineChannelAdapter, defineChannelCapabilities, } from "../contracts.js";
import { buildSlackFailedDeliveryReceipt, buildSlackSentDeliveryReceipt, } from "./message-delivery.js";
import { SlackChannel } from "./bot.js";
import { getActiveSlackChannel, getSlackRuntimeStatus, setActiveSlackChannel, setSlackRuntimeError, stopActiveSlackChannel, } from "./runtime.js";
const DEFAULT_CHANNEL_ID = "slack:workspace";
const DEFAULT_CONNECTION_ID = "slack:primary";
const SLACK_MAX_MESSAGE_LENGTH = 3000;
const SLACK_MAX_ATTACHMENT_SIZE_BYTES = 1024 * 1024 * 1024;
const DEFAULT_CONTINUATION_LOOKUP_WINDOW_MS = 24 * 60 * 60 * 1000;
const DEFAULT_DEDUPE_WINDOW_MS = 60_000;
export function buildSlackCapabilityManifest() {
    return defineChannelCapabilities({
        provider: "slack",
        connectionKind: "socket",
        supportsThreads: true,
        supportsReplies: true,
        supportsEdits: true,
        supportsDeletes: true,
        supportsReactions: true,
        supportsButtons: true,
        supportsModals: true,
        supportsFiles: true,
        supportsImages: true,
        supportsTypingIndicator: false,
        maxMessageLength: SLACK_MAX_MESSAGE_LENGTH,
        maxAttachmentSizeBytes: SLACK_MAX_ATTACHMENT_SIZE_BYTES,
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
export function resolveSlackConnectionPolicy(input) {
    const mode = input.mode ?? "socket";
    if (input.lastError && /missing_scope/i.test(input.lastError)) {
        return {
            mode,
            supported: true,
            canStart: false,
            healthStatus: "failed",
            reason: "missing_scope",
            message: `Slack token is missing a required scope: ${input.lastError}`,
        };
    }
    if (!input.config?.botToken?.trim()) {
        return {
            mode,
            supported: true,
            canStart: false,
            healthStatus: "failed",
            reason: "missing_bot_token",
            message: "Slack bot token is missing.",
        };
    }
    if (!input.config?.appToken?.trim()) {
        return {
            mode,
            supported: true,
            canStart: false,
            healthStatus: "failed",
            reason: "missing_app_token",
            message: "Slack app token is missing.",
        };
    }
    if (input.activeSocket === true) {
        return {
            mode,
            supported: true,
            canStart: false,
            healthStatus: "degraded",
            reason: "duplicate_socket",
            message: "Slack Socket Mode runtime is already active.",
        };
    }
    return {
        mode,
        supported: true,
        canStart: true,
        healthStatus: "healthy",
        reason: "ready",
        message: "Slack Socket Mode runtime is ready.",
    };
}
export function normalizeSlackInboundEvent(rawPayload, options = {}) {
    const payload = asSlackEventsApiPayload(rawPayload);
    const event = payload.event;
    if (!event)
        return [];
    const eventType = event.type?.trim();
    if (eventType !== "message" && eventType !== "app_mention")
        return [];
    if (event.bot_id)
        return [];
    if (event.user && options.botUserId && event.user === options.botUserId)
        return [];
    if (eventType === "message" && event.subtype && event.subtype !== "file_share")
        return [];
    const userId = event.user?.trim();
    const roomId = event.channel?.trim();
    const messageId = event.ts?.trim();
    if (!userId || !roomId || !messageId)
        return [];
    const rawText = event.text?.trim() ?? "";
    const mentions = normalizeSlackMentions(rawText, options.botUserId, options.botDisplayName);
    const text = eventType === "app_mention" ? stripSlackMentions(rawText).trim() : rawText;
    if (!text && !event.files?.length)
        return [];
    const threadId = event.thread_ts?.trim() || (eventType === "app_mention" ? messageId : "");
    const isThreadReply = Boolean(event.thread_ts?.trim()) && event.thread_ts?.trim() !== messageId;
    const timestamp = parseSlackTimestamp(event.event_ts ?? event.ts, options.now);
    return [{
            channelId: options.channelId ?? DEFAULT_CHANNEL_ID,
            provider: "slack",
            connectionId: options.connectionId ?? DEFAULT_CONNECTION_ID,
            messageId,
            ...(threadId ? { threadId } : {}),
            ...(isThreadReply && event.thread_ts ? { replyToMessageId: event.thread_ts } : {}),
            sender: {
                id: userId,
                providerType: "user",
            },
            room: normalizeSlackRoom(roomId, event.channel_type),
            ...(payload.team_id ? { workspace: normalizeSlackWorkspace(payload.team_id) } : {}),
            text,
            attachments: normalizeSlackFiles(event.files ?? []),
            mentions,
            timestamp,
            rawPayloadRef: createRawPayloadRef({ provider: "slack", payload: rawPayload, createdAt: timestamp }),
            ...(isThreadReply && event.thread_ts
                ? { continuationContext: { parentMessageId: event.thread_ts, source: "thread" } }
                : {}),
            dedupeKey: `slack:${roomId}:${messageId}`,
        }];
}
export function normalizeSlackInteractionPayload(rawPayload, options = {}) {
    const payload = asSlackInteractionPayload(rawPayload);
    if (payload.type !== "block_actions")
        return [];
    const action = payload.actions?.[0];
    const rawActionId = action?.action_id?.trim();
    const value = action?.value?.trim();
    const userId = payload.user?.id?.trim();
    const roomId = payload.channel?.id?.trim() || payload.container?.channel_id?.trim();
    const messageId = payload.message?.ts?.trim() || payload.container?.message_ts?.trim();
    const threadId = payload.message?.thread_ts?.trim() || payload.container?.thread_ts?.trim() || messageId;
    if (!rawActionId || !value || !userId)
        return [];
    const parsed = parseSlackActionId(rawActionId);
    const timestamp = parseSlackTimestamp(messageId, options.now);
    return [{
            channelId: options.channelId ?? DEFAULT_CHANNEL_ID,
            provider: "slack",
            connectionId: options.connectionId ?? DEFAULT_CONNECTION_ID,
            interactionId: `slack:${parsed.actionId}:${value}`,
            kind: parsed.kind,
            sender: normalizeSlackUser(payload.user ?? { id: userId }),
            timestamp,
            rawPayloadRef: createRawPayloadRef({ provider: "slack", payload: rawPayload, createdAt: timestamp }),
            ...(messageId ? { messageId } : {}),
            ...(threadId ? { threadId } : {}),
            ...(roomId ? { room: normalizeSlackInteractionRoom(roomId, payload.channel?.name) } : {}),
            ...(payload.team?.id ? { workspace: normalizeSlackWorkspace(payload.team.id) } : {}),
            actionId: parsed.actionId,
            value,
            ...(parsed.approvalDecision ? { approvalDecision: parsed.approvalDecision } : {}),
            correlationId: value,
        }];
}
export function buildSlackContinuationLookupCandidate(envelope, options = {}) {
    if (envelope.provider !== "slack" || !envelope.room?.id)
        return null;
    const threadTs = envelope.threadId ?? envelope.replyToMessageId;
    if (!threadTs)
        return null;
    return {
        provider: "slack",
        channelId: envelope.room.id,
        threadTs,
        messageTs: envelope.replyToMessageId ?? envelope.messageId,
        senderId: envelope.sender.id,
        timestamp: envelope.timestamp,
        lookupWindowMs: options.lookupWindowMs ?? DEFAULT_CONTINUATION_LOOKUP_WINDOW_MS,
        ...(options.teamId ? { teamId: options.teamId } : {}),
    };
}
export class SlackChannelAdapter {
    channelId;
    provider = "slack";
    connectionId;
    config;
    connectionMode;
    transport;
    now;
    botUserId;
    botDisplayName;
    dedupeWindowMs;
    channel = null;
    seenInboundEvents = new Map();
    constructor(options = {}) {
        this.channelId = options.channelId ?? DEFAULT_CHANNEL_ID;
        this.connectionId = options.connectionId ?? DEFAULT_CONNECTION_ID;
        this.config = options.config;
        this.connectionMode = options.connectionMode ?? "socket";
        this.transport = options.transport;
        this.now = options.now ?? Date.now;
        this.botUserId = options.botUserId;
        this.botDisplayName = options.botDisplayName;
        this.dedupeWindowMs = options.dedupeWindowMs ?? DEFAULT_DEDUPE_WINDOW_MS;
    }
    async start() {
        const policy = resolveSlackConnectionPolicy({
            config: this.config,
            mode: this.connectionMode,
            activeSocket: getActiveSlackChannel() !== null && this.channel === null,
        });
        if (!policy.canStart) {
            setSlackRuntimeError(policy.message);
            throw new Error(policy.message);
        }
        if (this.transport?.start) {
            await this.transport.start();
            setSlackRuntimeError(null);
            return;
        }
        if (!this.config)
            throw new Error("Slack config is missing.");
        const channel = new SlackChannel(this.config);
        try {
            await channel.start();
            this.channel = channel;
            setActiveSlackChannel(channel);
            setSlackRuntimeError(null);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            setSlackRuntimeError(message);
            throw error;
        }
    }
    async stop() {
        if (this.transport?.stop) {
            await this.transport.stop();
            return;
        }
        if (this.channel && getActiveSlackChannel() === this.channel) {
            stopActiveSlackChannel();
        }
        else {
            this.channel?.stop();
        }
        this.channel = null;
    }
    async healthCheck() {
        const runtime = getSlackRuntimeStatus();
        const policy = resolveSlackConnectionPolicy({
            config: this.config,
            mode: this.connectionMode,
            activeSocket: false,
            lastError: runtime.lastError,
        });
        if (!policy.canStart && policy.reason !== "duplicate_socket") {
            return { status: policy.healthStatus, checkedAt: this.now(), message: policy.message };
        }
        if (this.transport?.healthCheck) {
            return this.transport.healthCheck();
        }
        if (runtime.isRunning)
            return { status: "healthy", checkedAt: this.now(), message: "Runtime is running." };
        if (runtime.lastError)
            return { status: "failed", checkedAt: this.now(), message: runtime.lastError };
        return { status: "stopped", checkedAt: this.now(), message: "Runtime is stopped." };
    }
    getCapabilities() {
        return buildSlackCapabilityManifest();
    }
    async normalizeInbound(rawPayload) {
        const options = {
            channelId: this.channelId,
            connectionId: this.connectionId,
            now: this.now,
        };
        if (this.botUserId !== undefined)
            options.botUserId = this.botUserId;
        if (this.botDisplayName !== undefined)
            options.botDisplayName = this.botDisplayName;
        return normalizeSlackInboundEvent(rawPayload, options)
            .filter((envelope) => !this.markInboundEventSeen(envelope.dedupeKey));
    }
    async normalizeInteraction(rawPayload) {
        return normalizeSlackInteractionPayload(rawPayload, {
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
        const outboundMessage = applySlackThreadPolicy(message);
        if (!outboundMessage.target.roomId) {
            return {
                channelId: outboundMessage.channelId,
                provider: outboundMessage.provider,
                connectionId: outboundMessage.connectionId,
                target: outboundMessage.target,
                status: "blocked_by_policy",
                timestamp: this.now(),
                idempotencyKey: outboundMessage.idempotencyKey,
                errorCode: "slack_channel_id_required",
                errorMessage: "Slack outbound delivery requires target.roomId.",
            };
        }
        if (!this.transport?.sendMessage) {
            return {
                channelId: outboundMessage.channelId,
                provider: outboundMessage.provider,
                connectionId: outboundMessage.connectionId,
                target: outboundMessage.target,
                status: "accepted",
                timestamp: this.now(),
                idempotencyKey: outboundMessage.idempotencyKey,
            };
        }
        try {
            const sent = await this.transport.sendMessage(outboundMessage);
            return {
                ...buildSlackSentDeliveryReceipt({
                    target: slackDeliveryTargetFromOutbound(outboundMessage),
                    idempotencyKey: outboundMessage.idempotencyKey,
                    messageId: sent.messageId,
                    providerResponse: sent.providerResponse,
                    timestamp: this.now(),
                }),
                channelId: outboundMessage.channelId,
                connectionId: outboundMessage.connectionId,
                target: outboundMessage.target,
                timestamp: this.now(),
                messageId: String(sent.messageId),
                ...(sent.threadId !== undefined ? { threadId: String(sent.threadId) } : outboundMessage.target.threadId
                    ? { threadId: outboundMessage.target.threadId }
                    : {}),
            };
        }
        catch (error) {
            return {
                ...buildSlackFailedDeliveryReceipt({
                    target: slackDeliveryTargetFromOutbound(outboundMessage),
                    idempotencyKey: outboundMessage.idempotencyKey,
                    error,
                    timestamp: this.now(),
                }),
                channelId: outboundMessage.channelId,
                connectionId: outboundMessage.connectionId,
                target: outboundMessage.target,
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
    markInboundEventSeen(eventKey) {
        const now = this.now();
        const previous = this.seenInboundEvents.get(eventKey);
        for (const [key, seenAt] of this.seenInboundEvents.entries()) {
            if (now - seenAt > this.dedupeWindowMs)
                this.seenInboundEvents.delete(key);
        }
        if (typeof previous === "number" && now - previous < this.dedupeWindowMs)
            return true;
        this.seenInboundEvents.set(eventKey, now);
        return false;
    }
}
export function createSlackChannelAdapter(options = {}) {
    return defineChannelAdapter(new SlackChannelAdapter(options));
}
function asSlackEventsApiPayload(rawPayload) {
    const record = asRecord(rawPayload);
    const socketPayload = asRecord(record.payload);
    if (isSlackEventsPayload(socketPayload))
        return socketPayload;
    if (isSlackEventsPayload(record))
        return record;
    return {};
}
function asSlackInteractionPayload(rawPayload) {
    const record = asRecord(rawPayload);
    const socketPayload = asRecord(record.payload);
    if (socketPayload.type === "block_actions")
        return socketPayload;
    if (record.type === "block_actions")
        return record;
    return {};
}
function isSlackEventsPayload(value) {
    return Boolean(value.event && asRecord(value.event).type);
}
function normalizeSlackUser(user) {
    return {
        id: String(user.id ?? ""),
        ...(user.name ? { username: user.name } : user.username ? { username: user.username } : {}),
        ...(user.real_name ? { displayName: user.real_name } : {}),
        providerType: "user",
    };
}
function normalizeSlackRoom(roomId, channelType) {
    return {
        id: roomId,
        type: normalizeSlackRoomType(roomId, channelType),
    };
}
function normalizeSlackInteractionRoom(roomId, name) {
    return {
        id: roomId,
        ...(name ? { displayName: name } : {}),
        type: normalizeSlackRoomType(roomId),
    };
}
function normalizeSlackWorkspace(teamId) {
    return {
        id: teamId,
    };
}
function normalizeSlackRoomType(roomId, channelType) {
    if (channelType === "im" || roomId.startsWith("D"))
        return "direct";
    if (channelType === "mpim" || roomId.startsWith("G"))
        return "group";
    return "channel";
}
function normalizeSlackFiles(files) {
    return files
        .map((file) => {
        const id = file.id?.trim();
        if (!id)
            return null;
        const name = file.name?.trim() || file.title?.trim();
        const mimeType = file.mimetype?.trim();
        const kind = mimeType?.startsWith("image/") ? "image" : "file";
        return {
            id,
            ...(name ? { name } : {}),
            ...(mimeType ? { mimeType } : {}),
            ...(typeof file.size === "number" ? { sizeBytes: file.size } : {}),
            kind,
            ...(file.url_private ? { url: file.url_private } : {}),
            contentRef: `slack:file:${id}`,
        };
    })
        .filter((file) => Boolean(file));
}
function normalizeSlackMentions(text, botUserId, botDisplayName) {
    const mentions = [];
    const seen = new Set();
    for (const match of text.matchAll(/<@([A-Z0-9_]+)(?:\|([^>]+))?>/g)) {
        const id = match[1]?.trim();
        if (!id || seen.has(id))
            continue;
        seen.add(id);
        const isAgent = botUserId !== undefined && id === botUserId;
        mentions.push({
            id,
            ...(match[2] ? { displayName: match[2] } : isAgent && botDisplayName ? { displayName: botDisplayName } : {}),
            kind: isAgent ? "agent" : "user",
        });
    }
    return mentions;
}
function stripSlackMentions(text) {
    return text.replace(/<@[^>]+>/g, "").trim();
}
function parseSlackActionId(actionId) {
    const normalized = actionId.replace(/^approval_/, "");
    if (normalized === "approve" || normalized === "approve_run") {
        return { kind: "approval", actionId: "allow_run", approvalDecision: "allow_run" };
    }
    if (normalized === "approve_once") {
        return { kind: "approval", actionId: "allow_once", approvalDecision: "allow_once" };
    }
    if (normalized === "allow_once" || normalized === "allow_run" || normalized === "deny") {
        return { kind: "approval", actionId: normalized, approvalDecision: normalized };
    }
    if (normalized === "cancel")
        return { kind: "cancel", actionId: normalized };
    if (normalized === "retry")
        return { kind: "retry", actionId: normalized };
    return { kind: "choose_option", actionId: normalized || "unknown" };
}
function parseSlackTimestamp(value, now) {
    const parsed = Number(value);
    if (Number.isFinite(parsed))
        return Math.trunc(parsed * 1000);
    return now?.() ?? Date.now();
}
function resolveUnsupportedMessageCapability(capabilities, message) {
    if ((message.actions?.length ?? 0) > 0 && !capabilities.supportsButtons)
        return "supportsButtons";
    if ((message.attachments?.length ?? 0) > 0 && !capabilities.supportsFiles)
        return "supportsFiles";
    return null;
}
function applySlackThreadPolicy(message) {
    const threadId = message.threadPolicy.mode === "none"
        ? undefined
        : message.threadPolicy.threadId ?? message.target.threadId;
    const target = {
        ...message.target,
        ...(threadId ? { threadId } : {}),
    };
    if (!threadId)
        delete target.threadId;
    return {
        ...message,
        target,
    };
}
function slackDeliveryTargetFromOutbound(message) {
    return {
        channelId: message.target.roomId ?? "",
        ...(message.target.threadId ? { threadTs: message.target.threadId } : {}),
    };
}
function asRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value)
        ? value
        : {};
}
//# sourceMappingURL=adapter.js.map