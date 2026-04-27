import { listAgentCapabilityBindings, listMcpServerCatalogEntries, listSkillCatalogEntries, } from "../db/index.js";
import { CAPABILITY_RISK_ORDER, normalizeSkillMcpAllowlist, } from "../security/capability-isolation.js";
const DEFAULT_RATE_LIMIT = {
    maxConcurrentCalls: 1,
};
function uniqueStrings(values) {
    return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function parseJsonArray(value) {
    if (!value)
        return [];
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed)
            ? parsed.filter((item) => typeof item === "string" && item.trim().length > 0)
            : [];
    }
    catch {
        return [];
    }
}
function parseJsonRecord(value) {
    if (!value)
        return undefined;
    try {
        const parsed = JSON.parse(value);
        return isRecord(parsed) ? parsed : undefined;
    }
    catch {
        return undefined;
    }
}
function parsePermissionProfile(value) {
    const record = parseJsonRecord(value);
    if (!record)
        return undefined;
    return record;
}
function parseRateLimit(value) {
    const record = parseJsonRecord(value);
    if (!record || typeof record.maxConcurrentCalls !== "number")
        return undefined;
    return {
        maxConcurrentCalls: Math.max(1, record.maxConcurrentCalls),
        ...(typeof record.maxCallsPerMinute === "number"
            ? { maxCallsPerMinute: Math.max(1, record.maxCallsPerMinute) }
            : {}),
    };
}
function cloneRateLimit(value) {
    return {
        maxConcurrentCalls: Math.max(1, value?.maxConcurrentCalls ?? DEFAULT_RATE_LIMIT.maxConcurrentCalls),
        ...(value?.maxCallsPerMinute !== undefined
            ? { maxCallsPerMinute: Math.max(1, value.maxCallsPerMinute) }
            : {}),
    };
}
function catalogSkillRef(row) {
    return {
        catalogKind: "skill",
        catalogId: row.skill_id,
        displayName: row.display_name,
        status: row.status,
        risk: row.risk,
        toolNames: parseJsonArray(row.tool_names_json),
    };
}
function catalogMcpRef(row) {
    return {
        catalogKind: "mcp_server",
        catalogId: row.mcp_server_id,
        displayName: row.display_name,
        status: row.status,
        risk: row.risk,
        toolNames: parseJsonArray(row.tool_names_json),
    };
}
function implicitBindingId(agentId, catalogKind, catalogId) {
    return `${agentId}:implicit:${catalogKind}:${catalogId}`;
}
function catalogDisabledReason(catalog) {
    if (catalog.status === "enabled" || catalog.status === "unknown")
        return undefined;
    return catalog.catalogKind === "skill" ? "skill_catalog_disabled" : "mcp_server_catalog_disabled";
}
function bindingDisabledReason(status) {
    if (status === "enabled" || status === "implicit")
        return undefined;
    return status === "archived" ? "capability_binding_archived" : "capability_binding_disabled";
}
function availabilityFromReasons(reasonCodes) {
    if (reasonCodes.some((reason) => [
        "capability_binding_disabled",
        "capability_binding_archived",
        "skill_catalog_disabled",
        "mcp_server_catalog_disabled",
        "mcp_secret_scope_missing",
    ].includes(reason))) {
        return "unavailable";
    }
    return reasonCodes.length > 0 ? "degraded" : "available";
}
function diagnosticSeverityFor(reasonCode) {
    return [
        "model_profile_missing",
        "model_provider_unknown",
        "model_id_unknown",
        "model_doctor_unavailable",
        "capability_binding_disabled",
        "capability_binding_archived",
        "skill_catalog_disabled",
        "mcp_server_catalog_disabled",
        "mcp_secret_scope_missing",
    ].includes(reasonCode)
        ? "warning"
        : "info";
}
function diagnosticMessage(reasonCode, catalogId) {
    switch (reasonCode) {
        case "capability_binding_disabled":
            return `${catalogId ?? "capability"} binding is disabled for this agent.`;
        case "capability_binding_archived":
            return `${catalogId ?? "capability"} binding is archived for this agent.`;
        case "skill_catalog_disabled":
            return `Skill catalog item ${catalogId ?? "unknown"} is disabled or archived.`;
        case "mcp_server_catalog_disabled":
            return `MCP server catalog item ${catalogId ?? "unknown"} is disabled or archived.`;
        case "mcp_secret_scope_missing":
            return `MCP server ${catalogId ?? "unknown"} has no configured secret scope.`;
        case "model_profile_missing":
            return "Agent model profile is missing.";
        case "model_provider_unknown":
            return "Agent model provider is unknown.";
        case "model_id_unknown":
            return "Agent model id is unknown.";
        case "model_fallback_cost_budget_missing":
            return "Agent fallback model is configured without a cost budget.";
        case "model_timeout_missing":
            return "Agent model timeout is not configured.";
        case "model_doctor_unavailable":
            return "Model availability doctor reports this model as unavailable.";
        case "model_doctor_degraded":
            return "Model availability doctor reports this model as degraded.";
        default:
            return `${catalogId ?? "agent"} has diagnostic ${reasonCode}.`;
    }
}
function diagnostic(input) {
    return {
        reasonCode: input.reasonCode,
        severity: diagnosticSeverityFor(input.reasonCode),
        message: diagnosticMessage(input.reasonCode, input.catalogId),
        agentId: input.agentId,
        ...(input.bindingId ? { bindingId: input.bindingId } : {}),
        ...(input.catalogKind ? { catalogKind: input.catalogKind } : {}),
        ...(input.catalogId ? { catalogId: input.catalogId } : {}),
    };
}
function broaderThan(left, right) {
    return CAPABILITY_RISK_ORDER[left] > CAPABILITY_RISK_ORDER[right] ? left : right;
}
function bindingSummary(input) {
    const permissionProfile = parsePermissionProfile(input.binding?.permission_profile_json ?? null) ??
        input.permissionProfile;
    const rateLimit = cloneRateLimit(parseRateLimit(input.binding?.rate_limit_json ?? null) ?? input.rateLimit);
    const bindingStatus = input.binding?.status ?? "implicit";
    const secretScopeId = input.binding?.secret_scope_id ?? input.allowlist.secretScopeId;
    const enabledToolNames = uniqueStrings([
        ...input.catalog.toolNames,
        ...parseJsonArray(input.binding?.enabled_tool_names_json ?? null),
    ]);
    const disabledToolNames = uniqueStrings(parseJsonArray(input.binding?.disabled_tool_names_json ?? null));
    const reasonCodes = uniqueStrings([
        bindingDisabledReason(bindingStatus),
        catalogDisabledReason(input.catalog),
        input.catalog.catalogKind === "mcp_server" && !secretScopeId
            ? "mcp_secret_scope_missing"
            : undefined,
    ].filter((reason) => Boolean(reason)));
    const availability = availabilityFromReasons(reasonCodes);
    return {
        bindingId: input.binding?.binding_id ??
            implicitBindingId(input.agentId, input.catalog.catalogKind, input.catalog.catalogId),
        agentId: input.agentId,
        catalogKind: input.catalog.catalogKind,
        catalogId: input.catalog.catalogId,
        ...(input.catalog.displayName ? { catalogDisplayName: input.catalog.displayName } : {}),
        catalogStatus: input.catalog.status,
        bindingStatus,
        available: availability !== "unavailable",
        availability,
        reasonCodes,
        enabledToolNames,
        disabledToolNames,
        secretScope: {
            configured: Boolean(secretScopeId),
            ...(secretScopeId ? { scopeId: secretScopeId } : {}),
        },
        risk: input.catalog.status === "unknown"
            ? permissionProfile.riskCeiling
            : broaderThan(input.catalog.risk, "safe"),
        riskCeiling: permissionProfile.riskCeiling,
        approvalRequiredFrom: input.binding?.approval_required_from ?? permissionProfile.approvalRequiredFrom,
        rateLimit,
    };
}
function refsFor(catalogKind, ids, catalog) {
    return uniqueStrings(ids).map((catalogId) => {
        const existing = catalog.get(catalogId);
        return {
            catalogKind,
            catalogId,
            status: existing?.status ?? "unknown",
            risk: existing?.risk ?? "safe",
            toolNames: existing?.toolNames ?? [],
            ...(existing?.displayName ? { displayName: existing.displayName } : {}),
        };
    });
}
function mergedAvailability(diagnostics, hasUnavailable) {
    if (hasUnavailable)
        return "degraded";
    return diagnostics.some((item) => item.severity !== "info") ? "degraded" : "available";
}
export function buildAgentCapabilitySummary(config) {
    const allowlist = normalizeSkillMcpAllowlist(config.capabilityPolicy.skillMcpAllowlist);
    const skillCatalog = new Map(listSkillCatalogEntries({ includeArchived: true }).map((row) => [
        row.skill_id,
        catalogSkillRef(row),
    ]));
    const mcpCatalog = new Map(listMcpServerCatalogEntries({ includeArchived: true }).map((row) => [
        row.mcp_server_id,
        catalogMcpRef(row),
    ]));
    const bindings = listAgentCapabilityBindings({ agentId: config.agentId, includeArchived: true });
    const bindingByKey = new Map(bindings.map((binding) => [`${binding.capability_kind}:${binding.catalog_id}`, binding]));
    const skillRefs = refsFor("skill", [
        ...allowlist.enabledSkillIds,
        ...bindings
            .filter((binding) => binding.capability_kind === "skill")
            .map((binding) => binding.catalog_id),
    ], skillCatalog);
    const mcpRefs = refsFor("mcp_server", [
        ...allowlist.enabledMcpServerIds,
        ...bindings
            .filter((binding) => binding.capability_kind === "mcp_server")
            .map((binding) => binding.catalog_id),
    ], mcpCatalog);
    const skillBindings = skillRefs.map((catalog) => bindingSummary({
        agentId: config.agentId,
        catalog,
        binding: bindingByKey.get(`${catalog.catalogKind}:${catalog.catalogId}`),
        allowlist,
        permissionProfile: config.capabilityPolicy.permissionProfile,
        rateLimit: config.capabilityPolicy.rateLimit,
    }));
    const mcpServerBindings = mcpRefs.map((catalog) => bindingSummary({
        agentId: config.agentId,
        catalog,
        binding: bindingByKey.get(`${catalog.catalogKind}:${catalog.catalogId}`),
        allowlist,
        permissionProfile: config.capabilityPolicy.permissionProfile,
        rateLimit: config.capabilityPolicy.rateLimit,
    }));
    const bindingDiagnostics = [...skillBindings, ...mcpServerBindings].flatMap((binding) => binding.reasonCodes.map((reasonCode) => diagnostic({
        reasonCode,
        agentId: config.agentId,
        bindingId: binding.bindingId,
        catalogKind: binding.catalogKind,
        catalogId: binding.catalogId,
    })));
    const availableSkillIds = skillBindings
        .filter((binding) => binding.available)
        .map((binding) => binding.catalogId);
    const disabledSkillIds = skillBindings
        .filter((binding) => !binding.available)
        .map((binding) => binding.catalogId);
    const availableMcpServerIds = mcpServerBindings
        .filter((binding) => binding.available)
        .map((binding) => binding.catalogId);
    const disabledMcpServerIds = mcpServerBindings
        .filter((binding) => !binding.available)
        .map((binding) => binding.catalogId);
    const disabledToolNames = uniqueStrings([
        ...allowlist.disabledToolNames,
        ...[...skillBindings, ...mcpServerBindings].flatMap((binding) => binding.disabledToolNames),
        ...[...skillBindings, ...mcpServerBindings]
            .filter((binding) => !binding.available)
            .flatMap((binding) => binding.enabledToolNames),
    ]);
    const enabledToolNames = uniqueStrings([
        ...allowlist.enabledToolNames,
        ...[...skillBindings, ...mcpServerBindings]
            .filter((binding) => binding.available)
            .flatMap((binding) => binding.enabledToolNames),
    ]).filter((toolName) => !disabledToolNames.includes(toolName));
    const secretScopes = [...skillBindings, ...mcpServerBindings]
        .filter((binding) => binding.secretScope.configured)
        .map((binding) => binding.secretScope);
    const availability = mergedAvailability(bindingDiagnostics, [...skillBindings, ...mcpServerBindings].some((binding) => !binding.available));
    return {
        agentId: config.agentId,
        available: availability !== "unavailable",
        availability,
        enabledSkillIds: availableSkillIds,
        disabledSkillIds,
        enabledMcpServerIds: availableMcpServerIds,
        disabledMcpServerIds,
        enabledToolNames,
        disabledToolNames,
        secretScopes,
        skillBindings,
        mcpServerBindings,
        diagnostics: bindingDiagnostics,
        diagnosticReasonCodes: uniqueStrings(bindingDiagnostics.map((item) => item.reasonCode)),
    };
}
function matchingDoctor(modelProfile, doctor) {
    if (!modelProfile || !doctor)
        return undefined;
    const rows = Array.isArray(doctor) ? doctor : [doctor];
    return rows.find((row) => row.providerId === modelProfile.providerId &&
        (row.modelId === modelProfile.modelId || row.modelId === modelProfile.fallbackModelId));
}
function modelReasonCodes(modelProfile, options = {}) {
    const doctor = matchingDoctor(modelProfile, options.doctor);
    if (!modelProfile)
        return ["model_profile_missing"];
    return uniqueStrings([
        modelProfile.providerId === "provider:unknown" ? "model_provider_unknown" : undefined,
        modelProfile.modelId === "model:unknown" ? "model_id_unknown" : undefined,
        modelProfile.fallbackModelId && modelProfile.costBudget === undefined
            ? "model_fallback_cost_budget_missing"
            : undefined,
        modelProfile.timeoutMs === undefined ? "model_timeout_missing" : undefined,
        doctor?.status === "unavailable" ? "model_doctor_unavailable" : undefined,
        doctor?.status === "degraded" ? "model_doctor_degraded" : undefined,
        ...(doctor?.reasonCodes ?? []),
    ].filter((reason) => Boolean(reason)));
}
function modelAvailability(reasonCodes) {
    if (reasonCodes.includes("model_profile_missing") ||
        reasonCodes.includes("model_provider_unknown") ||
        reasonCodes.includes("model_id_unknown") ||
        reasonCodes.includes("model_doctor_unavailable")) {
        return "unavailable";
    }
    return reasonCodes.length > 0 ? "degraded" : "available";
}
export function buildAgentModelSummary(config, options = {}) {
    const reasonCodes = modelReasonCodes(config.modelProfile, options);
    const availability = modelAvailability(reasonCodes);
    const diagnostics = reasonCodes.map((reasonCode) => diagnostic({ reasonCode, agentId: config.agentId }));
    return {
        agentId: config.agentId,
        configured: config.modelProfile !== undefined,
        available: availability !== "unavailable",
        availability,
        ...(config.modelProfile?.providerId ? { providerId: config.modelProfile.providerId } : {}),
        ...(config.modelProfile?.modelId ? { modelId: config.modelProfile.modelId } : {}),
        ...(config.modelProfile?.timeoutMs !== undefined
            ? { timeoutMs: config.modelProfile.timeoutMs }
            : {}),
        ...(config.modelProfile?.retryCount !== undefined
            ? { retryCount: config.modelProfile.retryCount }
            : {}),
        ...(config.modelProfile?.costBudget !== undefined
            ? { costBudget: config.modelProfile.costBudget }
            : {}),
        ...(config.modelProfile?.fallbackModelId
            ? { fallbackModelId: config.modelProfile.fallbackModelId }
            : {}),
        diagnostics,
        diagnosticReasonCodes: reasonCodes,
    };
}
export function resolveAgentCapabilityModelSummary(config, options = {}) {
    const capabilitySummary = buildAgentCapabilitySummary(config);
    const modelSummary = buildAgentModelSummary(config, options);
    const allowlist = normalizeSkillMcpAllowlist(config.capabilityPolicy.skillMcpAllowlist);
    const skillMcpSummary = {
        enabledSkillIds: [...capabilitySummary.enabledSkillIds],
        enabledMcpServerIds: [...capabilitySummary.enabledMcpServerIds],
        enabledToolNames: [...capabilitySummary.enabledToolNames],
        disabledToolNames: [...capabilitySummary.disabledToolNames],
        ...(allowlist.secretScopeId ? { secretScopeId: allowlist.secretScopeId } : {}),
    };
    const degradedReasonCodes = uniqueStrings([
        ...capabilitySummary.diagnosticReasonCodes,
        ...modelSummary.diagnosticReasonCodes,
    ]);
    return {
        agentId: config.agentId,
        capabilitySummary,
        modelSummary,
        skillMcpSummary,
        degradedReasonCodes,
    };
}
//# sourceMappingURL=capability-model.js.map