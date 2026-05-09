import type { AuthorityRule, EnterpriseEntityRef, EnterpriseTimestamp, EnterpriseTopology, EnterpriseTopologySchemaVersion, NodeContract } from "../contracts/enterprise-topology.js";
import { type TopologyValidationResult, type TopologyValidatorIssue, type TopologyValidatorOptions } from "./validator.js";
export declare const TOPOLOGY_COMPILER_VERSION: "enterprise-topology-compiler.v1";
export interface CompileTopologyOptions {
    compiledAt?: EnterpriseTimestamp;
    compiledTopologySnapshotId?: string;
    sourceTopologyVersion?: number | string;
    validationOptions?: TopologyValidatorOptions;
}
export interface CompiledTopologySnapshot {
    schemaVersion: EnterpriseTopologySchemaVersion;
    compilerVersion: typeof TOPOLOGY_COMPILER_VERSION;
    compiledTopologySnapshotId: string;
    topologyId: string;
    sourceTopologyVersion: string;
    sourceTopologyHash: string;
    compiledAt: EnterpriseTimestamp;
    validation: {
        issueCount: number;
        warningCount: number;
        infoCount: number;
    };
    nodeIndex: Record<string, CompiledNode>;
    teamIndex: Record<string, CompiledTeam>;
    orgUnitIndex: Record<string, CompiledOrgUnit>;
    positionIndex: Record<string, CompiledPosition>;
    personIndex: Record<string, CompiledPerson>;
    toolIndex: Record<string, CompiledTool>;
    systemIndex: Record<string, CompiledSystem>;
    processIndex: Record<string, CompiledProcess>;
    authorityIndex: Record<string, CompiledAuthorityRule>;
    parentChildTree: CompiledDelegationTree;
    delegationScopeMap: Record<string, CompiledDelegationScope>;
    authorityScopeIndex: Record<string, CompiledAuthorityScope>;
    toolScopeIndex: Record<string, CompiledToolScope>;
    processFlowIndex: Record<string, CompiledProcessFlow>;
    responsibilityIndex: CompiledResponsibilityIndex;
    runtimeExecutionContext: CompiledRuntimeExecutionContext;
}
export interface CompiledNode {
    id: string;
    name: string;
    displayName?: string;
    nodeType: NodeContract["nodeType"];
    owner?: NodeContract["owner"];
    parentNodeIds: string[];
    childNodeIds: string[];
    allowedToolIds: string[];
    allowedSystemIds: string[];
    failurePolicy?: NodeContract["failurePolicy"];
    recoveryPolicy?: NodeContract["recoveryPolicy"];
    tags: string[];
}
export interface CompiledTeam {
    id: string;
    name: string;
    nodeIds: string[];
    tags: string[];
}
export interface CompiledOrgUnit {
    id: string;
    name: string;
    parentOrgUnitId?: string;
    positionIds: string[];
    personIds: string[];
}
export interface CompiledPosition {
    id: string;
    name: string;
    orgUnitId: string;
    reportsToPositionId?: string;
    personIds: string[];
    approvalLimit?: number;
}
export interface CompiledPerson {
    id: string;
    name: string;
    positionIds: string[];
    orgUnitIds: string[];
    availability?: "available" | "limited" | "unavailable" | "unknown";
}
export interface CompiledTool {
    id: string;
    name: string;
    toolType: "read_only" | "write" | "external_action" | "analysis" | "unknown";
    systemId?: string;
}
export interface CompiledSystem {
    id: string;
    name: string;
    systemType: "internal" | "external" | "data_store" | "communication" | "automation" | "unknown";
    dataDomainIds: string[];
    criticality: "low" | "medium" | "high" | "critical" | "unknown";
}
export interface CompiledProcess {
    id: string;
    name: string;
    ownerNodeId?: string;
    stepNodeIds: string[];
    accountablePositionId?: string;
    slaMs?: number;
}
export interface CompiledAuthorityRule {
    id: string;
    name: string;
    subject: AuthorityRule["subject"];
    action: string;
    object: AuthorityRule["object"];
    condition?: AuthorityRule["condition"];
    delegable: boolean;
    requiresAuditLog: boolean;
}
export interface CompiledDelegationTree {
    rootNodeIds: string[];
    rootChildNodeIds: string[];
    entryNodeId: string | null;
    exitNodeIds: string[];
    edges: Record<string, string[]>;
    parents: Record<string, string[]>;
    incomingEdgeCountByNodeId: Record<string, number>;
}
export interface CompiledDelegationScope {
    nodeId: string;
    directChildNodeIds: string[];
    descendantNodeIds: string[];
    maxDepth: number;
}
export interface CompiledAuthorityScope {
    target: EnterpriseEntityRef;
    authorityRuleIds: string[];
    approvalRelationIds: string[];
    approverRefs: EnterpriseEntityRef[];
}
export interface CompiledToolScope {
    nodeId: string;
    allowedToolIds: string[];
    declaredToolIds: string[];
    effectiveToolIds: string[];
    allowedSystemIds: string[];
    declaredSystemIds: string[];
    backingSystemIds: string[];
    effectiveSystemIds: string[];
    declaredDataDomainIds: string[];
    effectiveDataDomainIds: string[];
    toolRelationIds: string[];
    systemRelationIds: string[];
}
export interface CompiledProcessFlow {
    processId: string;
    ownerNodeId?: string;
    stepNodeIds: string[];
    accountablePositionId?: string;
    transitionRelationIds: string[];
}
export interface CompiledResponsibilityScope {
    scope: EnterpriseEntityRef;
    responsibilityEntryIds: string[];
    responsibleRefs: EnterpriseEntityRef[];
    accountableRefs: EnterpriseEntityRef[];
    consultedRefs: EnterpriseEntityRef[];
    informedRefs: EnterpriseEntityRef[];
}
export interface CompiledResponsibilityIndex {
    byScopeKey: Record<string, CompiledResponsibilityScope>;
    byResponsibleKey: Record<string, string[]>;
}
export interface CompiledRuntimeExecutionContext {
    topologyId: string;
    entryNodeId: string | null;
    rootChildNodeIds: string[];
    exitNodeIds: string[];
    nodeCount: number;
    delegationEdgeCount: number;
}
export type CompileTopologyResult = {
    ok: true;
    snapshot: CompiledTopologySnapshot;
    validation: TopologyValidationResult;
} | {
    ok: false;
    validation: TopologyValidationResult;
    issues: TopologyValidatorIssue[];
};
export declare function compileTopology(topology: EnterpriseTopology, options?: CompileTopologyOptions): CompileTopologyResult;
export declare function compileTopologyOrThrow(topology: EnterpriseTopology, options?: CompileTopologyOptions): CompiledTopologySnapshot;
export declare class TopologyCompileError extends Error {
    readonly issues: TopologyValidatorIssue[];
    readonly validation: TopologyValidationResult;
    constructor(issues: TopologyValidatorIssue[], validation: TopologyValidationResult);
}
export declare function getCompiledEntryNode(snapshot: CompiledTopologySnapshot): CompiledNode | undefined;
export declare function getCompiledChildCandidates(snapshot: CompiledTopologySnapshot, nodeId: string): CompiledNode[];
export declare function buildCompiledEntityRefKey(reference: EnterpriseEntityRef): string;
export declare function normalizeSourceTopologyVersion(topology: EnterpriseTopology, sourceTopologyVersion?: number | string): string;
export declare function computeTopologySourceHash(topology: EnterpriseTopology): string;
export declare function buildCompiledTopologySnapshotId(topologyId: string, sourceTopologyVersion: string, sourceTopologyHash: string): string;
//# sourceMappingURL=compiler.d.ts.map