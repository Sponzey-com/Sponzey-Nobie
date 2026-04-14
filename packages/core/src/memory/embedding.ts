/**
 * Embedding providers for vector memory search.
 * Gracefully degrades to no-op if provider unavailable.
 */

export interface EmbeddingProvider {
  readonly providerId: "none" | "ollama" | "voyage" | "openai"
  readonly modelId: string
  embed(text: string): Promise<number[]>
  batchEmbed(texts: string[]): Promise<number[][]>
  dimensions: number
}

// ── Null (no-op) provider ────────────────────────────────────────────────────

export class NullEmbeddingProvider implements EmbeddingProvider {
  readonly providerId = "none" as const
  readonly modelId = "none"
  readonly dimensions = 0
  async embed(): Promise<number[]> { return [] }
  async batchEmbed(texts: string[]): Promise<number[][]> { return texts.map(() => []) }
}

// ── Ollama provider ──────────────────────────────────────────────────────────

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly providerId = "ollama" as const
  readonly dimensions: number
  private baseUrl: string
  private model: string
  get modelId(): string { return this.model }

  constructor(opts: { baseUrl?: string; model?: string; dimensions?: number } = {}) {
    this.baseUrl = opts.baseUrl ?? "http://localhost:11434"
    this.model = opts.model ?? "nomic-embed-text"
    this.dimensions = opts.dimensions ?? 768
  }

  async embed(text: string): Promise<number[]> {
    const res = await fetch(`${this.baseUrl}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: this.model, prompt: text }),
    })
    if (!res.ok) throw new Error(`Ollama embed error: ${res.status}`)
    const data = await res.json() as { embedding: number[] }
    return data.embedding
  }

  async batchEmbed(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map((t) => this.embed(t)))
  }
}

// ── Voyage AI provider ───────────────────────────────────────────────────────

export class VoyageEmbeddingProvider implements EmbeddingProvider {
  readonly providerId = "voyage" as const
  readonly dimensions: number
  private apiKey: string
  private model: string
  get modelId(): string { return this.model }

  constructor(opts: { apiKey: string; model?: string; dimensions?: number }) {
    this.apiKey = opts.apiKey
    this.model = opts.model ?? "voyage-3"
    this.dimensions = opts.dimensions ?? 1024
  }

  async embed(text: string): Promise<number[]> {
    const [result] = await this.batchEmbed([text])
    if (!result) throw new Error("No embedding returned")
    return result
  }

  async batchEmbed(texts: string[]): Promise<number[][]> {
    const res = await fetch("https://api.voyageai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ input: texts, model: this.model }),
    })
    if (!res.ok) throw new Error(`Voyage embed error: ${res.status}`)
    const data = await res.json() as { data: Array<{ embedding: number[] }> }
    return data.data.map((d) => d.embedding)
  }
}

// ── OpenAI-compatible provider ───────────────────────────────────────────────

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly providerId = "openai" as const
  readonly dimensions: number
  private apiKey: string
  private model: string
  private baseUrl: string
  get modelId(): string { return this.model }

  constructor(opts: { apiKey: string; model?: string; baseUrl?: string; dimensions?: number }) {
    this.apiKey = opts.apiKey
    this.model = opts.model ?? "text-embedding-3-small"
    this.baseUrl = opts.baseUrl ?? "https://api.openai.com/v1"
    this.dimensions = opts.dimensions ?? 1536
  }

  async embed(text: string): Promise<number[]> {
    const [result] = await this.batchEmbed([text])
    if (!result) throw new Error("No embedding returned")
    return result
  }

  async batchEmbed(texts: string[]): Promise<number[][]> {
    const res = await fetch(`${this.baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ input: texts, model: this.model }),
    })
    if (!res.ok) throw new Error(`OpenAI embed error: ${res.status}`)
    const data = await res.json() as { data: Array<{ embedding: number[] }> }
    return data.data.map((d) => d.embedding)
  }
}

// ── Factory ──────────────────────────────────────────────────────────────────

import { getConfig } from "../config/index.js"

let _provider: EmbeddingProvider | null = null

export function getEmbeddingProvider(): EmbeddingProvider {
  if (_provider) return _provider

  const cfg = getConfig()
  const emb = cfg.memory?.embedding

  if (!emb) {
    _provider = new NullEmbeddingProvider()
    return _provider
  }

  if (emb.provider === "ollama") {
    _provider = new OllamaEmbeddingProvider({
      ...(emb.baseUrl !== undefined && { baseUrl: emb.baseUrl }),
      model: emb.model,
    })
  } else if (emb.provider === "voyage" && emb.apiKey) {
    _provider = new VoyageEmbeddingProvider({ apiKey: emb.apiKey, model: emb.model })
  } else if (emb.provider === "openai" && emb.apiKey) {
    _provider = new OpenAIEmbeddingProvider({
      apiKey: emb.apiKey,
      model: emb.model,
      ...(emb.baseUrl !== undefined && { baseUrl: emb.baseUrl }),
    })
  } else {
    _provider = new NullEmbeddingProvider()
  }

  return _provider
}

/** Reset provider singleton (e.g., after config reload) */
export function resetEmbeddingProvider(): void {
  _provider = null
}

export function getEmbeddingCacheKey(provider: EmbeddingProvider, textChecksum: string): string {
  return `${provider.providerId}:${provider.modelId}:${provider.dimensions}:${textChecksum}`
}

export function getVectorBackendStatus(): { available: boolean; backend: "in_process_blob" | "none"; reason?: string } {
  const provider = getEmbeddingProvider()
  if (provider.dimensions <= 0) {
    return { available: false, backend: "none", reason: "embedding provider is not configured" }
  }
  return { available: true, backend: "in_process_blob" }
}

/** Encode float32 array to Buffer for SQLite BLOB storage */
export function encodeEmbedding(vec: number[]): Buffer {
  const buf = Buffer.allocUnsafe(vec.length * 4)
  for (let i = 0; i < vec.length; i++) buf.writeFloatLE(vec[i]!, i * 4)
  return buf
}

/** Decode Buffer from SQLite to float32 array */
export function decodeEmbedding(buf: Buffer): number[] {
  const result: number[] = []
  for (let i = 0; i < buf.byteLength; i += 4) result.push(buf.readFloatLE(i))
  return result
}

/** Cosine similarity between two vectors */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) {
    const ai = a[i] ?? 0
    const bi = b[i] ?? 0
    dot += ai * bi
    na += ai * ai
    nb += bi * bi
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb)
  return denom === 0 ? 0 : dot / denom
}
