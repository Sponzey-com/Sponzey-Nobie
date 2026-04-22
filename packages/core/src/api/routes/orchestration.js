import { authMiddleware } from "../middleware/auth.js";
import { getCurrentDisplayVersion } from "../../version.js";
import { CONTRACT_SCHEMA_VERSION, stableContractHash, toCanonicalJson, } from "../../contracts/index.js";
import { buildOrchestrationRegistrySnapshot, createAgentRegistryService, createTeamRegistryService, } from "../../orchestration/registry.js";
import { dbAgentDataExchangeToPackage, getDataExchangePackage, } from "../../memory/isolation.js";
import { getAgentConfig, getCapabilityDelegation, getTeamConfig, listAgentConfigs, listAgentDataExchangesForRecipient, listAgentDataExchangesForSource, listCapabilityDelegations, listRunSubSessionsForParentRun, listTeamConfigs, } from "../../db/index.js";
import { validateAgentConfig, validateTeamConfig, } from "../../contracts/sub-agent-orchestration.js";
import { recordMessageLedgerEvent, } from "../../runs/message-ledger.js";
function parsePositiveInt(value, fallback, max) {
    const parsed = typeof value === "string" ? Number.parseInt(value, 10) : Number(value);
    if (!Number.isFinite(parsed) || parsed < 1)
        return fallback;
    return Math.min(max, Math.floor(parsed));
}
function pagination(query) {
    return {
        page: parsePositiveInt(query["page"], 1, 10_000),
        limit: parsePositiveInt(query["limit"], 50, 500),
    };
}
function paginate(items, input) {
    const total = items.length;
    const pages = Math.max(1, Math.ceil(total / input.limit));
    const page = Math.min(input.page, pages);
    const start = (page - 1) * input.limit;
    return {
        items: items.slice(start, start + input.limit),
        total,
        page,
        pages,
        limit: input.limit,
    };
}
function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function jsonParse(value) {
    return JSON.parse(value);
}
function stripYamlComment(line) {
    let quote = null;
    for (let index = 0; index < line.length; index += 1) {
        const char = line[index];
        if ((char === "'" || char === "\"") && line[index - 1] !== "\\") {
            quote = quote === char ? null : quote ?? char;
            continue;
        }
        if (char === "#" && quote == null && (index === 0 || /\s/u.test(line[index - 1] ?? ""))) {
            return line.slice(0, index);
        }
    }
    return line;
}
function yamlLines(content) {
    return content
        .replace(/\r\n/g, "\n")
        .split("\n")
        .map((line) => stripYamlComment(line).replace(/\s+$/u, ""))
        .filter((line) => line.trim().length > 0)
        .map((line) => ({
        indent: line.match(/^ */u)?.[0].length ?? 0,
        text: line.trim(),
    }));
}
function parseYamlScalar(value) {
    const trimmed = value.trim();
    if (trimmed === "")
        return "";
    if (trimmed === "null" || trimmed === "~")
        return null;
    if (trimmed === "true")
        return true;
    if (trimmed === "false")
        return false;
    if (/^-?\d+(?:\.\d+)?$/u.test(trimmed))
        return Number(trimmed);
    if ((trimmed.startsWith("\"") && trimmed.endsWith("\""))
        || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
        return trimmed.slice(1, -1);
    }
    if ((trimmed.startsWith("[") && trimmed.endsWith("]")) || (trimmed.startsWith("{") && trimmed.endsWith("}"))) {
        return JSON.parse(trimmed);
    }
    return trimmed;
}
function splitYamlKeyValue(text) {
    const index = text.indexOf(":");
    if (index < 0)
        return [text.trim(), ""];
    return [text.slice(0, index).trim(), text.slice(index + 1).trim()];
}
function parseYamlBlock(lines, start, indent) {
    const first = lines[start];
    if (!first || first.indent < indent)
        return { value: {}, next: start };
    if (first.text.startsWith("- "))
        return parseYamlArray(lines, start, first.indent);
    return parseYamlObject(lines, start, first.indent);
}
function parseYamlObject(lines, start, indent) {
    const out = {};
    let index = start;
    while (index < lines.length) {
        const line = lines[index];
        if (line.indent < indent || line.text.startsWith("- "))
            break;
        if (line.indent > indent) {
            index += 1;
            continue;
        }
        const [key, rawValue] = splitYamlKeyValue(line.text);
        if (!key)
            throw new Error("invalid yaml key");
        if (rawValue) {
            out[key] = parseYamlScalar(rawValue);
            index += 1;
            continue;
        }
        const nextLine = lines[index + 1];
        if (!nextLine || nextLine.indent <= indent) {
            out[key] = {};
            index += 1;
            continue;
        }
        const parsed = parseYamlBlock(lines, index + 1, nextLine.indent);
        out[key] = parsed.value;
        index = parsed.next;
    }
    return { value: out, next: index };
}
function parseYamlArray(lines, start, indent) {
    const out = [];
    let index = start;
    while (index < lines.length) {
        const line = lines[index];
        if (line.indent < indent || !line.text.startsWith("- "))
            break;
        if (line.indent > indent) {
            index += 1;
            continue;
        }
        const rawValue = line.text.slice(2).trim();
        if (!rawValue) {
            const nextLine = lines[index + 1];
            if (!nextLine || nextLine.indent <= indent) {
                out.push(null);
                index += 1;
                continue;
            }
            const parsed = parseYamlBlock(lines, index + 1, nextLine.indent);
            out.push(parsed.value);
            index = parsed.next;
            continue;
        }
        if (rawValue.includes(":") && !rawValue.startsWith("\"") && !rawValue.startsWith("'")) {
            const [key, value] = splitYamlKeyValue(rawValue);
            const item = { [key]: value ? parseYamlScalar(value) : {} };
            index += 1;
            while (index < lines.length && lines[index].indent > indent) {
                const child = lines[index];
                const [childKey, childRawValue] = splitYamlKeyValue(child.text);
                if (child.text.startsWith("- "))
                    break;
                if (childRawValue) {
                    item[childKey] = parseYamlScalar(childRawValue);
                    index += 1;
                    continue;
                }
                const nextLine = lines[index + 1];
                if (!nextLine || nextLine.indent <= child.indent) {
                    item[childKey] = {};
                    index += 1;
                    continue;
                }
                const parsed = parseYamlBlock(lines, index + 1, nextLine.indent);
                item[childKey] = parsed.value;
                index = parsed.next;
            }
            out.push(item);
            continue;
        }
        out.push(parseYamlScalar(rawValue));
        index += 1;
    }
    return { value: out, next: index };
}
function parseYamlSubset(content) {
    const lines = yamlLines(content);
    if (lines.length === 0)
        return {};
    return parseYamlBlock(lines, 0, lines[0].indent).value;
}
function parseInputDocument(body) {
    if (body.package !== undefined)
        return body.package;
    const content = body.content?.trim();
    if (!content)
        return undefined;
    if (body.format === "yaml")
        return parseYamlSubset(content);
    return jsonParse(content);
}
function issue(path, message) {
    return { path, code: "contract_validation_failed", message };
}
function detectTargetTypeFromConfig(value) {
    if (!isRecord(value))
        return null;
    if (typeof value["teamId"] === "string")
        return "team";
    if (typeof value["agentId"] === "string")
        return "agent";
    return null;
}
function normalizeImportDocument(input) {
    if (!isRecord(input))
        return { issues: [issue("$", "Import document must be an object.")] };
    const maybePackageTargetType = input["targetType"] === "agent" || input["targetType"] === "team" ? input["targetType"] : undefined;
    const maybeConfig = isRecord(input["config"]) ? input["config"] : input;
    const targetType = maybePackageTargetType ?? detectTargetTypeFromConfig(maybeConfig);
    if (!targetType)
        return { issues: [issue("$.targetType", "targetType must be agent or team.")] };
    const targetId = targetType === "agent" && isRecord(maybeConfig) && typeof maybeConfig["agentId"] === "string"
        ? maybeConfig["agentId"]
        : targetType === "team" && isRecord(maybeConfig) && typeof maybeConfig["teamId"] === "string"
            ? maybeConfig["teamId"]
            : undefined;
    return {
        targetType,
        ...(targetId ? { targetId } : {}),
        config: maybeConfig,
        issues: targetId ? [] : [issue("$.config", "Config must include target id.")],
    };
}
function validationFor(targetType, config) {
    return targetType === "agent" ? validateAgentConfig(config) : validateTeamConfig(config);
}
function ownerFromQuery(query) {
    const ownerType = query["ownerType"];
    const ownerId = query["ownerId"];
    if ((ownerType === "nobie" || ownerType === "sub_agent" || ownerType === "team" || ownerType === "system")
        && typeof ownerId === "string"
        && ownerId.trim()) {
        return { ownerType, ownerId: ownerId.trim() };
    }
    return null;
}
function sanitizeString(value, path, redactedPaths) {
    let changed = false;
    const next = value
        .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, () => {
        changed = true;
        return `[redacted-ref:${path}]`;
    })
        .replace(/\bxox[baprs]-[A-Za-z0-9-]{12,}\b/g, () => {
        changed = true;
        return `[redacted-ref:${path}]`;
    })
        .replace(/\b(?:token|secret|api[_-]?key|authorization|password)\b\s*[:=]\s*["']?[A-Za-z0-9._~+/=-]{8,}["']?/giu, (match) => {
        changed = true;
        const key = match.split(/[:=]/u)[0]?.trim() || "secret";
        return `${key}: [redacted-ref:${path}]`;
    });
    if (changed)
        redactedPaths.push(path);
    return next;
}
function redactValue(value, path, redactedPaths) {
    if (typeof value === "string")
        return sanitizeString(value, path, redactedPaths);
    if (Array.isArray(value))
        return value.map((item, index) => redactValue(item, `${path}[${index}]`, redactedPaths) ?? null);
    if (value && typeof value === "object") {
        const out = {};
        for (const [key, item] of Object.entries(value)) {
            const childPath = path === "$" ? `$.${key}` : `${path}.${key}`;
            if (/^(secret|token|apiKey|api_key|authorization|password)$/iu.test(key)) {
                out[key] = `[redacted-ref:${childPath}]`;
                redactedPaths.push(childPath);
                continue;
            }
            const redacted = redactValue(item, childPath, redactedPaths);
            if (redacted !== undefined)
                out[key] = redacted;
        }
        return out;
    }
    return value;
}
function redactConfig(config) {
    const redactedPaths = [];
    const redacted = redactValue(config, "$.config", redactedPaths);
    return {
        config: redacted,
        redactedPaths,
    };
}
function buildExportPackage(targetType, config, now = Date.now()) {
    const redacted = redactConfig(config);
    const targetId = targetType === "agent" ? redacted.config.agentId : redacted.config.teamId;
    const checksum = stableContractHash({
        targetType,
        targetId,
        config: redacted.config,
    }, "agent-config-export");
    return {
        schemaVersion: CONTRACT_SCHEMA_VERSION,
        packageVersion: 1,
        targetType,
        targetId,
        compatibleNobieVersion: getCurrentDisplayVersion(),
        redactionState: redacted.redactedPaths.length > 0 ? "redacted" : "not_sensitive",
        generatedAt: now,
        checksum,
        config: redacted.config,
        redactedPaths: redacted.redactedPaths,
    };
}
function forceImportedDisabled(config, now = Date.now()) {
    return {
        ...config,
        status: "disabled",
        updatedAt: now,
    };
}
function copyConfigId(targetType, config, now = Date.now()) {
    const suffix = `copy:${now}`;
    if (targetType === "agent") {
        const agent = config;
        return {
            ...agent,
            agentId: `${agent.agentId}:${suffix}`,
            status: "disabled",
            createdAt: now,
            updatedAt: now,
        };
    }
    const team = config;
    return {
        ...team,
        teamId: `${team.teamId}:${suffix}`,
        status: "disabled",
        createdAt: now,
        updatedAt: now,
    };
}
const RISK_ORDER = new Map([
    ["safe", 0],
    ["moderate", 1],
    ["external", 2],
    ["sensitive", 3],
    ["dangerous", 4],
]);
function stringArray(value) {
    return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}
function nestedRecord(value, path) {
    let current = value;
    for (const key of path)
        current = isRecord(current) ? current[key] : undefined;
    return isRecord(current) ? current : {};
}
function detectsPermissionExpansion(before, after) {
    if (!before || "teamId" in after)
        return false;
    const beforePermission = nestedRecord(before, ["capabilityPolicy", "permissionProfile"]);
    const afterPermission = nestedRecord(after, ["capabilityPolicy", "permissionProfile"]);
    const beforeRisk = typeof beforePermission["riskCeiling"] === "string" ? beforePermission["riskCeiling"] : "safe";
    const afterRisk = typeof afterPermission["riskCeiling"] === "string" ? afterPermission["riskCeiling"] : "safe";
    if ((RISK_ORDER.get(afterRisk) ?? 0) > (RISK_ORDER.get(beforeRisk) ?? 0))
        return true;
    for (const key of ["allowExternalNetwork", "allowFilesystemWrite", "allowShellExecution", "allowScreenControl"]) {
        if (beforePermission[key] !== true && afterPermission[key] === true)
            return true;
    }
    const beforeAllowlist = nestedRecord(before, ["capabilityPolicy", "skillMcpAllowlist"]);
    const afterAllowlist = nestedRecord(after, ["capabilityPolicy", "skillMcpAllowlist"]);
    for (const key of ["enabledSkillIds", "enabledMcpServerIds", "enabledToolNames"]) {
        const previous = new Set(stringArray(beforeAllowlist[key]));
        if (stringArray(afterAllowlist[key]).some((item) => !previous.has(item)))
            return true;
    }
    return false;
}
function importEffectSummary(input) {
    const label = input.targetType === "agent" ? "agent" : "team";
    const id = input.targetType === "agent" ? input.next.agentId : input.next.teamId;
    const summary = [
        input.existing ? `update ${label}:${id}` : `create ${label}:${id}`,
        "imported config is stored disabled",
    ];
    if (input.copied)
        summary.push("conflict resolved by creating a copy");
    if (input.approvalRequired)
        summary.push("permission or capability expansion requires review before activation");
    return summary;
}
function rowConfig(row, validate) {
    if (!row)
        return undefined;
    try {
        const parsed = JSON.parse(row.config_json);
        const validation = validate(parsed);
        return validation.ok ? validation.value : undefined;
    }
    catch {
        return undefined;
    }
}
function getConfigByTarget(targetType, targetId) {
    return targetType === "agent"
        ? rowConfig(getAgentConfig(targetId), validateAgentConfig)
        : rowConfig(getTeamConfig(targetId), validateTeamConfig);
}
function recordConfigAudit(input) {
    const eventKind = input.action === "exported"
        ? input.targetType === "agent" ? "agent_config_exported" : "team_config_exported"
        : input.action === "imported"
            ? input.targetType === "agent" ? "agent_config_imported" : "team_config_imported"
            : input.targetType === "agent" ? "agent_config_changed" : "team_config_changed";
    recordMessageLedgerEvent({
        channel: "admin",
        eventKind,
        status: "succeeded",
        summary: `${input.targetType} config ${input.action}: ${input.targetId}`,
        idempotencyKey: input.idempotencyKey
            ? `config-audit:${input.action}:${input.idempotencyKey}`
            : `config-audit:${input.action}:${input.targetType}:${input.targetId}:${Date.now()}`,
        detail: {
            targetType: input.targetType,
            targetId: input.targetId,
            source: input.source,
            action: input.action,
            status: input.status ?? null,
            auditCorrelationId: input.auditCorrelationId ?? null,
            effectSummary: input.effectSummary ?? [],
            ...(input.targetType === "agent" ? { agentId: input.targetId } : { teamId: input.targetId }),
        },
    });
}
function findConfigByIdempotencyKey(targetType, idempotencyKey) {
    if (!idempotencyKey?.trim())
        return undefined;
    if (targetType === "agent") {
        const row = listAgentConfigs({ includeArchived: true }).find((candidate) => candidate.idempotency_key === idempotencyKey);
        const config = rowConfig(row, validateAgentConfig);
        return config ? { targetId: config.agentId, config } : undefined;
    }
    const row = listTeamConfigs({ includeArchived: true }).find((candidate) => candidate.idempotency_key === idempotencyKey);
    const config = rowConfig(row, validateTeamConfig);
    return config ? { targetId: config.teamId, config } : undefined;
}
function sendValidationFailure(reply, issues) {
    return reply.status(400).send({
        ok: false,
        issues,
        safeMessage: "설정 계약 형식이 올바르지 않아 저장할 수 없습니다.",
    });
}
export function registerOrchestrationRoute(app) {
    const agentService = createAgentRegistryService();
    const teamService = createTeamRegistryService();
    app.get("/api/orchestration/registry", { preHandler: authMiddleware }, async () => {
        return { snapshot: buildOrchestrationRegistrySnapshot() };
    });
    app.get("/api/orchestration/agents", { preHandler: authMiddleware }, async (req) => {
        const query = req.query;
        const q = typeof query["q"] === "string" ? query["q"].toLowerCase().trim() : "";
        const status = typeof query["status"] === "string" ? query["status"] : "";
        const items = agentService.snapshot().agents
            .filter((agent) => !status || agent.status === status)
            .filter((agent) => !q || [agent.agentId, agent.displayName, agent.nickname ?? "", agent.role].join("\n").toLowerCase().includes(q))
            .sort((a, b) => a.agentId.localeCompare(b.agentId));
        return paginate(items, pagination(query));
    });
    app.get("/api/orchestration/agents/:agentId", { preHandler: authMiddleware }, async (req, reply) => {
        const config = agentService.get(req.params.agentId);
        if (!config)
            return reply.status(404).send({ error: "agent not found" });
        return { config };
    });
    app.put("/api/orchestration/agents/:agentId", { preHandler: authMiddleware }, async (req, reply) => {
        const config = req.body.config;
        const validation = validateAgentConfig(config);
        if (!validation.ok)
            return sendValidationFailure(reply, validation.issues);
        if (validation.value.agentId !== req.params.agentId)
            return sendValidationFailure(reply, [issue("$.config.agentId", "Path id and config id must match.")]);
        const existing = agentService.get(req.params.agentId);
        if (req.body.expectedProfileVersion !== undefined && existing && existing.profileVersion !== req.body.expectedProfileVersion) {
            return reply.status(409).send({ ok: false, safeMessage: "profile version conflict", currentProfileVersion: existing.profileVersion });
        }
        const approvalRequired = detectsPermissionExpansion(existing, validation.value);
        const effectSummary = [
            existing ? `update agent:${validation.value.agentId}` : `create agent:${validation.value.agentId}`,
            ...(approvalRequired ? ["permission or capability expansion requires review"] : []),
        ];
        if (req.body.validationOnly)
            return { ok: true, validationOnly: true, stored: false, approvalRequired, effectSummary, config: validation.value };
        agentService.createOrUpdate(validation.value, {
            source: "manual",
            idempotencyKey: req.body.idempotencyKey ?? null,
            auditId: req.body.auditCorrelationId ?? null,
        });
        recordConfigAudit({
            targetType: "agent",
            targetId: validation.value.agentId,
            action: existing ? "updated" : "created",
            source: "manual",
            status: validation.value.status,
            idempotencyKey: req.body.idempotencyKey ?? null,
            auditCorrelationId: req.body.auditCorrelationId ?? null,
            effectSummary,
        });
        return { ok: true, validationOnly: false, stored: true, approvalRequired, effectSummary, config: validation.value };
    });
    app.post("/api/orchestration/agents/:agentId/status", { preHandler: authMiddleware }, async (req, reply) => {
        const current = agentService.get(req.params.agentId);
        if (!current)
            return reply.status(404).send({ error: "agent not found" });
        if (req.body.expectedProfileVersion !== undefined && current.profileVersion !== req.body.expectedProfileVersion) {
            return reply.status(409).send({ ok: false, safeMessage: "profile version conflict", currentProfileVersion: current.profileVersion });
        }
        const status = req.body.status;
        if (status !== "enabled" && status !== "disabled" && status !== "archived")
            return reply.status(400).send({ error: "invalid status" });
        const now = Date.now();
        const next = { ...current, status, updatedAt: now };
        agentService.createOrUpdate(next, {
            source: "manual",
            idempotencyKey: req.body.idempotencyKey ?? null,
            auditId: req.body.auditCorrelationId ?? null,
            now,
        });
        recordConfigAudit({
            targetType: "agent",
            targetId: current.agentId,
            action: "status_changed",
            source: "manual",
            status,
            idempotencyKey: req.body.idempotencyKey ?? null,
            auditCorrelationId: req.body.auditCorrelationId ?? null,
            effectSummary: [`agent:${current.agentId} status -> ${status}`],
        });
        return { ok: true, config: next };
    });
    app.get("/api/orchestration/teams", { preHandler: authMiddleware }, async (req) => {
        const query = req.query;
        const q = typeof query["q"] === "string" ? query["q"].toLowerCase().trim() : "";
        const status = typeof query["status"] === "string" ? query["status"] : "";
        const items = teamService.snapshot().teams
            .filter((team) => !status || team.status === status)
            .filter((team) => !q || [team.teamId, team.displayName, team.nickname ?? "", team.purpose].join("\n").toLowerCase().includes(q))
            .sort((a, b) => a.teamId.localeCompare(b.teamId));
        return paginate(items, pagination(query));
    });
    app.get("/api/orchestration/teams/:teamId", { preHandler: authMiddleware }, async (req, reply) => {
        const config = teamService.get(req.params.teamId);
        if (!config)
            return reply.status(404).send({ error: "team not found" });
        return { config };
    });
    app.put("/api/orchestration/teams/:teamId", { preHandler: authMiddleware }, async (req, reply) => {
        const config = req.body.config;
        const validation = validateTeamConfig(config);
        if (!validation.ok)
            return sendValidationFailure(reply, validation.issues);
        if (validation.value.teamId !== req.params.teamId)
            return sendValidationFailure(reply, [issue("$.config.teamId", "Path id and config id must match.")]);
        const existing = teamService.get(req.params.teamId);
        if (req.body.expectedProfileVersion !== undefined && existing && existing.profileVersion !== req.body.expectedProfileVersion) {
            return reply.status(409).send({ ok: false, safeMessage: "profile version conflict", currentProfileVersion: existing.profileVersion });
        }
        const effectSummary = [existing ? `update team:${validation.value.teamId}` : `create team:${validation.value.teamId}`];
        if (req.body.validationOnly)
            return { ok: true, validationOnly: true, stored: false, approvalRequired: false, effectSummary, config: validation.value };
        teamService.createOrUpdate(validation.value, {
            source: "manual",
            idempotencyKey: req.body.idempotencyKey ?? null,
            auditId: req.body.auditCorrelationId ?? null,
        });
        recordConfigAudit({
            targetType: "team",
            targetId: validation.value.teamId,
            action: existing ? "updated" : "created",
            source: "manual",
            status: validation.value.status,
            idempotencyKey: req.body.idempotencyKey ?? null,
            auditCorrelationId: req.body.auditCorrelationId ?? null,
            effectSummary,
        });
        return { ok: true, validationOnly: false, stored: true, approvalRequired: false, effectSummary, config: validation.value };
    });
    app.post("/api/orchestration/teams/:teamId/status", { preHandler: authMiddleware }, async (req, reply) => {
        const current = teamService.get(req.params.teamId);
        if (!current)
            return reply.status(404).send({ error: "team not found" });
        if (req.body.expectedProfileVersion !== undefined && current.profileVersion !== req.body.expectedProfileVersion) {
            return reply.status(409).send({ ok: false, safeMessage: "profile version conflict", currentProfileVersion: current.profileVersion });
        }
        const status = req.body.status;
        if (status !== "enabled" && status !== "disabled" && status !== "archived")
            return reply.status(400).send({ error: "invalid status" });
        const now = Date.now();
        const next = { ...current, status, updatedAt: now };
        teamService.createOrUpdate(next, {
            source: "manual",
            idempotencyKey: req.body.idempotencyKey ?? null,
            auditId: req.body.auditCorrelationId ?? null,
            now,
        });
        recordConfigAudit({
            targetType: "team",
            targetId: current.teamId,
            action: "status_changed",
            source: "manual",
            status,
            idempotencyKey: req.body.idempotencyKey ?? null,
            auditCorrelationId: req.body.auditCorrelationId ?? null,
            effectSummary: [`team:${current.teamId} status -> ${status}`],
        });
        return { ok: true, config: next };
    });
    app.get("/api/orchestration/relationship-graph", { preHandler: authMiddleware }, async () => {
        const snapshot = buildOrchestrationRegistrySnapshot();
        const nodes = [
            ...snapshot.agents.map((agent) => ({
                nodeId: `agent:${agent.agentId}`,
                entityType: agent.config.agentType,
                entityId: agent.agentId,
                label: agent.nickname ?? agent.displayName,
                status: agent.status,
                metadata: { role: agent.role, source: agent.source },
            })),
            ...snapshot.teams.map((team) => ({
                nodeId: `team:${team.teamId}`,
                entityType: "team",
                entityId: team.teamId,
                label: team.nickname ?? team.displayName,
                status: team.status,
                metadata: { purpose: team.purpose, source: team.source },
            })),
        ];
        const edges = snapshot.membershipEdges.map((edge) => ({
            edgeId: `team_membership:${edge.teamId}:${edge.agentId}`,
            edgeType: "team_membership",
            fromNodeId: `team:${edge.teamId}`,
            toNodeId: `agent:${edge.agentId}`,
            ...(edge.roleHint ? { label: edge.roleHint } : {}),
            metadata: { status: edge.status },
        }));
        return { graph: { nodes, edges }, diagnostics: snapshot.diagnostics };
    });
    app.get("/api/orchestration/sub-sessions", { preHandler: authMiddleware }, async (req, reply) => {
        const parentRunId = req.query.parentRunId?.trim();
        if (!parentRunId)
            return reply.status(400).send({ error: "parentRunId is required" });
        const rows = listRunSubSessionsForParentRun(parentRunId);
        return {
            items: rows.map((row) => {
                try {
                    return JSON.parse(row.contract_json);
                }
                catch {
                    return { subSessionId: row.sub_session_id, status: row.status, agentId: row.agent_id };
                }
            }),
            total: rows.length,
        };
    });
    app.get("/api/orchestration/data-exchanges", { preHandler: authMiddleware }, async (req, reply) => {
        const owner = ownerFromQuery(req.query);
        if (!owner)
            return reply.status(400).send({ error: "ownerType and ownerId are required" });
        const allowedUse = req.query.allowedUse === "temporary_context" || req.query.allowedUse === "memory_candidate" || req.query.allowedUse === "verification_only"
            ? req.query.allowedUse
            : undefined;
        const options = {
            includeExpired: req.query.includeExpired === "1" || req.query.includeExpired === "true",
            limit: parsePositiveInt(req.query.limit, 50, 500),
            ...(allowedUse ? { allowedUse } : {}),
        };
        const rows = req.query.direction === "source"
            ? listAgentDataExchangesForSource(owner, options)
            : listAgentDataExchangesForRecipient(owner, options);
        return { items: rows.map(dbAgentDataExchangeToPackage), total: rows.length };
    });
    app.get("/api/orchestration/data-exchanges/:exchangeId", { preHandler: authMiddleware }, async (req, reply) => {
        const exchange = getDataExchangePackage(req.params.exchangeId, {
            includeExpired: req.query.includeExpired === "1" || req.query.includeExpired === "true",
        });
        if (!exchange)
            return reply.status(404).send({ error: "data exchange not found" });
        return { exchange };
    });
    app.get("/api/orchestration/capability-delegations", { preHandler: authMiddleware }, async (req) => {
        const owner = ownerFromQuery(req.query);
        const filters = {
            ...(owner && req.query.ownerRole === "provider" ? { provider: owner } : {}),
            ...(owner && req.query.ownerRole !== "provider" ? { requester: owner } : {}),
            ...(req.query.status ? { status: req.query.status } : {}),
            limit: parsePositiveInt(req.query.limit, 50, 500),
        };
        const rows = listCapabilityDelegations(filters);
        return {
            items: rows.map((row) => {
                try {
                    return JSON.parse(row.contract_json);
                }
                catch {
                    return {
                        delegationId: row.delegation_id,
                        capability: row.capability,
                        risk: row.risk,
                        status: row.status,
                    };
                }
            }),
            total: rows.length,
        };
    });
    app.get("/api/orchestration/capability-delegations/:delegationId", { preHandler: authMiddleware }, async (req, reply) => {
        const row = getCapabilityDelegation(req.params.delegationId);
        if (!row)
            return reply.status(404).send({ error: "capability delegation not found" });
        try {
            return { delegation: JSON.parse(row.contract_json) };
        }
        catch {
            return { delegation: row };
        }
    });
    app.get("/api/orchestration/config/export/:targetType/:targetId", { preHandler: authMiddleware }, async (req, reply) => {
        const targetType = req.params.targetType;
        if (targetType !== "agent" && targetType !== "team")
            return reply.status(400).send({ error: "invalid target type" });
        const config = getConfigByTarget(targetType, req.params.targetId);
        if (!config)
            return reply.status(404).send({ error: "config not found" });
        const exportPackage = buildExportPackage(targetType, config);
        recordConfigAudit({
            targetType,
            targetId: req.params.targetId,
            action: "exported",
            source: "export",
            status: "exported",
            effectSummary: [`export ${targetType}:${req.params.targetId}`],
        });
        return {
            exportPackage,
            canonicalJson: toCanonicalJson(exportPackage),
        };
    });
    app.post("/api/orchestration/config/import", { preHandler: authMiddleware }, async (req, reply) => {
        let document;
        try {
            document = parseInputDocument(req.body);
        }
        catch {
            return reply.status(400).send({
                ok: false,
                issues: [issue("$.content", "Config import content must be valid JSON.")],
                safeMessage: "설정 파일을 해석할 수 없습니다. JSON 형식을 확인해 주세요.",
            });
        }
        const normalized = normalizeImportDocument(document);
        if (!normalized.targetType || !normalized.config || normalized.issues.length > 0)
            return sendValidationFailure(reply, normalized.issues);
        const validation = validationFor(normalized.targetType, normalized.config);
        if (!validation.ok)
            return sendValidationFailure(reply, validation.issues);
        const now = Date.now();
        const conflictStrategy = req.body.conflictStrategy ?? "overwrite";
        const replay = req.body.validationOnly ? undefined : findConfigByIdempotencyKey(normalized.targetType, req.body.idempotencyKey);
        if (replay) {
            return {
                ok: true,
                validationOnly: false,
                stored: true,
                action: "updated",
                targetType: normalized.targetType,
                targetId: replay.targetId,
                conflict: "none",
                activationRequired: true,
                approvalRequired: false,
                effectSummary: ["idempotency replay returned the existing imported config"],
                issues: [],
                safeMessage: "같은 idempotency key의 가져오기 결과를 다시 반환했습니다.",
                config: replay.config,
                exportPackage: buildExportPackage(normalized.targetType, replay.config, now),
            };
        }
        const existing = normalized.targetId ? getConfigByTarget(normalized.targetType, normalized.targetId) : undefined;
        if (existing && conflictStrategy === "cancel") {
            const result = {
                ok: false,
                validationOnly: req.body.validationOnly === true,
                stored: false,
                action: "cancelled",
                targetType: normalized.targetType,
                ...(normalized.targetId ? { targetId: normalized.targetId } : {}),
                conflict: "existing_target",
                activationRequired: true,
                approvalRequired: false,
                effectSummary: [`cancelled import for existing ${normalized.targetType}:${normalized.targetId}`],
                issues: [],
                safeMessage: "같은 ID의 설정이 이미 있어 가져오기를 취소했습니다.",
            };
            return reply.status(409).send(result);
        }
        const copied = Boolean(existing && conflictStrategy === "create_copy");
        const value = validation.value;
        const imported = copied
            ? copyConfigId(normalized.targetType, value, now)
            : forceImportedDisabled(value, now);
        const targetId = normalized.targetType === "agent" ? imported.agentId : imported.teamId;
        const targetExisting = getConfigByTarget(normalized.targetType, targetId);
        if (req.body.expectedProfileVersion !== undefined && targetExisting && targetExisting.profileVersion !== req.body.expectedProfileVersion) {
            return reply.status(409).send({ ok: false, safeMessage: "profile version conflict", currentProfileVersion: targetExisting.profileVersion });
        }
        const approvalRequired = normalized.targetType === "agent" && detectsPermissionExpansion(existing, imported);
        const effectSummary = importEffectSummary({
            targetType: normalized.targetType,
            existing: targetExisting,
            next: imported,
            copied,
            approvalRequired,
        });
        const exportPackage = buildExportPackage(normalized.targetType, imported, now);
        if (req.body.validationOnly) {
            return {
                ok: true,
                validationOnly: true,
                stored: false,
                action: "validated",
                targetType: normalized.targetType,
                targetId,
                conflict: existing ? "existing_target" : "none",
                activationRequired: true,
                approvalRequired,
                effectSummary,
                issues: [],
                safeMessage: "가져오기 검증이 완료되었습니다. 저장은 수행하지 않았습니다.",
                config: imported,
                exportPackage,
            };
        }
        if (normalized.targetType === "agent") {
            agentService.createOrUpdate(imported, {
                imported: true,
                source: "import",
                idempotencyKey: req.body.idempotencyKey ?? null,
                auditId: req.body.auditCorrelationId ?? null,
                now,
            });
            recordConfigAudit({
                targetType: "agent",
                targetId,
                action: "imported",
                source: "import",
                status: imported.status,
                idempotencyKey: req.body.idempotencyKey ?? null,
                auditCorrelationId: req.body.auditCorrelationId ?? null,
                effectSummary,
            });
        }
        else {
            teamService.createOrUpdate(imported, {
                imported: true,
                source: "import",
                idempotencyKey: req.body.idempotencyKey ?? null,
                auditId: req.body.auditCorrelationId ?? null,
                now,
            });
            recordConfigAudit({
                targetType: "team",
                targetId,
                action: "imported",
                source: "import",
                status: imported.status,
                idempotencyKey: req.body.idempotencyKey ?? null,
                auditCorrelationId: req.body.auditCorrelationId ?? null,
                effectSummary,
            });
        }
        return {
            ok: true,
            validationOnly: false,
            stored: true,
            action: copied ? "copied" : existing ? "updated" : "created",
            targetType: normalized.targetType,
            targetId,
            conflict: existing ? "existing_target" : "none",
            activationRequired: true,
            approvalRequired,
            effectSummary,
            issues: [],
            safeMessage: "설정을 disabled 상태로 가져왔습니다. 활성화는 별도 작업으로 진행해야 합니다.",
            config: imported,
            exportPackage,
        };
    });
}
//# sourceMappingURL=orchestration.js.map