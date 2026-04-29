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
  const imessageConfigured = Boolean(
    cfg.imessage?.localBridgeEnabled
    && cfg.imessage.riskAcknowledged
    && cfg.imessage.messagesAppAvailable
    && cfg.imessage.userSessionActive
    && cfg.imessage.automationPermissionGranted
    && cfg.imessage.allowedRecipientIds.length > 0,
  )
  const kakaoTalkOfficialConfigured = Boolean(
    cfg.kakaoTalk?.mode === "official"
    && cfg.kakaoTalk.businessApiEnabled
    && cfg.kakaoTalk.businessApiKey
    && cfg.kakaoTalk.channelId,
  )
  const kakaoTalkLocalConfigured = Boolean(
    cfg.kakaoTalk?.mode === "local_bridge"
    && cfg.kakaoTalk.localBridgeEnabled
    && cfg.kakaoTalk.riskAcknowledged
    && cfg.kakaoTalk.kakaoTalkAppAvailable
    && cfg.kakaoTalk.userSessionActive
    && cfg.kakaoTalk.automationPermissionGranted
    && (cfg.kakaoTalk.allowedUserIds.length > 0 || cfg.kakaoTalk.allowedRoomIds.length > 0),
  )
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
        discordConfigured: Boolean(cfg.discord?.botToken && cfg.discord?.applicationId),
        discordEnabled: cfg.discord?.enabled === true,
        googleChatConfigured: Boolean((cfg.googleChat?.projectId || cfg.googleChat?.appCredentialJson || cfg.googleChat?.serviceAccountEmail) && cfg.googleChat?.verificationToken),
        googleChatEnabled: cfg.googleChat?.enabled === true,
        imessageConfigured,
        imessageEnabled: cfg.imessage?.enabled === true,
        kakaoTalkConfigured: kakaoTalkOfficialConfigured || kakaoTalkLocalConfigured,
        kakaoTalkEnabled: cfg.kakaoTalk?.enabled === true,
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
