import { evaluateWorkOrderAuthorityPreflight, } from "./work-order.js";
export function checkNodeRuntimeAuthority(input) {
    if (input.authorityPreflight === undefined && input.authorityDecision !== undefined) {
        return cloneAuthorityDecision(input.authorityDecision);
    }
    return evaluateWorkOrderAuthorityPreflight(input.workOrder, input.authorityPreflight);
}
function cloneAuthorityDecision(decision) {
    return {
        allowed: decision.allowed,
        status: decision.status,
        reasonCode: decision.reasonCode,
        requiredAuthorityRuleIds: [...decision.requiredAuthorityRuleIds],
        grantedAuthorityRuleIds: [...decision.grantedAuthorityRuleIds],
        deniedAuthorityRuleIds: [...decision.deniedAuthorityRuleIds],
        missingAuthorityRuleIds: [...decision.missingAuthorityRuleIds],
        approvedBy: decision.approvedBy.map((reference) => ({ ...reference })),
    };
}
//# sourceMappingURL=authority-checker.js.map