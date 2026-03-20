/**
 * Hybrid search: combines FTS (keyword) + vector (semantic) results
 * using Reciprocal Rank Fusion (RRF).
 */

import { searchMemoryItems, getDb, type DbMemoryItem } from "../db/index.js"
import { getEmbeddingProvider, decodeEmbedding, cosineSimilarity } from "./embedding.js"

const RRF_K = 60  // RRF constant

function rrfScore(rank: number): number {
  return 1 / (RRF_K + rank + 1)
}

export interface MemorySearchResult {
  item: DbMemoryItem
  score: number
  source: "fts" | "vector" | "hybrid"
}

/** FTS-only search */
export function ftsSearch(query: string, limit: number): MemorySearchResult[] {
  try {
    const items = searchMemoryItems(query, limit)
    return items.map((item, rank) => ({ item, score: rrfScore(rank), source: "fts" as const }))
  } catch {
    return []
  }
}

/** Vector-only search using in-process cosine similarity */
export async function vectorSearch(query: string, limit: number): Promise<MemorySearchResult[]> {
  const provider = getEmbeddingProvider()
  if (provider.dimensions === 0) return []

  let queryVec: number[]
  try { queryVec = await provider.embed(query) } catch { return [] }

  const db = getDb()
  const rows = db
    .prepare<[], DbMemoryItem>("SELECT * FROM memory_items WHERE embedding IS NOT NULL")
    .all()

  if (!rows.length) return []

  const scored: MemorySearchResult[] = []
  for (const item of rows) {
    if (!item.embedding) continue
    const vec = decodeEmbedding(item.embedding as Buffer)
    const score = cosineSimilarity(queryVec, vec)
    scored.push({ item, score, source: "vector" as const })
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}

/** Hybrid search: RRF fusion of FTS and vector results */
export async function hybridSearch(query: string, limit: number): Promise<MemorySearchResult[]> {
  const [ftsResults, vecResults] = await Promise.all([
    Promise.resolve(ftsSearch(query, limit * 2)),
    vectorSearch(query, limit * 2),
  ])

  // Build score map
  const scoreMap = new Map<string, { item: DbMemoryItem; score: number }>()

  for (let i = 0; i < ftsResults.length; i++) {
    const entry = ftsResults[i]
    if (!entry) continue
    const { item } = entry
    const prev = scoreMap.get(item.id)
    scoreMap.set(item.id, { item, score: (prev?.score ?? 0) + rrfScore(i) })
  }

  for (let i = 0; i < vecResults.length; i++) {
    const entry = vecResults[i]
    if (!entry) continue
    const { item } = entry
    const prev = scoreMap.get(item.id)
    scoreMap.set(item.id, { item, score: (prev?.score ?? 0) + rrfScore(i) })
  }

  return Array.from(scoreMap.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ item, score }) => ({ item, score, source: "hybrid" as const }))
}

/** Main entry point respecting config.memory.searchMode */
export async function searchMemoryItems2(
  query: string,
  limit = 5,
  mode?: "fts" | "vector" | "hybrid",
): Promise<MemorySearchResult[]> {
  const resolvedMode = mode ?? "fts"

  if (resolvedMode === "vector") return vectorSearch(query, limit)
  if (resolvedMode === "hybrid") return hybridSearch(query, limit)
  return ftsSearch(query, limit)
}
