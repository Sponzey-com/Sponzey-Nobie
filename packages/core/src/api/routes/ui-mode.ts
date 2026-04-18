import type { FastifyInstance } from "fastify"
import { authMiddleware } from "../middleware/auth.js"
import { getUiModeState, savePreferredUiMode, type PreferredUiMode } from "../../ui/mode.js"
import { getConfig } from "../../config/index.js"
import { readSetupState } from "../../control-plane/index.js"
import { getMqttExtensionSnapshots } from "../../mqtt/broker.js"
import { listActiveRootRuns } from "../../runs/store.js"
import { buildUiViewModels, type UiShellDomainState } from "../../ui/view-model.js"

function parsePreferredUiMode(value: unknown): PreferredUiMode | null {
  if (typeof value !== "string") return null
  const normalized = value.trim().toLowerCase()
  if (normalized === "beginner" || normalized === "advanced") return normalized
  return null
}

function buildUiShellDomainState(): UiShellDomainState {
  const cfg = getConfig()
  const activeRuns = listActiveRootRuns()
  const extensions = getMqttExtensionSnapshots()
  return {
    generatedAt: Date.now(),
    mode: getUiModeState(),
    setupState: {
      completed: readSetupState().completed,
    },
    runtimeHealth: {
      ai: {
        configured: Boolean(cfg.ai.connection.provider && cfg.ai.connection.model),
        provider: cfg.ai.connection.provider || null,
        modelConfigured: Boolean(cfg.ai.connection.model),
      },
      channels: {
        webui: true,
        telegramConfigured: Boolean(cfg.telegram?.botToken),
        telegramEnabled: cfg.telegram?.enabled === true,
        slackConfigured: Boolean(cfg.slack?.botToken && cfg.slack?.appToken),
        slackEnabled: cfg.slack?.enabled === true,
      },
      yeonjang: {
        mqttEnabled: cfg.mqtt.enabled,
        connectedExtensions: extensions.length,
      },
    },
    activeRuns: {
      total: activeRuns.length,
      pendingApprovals: activeRuns.filter((run) => run.status === "awaiting_approval" || run.status === "awaiting_user").length,
    },
  }
}

export function registerUiModeRoute(app: FastifyInstance): void {
  app.get("/api/ui/mode", { preHandler: authMiddleware }, async () => {
    return getUiModeState()
  })

  app.get("/api/ui/shell", { preHandler: authMiddleware }, async () => {
    const shell = buildUiShellDomainState()
    return { ...shell, viewModel: buildUiViewModels(shell) }
  })

  app.post<{ Body: { mode?: unknown; preferredUiMode?: unknown } }>(
    "/api/ui/mode",
    { preHandler: authMiddleware },
    async (req, reply) => {
      const mode = parsePreferredUiMode(req.body?.mode ?? req.body?.preferredUiMode)
      if (!mode) {
        return reply.status(400).send({
          ok: false,
          error: "invalid ui mode",
          allowedModes: ["beginner", "advanced"],
        })
      }
      return reply.status(200).send({ ok: true, ...savePreferredUiMode(mode) })
    },
  )
}
