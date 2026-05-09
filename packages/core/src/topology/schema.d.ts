import type { EnterpriseEntityType, EnterpriseRelationType } from "../contracts/enterprise-topology.js";
export declare const DEFAULT_TOPOLOGY_MAX_DELEGATION_DEPTH = 8;
export declare const TOPOLOGY_VALIDATOR_BLOCKING_SEVERITIES: readonly ["blocked", "invalid"];
export interface EnterpriseRelationEndpointPair {
    from: EnterpriseEntityType;
    to: EnterpriseEntityType;
}
export interface EnterpriseRelationEndpointRule {
    relationType: EnterpriseRelationType;
    from: readonly EnterpriseEntityType[];
    to: readonly EnterpriseEntityType[];
    allowedPairs: readonly EnterpriseRelationEndpointPair[];
    description: string;
}
export declare const TOPOLOGY_RELATION_ENDPOINT_RULES: {
    readonly reports_to: {
        readonly relationType: "reports_to";
        readonly from: readonly ["position", "person"];
        readonly to: readonly ["position", "person"];
        readonly allowedPairs: readonly EnterpriseRelationEndpointPair[];
        readonly description: "Position-to-position or person-to-person reporting only.";
    };
    readonly belongs_to: {
        readonly relationType: "belongs_to";
        readonly from: readonly ["node", "position", "person", "team"];
        readonly to: readonly ["team", "org_unit"];
        readonly allowedPairs: readonly EnterpriseRelationEndpointPair[];
        readonly description: "Nodes belong to Teams; positions, persons, and teams belong to OrgUnits.";
    };
    readonly delegates_to: {
        readonly relationType: "delegates_to";
        readonly from: readonly ["node"];
        readonly to: readonly ["node"];
        readonly allowedPairs: EnterpriseRelationEndpointPair[];
        readonly description: "Execution delegation is only allowed between Nodes.";
    };
    readonly approves: {
        readonly relationType: "approves";
        readonly from: readonly ["position", "person", "org_unit"];
        readonly to: readonly ["node", "process_definition", "enterprise_system", "enterprise_tool"];
        readonly allowedPairs: EnterpriseRelationEndpointPair[];
        readonly description: "Authority holders approve executable work targets.";
    };
    readonly owns: {
        readonly relationType: "owns";
        readonly from: readonly ["position", "person", "org_unit", "node"];
        readonly to: readonly ["node", "process_definition", "enterprise_system", "enterprise_tool"];
        readonly allowedPairs: EnterpriseRelationEndpointPair[];
        readonly description: "Accountable holders own executable or system targets.";
    };
    readonly collaborates_with: {
        readonly relationType: "collaborates_with";
        readonly from: readonly ["node", "team", "org_unit", "position", "person"];
        readonly to: readonly ["node", "team", "org_unit", "position", "person"];
        readonly allowedPairs: EnterpriseRelationEndpointPair[];
        readonly description: "Collaboration is limited to people, structure, teams, and nodes.";
    };
    readonly escalates_to: {
        readonly relationType: "escalates_to";
        readonly from: readonly ["node", "position", "person"];
        readonly to: readonly ["node", "position", "person"];
        readonly allowedPairs: EnterpriseRelationEndpointPair[];
        readonly description: "Escalation stays inside executable nodes or accountable people/positions.";
    };
    readonly informs: {
        readonly relationType: "informs";
        readonly from: readonly ["node", "team", "org_unit", "position", "person"];
        readonly to: readonly ["node", "team", "org_unit", "position", "person"];
        readonly allowedPairs: EnterpriseRelationEndpointPair[];
        readonly description: "Information flow is limited to people, structure, teams, and nodes.";
    };
    readonly uses_system: {
        readonly relationType: "uses_system";
        readonly from: readonly ["node", "process_definition"];
        readonly to: readonly ["enterprise_system"];
        readonly allowedPairs: EnterpriseRelationEndpointPair[];
        readonly description: "Nodes and processes may use enterprise systems.";
    };
    readonly uses_tool: {
        readonly relationType: "uses_tool";
        readonly from: readonly ["node"];
        readonly to: readonly ["enterprise_tool"];
        readonly allowedPairs: EnterpriseRelationEndpointPair[];
        readonly description: "Only executable Nodes may use enterprise tools.";
    };
    readonly has_access_to: {
        readonly relationType: "has_access_to";
        readonly from: readonly ["node", "position", "person", "org_unit"];
        readonly to: readonly ["enterprise_system", "enterprise_tool"];
        readonly allowedPairs: EnterpriseRelationEndpointPair[];
        readonly description: "Access can be granted to nodes, roles, people, or organization units.";
    };
    readonly depends_on: {
        readonly relationType: "depends_on";
        readonly from: readonly ["node", "process_definition", "enterprise_system", "enterprise_tool"];
        readonly to: readonly ["node", "process_definition", "enterprise_system", "enterprise_tool"];
        readonly allowedPairs: EnterpriseRelationEndpointPair[];
        readonly description: "Dependencies are limited to executable and technical work targets.";
    };
    readonly consults: {
        readonly relationType: "consults";
        readonly from: readonly ["node", "position", "person"];
        readonly to: readonly ["node", "position", "person"];
        readonly allowedPairs: EnterpriseRelationEndpointPair[];
        readonly description: "Consultation stays inside executable nodes or accountable people/positions.";
    };
    readonly accountable_for: {
        readonly relationType: "accountable_for";
        readonly from: readonly ["position", "person", "org_unit", "node"];
        readonly to: readonly ["node", "process_definition"];
        readonly allowedPairs: EnterpriseRelationEndpointPair[];
        readonly description: "Accountability targets executable nodes and processes.";
    };
};
export declare function isEnterpriseRelationEndpointAllowed(relationType: EnterpriseRelationType, from: EnterpriseEntityType, to: EnterpriseEntityType): boolean;
//# sourceMappingURL=schema.d.ts.map