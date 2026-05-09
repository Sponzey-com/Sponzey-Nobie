import { type EnterpriseTopology } from "../contracts/enterprise-topology.js";
import { type TopologyValidationResult } from "./validator.js";
export type AgentTeamImportMode = "team" | "skip";
export interface AgentTeamTopologyImportTransformation {
    sourceType: "AgentConfig" | "TeamConfig" | "AgentRelationship";
    sourceId: string;
    targetType: "NodeContract" | "Team" | "Relation";
    targetId: string;
    summary: string;
}
export interface AgentTeamTopologyImportPreview {
    ok: true;
    topology: EnterpriseTopology;
    validation: TopologyValidationResult;
    transformations: AgentTeamTopologyImportTransformation[];
    metadata: {
        agentCount: number;
        teamCount: number;
        relationshipCount: number;
        teamImportMode: AgentTeamImportMode;
        teamRequiresExplicitChoice: boolean;
        sourceOfTruth: "enterprise_topology_draft";
        legacySourceRole: "migration_source_only";
    };
}
export interface BuildAgentTeamTopologyImportPreviewInput {
    topologyId?: string;
    name?: string;
    teamImportMode?: AgentTeamImportMode;
    agents?: unknown[];
    teams?: unknown[];
    relationships?: unknown[];
    now?: number;
}
export declare function buildAgentTeamTopologyImportPreview(input?: BuildAgentTeamTopologyImportPreviewInput): AgentTeamTopologyImportPreview;
//# sourceMappingURL=agent-team-import.d.ts.map