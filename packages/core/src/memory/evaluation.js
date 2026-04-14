import { storeMemoryDocument } from "./store.js";
import { ftsChunkSearch, hybridChunkSearch, vectorChunkSearch, } from "./search.js";
export async function seedMemoryRetrievalEvaluationFixture(fixture) {
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
        });
    }
}
async function searchForEvaluation(mode, query, limit) {
    if (mode === "fts")
        return ftsChunkSearch(query.query, limit, query.filters);
    if (mode === "vector")
        return vectorChunkSearch(query.query, limit, query.filters);
    return hybridChunkSearch(query.query, limit, query.filters);
}
function extractEvaluationDocumentId(result) {
    const sourceRef = result.chunk.document_source_ref?.trim();
    if (sourceRef)
        return sourceRef;
    try {
        const metadata = JSON.parse(result.chunk.document_metadata_json ?? "{}");
        if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
            const id = metadata["evaluationDocumentId"];
            return typeof id === "string" ? id : null;
        }
    }
    catch {
        return null;
    }
    return null;
}
export async function evaluateMemoryRetrievalQuery(params) {
    const startedAt = Date.now();
    const results = await searchForEvaluation(params.mode, params.query, params.limit ?? 8);
    const latencyMs = Date.now() - startedAt;
    const hitDocumentIds = [...new Set(results.map(extractEvaluationDocumentId).filter((id) => Boolean(id)))];
    const missedDocumentIds = params.query.expectedHitDocumentIds.filter((id) => !hitDocumentIds.includes(id));
    const unexpectedDocumentIds = (params.query.unexpectedHitDocumentIds ?? []).filter((id) => hitDocumentIds.includes(id));
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
    };
}
export async function runMemoryRetrievalEvaluation(params) {
    if (params.seed !== false) {
        await seedMemoryRetrievalEvaluationFixture(params.fixture);
    }
    const modes = params.modes ?? ["fts", "vector", "hybrid"];
    const queryResults = [];
    for (const query of params.fixture.queries) {
        for (const mode of modes) {
            queryResults.push(await evaluateMemoryRetrievalQuery({
                query,
                mode,
                ...(params.limit !== undefined ? { limit: params.limit } : {}),
            }));
        }
    }
    const passed = queryResults.filter((result) => result.passed).length;
    return {
        queryResults,
        summary: {
            total: queryResults.length,
            passed,
            failed: queryResults.length - passed,
            modes,
        },
    };
}
//# sourceMappingURL=evaluation.js.map