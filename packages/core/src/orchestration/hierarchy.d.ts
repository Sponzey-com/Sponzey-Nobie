import { type AgentConfig, type AgentRelationship, type AgentStatus, type RelationshipGraphEdge, type RelationshipGraphNode } from "../contracts/sub-agent-orchestration.js";
import { type RegistryServiceDependencies } from "./registry.js";
export type HierarchyDiagnosticSeverity = "info" | "warning" | "blocked";
export interface AgentHierarchyDiagnostic {
    reasonCode: string;
    severity: HierarchyDiagnosticSeverity;
    message: string;
    edgeId?: string;
    parentAgentId?: string;
    childAgentId?: string;
    limit?: number;
    value?: number;
    path?: string;
}
export interface AgentHierarchyValidationResult {
    ok: boolean;
    relationship?: AgentRelationship;
    diagnostics: AgentHierarchyDiagnostic[];
}
export interface AgentHierarchyAgentSummary {
    agentId: string;
    agentType: AgentConfig["agentType"];
    displayName: string;
    nickname?: string;
    status: AgentStatus;
    source: "db" | "config" | "synthetic";
}
export interface DirectChildProjection {
    relationship: AgentRelationship;
    agent?: AgentHierarchyAgentSummary;
    isExecutionCandidate: boolean;
    blockedReason?: string;
}
export interface AgentTreeLayoutPreference {
    schemaVersion: number;
    layout: string;
    nodes: Record<string, {
        x: number;
        y: number;
        collapsed?: boolean;
    }>;
    viewport?: {
        x: number;
        y: number;
        zoom: number;
    };
    updatedAt: number | null;
}
export interface AgentTreeProjection {
    rootAgentId: string;
    generatedAt: number;
    nodes: RelationshipGraphNode[];
    edges: RelationshipGraphEdge[];
    topLevelSubAgents: AgentHierarchyAgentSummary[];
    topLevelFallbackActive: boolean;
    executionCandidateAgentIds: string[];
    diagnostics: AgentHierarchyDiagnostic[];
}
export interface AgentHierarchyServiceDependencies extends RegistryServiceDependencies {
    rootAgentId?: string;
    maxDepth?: number;
    maxChildCount?: number;
    layoutPath?: string;
}
export declare function createAgentHierarchyService(dependencies?: AgentHierarchyServiceDependencies): {
    rootAgentId: string;
    maxDepth: number;
    maxChildCount: number;
    list: () => AgentRelationship[];
    get(edgeId: string): AgentRelationship | undefined;
    validate: (input: unknown) => AgentHierarchyValidationResult;
    create: (input: unknown, options?: {
        auditId?: string | null;
    }) => AgentHierarchyValidationResult;
    disable: (edgeId: string, options?: {
        auditId?: string | null;
    }) => AgentRelationship | undefined;
    directChildren: (parentAgentId: string) => DirectChildProjection[];
    ancestors: (agentId: string) => AgentHierarchyAgentSummary[];
    descendants: (agentId: string) => AgentHierarchyAgentSummary[];
    topLevelSubAgents: () => {
        agents: AgentHierarchyAgentSummary[];
        fallbackActive: boolean;
        diagnostics: AgentHierarchyDiagnostic[];
    };
    buildProjection: () => AgentTreeProjection;
    readLayout: () => AgentTreeLayoutPreference;
    writeLayout: (input: unknown) => AgentTreeLayoutPreference;
};
//# sourceMappingURL=hierarchy.d.ts.map