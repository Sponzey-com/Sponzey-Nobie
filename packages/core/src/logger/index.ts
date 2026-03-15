type LogLevel = "debug" | "info" | "warn" | "error"

const LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 }

const COLORS: Record<LogLevel, string> = {
  debug: "\x1b[90m",  // gray
  info: "\x1b[36m",   // cyan
  warn: "\x1b[33m",   // yellow
  error: "\x1b[31m",  // red
}
const RESET = "\x1b[0m"
const DIM = "\x1b[2m"

function getMinLevel(): LogLevel {
  const env = process.env["SIDEKICK_LOG_LEVEL"]
  if (env && env in LEVELS) return env as LogLevel
  return "info"
}

function shouldColor(): boolean {
  return process.env["SIDEKICK_NO_COLOR"] == null && process.stdout.isTTY === true
}

function format(level: LogLevel, namespace: string, message: string, ...args: unknown[]): string {
  const ts = new Date().toISOString().slice(11, 23)
  const color = shouldColor()
  const extra = args.length > 0 ? " " + args.map(a => JSON.stringify(a)).join(" ") : ""

  if (color) {
    return `${DIM}${ts}${RESET} ${COLORS[level]}${level.padEnd(5)}${RESET} ${DIM}[${namespace}]${RESET} ${message}${extra}`
  }
  return `${ts} ${level.padEnd(5)} [${namespace}] ${message}${extra}`
}

export interface Logger {
  debug(message: string, ...args: unknown[]): void
  info(message: string, ...args: unknown[]): void
  warn(message: string, ...args: unknown[]): void
  error(message: string, ...args: unknown[]): void
  child(namespace: string): Logger
}

export function createLogger(namespace: string): Logger {
  const minLevel = LEVELS[getMinLevel()]

  function log(level: LogLevel, message: string, ...args: unknown[]) {
    if (LEVELS[level] < minLevel) return
    const line = format(level, namespace, message, ...args)
    if (level === "error") {
      process.stderr.write(line + "\n")
    } else {
      process.stdout.write(line + "\n")
    }
  }

  return {
    debug: (msg, ...args) => log("debug", msg, ...args),
    info: (msg, ...args) => log("info", msg, ...args),
    warn: (msg, ...args) => log("warn", msg, ...args),
    error: (msg, ...args) => log("error", msg, ...args),
    child: (sub) => createLogger(`${namespace}:${sub}`),
  }
}

export const logger = createLogger("sidekick")
