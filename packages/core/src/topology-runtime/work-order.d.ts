import { type AuthorityScope, type EnterpriseMetadata, type EnterpriseTimestamp, type NodeContract, type PermissionScope, type WorkOrder, type WorkOrderScope, type WorkOrderSuccessCriterion, type WorkOrderTarget } from "../contracts/enterprise-topology.js";
import { type CapabilityPolicy, type CommandRequest, type DataExchangePackage, type ExpectedOutputContract } from "../contracts/sub-agent-orchestration.js";
import type { CompiledTopologySnapshot } from "../topology/compiler.js";
export type WorkOrderRuntimeBridgeIssueCode = "invalid_work_order" | "invalid_command_request" | "node_contract_mismatch" | "compiled_topology_mismatch" | "work_order_target_not_node" | "authority_preflight_denied";
export interface WorkOrderRuntimeBridgeIssue {
    code: WorkOrderRuntimeBridgeIssueCode;
    message: string;
    path?: string;
    reasonCode?: string;
}
export interface BuildWorkOrderInput {
    workOrderId: string;
    topologyRunId: string;
    parentWorkOrderId?: string | null;
    fromNodeId: string;
    to: WorkOrderTarget;
    objective: string;
    scope: WorkOrderScope;
    input: EnterpriseMetadata;
    expectedOutputSchema: EnterpriseMetadata;
    successCriteria: WorkOrderSuccessCriterion[];
    permissionScope: PermissionScope;
    authorityScope: AuthorityScope;
    failureReportRequired: boolean;
    delegationPath: string[];
    createdAt: EnterpriseTimestamp;
}
export interface WorkOrderRuntimeEnvelopeInput {
    workOrder: WorkOrder;
    nodeContractSnapshot: NodeContract;
    compiledTopologySnapshot: CompiledTopologySnapshot;
    parentRunId?: string;
    parentSessionId?: string;
    parentSubSessionId?: string;
    commandRequestId?: string;
    subSessionId?: string;
    targetAgentId?: string;
    targetNicknameSnapshot?: string;
    contextPackageId?: string;
    now?: () => number;
    authorityPreflight?: WorkOrderAuthorityPreflightInput;
    baseCapabilityPolicy?: CapabilityPolicy;
}
export type WorkOrderRuntimeEnvelopeResult = {
    ok: true;
    envelope: WorkOrderRuntimeEnvelope;
} | {
    ok: false;
    issues: WorkOrderRuntimeBridgeIssue[];
};
export interface WorkOrderRuntimeEnvelope {
    workOrder: WorkOrder;
    nodeContractSnapshot: NodeContract;
    compiledTopologySnapshotId: string;
    parentWorkOrderId?: string | null;
    delegationPath: string[];
    inputDataExchangePackage: DataExchangePackage;
    expectedOutputs: ExpectedOutputContract[];
    effectivePermissionScope: EffectiveWorkOrderPermissionScope;
    capabilityPolicy: CapabilityPolicy;
    authorityDecision: WorkOrderAuthorityDecision;
    promptBridge: WorkOrderPromptBridge;
    resultReviewBridge: WorkOrderResultReviewBridge;
    subSessionCommandRequest: CommandRequest;
    subSessionIdempotencyKey: string;
}
export interface EffectiveWorkOrderPermissionScope {
    allowedToolIds: string[];
    allowedSystemIds: string[];
    dataDomainIds: string[];
    riskLevel?: PermissionScope["riskLevel"];
    removedToolIds: string[];
    removedSystemIds: string[];
    removedDataDomainIds: string[];
    reasonCodes: string[];
}
export interface WorkOrderPromptBridge {
    completionCriteria: ExpectedOutputContract[];
    successCriterionIds: string[];
    promptContextRefs: string[];
    promptFragments: Array<{
        kind: "completion_criteria" | "permission_profile" | "authority";
        title: string;
        content: string;
    }>;
}
export interface WorkOrderResultReviewBridge {
    expectedOutputs: ExpectedOutputContract[];
    additionalContextRefs: string[];
    successCriterionIds: string[];
}
export interface WorkOrderAuthorityPreflightInput {
    grantedAuthorityRuleIds?: string[];
    deniedAuthorityRuleIds?: string[];
    approvedBy?: AuthorityScope["approvedBy"];
}
export interface WorkOrderAuthorityDecision {
    allowed: boolean;
    status: "not_required" | "approved" | "denied";
    reasonCode: string;
    requiredAuthorityRuleIds: string[];
    grantedAuthorityRuleIds: string[];
    deniedAuthorityRuleIds: string[];
    missingAuthorityRuleIds: string[];
    approvedBy: NonNullable<AuthorityScope["approvedBy"]>;
}
export declare function buildWorkOrder(input: BuildWorkOrderInput): WorkOrder;
export declare function createWorkOrderRuntimeEnvelope(input: WorkOrderRuntimeEnvelopeInput): WorkOrderRuntimeEnvelopeResult;
export declare function buildExpectedOutputsForWorkOrder(workOrder: WorkOrder): ExpectedOutputContract[];
export declare function workOrderExpectedOutputSchemaToExpectedOutputContract(workOrder: WorkOrder): ExpectedOutputContract;
export declare function successCriterionToExpectedOutputContract(criterion: WorkOrderSuccessCriterion): ExpectedOutputContract;
export declare function deriveEffectiveWorkOrderPermissionScope(input: {
    workOrder: WorkOrder;
    nodeContractSnapshot: NodeContract;
    compiledTopologySnapshot: CompiledTopologySnapshot;
}): EffectiveWorkOrderPermissionScope;
export declare function deriveWorkOrderCapabilityPolicy(input: {
    workOrder: WorkOrder;
    effectivePermissionScope: EffectiveWorkOrderPermissionScope;
    baseCapabilityPolicy?: CapabilityPolicy;
}): CapabilityPolicy;
export declare function evaluateWorkOrderAuthorityPreflight(workOrder: WorkOrder, input?: WorkOrderAuthorityPreflightInput): WorkOrderAuthorityDecision;
export declare function buildWorkOrderSubSessionIdempotencyKey(workOrder: WorkOrder, subSessionId: string): string;
//# sourceMappingURL=work-order.d.ts.map