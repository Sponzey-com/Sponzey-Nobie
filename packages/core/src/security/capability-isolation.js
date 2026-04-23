import { createHash, randomUUID } from "node:crypto";
import { CONTRACT_SCHEMA_VERSION } from "../contracts/index.js";
import { insertCapabilityDelegation, } from "../db/index.js";
import { createDataExchangePackage, persistDataExchangePackage, } from "../memory/isolation.js";
export const CAPABILITY_RISK_ORDER = {
    safe: 0,
    moderate: 1,
    external: 2,
    sensitive: 3,
    dangerous: 4,
};
const EMPTY_ALLOWLIST = {
    enabledSkillIds: [],
    enabledMcpServerIds: [],
    enabledToolNames: [],
    disabledToolNames: [],
};
function normalizeStringList(value) {
    if (!Array.isArray(value))
        return [];
    return [...new Set(value
            .filter((item) => typeof item === "string")
            .map((item) => item.trim())
            .filter(Boolean))];
}
const rateLimitState = new Map();
function normalizeToken(value) {
    return value.trim().toLowerCase().replace(/[^a-z0-9:_-]+/g, "_");
}
function makeSet(values) {
    return new Set(values.map(normalizeToken).filter(Boolean));
}
function isRiskAtLeast(actual, threshold) {
    return CAPABILITY_RISK_ORDER[actual] >= CAPABILITY_RISK_ORDER[threshold];
}
function riskWithinCeiling(actual, ceiling) {
    return CAPABILITY_RISK_ORDER[actual] <= CAPABILITY_RISK_ORDER[ceiling];
}
function nonEmpty(value) {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
}
export function normalizeSkillMcpAllowlist(input) {
    const secretScopeId = typeof input?.secretScopeId === "string" ? nonEmpty(input.secretScopeId) : undefined;
    return {
        enabledSkillIds: normalizeStringList(input?.enabledSkillIds),
        enabledMcpServerIds: normalizeStringList(input?.enabledMcpServerIds),
        enabledToolNames: normalizeStringList(input?.enabledToolNames),
        disabledToolNames: normalizeStringList(input?.disabledToolNames),
        ...(secretScopeId ? { secretScopeId } : {}),
    };
}
function cloneAllowlist(input) {
    const allowlist = normalizeSkillMcpAllowlist(input);
    return {
        enabledSkillIds: [...allowlist.enabledSkillIds],
        enabledMcpServerIds: [...allowlist.enabledMcpServerIds],
        enabledToolNames: [...allowlist.enabledToolNames],
        disabledToolNames: [...allowlist.disabledToolNames],
        ...(allowlist.secretScopeId ? { secretScopeId: allowlist.secretScopeId } : {}),
    };
}
function clonePermissionProfile(input) {
    return {
        ...input,
        allowedPaths: [...input.allowedPaths],
    };
}
function cloneRateLimit(input) {
    return {
        maxConcurrentCalls: input.maxConcurrentCalls,
        ...(input.maxCallsPerMinute !== undefined ? { maxCallsPerMinute: input.maxCallsPerMinute } : {}),
    };
}
function hashJson(value) {
    return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function stripHandleLikePayload(value) {
    if (Array.isArray(value)) {
        return value
            .map((item) => stripHandleLikePayload(item))
            .filter((item) => item !== undefined);
    }
    if (value && typeof value === "object") {
        const out = {};
        for (const [key, item] of Object.entries(value)) {
            if (/^(toolHandle|toolClient|client|handle|secret|token|apiKey|authorization)$/iu.test(key)) {
                continue;
            }
            const next = stripHandleLikePayload(item);
            if (next !== undefined)
                out[key] = next;
        }
        return out;
    }
    return value;
}
function ownerIdentityOwner(owner) {
    return { ownerType: owner.ownerType, ownerId: owner.ownerId };
}
function contextPolicy(ctx) {
    const skillMcpAllowlist = ctx.capabilityPolicy?.skillMcpAllowlist ?? ctx.skillMcpAllowlist;
    return {
        ...(ctx.capabilityPolicy?.permissionProfile ?? ctx.permissionProfile
            ? { permissionProfile: ctx.capabilityPolicy?.permissionProfile ?? ctx.permissionProfile }
            : {}),
        ...(skillMcpAllowlist
            ? { skillMcpAllowlist: normalizeSkillMcpAllowlist(skillMcpAllowlist) }
            : {}),
        ...(ctx.capabilityPolicy?.rateLimit ?? ctx.capabilityRateLimit
            ? { rateLimit: ctx.capabilityPolicy?.rateLimit ?? ctx.capabilityRateLimit }
            : {}),
    };
}
export function parseMcpRegisteredToolName(toolName) {
    if (!toolName.startsWith("mcp__"))
        return null;
    const parts = toolName.split("__");
    if (parts.length < 3)
        return null;
    const serverId = nonEmpty(parts[1]);
    const rawToolName = nonEmpty(parts.slice(2).join("__"));
    if (!serverId || !rawToolName)
        return null;
    return {
        registeredName: toolName,
        serverId,
        toolName: rawToolName,
    };
}
export function resolveToolCapabilityRisk(toolName, fallback = "safe") {
    if (fallback === "dangerous")
        return "dangerous";
    if (fallback === "moderate")
        return "moderate";
    if (fallback === "external" || fallback === "sensitive")
        return fallback;
    if (toolName === "shell_exec" || toolName === "process_kill")
        return "dangerous";
    if (/^(mouse_|keyboard_|window_focus|screen_|yeonjang_camera_capture|app_launch)/u.test(toolName))
        return "dangerous";
    if (/^file_(write|patch|delete)$/u.test(toolName))
        return "sensitive";
    if (/^(web_search|web_fetch)$/u.test(toolName))
        return "external";
    if (toolName.startsWith("mcp__"))
        return "moderate";
    return "safe";
}
export function isToolAllowedBySkillMcpAllowlist(input) {
    const allowlist = normalizeSkillMcpAllowlist(input.allowlist);
    const enabledTools = makeSet(allowlist.enabledToolNames);
    const disabledTools = makeSet(allowlist.disabledToolNames);
    const names = new Set([normalizeToken(input.toolName)]);
    if (input.mcpTool) {
        names.add(normalizeToken(input.mcpTool.toolName));
        names.add(normalizeToken(`${input.mcpTool.serverId}:${input.mcpTool.toolName}`));
        names.add(normalizeToken(input.mcpTool.registeredName));
    }
    if ([...names].some((name) => disabledTools.has(name)))
        return false;
    if (enabledTools.size === 0)
        return true;
    return [...names].some((name) => enabledTools.has(name));
}
export function isMcpServerAllowed(input) {
    const enabledServers = makeSet(normalizeSkillMcpAllowlist(input.allowlist).enabledMcpServerIds);
    if (enabledServers.size === 0)
        return true;
    return enabledServers.has(normalizeToken(input.serverId));
}
export function evaluateAgentToolCapabilityPolicy(input) {
    const mcpTool = parseMcpRegisteredToolName(input.toolName);
    const capabilityRisk = resolveToolCapabilityRisk(input.toolName, input.riskLevel ?? "safe");
    const policy = contextPolicy(input.ctx);
    const requiresAgentContext = Boolean(mcpTool || input.ctx.agentId || policy.permissionProfile || policy.skillMcpAllowlist);
    if (!requiresAgentContext) {
        return {
            allowed: true,
            toolName: input.toolName,
            capabilityRisk,
            approvalRequired: false,
            reasonCode: "legacy_no_agent_context",
            diagnostic: { capabilityRisk, legacy: true },
        };
    }
    if (!input.ctx.agentId?.trim()) {
        return {
            allowed: false,
            toolName: input.toolName,
            capabilityRisk,
            approvalRequired: false,
            reasonCode: "agent_context_required",
            userMessage: "에이전트 실행 컨텍스트가 없어 도구를 실행하지 않았습니다.",
            diagnostic: { capabilityRisk, toolName: input.toolName },
        };
    }
    if (!policy.permissionProfile) {
        return {
            allowed: false,
            toolName: input.toolName,
            capabilityRisk,
            approvalRequired: false,
            reasonCode: "permission_profile_required",
            userMessage: "에이전트 권한 프로필이 없어 도구를 실행하지 않았습니다.",
            agentId: input.ctx.agentId,
            diagnostic: { capabilityRisk, agentId: input.ctx.agentId },
        };
    }
    const allowlist = policy.skillMcpAllowlist ? normalizeSkillMcpAllowlist(policy.skillMcpAllowlist) : EMPTY_ALLOWLIST;
    const secretScopeId = input.ctx.secretScopeId ?? allowlist.secretScopeId;
    if (mcpTool && !secretScopeId?.trim()) {
        return {
            allowed: false,
            toolName: input.toolName,
            capabilityRisk,
            approvalRequired: false,
            reasonCode: "secret_scope_required",
            userMessage: "MCP 도구 실행에는 에이전트 전용 secret scope가 필요합니다.",
            agentId: input.ctx.agentId,
            permissionProfileId: policy.permissionProfile.profileId,
            mcpTool,
            diagnostic: { capabilityRisk, agentId: input.ctx.agentId, mcpTool },
        };
    }
    if (mcpTool && !input.ctx.auditId?.trim()) {
        return {
            allowed: false,
            toolName: input.toolName,
            capabilityRisk,
            approvalRequired: false,
            reasonCode: "audit_id_required",
            userMessage: "MCP 도구 실행에는 audit id가 필요합니다.",
            agentId: input.ctx.agentId,
            permissionProfileId: policy.permissionProfile.profileId,
            ...(secretScopeId ? { secretScopeId } : {}),
            mcpTool,
            diagnostic: { capabilityRisk, agentId: input.ctx.agentId, mcpTool },
        };
    }
    if (input.ctx.secretScopeId && allowlist.secretScopeId && input.ctx.secretScopeId !== allowlist.secretScopeId) {
        return {
            allowed: false,
            toolName: input.toolName,
            capabilityRisk,
            approvalRequired: false,
            reasonCode: "secret_scope_mismatch",
            userMessage: "에이전트에 허용된 secret scope와 실행 scope가 일치하지 않습니다.",
            agentId: input.ctx.agentId,
            permissionProfileId: policy.permissionProfile.profileId,
            ...(secretScopeId ? { secretScopeId } : {}),
            ...(mcpTool ? { mcpTool } : {}),
            diagnostic: { capabilityRisk, agentId: input.ctx.agentId, configuredSecretScope: allowlist.secretScopeId },
        };
    }
    if (mcpTool && !isMcpServerAllowed({ serverId: mcpTool.serverId, allowlist })) {
        return {
            allowed: false,
            toolName: input.toolName,
            capabilityRisk,
            approvalRequired: false,
            reasonCode: "mcp_server_not_allowed",
            userMessage: "이 에이전트에 허용되지 않은 MCP 서버입니다.",
            agentId: input.ctx.agentId,
            permissionProfileId: policy.permissionProfile.profileId,
            ...(secretScopeId ? { secretScopeId } : {}),
            mcpTool,
            diagnostic: { capabilityRisk, agentId: input.ctx.agentId, mcpTool },
        };
    }
    if (!isToolAllowedBySkillMcpAllowlist({ toolName: input.toolName, allowlist, mcpTool })) {
        return {
            allowed: false,
            toolName: input.toolName,
            capabilityRisk,
            approvalRequired: false,
            reasonCode: "tool_not_allowed",
            userMessage: "이 에이전트에 허용되지 않은 도구입니다.",
            agentId: input.ctx.agentId,
            permissionProfileId: policy.permissionProfile.profileId,
            ...(secretScopeId ? { secretScopeId } : {}),
            ...(mcpTool ? { mcpTool } : {}),
            diagnostic: { capabilityRisk, agentId: input.ctx.agentId, toolName: input.toolName },
        };
    }
    const capabilityBlockReason = resolvePermissionProfileBlockReason(input.toolName, capabilityRisk, policy.permissionProfile);
    if (capabilityBlockReason) {
        return {
            allowed: false,
            toolName: input.toolName,
            capabilityRisk,
            approvalRequired: false,
            reasonCode: capabilityBlockReason,
            userMessage: "에이전트 권한 프로필이 이 도구 실행을 허용하지 않습니다.",
            agentId: input.ctx.agentId,
            permissionProfileId: policy.permissionProfile.profileId,
            ...(secretScopeId ? { secretScopeId } : {}),
            ...(mcpTool ? { mcpTool } : {}),
            diagnostic: { capabilityRisk, agentId: input.ctx.agentId, profileId: policy.permissionProfile.profileId },
        };
    }
    const approvalRequired = isRiskAtLeast(capabilityRisk, policy.permissionProfile.approvalRequiredFrom);
    const rateLimitKey = [
        "agent",
        input.ctx.agentId,
        mcpTool ? `mcp:${mcpTool.serverId}:${mcpTool.toolName}` : `tool:${input.toolName}`,
        secretScopeId ? `secret:${secretScopeId}` : "secret:none",
    ].join(":");
    return {
        allowed: true,
        toolName: input.toolName,
        capabilityRisk,
        approvalRequired,
        reasonCode: approvalRequired ? "capability_approval_required" : "capability_allowed",
        agentId: input.ctx.agentId,
        permissionProfileId: policy.permissionProfile.profileId,
        ...(secretScopeId ? { secretScopeId } : {}),
        rateLimitKey,
        ...(policy.rateLimit ? { rateLimit: policy.rateLimit } : {}),
        ...(mcpTool ? { mcpTool } : {}),
        diagnostic: {
            capabilityRisk,
            agentId: input.ctx.agentId,
            permissionProfileId: policy.permissionProfile.profileId,
            approvalRequired,
            rateLimitKey,
            ...(mcpTool ? { mcpTool } : {}),
        },
    };
}
function resolvePermissionProfileBlockReason(toolName, capabilityRisk, profile) {
    if (!riskWithinCeiling(capabilityRisk, profile.riskCeiling))
        return "risk_exceeds_profile";
    if ((toolName === "shell_exec" || toolName === "process_kill") && !profile.allowShellExecution)
        return "shell_execution_not_allowed";
    if (/^file_(write|patch|delete)$/u.test(toolName) && !profile.allowFilesystemWrite)
        return "filesystem_write_not_allowed";
    if (/^(web_search|web_fetch)$/u.test(toolName) && !profile.allowExternalNetwork)
        return "external_network_not_allowed";
    if (/^(mouse_|keyboard_|window_focus|screen_|yeonjang_camera_capture|app_launch)/u.test(toolName) && !profile.allowScreenControl)
        return "screen_control_not_allowed";
    return null;
}
export function toAgentCapabilityCallContext(ctx) {
    const policy = contextPolicy(ctx);
    const permissionProfile = policy.permissionProfile;
    const skillMcpAllowlist = policy.skillMcpAllowlist;
    const secretScopeId = ctx.secretScopeId ?? skillMcpAllowlist?.secretScopeId;
    const auditId = ctx.auditId;
    if (!ctx.agentId || !permissionProfile || !skillMcpAllowlist || !secretScopeId || !auditId)
        return null;
    return {
        agentId: ctx.agentId,
        sessionId: ctx.sessionId,
        permissionProfile,
        skillMcpAllowlist: normalizeSkillMcpAllowlist(skillMcpAllowlist),
        secretScopeId,
        auditId,
        ...(ctx.runId ? { runId: ctx.runId } : {}),
        ...(ctx.requestGroupId ? { requestGroupId: ctx.requestGroupId } : {}),
        ...(ctx.capabilityDelegationId ? { capabilityDelegationId: ctx.capabilityDelegationId } : {}),
    };
}
export function acquireAgentCapabilityRateLimit(input) {
    if (!input.decision.allowed || !input.decision.rateLimitKey || !input.decision.rateLimit) {
        return { key: "none", release: () => { } };
    }
    const now = input.now ?? Date.now();
    const state = rateLimitState.get(input.decision.rateLimitKey) ?? { concurrent: 0, calls: [] };
    const maxConcurrent = Math.max(1, Math.floor(input.decision.rateLimit.maxConcurrentCalls));
    const windowStart = now - 60_000;
    state.calls = state.calls.filter((timestamp) => timestamp > windowStart);
    if (state.concurrent >= maxConcurrent) {
        throw new Error(`agent capability rate limit exceeded: concurrent=${state.concurrent}, max=${maxConcurrent}`);
    }
    if (input.decision.rateLimit.maxCallsPerMinute !== undefined) {
        const maxCalls = Math.max(1, Math.floor(input.decision.rateLimit.maxCallsPerMinute));
        if (state.calls.length >= maxCalls) {
            throw new Error(`agent capability rate limit exceeded: calls_per_minute=${state.calls.length}, max=${maxCalls}`);
        }
    }
    state.concurrent += 1;
    state.calls.push(now);
    rateLimitState.set(input.decision.rateLimitKey, state);
    let released = false;
    return {
        key: input.decision.rateLimitKey,
        release: () => {
            if (released)
                return;
            released = true;
            const current = rateLimitState.get(input.decision.rateLimitKey);
            if (!current)
                return;
            current.concurrent = Math.max(0, current.concurrent - 1);
            rateLimitState.set(input.decision.rateLimitKey, current);
        },
    };
}
export function resetAgentCapabilityRateLimitsForTest() {
    rateLimitState.clear();
}
export function createCapabilityPolicySnapshot(input) {
    const createdAt = input.now ?? Date.now();
    const permissionProfile = clonePermissionProfile(input.policy.permissionProfile);
    const skillMcpAllowlist = cloneAllowlist(input.policy.skillMcpAllowlist);
    const rateLimit = cloneRateLimit(input.policy.rateLimit);
    const checksum = hashJson({ permissionProfile, skillMcpAllowlist, rateLimit });
    return {
        snapshotId: input.snapshotId ?? `capability-snapshot:${randomUUID()}`,
        sourceProfileId: permissionProfile.profileId,
        permissionProfile,
        skillMcpAllowlist,
        rateLimit,
        checksum,
        createdAt,
    };
}
export function buildCapabilityDelegationRequest(input) {
    const delegationId = input.delegationId ?? `delegation:${randomUUID()}`;
    const identity = {
        schemaVersion: CONTRACT_SCHEMA_VERSION,
        entityType: "capability",
        entityId: delegationId,
        owner: ownerIdentityOwner(input.requester),
        idempotencyKey: input.idempotencyKey ?? `capability-delegation:${delegationId}`,
        ...(input.auditCorrelationId ? { auditCorrelationId: input.auditCorrelationId } : {}),
        parent: {
            ...(input.parentRunId ? { parentRunId: input.parentRunId } : {}),
            ...(input.parentSessionId ? { parentSessionId: input.parentSessionId } : {}),
            ...(input.parentSubSessionId ? { parentSubSessionId: input.parentSubSessionId } : {}),
            ...(input.parentRequestId ? { parentRequestId: input.parentRequestId } : {}),
        },
    };
    return {
        identity,
        delegationId,
        requester: input.requester,
        provider: input.provider,
        capability: input.capability,
        risk: input.risk,
        inputPackageIds: [...input.inputPackageIds],
        ...(input.approvalId ? { approvalId: input.approvalId } : {}),
        status: input.status ?? "requested",
    };
}
export function recordCapabilityDelegationRequest(delegation, options = {}) {
    return insertCapabilityDelegation(delegation, options);
}
export function buildCapabilityResultDataExchange(input) {
    const sanitizedPayload = stripHandleLikePayload(input.payload);
    return createDataExchangePackage({
        sourceOwner: input.delegation.provider,
        recipientOwner: input.delegation.requester,
        purpose: `capability delegation result: ${input.delegation.capability}`,
        allowedUse: "verification_only",
        retentionPolicy: "session_only",
        redactionState: "not_sensitive",
        provenanceRefs: input.provenanceRefs ?? [`delegation:${input.delegation.delegationId}`],
        payload: {
            ...sanitizedPayload,
            delegationId: input.delegation.delegationId,
            capability: input.delegation.capability,
            resultSharing: "data_exchange_only",
        },
        ...(input.exchangeId ? { exchangeId: input.exchangeId } : {}),
        ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
        ...(input.now ? { now: input.now } : {}),
        ...(Object.prototype.hasOwnProperty.call(input, "expiresAt") ? { expiresAt: input.expiresAt ?? null } : {}),
        ...(input.delegation.identity.parent?.parentRunId ? { parentRunId: input.delegation.identity.parent.parentRunId } : {}),
        ...(input.delegation.identity.parent?.parentSessionId ? { parentSessionId: input.delegation.identity.parent.parentSessionId } : {}),
        ...(input.delegation.identity.parent?.parentSubSessionId ? { parentSubSessionId: input.delegation.identity.parent.parentSubSessionId } : {}),
        ...(input.delegation.identity.parent?.parentRequestId ? { parentRequestId: input.delegation.identity.parent.parentRequestId } : {}),
        ...(input.delegation.identity.auditCorrelationId ? { auditCorrelationId: input.delegation.identity.auditCorrelationId } : {}),
    });
}
export function persistCapabilityResultDataExchange(exchange, options = {}) {
    return persistDataExchangePackage(exchange, options);
}
export function buildCapabilityApprovalAggregationEvent(input) {
    const createdAt = input.now ?? Date.now();
    return {
        kind: "capability_approval_required",
        eventId: `capability-approval:${randomUUID()}`,
        ...(input.runId ? { runId: input.runId } : {}),
        ...(input.requestGroupId ? { requestGroupId: input.requestGroupId } : {}),
        ...(input.sessionId ? { sessionId: input.sessionId } : {}),
        ...(input.decision.agentId ? { agentId: input.decision.agentId } : {}),
        toolName: input.decision.toolName,
        capabilityRisk: input.decision.capabilityRisk,
        reasonCode: input.decision.reasonCode,
        ...(input.auditId ? { auditId: input.auditId } : {}),
        createdAt,
    };
}
//# sourceMappingURL=capability-isolation.js.map
