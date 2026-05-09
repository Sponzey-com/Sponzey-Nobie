import { type EnterpriseMetadata, type EnterpriseTimestamp, type NodeResultOutput, type NodeResultReport, type NodeResultStatus, type NodeRuntimeProfileSnapshot, type WorkOrder } from "../contracts/enterprise-topology.js";
import type { ResultReport } from "../contracts/sub-agent-orchestration.js";
import type { WorkOrderRuntimeEnvelope } from "./work-order.js";
export interface CreateNodeResultReportInput {
    profileSnapshot: NodeRuntimeProfileSnapshot;
    workOrder: WorkOrder;
    nodeRunId: string;
    status: NodeResultStatus;
    outputs: NodeResultOutput[];
    unmetSuccessCriteriaIds: string[];
    risksOrGaps: string[];
    partialResult?: EnterpriseMetadata;
    failureReportId?: string;
    resultReportId?: string;
    createdAt?: EnterpriseTimestamp;
}
export interface CreateLegacyResultReportInput {
    nodeResultReport: NodeResultReport;
    envelope: WorkOrderRuntimeEnvelope;
}
export declare function createNodeResultReportFromRuntime(input: CreateNodeResultReportInput): NodeResultReport;
export declare function createLegacyResultReportFromNodeResult(input: CreateLegacyResultReportInput): ResultReport;
export declare function legacyResultStatusForNodeResultStatus(status: NodeResultStatus): ResultReport["status"];
//# sourceMappingURL=reporter.d.ts.map