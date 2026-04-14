import { getConfig } from "../../config/index.js";
import { buildChatGptOAuthMetadata, createChatGptAuthorizationCode, exchangeChatGptAuthorizationCode, isChatGptOAuthEnabled, refreshChatGptAccessToken, validateChatGptRedirectUri, } from "../../auth/chatgpt-oauth.js";
function readField(value) {
    return typeof value === "string" ? value.trim() : "";
}
function buildRedirectUrl(redirectUri, params) {
    const url = new URL(redirectUri);
    for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
    }
    return url.toString();
}
function sendAuthorizeError(reply, message, status = 400) {
    return reply
        .status(status)
        .type("text/html; charset=utf-8")
        .send(`<!doctype html><html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>Nobie OAuth</title><style>body{font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f5f5f4;color:#1c1917;padding:32px}.card{max-width:640px;margin:0 auto;background:white;border:1px solid #e7e5e4;border-radius:20px;padding:24px;box-shadow:0 12px 30px rgba(0,0,0,.06)}h1{font-size:20px;margin:0 0 16px}p{line-height:1.7;margin:10px 0}.error{color:#b91c1c;background:#fef2f2;border:1px solid #fecaca;border-radius:14px;padding:12px 14px}</style></head><body><div class="card"><h1>Nobie ChatGPT OAuth</h1><p class="error">${escapeHtml(message)}</p></div></body></html>`);
}
function escapeHtml(value) {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
}
function renderAuthorizePage(params) {
    const metadata = buildChatGptOAuthMetadata();
    const ownerTokenHelp = params.requireOwnerToken
        ? `<p>Enter the current Nobie WebUI auth token to approve this ChatGPT connection.</p>`
        : `<p>Approve this connection to issue an OAuth code for ChatGPT.</p>`;
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Nobie ChatGPT OAuth</title>
    <style>
      body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f5f5f4; color: #1c1917; padding: 32px; }
      .card { max-width: 720px; margin: 0 auto; background: white; border: 1px solid #e7e5e4; border-radius: 20px; padding: 28px; box-shadow: 0 12px 30px rgba(0,0,0,.06); }
      h1 { font-size: 22px; margin: 0 0 8px; }
      p, li { line-height: 1.7; }
      .meta { background: #fafaf9; border: 1px solid #e7e5e4; border-radius: 16px; padding: 16px; margin: 18px 0; }
      label { display: block; font-weight: 600; margin-bottom: 8px; }
      input[type=password] { width: 100%; border: 1px solid #d6d3d1; border-radius: 12px; padding: 12px 14px; font: inherit; }
      .actions { display: flex; gap: 12px; margin-top: 20px; }
      button { border: none; border-radius: 12px; padding: 12px 16px; font: inherit; font-weight: 700; cursor: pointer; }
      .approve { background: #2563eb; color: white; }
      .deny { background: #e7e5e4; color: #1c1917; }
      .error { color: #b91c1c; background: #fef2f2; border: 1px solid #fecaca; border-radius: 14px; padding: 12px 14px; margin-top: 16px; }
      code { background: #f5f5f4; border-radius: 8px; padding: 2px 6px; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>Nobie ChatGPT OAuth approval</h1>
      <p>ChatGPT is requesting access to your Nobie API.</p>
      ${ownerTokenHelp}
      <div class="meta">
        <div><strong>Client ID:</strong> <code>${escapeHtml(params.clientId)}</code></div>
        <div><strong>Scope:</strong> <code>${escapeHtml(params.scope || metadata.scope)}</code></div>
        <div><strong>Redirect URI:</strong> <code>${escapeHtml(params.redirectUri)}</code></div>
      </div>
      <form method="post" action="/oauth/chatgpt/authorize">
        <input type="hidden" name="client_id" value="${escapeHtml(params.clientId)}" />
        <input type="hidden" name="redirect_uri" value="${escapeHtml(params.redirectUri)}" />
        <input type="hidden" name="state" value="${escapeHtml(params.state)}" />
        <input type="hidden" name="scope" value="${escapeHtml(params.scope)}" />
        ${params.requireOwnerToken ? `<div><label for="owner_token">Nobie WebUI auth token</label><input id="owner_token" name="owner_token" type="password" autocomplete="off" /></div>` : ""}
        ${params.errorMessage ? `<div class="error">${escapeHtml(params.errorMessage)}</div>` : ""}
        <div class="actions">
          <button class="approve" type="submit" name="decision" value="approve">Approve</button>
          <button class="deny" type="submit" name="decision" value="deny">Cancel</button>
        </div>
      </form>
    </div>
  </body>
</html>`;
}
function getAuthorizeInput(source) {
    return {
        clientId: readField(source.client_id),
        redirectUri: readField(source.redirect_uri),
        state: readField(source.state),
        scope: readField(source.scope),
        ownerToken: readField(source.owner_token),
        decision: readField(source.decision) || "approve",
        responseType: readField(source.response_type) || "code",
    };
}
export function registerOAuthRoute(app) {
    app.get("/oauth/chatgpt/metadata", async (_req, reply) => {
        const metadata = buildChatGptOAuthMetadata();
        if (!metadata.enabled) {
            return reply.status(404).send({ error: "ChatGPT OAuth is not enabled." });
        }
        return metadata;
    });
    app.get("/oauth/chatgpt/authorize", async (req, reply) => {
        const metadata = buildChatGptOAuthMetadata();
        if (!metadata.enabled) {
            return sendAuthorizeError(reply, "ChatGPT OAuth is not enabled on this Nobie instance.", 404);
        }
        const input = getAuthorizeInput(req.query ?? {});
        if (input.responseType !== "code") {
            return sendAuthorizeError(reply, "Only response_type=code is supported.");
        }
        if (!input.clientId || !input.redirectUri || !input.state) {
            return sendAuthorizeError(reply, "client_id, redirect_uri, and state are required.");
        }
        if (!validateChatGptRedirectUri(input.redirectUri)) {
            return sendAuthorizeError(reply, "The redirect_uri must point to chat.openai.com or chatgpt.com GPT callback URL.");
        }
        if (input.clientId !== metadata.clientId) {
            return reply.redirect(buildRedirectUrl(input.redirectUri, {
                error: "invalid_client",
                error_description: "Unknown client_id",
                state: input.state,
            }));
        }
        const requireOwnerToken = Boolean(getConfig().webui.auth.enabled && getConfig().webui.auth.token?.trim());
        return reply.type("text/html; charset=utf-8").send(renderAuthorizePage({
            clientId: input.clientId,
            redirectUri: input.redirectUri,
            state: input.state,
            scope: input.scope || metadata.scope,
            requireOwnerToken,
        }));
    });
    app.post("/oauth/chatgpt/authorize", async (req, reply) => {
        const metadata = buildChatGptOAuthMetadata();
        if (!metadata.enabled) {
            return sendAuthorizeError(reply, "ChatGPT OAuth is not enabled on this Nobie instance.", 404);
        }
        const input = getAuthorizeInput((req.body ?? {}));
        if (!input.clientId || !input.redirectUri || !input.state) {
            return sendAuthorizeError(reply, "client_id, redirect_uri, and state are required.");
        }
        if (!validateChatGptRedirectUri(input.redirectUri)) {
            return sendAuthorizeError(reply, "The redirect_uri must point to chat.openai.com or chatgpt.com GPT callback URL.");
        }
        if (input.clientId !== metadata.clientId) {
            return reply.redirect(buildRedirectUrl(input.redirectUri, {
                error: "invalid_client",
                error_description: "Unknown client_id",
                state: input.state,
            }));
        }
        if (input.decision === "deny") {
            return reply.redirect(buildRedirectUrl(input.redirectUri, {
                error: "access_denied",
                error_description: "The user denied the authorization request.",
                state: input.state,
            }));
        }
        const configuredOwnerToken = getConfig().webui.auth.token?.trim() ?? "";
        const requireOwnerToken = Boolean(getConfig().webui.auth.enabled && configuredOwnerToken);
        if (requireOwnerToken && input.ownerToken !== configuredOwnerToken) {
            return reply
                .status(401)
                .type("text/html; charset=utf-8")
                .send(renderAuthorizePage({
                clientId: input.clientId,
                redirectUri: input.redirectUri,
                state: input.state,
                scope: input.scope || metadata.scope,
                requireOwnerToken: true,
                errorMessage: "The Nobie WebUI auth token is invalid.",
            }));
        }
        try {
            const issued = createChatGptAuthorizationCode({
                clientId: input.clientId,
                redirectUri: input.redirectUri,
                requestedScope: input.scope || metadata.scope,
            });
            return reply.redirect(buildRedirectUrl(input.redirectUri, {
                code: issued.code,
                state: input.state,
            }));
        }
        catch (error) {
            return reply.redirect(buildRedirectUrl(input.redirectUri, {
                error: "invalid_request",
                error_description: error instanceof Error ? error.message : String(error),
                state: input.state,
            }));
        }
    });
    app.post("/oauth/chatgpt/token", async (req, reply) => {
        reply.header("Cache-Control", "no-store");
        reply.header("Pragma", "no-cache");
        if (!isChatGptOAuthEnabled()) {
            return reply.status(404).send({ error: "invalid_client", error_description: "ChatGPT OAuth is not enabled." });
        }
        const body = (req.body ?? {});
        const grantType = readField(body.grant_type);
        const clientId = readField(body.client_id);
        const clientSecret = readField(body.client_secret);
        try {
            if (grantType === "authorization_code") {
                const response = exchangeChatGptAuthorizationCode({
                    code: readField(body.code),
                    clientId,
                    clientSecret,
                    redirectUri: readField(body.redirect_uri),
                });
                return reply.send(response);
            }
            if (grantType === "refresh_token") {
                const response = refreshChatGptAccessToken({
                    refreshToken: readField(body.refresh_token),
                    clientId,
                    clientSecret,
                });
                return reply.send(response);
            }
            return reply.status(400).send({
                error: "unsupported_grant_type",
                error_description: "Only authorization_code and refresh_token are supported.",
            });
        }
        catch (error) {
            return reply.status(400).send({
                error: "invalid_grant",
                error_description: error instanceof Error ? error.message : String(error),
            });
        }
    });
}
//# sourceMappingURL=oauth.js.map