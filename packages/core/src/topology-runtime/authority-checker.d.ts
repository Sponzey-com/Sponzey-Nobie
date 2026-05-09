import type { WorkOrder } from "../contracts/enterprise-topology.js";
import { type WorkOrderAuthorityDecision, type WorkOrderAuthorityPreflightInput } from "./work-order.js";
export type NodeRuntimeAuthorityDecision = WorkOrderAuthorityDecision;
export interface CheckNodeRuntimeAuthorityInput {
    workOrder: WorkOrder;
    authorityPreflight?: WorkOrderAuthorityPreflightInput;
    authorityDecision?: WorkOrderAuthorityDecision;
}
export declare function checkNodeRuntimeAuthority(input: CheckNodeRuntimeAuthorityInput): NodeRuntimeAuthorityDecision;
//# sourceMappingURL=authority-checker.d.ts.map