import { getConfig } from "../../config/index.js";
const LOCALHOST_IPS = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
function isLocalhost(req) {
    const ip = req.socket.remoteAddress ?? "";
    return LOCALHOST_IPS.has(ip);
}
const rateLimitMap = new Map();
const MAX_FAILURES = 5;
const LOCKOUT_MS = 5 * 60 * 1000;
function checkRateLimit(ip) {
    const now = Date.now();
    const entry = rateLimitMap.get(ip);
    if (!entry)
        return { allowed: true };
    if (entry.lockedUntil > now) {
        return { allowed: false, retryAfter: Math.ceil((entry.lockedUntil - now) / 1000) };
    }
    if (entry.failures >= MAX_FAILURES) {
        // Lock expired — reset
        rateLimitMap.delete(ip);
    }
    return { allowed: true };
}
function recordFailure(ip) {
    const now = Date.now();
    const entry = rateLimitMap.get(ip) ?? { failures: 0, lockedUntil: 0 };
    entry.failures += 1;
    if (entry.failures >= MAX_FAILURES)
        entry.lockedUntil = now + LOCKOUT_MS;
    rateLimitMap.set(ip, entry);
}
function recordSuccess(ip) {
    rateLimitMap.delete(ip);
}
function extractToken(req) {
    // 1) Authorization: Bearer <token>
    const header = req.headers.authorization ?? "";
    if (header.startsWith("Bearer "))
        return header.slice(7);
    // 2) WS handshake: ?token=<token>
    const url = req.url ?? "";
    const match = /[?&]token=([^&]+)/.exec(url);
    if (match)
        return decodeURIComponent(match[1] ?? "");
    return "";
}
export async function authMiddleware(req, reply) {
    const cfg = getConfig();
    if (!cfg.webui.auth.enabled)
        return;
    // localhost always bypasses auth
    if (isLocalhost(req))
        return;
    const token = cfg.webui.auth.token;
    if (!token)
        return;
    const ip = req.socket.remoteAddress ?? "unknown";
    const { allowed, retryAfter } = checkRateLimit(ip);
    if (!allowed) {
        await reply.status(429).send({
            error: "Too many failed attempts",
            retryAfter,
        });
        return;
    }
    const provided = extractToken(req);
    if (provided !== token) {
        recordFailure(ip);
        await reply.status(401).send({ error: "Unauthorized" });
        return;
    }
    recordSuccess(ip);
}
//# sourceMappingURL=auth.js.map