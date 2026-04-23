import Fastify from "fastify";
import cors from "@fastify/cors";
import staticPlugin from "@fastify/static";
import websocketPlugin from "@fastify/websocket";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getConfig } from "../config/index.js";
import { createLogger } from "../logger/index.js";
import { registerStatusRoute } from "./routes/status.js";
import { registerCapabilitiesRoute } from "./routes/capabilities.js";
import { registerAgentRoutes } from "./routes/agent.js";
import { registerArtifactsRoute } from "./routes/artifacts.js";
import { registerToolsRoute } from "./routes/tools.js";
import { registerAuditRoute } from "./routes/audit.js";
import { registerSettingsRoute } from "./routes/settings.js";
import { registerSchedulesRoute } from "./routes/schedules.js";
import { registerSchedulerRoute } from "./routes/scheduler.js";
import { registerPluginsRoute } from "./routes/plugins.js";
import { registerSetupRoute } from "./routes/setup.js";
import { registerRunsRoute } from "./routes/runs.js";
import { registerInstructionsRoute } from "./routes/instructions.js";
import { registerMcpRoute } from "./routes/mcp.js";
import { registerUpdateRoute } from "./routes/update.js";
import { registerMemoryRoute } from "./routes/memory.js";
import { registerPromptSourcesRoute } from "./routes/prompt-sources.js";
import { registerConfigOperationsRoute } from "./routes/config-operations.js";
import { registerChannelSmokeRoute } from "./routes/channel-smoke.js";
import { registerDoctorRoute } from "./routes/doctor.js";
import { registerControlTimelineRoute } from "./routes/control-timeline.js";
import { registerUiModeRoute } from "./routes/ui-mode.js";
import { registerAdminRoute } from "./routes/admin.js";
import { registerWsRoute } from "./ws/stream.js";
import { eventBus } from "../events/index.js";
import { stopActiveSlackChannel } from "../channels/slack/runtime.js";
import { stopActiveTelegramChannel } from "../channels/telegram/runtime.js";
import { startScheduler, stopScheduler } from "../scheduler/index.js";
import { pluginLoader } from "../plugins/loader.js";
import { mcpRegistry } from "../mcp/registry.js";
import { stopMqttBroker } from "../mqtt/broker.js";
import { startArtifactCleanupScheduler, stopArtifactCleanupScheduler } from "../artifacts/lifecycle.js";
import { installControlEventProjection } from "../control-plane/timeline.js";
const log = createLogger("api:server");
let server = null;
export async function startServer() {
    const cfg = getConfig();
    if (!cfg.webui.enabled)
        return;
    server = Fastify({ logger: false });
    installControlEventProjection();
    await server.register(cors, { origin: true });
    await server.register(websocketPlugin);
    const __dirname = fileURLToPath(new URL(".", import.meta.url));
    const webuiDist = join(__dirname, "../../../webui/dist");
    if (existsSync(webuiDist)) {
        await server.register(staticPlugin, {
            root: webuiDist,
            prefix: "/",
            decorateReply: false,
        });
        server.setNotFoundHandler(async (_req, reply) => {
            return reply.sendFile("index.html", webuiDist);
        });
    }
    else {
        server.setNotFoundHandler(async (_req, reply) => {
            return reply.status(404).send({ error: "WebUI not built. Run: pnpm build --filter @nobie/webui" });
        });
    }
    registerStatusRoute(server);
    registerCapabilitiesRoute(server);
    registerArtifactsRoute(server);
    registerAgentRoutes(server);
    registerToolsRoute(server);
    registerAuditRoute(server);
    registerSettingsRoute(server);
    registerSetupRoute(server);
    registerRunsRoute(server);
    registerInstructionsRoute(server);
    registerMcpRoute(server);
    registerUpdateRoute(server);
    registerSchedulesRoute(server);
    registerSchedulerRoute(server);
    registerPluginsRoute(server);
    registerMemoryRoute(server);
    registerPromptSourcesRoute(server);
    registerConfigOperationsRoute(server);
    registerChannelSmokeRoute(server);
    registerDoctorRoute(server);
    registerControlTimelineRoute(server);
    registerUiModeRoute(server);
    registerAdminRoute(server);
    registerWsRoute(server);
    const { host, port } = cfg.webui;
    await server.listen({ host, port });
    log.info(`WebUI server listening on http://${host}:${port}`);
    eventBus.emit("gateway.started", { host, port });
    eventBus.emit("channel.connected", { channel: "webui", detail: { host, port } });
    startArtifactCleanupScheduler();
    startScheduler();
    await pluginLoader.loadAll();
}
export async function closeServer() {
    stopArtifactCleanupScheduler();
    stopScheduler();
    stopActiveSlackChannel();
    stopActiveTelegramChannel();
    await stopMqttBroker();
    await mcpRegistry.closeAll();
    if (server) {
        await server.close();
        server = null;
        log.info("WebUI server closed");
    }
}
//# sourceMappingURL=server.js.map
