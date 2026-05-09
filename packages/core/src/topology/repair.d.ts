import type { EnterpriseTopology } from "../contracts/enterprise-topology.js";
export type TopologyRepairIssueSeverity = "info" | "warning" | "invalid";
export interface TopologyRepairIssue {
    code: string;
    severity: TopologyRepairIssueSeverity;
    message: string;
    topologyId: string;
    nodeId?: string;
    relationId?: string;
}
export interface TopologyPersistenceRepairResult {
    topology: EnterpriseTopology;
    issues: TopologyRepairIssue[];
}
export declare function repairTopologyForPersistence(topology: EnterpriseTopology): TopologyPersistenceRepairResult;
//# sourceMappingURL=repair.d.ts.map