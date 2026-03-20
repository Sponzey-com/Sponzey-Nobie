import type { TelegramChannel } from "./bot.js"

let activeTelegramChannel: TelegramChannel | null = null
let lastTelegramRuntimeError: string | null = null

export function setActiveTelegramChannel(channel: TelegramChannel | null): void {
  activeTelegramChannel = channel
  if (channel) {
    lastTelegramRuntimeError = null
  }
}

export function getActiveTelegramChannel(): TelegramChannel | null {
  return activeTelegramChannel
}

export function setTelegramRuntimeError(message: string | null): void {
  lastTelegramRuntimeError = message
}

export function getTelegramRuntimeError(): string | null {
  return lastTelegramRuntimeError
}

export function stopActiveTelegramChannel(): void {
  if (!activeTelegramChannel) return
  activeTelegramChannel.stop()
  activeTelegramChannel = null
}
