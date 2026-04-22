import { CONTRACT_SCHEMA_VERSION, } from "./index.js";
export const SUB_AGENT_CONTRACT_SCHEMA_VERSION = CONTRACT_SCHEMA_VERSION;
function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function addIssue(issues, path, message) {
    issues.push({ path, code: "contract_validation_failed", message });
}
function hasNonEmptyString(record, key, path, issues) {
    if (typeof record[key] === "string" && record[key].trim())
        return true;
    addIssue(issues, `${path}.${key}`, `${key} must be a non-empty string.`);
    return false;
}
function hasArray(record, key, path, issues) {
    if (Array.isArray(record[key]))
        return true;
    addIssue(issues, `${path}.${key}`, `${key} must be an array.`);
    return false;
}
function validateRuntimeIdentity(value, path, issues) {
    if (!isRecord(value)) {
        addIssue(issues, path, "identity must be an object.");
        return false;
    }
    if (value.schemaVersion !== CONTRACT_SCHEMA_VERSION)
        addIssue(issues, `${path}.schemaVersion`, "Unsupported contract schema version.");
    hasNonEmptyString(value, "entityType", path, issues);
    hasNonEmptyString(value, "entityId", path, issues);
    hasNonEmptyString(value, "idempotencyKey", path, issues);
    if (!isRecord(value.owner))
        addIssue(issues, `${path}.owner`, "owner must be an object.");
    return true;
}
export function validateAgentConfig(value) {
    const issues = [];
    if (!isRecord(value)) {
        return { ok: false, issues: [{ path: "$", code: "contract_validation_failed", message: "Agent config must be an object." }] };
    }
    if (value.schemaVersion !== CONTRACT_SCHEMA_VERSION)
        addIssue(issues, "$.schemaVersion", "Unsupported contract schema version.");
    if (value.agentType !== "nobie" && value.agentType !== "sub_agent") {
        addIssue(issues, "$.agentType", "agentType must be nobie or sub_agent.");
    }
    hasNonEmptyString(value, "agentId", "$", issues);
    hasNonEmptyString(value, "displayName", "$", issues);
    hasNonEmptyString(value, "role", "$", issues);
    hasNonEmptyString(value, "personality", "$", issues);
    hasArray(value, "specialtyTags", "$", issues);
    hasArray(value, "avoidTasks", "$", issues);
    if (!isRecord(value.memoryPolicy))
        addIssue(issues, "$.memoryPolicy", "memoryPolicy must be an object.");
    if (!isRecord(value.capabilityPolicy))
        addIssue(issues, "$.capabilityPolicy", "capabilityPolicy must be an object.");
    if (value.agentType === "nobie" && !isRecord(value.coordinator))
        addIssue(issues, "$.coordinator", "nobie agent requires coordinator settings.");
    if (value.agentType === "sub_agent") {
        hasArray(value, "teamIds", "$", issues);
        if (!isRecord(value.delegation))
            addIssue(issues, "$.delegation", "sub_agent requires delegation settings.");
    }
    if (value.agentType !== "sub_agent" && ("teamIds" in value || "delegation" in value)) {
        addIssue(issues, "$.agentType", "Only sub_agent configs can include teamIds or delegation settings.");
    }
    return issues.length === 0 ? { ok: true, value: value, issues: [] } : { ok: false, issues };
}
export function validateTeamConfig(value) {
    const issues = [];
    if (!isRecord(value)) {
        return { ok: false, issues: [{ path: "$", code: "contract_validation_failed", message: "Team config must be an object." }] };
    }
    if (value.schemaVersion !== CONTRACT_SCHEMA_VERSION)
        addIssue(issues, "$.schemaVersion", "Unsupported contract schema version.");
    hasNonEmptyString(value, "teamId", "$", issues);
    hasNonEmptyString(value, "displayName", "$", issues);
    hasNonEmptyString(value, "purpose", "$", issues);
    hasArray(value, "memberAgentIds", "$", issues);
    hasArray(value, "roleHints", "$", issues);
    for (const forbidden of [
        "allowedTools",
        "allowedSkills",
        "allowedMcpServers",
        "allowed_tools",
        "allowed_skills",
        "allowed_mcp_servers",
        "skillMcpAllowlist",
        "permissionProfile",
    ]) {
        if (forbidden in value)
            addIssue(issues, `$.${forbidden}`, "Teams cannot directly own tools, skills, MCP servers, or permission profiles.");
    }
    return issues.length === 0 ? { ok: true, value: value, issues: [] } : { ok: false, issues };
}
export function validateOrchestrationPlan(value) {
    const issues = [];
    if (!isRecord(value)) {
        return { ok: false, issues: [{ path: "$", code: "contract_validation_failed", message: "OrchestrationPlan must be an object." }] };
    }
    validateRuntimeIdentity(value.identity, "$.identity", issues);
    hasNonEmptyString(value, "planId", "$", issues);
    hasNonEmptyString(value, "parentRunId", "$", issues);
    hasNonEmptyString(value, "parentRequestId", "$", issues);
    hasArray(value, "directNobieTasks", "$", issues);
    hasArray(value, "delegatedTasks", "$", issues);
    hasArray(value, "dependencyEdges", "$", issues);
    hasArray(value, "resourceLocks", "$", issues);
    hasArray(value, "parallelGroups", "$", issues);
    hasArray(value, "approvalRequirements", "$", issues);
    if (!isRecord(value.fallbackStrategy))
        addIssue(issues, "$.fallbackStrategy", "fallbackStrategy must be an object.");
    return issues.length === 0 ? { ok: true, value: value, issues: [] } : { ok: false, issues };
}
export function validateAgentPromptBundle(value) {
    const issues = [];
    if (!isRecord(value)) {
        return { ok: false, issues: [{ path: "$", code: "contract_validation_failed", message: "AgentPromptBundle must be an object." }] };
    }
    validateRuntimeIdentity(value.identity, "$.identity", issues);
    hasNonEmptyString(value, "bundleId", "$", issues);
    hasNonEmptyString(value, "agentId", "$", issues);
    hasNonEmptyString(value, "role", "$", issues);
    hasNonEmptyString(value, "displayNameSnapshot", "$", issues);
    hasNonEmptyString(value, "personalitySnapshot", "$", issues);
    if (!isRecord(value.memoryPolicy))
        addIssue(issues, "$.memoryPolicy", "memoryPolicy must be an object.");
    if (!isRecord(value.capabilityPolicy))
        addIssue(issues, "$.capabilityPolicy", "capabilityPolicy must be an object.");
    if (!isRecord(value.taskScope))
        addIssue(issues, "$.taskScope", "taskScope must be an object.");
    hasArray(value, "safetyRules", "$", issues);
    hasArray(value, "sourceProvenance", "$", issues);
    if (Array.isArray(value.safetyRules) && value.safetyRules.length === 0) {
        addIssue(issues, "$.safetyRules", "safetyRules must include at least one safety boundary.");
    }
    if (Array.isArray(value.sourceProvenance) && value.sourceProvenance.length === 0) {
        addIssue(issues, "$.sourceProvenance", "sourceProvenance must include at least one prompt/profile source.");
    }
    if (typeof value.agentType !== "string" || (value.agentType !== "nobie" && value.agentType !== "sub_agent")) {
        addIssue(issues, "$.agentType", "agentType must be nobie or sub_agent.");
    }
    return issues.length === 0 ? { ok: true, value: value, issues: [] } : { ok: false, issues };
}
//# sourceMappingURL=sub-agent-orchestration.js.map