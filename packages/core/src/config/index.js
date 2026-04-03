import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import JSON5 from "json5";
import { DEFAULT_CONFIG } from "./types.js";
import { PATHS } from "./paths.js";
function toObject(value) {
    return value && typeof value === "object" && !Array.isArray(value)
        ? { ...value }
        : {};
}
function toString(value) {
    return typeof value === "string" ? value.trim() : "";
}
function toStringArray(value) {
    return Array.isArray(value)
        ? value.filter((item) => typeof item === "string").map((item) => item.trim()).filter(Boolean)
        : [];
}
function normalizeLegacyAiConfig(parsed) {
    const root = toObject(parsed);
    const rawAi = toObject(root.ai);
    const rawAiProviders = toObject(rawAi.providers);
    const rawAiBackends = toObject(rawAi.backends);
    const providers = toObject(rawAi.providers);
    if (Object.keys(providers).length === 0) {
        const openai = toObject(rawAiBackends.openai);
        const anthropic = toObject(rawAiBackends.anthropic);
        const gemini = toObject(rawAiBackends.gemini);
        const ollama = toObject(rawAiBackends.ollama);
        const inferredProviders = {};
        if (toString(openai.providerType) === "openai" || toString(openai.authMode) === "chatgpt_oauth") {
            inferredProviders.openai = {
                baseUrl: toString(openai.endpoint),
                apiKeys: toStringArray(toObject(openai.credentials).apiKey ? [toObject(openai.credentials).apiKey] : []),
                auth: {
                    mode: toString(openai.authMode) || "api_key",
                    codexAuthFilePath: toString(toObject(openai.credentials).oauthAuthFilePath) || undefined,
                },
            };
        }
        if (toString(anthropic.providerType) === "anthropic") {
            inferredProviders.anthropic = {
                apiKeys: toStringArray(toObject(anthropic.credentials).apiKey ? [toObject(anthropic.credentials).apiKey] : []),
            };
        }
        if (toString(gemini.providerType) === "gemini") {
            inferredProviders.gemini = {
                baseUrl: toString(gemini.endpoint) || undefined,
                apiKeys: toStringArray(toObject(gemini.credentials).apiKey ? [toObject(gemini.credentials).apiKey] : []),
            };
        }
        if (toString(ollama.providerType) === "ollama" && toString(ollama.endpoint)) {
            inferredProviders.ollama = {
                baseUrl: toString(ollama.endpoint),
            };
        }
        if (Object.keys(inferredProviders).length > 0) {
            rawAi.providers = inferredProviders;
        }
    }
    if (!toString(rawAi.defaultProvider)) {
        const openai = toObject(rawAiBackends.openai);
        const anthropic = toObject(rawAiBackends.anthropic);
        const gemini = toObject(rawAiBackends.gemini);
        if (openai.enabled === true && (toString(openai.providerType) === "openai" || toString(openai.authMode) === "chatgpt_oauth")) {
            rawAi.defaultProvider = "openai";
            if (!toString(rawAi.defaultModel) && toString(openai.defaultModel))
                rawAi.defaultModel = toString(openai.defaultModel);
        }
        else if (anthropic.enabled === true && toString(anthropic.providerType) === "anthropic") {
            rawAi.defaultProvider = "anthropic";
            if (!toString(rawAi.defaultModel) && toString(anthropic.defaultModel))
                rawAi.defaultModel = toString(anthropic.defaultModel);
        }
        else if (gemini.enabled === true && toString(gemini.providerType) === "gemini") {
            rawAi.defaultProvider = "gemini";
            if (!toString(rawAi.defaultModel) && toString(gemini.defaultModel))
                rawAi.defaultModel = toString(gemini.defaultModel);
        }
    }
    root.ai = rawAi;
    return root;
}
function parseBooleanEnv(value) {
    if (value == null)
        return undefined;
    switch (value.trim().toLowerCase()) {
        case "1":
        case "true":
        case "yes":
        case "on":
            return true;
        case "0":
        case "false":
        case "no":
        case "off":
            return false;
        default:
            return undefined;
    }
}
function parseIntegerEnv(value) {
    if (value == null)
        return undefined;
    const parsed = Number(value.trim());
    return Number.isInteger(parsed) ? parsed : undefined;
}
function readEnvOverrides() {
    const mqttEnabled = parseBooleanEnv(process.env["NOBIE_MQTT_ENABLED"]);
    const mqttHost = process.env["NOBIE_MQTT_HOST"]?.trim();
    const mqttPort = parseIntegerEnv(process.env["NOBIE_MQTT_PORT"]);
    const mqttUsername = process.env["NOBIE_MQTT_USERNAME"]?.trim();
    const mqttPassword = process.env["NOBIE_MQTT_PASSWORD"];
    const mqttAllowAnonymous = parseBooleanEnv(process.env["NOBIE_MQTT_ALLOW_ANONYMOUS"]);
    if (mqttEnabled == null &&
        !mqttHost &&
        mqttPort == null &&
        mqttUsername == null &&
        mqttPassword == null &&
        mqttAllowAnonymous == null) {
        return {};
    }
    return {
        mqtt: {
            enabled: mqttEnabled ?? DEFAULT_CONFIG.mqtt.enabled,
            host: mqttHost || DEFAULT_CONFIG.mqtt.host,
            port: mqttPort ?? DEFAULT_CONFIG.mqtt.port,
            username: mqttUsername ?? DEFAULT_CONFIG.mqtt.username,
            password: mqttPassword ?? DEFAULT_CONFIG.mqtt.password,
            allowAnonymous: mqttAllowAnonymous ?? DEFAULT_CONFIG.mqtt.allowAnonymous,
        },
    };
}
function loadDotEnv(filePath) {
    if (!existsSync(filePath))
        return;
    const lines = readFileSync(filePath, "utf-8").split(/\r?\n/);
    for (const raw of lines) {
        const line = raw.trim();
        if (!line || line.startsWith("#"))
            continue;
        const eqIdx = line.indexOf("=");
        if (eqIdx < 1)
            continue;
        const key = line.slice(0, eqIdx).trim();
        let value = line.slice(eqIdx + 1).trim();
        if ((value.startsWith("\"") && value.endsWith("\"")) ||
            (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        if (!key)
            continue;
        if (value === "") {
            delete process.env[key];
        }
        else if (!(key in process.env)) {
            process.env[key] = value;
        }
    }
}
export function loadEnv() {
    loadDotEnv(join(process.cwd(), ".env"));
    loadDotEnv(join(PATHS.stateDir, ".env"));
}
function substituteEnvVars(value) {
    return value.replace(/\$\{([^}]+)\}/g, (_, name) => {
        return process.env[name] ?? "";
    });
}
function substituteDeep(obj) {
    if (typeof obj === "string")
        return substituteEnvVars(obj);
    if (Array.isArray(obj))
        return obj.map(substituteDeep);
    if (obj !== null && typeof obj === "object") {
        return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, substituteDeep(v)]));
    }
    return obj;
}
function deepMerge(base, override) {
    if (override === null || typeof override !== "object" || Array.isArray(override)) {
        return override;
    }
    const result = { ...base };
    for (const [key, value] of Object.entries(override)) {
        const baseVal = base[key];
        if (value !== null && typeof value === "object" && !Array.isArray(value) &&
            baseVal !== null && typeof baseVal === "object" && !Array.isArray(baseVal)) {
            result[key] = deepMerge(baseVal, value);
        }
        else {
            result[key] = value;
        }
    }
    return result;
}
let _config = null;
export function loadConfig() {
    loadEnv();
    const configPath = PATHS.configFile;
    const envOverrides = readEnvOverrides();
    if (!existsSync(configPath)) {
        _config = deepMerge(DEFAULT_CONFIG, envOverrides);
        return _config;
    }
    const raw = readFileSync(configPath, "utf-8");
    const parsed = JSON5.parse(raw);
    const normalized = normalizeLegacyAiConfig(parsed);
    const substituted = substituteDeep(normalized);
    _config = deepMerge(deepMerge(DEFAULT_CONFIG, substituted), envOverrides);
    return _config;
}
export function getConfig() {
    if (!_config)
        return loadConfig();
    return _config;
}
export function reloadConfig() {
    _config = null;
    return loadConfig();
}
export { PATHS } from "./paths.js";
//# sourceMappingURL=index.js.map
