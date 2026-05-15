import type { EnterpriseRelationType } from "../contracts/enterprise-topology.js";
import type { ExecutorConnectionDraft, ExecutorConnectionRelation, ExecutorDraft } from "./executor-graph.js";
export interface ExecutorRelationKeywordHit {
    keyword: string;
    hint: "approval" | "lead" | "review" | "exception" | "report" | "reference" | "collaboration";
    side: "source" | "target";
}
export interface ExecutorRelationRecommendation {
    relation: ExecutorConnectionRelation;
    label: ExecutorConnectionDraft["label"];
    confidence: number;
    reasonKo: string;
    reasonEn: string;
    keywordHits: ExecutorRelationKeywordHit[];
}
export interface ExecutorRelationInferenceInput {
    source: Pick<ExecutorDraft, "id" | "name" | "description" | "inferredRuntimeMode" | "inferredCapabilities">;
    target: Pick<ExecutorDraft, "id" | "name" | "description" | "inferredRuntimeMode" | "inferredCapabilities">;
}
export interface CreateExecutorConnectionDraftInput extends ExecutorRelationInferenceInput {
    id?: string;
}
export declare const EXECUTOR_CONNECTION_LABELS: Record<ExecutorConnectionRelation, ExecutorConnectionDraft["label"]>;
export declare function executorConnectionLabel(relation: ExecutorConnectionRelation): ExecutorConnectionDraft["label"];
export declare function executorConnectionRelationToEnterpriseRelationType(relation: ExecutorConnectionRelation): EnterpriseRelationType;
export declare function executorConnectionToSafeEnterpriseRelationType(input: {
    connection: Pick<ExecutorConnectionDraft, "inferredRelation" | "advancedRelationType">;
    source?: Pick<ExecutorDraft, "inferredRuntimeMode"> | null;
    target?: Pick<ExecutorDraft, "inferredRuntimeMode"> | null;
}): EnterpriseRelationType;
export declare function enterpriseRelationTypeToExecutorConnectionRelation(relationType: EnterpriseRelationType): ExecutorConnectionRelation | null;
export declare function createExecutorConnectionDraft(input: CreateExecutorConnectionDraftInput): ExecutorConnectionDraft;
export declare function recommendExecutorConnectionRelations(input: ExecutorRelationInferenceInput): ExecutorRelationRecommendation[];
export declare function applyExecutorConnectionRecommendation(connection: ExecutorConnectionDraft, recommendation: Pick<ExecutorRelationRecommendation, "relation" | "confidence">): ExecutorConnectionDraft;
//# sourceMappingURL=executor-relation-inference.d.ts.map