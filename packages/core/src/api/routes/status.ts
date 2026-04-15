import type { FastifyInstance } from "fastify"
import { getConfig, PATHS } from "../../config/index.js"
import {
  createCapabilities,
  createCapabilityCounts,
  getPrimaryAiTarget,
  readSetupState,
} from "../../control-plane/index.js"
import { getDefaultModel, detectAvailableProvider } from "../../ai/index.js"
import { mcpRegistry } from "../../mcp/registry.js"
import { getMqttBrokerSnapshot } from "../../mqtt/broker.js"
import { toolDispatcher } from "../../tools/index.js"
import { authMiddleware } from "../middleware/auth.js"
import { getCurrentAppVersion, getUpdateSnapshot } from "../../update/service.js"
import { getLastStartupRecoverySummary } from "../../runs/startup-recovery.js"
import { getFastResponseHealthSnapshot } from "../../observability/latency.js"

const startTime = Date.now()

export function registerStatusRoute(app: FastifyInstance): void {
  app.get("/api/status", { preHandler: authMiddleware }, async () => {
    const cfg = getConfig()
    const setupState = readSetupState()
    const capabilities = createCapabilities()
    const orchestrator = capabilities.find((item) => item.key === "gateway.orchestrator")
    return {
      version: getCurrentAppVersion(),
      provider: detectAvailableProvider(),
      model: getDefaultModel(),
      uptime: Math.floor((Date.now() - startTime) / 1000),
      toolCount: toolDispatcher.getAll().length,
      setupCompleted: setupState.completed,
      capabilityCounts: createCapabilityCounts(),
      primaryAiTarget: getPrimaryAiTarget(),
      orchestratorStatus: orchestrator
        ? { status: orchestrator.status, reason: orchestrator.reason ?? null }
        : { status: "planned", reason: "Gateway orchestrator capability가 없습니다." },
      startupRecovery: getLastStartupRecoverySummary(),
      fast_response_health: getFastResponseHealthSnapshot(),
      mcp: mcpRegistry.getSummary(),
      mqtt: getMqttBrokerSnapshot(),
      paths: {
        stateDir: PATHS.stateDir,
        configFile: PATHS.configFile,
        dbFile: PATHS.dbFile,
        setupStateFile: PATHS.setupStateFile,
      },
      webui: {
        port: cfg.webui.port,
        host: cfg.webui.host,
        authEnabled: cfg.webui.auth.enabled,
      },
      update: (() => {
        const update = getUpdateSnapshot()
        return {
          status: update.status,
          latestVersion: update.latestVersion,
          checkedAt: update.checkedAt,
          updateAvailable: update.updateAvailable,
        }
      })(),
    }
  })
}
