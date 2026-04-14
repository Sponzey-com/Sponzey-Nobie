import type { MemorySearchFilters, MemoryScope } from "../db/index.js";
export type MemoryRetrievalEvaluationMode = "fts" | "vector" | "hybrid";
export interface MemoryRetrievalEvaluationDocument {
    id: string;
    text: string;
    scope: MemoryScope;
    ownerId?: string;
    scheduleId?: string;
    sourceType?: string;
    title?: string;
    metadata?: Record<string, unknown>;
}
export interface MemoryRetrievalEvaluationQuery {
    id: string;
    query: string;
    filters?: MemorySearchFilters;
    expectedHitDocumentIds: string[];
    unexpectedHitDocumentIds?: string[];
}
export interface MemoryRetrievalEvaluationFixture {
    documents: MemoryRetrievalEvaluationDocument[];
    queries: MemoryRetrievalEvaluationQuery[];
}
export interface MemoryRetrievalEvaluationQueryResult {
    queryId: string;
    mode: MemoryRetrievalEvaluationMode;
    latencyMs: number;
    resultCount: number;
    hitDocumentIds: string[];
    expectedHitDocumentIds: string[];
    missedDocumentIds: string[];
    unexpectedDocumentIds: string[];
    passed: boolean;
}
export interface MemoryRetrievalEvaluationReport {
    queryResults: MemoryRetrievalEvaluationQueryResult[];
    summary: {
        total: number;
        passed: number;
        failed: number;
        modes: MemoryRetrievalEvaluationMode[];
    };
}
export declare function seedMemoryRetrievalEvaluationFixture(fixture: MemoryRetrievalEvaluationFixture): Promise<void>;
export declare function evaluateMemoryRetrievalQuery(params: {
    query: MemoryRetrievalEvaluationQuery;
    mode: MemoryRetrievalEvaluationMode;
    limit?: number;
}): Promise<MemoryRetrievalEvaluationQueryResult>;
export declare function runMemoryRetrievalEvaluation(params: {
    fixture: MemoryRetrievalEvaluationFixture;
    modes?: MemoryRetrievalEvaluationMode[];
    limit?: number;
    seed?: boolean;
}): Promise<MemoryRetrievalEvaluationReport>;
//# sourceMappingURL=evaluation.d.ts.map