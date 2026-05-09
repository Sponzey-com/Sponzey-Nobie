import type { NodeContract, WorkOrder } from "../contracts/enterprise-topology.js";
import type { CompiledTopologySnapshot } from "../topology/compiler.js";
import { type EffectiveWorkOrderPermissionScope } from "./work-order.js";
export type NodeRuntimePermissionDecisionStatus = "allowed" | "denied";
export interface NodeRuntimePermissionDecision {
    allowed: boolean;
    status: NodeRuntimePermissionDecisionStatus;
    reasonCode: "permission_scope_allowed" | "permission_scope_denied";
    missingToolIds: string[];
    missingSystemIds: string[];
    missingDataDomainIds: string[];
    effectivePermissionScope: EffectiveWorkOrderPermissionScope;
    reasonCodes: string[];
}
export interface CheckNodeRuntimePermissionInput {
    workOrder: WorkOrder;
    nodeContractSnapshot: NodeContract;
    compiledTopologySnapshot: CompiledTopologySnapshot;
}
export declare function checkNodeRuntimePermission(input: CheckNodeRuntimePermissionInput): NodeRuntimePermissionDecision;
//# sourceMappingURL=permission-checker.d.ts.map