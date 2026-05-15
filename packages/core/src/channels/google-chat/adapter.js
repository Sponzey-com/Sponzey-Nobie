import { buildUnsupportedCapabilityReceipt, createRawPayloadRef, defineChannelAdapter, defineChannelCapabilities, resolveDeliveryReceiptStatus, } from "../contracts.js";
import { getGoogleChatRuntimeStatus, setGoogleChatRuntimeError, setGoogleChatRuntimeRunning, stopGoogleChatRuntime, } from "./runtime.js";
const DEFAULT_CHANNEL_ID = "google_chat:primary";
const DEFAULT_CONNECTION_ID = "google_chat:primary";
const GOOGLE_CHAT_MAX_MESSAGE_LENGTH = 4096;
const DEFAULT_CONTINUATION_LOOKUP_WINDOW_MS = 24 * 60 * 60 * 1000;
const DEFAULT_DEDUPE_WINDOW_MS = 60_000;
const DEFAULT_REQUIRED_SCOPES = ["chat.bot"];
export function buildGoogleChatCapabilityManifest() {
    return defineChannelCapabilities({
        provider: "google_chat",
        connectionKind: "webhook",
        supportsThreads: true,
        supportsReplies: true,
        supportsEdits: false,
        supportsDeletes: false,
        supportsReactions: false,
        supportsButtons: true,
        supportsModals: false,
        supportsFiles: true,
        supportsImages: true,
        supportsTypingIndicator: false,
        maxMessageLength: GOOGLE_CHAT_MAX_MESSAGE_LENGTH,
        maxAttachmentSizeBytes: 25 * 1024 * 1024,
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
export function buildGoogleChatWorkspaceDoctor(config) {
    const issues = [];
    const grantedScopes = normalizeStringList(config?.grantedScopes ?? []);
    const requiredScopes = normalizeStringList(DEFAULT_REQUIRED_SCOPES);
    const allowedSpaceIds = normalizeStringList(config?.allowedSpaceIds ?? []);
    const deployedSpaceIds = normalizeStringList(config?.deployedSpaceIds ?? []);
    const hasAppCredential = nonEmptyString(config?.appCredentialJson)
        || nonEmptyString(config?.serviceAccountEmail)
        || nonEmptyString(config?.projectId);
    if (config?.enabled && !hasAppCredential) {
        issues.push({
            code: "google_chat_app_credential_missing",
            severity: "error",
            message: "Google Chat app credential, service account email, or project id is required.",
        });
    }
    if (config?.enabled && !nonEmptyString(config?.verificationToken)) {
        issues.push({
            code: "google_chat_verification_token_missing",
            severity: "error",
            message: "Google Chat request verification token is required before events can be accepted.",
        });
    }
    if (config?.enabled && !nonEmptyString(config?.webhookUrl)) {
        issues.push({
            code: "google_chat_webhook_url_missing",
            severity: "warning",
            message: "Google Chat webhook/event endpoint URL is not configured.",
        });
    }
    if (config?.enabled && config.appPublished !== true) {
        issues.push({
            code: "google_chat_app_not_published",
            severity: "warning",
            message: "Google Chat app publication/deployment has not been confirmed.",
        });
    }
    for (const scope of requiredScopes) {
        if (config?.enabled && !grantedScopes.includes(scope)) {
            issues.push({
                code: `google_chat_scope_missing:${scope}`,
                severity: "warning",
                message: `Google Chat OAuth scope is not listed as granted: ${scope}.`,
            });
        }
    }
    if (allowedSpaceIds.length > 0 && deployedSpaceIds.length > 0) {
        for (const spaceId of allowedSpaceIds) {
            if (!deployedSpaceIds.includes(spaceId)) {
                issues.push({
                    code: `google_chat_space_not_deployed:${spaceId}`,
                    severity: "warning",
                    message: `Google Chat app deployment was not confirmed for allowed space ${spaceId}.`,
                });
            }
        }
    }
    return {
        ok: !issues.some((issue) => issue.severity === "error"),
        issues,
        requiredScopes,
        grantedScopes,
        workspaceAppPublished: config?.appPublished === true,
        webhookConfigured: nonEmptyString(config?.webhookUrl),
        requestVerificationConfigured: nonEmptyString(config?.verificationToken),
        deployedSpaceIds,
    };
}
export function resolveGoogleChatConnectionPolicy(input) {
    const doctor = buildGoogleChatWorkspaceDoctor(input.config);
    const blockingIssue = doctor.issues.find((issue) => issue.severity === "error");
    if (blockingIssue) {
        return {
            mode: "webhook",
            supported: true,
            canStart: false,
            healthStatus: "failed",
            reason: blockingIssue.code.includes("verification") ? "missing_verification_token" : "missing_app_credential",
            message: blockingIssue.message,
            doctor,
        };
    }
    const missingScope = doctor.issues.find((issue) => issue.code.startsWith("google_chat_scope_missing:"));
    if (missingScope) {
        return {
            mode: "webhook",
            supported: true,
            canStart: true,
            healthStatus: "degraded",
            reason: "missing_scope",
            message: missingScope.message,
            doctor,
        };
    }
    const unpublished = doctor.issues.find((issue) => issue.code === "google_chat_app_not_published");
    if (unpublished) {
        return {
            mode: "webhook",
            supported: true,
            canStart: true,
            healthStatus: "degraded",
            reason: "app_not_published",
            message: unpublished.message,
            doctor,
        };
    }
    return {
        mode: "webhook",
        supported: true,
        canStart: true,
        healthStatus: "healthy",
        reason: "ready",
        message: "Google Chat webhook runtime is ready.",
        doctor,
    };
}
export function validateGoogleChatRequestAuth(input) {
    const expected = input.verificationToken?.trim();
    if (!expected)
        return { valid: false, reason: "missing_verification_token" };
    const received = input.receivedToken?.trim() || parseBearerToken(input.authorization);
    if (!received)
        return { valid: false, reason: "missing_request_auth" };
    return received === expected
        ? { valid: true, reason: "matched" }
        : { valid: false, reason: "mismatch" };
}
export function normalizeGoogleChatInboundEvent(rawPayload, options = {}) {
    const request = extractGoogleChatRequest(rawPayload);
    if (!isGoogleChatAuthValid(request, options.verificationToken))
        return [];
    const body = request.body;
    if (body.type !== "MESSAGE" || !body.message)
        return [];
    return normalizeGoogleChatMessage(body, rawPayload, options);
}
export function normalizeGoogleChatCardAction(rawPayload, options = {}) {
    const request = extractGoogleChatRequest(rawPayload);
    if (!isGoogleChatAuthValid(request, options.verificationToken))
        return [];
    const body = request.body;
    if (body.type !== "CARD_CLICKED")
        return [];
    const sender = normalizeGoogleChatUser(body.user ?? body.message?.sender ?? {});
    if (!sender.id)
        return [];
    const actionName = body.action?.actionMethodName ?? body.commonEventObject?.invokedFunction;
    const parsed = parseGoogleChatAction(actionName, body.action?.parameters, body.commonEventObject?.parameters);
    const timestamp = parseGoogleChatTimestamp(body.eventTime, options.now);
    const space = body.space ?? body.message?.space;
    const messageName = body.message?.name;
    const threadName = body.message?.thread?.name;
    return [{
            channelId: options.channelId ?? DEFAULT_CHANNEL_ID,
            provider: "google_chat",
            connectionId: options.connectionId ?? DEFAULT_CONNECTION_ID,
            interactionId: `${messageName ?? "card"}:${parsed.actionId ?? parsed.kind}:${timestamp}`,
            kind: parsed.kind,
            sender,
            timestamp,
            rawPayloadRef: createRawPayloadRef({ provider: "google_chat", payload: rawPayload, createdAt: timestamp }),
            ...(messageName ? { messageId: extractResourceId(messageName, "messages") } : {}),
            ...(threadName ? { threadId: extractResourceId(threadName, "threads") } : {}),
            ...(space?.name ? { room: normalizeGoogleChatRoom(space) } : {}),
            ...(parsed.actionId ? { actionId: parsed.actionId } : {}),
            ...(parsed.value ? { value: parsed.value } : {}),
            ...(parsed.approvalDecision ? { approvalDecision: parsed.approvalDecision } : {}),
            ...(parsed.correlationId ? { correlationId: parsed.correlationId } : {}),
        }];
}
export function buildGoogleChatContinuationLookupCandidate(envelope, options = {}) {
    if (envelope.provider !== "google_chat" || !envelope.threadId || !envelope.room?.id)
        return null;
    return {
        provider: "google_chat",
        spaceId: envelope.room.id,
        threadId: envelope.threadId,
        messageId: envelope.messageId,
        senderId: envelope.sender.id,
        timestamp: envelope.timestamp,
        lookupWindowMs: options.lookupWindowMs ?? DEFAULT_CONTINUATION_LOOKUP_WINDOW_MS,
    };
}
export class GoogleChatChannelAdapter {
    channelId;
    provider = "google_chat";
    connectionId;
    config;
    transport;
    now;
    botUserId;
    dedupeWindowMs;
    seenInboundEvents = new Map();
    constructor(options = {}) {
        this.channelId = options.channelId ?? DEFAULT_CHANNEL_ID;
        this.connectionId = options.connectionId ?? DEFAULT_CONNECTION_ID;
        this.config = options.config;
        this.transport = options.transport;
        this.now = options.now ?? Date.now;
        this.botUserId = options.botUserId;
        this.dedupeWindowMs = options.dedupeWindowMs ?? DEFAULT_DEDUPE_WINDOW_MS;
    }
    async start() {
        const policy = resolveGoogleChatConnectionPolicy({ config: this.config });
        if (!policy.canStart) {
            setGoogleChatRuntimeError(policy.message);
            throw new Error(policy.message);
        }
        try {
            await this.transport?.start?.();
            setGoogleChatRuntimeRunning(true);
            setGoogleChatRuntimeError(null);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            setGoogleChatRuntimeError(message);
            throw error;
        }
    }
    async stop() {
        await this.transport?.stop?.();
        stopGoogleChatRuntime();
    }
    async healthCheck() {
        const runtime = getGoogleChatRuntimeStatus();
        const policy = resolveGoogleChatConnectionPolicy({ config: this.config });
        if (!policy.canStart) {
            return {
                status: policy.healthStatus,
                checkedAt: this.now(),
                message: policy.message,
                detail: googleChatDoctorDetail(policy.doctor),
            };
        }
        if (this.transport?.healthCheck)
            return this.transport.healthCheck();
        if (runtime.lastError)
            return { status: "failed", checkedAt: this.now(), message: runtime.lastError, detail: googleChatDoctorDetail(policy.doctor) };
        return {
            status: runtime.isRunning ? policy.healthStatus : "stopped",
            checkedAt: this.now(),
            message: runtime.isRunning ? policy.message : "Google Chat webhook runtime is stopped.",
            detail: googleChatDoctorDetail(policy.doctor),
        };
    }
    getCapabilities() {
        return buildGoogleChatCapabilityManifest();
    }
    async normalizeInbound(rawPayload) {
        const options = {
            channelId: this.channelId,
            connectionId: this.connectionId,
            now: this.now,
        };
        if (this.config?.verificationToken !== undefined)
            options.verificationToken = this.config.verificationToken;
        if (this.botUserId !== undefined)
            options.botUserId = this.botUserId;
        return normalizeGoogleChatInboundEvent(rawPayload, options)
            .filter((envelope) => !this.markInboundEventSeen(envelope.dedupeKey));
    }
    async normalizeInteraction(rawPayload) {
        const options = {
            channelId: this.channelId,
            connectionId: this.connectionId,
            now: this.now,
        };
        if (this.config?.verificationToken !== undefined)
            options.verificationToken = this.config.verificationToken;
        return normalizeGoogleChatCardAction(rawPayload, options);
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
        const outboundMessage = applyGoogleChatThreadPolicy(message);
        if (!outboundMessage.target.roomId) {
            return {
                channelId: outboundMessage.channelId,
                provider: outboundMessage.provider,
                connectionId: outboundMessage.connectionId,
                target: outboundMessage.target,
                status: "blocked_by_policy",
                timestamp: this.now(),
                idempotencyKey: outboundMessage.idempotencyKey,
                errorCode: "google_chat_space_id_required",
                errorMessage: "Google Chat outbound delivery requires target.roomId.",
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
                            provider: "google_chat",
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
                errorCode: isRateLimitError(error) ? "google_chat_rate_limited" : "google_chat_send_failed",
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
export function createGoogleChatChannelAdapter(options = {}) {
    return defineChannelAdapter(new GoogleChatChannelAdapter(options));
}
function normalizeGoogleChatMessage(body, rawPayload, options) {
    const opts = options ?? {};
    const message = body.message;
    if (!message?.name)
        return [];
    const sender = normalizeGoogleChatUser(body.user ?? message.sender ?? {});
    if (!sender.id)
        return [];
    if (sender.providerType === "bot")
        return [];
    if (opts.botUserId && sender.id === opts.botUserId)
        return [];
    const text = (message.argumentText ?? message.text ?? "").trim();
    const attachments = normalizeGoogleChatAttachments(message.attachment ?? []);
    if (!text && attachments.length === 0)
        return [];
    const space = body.space ?? message.space;
    const spaceId = extractResourceId(space?.name, "spaces");
    if (!spaceId)
        return [];
    const threadId = extractResourceId(message.thread?.name, "threads");
    const messageId = extractResourceId(message.name, "messages") || message.name;
    const timestamp = parseGoogleChatTimestamp(message.createTime ?? body.eventTime, opts.now);
    return [{
            channelId: opts.channelId ?? DEFAULT_CHANNEL_ID,
            provider: "google_chat",
            connectionId: opts.connectionId ?? DEFAULT_CONNECTION_ID,
            messageId,
            ...(threadId ? { threadId } : {}),
            sender,
            room: normalizeGoogleChatRoom(space ?? { name: `spaces/${spaceId}` }),
            text,
            attachments,
            mentions: [],
            timestamp,
            rawPayloadRef: createRawPayloadRef({ provider: "google_chat", payload: rawPayload, createdAt: timestamp }),
            ...(threadId
                ? { continuationContext: { parentMessageId: threadId, source: "thread" } }
                : {}),
            dedupeKey: `google_chat:${spaceId}:${threadId ?? "main"}:${messageId}`,
        }];
}
function extractGoogleChatRequest(rawPayload) {
    const record = asRecord(rawPayload);
    const headers = normalizeHeaders(asRecord(record.headers));
    const body = isRecord(record.body) ? record.body : record;
    const request = { body };
    const token = stringValue(headers["x-goog-chat-token"] ?? headers["x-google-chat-token"] ?? record.token ?? body.token);
    const authorization = stringValue(headers.authorization ?? record.authorization);
    if (token !== undefined)
        request.receivedToken = token;
    if (authorization !== undefined)
        request.authorization = authorization;
    return request;
}
function isGoogleChatAuthValid(request, verificationToken) {
    const authInput = {};
    if (verificationToken !== undefined)
        authInput.verificationToken = verificationToken;
    if (request.receivedToken !== undefined)
        authInput.receivedToken = request.receivedToken;
    if (request.authorization !== undefined)
        authInput.authorization = request.authorization;
    const verification = validateGoogleChatRequestAuth(authInput);
    return verification.valid;
}
function normalizeGoogleChatUser(user) {
    const id = extractResourceId(user.name, "users") || user.name?.trim() || "";
    const isBot = user.type === "BOT";
    return {
        id,
        ...(user.displayName ? { displayName: user.displayName } : {}),
        ...(user.email ? { email: user.email } : {}),
        ...(typeof isBot === "boolean" ? { isBot } : {}),
        providerType: isBot ? "bot" : "user",
    };
}
function normalizeGoogleChatRoom(space) {
    const id = extractResourceId(space.name, "spaces") || space.name?.trim() || "";
    return {
        id,
        ...(space.displayName ? { displayName: space.displayName } : {}),
        type: space.type === "DM" ? "direct" : "channel",
    };
}
function normalizeGoogleChatAttachments(attachments) {
    return attachments
        .map((attachment) => {
        const id = attachment.name?.trim() || attachment.attachmentDataRef?.resourceName?.trim() || attachment.driveDataRef?.driveFileId?.trim();
        if (!id)
            return null;
        const mimeType = attachment.contentType?.trim();
        return {
            id,
            ...(attachment.contentName ? { name: attachment.contentName } : {}),
            ...(mimeType ? { mimeType } : {}),
            kind: mimeType?.startsWith("image/") ? "image" : "file",
            contentRef: attachment.attachmentDataRef?.resourceName ?? attachment.driveDataRef?.driveFileId ?? `google_chat:attachment:${id}`,
        };
    })
        .filter((attachment) => Boolean(attachment));
}
function parseGoogleChatAction(actionMethodName, parameters, commonParameters) {
    const raw = actionMethodName?.trim();
    const parameterMap = new Map();
    for (const parameter of parameters ?? []) {
        if (parameter.key && parameter.value)
            parameterMap.set(parameter.key, parameter.value);
    }
    for (const [key, value] of Object.entries(commonParameters ?? {})) {
        if (value)
            parameterMap.set(key, value);
    }
    const parameterValue = parameterMap.get("value") ?? parameterMap.get("runId") ?? parameterMap.get("correlationId");
    if (!raw)
        return { kind: "choose_option", ...(parameterValue ? { value: parameterValue } : {}) };
    const [scope, actionId, ...rest] = raw.split(":");
    const tail = rest.join(":") || parameterMap.get("runId") || parameterMap.get("correlationId") || undefined;
    if (scope === "approval") {
        const approvalDecision = toApprovalDecision(actionId);
        return {
            kind: "approval",
            ...(actionId ? { actionId } : {}),
            ...(approvalDecision ? { approvalDecision } : {}),
            ...(tail ? { correlationId: tail } : {}),
            value: parameterValue ?? raw,
        };
    }
    if (scope === "approve" && actionId) {
        const approvalDecision = rest[0] === "all" ? "allow_run" : "allow_once";
        return {
            kind: "approval",
            actionId: approvalDecision,
            approvalDecision,
            correlationId: actionId,
            value: parameterValue ?? raw,
        };
    }
    if (scope === "deny" && actionId) {
        return {
            kind: "approval",
            actionId: "deny",
            approvalDecision: "deny",
            correlationId: actionId,
            value: parameterValue ?? raw,
        };
    }
    if (scope === "cancel")
        return { kind: "cancel", actionId: actionId || scope, ...(tail ? { correlationId: tail } : {}), value: parameterValue ?? raw };
    if (scope === "retry")
        return { kind: "retry", actionId: actionId || scope, ...(tail ? { correlationId: tail } : {}), value: parameterValue ?? raw };
    return { kind: "choose_option", actionId: actionId || scope || "unknown", ...(tail ? { correlationId: tail } : {}), value: parameterValue ?? raw };
}
function toApprovalDecision(actionId) {
    if (actionId === "allow_once" || actionId === "allow_run" || actionId === "deny")
        return actionId;
    return undefined;
}
function extractResourceId(value, segment) {
    const trimmed = value?.trim();
    if (!trimmed)
        return "";
    const parts = trimmed.split("/");
    const index = parts.indexOf(segment);
    if (index >= 0 && parts[index + 1])
        return parts[index + 1];
    return parts.at(-1) ?? trimmed;
}
function parseGoogleChatTimestamp(value, now) {
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
function applyGoogleChatThreadPolicy(message) {
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
function parseBearerToken(value) {
    const match = value?.trim().match(/^Bearer\s+(.+)$/i);
    return match?.[1]?.trim() ?? "";
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
function googleChatDoctorDetail(doctor) {
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