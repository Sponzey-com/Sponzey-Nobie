/**
 * Embedding providers for vector memory search.
 * Gracefully degrades to no-op if provider unavailable.
 */
// ── Null (no-op) provider ────────────────────────────────────────────────────
export class NullEmbeddingProvider {
    dimensions = 0;
    async embed() { return []; }
    async batchEmbed(texts) { return texts.map(() => []); }
}
// ── Ollama provider ──────────────────────────────────────────────────────────
export class OllamaEmbeddingProvider {
    dimensions;
    baseUrl;
    model;
    constructor(opts = {}) {
        this.baseUrl = opts.baseUrl ?? "http://localhost:11434";
        this.model = opts.model ?? "nomic-embed-text";
        this.dimensions = opts.dimensions ?? 768;
    }
    async embed(text) {
        const res = await fetch(`${this.baseUrl}/api/embeddings`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model: this.model, prompt: text }),
        });
        if (!res.ok)
            throw new Error(`Ollama embed error: ${res.status}`);
        const data = await res.json();
        return data.embedding;
    }
    async batchEmbed(texts) {
        return Promise.all(texts.map((t) => this.embed(t)));
    }
}
// ── Voyage AI provider ───────────────────────────────────────────────────────
export class VoyageEmbeddingProvider {
    dimensions;
    apiKey;
    model;
    constructor(opts) {
        this.apiKey = opts.apiKey;
        this.model = opts.model ?? "voyage-3";
        this.dimensions = opts.dimensions ?? 1024;
    }
    async embed(text) {
        const [result] = await this.batchEmbed([text]);
        if (!result)
            throw new Error("No embedding returned");
        return result;
    }
    async batchEmbed(texts) {
        const res = await fetch("https://api.voyageai.com/v1/embeddings", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify({ input: texts, model: this.model }),
        });
        if (!res.ok)
            throw new Error(`Voyage embed error: ${res.status}`);
        const data = await res.json();
        return data.data.map((d) => d.embedding);
    }
}
// ── OpenAI-compatible provider ───────────────────────────────────────────────
export class OpenAIEmbeddingProvider {
    dimensions;
    apiKey;
    model;
    baseUrl;
    constructor(opts) {
        this.apiKey = opts.apiKey;
        this.model = opts.model ?? "text-embedding-3-small";
        this.baseUrl = opts.baseUrl ?? "https://api.openai.com/v1";
        this.dimensions = opts.dimensions ?? 1536;
    }
    async embed(text) {
        const [result] = await this.batchEmbed([text]);
        if (!result)
            throw new Error("No embedding returned");
        return result;
    }
    async batchEmbed(texts) {
        const res = await fetch(`${this.baseUrl}/embeddings`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify({ input: texts, model: this.model }),
        });
        if (!res.ok)
            throw new Error(`OpenAI embed error: ${res.status}`);
        const data = await res.json();
        return data.data.map((d) => d.embedding);
    }
}
// ── Factory ──────────────────────────────────────────────────────────────────
import { getConfig } from "../config/index.js";
let _provider = null;
export function getEmbeddingProvider() {
    if (_provider)
        return _provider;
    const cfg = getConfig();
    const emb = cfg.memory?.embedding;
    if (!emb) {
        _provider = new NullEmbeddingProvider();
        return _provider;
    }
    if (emb.provider === "ollama") {
        _provider = new OllamaEmbeddingProvider({
            ...(emb.baseUrl !== undefined && { baseUrl: emb.baseUrl }),
            model: emb.model,
        });
    }
    else if (emb.provider === "voyage" && emb.apiKey) {
        _provider = new VoyageEmbeddingProvider({ apiKey: emb.apiKey, model: emb.model });
    }
    else if (emb.provider === "openai" && emb.apiKey) {
        _provider = new OpenAIEmbeddingProvider({
            apiKey: emb.apiKey,
            model: emb.model,
            ...(emb.baseUrl !== undefined && { baseUrl: emb.baseUrl }),
        });
    }
    else {
        _provider = new NullEmbeddingProvider();
    }
    return _provider;
}
/** Reset provider singleton (e.g., after config reload) */
export function resetEmbeddingProvider() {
    _provider = null;
}
/** Encode float32 array to Buffer for SQLite BLOB storage */
export function encodeEmbedding(vec) {
    const buf = Buffer.allocUnsafe(vec.length * 4);
    for (let i = 0; i < vec.length; i++)
        buf.writeFloatLE(vec[i], i * 4);
    return buf;
}
/** Decode Buffer from SQLite to float32 array */
export function decodeEmbedding(buf) {
    const result = [];
    for (let i = 0; i < buf.byteLength; i += 4)
        result.push(buf.readFloatLE(i));
    return result;
}
/** Cosine similarity between two vectors */
export function cosineSimilarity(a, b) {
    if (a.length !== b.length || a.length === 0)
        return 0;
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) {
        const ai = a[i] ?? 0;
        const bi = b[i] ?? 0;
        dot += ai * bi;
        na += ai * ai;
        nb += bi * bi;
    }
    const denom = Math.sqrt(na) * Math.sqrt(nb);
    return denom === 0 ? 0 : dot / denom;
}
//# sourceMappingURL=embedding.js.map