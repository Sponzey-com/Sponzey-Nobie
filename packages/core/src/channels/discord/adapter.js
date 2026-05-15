import { createPublicKey, verify } from "node:crypto";
import { buildUnsupportedCapabilityReceipt, createRawPayloadRef, defineChannelAdapter, defineChannelCapabilities, resolveDeliveryReceiptStatus, } from "../contracts.js";
import { getDiscordRuntimeStatus, setDiscordRuntimeError, setDiscordRuntimeRunning, stopDiscordRuntime, } from "./runtime.js";
const DEFAULT_CHANNEL_ID = "discord:primary";
const DEFAULT_CONNECTION_ID = "discord:primary";
const DISCORD_MAX_MESSAGE_LENGTH = 2000;
const DISCORD_MAX_ATTACHMENT_SIZE_BYTES = 25 * 1024 * 1024;
const DEFAULT_CONTINUATION_LOOKUP_WINDOW_MS = 24 * 60 * 60 * 1000;
const DEFAULT_DEDUPE_WINDOW_MS = 60_000;
const DISCORD_ED25519_PUBLIC_KEY_DER_PREFIX = "302a300506032b6570032100";
const DEFAULT_REQUIRED_INTENTS = ["GuildMessages", "MessageContent", "DirectMessages"];
const DEFAULT_REQUIRED_PERMISSIONS = ["SendMessages", "ReadMessageHistory", "UseApplicationCommands", "AttachFiles"];
export function buildDiscordCapabilityManifest() {
    return defineChannelCapabilities({
        provider: "discord",
        connectionKind: "socket",
        supportsThreads: true,
        supportsReplies: true,
        supportsEdits: false,
        supportsDeletes: false,
        supportsReactions: true,
        supportsButtons: true,
        supportsModals: false,
        supportsFiles: true,
        supportsImages: true,
        supportsTypingIndicator: true,
        maxMessageLength: DISCORD_MAX_MESSAGE_LENGTH,
        maxAttachmentSizeBytes: DISCORD_MAX_ATTACHMENT_SIZE_BYTES,
        rateLimitPolicy: { strategy: "provider_default" },
        requiresWebhook: true,
        requiresLocalBridge: false,
        requiresUserSession: false,
        riskLevel: "medium",
        deliveryStates: {
            supportsAccepted: true,
            supportsSent: true,
            supportsDelivered: false,
            supportsReadReceipt: false,
        },
    });
}
export function buildDiscordPermissionDoctor(config) {
    const issues = [];
    const requiredIntents = normalizeStringList(config?.grantedIntents?.length ? DEFAULT_REQUIRED_INTENTS : DEFAULT_REQUIRED_INTENTS);
    const grantedIntents = normalizeStringList(config?.grantedIntents ?? []);
    const requiredPermissions = normalizeStringList(DEFAULT_REQUIRED_PERMISSIONS);
    const botPermissions = normalizeStringList(config?.botPermissions ?? []);
    const allowedGuildIds = normalizeStringList(config?.allowedGuildIds ?? []);
    const installedGuildIds = normalizeStringList(config?.installedGuildIds ?? []);
    if (config?.enabled && !nonEmptyString(config.botToken)) {
        issues.push({
            code: "discord_bot_token_missing",
            severity: "error",
            message: "Discord bot token is required before the gateway runtime can start.",
        });
    }
    if (config?.enabled && !nonEmptyString(config.applicationId)) {
        issues.push({
            code: "discord_application_id_missing",
            severity: "error",
            message: "Discord application id is required for slash commands and component interactions.",
        });
    }
    if (config?.enabled && !nonEmptyString(config.publicKey)) {
        issues.push({
            code: "discord_public_key_missing",
            severity: "warning",
            message: "Discord public key is not configured; signed slash command and component callbacks will be rejected.",
        });
    }
    for (const intent of requiredIntents) {
        if (grantedIntents.length > 0 && !grantedIntents.includes(intent)) {
            issues.push({
                code: `discord_intent_missing:${intent}`,
                severity: "warning",
                message: `Discord gateway intent is not listed as granted: ${intent}.`,
            });
        }
    }
    for (const permission of requiredPermissions) {
        if (botPermissions.length > 0 && !botPermissions.includes(permission)) {
            issues.push({
                code: `discord_permission_missing:${permission}`,
                severity: "warning",
                message: `Discord bot permission is not listed as granted: ${permission}.`,
            });
        }
    }
    if (allowedGuildIds.length > 0 && installedGuildIds.length > 0) {
        for (const guildId of allowedGuildIds) {
            if (!installedGuildIds.includes(guildId)) {
                issues.push({
                    code: `discord_guild_not_installed:${guildId}`,
                    severity: "warning",
                    message: `Discord bot install was not confirmed for allowed guild ${guildId}.`,
                });
            }
        }
    }
    if (config?.largeGuildMode) {
        issues.push({
            code: "discord_large_guild_conservative_mode",
            severity: "warning",
            message: "Large guild mode is enabled; gateway intent and rate-limit handling should stay conservative.",
        });
    }
    return {
        ok: !issues.some((issue) => issue.severity === "error"),
        issues,
        requiredIntents,
        grantedIntents,
        requiredPermissions,
        botPermissions,
        interactionPublicKeyConfigured: nonEmptyString(config?.publicKey),
        largeGuildMode: config?.largeGuildMode === true,
    };
}
export function resolveDiscordConnectionPolicy(input) {
    const mode = input.mode ?? "gateway";
    const doctor = buildDiscordPermissionDoctor(input.config);
    if (!nonEmptyString(input.config?.botToken)) {
        return {
            mode,
            supported: true,
            canStart: false,
            healthStatus: "failed",
            reason: "missing_bot_token",
            message: "Discord bot token is missing.",
            doctor,
        };
    }
    if (!nonEmptyString(input.config?.applicationId)) {
        return {
            mode,
            supported: true,
            canStart: false,
            healthStatus: "failed",
            reason: "missing_application_id",
            message: "Discord application id is missing.",
            doctor,
        };
    }
    const blockingIssue = doctor.issues.find((issue) => issue.severity === "error");
    if (blockingIssue) {
        return {
            mode,
            supported: true,
            canStart: false,
            healthStatus: "failed",
            reason: blockingIssue.code.includes("application") ? "missing_application_id" : "missing_bot_token",
            message: blockingIssue.message,
            doctor,
        };
    }
    if (!input.transportAvailable) {
        return {
            mode,
            supported: true,
            canStart: false,
            healthStatus: "stopped",
            reason: "gateway_transport_unavailable",
            message: "Discord gateway transport is not attached in this runtime.",
            doctor,
        };
    }
    if (!nonEmptyString(input.config?.publicKey)) {
        return {
            mode,
            supported: true,
            canStart: true,
            healthStatus: "degraded",
            reason: "missing_public_key",
            message: "Discord runtime can start, but interaction verification is not configured.",
            doctor,
        };
    }
    return {
        mode,
        supported: true,
        canStart: true,
        healthStatus: "healthy",
        reason: "ready",
        message: "Discord gateway runtime is ready.",
        doctor,
    };
}
export function validateDiscordInteractionSignature(input) {
    const publicKey = normalizeHex(input.publicKey);
    const signature = normalizeHex(input.signature);
    const timestamp = input.timestamp?.trim();
    const body = input.body;
    if (!publicKey)
        return { valid: false, reason: "missing_public_key" };
    if (!signature)
        return { valid: false, reason: "missing_signature" };
    if (!timestamp)
        return { valid: false, reason: "missing_timestamp" };
    if (body === undefined || body === null)
        return { valid: false, reason: "missing_body" };
    if (publicKey.length !== 64)
        return { valid: false, reason: "invalid_public_key" };
    if (signature.length !== 128)
        return { valid: false, reason: "invalid_signature" };
    try {
        const key = createPublicKey({
            key: Buffer.concat([
                Buffer.from(DISCORD_ED25519_PUBLIC_KEY_DER_PREFIX, "hex"),
                Buffer.from(publicKey, "hex"),
            ]),
            format: "der",
            type: "spki",
        });
        const bodyBuffer = Buffer.isBuffer(body) ? body : Buffer.from(body, "utf8");
        const signedMessage = Buffer.concat([Buffer.from(timestamp, "utf8"), bodyBuffer]);
        const valid = verify(null, signedMessage, key, Buffer.from(signature, "hex"));
        return valid ? { valid: true, reason: "verified" } : { valid: false, reason: "verification_failed" };
    }
    catch {
        return { valid: false, reason: "verification_failed" };
    }
}
export function normalizeDiscordInboundEvent(rawPayload, options = {}) {
    const gateway = asDiscordGatewayPayload(rawPayload);
    if (gateway.t !== "MESSAGE_CREATE" || !gateway.d)
        return [];
    return normalizeDiscordMessage(gateway.d, rawPayload, options);
}
export function normalizeDiscordInteractionRequest(rawPayload, options = {}) {
    const request = extractDiscordInteractionRequest(rawPayload);
    if (!request.body || request.body.type !== 2)
        return [];
    const verification = validateDiscordInteractionSignature(buildDiscordSignatureValidationInput({
        publicKey: options.publicKey,
        signature: request.signature,
        timestamp: request.timestamp,
        body: request.rawBody,
    }));
    if (!verification.valid)
        return [];
    return [normalizeDiscordSlashCommand(request.body, rawPayload, options)];
}
export function normalizeDiscordComponentInteraction(rawPayload, options = {}) {
    const request = extractDiscordInteractionRequest(rawPayload);
    if (!request.body || request.body.type !== 3)
        return [];
    const verification = validateDiscordInteractionSignature(buildDiscordSignatureValidationInput({
        publicKey: options.publicKey,
        signature: request.signature,
        timestamp: request.timestamp,
        body: request.rawBody,
    }));
    if (!verification.valid)
        return [];
    const body = request.body;
    const sender = normalizeDiscordInteractionSender(body);
    if (!body.id || !sender.id)
        return [];
    const parsed = parseDiscordAction(body.data?.custom_id, body.data?.values);
    const timestamp = options.now?.() ?? Date.now();
    return [{
            channelId: options.channelId ?? DEFAULT_CHANNEL_ID,
            provider: "discord",
            connectionId: options.connectionId ?? DEFAULT_CONNECTION_ID,
            interactionId: body.id,
            kind: parsed.kind,
            sender,
            timestamp,
            rawPayloadRef: createRawPayloadRef({ provider: "discord", payload: rawPayload, createdAt: timestamp }),
            ...(body.message?.id ? { messageId: body.message.id } : {}),
            ...(body.channel_id ? { room: normalizeDiscordRoom(body.channel_id, body.guild_id) } : {}),
            ...(body.guild_id ? { workspace: normalizeDiscordWorkspace(body.guild_id) } : {}),
            ...(parsed.actionId ? { actionId: parsed.actionId } : {}),
            ...(parsed.value ? { value: parsed.value } : {}),
            ...(parsed.approvalDecision ? { approvalDecision: parsed.approvalDecision } : {}),
            ...(parsed.correlationId ? { correlationId: parsed.correlationId } : {}),
        }];
}
export function buildDiscordContinuationLookupCandidate(envelope, options = {}) {
    if (envelope.provider !== "discord" || !envelope.replyToMessageId || !envelope.room?.id)
        return null;
    return {
        provider: "discord",
        ...(envelope.workspace?.id ? { guildId: envelope.workspace.id } : {}),
        channelId: envelope.room.id,
        ...(envelope.threadId ? { threadId: envelope.threadId } : {}),
        messageId: envelope.replyToMessageId,
        senderId: envelope.sender.id,
        timestamp: envelope.timestamp,
        lookupWindowMs: options.lookupWindowMs ?? DEFAULT_CONTINUATION_LOOKUP_WINDOW_MS,
    };
}
export class DiscordChannelAdapter {
    channelId;
    provider = "discord";
    connectionId;
    config;
    connectionMode;
    transport;
    now;
    botUserId;
    botDisplayName;
    dedupeWindowMs;
    seenInboundEvents = new Map();
    constructor(options = {}) {
        this.channelId = options.channelId ?? DEFAULT_CHANNEL_ID;
        this.connectionId = options.connectionId ?? DEFAULT_CONNECTION_ID;
        this.config = options.config;
        this.connectionMode = options.connectionMode ?? "gateway";
        this.transport = options.transport;
        this.now = options.now ?? Date.now;
        this.botUserId = options.botUserId;
        this.botDisplayName = options.botDisplayName;
        this.dedupeWindowMs = options.dedupeWindowMs ?? DEFAULT_DEDUPE_WINDOW_MS;
    }
    async start() {
        const policy = resolveDiscordConnectionPolicy({
            config: this.config,
            mode: this.connectionMode,
            activeGateway: getDiscordRuntimeStatus().isRunning,
            transportAvailable: Boolean(this.transport?.start),
        });
        if (!policy.canStart) {
            setDiscordRuntimeError(policy.message);
            throw new Error(policy.message);
        }
        try {
            await this.transport?.start?.();
            setDiscordRuntimeRunning(true);
            setDiscordRuntimeError(null);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            setDiscordRuntimeError(message);
            throw error;
        }
    }
    async stop() {
        await this.transport?.stop?.();
        stopDiscordRuntime();
    }
    async healthCheck() {
        const runtime = getDiscordRuntimeStatus();
        const policy = resolveDiscordConnectionPolicy({
            config: this.config,
            mode: this.connectionMode,
            activeGateway: runtime.isRunning,
            transportAvailable: Boolean(this.transport?.start),
        });
        if (policy.reason !== "ready" && policy.reason !== "missing_public_key") {
            return {
                status: policy.healthStatus,
                checkedAt: this.now(),
                message: policy.message,
                detail: discordDoctorDetail(policy.doctor),
            };
        }
        if (this.transport?.healthCheck)
            return this.transport.healthCheck();
        if (runtime.isRunning)
            return { status: "healthy", checkedAt: this.now(), message: "Runtime is running.", detail: discordDoctorDetail(policy.doctor) };
        if (runtime.lastError)
            return { status: "failed", checkedAt: this.now(), message: runtime.lastError, detail: discordDoctorDetail(policy.doctor) };
        return {
            status: policy.healthStatus,
            checkedAt: this.now(),
            message: policy.message,
            detail: discordDoctorDetail(policy.doctor),
        };
    }
    getCapabilities() {
        return buildDiscordCapabilityManifest();
    }
    async normalizeInbound(rawPayload) {
        const inboundOptions = {
            channelId: this.channelId,
            connectionId: this.connectionId,
            now: this.now,
        };
        if (this.botUserId !== undefined)
            inboundOptions.botUserId = this.botUserId;
        if (this.botDisplayName !== undefined)
            inboundOptions.botDisplayName = this.botDisplayName;
        const gatewayMessages = normalizeDiscordInboundEvent(rawPayload, inboundOptions);
        const interactionOptions = {
            channelId: this.channelId,
            connectionId: this.connectionId,
            now: this.now,
        };
        if (this.config?.publicKey !== undefined)
            interactionOptions.publicKey = this.config.publicKey;
        const slashCommands = normalizeDiscordInteractionRequest(rawPayload, interactionOptions);
        return [...gatewayMessages, ...slashCommands]
            .filter((envelope) => !this.markInboundEventSeen(envelope.dedupeKey));
    }
    async normalizeInteraction(rawPayload) {
        const options = {
            channelId: this.channelId,
            connectionId: this.connectionId,
            now: this.now,
        };
        if (this.config?.publicKey !== undefined)
            options.publicKey = this.config.publicKey;
        return normalizeDiscordComponentInteraction(rawPayload, options);
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
        const outboundMessage = applyDiscordThreadPolicy(message);
        if (!outboundMessage.target.roomId) {
            return {
                channelId: outboundMessage.channelId,
                provider: outboundMessage.provider,
                connectionId: outboundMessage.connectionId,
                target: outboundMessage.target,
                status: "blocked_by_policy",
                timestamp: this.now(),
                idempotencyKey: outboundMessage.idempotencyKey,
                errorCode: "discord_channel_id_required",
                errorMessage: "Discord outbound delivery requires target.roomId.",
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
                channelId: outboundMessage.channelId,
                provider: outboundMessage.provider,
                connectionId: outboundMessage.connectionId,
                target: outboundMessage.target,
                status: resolveDeliveryReceiptStatus({
                    sent: true,
                    providerSupportsDelivered: this.getCapabilities().deliveryStates.supportsDelivered,
                }),
                timestamp: this.now(),
                idempotencyKey: outboundMessage.idempotencyKey,
                messageId: String(sent.messageId),
                ...(sent.threadId !== undefined ? { threadId: String(sent.threadId) } : outboundMessage.target.threadId
                    ? { threadId: outboundMessage.target.threadId }
                    : {}),
                ...(sent.retryAfterMs ? { retryAfterMs: sent.retryAfterMs } : {}),
                ...(sent.providerResponse !== undefined
                    ? {
                        providerResponseRef: createRawPayloadRef({
                            provider: "discord",
                            payload: sent.providerResponse,
                            createdAt: this.now(),
                        }),
                    }
                    : {}),
            };
        }
        catch (error) {
            const messageText = error instanceof Error ? error.message : String(error);
            const receipt = {
                channelId: outboundMessage.channelId,
                provider: outboundMessage.provider,
                connectionId: outboundMessage.connectionId,
                target: outboundMessage.target,
                status: isRateLimitError(error) ? "rate_limited" : "failed",
                timestamp: this.now(),
                idempotencyKey: outboundMessage.idempotencyKey,
                errorCode: isRateLimitError(error) ? "discord_rate_limited" : "discord_send_failed",
                errorMessage: messageText,
            };
            const retryAfterMs = readRetryAfter(error);
            if (retryAfterMs !== undefined)
                receipt.retryAfterMs = retryAfterMs;
            return receipt;
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
export function createDiscordChannelAdapter(options = {}) {
    return defineChannelAdapter(new DiscordChannelAdapter(options));
}
function normalizeDiscordMessage(message, rawPayload, options) {
    const opts = options ?? {};
    if (!message.id || !message.channel_id || !message.author?.id)
        return [];
    if (message.author.bot)
        return [];
    if (opts.botUserId && message.author.id === opts.botUserId)
        return [];
    const rawText = message.content?.trim() ?? "";
    const mentions = normalizeDiscordMentions(message.mentions ?? [], opts.botUserId, opts.botDisplayName);
    const text = stripDiscordMentions(rawText).trim();
    const attachments = normalizeDiscordAttachments(message.attachments ?? []);
    if (!text && attachments.length === 0)
        return [];
    const timestamp = parseDiscordTimestamp(message.timestamp, opts.now);
    const replyToMessageId = message.referenced_message?.id ?? message.message_reference?.message_id;
    const threadId = message.thread_id;
    const workspace = message.guild_id ? normalizeDiscordWorkspace(message.guild_id) : undefined;
    return [{
            channelId: opts.channelId ?? DEFAULT_CHANNEL_ID,
            provider: "discord",
            connectionId: opts.connectionId ?? DEFAULT_CONNECTION_ID,
            messageId: message.id,
            ...(threadId ? { threadId } : {}),
            ...(replyToMessageId ? { replyToMessageId } : {}),
            sender: normalizeDiscordUser(message.author, message.member),
            room: normalizeDiscordRoom(message.channel_id, message.guild_id),
            ...(workspace ? { workspace } : {}),
            text,
            attachments,
            mentions,
            timestamp,
            rawPayloadRef: createRawPayloadRef({ provider: "discord", payload: rawPayload, createdAt: timestamp }),
            ...(replyToMessageId
                ? { continuationContext: { parentMessageId: replyToMessageId, source: "reply" } }
                : {}),
            dedupeKey: `discord:${message.guild_id ?? "dm"}:${message.channel_id}:${message.id}`,
        }];
}
function normalizeDiscordSlashCommand(body, rawPayload, options) {
    const opts = options ?? {};
    const timestamp = opts.now?.() ?? Date.now();
    const sender = normalizeDiscordInteractionSender(body);
    const room = body.channel_id ? normalizeDiscordRoom(body.channel_id, body.guild_id) : undefined;
    const workspace = body.guild_id ? normalizeDiscordWorkspace(body.guild_id) : undefined;
    return {
        channelId: opts.channelId ?? DEFAULT_CHANNEL_ID,
        provider: "discord",
        connectionId: opts.connectionId ?? DEFAULT_CONNECTION_ID,
        messageId: body.id ?? `interaction:${timestamp}`,
        sender,
        ...(room ? { room } : {}),
        ...(workspace ? { workspace } : {}),
        text: formatDiscordSlashCommand(body.data),
        attachments: [],
        mentions: [],
        timestamp,
        rawPayloadRef: createRawPayloadRef({ provider: "discord", payload: rawPayload, createdAt: timestamp }),
        dedupeKey: `discord:interaction:${body.id ?? timestamp}`,
    };
}
function asDiscordGatewayPayload(rawPayload) {
    const record = asRecord(rawPayload);
    if (record.t === "MESSAGE_CREATE" && isRecord(record.d))
        return record;
    if (record.type === "MESSAGE_CREATE" && isRecord(record.d))
        return { t: "MESSAGE_CREATE", d: record.d };
    if (record.id && record.channel_id && isRecord(record.author))
        return { t: "MESSAGE_CREATE", d: record };
    return {};
}
function extractDiscordInteractionRequest(rawPayload) {
    const record = asRecord(rawPayload);
    const headers = normalizeHeaders(asRecord(record.headers));
    const rawBody = typeof record.rawBody === "string" || Buffer.isBuffer(record.rawBody)
        ? record.rawBody
        : undefined;
    const body = isRecord(record.body)
        ? record.body
        : record.type === 2 || record.type === 3
            ? record
            : undefined;
    const request = {};
    if (body !== undefined)
        request.body = body;
    if (rawBody !== undefined)
        request.rawBody = rawBody;
    const signature = stringValue(headers["x-signature-ed25519"] ?? record.signature ?? record.rawSignature);
    const timestamp = stringValue(headers["x-signature-timestamp"] ?? record.timestamp ?? record.rawTimestamp);
    if (signature !== undefined)
        request.signature = signature;
    if (timestamp !== undefined)
        request.timestamp = timestamp;
    return request;
}
function normalizeDiscordInteractionSender(body) {
    const user = body.member?.user ?? body.user ?? {};
    return normalizeDiscordUser(user, body.member);
}
function normalizeDiscordUser(user, member) {
    const displayName = member?.nick?.trim() || user.global_name?.trim() || user.username?.trim();
    return {
        id: String(user.id ?? ""),
        ...(displayName ? { displayName } : {}),
        ...(user.username ? { username: user.username } : {}),
        ...(typeof user.bot === "boolean" ? { isBot: user.bot } : {}),
        providerType: user.bot ? "bot" : "user",
    };
}
function normalizeDiscordRoom(channelId, guildId) {
    return {
        id: channelId,
        type: guildId ? "channel" : "direct",
    };
}
function normalizeDiscordWorkspace(guildId) {
    return { id: guildId };
}
function normalizeDiscordAttachments(attachments) {
    return attachments
        .map((attachment) => {
        const id = attachment.id?.trim();
        if (!id)
            return null;
        const mimeType = attachment.content_type?.trim();
        return {
            id,
            ...(attachment.filename ? { name: attachment.filename } : {}),
            ...(mimeType ? { mimeType } : {}),
            ...(typeof attachment.size === "number" ? { sizeBytes: attachment.size } : {}),
            kind: mimeType?.startsWith("image/") ? "image" : "file",
            ...(attachment.url ? { url: attachment.url } : {}),
            contentRef: `discord:attachment:${id}`,
        };
    })
        .filter((attachment) => Boolean(attachment));
}
function normalizeDiscordMentions(mentions, botUserId, botDisplayName) {
    return mentions
        .filter((mention) => Boolean(mention.id))
        .map((mention) => ({
        id: String(mention.id),
        ...(mention.username ? { displayName: mention.username } : botUserId === mention.id && botDisplayName ? { displayName: botDisplayName } : {}),
        kind: botUserId === mention.id ? "agent" : "user",
    }));
}
function stripDiscordMentions(text) {
    return text.replace(/<@!?\d+>/g, "").trim();
}
function formatDiscordSlashCommand(data) {
    const name = data?.name?.trim() || "command";
    const args = (data?.options ?? [])
        .map((option) => {
        const optionName = option.name?.trim();
        if (!optionName)
            return "";
        return `${optionName}:${String(option.value ?? "").trim()}`;
    })
        .filter(Boolean)
        .join(" ");
    return `/${name}${args ? ` ${args}` : ""}`;
}
function parseDiscordAction(customId, values) {
    const raw = customId?.trim();
    const selectValue = values?.[0]?.trim();
    if (!raw)
        return { kind: "choose_option", ...(selectValue ? { value: selectValue } : {}) };
    const [scope, actionId, ...rest] = raw.split(":");
    const tail = rest.join(":") || undefined;
    if (scope === "approval") {
        const approvalDecision = toApprovalDecision(actionId);
        return {
            kind: "approval",
            ...(actionId ? { actionId } : {}),
            ...(approvalDecision ? { approvalDecision } : {}),
            ...(tail ? { correlationId: tail } : {}),
            value: selectValue ?? raw,
        };
    }
    if (scope === "approve" && actionId) {
        const approvalDecision = rest[0] === "all" ? "allow_run" : rest[0] === "once" ? "allow_once" : "allow_once";
        return {
            kind: "approval",
            actionId: approvalDecision,
            approvalDecision,
            correlationId: actionId,
            value: selectValue ?? raw,
        };
    }
    if (scope === "deny" && actionId) {
        return {
            kind: "approval",
            actionId: "deny",
            approvalDecision: "deny",
            correlationId: actionId,
            value: selectValue ?? raw,
        };
    }
    if (scope === "cancel")
        return { kind: "cancel", actionId: actionId || scope, ...(tail ? { correlationId: tail } : {}), value: selectValue ?? raw };
    if (scope === "retry")
        return { kind: "retry", actionId: actionId || scope, ...(tail ? { correlationId: tail } : {}), value: selectValue ?? raw };
    return { kind: "choose_option", actionId: actionId || scope || "unknown", ...(tail ? { correlationId: tail } : {}), value: selectValue ?? raw };
}
function toApprovalDecision(actionId) {
    if (actionId === "allow_once" || actionId === "allow_run" || actionId === "deny")
        return actionId;
    return undefined;
}
function parseDiscordTimestamp(value, now) {
    const parsed = value ? Date.parse(value) : Number.NaN;
    return Number.isFinite(parsed) ? parsed : now?.() ?? Date.now();
}
function resolveUnsupportedMessageCapability(capabilities, message) {
    if ((message.actions?.length ?? 0) > 0 && !capabilities.supportsButtons)
        return "supportsButtons";
    if ((message.attachments?.length ?? 0) > 0 && !capabilities.supportsFiles)
        return "supportsFiles";
    return null;
}
function applyDiscordThreadPolicy(message) {
    const threadId = message.threadPolicy.mode === "none"
        ? undefined
        : message.threadPolicy.threadId ?? message.target.threadId;
    const target = {
        ...message.target,
        ...(threadId ? { threadId } : {}),
    };
    if (!threadId)
        delete target.threadId;
    return { ...message, target };
}
function normalizeStringList(values) {
    return [...new Set(values.map((value) => value?.trim() ?? "").filter(Boolean))];
}
function nonEmptyString(value) {
    return Boolean(value?.trim());
}
function normalizeHeaders(headers) {
    const normalized = {};
    for (const [key, value] of Object.entries(headers)) {
        const stringified = stringValue(value);
        if (stringified)
            normalized[key.toLowerCase()] = stringified;
    }
    return normalized;
}
function normalizeHex(value) {
    return value?.trim().toLowerCase().replace(/^0x/, "") ?? "";
}
function stringValue(value) {
    if (typeof value === "string")
        return value;
    if (Array.isArray(value) && typeof value[0] === "string")
        return value[0];
    return undefined;
}
function asRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value)
        ? value
        : {};
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function buildDiscordSignatureValidationInput(input) {
    const output = {};
    if (input.publicKey !== undefined)
        output.publicKey = input.publicKey;
    if (input.signature !== undefined)
        output.signature = input.signature;
    if (input.timestamp !== undefined)
        output.timestamp = input.timestamp;
    if (input.body !== undefined)
        output.body = input.body;
    return output;
}
function discordDoctorDetail(doctor) {
    return JSON.parse(JSON.stringify({ doctor }));
}
function isRateLimitError(error) {
    const record = asRecord(error);
    return record.status === 429 || record.code === 429 || record.errorCode === "rate_limited";
}
function readRetryAfter(error) {
    const record = asRecord(error);
    const value = record.retryAfterMs ?? record.retry_after_ms ?? record.retry_after;
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
//# sourceMappingURL=adapter.js.map