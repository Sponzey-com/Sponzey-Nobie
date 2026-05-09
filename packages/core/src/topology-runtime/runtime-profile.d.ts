import { type EnterpriseTimestamp, type NodeContract, type NodeRuntimeProfileSnapshot, type WorkOrder } from "../contracts/enterprise-topology.js";
import type { CompiledTopologySnapshot } from "../topology/compiler.js";
import { type EffectiveWorkOrderPermissionScope } from "./work-order.js";
export interface CreateNodeRuntimeProfileSnapshotInput {
    workOrder: WorkOrder;
    nodeContractSnapshot: NodeContract;
    compiledTopologySnapshot: CompiledTopologySnapshot;
    effectivePermissionScope?: EffectiveWorkOrderPermissionScope;
    profileSnapshotId?: string;
    createdAt?: EnterpriseTimestamp;
}
export declare function createNodeRuntimeProfileSnapshot(input: CreateNodeRuntimeProfileSnapshotInput): NodeRuntimeProfileSnapshot;
export declare function buildNodeRuntimeProfileSnapshotId(input: {
    workOrderId: string;
    nodeId: string;
    compiledTopologySnapshotId: string;
    createdAt: EnterpriseTimestamp;
}): string;
//# sourceMappingURL=runtime-profile.d.ts.map