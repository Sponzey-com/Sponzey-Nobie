export const EXECUTOR_CONNECTION_LABELS = {
    handoff: "넘김",
    approval_request: "승인 요청",
    report: "보고",
    collaboration: "협업",
    exception: "예외 처리",
    reference: "참고 요청",
};
export function executorConnectionLabel(relation) {
    return EXECUTOR_CONNECTION_LABELS[relation];
}
export function executorConnectionRelationToEnterpriseRelationType(relation) {
    if (relation === "approval_request")
        return "approves";
    if (relation === "report")
        return "reports_to";
    if (relation === "collaboration")
        return "collaborates_with";
    if (relation === "exception")
        return "escalates_to";
    if (relation === "reference")
        return "consults";
    return "delegates_to";
}
export function executorConnectionToSafeEnterpriseRelationType(input) {
    if (input.connection.advancedRelationType)
        return input.connection.advancedRelationType;
    if (input.connection.inferredRelation === "approval_request") {
        return input.target?.inferredRuntimeMode === "approval" ? "delegates_to" : "consults";
    }
    if (input.connection.inferredRelation === "report")
        return "informs";
    return executorConnectionRelationToEnterpriseRelationType(input.connection.inferredRelation);
}
export function enterpriseRelationTypeToExecutorConnectionRelation(relationType) {
    if (relationType === "delegates_to")
        return "handoff";
    if (relationType === "approves")
        return "approval_request";
    if (relationType === "reports_to" || relationType === "informs")
        return "report";
    if (relationType === "collaborates_with")
        return "collaboration";
    if (relationType === "escalates_to")
        return "exception";
    if (relationType === "consults" || relationType === "depends_on")
        return "reference";
    return null;
}
export function createExecutorConnectionDraft(input) {
    return {
        id: input.id ?? `connection:${input.source.id}:${input.target.id}`,
        fromExecutorId: input.source.id,
        toExecutorId: input.target.id,
        inferredRelation: "handoff",
        label: EXECUTOR_CONNECTION_LABELS.handoff,
        confidence: 0.62,
        userConfirmed: false,
    };
}
export function recommendExecutorConnectionRelations(input) {
    void input;
    return [{
            relation: "handoff",
            label: EXECUTOR_CONNECTION_LABELS.handoff,
            confidence: 0.62,
            reasonKo: "기본 연결은 다음 실행자로 일을 넘기는 의미입니다. 다른 의미가 필요하면 사용자 선택 또는 서버 제안 결과를 저장합니다.",
            reasonEn: "The default connection passes work to the next executor.",
            keywordHits: [],
        }];
}
export function applyExecutorConnectionRecommendation(connection, recommendation) {
    return {
        ...connection,
        inferredRelation: recommendation.relation,
        label: EXECUTOR_CONNECTION_LABELS[recommendation.relation],
        confidence: recommendation.confidence,
        userConfirmed: true,
    };
}
//# sourceMappingURL=executor-relation-inference.js.map