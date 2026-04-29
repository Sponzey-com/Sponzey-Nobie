import type { ChannelRuntimeSnapshot } from "../connections.js"

let isRunning = false
let lastStartedAt: number | null = null
let lastStoppedAt: number | null = null
let lastError: string | null = null
let lastErrorAt: number | null = null

export function setGoogleChatRuntimeRunning(running: boolean): void {
  isRunning = running
  const now = Date.now()
  if (running) lastStartedAt = now
  else lastStoppedAt = now
}

export function setGoogleChatRuntimeError(error: string | null): void {
  lastError = error
  lastErrorAt = error ? Date.now() : null
}

export function getGoogleChatRuntimeError(): string | null {
  return lastError
}

export function getGoogleChatRuntimeStatus(): ChannelRuntimeSnapshot {
  return {
    isRunning,
    lastStartedAt,
    lastStoppedAt,
    lastError,
    lastErrorAt,
  }
}

export function stopGoogleChatRuntime(): void {
  setGoogleChatRuntimeRunning(false)
}
