import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  ChannelRegistry,
  CHANNEL_REGISTRY_RUNTIME_FEATURE_KEY,
  resolveChannelRegistryRuntimeMode,
  type ChannelProviderFactory,
  type ChannelRuntimeAdapter,
  type ChannelRuntimeHealth,
} from "../packages/core/src/channels/index.ts"
import {
  buildCompatChannelConnectionsFromConfig,
  type ChannelConnectionRecord,
} from "../packages/core/src/channels/connections.ts"
import type { ChannelCapabilities } from "../packages/core/src/channels/contracts.ts"
import { reloadConfig } from "../packages/core/src/config/index.js"
import { DEFAULT_CONFIG, type NobieConfig } from "../packages/core/src/config/types.ts"
import {
  closeDb,
  listChannelConnections,
  listChannelRuntimeEvents,
} from "../packages/core/src/db/index.js"
import { getFeatureFlag, setFeatureFlagMode } from "../packages/core/src/runtime/rollout-safety.ts"

const previousStateDir = process.env["NOBIE_STATE_DIR"]
const previousConfig = process.env["NOBIE_CONFIG"]
const tempDirs: string[] = []

function useTempState(): void {
  closeDb()
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-channel-registry-"))
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

function configWithTelegram(patch: Partial<NobieConfig["telegram"]> = {}): NobieConfig {
  const config = structuredClone(DEFAULT_CONFIG)
  config.telegram = {
    enabled: true,
    botToken: "123456789:telegram-secret-token",
    allowedUserIds: [],
    allowedGroupIds: [],
    ...patch,
  }
  config.slack = {
    enabled: false,
    botToken: "",
    appToken: "",
    allowedUserIds: [],
    allowedChannelIds: [],
  }
  return config
}

function makeFactory(input: {
  provider?: string
  onStart?: () => Promise<void> | void
  health?: ChannelRuntimeHealth
  startCountRef?: { count: number }
} = {}): ChannelProviderFactory {
  return {
    provider: input.provider ?? "telegram",
    create: ({ connection }) => {
      const adapter: ChannelRuntimeAdapter = {
        provider: connection.provider,
        connectionId: connection.connectionId,
        async start() {
          if (input.startCountRef) input.startCountRef.count += 1
          await input.onStart?.()
        },
        stop() {},
        async healthCheck() {
          return input.health ?? { status: "healthy", message: "fake runtime running", checkedAt: 100 }
        },
        getCapabilities() {
          return connection.capabilityManifest
        },
      }
      return adapter
    },
  }
}

function unsupportedDiscordConnection(base: ChannelConnectionRecord): ChannelConnectionRecord {
  const capabilities: ChannelCapabilities = {
    ...base.capabilityManifest,
    provider: "discord",
    connectionKind: "socket",
  }
  return {
    ...base,
    connectionId: "discord:primary",
    provider: "discord",
    displayName: "Discord",
    enabled: true,
    configured: true,
    source: "discord",
    capabilityManifest: capabilities,
  }
}

describe("channel registry runtime", () => {
  it("starts enabled configured connections through a registered factory and records runtime health", async () => {
    const config = configWithTelegram()
    const startCount = { count: 0 }
    const registry = new ChannelRegistry({
      config,
      factories: [makeFactory({ startCountRef: startCount })],
      now: () => 100,
    })

    const result = await registry.startEnabled()
    const events = listChannelRuntimeEvents({ provider: "telegram" })
    const rows = listChannelConnections()

    expect(startCount.count).toBe(1)
    expect(result.summaries.find((item) => item.provider === "telegram")).toMatchObject({
      disposition: "started",
      health: { status: "healthy" },
      diagnostics: {
        connectionMode: "bot_api",
        requiresLocalBridge: false,
        requiresUserSession: false,
        riskLevel: "low",
      },
    })
    expect(events.map((event) => event.event_kind)).toContain("started")
    expect(rows.find((row) => row.connection_id === "telegram:primary")).toMatchObject({
      health_status: "healthy",
    })
  })

  it("skips disabled and unconfigured connections without starting factories", async () => {
    const disabled = configWithTelegram({ enabled: false })
    const unconfigured = configWithTelegram({ enabled: true, botToken: "" })
    const startCount = { count: 0 }

    const disabledResult = await new ChannelRegistry({
      config: disabled,
      factories: [makeFactory({ startCountRef: startCount })],
      now: () => 101,
    }).startEnabled()
    const unconfiguredResult = await new ChannelRegistry({
      config: unconfigured,
      factories: [makeFactory({ startCountRef: startCount })],
      now: () => 102,
    }).startEnabled()

    expect(startCount.count).toBe(0)
    expect(disabledResult.summaries.find((item) => item.provider === "telegram")?.disposition).toBe("skipped_disabled")
    expect(unconfiguredResult.summaries.find((item) => item.provider === "telegram")?.disposition).toBe("skipped_unconfigured")
    expect(listChannelRuntimeEvents({ provider: "telegram" }).map((event) => event.event_kind)).toEqual(expect.arrayContaining([
      "start_skipped_disabled",
      "start_skipped_unconfigured",
    ]))
  })

  it("reports unsupported providers and keeps process-level start successful", async () => {
    const config = configWithTelegram()
    const base = buildCompatChannelConnectionsFromConfig(config, { now: 103 })[0]!
    const registry = new ChannelRegistry({
      config,
      connections: [unsupportedDiscordConnection(base)],
      factories: [],
      now: () => 103,
    })

    const result = await registry.startEnabled()

    expect(result.summaries).toEqual([
      expect.objectContaining({
        provider: "discord",
        supported: false,
        disposition: "unsupported_provider",
        health: expect.objectContaining({ status: "failed" }),
      }),
    ])
    expect(listChannelRuntimeEvents({ provider: "discord" })[0]).toMatchObject({
      event_kind: "unsupported_provider",
      health_status: "failed",
    })
  })

  it("captures runtime start failures as failed summaries instead of throwing", async () => {
    const config = configWithTelegram()
    const registry = new ChannelRegistry({
      config,
      factories: [makeFactory({ onStart: () => { throw new Error("socket denied") } })],
      now: () => 104,
    })

    const result = await registry.startEnabled()
    expect(result.summaries.find((item) => item.provider === "telegram")).toMatchObject({
      provider: "telegram",
      disposition: "failed",
      health: expect.objectContaining({ status: "failed", message: "socket denied" }),
    })
    expect(listChannelRuntimeEvents({ provider: "telegram" })[0]).toMatchObject({
      event_kind: "start_failed",
      health_status: "failed",
    })
  })

  it("keeps registry runtime behind an explicit feature flag for rollback", () => {
    expect(resolveChannelRegistryRuntimeMode(getFeatureFlag(CHANNEL_REGISTRY_RUNTIME_FEATURE_KEY))).toBe("legacy")

    setFeatureFlagMode({
      featureKey: CHANNEL_REGISTRY_RUNTIME_FEATURE_KEY,
      mode: "enforced",
      compatibilityMode: false,
      updatedBy: "test",
    })
    expect(resolveChannelRegistryRuntimeMode(getFeatureFlag(CHANNEL_REGISTRY_RUNTIME_FEATURE_KEY))).toBe("registry")

    setFeatureFlagMode({
      featureKey: CHANNEL_REGISTRY_RUNTIME_FEATURE_KEY,
      mode: "rollback",
      compatibilityMode: true,
      updatedBy: "test",
    })
    expect(resolveChannelRegistryRuntimeMode(getFeatureFlag(CHANNEL_REGISTRY_RUNTIME_FEATURE_KEY))).toBe("legacy")
  })
})
