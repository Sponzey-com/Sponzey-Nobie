import type { MemorySearchFilters, MemoryScope } from "../db/index.js"
import { storeMemoryDocument } from "./store.js"
import {
  ftsChunkSearch,
  hybridChunkSearch,
  vectorChunkSearch,
  type MemoryChunkSearchResult,
} from "./search.js"

export type MemoryRetrievalEvaluationMode = "fts" | "vector" | "hybrid"

export interface MemoryRetrievalEvaluationDocument {
  id: string
  text: string
  scope: MemoryScope
  ownerId?: string
  scheduleId?: string
  sourceType?: string
  title?: string
  metadata?: Record<string, unknown>
}

export interface MemoryRetrievalEvaluationQuery {
  id: string
  query: string
  filters?: MemorySearchFilters
  expectedHitDocumentIds: string[]
  unexpectedHitDocumentIds?: string[]
}

export interface MemoryRetrievalEvaluationFixture {
  documents: MemoryRetrievalEvaluationDocument[]
  queries: MemoryRetrievalEvaluationQuery[]
}

export interface MemoryRetrievalEvaluationQueryResult {
  queryId: string
  mode: MemoryRetrievalEvaluationMode
  latencyMs: number
  resultCount: number
  hitDocumentIds: string[]
  expectedHitDocumentIds: string[]
  missedDocumentIds: string[]
  unexpectedDocumentIds: string[]
  passed: boolean
}

export interface MemoryRetrievalEvaluationReport {
  queryResults: MemoryRetrievalEvaluationQueryResult[]
  summary: {
    total: number
    passed: number
    failed: number
    modes: MemoryRetrievalEvaluationMode[]
  }
}

export async function seedMemoryRetrievalEvaluationFixture(
  fixture: MemoryRetrievalEvaluationFixture,
): Promise<void> {
  for (const document of fixture.documents) {
    await storeMemoryDocument({
      rawText: document.text,
      scope: document.scope,
      ...(document.ownerId ? { ownerId: document.ownerId } : {}),
      ...(document.scheduleId ? { scheduleId: document.scheduleId } : {}),
      sourceType: document.sourceType ?? "retrieval_evaluation",
      sourceRef: document.id,
      title: document.title ?? document.id,
      metadata: {
        ...(document.metadata ?? {}),
        evaluationDocumentId: document.id,
      },
    })
  }
}

async function searchForEvaluation(
  mode: MemoryRetrievalEvaluationMode,
  query: MemoryRetrievalEvaluationQuery,
  limit: number,
): Promise<MemoryChunkSearchResult[]> {
  if (mode === "fts") return ftsChunkSearch(query.query, limit, query.filters)
  if (mode === "vector") return vectorChunkSearch(query.query, limit, query.filters)
  return hybridChunkSearch(query.query, limit, query.filters)
}

function extractEvaluationDocumentId(result: MemoryChunkSearchResult): string | null {
  const sourceRef = result.chunk.document_source_ref?.trim()
  if (sourceRef) return sourceRef

  try {
    const metadata = JSON.parse(result.chunk.document_metadata_json ?? "{}") as unknown
    if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
      const id = (metadata as Record<string, unknown>)["evaluationDocumentId"]
      return typeof id === "string" ? id : null
    }
  } catch {
    return null
  }
  return null
}

export async function evaluateMemoryRetrievalQuery(params: {
  query: MemoryRetrievalEvaluationQuery
  mode: MemoryRetrievalEvaluationMode
  limit?: number
}): Promise<MemoryRetrievalEvaluationQueryResult> {
  const startedAt = Date.now()
  const results = await searchForEvaluation(params.mode, params.query, params.limit ?? 8)
  const latencyMs = Date.now() - startedAt
  const hitDocumentIds = [...new Set(results.map(extractEvaluationDocumentId).filter((id): id is string => Boolean(id)))]
  const missedDocumentIds = params.query.expectedHitDocumentIds.filter((id) => !hitDocumentIds.includes(id))
  const unexpectedDocumentIds = (params.query.unexpectedHitDocumentIds ?? []).filter((id) => hitDocumentIds.includes(id))

  return {
    queryId: params.query.id,
    mode: params.mode,
    latencyMs,
    resultCount: results.length,
    hitDocumentIds,
    expectedHitDocumentIds: params.query.expectedHitDocumentIds,
    missedDocumentIds,
    unexpectedDocumentIds,
    passed: missedDocumentIds.length === 0 && unexpectedDocumentIds.length === 0,
  }
}

export async function runMemoryRetrievalEvaluation(params: {
  fixture: MemoryRetrievalEvaluationFixture
  modes?: MemoryRetrievalEvaluationMode[]
  limit?: number
  seed?: boolean
}): Promise<MemoryRetrievalEvaluationReport> {
  if (params.seed !== false) {
    await seedMemoryRetrievalEvaluationFixture(params.fixture)
  }

  const modes = params.modes ?? ["fts", "vector", "hybrid"]
  const queryResults: MemoryRetrievalEvaluationQueryResult[] = []
  for (const query of params.fixture.queries) {
    for (const mode of modes) {
      queryResults.push(await evaluateMemoryRetrievalQuery({
        query,
        mode,
        ...(params.limit !== undefined ? { limit: params.limit } : {}),
      }))
    }
  }

  const passed = queryResults.filter((result) => result.passed).length
  return {
    queryResults,
    summary: {
      total: queryResults.length,
      passed,
      failed: queryResults.length - passed,
      modes,
    },
  }
}
