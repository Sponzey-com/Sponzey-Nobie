import { randomBytes, timingSafeEqual } from "node:crypto";
import { getConfig } from "../config/index.js";
const authorizationCodes = new Map();
const accessTokens = new Map();
const refreshTokens = new Map();
const CHATGPT_REDIRECT_HOSTS = new Set(["chat.openai.com", "chatgpt.com"]);
const CHATGPT_CALLBACK_PATH = /^\/aip\/[^/]+\/oauth\/callback$/;
function secureEquals(left, right) {
    const a = Buffer.from(left);
    const b = Buffer.from(right);
    if (a.length !== b.length)
        return false;
    return timingSafeEqual(a, b);
}
function normalizeBaseUrl(value) {
    return value.trim().replace(/\/+$/, "");
}
function pruneExpired() {
    const now = Date.now();
    for (const [code, record] of authorizationCodes) {
        if (record.expiresAt <= now)
            authorizationCodes.delete(code);
    }
    for (const [token, record] of accessTokens) {
        if (record.expiresAt <= now) {
            accessTokens.delete(token);
            refreshTokens.delete(record.refreshToken);
        }
    }
}
function getResolvedConfig() {
    const raw = getConfig().webui.auth.oauth?.chatgpt;
    return {
        enabled: raw?.enabled ?? false,
        publicBaseUrl: normalizeBaseUrl(raw?.publicBaseUrl ?? ""),
        clientId: raw?.clientId?.trim() ?? "",
        clientSecret: raw?.clientSecret?.trim() ?? "",
        scope: raw?.scope?.trim() || "nobie:api",
        accessTokenTtlSec: typeof raw?.accessTokenTtlSec === "number" && Number.isFinite(raw.accessTokenTtlSec) && raw.accessTokenTtlSec > 0
            ? Math.floor(raw.accessTokenTtlSec)
            : 3600,
        codeTtlSec: typeof raw?.codeTtlSec === "number" && Number.isFinite(raw.codeTtlSec) && raw.codeTtlSec > 0
            ? Math.floor(raw.codeTtlSec)
            : 300,
    };
}
function isConfigured(config = getResolvedConfig()) {
    return config.enabled && Boolean(config.publicBaseUrl && config.clientId && config.clientSecret);
}
function isScopeAllowed(requestedScope, allowedScope) {
    const allowed = new Set(allowedScope.split(/\s+/).filter(Boolean));
    const requested = requestedScope.split(/\s+/).filter(Boolean);
    if (requested.length === 0)
        return true;
    return requested.every((scope) => allowed.has(scope));
}
export function buildChatGptOAuthMetadata() {
    const config = getResolvedConfig();
    return {
        enabled: isConfigured(config),
        issuer: config.publicBaseUrl,
        authorizationUrl: config.publicBaseUrl ? `${config.publicBaseUrl}/oauth/chatgpt/authorize` : "",
        tokenUrl: config.publicBaseUrl ? `${config.publicBaseUrl}/oauth/chatgpt/token` : "",
        metadataUrl: config.publicBaseUrl ? `${config.publicBaseUrl}/oauth/chatgpt/metadata` : "",
        publicBaseUrl: config.publicBaseUrl,
        clientId: config.clientId,
        scope: config.scope,
        redirectUriTemplates: [
            "https://chat.openai.com/aip/{g-YOUR-GPT-ID-HERE}/oauth/callback",
            "https://chatgpt.com/aip/{g-YOUR-GPT-ID-HERE}/oauth/callback",
        ],
    };
}
export function isChatGptOAuthEnabled() {
    return isConfigured();
}
export function validateChatGptRedirectUri(redirectUri) {
    try {
        const url = new URL(redirectUri);
        return url.protocol === "https:" && CHATGPT_REDIRECT_HOSTS.has(url.host) && CHATGPT_CALLBACK_PATH.test(url.pathname);
    }
    catch {
        return false;
    }
}
export function createChatGptAuthorizationCode(params) {
    pruneExpired();
    const config = getResolvedConfig();
    if (!isConfigured(config))
        throw new Error("ChatGPT OAuth is not configured.");
    if (!secureEquals(params.clientId, config.clientId))
        throw new Error("Invalid client_id.");
    if (!validateChatGptRedirectUri(params.redirectUri))
        throw new Error("Invalid redirect_uri.");
    const scope = params.requestedScope?.trim() || config.scope;
    if (!isScopeAllowed(scope, config.scope)) {
        throw new Error("Requested scope is not allowed.");
    }
    const code = randomBytes(32).toString("hex");
    authorizationCodes.set(code, {
        code,
        clientId: config.clientId,
        redirectUri: params.redirectUri,
        scope,
        expiresAt: Date.now() + config.codeTtlSec * 1000,
    });
    return { code, scope, expiresIn: config.codeTtlSec };
}
export function exchangeChatGptAuthorizationCode(params) {
    pruneExpired();
    const config = getResolvedConfig();
    if (!isConfigured(config))
        throw new Error("ChatGPT OAuth is not configured.");
    if (!secureEquals(params.clientId, config.clientId) || !secureEquals(params.clientSecret, config.clientSecret)) {
        throw new Error("Invalid client credentials.");
    }
    const record = authorizationCodes.get(params.code);
    if (!record)
        throw new Error("Invalid authorization code.");
    authorizationCodes.delete(params.code);
    if (!secureEquals(record.clientId, config.clientId) || record.redirectUri !== params.redirectUri || record.expiresAt <= Date.now()) {
        throw new Error("Authorization code verification failed.");
    }
    const accessToken = randomBytes(48).toString("hex");
    const refreshToken = randomBytes(48).toString("hex");
    const tokenRecord = {
        accessToken,
        refreshToken,
        clientId: config.clientId,
        scope: record.scope,
        expiresAt: Date.now() + config.accessTokenTtlSec * 1000,
    };
    accessTokens.set(accessToken, tokenRecord);
    refreshTokens.set(refreshToken, tokenRecord);
    return {
        access_token: accessToken,
        token_type: "bearer",
        expires_in: config.accessTokenTtlSec,
        refresh_token: refreshToken,
        scope: record.scope,
    };
}
export function refreshChatGptAccessToken(params) {
    pruneExpired();
    const config = getResolvedConfig();
    if (!isConfigured(config))
        throw new Error("ChatGPT OAuth is not configured.");
    if (!secureEquals(params.clientId, config.clientId) || !secureEquals(params.clientSecret, config.clientSecret)) {
        throw new Error("Invalid client credentials.");
    }
    const record = refreshTokens.get(params.refreshToken);
    if (!record)
        throw new Error("Invalid refresh token.");
    accessTokens.delete(record.accessToken);
    refreshTokens.delete(record.refreshToken);
    const accessToken = randomBytes(48).toString("hex");
    const refreshToken = randomBytes(48).toString("hex");
    const nextRecord = {
        accessToken,
        refreshToken,
        clientId: record.clientId,
        scope: record.scope,
        expiresAt: Date.now() + config.accessTokenTtlSec * 1000,
    };
    accessTokens.set(accessToken, nextRecord);
    refreshTokens.set(refreshToken, nextRecord);
    return {
        access_token: accessToken,
        token_type: "bearer",
        expires_in: config.accessTokenTtlSec,
        refresh_token: refreshToken,
        scope: record.scope,
    };
}
export function validateChatGptAccessToken(accessToken) {
    pruneExpired();
    const record = accessTokens.get(accessToken);
    return Boolean(record && record.expiresAt > Date.now());
}
//# sourceMappingURL=chatgpt-oauth.js.map