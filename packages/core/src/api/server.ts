import Fastify from "fastify"
import cors from "@fastify/cors"
import staticPlugin from "@fastify/static"
import websocketPlugin from "@fastify/websocket"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { getConfig } from "../config/index.js"
import { createLogger } from "../logger/index.js"
import { registerStatusRoute } from "./routes/status.js"
import { registerCapabilitiesRoute } from "./routes/capabilities.js"
import { registerAgentRoutes } from "./routes/agent.js"
import { registerToolsRoute } from "./routes/tools.js"
import { registerAuditRoute } from "./routes/audit.js"
import { registerSettingsRoute } from "./routes/settings.js"
import { registerSchedulesRoute } from "./routes/schedules.js"
import { registerSchedulerRoute } from "./routes/scheduler.js"
import { registerPluginsRoute } from "./routes/plugins.js"
import { registerSetupRoute } from "./routes/setup.js"
import { registerRunsRoute } from "./routes/runs.js"
import { registerInstructionsRoute } from "./routes/instructions.js"
import { registerMcpRoute } from "./routes/mcp.js"
import { registerUpdateRoute } from "./routes/update.js"
import { registerWsRoute } from "./ws/stream.js"
import { startScheduler, stopScheduler } from "../scheduler/index.js"
import { pluginLoader } from "../plugins/loader.js"
import { mcpRegistry } from "../mcp/registry.js"
import { stopMqttBroker } from "../mqtt/broker.js"

const log = createLogger("api:server")

let server: ReturnType<typeof Fastify> | null = null

export async function startServer(): Promise<void> {
  const cfg = getConfig()
  if (!cfg.webui.enabled) return

  server = Fastify({ logger: false })

  await server.register(cors, { origin: true })
  await server.register(websocketPlugin)

  const __dirname = fileURLToPath(new URL(".", import.meta.url))
  const webuiDist = join(__dirname, "../../../webui/dist")
  if (existsSync(webuiDist)) {
    await server.register(staticPlugin, {
      root: webuiDist,
      prefix: "/",
      decorateReply: false,
    })
    server.setNotFoundHandler(async (_req: unknown, reply: { sendFile: (f: string, r: string) => unknown }) => {
      return reply.sendFile("index.html", webuiDist)
    })
  } else {
    server.setNotFoundHandler(async (_req: unknown, reply: { status: (n: number) => { send: (o: unknown) => unknown } }) => {
      return reply.status(404).send({ error: "WebUI not built. Run: pnpm build --filter @nobie/webui" })
    })
  }

  registerStatusRoute(server)
  registerCapabilitiesRoute(server)
  registerAgentRoutes(server)
  registerToolsRoute(server)
  registerAuditRoute(server)
  registerSettingsRoute(server)
  registerSetupRoute(server)
  registerRunsRoute(server)
  registerInstructionsRoute(server)
  registerMcpRoute(server)
  registerUpdateRoute(server)
  registerSchedulesRoute(server)
  registerSchedulerRoute(server)
  registerPluginsRoute(server)
  registerWsRoute(server)

  const { host, port } = cfg.webui
  await server.listen({ host, port })
  log.info(`WebUI server listening on http://${host}:${port}`)

  startScheduler()
  await pluginLoader.loadAll()
}

export async function closeServer(): Promise<void> {
  stopScheduler()
  await stopMqttBroker()
  await mcpRegistry.closeAll()
  if (server) {
    await server.close()
    server = null
    log.info("WebUI server closed")
  }
}
