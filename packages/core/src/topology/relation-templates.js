import { TOPOLOGY_RELATION_ENDPOINT_RULES } from "./schema.js";
const RELATION_TEMPLATE_META = {
    delegates_to: {
        relationType: "delegates_to",
        labelKo: "위임",
        labelEn: "Delegates to",
        descriptionKo: "실행 가능한 업무 노드 간 위임 경로",
        descriptionEn: "Executable delegation path between work nodes",
        group: "primary",
        layer: "runtime",
        runtimeCandidate: true,
        easyLabelKo: "다음",
        easyLabelEn: "Next",
        smartConnectLabelKo: "다음 업무로 연결",
        smartConnectLabelEn: "Connect to next work step",
    },
    reports_to: {
        relationType: "reports_to",
        labelKo: "보고",
        labelEn: "Reports to",
        descriptionKo: "직책 또는 담당자 간 보고 관계",
        descriptionEn: "Reporting relation between positions or people",
        group: "primary",
        layer: "analysis",
        runtimeCandidate: false,
        easyLabelKo: "보고",
        easyLabelEn: "Report",
        smartConnectLabelKo: "보고 관계로 연결",
        smartConnectLabelEn: "Connect as reporting relation",
    },
    approves: {
        relationType: "approves",
        labelKo: "승인",
        labelEn: "Approves",
        descriptionKo: "조직/직책/담당자가 업무 대상을 승인",
        descriptionEn: "Authority holder approves a work target",
        group: "primary",
        layer: "authority",
        runtimeCandidate: false,
        easyLabelKo: "승인",
        easyLabelEn: "Approve",
        smartConnectLabelKo: "승인 관계로 연결",
        smartConnectLabelEn: "Connect as approval relation",
    },
    uses_tool: {
        relationType: "uses_tool",
        labelKo: "도구 사용",
        labelEn: "Uses tool",
        descriptionKo: "업무 노드가 도구를 사용",
        descriptionEn: "Work node uses a tool",
        group: "primary",
        layer: "technical",
        runtimeCandidate: false,
        easyLabelKo: "사용",
        easyLabelEn: "Use",
        smartConnectLabelKo: "도구 사용으로 연결",
        smartConnectLabelEn: "Connect as tool use",
    },
    uses_system: {
        relationType: "uses_system",
        labelKo: "시스템 사용",
        labelEn: "Uses system",
        descriptionKo: "업무 노드 또는 프로세스가 시스템을 사용",
        descriptionEn: "Work node or process uses a system",
        group: "primary",
        layer: "technical",
        runtimeCandidate: false,
        easyLabelKo: "사용",
        easyLabelEn: "Use",
        smartConnectLabelKo: "시스템 사용으로 연결",
        smartConnectLabelEn: "Connect as system use",
    },
    owns: {
        relationType: "owns",
        labelKo: "소유",
        labelEn: "Owns",
        descriptionKo: "업무, 시스템, 도구 책임 소유",
        descriptionEn: "Ownership over work, systems, or tools",
        group: "more",
        layer: "authority",
        runtimeCandidate: false,
        easyLabelKo: "소유",
        easyLabelEn: "Own",
    },
    belongs_to: {
        relationType: "belongs_to",
        labelKo: "소속",
        labelEn: "Belongs to",
        descriptionKo: "팀 또는 조직 소속",
        descriptionEn: "Membership in team or org unit",
        group: "more",
        layer: "analysis",
        runtimeCandidate: false,
        easyLabelKo: "소속",
        easyLabelEn: "Belongs to",
        smartConnectLabelKo: "그룹에 넣기",
        smartConnectLabelEn: "Put into group",
    },
    collaborates_with: {
        relationType: "collaborates_with",
        labelKo: "협업",
        labelEn: "Collaborates with",
        descriptionKo: "업무/조직/사람 간 협업",
        descriptionEn: "Collaboration between work, structure, or people",
        group: "more",
        layer: "analysis",
        runtimeCandidate: false,
        easyLabelKo: "협업",
        easyLabelEn: "Collaborate",
    },
    escalates_to: {
        relationType: "escalates_to",
        labelKo: "에스컬레이션",
        labelEn: "Escalates to",
        descriptionKo: "처리 실패나 판단 필요 시 상향 전달",
        descriptionEn: "Escalation for failure or decision needs",
        group: "more",
        layer: "analysis",
        runtimeCandidate: false,
        easyLabelKo: "에스컬레이션",
        easyLabelEn: "Escalate",
        smartConnectLabelKo: "에스컬레이션으로 연결",
        smartConnectLabelEn: "Connect as escalation",
    },
    informs: {
        relationType: "informs",
        labelKo: "알림",
        labelEn: "Informs",
        descriptionKo: "정보 공유 관계",
        descriptionEn: "Information flow relation",
        group: "more",
        layer: "analysis",
        runtimeCandidate: false,
        easyLabelKo: "알림",
        easyLabelEn: "Inform",
    },
    has_access_to: {
        relationType: "has_access_to",
        labelKo: "접근 권한",
        labelEn: "Has access to",
        descriptionKo: "시스템 또는 도구 접근 권한",
        descriptionEn: "Access to system or tool",
        group: "more",
        layer: "authority",
        runtimeCandidate: false,
        easyLabelKo: "접근",
        easyLabelEn: "Access",
    },
    depends_on: {
        relationType: "depends_on",
        labelKo: "의존",
        labelEn: "Depends on",
        descriptionKo: "업무 또는 기술 대상 의존 관계",
        descriptionEn: "Dependency between work or technical targets",
        group: "more",
        layer: "analysis",
        runtimeCandidate: false,
        easyLabelKo: "의존",
        easyLabelEn: "Depends on",
    },
    consults: {
        relationType: "consults",
        labelKo: "자문",
        labelEn: "Consults",
        descriptionKo: "업무 수행 중 자문 관계",
        descriptionEn: "Consultation relation during work",
        group: "more",
        layer: "analysis",
        runtimeCandidate: false,
        easyLabelKo: "자문",
        easyLabelEn: "Consult",
    },
    accountable_for: {
        relationType: "accountable_for",
        labelKo: "책임",
        labelEn: "Accountable for",
        descriptionKo: "업무 또는 프로세스 책임 관계",
        descriptionEn: "Accountability over work or process",
        group: "more",
        layer: "authority",
        runtimeCandidate: false,
        easyLabelKo: "책임",
        easyLabelEn: "Accountable",
    },
};
export const TOPOLOGY_RELATION_TEMPLATE_CATALOG = {
    schemaVersion: 1,
    presets: Object.values(RELATION_TEMPLATE_META).map((preset) => ({
        ...preset,
        allowedPairs: TOPOLOGY_RELATION_ENDPOINT_RULES[preset.relationType].allowedPairs.map((pair) => ({ ...pair })),
    })),
};
export function recommendTopologySmartConnectRelations(input) {
    const catalog = input.catalog ?? TOPOLOGY_RELATION_TEMPLATE_CATALOG;
    const recommendations = [];
    for (const preset of catalog.presets) {
        if (isAllowedPair(preset, input.source.entityType, input.target.entityType)) {
            recommendations.push(buildSmartConnectRecommendation({
                preset,
                direction: "source_to_target",
                source: input.source,
                target: input.target,
            }));
        }
        if (isAllowedPair(preset, input.target.entityType, input.source.entityType)) {
            recommendations.push(buildSmartConnectRecommendation({
                preset,
                direction: "target_to_source",
                source: input.source,
                target: input.target,
            }));
        }
    }
    return recommendations.sort((a, b) => a.priority - b.priority || a.labelKo.localeCompare(b.labelKo));
}
export function recommendTopologySmartConnectRelation(input) {
    return recommendTopologySmartConnectRelations(input)[0];
}
export function planTopologySmartConnect(input) {
    const recommendations = recommendTopologySmartConnectRelations(input);
    const recommendation = recommendations[0];
    if (recommendation !== undefined) {
        return { ok: true, recommendation, recommendations };
    }
    return {
        ok: false,
        recommendations: [],
        issue: {
            reasonCode: "no_valid_relation",
            messageKo: `${input.source.entityType}에서 ${input.target.entityType}(으)로 만들 수 있는 쉬운 연결이 없습니다.`,
            messageEn: `No easy relation can connect ${input.source.entityType} to ${input.target.entityType}.`,
            sourceEntityType: input.source.entityType,
            targetEntityType: input.target.entityType,
        },
    };
}
function isAllowedPair(preset, from, to) {
    return preset.allowedPairs.some((pair) => pair.from === from && pair.to === to);
}
function buildSmartConnectRecommendation(input) {
    const { preset, direction, source, target } = input;
    const approvalStep = source.entityType === "node" && target.entityType === "node" && target.nodeType === "approval_node";
    const labelKo = approvalStep && preset.relationType === "delegates_to"
        ? "승인 단계로 연결"
        : preset.smartConnectLabelKo ?? preset.easyLabelKo ?? preset.labelKo;
    const labelEn = approvalStep && preset.relationType === "delegates_to"
        ? "Connect to approval step"
        : preset.smartConnectLabelEn ?? preset.easyLabelEn ?? preset.labelEn;
    return {
        relationType: preset.relationType,
        easyMode: smartConnectEasyMode(preset, source, target),
        direction,
        labelKo,
        labelEn,
        reasonKo: smartConnectReasonKo(preset, direction),
        reasonEn: smartConnectReasonEn(preset, direction),
        layer: preset.layer,
        runtimeCandidate: preset.runtimeCandidate,
        priority: smartConnectPriority(preset, direction, source, target),
    };
}
function smartConnectEasyMode(preset, source, target) {
    if (source.entityType === "node" && target.entityType === "node" && target.nodeType === "approval_node")
        return "approve";
    if (preset.relationType === "delegates_to")
        return "next";
    if (preset.relationType === "approves")
        return "approve";
    if (preset.relationType === "uses_tool" || preset.relationType === "uses_system")
        return "use";
    if (preset.relationType === "reports_to")
        return "report";
    if (preset.relationType === "belongs_to")
        return "group";
    return "delegate";
}
function smartConnectPriority(preset, direction, source, target) {
    if (source.entityType === "node" && target.entityType === "node" && target.nodeType === "approval_node" && preset.relationType === "delegates_to")
        return 5;
    if (source.entityType === "node" && target.entityType === "node" && preset.relationType === "delegates_to")
        return 10;
    if (source.entityType === "node" && target.entityType === "enterprise_tool" && preset.relationType === "uses_tool")
        return 10;
    if (source.entityType === "node" && target.entityType === "enterprise_system" && preset.relationType === "uses_system")
        return 10;
    if (direction === "target_to_source" && preset.relationType === "belongs_to")
        return 15;
    if (preset.group === "primary")
        return 30;
    return 60;
}
function smartConnectReasonKo(preset, direction) {
    if (direction === "target_to_source")
        return "반대 방향으로 연결하면 자연스럽다.";
    if (preset.runtimeCandidate)
        return "실행 경로로 사용할 수 있는 연결이다.";
    return "이 두 항목에 사용할 수 있는 연결이다.";
}
function smartConnectReasonEn(preset, direction) {
    if (direction === "target_to_source")
        return "This connection is natural in the reverse direction.";
    if (preset.runtimeCandidate)
        return "This connection can be used as a runtime path.";
    return "This connection is available for these items.";
}
//# sourceMappingURL=relation-templates.js.map