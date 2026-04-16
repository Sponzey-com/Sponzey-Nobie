import { createHash } from "node:crypto"
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
import { getMqttBrokerSnapshot, getMqttExtensionSnapshots } from "../../mqtt/broker.js"
import { toolDispatcher } from "../../tools/index.js"
import { authMiddleware } from "../middleware/auth.js"
import { getCurrentAppVersion, getUpdateSnapshot } from "../../update/service.js"
import { getCurrentDisplayVersion, getWorkspaceRootPath } from "../../version.js"
import { getLastStartupRecoverySummary } from "../../runs/startup-recovery.js"
import { getFastResponseHealthSnapshot } from "../../observability/latency.js"
import { loadPromptSourceRegistry } from "../../memory/nobie-md.js"

const startTime = Date.now()
const startedAt = new Date(startTime).toISOString()

function getPromptSourceSnapshot(): { count: number; checksum: string | null } {
  try {
    const sources = loadPromptSourceRegistry(getWorkspaceRootPath())
    if (sources.length === 0) return { count: 0, checksum: null }
    const digest = createHash("sha256")
    for (const source of sources) {
      digest.update(source.sourceId)
      digest.update("\0")
      digest.update(source.locale)
      digest.update("\0")
      digest.update(source.checksum)
      digest.update("\n")
    }
    return { count: sources.length, checksum: digest.digest("hex") }
  } catch {
    return { count: 0, checksum: null }
  }
}

export function registerStatusRoute(app: FastifyInstance): void {
  app.get("/api/status", { preHandler: authMiddleware }, async () => {
    const cfg = getConfig()
    const setupState = readSetupState()
    const capabilities = createCapabilities()
    const orchestrator = capabilities.find((item) => item.key === "gateway.orchestrator")
    const uptime = Math.floor((Date.now() - startTime) / 1000)
    return {
      version: getCurrentAppVersion(),
      displayVersion: getCurrentDisplayVersion(),
      provider: detectAvailableProvider(),
      model: getDefaultModel(),
      uptime,
      runtime: {
        pid: process.pid,
        ppid: process.ppid,
        cwd: process.cwd(),
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        startedAt,
        uptimeSeconds: uptime,
      },
      toolCount: toolDispatcher.getAll().length,
      setupCompleted: setupState.completed,
      capabilityCounts: createCapabilityCounts(),
      primaryAiTarget: getPrimaryAiTarget(),
      orchestratorStatus: orchestrator
        ? { status: orchestrator.status, reason: orchestrator.reason ?? null }
        : { status: "planned", reason: "Gateway orchestrator capability가 없습니다." },
      startupRecovery: getLastStartupRecoverySummary(),
      fast_response_health: getFastResponseHealthSnapshot(),
      promptSources: getPromptSourceSnapshot(),
      mcp: mcpRegistry.getSummary(),
      mqtt: getMqttBrokerSnapshot(),
      yeonjang: {
        extensions: getMqttExtensionSnapshots(),
      },
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
