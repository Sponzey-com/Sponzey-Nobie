import type { SlackChannel } from "./bot.js"

let activeSlackChannel: SlackChannel | null = null
let lastSlackRuntimeError: string | null = null
let lastSlackRuntimeStartedAt: number | null = null
let lastSlackRuntimeStoppedAt: number | null = null
let lastSlackRuntimeErrorAt: number | null = null

export interface SlackRuntimeStatus {
  isRunning: boolean
  lastStartedAt: number | null
  lastStoppedAt: number | null
  lastError: string | null
  lastErrorAt: number | null
}

export function setActiveSlackChannel(channel: SlackChannel | null): void {
  activeSlackChannel = channel
  if (channel) {
    lastSlackRuntimeStartedAt = Date.now()
    lastSlackRuntimeError = null
    lastSlackRuntimeErrorAt = null
  } else {
    lastSlackRuntimeStoppedAt = Date.now()
  }
}

export function getActiveSlackChannel(): SlackChannel | null {
  return activeSlackChannel
}

export function setSlackRuntimeError(message: string | null): void {
  lastSlackRuntimeError = message
  lastSlackRuntimeErrorAt = message ? Date.now() : null
}

export function getSlackRuntimeError(): string | null {
  return lastSlackRuntimeError
}

export function getSlackRuntimeStatus(): SlackRuntimeStatus {
  return {
    isRunning: activeSlackChannel !== null,
    lastStartedAt: lastSlackRuntimeStartedAt,
    lastStoppedAt: lastSlackRuntimeStoppedAt,
    lastError: lastSlackRuntimeError,
    lastErrorAt: lastSlackRuntimeErrorAt,
  }
}

export function stopActiveSlackChannel(): void {
  const channel = activeSlackChannel
  if (!channel) return
  channel.stop()
  activeSlackChannel = null
  lastSlackRuntimeStoppedAt = Date.now()
}
