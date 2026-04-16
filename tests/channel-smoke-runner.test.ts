import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"
import { DEFAULT_CONFIG, type NobieConfig } from "../packages/core/src/config/types.ts"
import { reloadConfig } from "../packages/core/src/config/index.js"
import { closeDb, listChannelSmokeRuns, listChannelSmokeSteps } from "../packages/core/src/db/index.js"
import {
  createDryRunChannelSmokeExecutor,
  getDefaultChannelSmokeScenarios,
  resolveChannelSmokeReadiness,
  runChannelSmokeScenarios,
  runPersistedChannelSmokeScenarios,
  validateChannelSmokeTrace,
  type ChannelSmokeScenario,
  type ChannelSmokeTrace,
} from "../packages/core/src/channels/smoke-runner.ts"

function configWithChannels(patch: Partial<NobieConfig> = {}): NobieConfig {
  return {
    ...structuredClone(DEFAULT_CONFIG),
    ...patch,
  }
}

function scenario(id: string): ChannelSmokeScenario {
  const match = getDefaultChannelSmokeScenarios().find((candidate) => candidate.id === id)
  if (!match) throw new Error(`missing scenario: ${id}`)
  return match
}

function passingTrace(current: ChannelSmokeScenario): ChannelSmokeTrace {
  return {
    sourceChannel: current.channel,
    responseChannel: current.expectedTarget,
    correlationKey: current.correlationKey,
    auditLogId: `audit-${current.id}`,
    toolCalls: current.expectedTool
      ? [{ toolName: current.expectedTool, sourceChannel: current.channel, deliveryChannel: current.channel }]
      : [],
    approval: current.expectsApproval
      ? {
          requested: true,
          resolved: "approve_once",
          targetChannel: current.channel,
          correlationKey: current.correlationKey,
          uiVisible: true,
          uiKind: current.channel === "webui" ? "inline" : "button",
        }
      : undefined,
    artifacts: current.expectsArtifact
      ? [{ channel: current.channel, mode: current.channel === "webui" ? "download_link" : "native_file", url: "/api/artifacts/screens/test.png" }]
      : [],
    finalText: current.expectsFailure ? "지원하지 않는 기능이라 실행하지 않았습니다." : "완료했습니다.",
  }
}

describe("channel smoke runner", () => {
  it("defines four smoke scenarios per supported user channel", () => {
    const scenarios = getDefaultChannelSmokeScenarios()

    expect(scenarios).toHaveLength(12)
    expect(scenarios.filter((item) => item.channel === "webui")).toHaveLength(4)
    expect(scenarios.filter((item) => item.channel === "telegram")).toHaveLength(4)
    expect(scenarios.filter((item) => item.channel === "slack")).toHaveLength(4)
    expect(scenarios.filter((item) => item.expectsApproval)).toHaveLength(3)
    expect(scenarios.filter((item) => item.expectsArtifact)).toHaveLength(6)
  })

  it("skips external channel smoke tests when credentials or target ids are missing", () => {
    const config = configWithChannels()

    expect(resolveChannelSmokeReadiness(config, scenario("webui.basic_query"))).toEqual({ ready: true })
    expect(resolveChannelSmokeReadiness(config, scenario("telegram.basic_query"))).toEqual({
      ready: false,
      skipReason: "telegram_disabled",
    })
    expect(resolveChannelSmokeReadiness(config, scenario("slack.basic_query"))).toEqual({
      ready: false,
      skipReason: "slack_disabled",
    })
  })

  it("passes Slack artifact and approval traces only when they stay in the originating thread", () => {
    const slack = scenario("slack.approval_required_tool")

    expect(validateChannelSmokeTrace(slack, passingTrace(slack))).toEqual({
      status: "passed",
      failures: [],
    })
  })

  it("fails Slack smoke traces that try to use Telegram delivery", () => {
    const slack = scenario("slack.artifact_delivery")

    const result = validateChannelSmokeTrace(slack, {
      ...passingTrace(slack),
      toolCalls: [{ toolName: "telegram_send_file", sourceChannel: "slack", deliveryChannel: "telegram" }],
      artifacts: [{ channel: "telegram", mode: "native_file", filePath: "/tmp/wrong.png" }],
    })

    expect(result.status).toBe("failed")
    expect(result.failures).toEqual(expect.arrayContaining([
      "tool_delivery_channel_mismatch:telegram_send_file:telegram",
      "telegram_delivery_tool_used_outside_telegram",
      "artifact_channel_mismatch:telegram",
    ]))
  })

  it("fails non-Slack traces that try to use Slack delivery tools", () => {
    const telegram = scenario("telegram.artifact_delivery")

    const result = validateChannelSmokeTrace(telegram, {
      ...passingTrace(telegram),
      toolCalls: [{ toolName: "slack_file_upload", sourceChannel: "telegram", deliveryChannel: "slack" }],
      artifacts: [{ channel: "slack", mode: "native_file", filePath: "/tmp/wrong.png" }],
    })

    expect(result.status).toBe("failed")
    expect(result.failures).toEqual(expect.arrayContaining([
      "tool_delivery_channel_mismatch:slack_file_upload:slack",
      "slack_delivery_tool_used_outside_slack",
      "artifact_channel_mismatch:slack",
    ]))
  })

  it("fails approval traces when the originating channel did not show an approval button", () => {
    const slack = scenario("slack.approval_required_tool")

    const hidden = validateChannelSmokeTrace(slack, {
      ...passingTrace(slack),
      approval: { requested: true, resolved: "approve_once", targetChannel: "slack", correlationKey: "slack_thread", uiVisible: false },
    })
    const fallback = validateChannelSmokeTrace(slack, {
      ...passingTrace(slack),
      approval: { requested: true, resolved: "approve_once", targetChannel: "slack", correlationKey: "slack_thread", uiVisible: true, uiKind: "text_fallback" },
    })

    expect(hidden.status).toBe("failed")
    expect(hidden.failures).toContain("approval_ui_missing")
    expect(fallback.status).toBe("failed")
    expect(fallback.failures).toContain("approval_button_missing")
  })

  it("fails approval traces that timed out before a user decision", () => {
    const webui = scenario("webui.approval_required_tool")

    const result = validateChannelSmokeTrace(webui, {
      ...passingTrace(webui),
      approval: { requested: true, resolved: "timeout", targetChannel: "webui", correlationKey: "webui_run_id", uiVisible: true, uiKind: "inline" },
    })

    expect(result.status).toBe("failed")
    expect(result.failures).toContain("approval_timeout")
  })

  it("fails Web UI artifact smoke traces that expose only a local path", () => {
    const webui = scenario("webui.artifact_delivery")

    const result = validateChannelSmokeTrace(webui, {
      ...passingTrace(webui),
      artifacts: [{ channel: "webui", mode: "local_path_markdown", filePath: "/Users/test/.nobie/artifacts/screen.png" }],
      finalText: "![screenshot](/Users/test/.nobie/artifacts/screen.png)",
    })

    expect(result.status).toBe("failed")
    expect(result.failures).toEqual(expect.arrayContaining([
      "artifact_local_path_markdown",
      "webui_artifact_mode_invalid:local_path_markdown",
      "local_path_exposed_in_final_text",
    ]))
  })

  it("runs ready scenarios and records skip instead of failing missing external channels", async () => {
    const executeScenario = vi.fn(async (current: ChannelSmokeScenario) => passingTrace(current))
    const scenarios = [scenario("webui.basic_query"), scenario("slack.basic_query")]

    const results = await runChannelSmokeScenarios({
      config: configWithChannels(),
      scenarios,
      executeScenario,
    })

    expect(results).toHaveLength(2)
    expect(results[0]).toMatchObject({ status: "passed", auditLogId: "audit-webui.basic_query" })
    expect(results[1]).toMatchObject({ status: "skipped", reason: "slack_disabled" })
    expect(executeScenario).toHaveBeenCalledTimes(1)
  })

  it("persists sanitized dry-run smoke results for later UI and CLI inspection", async () => {
    const previousStateDir = process.env["NOBIE_STATE_DIR"]
    const previousConfig = process.env["NOBIE_CONFIG"]
    const stateDir = mkdtempSync(join(tmpdir(), "nobie-channel-smoke-runner-"))
    closeDb()
    process.env["NOBIE_STATE_DIR"] = stateDir
    delete process.env["NOBIE_CONFIG"]
    reloadConfig()

    try {
      const result = await runPersistedChannelSmokeScenarios({
        config: {
          ...structuredClone(DEFAULT_CONFIG),
          telegram: {
            enabled: true,
            botToken: "123456789:telegram-token",
            allowedUserIds: [42120565],
            allowedGroupIds: [],
          },
        },
        mode: "dry-run",
        scenarios: [scenario("telegram.artifact_delivery")],
        initiatedBy: "test-suite",
        metadata: { chatId: "42120565", botToken: "123456789:telegram-token" },
        executeScenario: createDryRunChannelSmokeExecutor({
          traceOverrides: {
            "telegram.artifact_delivery": {
              finalText: "sent to chat 42120565 with Bearer abcdefghijklmnop",
            },
          },
        }),
      })

      expect(result.status).toBe("passed")
      expect(JSON.stringify(result.results)).not.toContain("42120565")
      expect(JSON.stringify(result.results)).not.toContain("abcdefghijklmnop")
      const runs = listChannelSmokeRuns(5)
      expect(runs[0]).toMatchObject({ id: result.runId, status: "passed", initiated_by: "test-suite" })
      expect(runs[0]?.metadata_json).not.toContain("42120565")
      expect(runs[0]?.metadata_json).not.toContain("telegram-token")

      const steps = listChannelSmokeSteps(result.runId)
      expect(steps).toHaveLength(1)
      expect(steps[0]?.trace_json).not.toContain("42120565")
      expect(steps[0]?.trace_json).not.toContain("abcdefghijklmnop")
      expect(steps[0]?.trace_json).toContain("***")
    } finally {
      closeDb()
      if (previousStateDir === undefined) delete process.env["NOBIE_STATE_DIR"]
      else process.env["NOBIE_STATE_DIR"] = previousStateDir
      if (previousConfig === undefined) delete process.env["NOBIE_CONFIG"]
      else process.env["NOBIE_CONFIG"] = previousConfig
      reloadConfig()
      rmSync(stateDir, { recursive: true, force: true })
    }
  })
})
