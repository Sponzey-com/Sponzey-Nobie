import crypto from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { PATHS, getConfig } from "../config/index.js";
import { insertAuditLog, insertDiagnosticEvent } from "../db/index.js";
import { sanitizeUserFacingError } from "../runs/error-sanitizer.js";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_FAILURE_DEGRADE_THRESHOLD = 2;
const failureStates = new Map();
function stableStringify(value) {
    if (value === null || typeof value !== "object")
        return JSON.stringify(value);
    if (Array.isArray(value))
        return `[${value.map((item) => stableStringify(item)).join(",")}]`;
    return `{${Object.entries(value)
        .filter(([, nested]) => nested !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`)
        .join(",")}}`;
}
function sha256(value) {
    return crypto.createHash("sha256").update(value).digest("hex");
}
function checksumValue(value) {
    return sha256(stableStringify(value));
}
function safeFileChecksum(filePath) {
    if (!filePath)
        return null;
    try {
        const resolved = resolve(filePath);
        if (!existsSync(resolved))
            return null;
        return sha256(readFileSync(resolved));
    }
    catch {
        return null;
    }
}
function riskToPermissionScope(riskLevel) {
    if (riskLevel === "dangerous")
        return "dangerous";
    if (riskLevel === "moderate")
        return "moderate";
    return "safe";
}
function permissionNeedsApproval(scope, trustLevel) {
    return scope === "dangerous" || (trustLevel === "external" && scope !== "safe");
}
function trustPolicyFor(input) {
    const requiresApproval = permissionNeedsApproval(input.permissionScope, input.trustLevel);
    const approved = input.approved ?? !requiresApproval;
    const userFacingRecommended = input.trustLevel !== "external" || Boolean(input.externalRecommended && approved);
    return {
        trustLevel: input.trustLevel,
        requiresApproval,
        approved,
        userFacingRecommended,
        reason: requiresApproval
            ? "위험 권한 또는 외부 확장이므로 명시 승인 후 활성화해야 합니다."
            : "현재 신뢰 정책에서 자동 사용 가능한 확장입니다.",
    };
}
function rollbackPath(extensionId) {
    const safeId = extensionId.replace(/[^a-zA-Z0-9_.-]+/g, "_");
    return join(PATHS.stateDir, "extensions", "rollback", `${safeId}.json`);
}
function hasRollbackPoint(extensionId) {
    return existsSync(rollbackPath(extensionId));
}
function statusFor(enabled, ready, error, extensionId) {
    const failure = failureStates.get(extensionId);
    if (failure?.degraded)
        return "degraded";
    if (!enabled)
        return "disabled";
    if (error)
        return "error";
    if (ready === true)
        return "ready";
    if (ready === false)
        return "error";
    return "unknown";
}
function applyFailureState(entry) {
    const state = failureStates.get(entry.id);
    if (!state)
        return entry;
    return {
        ...entry,
        status: state.degraded ? "degraded" : entry.status,
        failureCount: state.failureCount,
        degradedReason: state.degraded ? state.reason : entry.degradedReason,
    };
}
function makeEntry(input) {
    return applyFailureState({
        id: input.id,
        kind: input.kind,
        label: input.label,
        version: input.version,
        checksum: checksumValue(input.checksumInput),
        permissionScope: input.permissionScope,
        timeoutMs: input.timeoutMs,
        enabled: input.enabled,
        priority: input.priority,
        status: input.status,
        trustPolicy: trustPolicyFor({
            trustLevel: input.trustLevel,
            permissionScope: input.permissionScope,
            ...(input.trustApproved !== undefined ? { approved: input.trustApproved } : {}),
            ...(input.externalRecommended !== undefined ? { externalRecommended: input.externalRecommended } : {}),
        }),
        failureCount: 0,
        degradedReason: null,
        sourcePath: input.sourcePath,
        rollbackAvailable: hasRollbackPoint(input.id),
        metadata: input.metadata,
    });
}
function mcpServerEntry(name, serverConfig, status) {
    const enabled = serverConfig.enabled !== false;
    const transport = serverConfig.transport ?? (serverConfig.url ? "http" : "stdio");
    const permissionScope = transport === "http" || serverConfig.url ? "network" : "local";
    const timeoutMs = Math.max(1, serverConfig.toolTimeoutSec ?? 30) * 1000;
    const error = status?.error ?? null;
    return makeEntry({
        id: `mcp:${name}`,
        kind: "mcp_server",
        label: name,
        version: "config",
        permissionScope,
        timeoutMs,
        enabled,
        priority: null,
        status: statusFor(enabled, status?.ready ?? null, error, `mcp:${name}`),
        sourcePath: typeof serverConfig.cwd === "string" ? serverConfig.cwd : null,
        trustLevel: transport === "http" ? "external" : "local",
        checksumInput: {
            name,
            enabled,
            transport,
            command: serverConfig.command ?? null,
            args: serverConfig.args ?? [],
            cwd: serverConfig.cwd ?? null,
            url: serverConfig.url ?? null,
            required: Boolean(serverConfig.required),
            timeoutMs,
            enabledTools: serverConfig.enabledTools ?? [],
            disabledTools: serverConfig.disabledTools ?? [],
        },
        metadata: {
            required: Boolean(serverConfig.required),
            transport,
            command: serverConfig.command ?? null,
            url: serverConfig.url ?? null,
            toolCount: status?.toolCount ?? 0,
            registeredToolCount: status?.registeredToolCount ?? 0,
            error,
        },
    });
}
function mcpToolEntry(serverName, tool, serverConfig) {
    const timeoutMs = Math.max(1, serverConfig.toolTimeoutSec ?? 30) * 1000;
    return makeEntry({
        id: `mcp-tool:${tool.registeredName}`,
        kind: "mcp_tool",
        label: tool.registeredName,
        version: "runtime",
        permissionScope: "moderate",
        timeoutMs,
        enabled: serverConfig.enabled !== false,
        priority: null,
        status: statusFor(serverConfig.enabled !== false, true, null, `mcp-tool:${tool.registeredName}`),
        sourcePath: typeof serverConfig.cwd === "string" ? serverConfig.cwd : null,
        trustLevel: serverConfig.transport === "http" || serverConfig.url ? "external" : "local",
        checksumInput: { serverName, tool },
        metadata: { serverName, originalName: tool.name, description: tool.description },
    });
}
function toolEntry(tool) {
    const kind = tool.name.startsWith("mcp__")
        ? "mcp_tool"
        : tool.name.startsWith("yeonjang_")
            ? "yeonjang_tool"
            : "internal_tool";
    const id = kind === "mcp_tool" ? `mcp-tool:${tool.name}` : `tool:${tool.name}`;
    return makeEntry({
        id,
        kind,
        label: tool.name,
        version: "runtime",
        permissionScope: riskToPermissionScope(tool.riskLevel),
        timeoutMs: DEFAULT_TIMEOUT_MS,
        enabled: true,
        priority: null,
        status: statusFor(true, true, null, id),
        sourcePath: null,
        trustLevel: kind === "internal_tool" || kind === "yeonjang_tool" ? "builtin" : "local",
        checksumInput: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
            riskLevel: tool.riskLevel,
            requiresApproval: tool.requiresApproval,
            availableSources: tool.availableSources ?? null,
        },
        metadata: { riskLevel: tool.riskLevel, requiresApproval: tool.requiresApproval },
    });
}
function skillEntry(skill) {
    const sourcePath = skill.path ?? null;
    const fileChecksum = safeFileChecksum(sourcePath);
    const trustLevel = skill.source === "builtin" ? "builtin" : "local";
    return makeEntry({
        id: `skill:${skill.id}`,
        kind: "skill",
        label: skill.label || skill.id,
        version: "config",
        permissionScope: skill.source === "local" ? "local" : "safe",
        timeoutMs: DEFAULT_TIMEOUT_MS,
        enabled: skill.enabled,
        priority: null,
        status: statusFor(skill.enabled, skill.enabled, null, `skill:${skill.id}`),
        sourcePath,
        trustLevel,
        checksumInput: { ...skill, fileChecksum },
        metadata: { description: skill.description, source: skill.source, required: Boolean(skill.required), fileChecksum },
    });
}
export function buildExtensionRegistrySnapshot(input = {}) {
    const config = input.config ?? getConfig();
    const mcpStatuses = new Map((input.mcpStatuses ?? []).map((status) => [status.name, status]));
    const entries = new Map();
    for (const [name, serverConfig] of Object.entries(config.mcp?.servers ?? {})) {
        const status = mcpStatuses.get(name);
        const server = mcpServerEntry(name, serverConfig, status);
        entries.set(server.id, server);
        for (const tool of status?.tools ?? [])
            entries.set(`mcp-tool:${tool.registeredName}`, mcpToolEntry(name, tool, serverConfig));
    }
    for (const skill of config.skills?.items ?? [])
        entries.set(`skill:${skill.id}`, skillEntry(skill));
    for (const tool of input.tools ?? []) {
        const entry = toolEntry(tool);
        entries.set(entry.id, entry);
    }
    for (const state of failureStates.values()) {
        if (entries.has(state.extensionId))
            continue;
        const kind = state.extensionId.startsWith("mcp:")
            ? "mcp_server"
            : state.extensionId.startsWith("mcp-tool:")
                ? "mcp_tool"
                : state.extensionId.startsWith("yeonjang")
                    ? "yeonjang_tool"
                    : "plugin";
        entries.set(state.extensionId, makeEntry({
            id: state.extensionId,
            kind,
            label: state.extensionId,
            version: "runtime",
            permissionScope: "unknown",
            timeoutMs: DEFAULT_TIMEOUT_MS,
            enabled: false,
            priority: null,
            status: "degraded",
            sourcePath: null,
            trustLevel: "unknown",
            checksumInput: { state },
            metadata: { synthetic: true, lastFailureAt: state.lastFailureAt, lastError: state.lastError },
        }));
    }
    const ordered = [...entries.values()].sort((left, right) => {
        if (left.priority !== right.priority)
            return (right.priority ?? -Infinity) - (left.priority ?? -Infinity);
        return left.id.localeCompare(right.id);
    });
    const checksum = checksumValue(ordered.map((entry) => ({
        id: entry.id,
        kind: entry.kind,
        version: entry.version,
        checksum: entry.checksum,
        enabled: entry.enabled,
        status: entry.status,
        permissionScope: entry.permissionScope,
    })));
    return {
        kind: "nobie.extension.registry",
        version: 1,
        createdAt: (input.now ?? new Date()).toISOString(),
        checksum,
        totalCount: ordered.length,
        enabledCount: ordered.filter((entry) => entry.enabled).length,
        disabledCount: ordered.filter((entry) => !entry.enabled || entry.status === "disabled").length,
        degradedCount: ordered.filter((entry) => entry.status === "degraded" || entry.status === "error").length,
        dangerousCount: ordered.filter((entry) => entry.permissionScope === "dangerous").length,
        entries: ordered,
    };
}
export function extensionIdsForToolName(toolName) {
    const ids = [`tool:${toolName}`, `mcp-tool:${toolName}`];
    const mcpMatch = toolName.match(/^mcp__(.+?)__/);
    if (mcpMatch?.[1])
        ids.push(`mcp:${mcpMatch[1]}`);
    if (toolName.startsWith("yeonjang_"))
        ids.push(`yeonjang-tool:${toolName}`);
    return ids;
}
export function isToolExtensionSelectable(toolName) {
    return extensionIdsForToolName(toolName).every((id) => !failureStates.get(id)?.degraded);
}
export function getExtensionFailureState(extensionId) {
    const state = failureStates.get(extensionId);
    return state ? { ...state } : null;
}
export function listExtensionFailureStates() {
    return [...failureStates.values()].map((state) => ({ ...state }));
}
export function resetExtensionFailureState(extensionId) {
    if (extensionId)
        failureStates.delete(extensionId);
    else
        failureStates.clear();
}
export function recordExtensionRegistryChange(input) {
    try {
        insertAuditLog({
            timestamp: Date.now(),
            session_id: null,
            run_id: null,
            request_group_id: null,
            channel: null,
            source: "extension-registry",
            tool_name: input.action,
            params: JSON.stringify({ extensionId: input.extensionId, ...(input.detail ?? {}) }),
            output: null,
            result: input.result,
            duration_ms: null,
            approval_required: 0,
            approved_by: null,
        });
    }
    catch {
        // Registry audit must not crash boot or extension isolation.
    }
}
export function recordExtensionFailure(input) {
    const sanitized = sanitizeUserFacingError(input.error instanceof Error ? input.error.message : String(input.error));
    const current = failureStates.get(input.extensionId);
    const failureCount = (current?.failureCount ?? 0) + 1;
    const degraded = failureCount >= (input.degradeAfter ?? DEFAULT_FAILURE_DEGRADE_THRESHOLD);
    const state = {
        extensionId: input.extensionId,
        failureCount,
        degraded,
        lastFailureAt: Date.now(),
        lastError: sanitized.userMessage,
        reason: degraded ? "반복 실패로 확장을 degraded 상태로 격리했습니다." : sanitized.reason,
    };
    failureStates.set(input.extensionId, state);
    try {
        insertDiagnosticEvent({
            kind: degraded ? "extension_degraded" : "extension_failure",
            summary: `${input.extensionId} ${degraded ? "degraded" : "failed"}: ${sanitized.userMessage}`,
            ...(input.runId ? { runId: input.runId } : {}),
            ...(input.requestGroupId ? { requestGroupId: input.requestGroupId } : {}),
            recoveryKey: `extension:${input.extensionId}`,
            detail: {
                extensionId: input.extensionId,
                kind: input.kind,
                failureCount,
                degraded,
                errorKind: sanitized.kind,
                reason: sanitized.reason,
                ...(input.detail ?? {}),
            },
        });
    }
    catch {
        // Diagnostic write must not amplify extension failures.
    }
    return { ...state };
}
export function recordExtensionToolFailure(input) {
    return extensionIdsForToolName(input.toolName)
        .filter((id) => id.startsWith("mcp:") || id.startsWith("mcp-tool:") || id.startsWith("yeonjang-tool:"))
        .map((extensionId) => recordExtensionFailure({
        extensionId,
        kind: extensionId.startsWith("mcp:") ? "mcp_server" : extensionId.startsWith("mcp-tool:") ? "mcp_tool" : "yeonjang_tool",
        error: input.error,
        ...(input.runId ? { runId: input.runId } : {}),
        ...(input.requestGroupId ? { requestGroupId: input.requestGroupId } : {}),
        detail: { toolName: input.toolName, ...(input.detail ?? {}) },
    }));
}
export async function runExtensionHookSafely(input, hook) {
    const timeoutMs = Math.max(1, input.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    let timeout = null;
    try {
        const result = await Promise.race([
            Promise.resolve().then(hook),
            new Promise((_, reject) => {
                timeout = setTimeout(() => reject(new Error(`extension hook ${input.extensionId}:${input.hookName} timed out after ${timeoutMs}ms`)), timeoutMs);
            }),
        ]);
        return { ok: true, result };
    }
    catch (error) {
        const state = recordExtensionFailure({
            extensionId: input.extensionId,
            kind: "hook",
            error,
            ...(input.runId ? { runId: input.runId } : {}),
            ...(input.requestGroupId ? { requestGroupId: input.requestGroupId } : {}),
            detail: { hookName: input.hookName, timeoutMs },
        });
        return { ok: false, error: state.lastError, state };
    }
    finally {
        if (timeout)
            clearTimeout(timeout);
    }
}
export function createExtensionRollbackPoint(input) {
    const sourcePath = resolve(input.sourcePath);
    const content = readFileSync(sourcePath);
    const point = {
        rollbackId: crypto.randomUUID(),
        extensionId: input.extensionId,
        sourcePath,
        checksum: sha256(content),
        contentBase64: content.toString("base64"),
        createdAt: Date.now(),
    };
    mkdirSync(join(PATHS.stateDir, "extensions", "rollback"), { recursive: true });
    writeFileSync(rollbackPath(input.extensionId), JSON.stringify(point, null, 2), "utf-8");
    recordExtensionRegistryChange({ action: "rollback_point_created", extensionId: input.extensionId, result: "success", detail: { source: basename(sourcePath), checksum: point.checksum } });
    return point;
}
export function rollbackExtensionToPoint(extensionId) {
    const point = JSON.parse(readFileSync(rollbackPath(extensionId), "utf-8"));
    writeFileSync(point.sourcePath, Buffer.from(point.contentBase64, "base64"));
    const checksum = safeFileChecksum(point.sourcePath);
    recordExtensionRegistryChange({ action: "rollback_applied", extensionId, result: checksum === point.checksum ? "success" : "failure", detail: { checksum, expectedChecksum: point.checksum } });
    return point;
}
export function activateExtensionWithTrustPolicy(entry, input = {}) {
    const approved = input.approved ?? entry.trustPolicy.approved;
    if (entry.trustPolicy.requiresApproval && !approved) {
        recordExtensionRegistryChange({ action: "extension_activation_denied", extensionId: entry.id, result: "failure", detail: { permissionScope: entry.permissionScope, trustLevel: entry.trustPolicy.trustLevel } });
        return {
            ok: false,
            entry,
            reasonCode: "approval_required",
            userMessage: "위험 권한 또는 외부 확장은 명시 승인 없이는 활성화하지 않습니다.",
        };
    }
    const next = {
        ...entry,
        enabled: true,
        status: entry.status === "disabled" ? "ready" : entry.status,
        trustPolicy: { ...entry.trustPolicy, approved: true, userFacingRecommended: true },
    };
    recordExtensionRegistryChange({ action: "extension_activation_allowed", extensionId: entry.id, result: "success", detail: { permissionScope: entry.permissionScope, trustLevel: entry.trustPolicy.trustLevel } });
    return { ok: true, entry: next, reasonCode: "activated", userMessage: "확장을 활성화했습니다." };
}
//# sourceMappingURL=extension-governance.js.map