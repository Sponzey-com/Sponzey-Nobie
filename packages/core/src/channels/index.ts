import { getConfig } from "../config/index.js"
import { createLogger } from "../logger/index.js"
import { TelegramChannel } from "./telegram/bot.js"

export { TelegramChannel } from "./telegram/bot.js"

const log = createLogger("channels")

export async function startChannels(): Promise<void> {
  const config = getConfig()

  if (config.telegram?.enabled) {
    try {
      const channel = new TelegramChannel(config.telegram)
      await channel.start()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.warn(`Failed to start Telegram channel: ${message}`)
    }
  }
}
