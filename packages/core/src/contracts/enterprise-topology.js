export const ENTERPRISE_TOPOLOGY_SCHEMA_VERSION = 1;
export const ENTERPRISE_NODE_TYPES = [
    "function",
    "process_step",
    "approval_node",
    "review_node",
    "decision_node",
    "automation_node",
    "data_owner_node",
    "external_node",
    "system_interface_node",
];
export const ENTERPRISE_RELATION_TYPES = [
    "reports_to",
    "belongs_to",
    "delegates_to",
    "approves",
    "owns",
    "collaborates_with",
    "escalates_to",
    "informs",
    "uses_system",
    "uses_tool",
    "has_access_to",
    "depends_on",
    "consults",
    "accountable_for",
];
const ENTITY_STATUSES = new Set(["draft", "active", "inactive", "archived"]);
const NODE_TYPES = new Set(ENTERPRISE_NODE_TYPES);
const RELATION_TYPES = new Set(ENTERPRISE_RELATION_TYPES);
const FAILURE_ISSUE_KINDS = new Set([
    "success_criteria_unmet",
    "runtime_risk",
    "execution_incomplete",
    "permission_or_tool_blocked",
    "unknown",
]);
const FAILURE_RECOVERY_ACTION_KINDS = new Set([
    "retry",
    "delegate_to_next_executor",
    "add_tool_permission",
    "add_fallback_path",
    "pass_partial_result",
    "return_to_parent",
    "review_trace",
    "none",
]);
const FAILURE_NEXT_ACTION_KINDS = new Set([
    "add_permission",
    "pass_partial",
    "add_fallback",
    "revise_description",
    "review_trace",
    "user_review",
]);
const FIXED_ROLE_CATALOG_KEYS = new Set([
    "fixedRoleAgentCatalog",
    "roleAgentCatalog",
    "requiredRoleAgents",
    "plannerAgentId",
    "researcherAgentId",
    "validatorAgentId",
]);
const TEAM_EXECUTION_KEYS = new Set([
    "children",
    "delegationPolicy",
    "executionPolicy",
    "runtimeProfile",
    "workOrderPolicy",
    "permissionScope",
    "authorityScope",
    "ownerAgentId",
    "leadAgentId",
]);
const TEAM_ORG_UNIT_MIXED_KEYS = new Set([
    "orgUnitId",
    "parentOrgUnitId",
    "positionIds",
    "budget",
    "kpiIds",
    "responsibilityArea",
]);
const ORG_UNIT_TEAM_MIXED_KEYS = new Set(["nodeIds", "leadNodeId", "memberNodeIds", "requiredTeamRoles"]);
function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function addIssue(issues, path, code, message, details = {}) {
    issues.push({
        path,
        code,
        reasonCode: code,
        message,
        ...(details.entityId ? { entityId: details.entityId } : {}),
        ...(details.relationId ? { relationId: details.relationId } : {}),
    });
}
function hasKey(record, key) {
    return Object.prototype.hasOwnProperty.call(record, key);
}
function validateRequiredString(record, key, path, issues) {
    if (typeof record[key] === "string" && record[key].trim().length > 0)
        return true;
    addIssue(issues, `${path}.${key}`, "missing_required_field", `${key} must be a non-empty string.`);
    return false;
}
function validateTimestamp(record, key, path, issues) {
    const value = record[key];
    if ((typeof value === "number" && Number.isFinite(value)) || (typeof value === "string" && value.trim()))
        return;
    addIssue(issues, `${path}.${key}`, "missing_required_field", `${key} must be a timestamp.`);
}
function validateSchemaVersion(record, path, issues) {
    if (record.schemaVersion === ENTERPRISE_TOPOLOGY_SCHEMA_VERSION)
        return;
    addIssue(issues, `${path}.schemaVersion`, "unsupported_enterprise_topology_schema_version", "Unsupported enterprise topology schema version.");
}
function validateBaseEntity(record, expectedType, path, issues) {
    validateSchemaVersion(record, path, issues);
    if (record.entityType !== expectedType) {
        addIssue(issues, `${path}.entityType`, "invalid_entity_type", `Expected entityType ${expectedType}.`);
    }
    validateRequiredString(record, "id", path, issues);
    validateRequiredString(record, "name", path, issues);
    if (typeof record.status !== "string" || !ENTITY_STATUSES.has(record.status)) {
        addIssue(issues, `${path}.status`, "invalid_entity_status", "Unsupported enterprise entity status.");
    }
    validateTimestamp(record, "createdAt", path, issues);
    validateTimestamp(record, "updatedAt", path, issues);
}
function addForbiddenKeyIssues(record, keys, path, code, message, issues) {
    for (const key of keys) {
        if (hasKey(record, key))
            addIssue(issues, `${path}.${key}`, code, message);
    }
}
function validateStringArray(value, path, issues) {
    if (Array.isArray(value) && value.every((item) => typeof item === "string"))
        return;
    addIssue(issues, path, "enterprise_contract_validation_failed", "Expected a string array.");
}
function validateRequiredBoolean(record, key, path, issues) {
    if (typeof record[key] === "boolean")
        return;
    addIssue(issues, `${path}.${key}`, "missing_required_field", `${key} must be a boolean.`);
}
function validateOptionalEnumString(record, key, values, path, issues) {
    if (!hasKey(record, key) || record[key] === undefined)
        return;
    if (typeof record[key] === "string" && values.has(record[key]))
        return;
    addIssue(issues, `${path}.${key}`, "enterprise_contract_validation_failed", `${key} has an unsupported value.`);
}
function validateRequiredNumber(record, key, path, issues) {
    if (typeof record[key] === "number" && Number.isFinite(record[key]))
        return;
    addIssue(issues, `${path}.${key}`, "missing_required_field", `${key} must be a number.`);
}
function validateRequiredRecord(value, path, issues, code = "missing_required_field") {
    if (isRecord(value))
        return true;
    addIssue(issues, path, code, `${path} must be an object.`);
    return false;
}
function validateEntityRef(value, path, issues) {
    if (!isRecord(value)) {
        addIssue(issues, path, "enterprise_contract_validation_failed", "Expected an entity reference.");
        return false;
    }
    validateRequiredString(value, "entityType", path, issues);
    validateRequiredString(value, "id", path, issues);
    return typeof value.entityType === "string" && typeof value.id === "string";
}
function validateFailurePolicyContract(value, path, issues) {
    if (!validateRequiredRecord(value, path, issues, "enterprise_contract_validation_failed"))
        return;
    validateRequiredBoolean(value, "failureReportRequired", path, issues);
    validateRequiredBoolean(value, "allowPartialSuccess", path, issues);
    validateStringArray(value.fallbackNodeIds, `${path}.fallbackNodeIds`, issues);
}
function validateRecoveryPolicyContract(value, path, issues) {
    if (!validateRequiredRecord(value, path, issues, "enterprise_contract_validation_failed"))
        return;
    validateRequiredBoolean(value, "retryAllowed", path, issues);
    validateRequiredBoolean(value, "redelegationAllowed", path, issues);
    validateRequiredBoolean(value, "fallbackAllowed", path, issues);
    validateRequiredBoolean(value, "partialSuccessAllowed", path, issues);
}
export function validateNodeContract(value) {
    const issues = [];
    if (!isRecord(value)) {
        return {
            ok: false,
            issues: [{
                    path: "$",
                    code: "enterprise_contract_validation_failed",
                    reasonCode: "enterprise_contract_validation_failed",
                    message: "Node contract must be an object.",
                }],
        };
    }
    validateBaseEntity(value, "node", "$", issues);
    if (typeof value.nodeType !== "string" || !NODE_TYPES.has(value.nodeType)) {
        addIssue(issues, "$.nodeType", "invalid_node_type", "Unsupported node type.");
    }
    validateStringArray(value.tags, "$.tags", issues);
    validateStringArray(value.children, "$.children", issues);
    validateStringArray(value.allowedToolIds, "$.allowedToolIds", issues);
    validateStringArray(value.allowedSystemIds, "$.allowedSystemIds", issues);
    if (value.failurePolicy !== undefined)
        validateFailurePolicyContract(value.failurePolicy, "$.failurePolicy", issues);
    if (value.recoveryPolicy !== undefined)
        validateRecoveryPolicyContract(value.recoveryPolicy, "$.recoveryPolicy", issues);
    if (value.owner != null && validateEntityRef(value.owner, "$.owner", issues)) {
        const allowedOwners = new Set(["position", "org_unit", "person", "enterprise_system"]);
        if (!allowedOwners.has(value.owner.entityType)) {
            addIssue(issues, "$.owner.entityType", "invalid_node_owner", "Node owner must reference Position, OrgUnit, Person, or System.");
        }
    }
    if (isRecord(value.template) && value.template.fixedRoleCatalog !== undefined && value.template.fixedRoleCatalog !== false) {
        addIssue(issues, "$.template.fixedRoleCatalog", "fixed_role_catalog_forbidden", "Node templates cannot require a fixed role agent catalog.");
    }
    addForbiddenKeyIssues(value, FIXED_ROLE_CATALOG_KEYS, "$", "fixed_role_catalog_forbidden", "Fixed role agent catalogs are not part of the enterprise topology source model.", issues);
    return issues.length === 0 ? { ok: true, value: value, issues: [] } : { ok: false, issues };
}
export function validateEnterpriseTeam(value) {
    const issues = [];
    if (!isRecord(value)) {
        return {
            ok: false,
            issues: [{
                    path: "$",
                    code: "enterprise_contract_validation_failed",
                    reasonCode: "enterprise_contract_validation_failed",
                    message: "Team must be an object.",
                }],
        };
    }
    validateBaseEntity(value, "team", "$", issues);
    validateStringArray(value.nodeIds, "$.nodeIds", issues);
    validateStringArray(value.tags, "$.tags", issues);
    addForbiddenKeyIssues(value, TEAM_EXECUTION_KEYS, "$", "team_execution_semantics_forbidden", "Team is a logical group and cannot define execution semantics.", issues);
    addForbiddenKeyIssues(value, TEAM_ORG_UNIT_MIXED_KEYS, "$", "team_org_unit_mixed", "Team and OrgUnit fields must not be mixed.", issues);
    return issues.length === 0 ? { ok: true, value: value, issues: [] } : { ok: false, issues };
}
export function validateEnterpriseOrgUnit(value) {
    const issues = [];
    if (!isRecord(value)) {
        return {
            ok: false,
            issues: [{
                    path: "$",
                    code: "enterprise_contract_validation_failed",
                    reasonCode: "enterprise_contract_validation_failed",
                    message: "OrgUnit must be an object.",
                }],
        };
    }
    validateBaseEntity(value, "org_unit", "$", issues);
    validateStringArray(value.positionIds, "$.positionIds", issues);
    validateStringArray(value.personIds, "$.personIds", issues);
    validateStringArray(value.kpiIds, "$.kpiIds", issues);
    addForbiddenKeyIssues(value, ORG_UNIT_TEAM_MIXED_KEYS, "$", "team_org_unit_mixed", "OrgUnit and Team fields must not be mixed.", issues);
    return issues.length === 0 ? { ok: true, value: value, issues: [] } : { ok: false, issues };
}
function endpointAllowed(relationType, from, to) {
    switch (relationType) {
        case "delegates_to":
            return from === "node" && to === "node";
        case "reports_to":
            return (from === "position" && to === "position") || (from === "person" && to === "person");
        case "belongs_to":
            return ((from === "node" && to === "team") ||
                (from === "position" && to === "org_unit") ||
                (from === "person" && to === "org_unit") ||
                (from === "team" && to === "org_unit"));
        case "approves":
            return ["position", "person", "org_unit"].includes(from) && ["node", "process_definition", "enterprise_system", "enterprise_tool"].includes(to);
        case "owns":
            return ["position", "person", "org_unit", "node"].includes(from) && ["node", "process_definition", "enterprise_system", "enterprise_tool"].includes(to);
        case "uses_system":
            return ["node", "process_definition"].includes(from) && to === "enterprise_system";
        case "uses_tool":
            return from === "node" && to === "enterprise_tool";
        case "has_access_to":
            return ["node", "position", "person", "org_unit"].includes(from) && ["enterprise_system", "enterprise_tool"].includes(to);
        case "accountable_for":
            return ["position", "person", "org_unit", "node"].includes(from) && ["node", "process_definition"].includes(to);
        case "collaborates_with":
        case "informs":
            return ["node", "team", "org_unit", "position", "person"].includes(from) && ["node", "team", "org_unit", "position", "person"].includes(to);
        case "escalates_to":
        case "consults":
            return ["node", "position", "person"].includes(from) && ["node", "position", "person"].includes(to);
        case "depends_on":
            return ["node", "process_definition", "enterprise_system", "enterprise_tool"].includes(from) && ["node", "process_definition", "enterprise_system", "enterprise_tool"].includes(to);
    }
}
export function validateEnterpriseRelation(value) {
    const issues = [];
    if (!isRecord(value)) {
        return {
            ok: false,
            issues: [{
                    path: "$",
                    code: "enterprise_contract_validation_failed",
                    reasonCode: "enterprise_contract_validation_failed",
                    message: "Enterprise relation must be an object.",
                }],
        };
    }
    validateBaseEntity(value, "relation", "$", issues);
    const relationDetails = typeof value.id === "string" ? { relationId: value.id } : {};
    if (typeof value.relationType !== "string" || !RELATION_TYPES.has(value.relationType)) {
        addIssue(issues, "$.relationType", "invalid_relation_type", "Unsupported enterprise relation type.", relationDetails);
    }
    const from = value.from;
    const to = value.to;
    const fromOk = validateEntityRef(from, "$.from", issues);
    const toOk = validateEntityRef(to, "$.to", issues);
    if (fromOk && toOk && typeof value.relationType === "string" && RELATION_TYPES.has(value.relationType)) {
        if (!endpointAllowed(value.relationType, from.entityType, to.entityType)) {
            addIssue(issues, "$.to.entityType", "invalid_relation_endpoint", "Relation source and target entity types are not compatible.", {
                ...relationDetails,
            });
        }
    }
    return issues.length === 0 ? { ok: true, value: value, issues: [] } : { ok: false, issues };
}
function validateEntityArray(value, path, issues, validateItem) {
    if (!Array.isArray(value)) {
        addIssue(issues, path, "missing_required_field", `${path} must be an array.`);
        return;
    }
    value.forEach((item, index) => {
        const result = validateItem(item);
        if (!result.ok) {
            issues.push(...result.issues.map((issue) => ({ ...issue, path: `${path}[${index}]${issue.path.slice(1)}` })));
        }
    });
}
function validateBaseOnlyArray(value, path, entityType, issues, extra) {
    if (!Array.isArray(value)) {
        addIssue(issues, path, "missing_required_field", `${path} must be an array.`);
        return;
    }
    value.forEach((item, index) => {
        const itemPath = `${path}[${index}]`;
        if (!isRecord(item)) {
            addIssue(issues, itemPath, "enterprise_contract_validation_failed", `${entityType} must be an object.`);
            return;
        }
        validateBaseEntity(item, entityType, itemPath, issues);
        extra?.(item, itemPath);
    });
}
export function validateEnterpriseTopology(value) {
    const issues = [];
    if (!isRecord(value)) {
        return {
            ok: false,
            issues: [{
                    path: "$",
                    code: "enterprise_contract_validation_failed",
                    reasonCode: "enterprise_contract_validation_failed",
                    message: "Enterprise topology must be an object.",
                }],
        };
    }
    validateBaseEntity(value, "topology", "$", issues);
    addForbiddenKeyIssues(value, FIXED_ROLE_CATALOG_KEYS, "$", "fixed_role_catalog_forbidden", "Fixed role agent catalogs are not part of the enterprise topology source model.", issues);
    validateEntityArray(value.nodes, "$.nodes", issues, validateNodeContract);
    validateEntityArray(value.teams, "$.teams", issues, validateEnterpriseTeam);
    validateEntityArray(value.orgUnits, "$.orgUnits", issues, validateEnterpriseOrgUnit);
    validateBaseOnlyArray(value.positions, "$.positions", "position", issues, (record, path) => {
        validateRequiredString(record, "orgUnitId", path, issues);
        validateStringArray(record.personIds, `${path}.personIds`, issues);
        validateStringArray(record.responsibilityIds, `${path}.responsibilityIds`, issues);
    });
    validateBaseOnlyArray(value.persons, "$.persons", "person", issues, (record, path) => {
        validateStringArray(record.positionIds, `${path}.positionIds`, issues);
        validateStringArray(record.orgUnitIds, `${path}.orgUnitIds`, issues);
    });
    validateBaseOnlyArray(value.memberships, "$.memberships", "membership", issues, (record, path) => {
        validateRequiredString(record, "personId", path, issues);
    });
    validateBaseOnlyArray(value.authorityRules, "$.authorityRules", "authority_rule", issues);
    validateBaseOnlyArray(value.responsibilities, "$.responsibilities", "responsibility_matrix_entry", issues);
    validateBaseOnlyArray(value.systems, "$.systems", "enterprise_system", issues);
    validateBaseOnlyArray(value.tools, "$.tools", "enterprise_tool", issues);
    validateBaseOnlyArray(value.processes, "$.processes", "process_definition", issues);
    validateEntityArray(value.relations, "$.relations", issues, validateEnterpriseRelation);
    return issues.length === 0 ? { ok: true, value: value, issues: [] } : { ok: false, issues };
}
function validatePermissionScope(value, path, issues) {
    if (!validateRequiredRecord(value, path, issues))
        return;
    validateStringArray(value.allowedToolIds, `${path}.allowedToolIds`, issues);
    validateStringArray(value.allowedSystemIds, `${path}.allowedSystemIds`, issues);
    validateStringArray(value.dataDomainIds, `${path}.dataDomainIds`, issues);
}
function validateAuthorityScope(value, path, issues) {
    if (!validateRequiredRecord(value, path, issues))
        return;
    validateStringArray(value.requiredAuthorityRuleIds, `${path}.requiredAuthorityRuleIds`, issues);
    validateRequiredBoolean(value, "approvalRequired", path, issues);
}
function validateWorkOrderTarget(value, path, issues) {
    if (!validateRequiredRecord(value, path, issues))
        return;
    validateRequiredString(value, "type", path, issues);
    validateRequiredString(value, "id", path, issues);
}
function validateSuccessCriteria(value, path, issues) {
    if (!Array.isArray(value) || value.length === 0) {
        addIssue(issues, path, "missing_success_criteria", "WorkOrder must define at least one success criterion.");
        return;
    }
    value.forEach((item, index) => {
        const itemPath = `${path}[${index}]`;
        if (!validateRequiredRecord(item, itemPath, issues))
            return;
        validateRequiredString(item, "criterionId", itemPath, issues);
        validateRequiredString(item, "description", itemPath, issues);
        validateRequiredBoolean(item, "required", itemPath, issues);
        validateRequiredString(item, "validationKind", itemPath, issues);
    });
}
export function validateWorkOrder(value) {
    const issues = [];
    if (!isRecord(value)) {
        return {
            ok: false,
            issues: [{
                    path: "$",
                    code: "enterprise_contract_validation_failed",
                    reasonCode: "enterprise_contract_validation_failed",
                    message: "WorkOrder must be an object.",
                }],
        };
    }
    validateSchemaVersion(value, "$", issues);
    validateRequiredString(value, "workOrderId", "$", issues);
    validateRequiredString(value, "topologyRunId", "$", issues);
    validateRequiredString(value, "fromNodeId", "$", issues);
    validateWorkOrderTarget(value.to, "$.to", issues);
    validateRequiredString(value, "objective", "$", issues);
    if (validateRequiredRecord(value.scope, "$.scope", issues)) {
        validateStringArray(value.scope.included, "$.scope.included", issues);
        validateStringArray(value.scope.excluded, "$.scope.excluded", issues);
    }
    validateRequiredRecord(value.input, "$.input", issues);
    validateRequiredRecord(value.expectedOutputSchema, "$.expectedOutputSchema", issues);
    validateSuccessCriteria(value.successCriteria, "$.successCriteria", issues);
    validatePermissionScope(value.permissionScope, "$.permissionScope", issues);
    validateAuthorityScope(value.authorityScope, "$.authorityScope", issues);
    validateRequiredBoolean(value, "failureReportRequired", "$", issues);
    validateStringArray(value.delegationPath, "$.delegationPath", issues);
    validateTimestamp(value, "createdAt", "$", issues);
    return issues.length === 0 ? { ok: true, value: value, issues: [] } : { ok: false, issues };
}
export function validateNodeResultReport(value) {
    const issues = [];
    if (!isRecord(value)) {
        return {
            ok: false,
            issues: [{
                    path: "$",
                    code: "enterprise_contract_validation_failed",
                    reasonCode: "enterprise_contract_validation_failed",
                    message: "NodeResultReport must be an object.",
                }],
        };
    }
    validateSchemaVersion(value, "$", issues);
    validateRequiredString(value, "resultReportId", "$", issues);
    validateRequiredString(value, "topologyRunId", "$", issues);
    validateRequiredString(value, "nodeRunId", "$", issues);
    validateRequiredString(value, "workOrderId", "$", issues);
    validateRequiredString(value, "nodeId", "$", issues);
    const allowedStatuses = new Set([
        "completed",
        "partial_success",
        "failed_candidate",
        "permission_limited",
        "needs_revision",
        "failed",
    ]);
    if (typeof value.status !== "string" || !allowedStatuses.has(value.status)) {
        addIssue(issues, "$.status", "invalid_runtime_state", "Unsupported node result status.");
    }
    if (value.status === "failed" && (typeof value.failureReportId !== "string" || !value.failureReportId.trim())) {
        addIssue(issues, "$.failureReportId", "final_failure_without_failure_report", "Final failed reports require a FailureReport id.");
    }
    if (!Array.isArray(value.outputs)) {
        addIssue(issues, "$.outputs", "missing_required_field", "outputs must be an array.");
    }
    validateStringArray(value.unmetSuccessCriteriaIds, "$.unmetSuccessCriteriaIds", issues);
    validateStringArray(value.risksOrGaps, "$.risksOrGaps", issues);
    validateTimestamp(value, "createdAt", "$", issues);
    return issues.length === 0 ? { ok: true, value: value, issues: [] } : { ok: false, issues };
}
function validateExhaustionSummary(value, path, issues) {
    if (!validateRequiredRecord(value, path, issues, "missing_exhaustion_summary"))
        return;
    validateRequiredBoolean(value, "selfExecutionAttempted", path, issues);
    validateRequiredBoolean(value, "childDelegationAttempted", path, issues);
    validateRequiredBoolean(value, "toolExecutionAttempted", path, issues);
    validateRequiredBoolean(value, "retryAttempted", path, issues);
    validateRequiredBoolean(value, "fallbackAttempted", path, issues);
    validateRequiredBoolean(value, "partialSuccessChecked", path, issues);
    validateRequiredBoolean(value, "parentRecoveryPossibleChecked", path, issues);
    validateRequiredBoolean(value, "successCriteriaStillNotMet", path, issues);
    validateRequiredBoolean(value, "complete", path, issues);
}
export function validateFailureReport(value) {
    const issues = [];
    if (!isRecord(value)) {
        return {
            ok: false,
            issues: [{
                    path: "$",
                    code: "enterprise_contract_validation_failed",
                    reasonCode: "enterprise_contract_validation_failed",
                    message: "FailureReport must be an object.",
                }],
        };
    }
    validateSchemaVersion(value, "$", issues);
    validateRequiredString(value, "failureReportId", "$", issues);
    validateRequiredString(value, "topologyRunId", "$", issues);
    validateRequiredString(value, "nodeRunId", "$", issues);
    validateRequiredString(value, "workOrderId", "$", issues);
    validateRequiredString(value, "nodeId", "$", issues);
    validateExhaustionSummary(value.exhaustionSummary, "$.exhaustionSummary", issues);
    if (!Array.isArray(value.attempts)) {
        addIssue(issues, "$.attempts", "missing_required_field", "attempts must be an array.");
    }
    validateStringArray(value.untriedOptions, "$.untriedOptions", issues);
    validateOptionalEnumString(value, "issueKind", FAILURE_ISSUE_KINDS, "$", issues);
    validateOptionalEnumString(value, "recoveryActionKind", FAILURE_RECOVERY_ACTION_KINDS, "$", issues);
    validateOptionalEnumString(value, "nextActionKind", FAILURE_NEXT_ACTION_KINDS, "$", issues);
    validateRequiredString(value, "recommendedAction", "$", issues);
    validateTimestamp(value, "createdAt", "$", issues);
    return issues.length === 0 ? { ok: true, value: value, issues: [] } : { ok: false, issues };
}
export function validateTraceEvent(value) {
    const issues = [];
    if (!isRecord(value)) {
        return {
            ok: false,
            issues: [{
                    path: "$",
                    code: "enterprise_contract_validation_failed",
                    reasonCode: "enterprise_contract_validation_failed",
                    message: "TraceEvent must be an object.",
                }],
        };
    }
    validateSchemaVersion(value, "$", issues);
    validateRequiredString(value, "traceEventId", "$", issues);
    validateRequiredString(value, "topologyRunId", "$", issues);
    validateRequiredString(value, "nodeRunId", "$", issues);
    validateRequiredString(value, "workOrderId", "$", issues);
    validateStringArray(value.delegationPath, "$.delegationPath", issues);
    validateRequiredString(value, "phase", "$", issues);
    validateRequiredString(value, "component", "$", issues);
    validateTimestamp(value, "at", "$", issues);
    validateRequiredString(value, "reasonCode", "$", issues);
    const linkageFields = ["topologyRunId", "nodeRunId", "workOrderId", "delegationPath"];
    for (const field of linkageFields) {
        const missingArray = field === "delegationPath" && !Array.isArray(value[field]);
        const missingString = field !== "delegationPath" && (typeof value[field] !== "string" || !value[field].trim());
        if (missingArray || missingString) {
            addIssue(issues, `$.${field}`, "missing_trace_linkage", "TraceEvent must include topology, node, work order, and path linkage.");
        }
    }
    return issues.length === 0 ? { ok: true, value: value, issues: [] } : { ok: false, issues };
}
//# sourceMappingURL=enterprise-topology.js.map
