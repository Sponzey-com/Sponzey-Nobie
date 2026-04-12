import { createHash } from "node:crypto";
import { insertMemoryEmbeddingIfMissing, insertMemoryItem, markMemoryIndexJobCompleted, markMemoryIndexJobFailed, recordMemoryAccessLog, searchMemoryItems, getRecentMemoryItems, getDb, storeMemoryDocument as storeMemoryDocumentRecord, } from "../db/index.js";
import { getEmbeddingProvider, encodeEmbedding } from "./embedding.js";
import { getConfig } from "../config/index.js";
import { searchMemoryChunks, searchMemoryItems2 } from "./search.js";
import { buildMemoryJournalContext } from "./journal.js";
import { appendRunEvent } from "../runs/store.js";
const MAX_MEMORY_CHUNK_LENGTH = 1600;
const MEMORY_CHUNK_OVERLAP = 160;
const DEFAULT_MEMORY_CONTEXT_MAX_CHUNKS = 4;
const DEFAULT_MEMORY_CONTEXT_MAX_CHARS = 2200;
const DEFAULT_MEMORY_CONTEXT_MAX_CHUNK_CHARS = 420;
const MEMORY_CONTEXT_OVERFLOW_NOTE = "...";
function checksumText(value) {
    return createHash("sha256").update(value).digest("hex");
}
function estimateTokens(value) {
    return Math.max(1, Math.ceil(value.length / 4));
}
function chunkMemoryText(value) {
    const normalized = value.trim();
    if (!normalized)
        return [];
    if (normalized.length <= MAX_MEMORY_CHUNK_LENGTH)
        return [normalized];
    const chunks = [];
    let start = 0;
    while (start < normalized.length) {
        const hardEnd = Math.min(start + MAX_MEMORY_CHUNK_LENGTH, normalized.length);
        const softBreak = normalized.lastIndexOf("\n", hardEnd);
        const end = softBreak > start + Math.floor(MAX_MEMORY_CHUNK_LENGTH * 0.6) ? softBreak : hardEnd;
        const chunk = normalized.slice(start, end).trim();
        if (chunk)
            chunks.push(chunk);
        if (end >= normalized.length)
            break;
        start = Math.max(0, end - MEMORY_CHUNK_OVERLAP);
    }
    return chunks;
}
function resolveDocumentOwnerId(params) {
    if (params.scope === "global")
        return "global";
    if (params.scope === "session")
        return params.sessionId;
    if (params.scope === "task")
        return params.requestGroupId ?? params.runId;
    if (params.scope === "artifact")
        return params.requestGroupId ?? params.runId ?? params.sessionId;
    if (params.scope === "diagnostic")
        return params.requestGroupId ?? params.runId ?? params.sessionId;
    return undefined;
}
export async function storeMemoryDocument(params) {
    const rawText = params.rawText.trim();
    if (!rawText)
        throw new Error("memory document text is empty");
    const chunks = chunkMemoryText(rawText);
    const result = storeMemoryDocumentRecord({
        scope: params.scope,
        ...(params.ownerId ? { ownerId: params.ownerId } : {}),
        sourceType: params.sourceType,
        ...(params.sourceRef ? { sourceRef: params.sourceRef } : {}),
        ...(params.title ? { title: params.title } : {}),
        rawText,
        checksum: checksumText(rawText),
        ...(params.metadata ? { metadata: params.metadata } : {}),
        chunks: chunks.map((content, ordinal) => ({
            ordinal,
            tokenEstimate: estimateTokens(content),
            content,
            checksum: checksumText(content),
            metadata: { ordinal },
        })),
    });
    if (!result.deduplicated) {
        await ensureChunkEmbeddings(result.documentId, result.chunkIds);
    }
    return result;
}
async function ensureChunkEmbeddings(documentId, chunkIds) {
    const provider = getEmbeddingProvider();
    if (provider.dimensions <= 0 || chunkIds.length === 0) {
        markMemoryIndexJobCompleted(documentId);
        return;
    }
    try {
        const rows = getDb()
            .prepare(`SELECT id, content, checksum FROM memory_chunks WHERE id IN (${chunkIds.map(() => "?").join(", ")}) ORDER BY ordinal ASC`)
            .all(...chunkIds);
        const vectors = await provider.batchEmbed(rows.map((row) => row.content));
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const vector = vectors[i];
            if (!row || !vector || vector.length === 0)
                continue;
            insertMemoryEmbeddingIfMissing({
                chunkId: row.id,
                provider: provider.providerId,
                model: provider.modelId,
                dimensions: provider.dimensions,
                textChecksum: row.checksum,
                vector: encodeEmbedding(vector),
            });
        }
        markMemoryIndexJobCompleted(documentId);
    }
    catch (err) {
        markMemoryIndexJobFailed(documentId, err instanceof Error ? err.message : String(err));
    }
}
/** Store a memory item, auto-embedding if provider available */
export async function storeMemory(params) {
    const id = insertMemoryItem(params);
    const ownerId = resolveDocumentOwnerId({
        scope: params.scope ?? "global",
        ...(params.sessionId ? { sessionId: params.sessionId } : {}),
        ...(params.runId ? { runId: params.runId } : {}),
        ...(params.requestGroupId ? { requestGroupId: params.requestGroupId } : {}),
    });
    await storeMemoryDocument({
        rawText: params.content,
        scope: params.scope ?? "global",
        ...(ownerId ? { ownerId } : {}),
        sourceType: params.type ?? "user_fact",
        sourceRef: id,
        title: params.type ?? "memory_item",
        metadata: {
            tags: params.tags ?? [],
            importance: params.importance ?? "medium",
            legacyMemoryItemId: id,
        },
    });
    // Async embed and update
    const provider = getEmbeddingProvider();
    if (provider.dimensions > 0) {
        try {
            const vec = await provider.embed(params.content);
            const embBuf = encodeEmbedding(vec);
            getDb()
                .prepare("UPDATE memory_items SET embedding = ? WHERE id = ?")
                .run(embBuf, id);
        }
        catch {
            // embedding failed — memory still stored, just without vector
        }
    }
    return id;
}
/** Synchronous version for compressor (no embedding) */
export function storeMemorySync(params) {
    const id = insertMemoryItem(params);
    const ownerId = resolveDocumentOwnerId({
        scope: params.scope ?? "global",
        ...(params.sessionId ? { sessionId: params.sessionId } : {}),
        ...(params.runId ? { runId: params.runId } : {}),
        ...(params.requestGroupId ? { requestGroupId: params.requestGroupId } : {}),
    });
    void storeMemoryDocument({
        rawText: params.content,
        scope: params.scope ?? "global",
        ...(ownerId ? { ownerId } : {}),
        sourceType: params.type ?? "session_summary",
        sourceRef: id,
        title: params.type ?? "memory_item",
        metadata: {
            tags: params.tags ?? [],
            importance: params.importance ?? "medium",
            legacyMemoryItemId: id,
            syncWrite: true,
        },
    }).catch(() => undefined);
    return id;
}
export async function searchMemoryDetailed(query, limit = 5, filters) {
    const mode = getConfig().memory?.searchMode ?? "fts";
    const results = await searchMemoryChunks(query, limit, mode, filters);
    for (const result of results) {
        recordMemoryAccessLog({
            ...(filters?.runId ? { runId: filters.runId } : {}),
            ...(filters?.sessionId ? { sessionId: filters.sessionId } : {}),
            ...(filters?.requestGroupId ? { requestGroupId: filters.requestGroupId } : {}),
            documentId: result.chunk.document_id,
            chunkId: result.chunkId,
            query,
            resultSource: result.source,
            score: result.score,
            latencyMs: result.latencyMs,
        });
    }
    appendMemorySearchLatencyEvents(filters?.runId, results);
    return results;
}
function appendMemorySearchLatencyEvents(runId, results) {
    if (!runId || results.length === 0)
        return;
    const maxLatencyBySource = new Map();
    for (const result of results) {
        maxLatencyBySource.set(result.source, Math.max(maxLatencyBySource.get(result.source) ?? 0, result.latencyMs));
    }
    for (const [source, latencyMs] of maxLatencyBySource) {
        try {
            appendRunEvent(runId, `memory_${source}_ms=${Math.max(0, Math.floor(latencyMs))}ms`);
        }
        catch {
            // Memory search tracing must never affect retrieval.
        }
    }
}
export async function searchMemory(query, limit = 5, filters) {
    const mode = getConfig().memory?.searchMode ?? "fts";
    try {
        const results = await searchMemoryItems2(query, limit, mode, filters);
        return results.map((r) => r.item);
    }
    catch {
        return [];
    }
}
export function searchMemorySync(query, limit = 5, filters) {
    try {
        return searchMemoryItems(query, limit, filters);
    }
    catch {
        return [];
    }
}
export function recentMemories(limit = 10, filters) {
    return getRecentMemoryItems(limit, filters);
}
function condenseForMemoryInjection(value, maxChars) {
    const normalized = value.replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
    if (normalized.length <= maxChars)
        return normalized;
    return `${normalized.slice(0, Math.max(0, maxChars - MEMORY_CONTEXT_OVERFLOW_NOTE.length)).trimEnd()}${MEMORY_CONTEXT_OVERFLOW_NOTE}`;
}
export function buildMemoryInjectionContext(results, budget = {}) {
    const maxChunks = Math.max(0, budget.maxChunks ?? DEFAULT_MEMORY_CONTEXT_MAX_CHUNKS);
    const maxChars = Math.max(0, budget.maxChars ?? DEFAULT_MEMORY_CONTEXT_MAX_CHARS);
    const maxChunkChars = Math.max(80, budget.maxChunkChars ?? DEFAULT_MEMORY_CONTEXT_MAX_CHUNK_CHARS);
    if (maxChunks === 0 || maxChars === 0)
        return "";
    const lines = [];
    let usedChars = 0;
    for (const result of results.slice(0, maxChunks)) {
        const score = Number.isFinite(result.score) ? result.score.toFixed(3) : "n/a";
        const date = new Date(result.chunk.updated_at).toLocaleDateString("ko-KR");
        const snippet = condenseForMemoryInjection(result.chunk.content, Math.min(maxChunkChars, Math.max(0, maxChars - usedChars)));
        const line = `- [${result.source}:${result.chunkId}; score=${score}; date=${date}] ${snippet}`;
        if (usedChars + line.length > maxChars)
            break;
        lines.push(line);
        usedChars += line.length + 1;
    }
    return lines.length > 0 ? `[관련 기억]\n${lines.join("\n")}` : "";
}
/** Build a formatted memory context block for system prompt injection */
export async function buildMemoryContext(params) {
    const memoryBudget = params.budget ?? {};
    const maxChunks = Math.max(0, memoryBudget.maxChunks ?? DEFAULT_MEMORY_CONTEXT_MAX_CHUNKS);
    const [results, journalContext] = await Promise.all([
        searchMemoryDetailed(params.query, Math.max(maxChunks, 1), {
            ...(params.sessionId ? { sessionId: params.sessionId } : {}),
            ...(params.requestGroupId ? { requestGroupId: params.requestGroupId } : {}),
            ...(params.runId ? { runId: params.runId } : {}),
            ...(params.includeArtifact ? { includeArtifact: params.includeArtifact } : {}),
            ...(params.includeDiagnostic ? { includeDiagnostic: params.includeDiagnostic } : {}),
        }),
        Promise.resolve(buildMemoryJournalContext(params.query, {
            limit: 6,
            ...(params.sessionId ? { sessionId: params.sessionId } : {}),
            ...(params.requestGroupId ? { requestGroupId: params.requestGroupId } : {}),
            ...(params.runId ? { runId: params.runId } : {}),
        })),
    ]);
    const relatedMemoryContext = buildMemoryInjectionContext(results, memoryBudget);
    return [relatedMemoryContext, journalContext].filter(Boolean).join("\n\n");
}
//# sourceMappingURL=store.js.map