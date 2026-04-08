import type { SlackChannel } from "./bot.js"

let activeSlackChannel: SlackChannel | null = null
let lastSlackRuntimeError: string | null = null

export function setActiveSlackChannel(channel: SlackChannel | null): void {
  activeSlackChannel = channel
  if (channel) {
    lastSlackRuntimeError = null
  }
}

export function getActiveSlackChannel(): SlackChannel | null {
  return activeSlackChannel
}

export function setSlackRuntimeError(message: string | null): void {
  lastSlackRuntimeError = message
}

export function getSlackRuntimeError(): string | null {
  return lastSlackRuntimeError
}

export function stopActiveSlackChannel(): void {
  if (!activeSlackChannel) return
  activeSlackChannel.stop()
  activeSlackChannel = null
}
