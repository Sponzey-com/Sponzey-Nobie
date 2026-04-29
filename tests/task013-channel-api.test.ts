import { createRequire } from "node:module"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { registerChannelsRoute } from "../packages/core/src/api/routes/channels.ts"
import { reloadConfig } from "../packages/core/src/config/index.js"
import {
  closeDb,
  insertMessageLedgerEvent,
} from "../packages/core/src/db/index.js"
import { createApprovalRegistryRequest, getApprovalRegistryRow } from "../packages/core/src/runs/approval-registry.js"

const require = createRequire(import.meta.url)
const Fastify = require("../packages/core/node_modules/fastify") as (options: { logger: boolean }) => {
  ready(): Promise<void>
  close(): Promise<void>
  inject(options: { method: string; url: string; payload?: unknown }): Promise<{ statusCode: number; json(): any }>
}

const tempDirs: string[] = []
const previousStateDir = process.env["NOBIE_STATE_DIR"]
const previousConfig = process.env["NOBIE_CONFIG"]

function useTempState(config: Record<string, unknown> = {}): void {
  closeDb()
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-task013-channel-api-"))
  tempDirs.push(stateDir)
  process.env["NOBIE_STATE_DIR"] = stateDir
  delete process.env["NOBIE_CONFIG"]
  writeFileSync(join(stateDir, "config.json5"), JSON.stringify(config, null, 2), "utf-8")
  reloadConfig()
}

async function withApp(fn: (app: ReturnType<typeof Fastify>) => Promise<void>): Promise<void> {
  const app = Fastify({ logger: false })
  registerChannelsRoute(app)
  await app.ready()
  try {
    await fn(app)
  } finally {
    await app.close()
  }
}

beforeEach(() => {
  useTempState({
    telegram: {
      enabled: true,
      botToken: "123456:telegram-secret-token",
      allowedUserIds: [1001],
      allowedGroupIds: [-2002],
    },
    slack: {
      enabled: false,
      botToken: "xoxb-slack-secret-token",
      appToken: "xapp-slack-secret-token",
      allowedUserIds: ["U123"],
      allowedChannelIds: ["C123"],
    },
  })
})

afterEach(() => {
  closeDb()
  if (previousStateDir === undefined) delete process.env["NOBIE_STATE_DIR"]
  else process.env["NOBIE_STATE_DIR"] = previousStateDir
  if (previousConfig === undefined) delete process.env["NOBIE_CONFIG"]
  else process.env["NOBIE_CONFIG"] = previousConfig
  reloadConfig()
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe("task013 channel API", () => {
  it("lists channel connections with redacted secrets and health/capability detail", async () => {
    await withApp(async (app) => {
      const list = await app.inject({ method: "GET", url: "/api/channels" })
      expect(list.statusCode).toBe(200)
      const body = list.json()
      expect(body.channels).toEqual(expect.arrayContaining([
        expect.objectContaining({
          channelId: "telegram:primary",
          provider: "telegram",
          enabled: true,
          configured: true,
          riskLevel: "low",
        }),
        expect.objectContaining({
          channelId: "slack:primary",
          provider: "slack",
          enabled: false,
          configured: true,
        }),
      ]))
      expect(JSON.stringify(body)).not.toContain("telegram-secret-token")
      expect(JSON.stringify(body)).not.toContain("slack-secret-token")

      const health = await app.inject({ method: "GET", url: "/api/channels/telegram:primary/health" })
      expect(health.statusCode).toBe(200)
      expect(health.json().validation.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: "runtime_stopped" }),
      ]))

      const capabilities = await app.inject({ method: "GET", url: "/api/channels/telegram:primary/capabilities" })
      expect(capabilities.statusCode).toBe(200)
      expect(capabilities.json().capabilities).toEqual(expect.objectContaining({
        provider: "telegram",
        supportsReplies: true,
      }))
    })
  })

  it("handles enable, disable, test-send validation, and local bridge risk acknowledgement", async () => {
    await withApp(async (app) => {
      const disabledTest = await app.inject({ method: "POST", url: "/api/channels/slack:primary/test" })
      expect(disabledTest.statusCode).toBe(400)
      expect(disabledTest.json()).toEqual(expect.objectContaining({ ok: false, error: "channel is disabled" }))

      const disable = await app.inject({ method: "POST", url: "/api/channels/telegram:primary/disable" })
      expect(disable.statusCode).toBe(200)
      expect(disable.json().channel.enabled).toBe(false)

      const enable = await app.inject({ method: "POST", url: "/api/channels/telegram:primary/enable" })
      expect(enable.statusCode).toBe(200)
      expect(enable.json().channel.enabled).toBe(true)

      const bridge = await app.inject({ method: "POST", url: "/api/channels/imessage:local/enable" })
      expect(bridge.statusCode).toBe(400)
      expect(bridge.json()).toEqual(expect.objectContaining({
        ok: false,
        requiresRiskAcknowledgment: true,
      }))

      const bridgeAck = await app.inject({
        method: "POST",
        url: "/api/channels/imessage:local/enable",
        payload: { acknowledgeRisk: true },
      })
      expect(bridgeAck.statusCode).toBe(200)
      expect(bridgeAck.json().channel).toEqual(expect.objectContaining({
        channelId: "imessage:local",
        enabled: true,
      }))
      expect(bridgeAck.json().channel.validation.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: "local_bridge_not_available" }),
      ]))

      const bridgeDisable = await app.inject({ method: "POST", url: "/api/channels/imessage:local/disable" })
      expect(bridgeDisable.statusCode).toBe(200)
      expect(bridgeDisable.json().channel.enabled).toBe(false)
    })
  })

  it("exposes channel message ledger by run/task without raw payload leakage", async () => {
    const ledgerId = insertMessageLedgerEvent({
      runId: "run-task013",
      requestGroupId: "task-task013",
      sessionKey: "telegram:chat:1",
      threadKey: "telegram:chat:1",
      channel: "telegram",
      eventKind: "ingress_received",
      deliveryKey: "delivery-task013",
      idempotencyKey: "idem-task013",
      status: "received",
      summary: "received channel message",
      detail: {
        rawPayload: { token: "raw-secret-value", text: "hello" },
        safe: "visible",
      },
      createdAt: 1_800_000_000_000,
    })
    expect(ledgerId).toBeTruthy()

    await withApp(async (app) => {
      const byRun = await app.inject({
        method: "GET",
        url: "/api/runs/run-task013/channel-messages?channel=telegram",
      })
      expect(byRun.statusCode).toBe(200)
      expect(byRun.json().messages).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: ledgerId,
          type: "ledger_event",
          channel: "telegram",
          detail: expect.objectContaining({
            rawPayload: "[redacted]",
            safe: "visible",
          }),
        }),
      ]))
      expect(JSON.stringify(byRun.json())).not.toContain("raw-secret-value")

      const byTask = await app.inject({
        method: "GET",
        url: "/api/tasks/task-task013/channel-messages",
      })
      expect(byTask.statusCode).toBe(200)
      expect(byTask.json().messages.some((message: { id: string }) => message.id === ledgerId)).toBe(true)

      const detail = await app.inject({ method: "GET", url: `/api/channel-messages/${ledgerId}` })
      expect(detail.statusCode).toBe(200)
      expect(JSON.stringify(detail.json())).not.toContain("raw-secret-value")
    })
  })

  it("records delivery retry intent without bypassing finalized delivery idempotency", async () => {
    insertMessageLedgerEvent({
      id: "ledger-finalized-task013",
      runId: "run-finalized-task013",
      requestGroupId: "task-finalized-task013",
      channel: "telegram",
      eventKind: "delivery_finalized",
      deliveryKey: "delivery-finalized-task013",
      idempotencyKey: "delivery-finalized-idem-task013",
      status: "delivered",
      summary: "delivery finalized",
      detail: { providerResponse: { token: "provider-secret" } },
      createdAt: 1_800_000_000_001,
    })

    await withApp(async (app) => {
      const retry = await app.inject({
        method: "POST",
        url: "/api/channel-deliveries/delivery-finalized-task013/retry",
      })
      expect(retry.statusCode).toBe(200)
      expect(retry.json()).toEqual(expect.objectContaining({
        ok: true,
        status: "suppressed",
        reason: "already_finalized",
      }))
      expect(JSON.stringify(retry.json())).not.toContain("provider-secret")
    })
  })

  it("converges WebUI and channel interactions into the same approval registry", async () => {
    createApprovalRegistryRequest({
      id: "approval-webui-task013",
      runId: "run-approval-webui-task013",
      channel: "webui",
      toolName: "shell_exec",
      riskLevel: "high",
      kind: "approval",
      params: { command: "printf ok", token: "approval-secret" },
      supersedePending: false,
      now: 1_800_000_000_100,
    })
    createApprovalRegistryRequest({
      id: "approval-channel-task013",
      runId: "run-approval-channel-task013",
      channel: "telegram",
      toolName: "shell_exec",
      riskLevel: "high",
      kind: "approval",
      params: { command: "printf no" },
      supersedePending: false,
      now: 1_800_000_000_200,
    })

    await withApp(async (app) => {
      const webui = await app.inject({
        method: "POST",
        url: "/api/approvals/approval-webui-task013/respond",
        payload: { decision: "allow_once", decisionBy: "operator" },
      })
      expect(webui.statusCode).toBe(200)
      expect(webui.json()).toEqual(expect.objectContaining({ accepted: true, status: "approved_once" }))

      const interaction = await app.inject({
        method: "POST",
        url: "/api/channel-interactions",
        payload: {
          provider: "telegram",
          connectionId: "telegram:primary",
          interactionId: "callback-task013",
          kind: "approval",
          approvalId: "approval-channel-task013",
          approvalDecision: "deny",
          senderId: "1001",
          rawPayload: { token: "callback-secret" },
        },
      })
      expect(interaction.statusCode).toBe(200)
      expect(interaction.json().verification).toEqual(expect.objectContaining({
        verified: true,
        trustBoundary: "authenticated_webui_api",
      }))

      expect(getApprovalRegistryRow("approval-webui-task013")?.status).toBe("approved_once")
      expect(getApprovalRegistryRow("approval-channel-task013")?.status).toBe("denied")

      const approvals = await app.inject({ method: "GET", url: "/api/approvals?limit=10" })
      expect(approvals.statusCode).toBe(200)
      expect(JSON.stringify(approvals.json())).not.toContain("approval-secret")
    })
  })
})
