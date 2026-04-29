import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  applyChannelConnectionSettingsCompatPatch,
  buildCompatChannelConnectionsFromConfig,
  buildSettingsChannelConnectionSnapshot,
  namespaceChannelIdentity,
} from "../packages/core/src/channels/connections.ts"
import { reloadConfig } from "../packages/core/src/config/index.js"
import { DEFAULT_CONFIG, type NobieConfig } from "../packages/core/src/config/types.ts"
import {
  closeDb,
  getDb,
  listChannelCapabilities,
  listChannelConnections,
  listChannelIdentityMappings,
} from "../packages/core/src/db/index.js"

const previousStateDir = process.env["NOBIE_STATE_DIR"]
const previousConfig = process.env["NOBIE_CONFIG"]
const tempDirs: string[] = []

function configWithLegacyChannels(): NobieConfig {
  const config = structuredClone(DEFAULT_CONFIG)
  config.telegram = {
    enabled: true,
    botToken: "123456789:telegram-secret-token",
    allowedUserIds: [42, 77],
    allowedGroupIds: [-100100],
  }
  config.slack = {
    enabled: true,
    botToken: "xoxb-slack-bot-secret",
    appToken: "xapp-slack-app-secret",
    allowedUserIds: ["U123", "U456"],
    allowedChannelIds: ["C789"],
  }
  return config
}

function useTempState(): void {
  closeDb()
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-channel-connections-"))
  tempDirs.push(stateDir)
  process.env["NOBIE_STATE_DIR"] = stateDir
  delete process.env["NOBIE_CONFIG"]
  reloadConfig()
}

beforeEach(() => {
  useTempState()
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

describe("channel connection compat model", () => {
  it("projects legacy Telegram and Slack config without storing raw tokens", () => {
    const connections = buildCompatChannelConnectionsFromConfig(configWithLegacyChannels(), {
      now: 10,
      runtime: {
        telegram: { isRunning: true, lastStartedAt: 9, lastStoppedAt: null, lastError: null, lastErrorAt: null },
        slack: { isRunning: false, lastStartedAt: null, lastStoppedAt: null, lastError: null, lastErrorAt: null },
      },
    })

    const telegram = connections.find((connection) => connection.provider === "telegram")
    const slack = connections.find((connection) => connection.provider === "slack")
    const discord = connections.find((connection) => connection.provider === "discord")
    const googleChat = connections.find((connection) => connection.provider === "google_chat")
    const imessage = connections.find((connection) => connection.connectionId === "imessage:local")
    const kakaoTalkOfficial = connections.find((connection) => connection.connectionId === "kakaotalk:official")
    const kakaoTalkLocal = connections.find((connection) => connection.connectionId === "kakaotalk:local")
    expect(telegram).toMatchObject({
      connectionId: "telegram:primary",
      enabled: true,
      configured: true,
      connectionMode: "bot_api",
      health: { status: "healthy" },
    })
    expect(slack).toMatchObject({
      connectionId: "slack:primary",
      enabled: true,
      configured: true,
      connectionMode: "socket",
      health: { status: "stopped" },
    })
    expect(discord).toMatchObject({
      connectionId: "discord:primary",
      enabled: false,
      configured: false,
      connectionMode: "socket",
      health: { status: "stopped" },
    })
    expect(googleChat).toMatchObject({
      connectionId: "google_chat:primary",
      enabled: false,
      configured: false,
      connectionMode: "webhook",
      health: { status: "stopped" },
    })
    expect(imessage).toMatchObject({
      connectionId: "imessage:local",
      enabled: false,
      configured: false,
      connectionMode: "local_bridge",
      capabilityManifest: expect.objectContaining({
        requiresLocalBridge: true,
        requiresUserSession: true,
        manualConfirmationRequired: true,
        riskLevel: "experimental",
      }),
    })
    expect(kakaoTalkOfficial).toMatchObject({
      connectionId: "kakaotalk:official",
      enabled: false,
      configured: false,
      connectionMode: "webhook",
      capabilityManifest: expect.objectContaining({
        requiresWebhook: true,
        requiresLocalBridge: false,
      }),
    })
    expect(kakaoTalkLocal).toMatchObject({
      connectionId: "kakaotalk:local",
      enabled: false,
      configured: false,
      connectionMode: "local_bridge",
      capabilityManifest: expect.objectContaining({
        requiresLocalBridge: true,
        riskLevel: "experimental",
      }),
    })
    expect(telegram?.authSecretRefs).toEqual([expect.objectContaining({
      key: "botToken",
      ref: "config:telegram.botToken",
      present: true,
      redacted: true,
    })])
    expect(slack?.authSecretRefs).toEqual([
      expect.objectContaining({ key: "botToken", ref: "config:slack.botToken", present: true }),
      expect.objectContaining({ key: "appToken", ref: "config:slack.appToken", present: true }),
    ])
    expect(telegram?.allowedUsers.map((user) => user.namespaceId)).toEqual([
      "telegram:user:42",
      "telegram:user:77",
    ])
    expect(slack?.allowedRooms.map((room) => room.namespaceId)).toEqual(["slack:room:C789"])

    const serialized = JSON.stringify(connections)
    expect(serialized).not.toContain("telegram-secret-token")
    expect(serialized).not.toContain("xoxb-slack-bot-secret")
    expect(serialized).not.toContain("xapp-slack-app-secret")
  })

  it("persists connection, capability, and identity rows through migration 40", () => {
    const config = configWithLegacyChannels()
    buildSettingsChannelConnectionSnapshot({ config, persist: true, now: 20 })

    const latestMigration = getDb()
      .prepare<[], { version: number | null }>("SELECT MAX(version) AS version FROM schema_migrations")
      .get()?.version ?? 0
    expect(latestMigration).toBeGreaterThanOrEqual(40)

    const connections = listChannelConnections()
    const capabilities = listChannelCapabilities()
    const identities = listChannelIdentityMappings()
    expect(connections.map((connection) => connection.connection_id).sort()).toEqual([
      "discord:primary",
      "google_chat:primary",
      "imessage:local",
      "kakaotalk:local",
      "kakaotalk:official",
      "slack:primary",
      "telegram:primary",
    ])
    expect(capabilities.map((capability) => capability.connection_id).sort()).toEqual([
      "discord:primary",
      "google_chat:primary",
      "imessage:local",
      "kakaotalk:local",
      "kakaotalk:official",
      "slack:primary",
      "telegram:primary",
    ])
    expect(identities.map((identity) => identity.namespace_id).sort()).toEqual([
      "slack:room:C789",
      "slack:user:U123",
      "slack:user:U456",
      "telegram:room:-100100",
      "telegram:user:42",
      "telegram:user:77",
    ])

    const persisted = JSON.stringify({ connections, capabilities, identities })
    expect(persisted).not.toContain("telegram-secret-token")
    expect(persisted).not.toContain("xoxb-slack-bot-secret")
    expect(persisted).not.toContain("xapp-slack-app-secret")
  })

  it("maps new connection patches back into legacy settings during compatibility", () => {
    const raw: Record<string, unknown> = {}
    const result = applyChannelConnectionSettingsCompatPatch(raw, {
      connections: [
        {
          connectionId: "telegram:primary",
          enabled: true,
          allowedUsers: [namespaceChannelIdentity("telegram", "user", 42)],
          allowedRooms: [{ namespaceId: namespaceChannelIdentity("telegram", "room", -100100) }],
        },
        {
          provider: "slack",
          enabled: false,
          allowedUsers: [{ providerIdentityId: "U123" }],
          allowedRooms: ["slack:room:C789"],
        },
        {
          provider: "discord",
          enabled: true,
          allowedUsers: ["discord:user:USER1"],
          allowedRooms: [
            "guild:GUILD1",
            "channel:CHANNEL1",
          ],
        },
        {
          provider: "google_chat",
          enabled: true,
          allowedUsers: ["google_chat:user:users/USER1"],
          allowedRooms: ["google_chat:room:spaces/SPACE1"],
        },
      ],
    })

    expect(result.appliedConnectionIds.sort()).toEqual(["discord:primary", "google_chat:primary", "slack:primary", "telegram:primary"])
    expect(raw.telegram).toEqual({
      enabled: true,
      allowedUserIds: [42],
      allowedGroupIds: [-100100],
    })
    expect(raw.slack).toEqual({
      enabled: false,
      allowedUserIds: ["U123"],
      allowedChannelIds: ["C789"],
    })
    expect(raw.discord).toEqual({
      enabled: true,
      allowedUserIds: ["USER1"],
      allowedGuildIds: ["GUILD1"],
      allowedChannelIds: ["CHANNEL1"],
    })
    expect(raw.googleChat).toEqual({
      enabled: true,
      allowedUserIds: ["users/USER1"],
      allowedSpaceIds: ["spaces/SPACE1"],
    })
  })
})
