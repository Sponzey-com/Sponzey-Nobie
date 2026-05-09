export const DEFAULT_TOPOLOGY_MAX_DELEGATION_DEPTH = 8;
export const TOPOLOGY_VALIDATOR_BLOCKING_SEVERITIES = ["blocked", "invalid"];
const PEOPLE_OR_STRUCTURE_ENTITIES = ["node", "team", "org_unit", "position", "person"];
const WORK_TARGET_ENTITIES = ["node", "process_definition", "enterprise_system", "enterprise_tool"];
const AUTHORITY_HOLDER_ENTITIES = ["position", "person", "org_unit"];
const ACCOUNTABLE_HOLDER_ENTITIES = ["position", "person", "org_unit", "node"];
const EXECUTION_DEPENDENCY_ENTITIES = ["node", "process_definition", "enterprise_system", "enterprise_tool"];
function includesEntityType(values, value) {
    return values.includes(value);
}
function endpointPairs(fromValues, toValues) {
    return fromValues.flatMap((from) => toValues.map((to) => ({ from, to })));
}
export const TOPOLOGY_RELATION_ENDPOINT_RULES = {
    reports_to: {
        relationType: "reports_to",
        from: ["position", "person"],
        to: ["position", "person"],
        allowedPairs: [
            ...endpointPairs(["position"], ["position"]),
            ...endpointPairs(["person"], ["person"]),
        ],
        description: "Position-to-position or person-to-person reporting only.",
    },
    belongs_to: {
        relationType: "belongs_to",
        from: ["node", "position", "person", "team"],
        to: ["team", "org_unit"],
        allowedPairs: [
            ...endpointPairs(["node"], ["team"]),
            ...endpointPairs(["position"], ["org_unit"]),
            ...endpointPairs(["person"], ["org_unit"]),
            ...endpointPairs(["team"], ["org_unit"]),
        ],
        description: "Nodes belong to Teams; positions, persons, and teams belong to OrgUnits.",
    },
    delegates_to: {
        relationType: "delegates_to",
        from: ["node"],
        to: ["node"],
        allowedPairs: endpointPairs(["node"], ["node"]),
        description: "Execution delegation is only allowed between Nodes.",
    },
    approves: {
        relationType: "approves",
        from: AUTHORITY_HOLDER_ENTITIES,
        to: WORK_TARGET_ENTITIES,
        allowedPairs: endpointPairs(AUTHORITY_HOLDER_ENTITIES, WORK_TARGET_ENTITIES),
        description: "Authority holders approve executable work targets.",
    },
    owns: {
        relationType: "owns",
        from: ACCOUNTABLE_HOLDER_ENTITIES,
        to: WORK_TARGET_ENTITIES,
        allowedPairs: endpointPairs(ACCOUNTABLE_HOLDER_ENTITIES, WORK_TARGET_ENTITIES),
        description: "Accountable holders own executable or system targets.",
    },
    collaborates_with: {
        relationType: "collaborates_with",
        from: PEOPLE_OR_STRUCTURE_ENTITIES,
        to: PEOPLE_OR_STRUCTURE_ENTITIES,
        allowedPairs: endpointPairs(PEOPLE_OR_STRUCTURE_ENTITIES, PEOPLE_OR_STRUCTURE_ENTITIES),
        description: "Collaboration is limited to people, structure, teams, and nodes.",
    },
    escalates_to: {
        relationType: "escalates_to",
        from: ["node", "position", "person"],
        to: ["node", "position", "person"],
        allowedPairs: endpointPairs(["node", "position", "person"], ["node", "position", "person"]),
        description: "Escalation stays inside executable nodes or accountable people/positions.",
    },
    informs: {
        relationType: "informs",
        from: PEOPLE_OR_STRUCTURE_ENTITIES,
        to: PEOPLE_OR_STRUCTURE_ENTITIES,
        allowedPairs: endpointPairs(PEOPLE_OR_STRUCTURE_ENTITIES, PEOPLE_OR_STRUCTURE_ENTITIES),
        description: "Information flow is limited to people, structure, teams, and nodes.",
    },
    uses_system: {
        relationType: "uses_system",
        from: ["node", "process_definition"],
        to: ["enterprise_system"],
        allowedPairs: endpointPairs(["node", "process_definition"], ["enterprise_system"]),
        description: "Nodes and processes may use enterprise systems.",
    },
    uses_tool: {
        relationType: "uses_tool",
        from: ["node"],
        to: ["enterprise_tool"],
        allowedPairs: endpointPairs(["node"], ["enterprise_tool"]),
        description: "Only executable Nodes may use enterprise tools.",
    },
    has_access_to: {
        relationType: "has_access_to",
        from: ["node", "position", "person", "org_unit"],
        to: ["enterprise_system", "enterprise_tool"],
        allowedPairs: endpointPairs(["node", "position", "person", "org_unit"], ["enterprise_system", "enterprise_tool"]),
        description: "Access can be granted to nodes, roles, people, or organization units.",
    },
    depends_on: {
        relationType: "depends_on",
        from: EXECUTION_DEPENDENCY_ENTITIES,
        to: EXECUTION_DEPENDENCY_ENTITIES,
        allowedPairs: endpointPairs(EXECUTION_DEPENDENCY_ENTITIES, EXECUTION_DEPENDENCY_ENTITIES),
        description: "Dependencies are limited to executable and technical work targets.",
    },
    consults: {
        relationType: "consults",
        from: ["node", "position", "person"],
        to: ["node", "position", "person"],
        allowedPairs: endpointPairs(["node", "position", "person"], ["node", "position", "person"]),
        description: "Consultation stays inside executable nodes or accountable people/positions.",
    },
    accountable_for: {
        relationType: "accountable_for",
        from: ACCOUNTABLE_HOLDER_ENTITIES,
        to: ["node", "process_definition"],
        allowedPairs: endpointPairs(ACCOUNTABLE_HOLDER_ENTITIES, ["node", "process_definition"]),
        description: "Accountability targets executable nodes and processes.",
    },
};
export function isEnterpriseRelationEndpointAllowed(relationType, from, to) {
    const rule = TOPOLOGY_RELATION_ENDPOINT_RULES[relationType];
    return includesEntityType(rule.from, from) && includesEntityType(rule.to, to) &&
        rule.allowedPairs.some((pair) => pair.from === from && pair.to === to);
}
//# sourceMappingURL=schema.js.map