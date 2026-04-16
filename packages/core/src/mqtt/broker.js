import { createServer } from "node:net";
import aedesPackage from "aedes";
import { getConfig } from "../config/index.js";
import { createLogger } from "../logger/index.js";
const log = createLogger("mqtt:broker");
const MQTT_DISABLED_REASON = "MQTT 브로커가 비활성화되어 있습니다.";
const MQTT_STOPPED_REASON = "MQTT 브로커가 중지되었습니다.";
const MQTT_MISSING_CREDENTIALS_REASON = "MQTT 브로커를 켜려면 아이디와 비밀번호를 모두 입력해야 합니다.";
const MQTT_HOST_REQUIRED_REASON = "MQTT 호스트를 입력해야 합니다.";
const MQTT_PORT_INVALID_REASON = "MQTT 포트는 1에서 65535 사이여야 합니다.";
let broker = null;
let server = null;
const activeClientsById = new Map();
const claimedExtensionOwners = new Map();
const claimedExtensionsByClient = new Map();
const extensionSnapshots = new Map();
const exchangeLogs = [];
const MAX_EXCHANGE_LOGS = 120;
let exchangeLogSequence = 0;
const SNAPSHOT_DEFAULTS = {
    enabled: false,
    running: false,
    host: "0.0.0.0",
    port: 1883,
    url: "mqtt://0.0.0.0:1883",
    clientCount: 0,
    authEnabled: false,
    allowAnonymous: false,
    reason: MQTT_DISABLED_REASON,
};
let snapshot = { ...SNAPSHOT_DEFAULTS };
function buildSnapshot(overrides) {
    const base = snapshot;
    const host = overrides.host ?? base.host;
    const port = overrides.port ?? base.port;
    return {
        enabled: overrides.enabled ?? base.enabled,
        running: overrides.running ?? base.running,
        host,
        port,
        url: `mqtt://${host}:${port}`,
        clientCount: overrides.clientCount ?? base.clientCount,
        authEnabled: overrides.authEnabled ?? base.authEnabled,
        allowAnonymous: overrides.allowAnonymous ?? base.allowAnonymous,
        reason: overrides.reason ?? base.reason,
    };
}
function setSnapshot(overrides) {
    snapshot = buildSnapshot(overrides);
}
function syncClientCount() {
    setSnapshot({ clientCount: broker?.connectedClients ?? 0 });
}
function normalizeCredential(value) {
    if (typeof value === "string")
        return value;
    if (Buffer.isBuffer(value))
        return value.toString("utf8");
    if (value == null)
        return "";
    return String(value);
}
function hasConfiguredCredentials(config) {
    return config.username.trim() !== "" && config.password !== "";
}
function allowsAnonymousConnections(config) {
    return hasConfiguredCredentials(config) ? config.allowAnonymous : false;
}
function createAuthError() {
    return Object.assign(new Error("MQTT 인증에 실패했습니다."), { returnCode: 5 });
}
function parseExtensionTopic(topic) {
    if (typeof topic !== "string")
        return null;
    const match = /^nobie\/v1\/node\/([^/]+)\/(status|capabilities|request|response|event)$/.exec(topic.trim());
    if (!match)
        return null;
    const extensionId = match[1]?.trim();
    const kind = match[2];
    if (!extensionId || !kind)
        return null;
    return { extensionId, kind };
}
function rememberExtensionClaim(extensionId, clientId) {
    claimedExtensionOwners.set(extensionId, clientId);
    const claimed = claimedExtensionsByClient.get(clientId) ?? new Set();
    claimed.add(extensionId);
    claimedExtensionsByClient.set(clientId, claimed);
    const current = extensionSnapshots.get(extensionId);
    extensionSnapshots.set(extensionId, {
        extensionId,
        clientId,
        displayName: current?.displayName ?? null,
        state: current?.state ?? "connected",
        message: current?.message ?? null,
        version: current?.version ?? null,
        methods: current?.methods ?? [],
        lastSeenAt: Date.now(),
    });
}
function releaseExtensionClaimsForClient(clientId) {
    const normalizedClientId = clientId?.trim();
    if (!normalizedClientId)
        return;
    const claimed = claimedExtensionsByClient.get(normalizedClientId);
    if (!claimed)
        return;
    for (const extensionId of claimed) {
        if (claimedExtensionOwners.get(extensionId) === normalizedClientId) {
            claimedExtensionOwners.delete(extensionId);
            const current = extensionSnapshots.get(extensionId);
            if (current) {
                extensionSnapshots.set(extensionId, {
                    ...current,
                    clientId: null,
                    state: "offline",
                    message: "MQTT connection disconnected.",
                    lastSeenAt: Date.now(),
                });
            }
        }
    }
    claimedExtensionsByClient.delete(normalizedClientId);
    activeClientsById.delete(normalizedClientId);
}
function clearExtensionClaims() {
    const now = Date.now();
    for (const [extensionId, current] of extensionSnapshots.entries()) {
        extensionSnapshots.set(extensionId, {
            ...current,
            clientId: null,
            state: "offline",
            message: "MQTT broker is stopped.",
            lastSeenAt: now,
        });
    }
    activeClientsById.clear();
    claimedExtensionOwners.clear();
    claimedExtensionsByClient.clear();
}
function truncateText(value, max = 2_000) {
    if (value.length <= max)
        return value;
    return `${value.slice(0, max)}… (${value.length} chars)`;
}
function isBase64Field(key) {
    if (!key)
        return false;
    const normalized = key.toLowerCase();
    return normalized === "base64" || normalized === "base64_data" || normalized === "base64data";
}
function sanitizePayload(value, parentKey = null) {
    if (typeof value === "string") {
        if (isBase64Field(parentKey)) {
            return `${value.slice(0, 96)}… (${value.length} chars base64)`;
        }
        return truncateText(value, 1_000);
    }
    if (Array.isArray(value)) {
        return value.slice(0, 50).map((item) => sanitizePayload(item, parentKey));
    }
    if (value && typeof value === "object") {
        const entries = Object.entries(value).slice(0, 50);
        return Object.fromEntries(entries.map(([key, item]) => [key, sanitizePayload(item, key)]));
    }
    return value;
}
function parsePacketPayload(payload) {
    if (payload == null)
        return null;
    const text = Buffer.isBuffer(payload)
        ? payload.toString("utf8")
        : typeof payload === "string"
            ? payload
            : String(payload);
    if (!text.trim())
        return null;
    try {
        return sanitizePayload(JSON.parse(text));
    }
    catch {
        return { raw: truncateText(text) };
    }
}
function appendExchangeLog(entry) {
    exchangeLogs.unshift({
        id: `mqtt-log-${Date.now()}-${exchangeLogSequence++}`,
        timestamp: Date.now(),
        ...entry,
    });
    if (exchangeLogs.length > MAX_EXCHANGE_LOGS) {
        exchangeLogs.length = MAX_EXCHANGE_LOGS;
    }
}
function updateExtensionSnapshotFromPayload(extensionId, clientId, kind, payload) {
    const currentOwner = claimedExtensionOwners.get(extensionId);
    if (!currentOwner)
        return;
    if (clientId && currentOwner !== clientId)
        return;
    const objectPayload = payload && typeof payload === "object" && !Array.isArray(payload)
        ? payload
        : null;
    const current = extensionSnapshots.get(extensionId);
    const capabilityMatrix = readCapabilityMatrix(objectPayload);
    const permissions = readObject(objectPayload, "permissions");
    const toolHealth = readObject(objectPayload, "toolHealth", "tool_health");
    const methods = kind === "capabilities"
        ? readCapabilityMethods(objectPayload, capabilityMatrix)
        : current?.methods ?? [];
    const now = Date.now();
    const next = {
        extensionId,
        clientId: clientId ?? current?.clientId ?? currentOwner,
        displayName: (typeof objectPayload?.display_name === "string" && objectPayload.display_name) ||
            (typeof objectPayload?.displayName === "string" && objectPayload.displayName) ||
            current?.displayName ||
            null,
        state: (typeof objectPayload?.state === "string" && objectPayload.state) ||
            current?.state ||
            "connected",
        message: (typeof objectPayload?.message === "string" && objectPayload.message) ||
            current?.message ||
            null,
        version: (typeof objectPayload?.version === "string" && objectPayload.version) ||
            current?.version ||
            null,
        protocolVersion: readString(objectPayload, "protocolVersion", "protocol_version") ?? current?.protocolVersion ?? null,
        gitTag: readString(objectPayload, "gitTag", "git_tag") ?? current?.gitTag ?? null,
        gitCommit: readString(objectPayload, "gitCommit", "git_commit") ?? current?.gitCommit ?? null,
        buildTarget: readString(objectPayload, "buildTarget", "build_target") ?? current?.buildTarget ?? null,
        platform: readString(objectPayload, "platform") ?? current?.platform ?? null,
        os: readString(objectPayload, "os") ?? current?.os ?? null,
        arch: readString(objectPayload, "arch") ?? current?.arch ?? null,
        transport: readStringArray(objectPayload, "transport") ?? current?.transport ?? [],
        capabilityHash: readString(objectPayload, "capabilityHash", "capability_hash") ?? current?.capabilityHash ?? null,
        methods,
        ...(permissions ? { permissions } : current?.permissions ? { permissions: current.permissions } : {}),
        ...(toolHealth ? { toolHealth } : current?.toolHealth ? { toolHealth: current.toolHealth } : {}),
        ...(capabilityMatrix ? { capabilityMatrix } : current?.capabilityMatrix ? { capabilityMatrix: current.capabilityMatrix } : {}),
        lastCapabilityRefreshAt: kind === "capabilities" ? now : current?.lastCapabilityRefreshAt ?? null,
        lastSeenAt: now,
    };
    extensionSnapshots.set(extensionId, next);
}
function readString(payload, ...keys) {
    if (!payload)
        return null;
    for (const key of keys) {
        const value = payload[key];
        if (typeof value === "string" && value.trim())
            return value;
    }
    return null;
}
function readStringArray(payload, key) {
    if (!payload)
        return null;
    const value = payload[key];
    if (typeof value === "string" && value.trim())
        return [value];
    if (Array.isArray(value))
        return value.filter((item) => typeof item === "string" && item.trim() !== "");
    return null;
}
function readObject(payload, ...keys) {
    if (!payload)
        return null;
    for (const key of keys) {
        const value = payload[key];
        if (value && typeof value === "object" && !Array.isArray(value))
            return value;
    }
    return null;
}
function readCapabilityMatrix(payload) {
    if (!payload)
        return null;
    const value = payload.capabilityMatrix ?? payload.capability_matrix;
    if (!value || typeof value !== "object" || Array.isArray(value))
        return null;
    return value;
}
function readCapabilityMethods(payload, capabilityMatrix) {
    if (capabilityMatrix) {
        return Object.entries(capabilityMatrix)
            .filter(([, value]) => {
            if (!value || typeof value !== "object" || Array.isArray(value))
                return false;
            const supported = value.supported;
            return supported !== false;
        })
            .map(([method]) => method);
    }
    if (!Array.isArray(payload?.methods))
        return [];
    return payload.methods
        .map((item) => {
        if (!item || typeof item !== "object")
            return null;
        const candidate = item;
        return typeof candidate.name === "string" ? candidate.name : null;
    })
        .filter((item) => Boolean(item));
}
function handleBrokerPublish(packet, client) {
    const topic = typeof packet?.topic === "string" ? packet.topic : null;
    if (!topic)
        return;
    const ref = parseExtensionTopic(topic);
    if (!ref)
        return;
    const clientId = client?.id?.trim() || null;
    const payload = parsePacketPayload(packet.payload);
    appendExchangeLog({
        direction: ref.kind === "request" ? "nobie_to_extension" : "extension_to_nobie",
        topic,
        extensionId: ref.extensionId,
        kind: ref.kind,
        clientId,
        payload,
    });
    if (ref.kind === "status" || ref.kind === "capabilities") {
        updateExtensionSnapshotFromPayload(ref.extensionId, clientId, ref.kind, payload);
    }
}
function disconnectClient(client) {
    if (!client)
        return;
    queueMicrotask(() => {
        const target = client;
        try {
            if (typeof target.close === "function") {
                target.close();
                return;
            }
        }
        catch { }
        try {
            target.conn?.destroy?.();
            return;
        }
        catch { }
        try {
            target.conn?.end?.();
            return;
        }
        catch { }
        try {
            target.stream?.destroy?.();
        }
        catch { }
    });
}
function enforceUniqueExtensionClaim(client, extensionId, trigger) {
    const clientId = client?.id?.trim();
    if (!clientId)
        return null;
    const currentOwner = claimedExtensionOwners.get(extensionId);
    if (!currentOwner || currentOwner === clientId) {
        rememberExtensionClaim(extensionId, clientId);
        return null;
    }
    const message = `연장 ID "${extensionId}"는 이미 다른 클라이언트(${currentOwner})가 사용 중입니다. ` +
        `같은 연장 ID로 중복 접속할 수 없습니다.`;
    log.warn(`MQTT duplicate extension ID rejected (${clientId}, ${trigger}): ${message}`);
    disconnectClient(client);
    return Object.assign(new Error(message), { returnCode: 5 });
}
export function validateMqttBrokerConfig(config) {
    if (!config.enabled)
        return null;
    if (!config.host.trim())
        return MQTT_HOST_REQUIRED_REASON;
    if (!Number.isFinite(config.port) || config.port < 1 || config.port > 65535)
        return MQTT_PORT_INVALID_REASON;
    if (!hasConfiguredCredentials(config))
        return MQTT_MISSING_CREDENTIALS_REASON;
    return null;
}
function createAedesBroker(config) {
    const candidate = aedesPackage;
    const authRequired = hasConfiguredCredentials(config);
    const allowAnonymous = allowsAnonymousConnections(config);
    const options = {
        authenticate(client, username, password, done) {
            if (!authRequired) {
                done(null, true);
                return;
            }
            const providedUsername = normalizeCredential(username);
            const providedPassword = normalizeCredential(password);
            const matches = providedUsername === config.username &&
                providedPassword === config.password;
            if (matches) {
                done(null, true);
                return;
            }
            if (allowAnonymous && providedUsername === "" && providedPassword === "") {
                done(null, true);
                return;
            }
            const clientId = client?.id ?? "unknown";
            log.warn(`MQTT authentication rejected (${clientId})`);
            done(createAuthError(), false);
        },
        authorizePublish(client, packet, done) {
            const ref = parseExtensionTopic(packet?.topic);
            if (ref && ref.kind !== "request") {
                const error = enforceUniqueExtensionClaim(client, ref.extensionId, "publish");
                if (error) {
                    done(error);
                    return;
                }
            }
            done(null);
        },
        authorizeSubscribe(client, subscription, done) {
            const ref = parseExtensionTopic(subscription?.topic);
            if (ref && ref.kind === "request") {
                const error = enforceUniqueExtensionClaim(client, ref.extensionId, "subscribe");
                if (error) {
                    done(error);
                    return;
                }
            }
            done(null, subscription);
        },
    };
    if (typeof candidate.createBroker === "function") {
        return candidate.createBroker(options);
    }
    if (typeof candidate === "function") {
        return candidate(options);
    }
    throw new Error("Unsupported aedes export shape");
}
export async function startMqttBroker() {
    const config = getConfig().mqtt;
    const authEnabled = hasConfiguredCredentials(config);
    const allowAnonymous = allowsAnonymousConnections(config);
    const validationError = validateMqttBrokerConfig(config);
    setSnapshot({
        enabled: config.enabled,
        running: false,
        host: config.host,
        port: config.port,
        clientCount: 0,
        authEnabled,
        allowAnonymous,
        reason: config.enabled ? validationError : MQTT_DISABLED_REASON,
    });
    if (!config.enabled || validationError) {
        return;
    }
    if (server && broker) {
        syncClientCount();
        setSnapshot({ running: true, reason: null });
        return;
    }
    const brokerInstance = createAedesBroker(config);
    const tcpServer = createServer((socket) => {
        brokerInstance.handle(socket);
    });
    brokerInstance.on("clientReady", syncClientCount);
    brokerInstance.on("clientReady", (client) => {
        const clientId = client?.id?.trim();
        if (clientId && client) {
            activeClientsById.set(clientId, client);
        }
        syncClientCount();
    });
    brokerInstance.on("clientDisconnect", (client) => {
        releaseExtensionClaimsForClient(client?.id);
        syncClientCount();
    });
    brokerInstance.on("publish", (packet, client) => {
        handleBrokerPublish(packet, client);
    });
    brokerInstance.on("clientError", (client, error) => {
        const clientId = client?.id ?? "unknown";
        const message = error instanceof Error ? error.message : String(error);
        log.warn(`MQTT client error (${clientId}): ${message}`);
    });
    brokerInstance.on("connectionError", (client, error) => {
        const clientId = client?.id ?? "unknown";
        const message = error instanceof Error ? error.message : String(error);
        log.warn(`MQTT connection error (${clientId}): ${message}`);
    });
    brokerInstance.on("closed", () => {
        clearExtensionClaims();
        setSnapshot({
            running: false,
            clientCount: 0,
            reason: snapshot.enabled ? MQTT_STOPPED_REASON : MQTT_DISABLED_REASON,
        });
    });
    tcpServer.on("error", (error) => {
        setSnapshot({
            running: false,
            reason: error.message,
        });
        log.error(`MQTT server error: ${error.message}`);
    });
    try {
        await new Promise((resolve, reject) => {
            const onError = (error) => {
                tcpServer.off("listening", onListening);
                reject(error);
            };
            const onListening = () => {
                tcpServer.off("error", onError);
                resolve();
            };
            tcpServer.once("error", onError);
            tcpServer.once("listening", onListening);
            tcpServer.listen(config.port, config.host);
        });
    }
    catch (error) {
        tcpServer.removeAllListeners();
        brokerInstance.close();
        setSnapshot({
            running: false,
            clientCount: 0,
            reason: error instanceof Error ? error.message : String(error),
        });
        throw error;
    }
    broker = brokerInstance;
    server = tcpServer;
    syncClientCount();
    setSnapshot({ running: true, reason: null });
    log.info(`MQTT broker listening on mqtt://${config.host}:${config.port}` +
        ` (auth=${authEnabled ? "enabled" : "disabled"}, anonymous=${allowAnonymous ? "allowed" : "disabled"})`);
}
export async function stopMqttBroker() {
    const activeServer = server;
    const activeBroker = broker;
    server = null;
    broker = null;
    if (activeServer) {
        await new Promise((resolve, reject) => {
            activeServer.close((error) => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve();
            });
        });
    }
    if (activeBroker) {
        await new Promise((resolve) => {
            activeBroker.close(resolve);
        });
    }
    clearExtensionClaims();
    setSnapshot({
        running: false,
        clientCount: 0,
        reason: snapshot.enabled ? MQTT_STOPPED_REASON : MQTT_DISABLED_REASON,
    });
    if (snapshot.enabled) {
        log.info("MQTT broker stopped");
    }
}
export function getMqttBrokerSnapshot() {
    return { ...snapshot };
}
export function getMqttExtensionSnapshots() {
    return Array.from(extensionSnapshots.values()).sort((left, right) => right.lastSeenAt - left.lastSeenAt);
}
export function getMqttExchangeLogs() {
    return exchangeLogs.map((entry) => ({ ...entry }));
}
export async function disconnectMqttExtension(extensionId) {
    const normalized = extensionId.trim();
    if (!normalized) {
        return { ok: false, message: "연장 ID가 비어 있습니다." };
    }
    const clientId = claimedExtensionOwners.get(normalized);
    if (!clientId) {
        return { ok: false, message: `연장 "${normalized}" 은(는) 현재 연결되어 있지 않습니다.` };
    }
    const client = activeClientsById.get(clientId);
    if (!client) {
        releaseExtensionClaimsForClient(clientId);
        return { ok: false, message: `연장 "${normalized}" 연결 정보를 찾지 못해 목록에서 제거했습니다.` };
    }
    disconnectClient(client);
    return { ok: true, message: `연장 "${normalized}" 연결 해지를 요청했습니다.` };
}
export async function restartMqttBrokerFromConfig() {
    if (server || broker) {
        try {
            await stopMqttBroker();
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            log.warn(`Failed to stop MQTT broker before restart: ${message}`);
        }
    }
    await startMqttBroker();
}
//# sourceMappingURL=broker.js.map