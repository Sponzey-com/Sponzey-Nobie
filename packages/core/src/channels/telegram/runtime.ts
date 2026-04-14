import type { TelegramChannel } from "./bot.js"

let activeTelegramChannel: TelegramChannel | null = null
let lastTelegramRuntimeError: string | null = null
let lastTelegramRuntimeStartedAt: number | null = null
let lastTelegramRuntimeStoppedAt: number | null = null
let lastTelegramRuntimeErrorAt: number | null = null

export interface TelegramRuntimeStatus {
  isRunning: boolean
  lastStartedAt: number | null
  lastStoppedAt: number | null
  lastError: string | null
  lastErrorAt: number | null
}

export function setActiveTelegramChannel(channel: TelegramChannel | null): void {
  activeTelegramChannel = channel
  if (channel) {
    lastTelegramRuntimeStartedAt = Date.now()
    lastTelegramRuntimeError = null
    lastTelegramRuntimeErrorAt = null
  } else {
    lastTelegramRuntimeStoppedAt = Date.now()
  }
}

export function getActiveTelegramChannel(): TelegramChannel | null {
  return activeTelegramChannel
}

export function setTelegramRuntimeError(message: string | null): void {
  lastTelegramRuntimeError = message
  lastTelegramRuntimeErrorAt = message ? Date.now() : null
}

export function getTelegramRuntimeError(): string | null {
  return lastTelegramRuntimeError
}

export function getTelegramRuntimeStatus(): TelegramRuntimeStatus {
  return {
    isRunning: activeTelegramChannel !== null,
    lastStartedAt: lastTelegramRuntimeStartedAt,
    lastStoppedAt: lastTelegramRuntimeStoppedAt,
    lastError: lastTelegramRuntimeError,
    lastErrorAt: lastTelegramRuntimeErrorAt,
  }
}

export function stopActiveTelegramChannel(): void {
  const channel = activeTelegramChannel
  if (!channel) return
  channel.stop()
  activeTelegramChannel = null
  lastTelegramRuntimeStoppedAt = Date.now()
}
