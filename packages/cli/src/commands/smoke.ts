export interface ChannelSmokeCommandOptions {
  channel?: string
  live?: boolean
  json?: boolean
}

const CHANNELS = new Set(["webui", "telegram", "slack"])

export async function channelSmokeCommand(options: ChannelSmokeCommandOptions): Promise<void> {
  const core = await import("@nobie/core")
  await core.bootstrapRuntime()

  const channel = options.channel?.trim()
  if (channel && !CHANNELS.has(channel)) {
    throw new Error(`unknown channel: ${channel}`)
  }

  const mode = options.live ? "live-run" : "dry-run"
  if (mode === "live-run") {
    if (process.env["NOBIE_CHANNEL_SMOKE_LIVE"] !== "1") {
      throw new Error("live channel smoke requires NOBIE_CHANNEL_SMOKE_LIVE=1")
    }
    throw new Error("live channel smoke executor is not configured in this build")
  }

  const allScenarios = core.getDefaultChannelSmokeScenarios()
  const scenarios = channel
    ? allScenarios.filter((scenario) => scenario.channel === channel)
    : allScenarios

  const result = await core.runPersistedChannelSmokeScenarios({
    config: core.getConfig(),
    mode,
    scenarios,
    initiatedBy: "cli",
    metadata: {
      command: "nobie smoke channels",
      channel: channel ?? null,
    },
    executeScenario: core.createDryRunChannelSmokeExecutor(),
  })

  if (options.json) {
    console.log(JSON.stringify(result, null, 2))
    return
  }

  console.log(`Channel smoke run: ${result.runId}`)
  console.log(`Mode: ${result.mode}`)
  console.log(`Status: ${result.status}`)
  console.log(`Summary: ${result.summary}`)
  console.log(`Counts: passed=${result.counts.passed}, failed=${result.counts.failed}, skipped=${result.counts.skipped}, total=${result.counts.total}`)
  for (const item of result.results) {
    const suffix = item.reason ? ` (${item.reason})` : ""
    console.log(`- ${item.scenario.id}: ${item.status}${suffix}`)
  }
}
