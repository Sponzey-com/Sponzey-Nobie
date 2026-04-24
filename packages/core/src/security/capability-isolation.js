import { createHash, randomUUID } from "node:crypto";
import { CONTRACT_SCHEMA_VERSION } from "../contracts/index.js";
import { recordControlEvent } from "../control-plane/timeline.js";
import { getAgentCapabilityBinding, getCapabilityDelegation, getRunSubSession, insertAuditLog, insertCapabilityDelegation, updateCapabilityDelegation, updateRunSubSession, } from "../db/index.js";
import { createDataExchangePackage, persistDataExchangePackage } from "../memory/isolation.js";
import { appendRunEvent, setRunStepStatus, updateRunStatus } from "../runs/store.js";
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
    return [
        ...new Set(value
            .filter((item) => typeof item === "string")
            .map((item) => item.trim())
            .filter(Boolean)),
    ];
}
const rateLimitState = new Map();
function normalizeToken(value) {
    return value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9:_-]+/g, "_");
}
function makeSet(values) {
    return new Set(values.map(normalizeToken).filter(Boolean));
}
function parseJsonStringList(value) {
    if (!value)
        return [];
    try {
        return normalizeStringList(JSON.parse(value));
    }
    catch {
        return [];
    }
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
        ...(input.maxCallsPerMinute !== undefined
            ? { maxCallsPerMinute: input.maxCallsPerMinute }
            : {}),
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
        ...((ctx.capabilityPolicy?.permissionProfile ?? ctx.permissionProfile)
            ? { permissionProfile: ctx.capabilityPolicy?.permissionProfile ?? ctx.permissionProfile }
            : {}),
        ...(skillMcpAllowlist
            ? { skillMcpAllowlist: normalizeSkillMcpAllowlist(skillMcpAllowlist) }
            : {}),
        ...((ctx.capabilityPolicy?.rateLimit ?? ctx.capabilityRateLimit)
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
export function classifyDepthScopedToolKind(toolName) {
    if (/^(subsession_|sub_session_|run_cancel|run_stop|session_)/u.test(toolName))
        return "session_control";
    if (toolName === "process_kill" || toolName === "app_launch")
        return "system";
    if (toolName === "shell_exec")
        return "shell";
    if (/^file_(read|write|patch|delete|list|search)$/u.test(toolName))
        return "filesystem";
    if (/^(web_search|web_fetch)$/u.test(toolName))
        return "network";
    if (toolName.startsWith("mcp__"))
        return "mcp";
    if (/^(mouse_|keyboard_|window_|screen_|yeonjang_camera_capture)/u.test(toolName)) {
        return "screen";
    }
    return "other";
}
function normalizedDepth(value) {
    if (value === undefined || !Number.isFinite(value))
        return undefined;
    return Math.max(0, Math.floor(value));
}
function normalizedToolName(value) {
    return normalizeToken(value);
}
export function evaluateDepthScopedToolPolicy(input) {
    const depth = normalizedDepth(input.depth) ?? 0;
    const toolKind = classifyDepthScopedToolKind(input.toolName);
    const policy = input.policy;
    const byDepth = policy?.deniedToolNamesByDepth?.[String(depth)] ?? [];
    const normalizedTool = normalizedToolName(input.toolName);
    if (byDepth.map(normalizedToolName).includes(normalizedTool)) {
        return {
            allowed: false,
            toolName: input.toolName,
            toolKind,
            depth,
            reasonCode: "depth_scoped_tool_denied",
        };
    }
    const limit = normalizedDepth(policy?.maxDepthByToolKind?.[toolKind]);
    if (limit !== undefined && depth > limit) {
        return {
            allowed: false,
            toolName: input.toolName,
            toolKind,
            depth,
            reasonCode: "depth_scoped_tool_denied",
            limit,
        };
    }
    return {
        allowed: true,
        toolName: input.toolName,
        toolKind,
        depth,
        reasonCode: "depth_scoped_tool_allowed",
        ...(limit !== undefined ? { limit } : {}),
    };
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
function namesMatchAny(names, values) {
    const normalized = makeSet(values);
    return [...names].some((name) => normalized.has(name));
}
function resolveAgentBindingDecision(input) {
    const bindingId = nonEmpty(input.bindingId);
    if (!bindingId)
        return { ok: true };
    const binding = getAgentCapabilityBinding(bindingId);
    if (!binding) {
        return {
            ok: false,
            reasonCode: "capability_binding_not_found",
            userMessage: "에이전트 capability binding을 찾을 수 없어 도구를 실행하지 않았습니다.",
            bindingId,
            diagnostic: { bindingId, agentId: input.agentId },
        };
    }
    if (binding.agent_id !== input.agentId) {
        return {
            ok: false,
            reasonCode: "capability_binding_owner_mismatch",
            userMessage: "다른 에이전트의 capability binding은 사용할 수 없습니다.",
            bindingId,
            diagnostic: {
                bindingId,
                requestedAgentId: input.agentId,
                bindingAgentId: binding.agent_id,
            },
        };
    }
    if (binding.status !== "enabled") {
        return {
            ok: false,
            reasonCode: binding.status === "archived"
                ? "capability_binding_archived"
                : "capability_binding_disabled",
            userMessage: "비활성화된 capability binding은 사용할 수 없습니다.",
            bindingId,
            diagnostic: { bindingId, agentId: input.agentId, status: binding.status },
        };
    }
    if (input.mcpTool) {
        const catalogNames = makeSet([binding.catalog_id, binding.catalog_id.replace(/^mcp:/u, "")]);
        if (binding.capability_kind !== "mcp_server" ||
            !catalogNames.has(normalizeToken(input.mcpTool.serverId))) {
            return {
                ok: false,
                reasonCode: "capability_binding_tool_mismatch",
                userMessage: "이 MCP 도구는 지정된 capability binding에 속하지 않습니다.",
                bindingId,
                diagnostic: {
                    bindingId,
                    agentId: input.agentId,
                    bindingKind: binding.capability_kind,
                    catalogId: binding.catalog_id,
                    mcpTool: input.mcpTool,
                },
            };
        }
    }
    const names = new Set([normalizeToken(input.toolName)]);
    if (input.mcpTool) {
        names.add(normalizeToken(input.mcpTool.toolName));
        names.add(normalizeToken(`${input.mcpTool.serverId}:${input.mcpTool.toolName}`));
        names.add(normalizeToken(input.mcpTool.registeredName));
    }
    if (namesMatchAny(names, parseJsonStringList(binding.disabled_tool_names_json))) {
        return {
            ok: false,
            reasonCode: "tool_not_allowed",
            userMessage: "이 capability binding에서 비활성화된 도구입니다.",
            bindingId,
            diagnostic: { bindingId, agentId: input.agentId, toolName: input.toolName },
        };
    }
    const enabledToolNames = parseJsonStringList(binding.enabled_tool_names_json);
    if (enabledToolNames.length > 0 && !namesMatchAny(names, enabledToolNames)) {
        return {
            ok: false,
            reasonCode: "tool_not_allowed",
            userMessage: "이 capability binding에 허용되지 않은 도구입니다.",
            bindingId,
            diagnostic: { bindingId, agentId: input.agentId, toolName: input.toolName },
        };
    }
    return {
        ok: true,
        bindingId,
        diagnostic: {
            bindingId,
            agentId: input.agentId,
            capabilityKind: binding.capability_kind,
            catalogId: binding.catalog_id,
        },
    };
}
function fallbackAllows(input) {
    const allowed = makeSet(input.values ?? []);
    if (allowed.size === 0)
        return false;
    const names = new Set([normalizeToken(input.toolName)]);
    if (input.bindingId)
        names.add(normalizeToken(input.bindingId));
    if (input.mcpTool) {
        names.add(normalizeToken(input.mcpTool.serverId));
        names.add(normalizeToken(`${input.mcpTool.serverId}:${input.mcpTool.toolName}`));
        names.add(normalizeToken(input.mcpTool.registeredName));
    }
    return [...names].some((name) => allowed.has(name));
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
    const depthDecision = evaluateDepthScopedToolPolicy({
        toolName: input.toolName,
        ...(input.ctx.delegationDepth !== undefined ? { depth: input.ctx.delegationDepth } : {}),
        ...(input.ctx.depthScopedToolPolicy ? { policy: input.ctx.depthScopedToolPolicy } : {}),
    });
    if (!depthDecision.allowed) {
        return {
            allowed: false,
            toolName: input.toolName,
            capabilityRisk,
            approvalRequired: false,
            reasonCode: "depth_scoped_tool_denied",
            userMessage: "현재 중첩 위임 depth에서 허용되지 않은 도구입니다.",
            agentId: input.ctx.agentId,
            permissionProfileId: policy.permissionProfile.profileId,
            diagnostic: {
                capabilityRisk,
                agentId: input.ctx.agentId,
                toolKind: depthDecision.toolKind,
                depth: depthDecision.depth,
                limit: depthDecision.limit ?? null,
            },
        };
    }
    const bindingDecision = resolveAgentBindingDecision({
        toolName: input.toolName,
        agentId: input.ctx.agentId,
        ...(input.ctx.capabilityBindingId ? { bindingId: input.ctx.capabilityBindingId } : {}),
        mcpTool,
    });
    if (!bindingDecision.ok) {
        return {
            allowed: false,
            toolName: input.toolName,
            capabilityRisk,
            approvalRequired: false,
            reasonCode: bindingDecision.reasonCode,
            userMessage: bindingDecision.userMessage,
            agentId: input.ctx.agentId,
            ...(bindingDecision.bindingId ? { bindingId: bindingDecision.bindingId } : {}),
            permissionProfileId: policy.permissionProfile.profileId,
            diagnostic: {
                capabilityRisk,
                agentId: input.ctx.agentId,
                ...bindingDecision.diagnostic,
            },
        };
    }
    const allowlist = policy.skillMcpAllowlist
        ? normalizeSkillMcpAllowlist(policy.skillMcpAllowlist)
        : EMPTY_ALLOWLIST;
    const parentSecretFallbackRequested = Boolean(input.ctx.parentSecretScopeId) && !input.ctx.secretScopeId && !allowlist.secretScopeId;
    if (parentSecretFallbackRequested && !input.ctx.allowParentSecretFallback) {
        return {
            allowed: false,
            toolName: input.toolName,
            capabilityRisk,
            approvalRequired: false,
            reasonCode: "parent_secret_fallback_forbidden",
            userMessage: "상위 에이전트 secret fallback은 명시 허용 없이는 사용할 수 없습니다.",
            agentId: input.ctx.agentId,
            ...(bindingDecision.bindingId ? { bindingId: bindingDecision.bindingId } : {}),
            permissionProfileId: policy.permissionProfile.profileId,
            diagnostic: {
                capabilityRisk,
                agentId: input.ctx.agentId,
                parentSecretFallbackRequested: true,
            },
        };
    }
    if (parentSecretFallbackRequested &&
        !fallbackAllows({
            toolName: input.toolName,
            ...(input.ctx.fallbackSecretScopeAllowlist
                ? { values: input.ctx.fallbackSecretScopeAllowlist }
                : {}),
            ...(bindingDecision.bindingId ? { bindingId: bindingDecision.bindingId } : {}),
            mcpTool,
        })) {
        return {
            allowed: false,
            toolName: input.toolName,
            capabilityRisk,
            approvalRequired: false,
            reasonCode: "parent_secret_fallback_not_allowlisted",
            userMessage: "상위 에이전트 secret fallback allowlist에 없는 capability입니다.",
            agentId: input.ctx.agentId,
            ...(bindingDecision.bindingId ? { bindingId: bindingDecision.bindingId } : {}),
            permissionProfileId: policy.permissionProfile.profileId,
            diagnostic: {
                capabilityRisk,
                agentId: input.ctx.agentId,
                fallbackAllowlist: input.ctx.fallbackSecretScopeAllowlist ?? [],
            },
        };
    }
    if (parentSecretFallbackRequested && !input.ctx.auditId?.trim()) {
        return {
            allowed: false,
            toolName: input.toolName,
            capabilityRisk,
            approvalRequired: false,
            reasonCode: "parent_secret_fallback_audit_required",
            userMessage: "상위 에이전트 secret fallback에는 audit id가 필요합니다.",
            agentId: input.ctx.agentId,
            ...(bindingDecision.bindingId ? { bindingId: bindingDecision.bindingId } : {}),
            permissionProfileId: policy.permissionProfile.profileId,
            diagnostic: { capabilityRisk, agentId: input.ctx.agentId },
        };
    }
    const secretScopeId = input.ctx.secretScopeId ?? allowlist.secretScopeId ?? input.ctx.parentSecretScopeId;
    if (mcpTool && !secretScopeId?.trim()) {
        return {
            allowed: false,
            toolName: input.toolName,
            capabilityRisk,
            approvalRequired: false,
            reasonCode: "secret_scope_required",
            userMessage: "MCP 도구 실행에는 에이전트 전용 secret scope가 필요합니다.",
            agentId: input.ctx.agentId,
            ...(bindingDecision.bindingId ? { bindingId: bindingDecision.bindingId } : {}),
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
            ...(bindingDecision.bindingId ? { bindingId: bindingDecision.bindingId } : {}),
            permissionProfileId: policy.permissionProfile.profileId,
            ...(secretScopeId ? { secretScopeId } : {}),
            mcpTool,
            diagnostic: { capabilityRisk, agentId: input.ctx.agentId, mcpTool },
        };
    }
    if (input.ctx.secretScopeId &&
        allowlist.secretScopeId &&
        input.ctx.secretScopeId !== allowlist.secretScopeId) {
        return {
            allowed: false,
            toolName: input.toolName,
            capabilityRisk,
            approvalRequired: false,
            reasonCode: "secret_scope_mismatch",
            userMessage: "에이전트에 허용된 secret scope와 실행 scope가 일치하지 않습니다.",
            agentId: input.ctx.agentId,
            ...(bindingDecision.bindingId ? { bindingId: bindingDecision.bindingId } : {}),
            permissionProfileId: policy.permissionProfile.profileId,
            ...(secretScopeId ? { secretScopeId } : {}),
            ...(mcpTool ? { mcpTool } : {}),
            diagnostic: {
                capabilityRisk,
                agentId: input.ctx.agentId,
                configuredSecretScope: allowlist.secretScopeId,
            },
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
            ...(bindingDecision.bindingId ? { bindingId: bindingDecision.bindingId } : {}),
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
            ...(bindingDecision.bindingId ? { bindingId: bindingDecision.bindingId } : {}),
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
            ...(bindingDecision.bindingId ? { bindingId: bindingDecision.bindingId } : {}),
            permissionProfileId: policy.permissionProfile.profileId,
            ...(secretScopeId ? { secretScopeId } : {}),
            ...(mcpTool ? { mcpTool } : {}),
            diagnostic: {
                capabilityRisk,
                agentId: input.ctx.agentId,
                profileId: policy.permissionProfile.profileId,
            },
        };
    }
    const approvalRequired = isRiskAtLeast(capabilityRisk, policy.permissionProfile.approvalRequiredFrom);
    const rateLimitKey = [
        "agent",
        input.ctx.agentId,
        bindingDecision.bindingId ? `binding:${bindingDecision.bindingId}` : "binding:implicit",
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
        ...(bindingDecision.bindingId ? { bindingId: bindingDecision.bindingId } : {}),
        permissionProfileId: policy.permissionProfile.profileId,
        ...(secretScopeId ? { secretScopeId } : {}),
        ...(parentSecretFallbackRequested ? { parentSecretFallback: true } : {}),
        rateLimitKey,
        ...(policy.rateLimit ? { rateLimit: policy.rateLimit } : {}),
        ...(mcpTool ? { mcpTool } : {}),
        diagnostic: {
            capabilityRisk,
            agentId: input.ctx.agentId,
            ...(bindingDecision.bindingId ? { bindingId: bindingDecision.bindingId } : {}),
            permissionProfileId: policy.permissionProfile.profileId,
            approvalRequired,
            parentSecretFallback: parentSecretFallbackRequested,
            rateLimitKey,
            ...(bindingDecision.diagnostic ? { binding: bindingDecision.diagnostic } : {}),
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
    if (/^(mouse_|keyboard_|window_focus|screen_|yeonjang_camera_capture|app_launch)/u.test(toolName) &&
        !profile.allowScreenControl)
        return "screen_control_not_allowed";
    return null;
}
export function toAgentCapabilityCallContext(ctx) {
    const policy = contextPolicy(ctx);
    const permissionProfile = policy.permissionProfile;
    const skillMcpAllowlist = policy.skillMcpAllowlist;
    const secretScopeId = ctx.secretScopeId ?? skillMcpAllowlist?.secretScopeId ?? ctx.parentSecretScopeId;
    const auditId = ctx.auditId;
    if (!ctx.agentId || !permissionProfile || !skillMcpAllowlist || !secretScopeId || !auditId)
        return null;
    return {
        agentId: ctx.agentId,
        sessionId: ctx.sessionId,
        ...(ctx.capabilityBindingId ? { bindingId: ctx.capabilityBindingId } : {}),
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
    const rateLimitKey = input.decision.rateLimitKey;
    if (!input.decision.allowed || !rateLimitKey || !input.decision.rateLimit) {
        return { key: "none", release: () => { } };
    }
    const now = input.now ?? Date.now();
    const state = rateLimitState.get(rateLimitKey) ?? { concurrent: 0, calls: [] };
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
    rateLimitState.set(rateLimitKey, state);
    let released = false;
    return {
        key: rateLimitKey,
        release: () => {
            if (released)
                return;
            released = true;
            const current = rateLimitState.get(rateLimitKey);
            if (!current)
                return;
            current.concurrent = Math.max(0, current.concurrent - 1);
            rateLimitState.set(rateLimitKey, current);
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
    const inserted = insertCapabilityDelegation(delegation, options);
    if (inserted) {
        recordCapabilityDelegationAudit({
            delegation,
            status: delegation.status,
            reasonCode: "capability_delegation_requested",
            auditId: options.auditId ?? delegation.identity.auditCorrelationId ?? null,
            ...(options.now !== undefined ? { now: options.now } : {}),
        });
    }
    return inserted;
}
function parseDelegationContract(row) {
    if (!row)
        return undefined;
    try {
        const parsed = JSON.parse(row.contract_json);
        return parsed && typeof parsed === "object"
            ? parsed
            : undefined;
    }
    catch {
        return undefined;
    }
}
function parseSubSessionContract(row) {
    if (!row)
        return undefined;
    try {
        const parsed = JSON.parse(row.contract_json);
        return parsed && typeof parsed === "object" ? parsed : undefined;
    }
    catch {
        return undefined;
    }
}
function recordCapabilityDelegationAudit(input) {
    const now = input.now ?? Date.now();
    try {
        insertAuditLog({
            timestamp: now,
            session_id: input.delegation.identity.parent?.parentSessionId ?? null,
            run_id: input.delegation.identity.parent?.parentRunId ?? null,
            request_group_id: null,
            channel: null,
            source: "capability_delegation",
            tool_name: input.delegation.capability,
            params: JSON.stringify({
                delegationId: input.delegation.delegationId,
                requester: input.delegation.requester,
                provider: input.delegation.provider,
                risk: input.delegation.risk,
                inputPackageIds: input.delegation.inputPackageIds,
            }),
            output: JSON.stringify({
                status: input.status,
                reasonCode: input.reasonCode,
                ...(input.detail ? input.detail : {}),
            }),
            result: input.status === "denied" || input.status === "expired" || input.status === "failed"
                ? "failed"
                : "success",
            duration_ms: 0,
            approval_required: input.status === "requested" || input.status === "approved" ? 1 : 0,
            approved_by: input.status === "approved" ? (input.delegation.approvalId ?? "approval") : null,
            error_code: input.status === "denied" || input.status === "expired" || input.status === "failed"
                ? input.reasonCode
                : null,
            retry_count: 0,
            stop_reason: input.status === "denied" || input.status === "expired" ? input.reasonCode : null,
        });
    }
    catch {
        // Audit logging should not change capability lifecycle decisions.
    }
    try {
        return recordControlEvent({
            eventType: `capability.delegation.${input.status}`,
            component: "capability.delegation",
            ...(input.delegation.identity.parent?.parentRunId
                ? { runId: input.delegation.identity.parent.parentRunId }
                : {}),
            correlationId: input.auditId ?? input.delegation.delegationId,
            severity: input.status === "denied" || input.status === "expired" || input.status === "failed"
                ? "warning"
                : "info",
            summary: `${input.delegation.capability} delegation ${input.status}`,
            detail: {
                delegationId: input.delegation.delegationId,
                requester: input.delegation.requester,
                provider: input.delegation.provider,
                risk: input.delegation.risk,
                reasonCode: input.reasonCode,
                ...(input.detail ? input.detail : {}),
            },
        });
    }
    catch {
        return null;
    }
}
const CAPABILITY_DELEGATION_TRANSITIONS = {
    requested: ["approved", "denied", "expired", "failed"],
    approved: ["completed", "failed"],
    denied: [],
    expired: [],
    completed: [],
    failed: [],
};
export function updateCapabilityDelegationLifecycle(input) {
    const row = getCapabilityDelegation(input.delegationId);
    const delegation = parseDelegationContract(row);
    if (!row || !delegation) {
        return {
            ok: false,
            delegationId: input.delegationId,
            status: input.status,
            reasonCode: "capability_delegation_not_found",
        };
    }
    if (!CAPABILITY_DELEGATION_TRANSITIONS[delegation.status].includes(input.status)) {
        return {
            ok: false,
            delegationId: input.delegationId,
            previousStatus: delegation.status,
            status: input.status,
            reasonCode: "capability_delegation_transition_denied",
        };
    }
    const next = {
        ...delegation,
        status: input.status,
        ...(input.resultPackageId !== undefined && input.resultPackageId !== null
            ? { resultPackageId: input.resultPackageId }
            : {}),
        ...(input.approvalId !== undefined && input.approvalId !== null
            ? { approvalId: input.approvalId }
            : {}),
    };
    const updated = updateCapabilityDelegation({
        delegationId: input.delegationId,
        status: input.status,
        ...(input.resultPackageId !== undefined ? { resultPackageId: input.resultPackageId } : {}),
        ...(input.approvalId !== undefined ? { approvalId: input.approvalId } : {}),
        contract: next,
    }, {
        auditId: input.auditId ?? row.audit_id,
        ...(input.now !== undefined ? { now: input.now } : {}),
    });
    if (!updated) {
        return {
            ok: false,
            delegationId: input.delegationId,
            previousStatus: delegation.status,
            status: input.status,
            reasonCode: "capability_delegation_update_failed",
        };
    }
    const reasonCode = input.reasonCode ?? `capability_delegation_${input.status}`;
    const auditEventId = recordCapabilityDelegationAudit({
        delegation: next,
        status: input.status,
        reasonCode,
        auditId: input.auditId ?? row.audit_id,
        ...(input.now !== undefined ? { now: input.now } : {}),
    });
    return {
        ok: true,
        delegationId: input.delegationId,
        previousStatus: delegation.status,
        status: input.status,
        reasonCode,
        ...(auditEventId !== undefined ? { auditEventId } : {}),
    };
}
export function applyCapabilityDelegationApprovalDecision(input) {
    const status = input.decision === "approve"
        ? "approved"
        : input.decision === "expire"
            ? "expired"
            : input.decision === "fail"
                ? "failed"
                : "denied";
    const reasonCode = input.decision === "approve"
        ? "capability_delegation_approved"
        : (input.denialReason ?? (input.decision === "expire" ? "timeout" : "permission_denied"));
    const result = updateCapabilityDelegationLifecycle({
        delegationId: input.delegationId,
        status,
        ...(input.approvalId ? { approvalId: input.approvalId } : {}),
        reasonCode,
        ...(input.auditId !== undefined ? { auditId: input.auditId } : {}),
        ...(input.now !== undefined ? { now: input.now } : {}),
    });
    if (!result.ok)
        return result;
    const runId = input.parentRunId;
    if (runId) {
        appendRunEvent(runId, `capability_delegation_${status}:${input.delegationId}`);
        if (status === "approved") {
            setRunStepStatus(runId, "awaiting_approval", "completed", "Capability approval accepted.");
            updateRunStatus(runId, "running", "Capability approval accepted; continuing sub-session.", true);
        }
        else {
            setRunStepStatus(runId, "awaiting_approval", "cancelled", `Capability approval stopped: ${reasonCode}`);
            updateRunStatus(runId, "cancelled", `Capability approval stopped: ${reasonCode}`, false);
        }
    }
    if (input.subSessionId) {
        const subSession = parseSubSessionContract(getRunSubSession(input.subSessionId));
        if (subSession) {
            const nextStatus = status === "approved" ? "queued" : "cancelled";
            updateRunSubSession({
                ...subSession,
                status: nextStatus,
                ...(nextStatus === "cancelled" ? { finishedAt: input.now ?? Date.now() } : {}),
            }, {
                ...(input.auditId !== undefined ? { auditId: input.auditId } : {}),
                ...(input.now !== undefined ? { now: input.now } : {}),
            });
        }
    }
    return result;
}
export function buildCapabilityResultDataExchange(input) {
    const sanitizedPayload = stripHandleLikePayload(input.payload);
    const defaultProvenanceRefs = [
        `tool:${input.delegation.capability}`,
        `opaque:delegation:${input.delegation.delegationId}`,
        ...(input.delegation.identity.parent?.parentRunId
            ? [`run:${input.delegation.identity.parent.parentRunId}`]
            : []),
    ];
    return createDataExchangePackage({
        sourceOwner: input.delegation.provider,
        recipientOwner: input.delegation.requester,
        purpose: `capability delegation result: ${input.delegation.capability}`,
        allowedUse: "verification_only",
        retentionPolicy: "session_only",
        redactionState: "not_sensitive",
        provenanceRefs: input.provenanceRefs ?? defaultProvenanceRefs,
        payload: {
            ...sanitizedPayload,
            delegationId: input.delegation.delegationId,
            capability: input.delegation.capability,
            resultSharing: "data_exchange_only",
        },
        ...(input.exchangeId ? { exchangeId: input.exchangeId } : {}),
        ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
        ...(input.now ? { now: input.now } : {}),
        ...(Object.prototype.hasOwnProperty.call(input, "expiresAt")
            ? { expiresAt: input.expiresAt ?? null }
            : {}),
        ...(input.delegation.identity.parent?.parentRunId
            ? { parentRunId: input.delegation.identity.parent.parentRunId }
            : {}),
        ...(input.delegation.identity.parent?.parentSessionId
            ? { parentSessionId: input.delegation.identity.parent.parentSessionId }
            : {}),
        ...(input.delegation.identity.parent?.parentSubSessionId
            ? { parentSubSessionId: input.delegation.identity.parent.parentSubSessionId }
            : {}),
        ...(input.delegation.identity.parent?.parentRequestId
            ? { parentRequestId: input.delegation.identity.parent.parentRequestId }
            : {}),
        ...(input.delegation.identity.auditCorrelationId
            ? { auditCorrelationId: input.delegation.identity.auditCorrelationId }
            : {}),
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
export function mapDangerousFixtureRiskLevel(riskLevel) {
    switch (riskLevel) {
        case "low":
            return "moderate";
        case "medium":
            return "external";
        case "high":
            return "sensitive";
        case "critical":
            return "dangerous";
    }
}
export function buildDangerousCapabilityFixtureMatrix() {
    const rows = [
        { riskLevel: "low", approvalActor: "parent_agent", approvalTimeoutMs: 30_000 },
        { riskLevel: "medium", approvalActor: "parent_agent", approvalTimeoutMs: 45_000 },
        { riskLevel: "medium", approvalActor: "user", approvalTimeoutMs: 45_000 },
        { riskLevel: "high", approvalActor: "user", approvalTimeoutMs: 60_000 },
        { riskLevel: "high", approvalActor: "admin", approvalTimeoutMs: 60_000 },
        { riskLevel: "critical", approvalActor: "admin", approvalTimeoutMs: 90_000 },
        {
            riskLevel: "medium",
            approvalActor: "parent_agent",
            approvalTimeoutMs: 45_000,
            denialReason: "permission_denied",
        },
        {
            riskLevel: "high",
            approvalActor: "user",
            approvalTimeoutMs: 60_000,
            denialReason: "risk_ceiling_exceeded",
        },
        {
            riskLevel: "critical",
            approvalActor: "admin",
            approvalTimeoutMs: 90_000,
            denialReason: "timeout",
        },
        {
            riskLevel: "critical",
            approvalActor: "admin",
            approvalTimeoutMs: 90_000,
            denialReason: "revoked",
        },
    ];
    return rows.map((row) => evaluateDangerousCapabilityApprovalFixture(row));
}
export function evaluateDangerousCapabilityApprovalFixture(input) {
    const capabilityRisk = mapDangerousFixtureRiskLevel(input.riskLevel);
    const approvalTimeoutMs = Math.max(1_000, input.approvalTimeoutMs ?? 60_000);
    if (input.denialReason === "timeout") {
        return {
            riskLevel: input.riskLevel,
            capabilityRisk,
            approvalActor: input.approvalActor,
            approvalTimeoutMs,
            denialReason: input.denialReason,
            expectedStatus: "expired",
            reasonCode: "timeout",
        };
    }
    if (input.denialReason) {
        return {
            riskLevel: input.riskLevel,
            capabilityRisk,
            approvalActor: input.approvalActor,
            approvalTimeoutMs,
            denialReason: input.denialReason,
            expectedStatus: "denied",
            reasonCode: input.denialReason,
        };
    }
    return {
        riskLevel: input.riskLevel,
        capabilityRisk,
        approvalActor: input.approvalActor,
        approvalTimeoutMs,
        expectedStatus: "approved",
        reasonCode: "approval_granted",
    };
}
//# sourceMappingURL=capability-isolation.js.map