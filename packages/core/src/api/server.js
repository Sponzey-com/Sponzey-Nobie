import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import cors from "@fastify/cors";
import staticPlugin from "@fastify/static";
import websocketPlugin from "@fastify/websocket";
import Fastify from "fastify";
import { startArtifactCleanupScheduler, stopArtifactCleanupScheduler, } from "../artifacts/lifecycle.js";
import { stopActiveSlackChannel } from "../channels/slack/runtime.js";
import { stopActiveTelegramChannel } from "../channels/telegram/runtime.js";
import { getConfig } from "../config/index.js";
import { installControlEventProjection } from "../control-plane/timeline.js";
import { eventBus } from "../events/index.js";
import { createLogger } from "../logger/index.js";
import { mcpRegistry } from "../mcp/registry.js";
import { stopMqttBroker } from "../mqtt/broker.js";
import { installOrchestrationEventProjection } from "../orchestration/event-ledger.js";
import { pluginLoader } from "../plugins/loader.js";
import { startScheduler, stopScheduler } from "../scheduler/index.js";
import { registerAdminRoute } from "./routes/admin.js";
import { registerAgentRoutes } from "./routes/agent.js";
import { registerArtifactsRoute } from "./routes/artifacts.js";
import { registerAuditRoute } from "./routes/audit.js";
import { registerBenchmarkRoutes } from "./routes/benchmarks.js";
import { registerCapabilitiesRoute } from "./routes/capabilities.js";
import { registerChannelSmokeRoute } from "./routes/channel-smoke.js";
import { registerCommandPaletteRoutes } from "./routes/command-palette.js";
import { registerConfigOperationsRoute } from "./routes/config-operations.js";
import { registerControlTimelineRoute } from "./routes/control-timeline.js";
import { registerDataExchangeRoutes } from "./routes/data-exchanges.js";
import { registerDoctorRoute } from "./routes/doctor.js";
import { registerInstructionsRoute } from "./routes/instructions.js";
import { registerMcpRoute } from "./routes/mcp.js";
import { registerMemoryRoute } from "./routes/memory.js";
import { registerOrchestrationEventsRoute } from "./routes/orchestration-events.js";
import { registerPluginsRoute } from "./routes/plugins.js";
import { registerPromptSourcesRoute } from "./routes/prompt-sources.js";
import { registerRunsRoute } from "./routes/runs.js";
import { registerSchedulerRoute } from "./routes/scheduler.js";
import { registerSchedulesRoute } from "./routes/schedules.js";
import { registerSettingsRoute } from "./routes/settings.js";
import { registerSetupRoute } from "./routes/setup.js";
import { registerStatusRoute } from "./routes/status.js";
import { registerSubSessionRoutes } from "./routes/subsessions.js";
import { registerToolsRoute } from "./routes/tools.js";
import { registerUiModeRoute } from "./routes/ui-mode.js";
import { registerUpdateRoute } from "./routes/update.js";
import { registerWsRoute } from "./ws/stream.js";
const log = createLogger("api:server");
let server = null;
export async function startServer() {
    const cfg = getConfig();
    if (!cfg.webui.enabled)
        return;
    server = Fastify({ logger: false });
    installControlEventProjection();
    installOrchestrationEventProjection();
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
            return reply
                .status(404)
                .send({ error: "WebUI not built. Run: pnpm build --filter @nobie/webui" });
        });
    }
    registerStatusRoute(server);
    registerBenchmarkRoutes(server);
    registerCapabilitiesRoute(server);
    registerArtifactsRoute(server);
    registerAgentRoutes(server);
    registerToolsRoute(server);
    registerAuditRoute(server);
    registerSettingsRoute(server);
    registerSetupRoute(server);
    registerRunsRoute(server);
    registerSubSessionRoutes(server);
    registerCommandPaletteRoutes(server);
    registerDataExchangeRoutes(server);
    registerInstructionsRoute(server);
    registerMcpRoute(server);
    registerOrchestrationEventsRoute(server);
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