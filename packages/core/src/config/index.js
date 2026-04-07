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
function inferConnectionFromLegacyConfig(rawAi) {
    const rawAiProviders = toObject(rawAi.providers);
    const rawAiBackends = toObject(rawAi.backends);
    const configuredProvider = toString(rawAi.defaultProvider);
    const configuredModel = toString(rawAi.defaultModel);
    const buildConnection = (provider, model, patch) => ({
        provider,
        model,
        ...patch,
    });
    if (configuredProvider === "openai") {
        const openai = toObject(rawAiProviders.openai);
        const auth = toObject(openai.auth);
        return buildConnection("openai", configuredModel, {
            endpoint: toString(openai.baseUrl) || undefined,
            auth: {
                mode: toString(auth.mode) || "api_key",
                apiKey: toStringArray(openai.apiKeys)[0] || undefined,
                oauthAuthFilePath: toString(auth.codexAuthFilePath) || undefined,
                clientId: toString(auth.clientId) || undefined,
            },
        });
    }
    if (configuredProvider === "anthropic") {
        const anthropic = toObject(rawAiProviders.anthropic);
        return buildConnection("anthropic", configuredModel, {
            auth: {
                mode: "api_key",
                apiKey: toStringArray(anthropic.apiKeys)[0] || undefined,
            },
        });
    }
    if (configuredProvider === "gemini") {
        const gemini = toObject(rawAiProviders.gemini);
        return buildConnection("gemini", configuredModel, {
            endpoint: toString(gemini.baseUrl) || undefined,
            auth: {
                mode: "api_key",
                apiKey: toStringArray(gemini.apiKeys)[0] || undefined,
            },
        });
    }
    if (configuredProvider === "ollama") {
        const ollama = toObject(rawAiProviders.ollama);
        return buildConnection("ollama", configuredModel, {
            endpoint: toString(ollama.baseUrl) || undefined,
            auth: {
                mode: "api_key",
            },
        });
    }
    const openai = toObject(rawAiBackends.openai);
    if (openai.enabled === true && (toString(openai.providerType) === "openai" || toString(openai.authMode) === "chatgpt_oauth")) {
        return buildConnection("openai", toString(openai.defaultModel), {
            endpoint: toString(openai.endpoint) || undefined,
            auth: {
                mode: toString(openai.authMode) || "api_key",
                apiKey: toString(toObject(openai.credentials).apiKey) || undefined,
                oauthAuthFilePath: toString(toObject(openai.credentials).oauthAuthFilePath) || undefined,
            },
        });
    }
    const anthropic = toObject(rawAiBackends.anthropic);
    if (anthropic.enabled === true && toString(anthropic.providerType) === "anthropic") {
        return buildConnection("anthropic", toString(anthropic.defaultModel), {
            auth: {
                mode: "api_key",
                apiKey: toString(toObject(anthropic.credentials).apiKey) || undefined,
            },
        });
    }
    const gemini = toObject(rawAiBackends.gemini);
    if (gemini.enabled === true && toString(gemini.providerType) === "gemini") {
        return buildConnection("gemini", toString(gemini.defaultModel), {
            endpoint: toString(gemini.endpoint) || undefined,
            auth: {
                mode: "api_key",
                apiKey: toString(toObject(gemini.credentials).apiKey) || undefined,
            },
        });
    }
    const ollama = toObject(rawAiBackends.ollama);
    if (ollama.enabled === true && toString(ollama.providerType) === "ollama") {
        return buildConnection("ollama", toString(ollama.defaultModel), {
            endpoint: toString(ollama.endpoint) || undefined,
            auth: {
                mode: "api_key",
            },
        });
    }
    return undefined;
}
function normalizeLegacyAiConfig(parsed) {
    const root = toObject(parsed);
    const rawAi = toObject(root.ai);
    const rawConnection = toObject(rawAi.connection);
    if (!toString(rawConnection.provider)) {
        rawAi.connection = inferConnectionFromLegacyConfig(rawAi) ?? {};
    }
    else {
        rawAi.connection = {
            provider: toString(rawConnection.provider),
            model: toString(rawConnection.model),
            endpoint: toString(rawConnection.endpoint) || undefined,
            auth: {
                mode: toString(toObject(rawConnection.auth).mode) || "api_key",
                apiKey: toString(toObject(rawConnection.auth).apiKey) || undefined,
                username: toString(toObject(rawConnection.auth).username) || undefined,
                password: toString(toObject(rawConnection.auth).password) || undefined,
                oauthAuthFilePath: toString(toObject(rawConnection.auth).oauthAuthFilePath) || undefined,
                clientId: toString(toObject(rawConnection.auth).clientId) || undefined,
            },
        };
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
