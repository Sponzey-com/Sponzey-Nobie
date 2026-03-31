import { getConfig } from "../config/index.js"
import { createLogger } from "../logger/index.js"
import { TelegramChannel } from "./telegram/bot.js"
import { getActiveTelegramChannel, setActiveTelegramChannel, setTelegramRuntimeError, stopActiveTelegramChannel } from "./telegram/runtime.js"

export { TelegramChannel } from "./telegram/bot.js"

const log = createLogger("channels")

export async function startChannels(): Promise<void> {
  const config = getConfig()

  stopActiveTelegramChannel()
  setTelegramRuntimeError(null)

  if (config.telegram?.enabled) {
    const channel = new TelegramChannel(config.telegram)
    setActiveTelegramChannel(channel)

    void channel.start().catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err)
      if (getActiveTelegramChannel() === channel) {
        setActiveTelegramChannel(null)
      }
      setTelegramRuntimeError(message)
      log.warn(`Failed to start Telegram channel: ${message}`)
    })
  }
}
