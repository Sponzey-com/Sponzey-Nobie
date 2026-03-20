/**
 * FileIndexer: indexes local files into SQLite for semantic search.
 * Chunks files, stores in file_chunks table, optionally embeds vectors.
 */

import { readFileSync, statSync, readdirSync, type Dirent } from "node:fs"
import { join, extname } from "node:path"
import { getDb } from "../db/index.js"
import { getEmbeddingProvider, encodeEmbedding } from "./embedding.js"
import { logger } from "../logger/index.js"

const CHUNK_SIZE = 1500      // chars per chunk
const CHUNK_OVERLAP = 200    // overlap between chunks
const MAX_FILE_SIZE = 512 * 1024  // 512 KB max file size

const SUPPORTED_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".rb", ".go", ".rs", ".java", ".cs", ".cpp", ".c", ".h",
  ".json", ".yaml", ".yml", ".toml",
  ".md", ".mdx", ".txt", ".rst",
  ".html", ".css", ".scss", ".svelte", ".vue",
  ".sh", ".bash", ".zsh",
  ".sql",
])

function chunkText(text: string): string[] {
  const chunks: string[] = []
  let start = 0
  while (start < text.length) {
    const end = Math.min(start + CHUNK_SIZE, text.length)
    chunks.push(text.slice(start, end))
    start += CHUNK_SIZE - CHUNK_OVERLAP
  }
  return chunks
}

export class FileIndexer {
  async indexFile(filePath: string): Promise<{ chunks: number; embedded: boolean }> {
    const ext = extname(filePath).toLowerCase()
    if (!SUPPORTED_EXTENSIONS.has(ext)) {
      return { chunks: 0, embedded: false }
    }

    let stat: ReturnType<typeof statSync>
    try { stat = statSync(filePath) } catch { return { chunks: 0, embedded: false } }
    if (stat.size > MAX_FILE_SIZE) return { chunks: 0, embedded: false }

    let content: string
    try { content = readFileSync(filePath, "utf8") } catch { return { chunks: 0, embedded: false } }

    const db = getDb()
    const mtime = stat.mtimeMs

    // Skip if already indexed with same mtime
    const existing = db
      .prepare<[string], { mtime: number }>("SELECT mtime FROM file_chunks WHERE file_path = ? LIMIT 1")
      .get(filePath)
    if (existing && Math.abs(existing.mtime - mtime) < 1000) {
      return { chunks: 0, embedded: false }
    }

    // Remove old chunks for this file
    db.prepare("DELETE FROM file_chunks WHERE file_path = ?").run(filePath)

    const chunks = chunkText(content)
    const provider = getEmbeddingProvider()
    const canEmbed = provider.dimensions > 0

    let embeddings: number[][] = []
    if (canEmbed) {
      try {
        embeddings = await provider.batchEmbed(chunks)
      } catch (err) {
        logger.warn(`embedding failed for ${filePath}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    const insert = db.prepare(
      `INSERT INTO file_chunks (id, file_path, chunk_index, content, embedding, mtime, indexed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    const now = Date.now()
    const insertAll = db.transaction(() => {
      for (let i = 0; i < chunks.length; i++) {
        const id = crypto.randomUUID()
        const emb = embeddings[i] ? encodeEmbedding(embeddings[i]!) : null
        insert.run(id, filePath, i, chunks[i], emb, mtime, now)
      }
    })
    insertAll()

    return { chunks: chunks.length, embedded: canEmbed && embeddings.length > 0 }
  }

  async indexDirectory(
    dir: string,
    opts: {
      exclude?: string[]
      recursive?: boolean
      onProgress?: (file: string, chunks: number) => void
    } = {},
  ): Promise<{ files: number; chunks: number }> {
    const exclude = new Set(opts.exclude ?? ["node_modules", ".git", "dist", "build", ".next", "coverage"])
    const recursive = opts.recursive ?? true

    let totalFiles = 0
    let totalChunks = 0

    const walk = async (current: string) => {
      let entries: Dirent<string>[]
      try { entries = readdirSync(current, { withFileTypes: true }) as Dirent<string>[] } catch { return }

      for (const entry of entries) {
        const entryName = String(entry.name)
        if (exclude.has(entryName)) continue
        const full = join(current, entryName)
        if (entry.isDirectory() && recursive) {
          await walk(full)
        } else if (entry.isFile()) {
          const { chunks } = await this.indexFile(full)
          if (chunks > 0) {
            totalFiles++
            totalChunks += chunks
            opts.onProgress?.(full, chunks)
          }
        }
      }
    }

    await walk(dir)
    return { files: totalFiles, chunks: totalChunks }
  }

  removeFile(filePath: string): void {
    getDb().prepare("DELETE FROM file_chunks WHERE file_path = ?").run(filePath)
  }

  removeDirectory(dir: string): void {
    getDb().prepare("DELETE FROM file_chunks WHERE file_path LIKE ?").run(`${dir}%`)
  }

  getStats(): { files: number; chunks: number; embedded: number } {
    const db = getDb()
    const row = db
      .prepare<[], { files: number; chunks: number; embedded: number }>(
        `SELECT
           COUNT(DISTINCT file_path) as files,
           COUNT(*) as chunks,
           SUM(CASE WHEN embedding IS NOT NULL THEN 1 ELSE 0 END) as embedded
         FROM file_chunks`,
      )
      .get()
    return row ?? { files: 0, chunks: 0, embedded: 0 }
  }

  searchByText(query: string, limit = 5): Array<{ file_path: string; chunk_index: number; content: string; score: number }> {
    const db = getDb()
    try {
      return db
        .prepare<[string, number], { file_path: string; chunk_index: number; content: string; score: number }>(
          `SELECT fc.file_path, fc.chunk_index, fc.content, rank as score
           FROM file_chunks_fts f
           JOIN file_chunks fc ON fc.id = f.rowid
           WHERE file_chunks_fts MATCH ?
           ORDER BY rank LIMIT ?`,
        )
        .all(query, limit)
    } catch {
      return []
    }
  }

  async searchByVector(query: string, limit = 5): Promise<Array<{ file_path: string; chunk_index: number; content: string; score: number }>> {
    const provider = getEmbeddingProvider()
    if (provider.dimensions === 0) return []

    let queryVec: number[]
    try { queryVec = await provider.embed(query) } catch { return [] }

    const db = getDb()
    const rows = db
      .prepare<[], { id: string; file_path: string; chunk_index: number; content: string; embedding: Buffer | null }>(
        "SELECT id, file_path, chunk_index, content, embedding FROM file_chunks WHERE embedding IS NOT NULL",
      )
      .all()

    const { cosineSimilarity, decodeEmbedding } = await import("./embedding.js")
    const scored = rows
      .map((r) => {
        if (!r.embedding) return null
        const vec = decodeEmbedding(r.embedding)
        const score = cosineSimilarity(queryVec, vec)
        return { file_path: r.file_path, chunk_index: r.chunk_index, content: r.content, score }
      })
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)

    return scored
  }
}

export const fileIndexer = new FileIndexer()
