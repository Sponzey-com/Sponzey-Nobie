import type { FastifyRequest, FastifyReply } from "fastify"
import { getConfig } from "../../config/index.js"

const LOCALHOST_IPS = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"])

function isLocalhost(req: FastifyRequest): boolean {
  const ip = req.socket.remoteAddress ?? ""
  return LOCALHOST_IPS.has(ip)
}

interface RateEntry { failures: number; lockedUntil: number }
const rateLimitMap = new Map<string, RateEntry>()
const MAX_FAILURES = 5
const LOCKOUT_MS = 5 * 60 * 1000

function checkRateLimit(ip: string): { allowed: boolean; retryAfter?: number } {
  const now = Date.now()
  const entry = rateLimitMap.get(ip)
  if (!entry) return { allowed: true }
  if (entry.lockedUntil > now) {
    return { allowed: false, retryAfter: Math.ceil((entry.lockedUntil - now) / 1000) }
  }
  if (entry.failures >= MAX_FAILURES) {
    rateLimitMap.delete(ip)
  }
  return { allowed: true }
}

function recordFailure(ip: string): void {
  const now = Date.now()
  const entry = rateLimitMap.get(ip) ?? { failures: 0, lockedUntil: 0 }
  entry.failures += 1
  if (entry.failures >= MAX_FAILURES) entry.lockedUntil = now + LOCKOUT_MS
  rateLimitMap.set(ip, entry)
}

function recordSuccess(ip: string): void {
  rateLimitMap.delete(ip)
}

function extractToken(req: FastifyRequest): string {
  const header = req.headers.authorization ?? ""
  if (header.startsWith("Bearer ")) return header.slice(7)
  const url = req.url ?? ""
  const match = /[?&]token=([^&]+)/.exec(url)
  if (match) return decodeURIComponent(match[1] ?? "")
  return ""
}

export async function authMiddleware(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const cfg = getConfig()
  const staticAuthEnabled = cfg.webui.auth.enabled
  const staticToken = cfg.webui.auth.token?.trim() ?? ""

  if (!staticAuthEnabled) return
  if (isLocalhost(req)) return

  const ip = req.socket.remoteAddress ?? "unknown"
  const { allowed, retryAfter } = checkRateLimit(ip)
  if (!allowed) {
    await reply.status(429).send({
      error: "Too many failed attempts",
      retryAfter,
    })
    return
  }

  const provided = extractToken(req)
  const matchesStaticToken = Boolean(staticAuthEnabled && staticToken && provided === staticToken)

  if (!matchesStaticToken) {
    recordFailure(ip)
    await reply.status(401).send({ error: "Unauthorized" })
    return
  }

  recordSuccess(ip)
}
