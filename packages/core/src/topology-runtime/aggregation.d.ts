import type { NodeResultOutput, NodeResultReport, WorkOrder } from "../contracts/enterprise-topology.js";
import type { ChildDispatchSummary } from "./child-dispatcher.js";
import type { NodeToolExecutionSummary } from "./tool-dispatcher.js";
export type AggregationStrategy = "merge_and_validate" | "parent_decides" | "require_all_child_results" | "best_effort_with_warnings" | "quorum";
export type AggregatedResultSourceKind = "self" | "child" | "tool";
export type AggregationIssueCode = "duplicate_output_removed" | "output_conflict_detected" | "child_result_missing" | "source_failure_candidate" | "quorum_not_met";
export interface AggregatedResultSource {
    sourceKind: AggregatedResultSourceKind;
    sourceId: string;
    status: "completed" | "partial_success" | "failed_candidate" | "permission_limited" | "needs_revision" | "failed";
    outputCount: number;
    failureCandidate: boolean;
    risksOrGaps: string[];
}
export interface AggregatedResultItem {
    sourceKind: AggregatedResultSourceKind;
    sourceId: string;
    output: NodeResultOutput;
    fingerprint: string;
}
export interface AggregationIssue {
    code: AggregationIssueCode;
    reasonCode: AggregationIssueCode;
    severity: "info" | "warning" | "needs_revision" | "blocked";
    message: string;
    outputId?: string;
    sourceIds: string[];
}
export interface AggregationResult {
    strategy: AggregationStrategy;
    workOrderId: string;
    outputs: NodeResultOutput[];
    items: AggregatedResultItem[];
    sources: AggregatedResultSource[];
    issues: AggregationIssue[];
    conflicts: AggregationIssue[];
    duplicates: AggregationIssue[];
    missingChildNodeIds: string[];
    reasonCodes: string[];
}
export interface AggregateNodeRuntimeResultsInput {
    workOrder: WorkOrder;
    strategy?: AggregationStrategy;
    selfOutputs?: NodeResultOutput[];
    selfStatus?: AggregatedResultSource["status"];
    selfRisksOrGaps?: string[];
    childReports?: NodeResultReport[];
    childDelegation?: ChildDispatchSummary;
    toolExecution?: NodeToolExecutionSummary;
    expectedChildNodeIds?: string[];
    requireAllChildResults?: boolean;
    quorum?: {
        requiredSatisfiedSourceCount: number;
    };
}
export declare function aggregateNodeRuntimeResults(input: AggregateNodeRuntimeResultsInput): AggregationResult;
//# sourceMappingURL=aggregation.d.ts.map