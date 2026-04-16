import { getConfig } from "../config/index.js"
import { createLogger } from "../logger/index.js"
import { SlackChannel } from "./slack/bot.js"
import { getActiveSlackChannel, setActiveSlackChannel, setSlackRuntimeError, stopActiveSlackChannel } from "./slack/runtime.js"
import { TelegramChannel } from "./telegram/bot.js"
import { getActiveTelegramChannel, setActiveTelegramChannel, setTelegramRuntimeError, stopActiveTelegramChannel } from "./telegram/runtime.js"

export { TelegramChannel } from "./telegram/bot.js"
export { SlackChannel } from "./slack/bot.js"
export {
  getDefaultChannelSmokeScenarios,
  createDryRunChannelSmokeExecutor,
  resolveChannelSmokeReadiness,
  runPersistedChannelSmokeScenarios,
  runChannelSmokeScenarios,
  sanitizeChannelSmokeTrace,
  sanitizeChannelSmokeValue,
  validateChannelSmokeTrace,
  type ChannelSmokeArtifactMode,
  type ChannelSmokeArtifactTrace,
  type ChannelSmokeChannel,
  type ChannelSmokeCorrelationKey,
  type ChannelSmokeReadiness,
  type ChannelSmokeRunMode,
  type ChannelSmokeRunResult,
  type ChannelSmokeRunnerOptions,
  type ChannelSmokeScenario,
  type ChannelSmokeScenarioKind,
  type ChannelSmokeStatus,
  type ChannelSmokeToolTrace,
  type ChannelSmokeTrace,
  type ChannelSmokeValidation,
  type PersistedChannelSmokeRunnerOptions,
  type PersistedChannelSmokeRunResult,
} from "./smoke-runner.js"

const log = createLogger("channels")

export async function startChannels(): Promise<void> {
  const config = getConfig()

  stopActiveSlackChannel()
  stopActiveTelegramChannel()
  setSlackRuntimeError(null)
  setTelegramRuntimeError(null)

  if (config.slack?.enabled) {
    const channel = new SlackChannel(config.slack)
    try {
      await channel.start()
      setActiveSlackChannel(channel)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      if (getActiveSlackChannel() === channel) setActiveSlackChannel(null)
      setSlackRuntimeError(message)
      log.warn(`Failed to start Slack channel: ${message}`)
    }
  }

  if (config.telegram?.enabled) {
    const channel = new TelegramChannel(config.telegram)
    try {
      await channel.start()
      setActiveTelegramChannel(channel)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      if (getActiveTelegramChannel() === channel) setActiveTelegramChannel(null)
      setTelegramRuntimeError(message)
      log.warn(`Failed to start Telegram channel: ${message}`)
    }
  }
}
