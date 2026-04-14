import { getDb } from "../../db/index.js";
export function resolveSessionKey(chatId, threadId) {
    const thread = threadId !== undefined ? String(threadId) : "main";
    return `telegram:${chatId}:${thread}`;
}
export function parseTelegramSessionKey(sessionKey) {
    const match = /^telegram:(-?\d+):(main|\d+)$/.exec(sessionKey);
    if (!match)
        return null;
    const chatId = Number(match[1]);
    if (!Number.isFinite(chatId))
        return null;
    const threadPart = match[2];
    if (threadPart === "main") {
        return { chatId };
    }
    const threadId = Number(threadPart);
    if (!Number.isFinite(threadId))
        return { chatId };
    return { chatId, threadId };
}
export function getOrCreateTelegramSession(sessionKey) {
    const db = getDb();
    const existing = db
        .prepare("SELECT * FROM sessions WHERE source = ? AND source_id = ? LIMIT 1")
        .get("telegram", sessionKey);
    if (existing !== undefined) {
        return existing.id;
    }
    const sessionId = crypto.randomUUID();
    const now = Date.now();
    db.prepare(`INSERT INTO sessions (id, source, source_id, created_at, updated_at, summary)
     VALUES (?, ?, ?, ?, ?, ?)`).run(sessionId, "telegram", sessionKey, now, now, null);
    return sessionId;
}
export function newSession(sessionKey) {
    const db = getDb();
    const sessionId = crypto.randomUUID();
    const now = Date.now();
    // Delete existing session for this key so getOrCreateTelegramSession will create a fresh one
    db.prepare("DELETE FROM sessions WHERE source = ? AND source_id = ?").run("telegram", sessionKey);
    db.prepare(`INSERT INTO sessions (id, source, source_id, created_at, updated_at, summary)
     VALUES (?, ?, ?, ?, ?, ?)`).run(sessionId, "telegram", sessionKey, now, now, null);
    return sessionId;
}
//# sourceMappingURL=session.js.map