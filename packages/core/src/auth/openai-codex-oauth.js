import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";
const OPENAI_OAUTH_TOKEN_URL = "https://auth.openai.com/oauth/token";
const DEFAULT_CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const REFRESH_HEADROOM_SECONDS = 300;
export const OPENAI_CODEX_BASE_URL = "https://chatgpt.com/backend-api/codex";
export const OPENAI_CODEX_RESPONSES_PATH = "/responses";
export const OPENAI_CODEX_USER_AGENT = "Codex-Code/1.0.43";
export const OPENAI_CODEX_KNOWN_MODELS = ["gpt-5.4", "gpt-5"];
export function resolveOpenAICodexBaseUrl(baseUrl) {
    const normalized = baseUrl?.trim();
    if (!normalized)
        return OPENAI_CODEX_BASE_URL;
    const trimmed = normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
    return trimmed.endsWith(OPENAI_CODEX_RESPONSES_PATH)
        ? trimmed.slice(0, -OPENAI_CODEX_RESPONSES_PATH.length)
        : trimmed;
}
function expandHome(value) {
    if (value === "~")
        return homedir();
    if (value.startsWith("~/"))
        return join(homedir(), value.slice(2));
    return value;
}
export function resolveOpenAICodexAuthFilePath(config) {
    const configured = config?.authFilePath?.trim();
    if (configured)
        return expandHome(configured);
    const codexHome = process.env["CODEX_HOME"]?.trim();
    if (codexHome)
        return join(expandHome(codexHome), "auth.json");
    return join(homedir(), ".codex", "auth.json");
}
export function hasOpenAICodexAuthFile(config) {
    return existsSync(resolveOpenAICodexAuthFilePath(config));
}
function decodeJwtPayload(token) {
    const [, payload] = token.split(".");
    if (!payload)
        return {};
    try {
        const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
        const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
        return JSON.parse(Buffer.from(padded, "base64").toString("utf-8"));
    }
    catch {
        return {};
    }
}
function tokenExpiresAt(token) {
    if (!token)
        return undefined;
    const payload = decodeJwtPayload(token);
    return typeof payload.exp === "number" ? payload.exp : undefined;
}
function shouldRefreshToken(accessToken, forceRefresh = false) {
    if (!accessToken)
        return true;
    if (forceRefresh)
        return true;
    const exp = tokenExpiresAt(accessToken);
    if (!exp)
        return false;
    return exp - Math.floor(Date.now() / 1000) <= REFRESH_HEADROOM_SECONDS;
}
function inferClientId(config, authFile) {
    const configured = config?.clientId?.trim();
    if (configured)
        return configured;
    const accessPayload = decodeJwtPayload(authFile.tokens?.access_token ?? "");
    if (typeof accessPayload.client_id === "string" && accessPayload.client_id.trim()) {
        return accessPayload.client_id.trim();
    }
    if (Array.isArray(accessPayload.aud) && typeof accessPayload.aud[0] === "string" && accessPayload.aud[0].trim()) {
        return accessPayload.aud[0].trim();
    }
    if (typeof accessPayload.aud === "string" && accessPayload.aud.trim()) {
        return accessPayload.aud.trim();
    }
    const idPayload = decodeJwtPayload(authFile.tokens?.id_token ?? "");
    if (Array.isArray(idPayload.aud) && typeof idPayload.aud[0] === "string" && idPayload.aud[0].trim()) {
        return idPayload.aud[0].trim();
    }
    if (typeof idPayload.aud === "string" && idPayload.aud.trim()) {
        return idPayload.aud.trim();
    }
    return process.env["CODEX_CLIENT_ID"]?.trim() || DEFAULT_CODEX_CLIENT_ID;
}
function readCodexAuthFile(config) {
    const authFilePath = resolveOpenAICodexAuthFilePath(config);
    if (!existsSync(authFilePath)) {
        throw new Error(`ChatGPT OAuth 인증 파일을 찾지 못했습니다: ${authFilePath}`);
    }
    const raw = readFileSync(authFilePath, "utf-8");
    const authFile = JSON.parse(raw);
    return { authFilePath, authFile };
}
async function refreshAccessToken(config, authFilePath, authFile) {
    const refreshToken = authFile.tokens?.refresh_token?.trim();
    if (!refreshToken) {
        throw new Error("ChatGPT OAuth refresh token이 없습니다. 먼저 `codex login`을 다시 실행해 주세요.");
    }
    const clientId = inferClientId(config, authFile);
    const response = await fetch(OPENAI_OAUTH_TOKEN_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
        },
        body: new URLSearchParams({
            grant_type: "refresh_token",
            refresh_token: refreshToken,
            client_id: clientId,
        }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.access_token) {
        const description = payload.error_description?.trim() || payload.error?.trim() || `${response.status} ${response.statusText}`;
        throw new Error(`ChatGPT OAuth 토큰 갱신에 실패했습니다: ${description}`);
    }
    const nextAuthFile = {
        ...authFile,
        auth_mode: authFile.auth_mode ?? "chatgpt",
        tokens: {
            ...authFile.tokens,
            access_token: payload.access_token,
            refresh_token: payload.refresh_token ?? authFile.tokens?.refresh_token ?? null,
            id_token: payload.id_token ?? authFile.tokens?.id_token ?? null,
        },
        last_refresh: new Date().toISOString(),
    };
    mkdirSync(dirname(authFilePath), { recursive: true });
    writeFileSync(authFilePath, JSON.stringify(nextAuthFile, null, 2), "utf-8");
    return nextAuthFile;
}
export async function readOpenAICodexAccessToken(config, options) {
    const { authFilePath, authFile } = readCodexAuthFile(config);
    let working = authFile;
    let accessToken = working.tokens?.access_token?.trim() ?? "";
    if (shouldRefreshToken(accessToken, options?.forceRefresh ?? false)) {
        working = await refreshAccessToken(config, authFilePath, working);
        accessToken = working.tokens?.access_token?.trim() ?? "";
    }
    if (!accessToken) {
        throw new Error("ChatGPT OAuth access token이 없습니다. 먼저 `codex login`을 다시 실행해 주세요.");
    }
    return {
        accessToken,
        authFilePath,
        expiresAt: tokenExpiresAt(accessToken),
    };
}
//# sourceMappingURL=openai-codex-oauth.js.map