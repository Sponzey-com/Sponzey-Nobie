import { randomUUID } from "node:crypto";
import mqtt from "mqtt";
import { getConfig } from "../config/index.js";
import { createLogger } from "../logger/index.js";
import { getMqttBrokerSnapshot, validateMqttBrokerConfig } from "../mqtt/broker.js";
const log = createLogger("yeonjang:mqtt");
export const DEFAULT_YEONJANG_EXTENSION_ID = "yeonjang-main";
export function buildYeonjangTopics(extensionId = DEFAULT_YEONJANG_EXTENSION_ID) {
    const normalized = extensionId.trim() || DEFAULT_YEONJANG_EXTENSION_ID;
    const prefix = `nobie/v1/node/${normalized}`;
    return {
        statusTopic: `${prefix}/status`,
        capabilitiesTopic: `${prefix}/capabilities`,
        requestTopic: `${prefix}/request`,
        responseTopic: `${prefix}/response`,
        eventTopic: `${prefix}/event`,
    };
}
export async function invokeYeonjangMethod(method, params = {}, options = {}) {
    const extensionId = options.extensionId?.trim() || DEFAULT_YEONJANG_EXTENSION_ID;
    const timeoutMs = clampTimeout(options.timeoutMs);
    const topics = buildYeonjangTopics(extensionId);
    const requestId = randomUUID();
    const client = createClient();
    log.debug(`invoking ${method} on ${extensionId}`);
    try {
        await waitForConnect(client, timeoutMs);
        await subscribe(client, topics.responseTopic);
        await publish(client, topics.requestTopic, {
            id: requestId,
            method,
            params,
        });
        const response = await waitForResponse(client, topics.responseTopic, requestId, timeoutMs);
        return response;
    }
    finally {
        await closeClient(client);
    }
}
export async function getYeonjangCapabilities(options = {}) {
    return await invokeYeonjangMethod("node.capabilities", {}, options);
}
export async function canYeonjangHandleMethod(method, options = {}) {
    try {
        const capabilities = await getYeonjangCapabilities(options);
        const entry = capabilities.methods?.find((candidate) => candidate.name === method);
        return Boolean(entry?.implemented);
    }
    catch (error) {
        if (isYeonjangUnavailableError(error))
            return false;
        throw error;
    }
}
export function isYeonjangUnavailableError(error) {
    const message = error instanceof Error ? error.message : String(error);
    const normalized = message.toLowerCase();
    return [
        "mqtt 브로커가 비활성화되어 있습니다",
        "mqtt 브로커가 실행 중이 아닙니다",
        "yeonjang mqtt 연결 시간이 초과되었습니다",
        "yeonjang mqtt 응답 시간이 초과되었습니다",
        "yeonjang mqtt 연결이 닫혔습니다",
        "yeonjang mqtt 응답 대기 중 연결이 닫혔습니다",
        "connection refused",
        "connack timeout",
        "econnrefused",
        "getaddrinfo",
        "not authorized",
        "authentication",
    ].some((pattern) => normalized.includes(pattern));
}
function createClient() {
    const config = getConfig().mqtt;
    const snapshot = getMqttBrokerSnapshot();
    const validationError = validateMqttBrokerConfig(config);
    if (!config.enabled) {
        throw new Error("MQTT 브로커가 비활성화되어 있습니다.");
    }
    if (validationError) {
        throw new Error(validationError);
    }
    if (!snapshot.running) {
        throw new Error(snapshot.reason ?? "MQTT 브로커가 실행 중이 아닙니다.");
    }
    const host = normalizeConnectHost(config.host);
    return mqtt.connect(`mqtt://${host}:${config.port}`, {
        clientId: `nobie-core-${process.pid}-${randomUUID().slice(0, 8)}`,
        username: config.username,
        password: config.password,
        connectTimeout: 5_000,
        reconnectPeriod: 0,
        clean: true,
    });
}
function normalizeConnectHost(host) {
    const trimmed = host.trim();
    if (!trimmed || trimmed === "0.0.0.0" || trimmed === "::") {
        return "127.0.0.1";
    }
    return trimmed;
}
function clampTimeout(timeoutMs) {
    const candidate = Number(timeoutMs);
    if (!Number.isFinite(candidate))
        return 15_000;
    return Math.max(1_000, Math.min(60_000, Math.floor(candidate)));
}
async function waitForConnect(client, timeoutMs) {
    await new Promise((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => {
            cleanup();
            reject(new Error("Yeonjang MQTT 연결 시간이 초과되었습니다."));
        }, timeoutMs);
        const onConnect = () => {
            cleanup();
            resolve();
        };
        const onError = (error) => {
            cleanup();
            reject(error);
        };
        const onClose = () => {
            if (settled)
                return;
            cleanup();
            reject(new Error("Yeonjang MQTT 연결이 닫혔습니다."));
        };
        const cleanup = () => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            client.off("connect", onConnect);
            client.off("error", onError);
            client.off("close", onClose);
        };
        client.once("connect", onConnect);
        client.once("error", onError);
        client.once("close", onClose);
    });
}
async function subscribe(client, topic) {
    await new Promise((resolve, reject) => {
        client.subscribe(topic, { qos: 1 }, (error) => {
            if (error) {
                reject(error);
                return;
            }
            resolve();
        });
    });
}
async function publish(client, topic, request) {
    await new Promise((resolve, reject) => {
        client.publish(topic, JSON.stringify(request), { qos: 1 }, (error) => {
            if (error) {
                reject(error);
                return;
            }
            resolve();
        });
    });
}
async function waitForResponse(client, responseTopic, requestId, timeoutMs) {
    return await new Promise((resolve, reject) => {
        const chunkParts = new Map();
        const timer = setTimeout(() => {
            cleanup();
            reject(new Error("Yeonjang MQTT 응답 시간이 초과되었습니다."));
        }, timeoutMs);
        const onMessage = (topic, payload) => {
            if (topic !== responseTopic)
                return;
            let parsed;
            try {
                parsed = JSON.parse(payload.toString("utf8"));
            }
            catch (error) {
                cleanup();
                reject(new Error(`Yeonjang 응답 JSON 파싱 실패: ${error instanceof Error ? error.message : String(error)}`));
                return;
            }
            if (isChunkEnvelope(parsed)) {
                if (parsed.id && parsed.id !== requestId)
                    return;
                if (typeof parsed.chunk_index !== "number" || typeof parsed.chunk_count !== "number" || !parsed.base64_data) {
                    cleanup();
                    reject(new Error("Yeonjang 청크 응답 형식이 올바르지 않습니다."));
                    return;
                }
                chunkParts.set(parsed.chunk_index, parsed.base64_data);
                if (chunkParts.size < parsed.chunk_count)
                    return;
                const orderedParts = [];
                for (let index = 0; index < parsed.chunk_count; index += 1) {
                    const part = chunkParts.get(index);
                    if (!part) {
                        cleanup();
                        reject(new Error(`Yeonjang 청크 응답이 누락되었습니다. (${index + 1}/${parsed.chunk_count})`));
                        return;
                    }
                    orderedParts.push(part);
                }
                let response;
                try {
                    const bytes = Buffer.concat(orderedParts.map((part) => Buffer.from(part, "base64")));
                    response = JSON.parse(bytes.toString("utf8"));
                }
                catch (error) {
                    cleanup();
                    reject(new Error(`Yeonjang 청크 응답 복원 실패: ${error instanceof Error ? error.message : String(error)}`));
                    return;
                }
                if (response.id && response.id !== requestId)
                    return;
                cleanup();
                if (!response.ok) {
                    reject(new Error(response.error?.message ?? "Yeonjang 요청이 실패했습니다."));
                    return;
                }
                resolve((response.result ?? null));
                return;
            }
            const response = parsed;
            if (response.id && response.id !== requestId)
                return;
            cleanup();
            if (!response.ok) {
                reject(new Error(response.error?.message ?? "Yeonjang 요청이 실패했습니다."));
                return;
            }
            resolve((response.result ?? null));
        };
        const onError = (error) => {
            cleanup();
            reject(error);
        };
        const onClose = () => {
            cleanup();
            reject(new Error("Yeonjang MQTT 응답 대기 중 연결이 닫혔습니다."));
        };
        const cleanup = () => {
            clearTimeout(timer);
            client.off("message", onMessage);
            client.off("error", onError);
            client.off("close", onClose);
            chunkParts.clear();
        };
        client.on("message", onMessage);
        client.once("error", onError);
        client.once("close", onClose);
    });
}
function isChunkEnvelope(value) {
    return Boolean(value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        value.transport === "chunk");
}
async function closeClient(client) {
    await new Promise((resolve) => {
        client.end(true, {}, () => resolve());
    });
}
//# sourceMappingURL=mqtt-client.js.map