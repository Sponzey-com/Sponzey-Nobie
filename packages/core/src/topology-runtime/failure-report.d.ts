import { type EnterpriseMetadata, type EnterpriseTimestamp, type FailureReport, type NodeContract, type NodeResultOutput, type WorkOrder } from "../contracts/enterprise-topology.js";
import type { NodeExhaustionCheckResult } from "./exhaustion-checker.js";
import type { NodeRecoveryControllerResult } from "./recovery-controller.js";
export interface GenerateFailureReportInput {
    workOrder: WorkOrder;
    nodeContractSnapshot: NodeContract;
    nodeRunId: string;
    outputs: NodeResultOutput[];
    risksOrGaps: string[];
    recoveryReview: NodeRecoveryControllerResult;
    exhaustion: NodeExhaustionCheckResult;
    partialResult?: EnterpriseMetadata;
    recommendedAction?: string;
    failureReportId?: string;
    createdAt?: EnterpriseTimestamp;
}
export declare function generateFailureReport(input: GenerateFailureReportInput): FailureReport;
//# sourceMappingURL=failure-report.d.ts.map
