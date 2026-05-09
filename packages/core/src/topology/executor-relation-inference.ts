import type { EnterpriseRelationType } from "../contracts/enterprise-topology.js"
import type {
  ExecutorConnectionDraft,
  ExecutorConnectionRelation,
  ExecutorDraft,
} from "./executor-graph.js"

export interface ExecutorRelationKeywordHit {
  keyword: string
  hint: "approval" | "lead" | "review" | "exception" | "report" | "reference" | "collaboration"
  side: "source" | "target"
}

export interface ExecutorRelationRecommendation {
  relation: ExecutorConnectionRelation
  label: ExecutorConnectionDraft["label"]
  confidence: number
  reasonKo: string
  reasonEn: string
  keywordHits: ExecutorRelationKeywordHit[]
}

export interface ExecutorRelationInferenceInput {
  source: Pick<ExecutorDraft, "id" | "name" | "description" | "inferredRuntimeMode" | "inferredCapabilities">
  target: Pick<ExecutorDraft, "id" | "name" | "description" | "inferredRuntimeMode" | "inferredCapabilities">
}

export interface CreateExecutorConnectionDraftInput extends ExecutorRelationInferenceInput {
  id?: string
}

export const EXECUTOR_CONNECTION_LABELS: Record<ExecutorConnectionRelation, ExecutorConnectionDraft["label"]> = {
  handoff: "넘김",
  approval_request: "승인 요청",
  report: "보고",
  collaboration: "협업",
  exception: "예외 처리",
  reference: "참고 요청",
}

export function executorConnectionLabel(
  relation: ExecutorConnectionRelation,
): ExecutorConnectionDraft["label"] {
  return EXECUTOR_CONNECTION_LABELS[relation]
}

export function executorConnectionRelationToEnterpriseRelationType(
  relation: ExecutorConnectionRelation,
): EnterpriseRelationType {
  if (relation === "approval_request") return "approves"
  if (relation === "report") return "reports_to"
  if (relation === "collaboration") return "collaborates_with"
  if (relation === "exception") return "escalates_to"
  if (relation === "reference") return "consults"
  return "delegates_to"
}

export function executorConnectionToSafeEnterpriseRelationType(input: {
  connection: Pick<ExecutorConnectionDraft, "inferredRelation" | "advancedRelationType">
  source?: Pick<ExecutorDraft, "inferredRuntimeMode"> | null
  target?: Pick<ExecutorDraft, "inferredRuntimeMode"> | null
}): EnterpriseRelationType {
  if (input.connection.advancedRelationType) return input.connection.advancedRelationType
  if (input.connection.inferredRelation === "approval_request") {
    return input.target?.inferredRuntimeMode === "approval" ? "delegates_to" : "consults"
  }
  if (input.connection.inferredRelation === "report") return "informs"
  return executorConnectionRelationToEnterpriseRelationType(input.connection.inferredRelation)
}

export function enterpriseRelationTypeToExecutorConnectionRelation(
  relationType: EnterpriseRelationType,
): ExecutorConnectionRelation | null {
  if (relationType === "delegates_to") return "handoff"
  if (relationType === "approves") return "approval_request"
  if (relationType === "reports_to" || relationType === "informs") return "report"
  if (relationType === "collaborates_with") return "collaboration"
  if (relationType === "escalates_to") return "exception"
  if (relationType === "consults" || relationType === "depends_on") return "reference"
  return null
}

export function createExecutorConnectionDraft(
  input: CreateExecutorConnectionDraftInput,
): ExecutorConnectionDraft {
  return {
    id: input.id ?? `connection:${input.source.id}:${input.target.id}`,
    fromExecutorId: input.source.id,
    toExecutorId: input.target.id,
    inferredRelation: "handoff",
    label: EXECUTOR_CONNECTION_LABELS.handoff,
    confidence: 0.62,
    userConfirmed: false,
  }
}

export function recommendExecutorConnectionRelations(
  input: ExecutorRelationInferenceInput,
): ExecutorRelationRecommendation[] {
  void input
  return [{
    relation: "handoff",
    label: EXECUTOR_CONNECTION_LABELS.handoff,
    confidence: 0.62,
    reasonKo: "기본 연결은 다음 실행자로 일을 넘기는 의미입니다. 다른 의미가 필요하면 사용자 선택 또는 서버 제안 결과를 저장합니다.",
    reasonEn: "The default connection passes work to the next executor.",
    keywordHits: [],
  }]
}

export function applyExecutorConnectionRecommendation(
  connection: ExecutorConnectionDraft,
  recommendation: Pick<ExecutorRelationRecommendation, "relation" | "confidence">,
): ExecutorConnectionDraft {
  return {
    ...connection,
    inferredRelation: recommendation.relation,
    label: EXECUTOR_CONNECTION_LABELS[recommendation.relation],
    confidence: recommendation.confidence,
    userConfirmed: true,
  }
}
