import { type NodeResultOutput, type NodeResultStatus, type WorkOrder } from "../contracts/enterprise-topology.js";
import type { AggregationResult } from "./aggregation.js";
export type AggregatedNodeValidationStatus = "valid" | "needs_revision" | "partial_success" | "failed_candidate";
export type AggregatedNodeValidationIssueCode = "required_output_missing" | "output_schema_value_missing" | "output_schema_type_mismatch" | "output_schema_required_field_missing" | "success_criterion_unmet" | "optional_success_criterion_unmet" | "output_conflict_detected" | "source_failure_candidate" | "child_result_missing" | "quorum_not_met";
export interface AggregatedNodeValidationIssue {
    code: AggregatedNodeValidationIssueCode;
    reasonCode: AggregatedNodeValidationIssueCode;
    severity: "warning" | "needs_revision" | "blocked";
    message: string;
    outputId?: string;
    criterionId?: string;
    sourceIds?: string[];
    path?: string;
}
export interface AggregatedNodeValidationResult {
    status: AggregatedNodeValidationStatus;
    nodeResultStatus: NodeResultStatus;
    valid: boolean;
    outputs: NodeResultOutput[];
    unmetSuccessCriteriaIds: string[];
    risksOrGaps: string[];
    issues: AggregatedNodeValidationIssue[];
    reasonCodes: string[];
}
export interface ValidateAggregatedNodeResultInput {
    workOrder: WorkOrder;
    aggregation: AggregationResult;
    allowPartialSuccess?: boolean;
}
export declare function validateAggregatedNodeResult(input: ValidateAggregatedNodeResultInput): AggregatedNodeValidationResult;
export declare function validationStatusToNodeResultStatus(status: AggregatedNodeValidationStatus): NodeResultStatus;
//# sourceMappingURL=validation.d.ts.map