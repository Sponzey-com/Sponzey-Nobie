import { replaceChannelIdentityMappings, upsertChannelCapability, upsertChannelConnection, } from "../db/index.js";
import { namespaceChannelPrincipal, parseNamespacedChannelPrincipal, } from "./identity.js";
import { buildSlackCapabilityManifest } from "./slack/adapter.js";
import { buildTelegramCapabilityManifest } from "./telegram/adapter.js";
const TELEGRAM_CONNECTION_ID = "telegram:primary";
const SLACK_CONNECTION_ID = "slack:primary";
function normalizeProvider(provider) {
    return provider.trim().toLowerCase().replace(/^provider:/, "").replace(/[-\s]+/g, "_");
}
function uniqueStrings(values) {
    const seen = new Set();
    const output = [];
    for (const value of values) {
        const id = String(value ?? "").trim();
        if (!id || seen.has(id))
            continue;
        seen.add(id);
        output.push(id);
    }
    return output;
}
export function namespaceChannelIdentity(provider, kind, providerIdentityId, scope) {
    return namespaceChannelPrincipal({ provider, kind, providerIdentityId, scope });
}
export function parseNamespacedChannelIdentity(namespaceId) {
    const parsed = parseNamespacedChannelPrincipal(namespaceId);
    if (!parsed)
        return null;
    const { provider, kind, providerIdentityId } = parsed;
    if (!["user", "room", "thread", "bot", "unknown"].includes(kind))
        return null;
    return {
        provider,
        kind: kind,
        providerIdentityId,
    };
}
function buildAllowedPrincipals(provider, kind, ids) {
    return uniqueStrings(ids).map((id) => ({
        namespaceId: namespaceChannelIdentity(provider, kind, id),
        provider,
        kind,
        providerIdentityId: id,
    }));
}
function secretRef(provider, key, present) {
    return {
        key,
        ref: `config:${provider}.${key}`,
        source: "config",
        present,
        redacted: true,
    };
}
function defaultDeliveryPolicy() {
    return {
        inbound: {
            requireAllowedPrincipal: true,
            allowUnlisted: false,
        },
        outbound: {
            defaultThreadPolicy: "reuse_origin_thread",
            fallbackChannel: "webui",
        },
    };
}
function telegramCapabilities() {
    return buildTelegramCapabilityManifest();
}
function slackCapabilities() {
    return buildSlackCapabilityManifest();
}
function resolveHealth(input) {
    if (input.runtime?.isRunning)
        return { status: "healthy", message: "Runtime is running." };
    if (input.runtime?.lastError)
        return { status: "failed", message: input.runtime.lastError };
    if (input.enabled && input.configured)
        return { status: "stopped", message: "Configured but runtime is stopped." };
    if (input.enabled && !input.configured)
        return { status: "failed", message: "Enabled but required secrets are missing." };
    return { status: "stopped", message: null };
}
function buildTelegramConnection(config, runtime, now) {
    const telegram = config.telegram;
    const enabled = telegram?.enabled === true;
    const configured = Boolean(telegram?.botToken?.trim());
    const health = runtime
        ? resolveHealth({ enabled, configured, runtime })
        : resolveHealth({ enabled, configured });
    const provider = "telegram";
    const capabilityManifest = telegramCapabilities();
    return {
        connectionId: TELEGRAM_CONNECTION_ID,
        provider,
        displayName: "Telegram",
        connectionMode: "bot_api",
        enabled,
        configured,
        health: { ...health, checkedAt: now },
        capabilityManifest,
        authSecretRefs: [secretRef(provider, "botToken", configured)],
        allowedUsers: buildAllowedPrincipals(provider, "user", telegram?.allowedUserIds ?? []),
        allowedRooms: buildAllowedPrincipals(provider, "room", telegram?.allowedGroupIds ?? []),
        defaultDeliveryPolicy: defaultDeliveryPolicy(),
        source: provider,
        configSource: "compat",
        createdAt: now,
        updatedAt: now,
        schemaVersion: 1,
    };
}
function buildSlackConnection(config, runtime, now) {
    const slack = config.slack;
    const enabled = slack?.enabled === true;
    const hasBotToken = Boolean(slack?.botToken?.trim());
    const hasAppToken = Boolean(slack?.appToken?.trim());
    const configured = hasBotToken && hasAppToken;
    const health = runtime
        ? resolveHealth({ enabled, configured, runtime })
        : resolveHealth({ enabled, configured });
    const provider = "slack";
    const capabilityManifest = slackCapabilities();
    return {
        connectionId: SLACK_CONNECTION_ID,
        provider,
        displayName: "Slack",
        connectionMode: "socket",
        enabled,
        configured,
        health: { ...health, checkedAt: now },
        capabilityManifest,
        authSecretRefs: [
            secretRef(provider, "botToken", hasBotToken),
            secretRef(provider, "appToken", hasAppToken),
        ],
        allowedUsers: buildAllowedPrincipals(provider, "user", slack?.allowedUserIds ?? []),
        allowedRooms: buildAllowedPrincipals(provider, "room", slack?.allowedChannelIds ?? []),
        defaultDeliveryPolicy: defaultDeliveryPolicy(),
        source: provider,
        configSource: "compat",
        createdAt: now,
        updatedAt: now,
        schemaVersion: 1,
    };
}
export function buildCompatChannelConnectionsFromConfig(config, options = {}) {
    const now = options.now ?? Date.now();
    return [
        buildTelegramConnection(config, options.runtime?.telegram, now),
        buildSlackConnection(config, options.runtime?.slack, now),
    ];
}
function identityMappingsForConnection(connection) {
    const principals = [...connection.allowedUsers, ...connection.allowedRooms];
    return principals.map((principal) => ({
        id: `${connection.connectionId}:${principal.namespaceId}`,
        connectionId: connection.connectionId,
        provider: connection.provider,
        namespaceId: principal.namespaceId,
        identityKind: principal.kind,
        providerIdentityId: principal.providerIdentityId,
        displayNameSnapshot: principal.displayNameSnapshot ?? null,
        createdAt: connection.createdAt,
        updatedAt: connection.updatedAt,
    }));
}
export function persistChannelConnections(connections) {
    for (const connection of connections) {
        upsertChannelConnection({
            connectionId: connection.connectionId,
            provider: connection.provider,
            displayName: connection.displayName,
            connectionMode: connection.connectionMode,
            enabled: connection.enabled,
            configured: connection.configured,
            healthStatus: connection.health.status,
            healthMessage: connection.health.message,
            capabilityManifest: connection.capabilityManifest,
            authSecretRefs: connection.authSecretRefs,
            allowedUsers: connection.allowedUsers,
            allowedRooms: connection.allowedRooms,
            defaultDeliveryPolicy: connection.defaultDeliveryPolicy,
            source: connection.source,
            configSource: connection.configSource,
            createdAt: connection.createdAt,
            updatedAt: connection.updatedAt,
        });
        upsertChannelCapability({
            connectionId: connection.connectionId,
            provider: connection.provider,
            manifest: connection.capabilityManifest,
            createdAt: connection.createdAt,
            updatedAt: connection.updatedAt,
        });
        replaceChannelIdentityMappings(connection.connectionId, identityMappingsForConnection(connection));
    }
}
export function buildSettingsChannelConnectionSnapshot(input) {
    const options = {};
    if (input.runtime !== undefined)
        options.runtime = input.runtime;
    if (input.now !== undefined)
        options.now = input.now;
    const connections = buildCompatChannelConnectionsFromConfig(input.config, options);
    if (input.persist !== false)
        persistChannelConnections(connections);
    return connections;
}
function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function asConnectionPatchArray(value) {
    if (Array.isArray(value))
        return value.filter(isRecord);
    if (isRecord(value) && Array.isArray(value.connections))
        return value.connections.filter(isRecord);
    return [];
}
function readProviderIdentityIds(value, provider, kind) {
    if (!Array.isArray(value))
        return [];
    const ids = [];
    for (const item of value) {
        if (typeof item === "string") {
            const parsed = parseNamespacedChannelIdentity(item);
            if (parsed && parsed.provider === provider && parsed.kind === kind)
                ids.push(parsed.providerIdentityId);
            else if (!parsed)
                ids.push(item);
            continue;
        }
        if (!isRecord(item))
            continue;
        const namespaceId = typeof item.namespaceId === "string" ? item.namespaceId : "";
        const parsed = namespaceId ? parseNamespacedChannelIdentity(namespaceId) : null;
        if (parsed && parsed.provider === provider && parsed.kind === kind) {
            ids.push(parsed.providerIdentityId);
            continue;
        }
        const providerIdentityId = typeof item.providerIdentityId === "string" || typeof item.providerIdentityId === "number"
            ? String(item.providerIdentityId)
            : typeof item.id === "string" || typeof item.id === "number"
                ? String(item.id)
                : "";
        if (providerIdentityId.trim())
            ids.push(providerIdentityId);
    }
    return uniqueStrings(ids);
}
function toTelegramNumericIds(ids) {
    return ids
        .map((id) => Number(id))
        .filter((id) => Number.isFinite(id))
        .map((id) => Math.trunc(id));
}
function ensureRawSection(raw, key) {
    if (!isRecord(raw[key]))
        raw[key] = {};
    return raw[key];
}
export function applyChannelConnectionSettingsCompatPatch(raw, channelsPatch) {
    const appliedConnectionIds = [];
    for (const connection of asConnectionPatchArray(channelsPatch)) {
        const provider = normalizeProvider(String(connection.provider ?? ""));
        const connectionId = String(connection.connectionId ?? connection.id ?? "").trim();
        if (provider === "telegram" || connectionId === TELEGRAM_CONNECTION_ID) {
            const rawTelegram = ensureRawSection(raw, "telegram");
            if (typeof connection.enabled === "boolean")
                rawTelegram.enabled = connection.enabled;
            if (Object.prototype.hasOwnProperty.call(connection, "allowedUsers")) {
                rawTelegram.allowedUserIds = toTelegramNumericIds(readProviderIdentityIds(connection.allowedUsers, "telegram", "user"));
            }
            if (Object.prototype.hasOwnProperty.call(connection, "allowedRooms")) {
                rawTelegram.allowedGroupIds = toTelegramNumericIds(readProviderIdentityIds(connection.allowedRooms, "telegram", "room"));
            }
            appliedConnectionIds.push(TELEGRAM_CONNECTION_ID);
            continue;
        }
        if (provider === "slack" || connectionId === SLACK_CONNECTION_ID) {
            const rawSlack = ensureRawSection(raw, "slack");
            if (typeof connection.enabled === "boolean")
                rawSlack.enabled = connection.enabled;
            if (Object.prototype.hasOwnProperty.call(connection, "allowedUsers")) {
                rawSlack.allowedUserIds = readProviderIdentityIds(connection.allowedUsers, "slack", "user");
            }
            if (Object.prototype.hasOwnProperty.call(connection, "allowedRooms")) {
                rawSlack.allowedChannelIds = readProviderIdentityIds(connection.allowedRooms, "slack", "room");
            }
            appliedConnectionIds.push(SLACK_CONNECTION_ID);
        }
    }
    return { appliedConnectionIds: uniqueStrings(appliedConnectionIds) };
}
export function channelConnectionSecretsToJson(value) {
    return value.authSecretRefs.map((ref) => ({
        key: ref.key,
        ref: ref.ref,
        source: ref.source,
        present: ref.present,
        redacted: ref.redacted,
    }));
}
//# sourceMappingURL=connections.js.map