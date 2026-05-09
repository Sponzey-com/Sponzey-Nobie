import type { EnterpriseEntityRef, EnterpriseTimestamp, EnterpriseTopology } from "../contracts/enterprise-topology.js";
export interface ApprovalLineSimulationInput {
    topology: EnterpriseTopology;
    target: EnterpriseEntityRef;
    action?: string;
    amount?: number;
    requester?: EnterpriseEntityRef<"position" | "person" | "org_unit" | "node">;
    asOf?: EnterpriseTimestamp;
    maxEscalationDepth?: number;
}
export interface ApprovalLineApprover {
    approver: EnterpriseEntityRef<"position" | "person" | "org_unit">;
    source: "authority_rule" | "approves_relation" | "reports_to_escalation";
    authorityRuleIds: string[];
    relationIds: string[];
    approvalLimit?: number;
    sufficient: boolean;
    reasonCodes: string[];
}
export interface ApprovalLineSimulationResult {
    approved: boolean;
    reasonCode: "approval_line_not_required" | "approval_line_approved" | "approval_line_insufficient_limit" | "approval_line_missing";
    action: string;
    target: EnterpriseEntityRef;
    amount?: number;
    approvers: ApprovalLineApprover[];
    missingAuthorityRuleIds: string[];
    escalationPath: EnterpriseEntityRef<"position">[];
    authorityContext: {
        requiredAuthorityRuleIds: string[];
        approvalRequired: boolean;
        approvedBy: Array<EnterpriseEntityRef<"position" | "person" | "org_unit">>;
    };
}
export declare function simulateApprovalLine(input: ApprovalLineSimulationInput): ApprovalLineSimulationResult;
//# sourceMappingURL=enterprise-rules.d.ts.map