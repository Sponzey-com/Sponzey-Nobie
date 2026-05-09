import { deriveEffectiveWorkOrderPermissionScope, } from "./work-order.js";
export function checkNodeRuntimePermission(input) {
    const effectivePermissionScope = deriveEffectiveWorkOrderPermissionScope(input);
    const missingToolIds = [...effectivePermissionScope.removedToolIds];
    const missingSystemIds = [...effectivePermissionScope.removedSystemIds];
    const missingDataDomainIds = [...effectivePermissionScope.removedDataDomainIds];
    const denied = missingToolIds.length > 0 || missingSystemIds.length > 0 || missingDataDomainIds.length > 0;
    return {
        allowed: !denied,
        status: denied ? "denied" : "allowed",
        reasonCode: denied ? "permission_scope_denied" : "permission_scope_allowed",
        missingToolIds,
        missingSystemIds,
        missingDataDomainIds,
        effectivePermissionScope,
        reasonCodes: [
            ...effectivePermissionScope.reasonCodes,
            denied ? "node_runtime_permission_denied" : "node_runtime_permission_allowed",
        ],
    };
}
//# sourceMappingURL=permission-checker.js.map