let discordRuntimeRunning = false
let lastDiscordRuntimeError: string | null = null
let lastDiscordRuntimeStartedAt: number | null = null
let lastDiscordRuntimeStoppedAt: number | null = null
let lastDiscordRuntimeErrorAt: number | null = null

export interface DiscordRuntimeStatus {
  isRunning: boolean
  lastStartedAt: number | null
  lastStoppedAt: number | null
  lastError: string | null
  lastErrorAt: number | null
}

export function setDiscordRuntimeRunning(running: boolean): void {
  discordRuntimeRunning = running
  if (running) {
    lastDiscordRuntimeStartedAt = Date.now()
    lastDiscordRuntimeError = null
    lastDiscordRuntimeErrorAt = null
  } else {
    lastDiscordRuntimeStoppedAt = Date.now()
  }
}

export function setDiscordRuntimeError(message: string | null): void {
  lastDiscordRuntimeError = message
  lastDiscordRuntimeErrorAt = message ? Date.now() : null
}

export function getDiscordRuntimeError(): string | null {
  return lastDiscordRuntimeError
}

export function getDiscordRuntimeStatus(): DiscordRuntimeStatus {
  return {
    isRunning: discordRuntimeRunning,
    lastStartedAt: lastDiscordRuntimeStartedAt,
    lastStoppedAt: lastDiscordRuntimeStoppedAt,
    lastError: lastDiscordRuntimeError,
    lastErrorAt: lastDiscordRuntimeErrorAt,
  }
}

export function stopDiscordRuntime(): void {
  if (!discordRuntimeRunning) return
  discordRuntimeRunning = false
  lastDiscordRuntimeStoppedAt = Date.now()
}
