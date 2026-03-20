import { authMiddleware } from "../middleware/auth.js";
import { stopActiveTelegramChannel } from "../../channels/telegram/runtime.js";
import { testMcpServerConnection, testSkillPath } from "../../control-plane/setup-extensions.js";
import { buildSetupDraft, completeSetup, createSetupChecks, createTransientAuthToken, discoverModelsFromEndpoint, readSetupState, resetSetupEnvironment, saveSetupDraft, } from "../../control-plane/index.js";
export function registerSetupRoute(app) {
    app.get("/api/setup/status", { preHandler: authMiddleware }, async () => {
        return readSetupState();
    });
    app.get("/api/setup/checks", { preHandler: authMiddleware }, async () => {
        return createSetupChecks();
    });
    app.get("/api/setup/draft", { preHandler: authMiddleware }, async () => {
        return buildSetupDraft();
    });
    app.put("/api/setup/draft", { preHandler: authMiddleware }, async (req) => {
        return saveSetupDraft(req.body.draft, req.body.state);
    });
    app.post("/api/setup/test-backend", { preHandler: authMiddleware }, async (req, reply) => {
        const endpoint = req.body?.endpoint?.trim();
        const providerType = ["openai", "ollama", "llama", "claude", "gemini", "custom"].includes(String(req.body?.providerType))
            ? req.body?.providerType
            : "custom";
        const credentials = {};
        if (req.body?.credentials?.apiKey?.trim())
            credentials.apiKey = req.body.credentials.apiKey.trim();
        if (req.body?.credentials?.username?.trim())
            credentials.username = req.body.credentials.username.trim();
        if (req.body?.credentials?.password?.trim())
            credentials.password = req.body.credentials.password.trim();
        if (!endpoint) {
            return reply.status(400).send({ ok: false, error: "endpoint is required" });
        }
        try {
            const result = await discoverModelsFromEndpoint(endpoint, providerType, credentials);
            return { ok: true, ...result };
        }
        catch (error) {
            return reply.status(400).send({
                ok: false,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    });
    app.post("/api/setup/test-telegram", { preHandler: authMiddleware }, async (req, reply) => {
        const token = req.body?.botToken?.trim();
        if (!token) {
            return reply.status(400).send({ ok: false, message: "Bot token이 비어 있습니다." });
        }
        if (!token.includes(":")) {
            return reply.status(400).send({ ok: false, message: "Bot token 형식이 올바르지 않습니다." });
        }
        try {
            const response = await fetch(`https://api.telegram.org/bot${token}/getMe`);
            const payload = await response.json();
            if (!response.ok || payload.ok !== true) {
                return reply.status(400).send({
                    ok: false,
                    message: payload.description ?? "Telegram API 연결에 실패했습니다.",
                });
            }
            const botName = payload.result?.username ?? payload.result?.first_name ?? "unknown";
            return {
                ok: true,
                message: `Telegram Bot 연결 성공: ${botName}`,
            };
        }
        catch (error) {
            return reply.status(400).send({
                ok: false,
                message: error instanceof Error ? error.message : String(error),
            });
        }
    });
    app.post("/api/setup/test-mcp-server", { preHandler: authMiddleware }, async (req, reply) => {
        const server = req.body?.server;
        if (!server || typeof server !== "object") {
            return reply.status(400).send({ ok: false, message: "MCP 서버 설정이 비어 있습니다.", tools: [] });
        }
        const result = await testMcpServerConnection(server);
        if (!result.ok) {
            return reply.status(400).send(result);
        }
        return result;
    });
    app.post("/api/setup/test-skill-path", { preHandler: authMiddleware }, async (req, reply) => {
        const result = testSkillPath(req.body?.path ?? "");
        if (!result.ok) {
            return reply.status(400).send(result);
        }
        return result;
    });
    app.post("/api/setup/generate-auth-token", { preHandler: authMiddleware }, async () => {
        return { token: createTransientAuthToken() };
    });
    app.post("/api/setup/reset", { preHandler: authMiddleware }, async () => {
        stopActiveTelegramChannel();
        return resetSetupEnvironment();
    });
    app.post("/api/setup/complete", { preHandler: authMiddleware }, async () => {
        return completeSetup();
    });
}
//# sourceMappingURL=setup.js.map