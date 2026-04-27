import { listAgentLearningEvents, listHistoryVersions, listLearningReviewQueue, listRestoreEvents, restoreHistoryVersion, } from "../../agent/learning.js";
import { validateAgentConfig, validateTeamConfig, } from "../../contracts/sub-agent-orchestration.js";
import { NicknameNamespaceError, getDb, listAgentTeamMemberships, } from "../../db/index.js";
import { createAgentHierarchyService } from "../../orchestration/hierarchy.js";
import { createAgentRegistryService, createTeamRegistryService, } from "../../orchestration/registry.js";
import { createTeamCompositionService } from "../../orchestration/team-composition.js";
import { createTeamExecutionPlanService } from "../../orchestration/team-execution-plan.js";
import { createAgentTopologyService } from "../../orchestration/topology-projection.js";
import { authMiddleware } from "../middleware/auth.js";
import { startLocalRun } from "./runs.js";
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isFastifyReply(value) {
    return isRecord(value) && typeof value.send === "function";
}
function requestEnvelope(body) {
    return isRecord(body) ? body : {};
}
function asString(value) {
    return typeof value === "string" && value.trim() ? value : undefined;
}
function asStringArray(value) {
    if (!Array.isArray(value))
        return undefined;
    const strings = value.filter((item) => typeof item === "string" && item.trim().length > 0);
    return strings.length === value.length ? strings : undefined;
}
function asPositiveInteger(value) {
    return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}
function asQueryLimit(value) {
    if (!value)
        return undefined;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
function learningQueueQuery(agentId, limit) {
    const parsedLimit = asQueryLimit(limit);
    return {
        ...(agentId ? { agentId } : {}),
        ...(parsedLimit ? { limit: parsedLimit } : {}),
    };
}
function parseJsonArray(value) {
    if (!value)
        return [];
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed)
            ? parsed.filter((item) => typeof item === "string")
            : [];
    }
    catch {
        return [];
    }
}
function persistenceOptions(body) {
    const envelope = requestEnvelope(body);
    return {
        imported: envelope.imported === true,
        source: envelope.imported === true ? "import" : "manual",
        auditId: asString(envelope.auditId) ?? null,
        idempotencyKey: asString(envelope.idempotencyKey) ?? null,
    };
}
function sendValidationError(reply, reasonCode, issues) {
    return reply.status(400).send({
        ok: false,
        error: reasonCode,
        reasonCode,
        issues,
    });
}
function teamValidationReasonCode(issues) {
    if (!Array.isArray(issues))
        return "invalid_team_config";
    for (const issue of issues) {
        if (!isRecord(issue) || typeof issue.path !== "string")
            continue;
        if (issue.path.startsWith("$.memberships"))
            return "invalid_membership";
        if (issue.path === "$.leadAgentId")
            return "invalid_lead";
    }
    return "invalid_team_config";
}
function sendPersistenceError(reply, error) {
    if (error instanceof NicknameNamespaceError) {
        return reply.status(409).send({
            ok: false,
            error: error.details.reasonCode,
            reasonCode: error.details.reasonCode,
            details: error.details,
        });
    }
    return reply.status(500).send({
        ok: false,
        error: "agent_team_api_write_failed",
        reasonCode: "agent_team_api_write_failed",
        message: error instanceof Error ? error.message : String(error),
    });
}
function agentPayload(body) {
    const envelope = requestEnvelope(body);
    return envelope.agent ?? body;
}
function teamPayload(body) {
    const envelope = requestEnvelope(body);
    return envelope.team ?? body;
}
function relationshipPayload(body) {
    const envelope = requestEnvelope(body);
    return envelope.relationship ?? body;
}
function topologyEdgePayload(body) {
    const envelope = requestEnvelope(body);
    return envelope.edge ?? body;
}
function teamCompositionInput(teamId, body) {
    const envelope = requestEnvelope(body);
    if (envelope.team !== undefined)
        return envelope.team;
    if (isRecord(body) && typeof body.teamId === "string")
        return body;
    return teamId;
}
function sendTeamCompositionFailure(reply, diagnostics) {
    const reasonCode = diagnostics[0]?.reasonCode ?? "invalid_team_composition";
    return reply.status(reasonCode === "team_not_found" ? 404 : 400).send({
        ok: false,
        error: reasonCode,
        reasonCode,
        diagnostics,
    });
}
function hierarchyService(body) {
    const envelope = requestEnvelope(body);
    const maxDepth = asPositiveInteger(envelope.maxDepth);
    const maxChildCount = asPositiveInteger(envelope.maxChildCount);
    return createAgentHierarchyService({
        ...(maxDepth !== undefined ? { maxDepth } : {}),
        ...(maxChildCount !== undefined ? { maxChildCount } : {}),
    });
}
function mergeAgentPatch(current, patch, agentId) {
    const now = Date.now();
    const patchRecord = isRecord(patch) ? patch : {};
    return {
        ...current,
        ...patchRecord,
        agentId,
        agentType: current.agentType,
        createdAt: current.createdAt,
        updatedAt: now,
        profileVersion: typeof patchRecord.profileVersion === "number"
            ? patchRecord.profileVersion
            : current.profileVersion + 1,
    };
}
function mergeTeamPatch(current, patch, teamId) {
    const now = Date.now();
    const patchRecord = isRecord(patch) ? patch : {};
    return {
        ...current,
        ...patchRecord,
        teamId,
        createdAt: current.createdAt,
        updatedAt: now,
        profileVersion: typeof patchRecord.profileVersion === "number"
            ? patchRecord.profileVersion
            : current.profileVersion + 1,
    };
}
function memberFromRow(row) {
    const roles = parseJsonArray(row.team_roles_json);
    return {
        membershipId: row.membership_id,
        teamId: row.team_id,
        agentId: row.agent_id,
        ...(row.owner_agent_id_snapshot ? { ownerAgentIdSnapshot: row.owner_agent_id_snapshot } : {}),
        teamRoles: roles,
        primaryRole: row.primary_role,
        required: row.required === 1,
        ...(row.fallback_for_agent_id ? { fallbackForAgentId: row.fallback_for_agent_id } : {}),
        sortOrder: row.sort_order,
        status: row.status,
        ...(row.role_hint ? { roleHint: row.role_hint } : {}),
        ...(row.audit_id ? { auditId: row.audit_id } : {}),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}
function buildTeamDiagnostics(team) {
    const members = listAgentTeamMemberships(team.teamId).map(memberFromRow);
    const diagnostics = [];
    const memberIds = new Set(team.memberAgentIds);
    if (team.leadAgentId && !memberIds.has(team.leadAgentId)) {
        diagnostics.push({
            reasonCode: "invalid_lead_not_member",
            teamId: team.teamId,
            agentId: team.leadAgentId,
            message: `${team.teamId} lead ${team.leadAgentId} is not listed as a member.`,
        });
    }
    for (const member of members) {
        if (member.status === "unresolved") {
            diagnostics.push({
                reasonCode: "invalid_member_unresolved",
                teamId: team.teamId,
                agentId: member.agentId,
                message: `${team.teamId} references missing agent ${member.agentId}.`,
            });
        }
    }
    if (team.leadAgentId) {
        const leadMember = members.find((member) => member.agentId === team.leadAgentId);
        if (leadMember && leadMember.status !== "active") {
            diagnostics.push({
                reasonCode: "invalid_lead_unavailable",
                teamId: team.teamId,
                agentId: team.leadAgentId,
                message: `${team.teamId} lead ${team.leadAgentId} is ${leadMember.status}.`,
            });
        }
    }
    return diagnostics;
}
function teamMembersResponse(team) {
    return {
        teamId: team.teamId,
        members: listAgentTeamMemberships(team.teamId).map(memberFromRow),
        diagnostics: buildTeamDiagnostics(team),
    };
}
function validateAndStoreAgent(reply, input, body) {
    const validation = validateAgentConfig(input);
    if (!validation.ok)
        return sendValidationError(reply, "invalid_agent_config", validation.issues);
    try {
        createAgentRegistryService().createOrUpdate(validation.value, persistenceOptions(body));
        const stored = createAgentRegistryService().get(validation.value.agentId);
        return stored ?? validation.value;
    }
    catch (error) {
        return sendPersistenceError(reply, error);
    }
}
function validateAndStoreTeam(reply, input, body) {
    const validation = validateTeamConfig(input);
    if (!validation.ok)
        return sendValidationError(reply, teamValidationReasonCode(validation.issues), validation.issues);
    try {
        createTeamRegistryService().createOrUpdate(validation.value, persistenceOptions(body));
        const stored = createTeamRegistryService().get(validation.value.teamId);
        return stored ?? validation.value;
    }
    catch (error) {
        return sendPersistenceError(reply, error);
    }
}
export function registerAgentRoutes(app) {
    app.get("/api/agents", { preHandler: authMiddleware }, async () => ({
        ok: true,
        generatedAt: Date.now(),
        agents: createAgentRegistryService().list(),
    }));
    app.post("/api/agents", { preHandler: authMiddleware }, async (req, reply) => {
        const stored = validateAndStoreAgent(reply, agentPayload(req.body), req.body);
        if (isFastifyReply(stored))
            return stored;
        return { ok: true, agent: stored };
    });
    app.get("/api/agents/:agentId", { preHandler: authMiddleware }, async (req, reply) => {
        const agent = createAgentRegistryService().get(req.params.agentId);
        if (!agent)
            return reply
                .status(404)
                .send({ ok: false, error: "agent_not_found", reasonCode: "agent_not_found" });
        return { ok: true, agent };
    });
    app.patch("/api/agents/:agentId", { preHandler: authMiddleware }, async (req, reply) => {
        const current = createAgentRegistryService().get(req.params.agentId);
        if (!current)
            return reply
                .status(404)
                .send({ ok: false, error: "agent_not_found", reasonCode: "agent_not_found" });
        const stored = validateAndStoreAgent(reply, mergeAgentPatch(current, agentPayload(req.body), req.params.agentId), req.body);
        if (isFastifyReply(stored))
            return stored;
        return { ok: true, agent: stored };
    });
    app.post("/api/agents/:agentId/disable", { preHandler: authMiddleware }, async (req, reply) => {
        if (!createAgentRegistryService().disable(req.params.agentId)) {
            return reply
                .status(404)
                .send({ ok: false, error: "agent_not_found", reasonCode: "agent_not_found" });
        }
        return { ok: true, agent: createAgentRegistryService().get(req.params.agentId) };
    });
    app.post("/api/agents/:agentId/archive", { preHandler: authMiddleware }, async (req, reply) => {
        if (!createAgentRegistryService().archive(req.params.agentId)) {
            return reply
                .status(404)
                .send({ ok: false, error: "agent_not_found", reasonCode: "agent_not_found" });
        }
        return { ok: true, agent: createAgentRegistryService().get(req.params.agentId) };
    });
    app.get("/api/agents/:agentId/history", { preHandler: authMiddleware }, async (req) => ({
        ok: true,
        agentId: req.params.agentId,
        history: listHistoryVersions("agent", req.params.agentId),
        restores: listRestoreEvents("agent", req.params.agentId),
    }));
    app.get("/api/agents/:agentId/learning", { preHandler: authMiddleware }, async (req) => ({
        ok: true,
        agentId: req.params.agentId,
        events: listAgentLearningEvents(req.params.agentId),
        reviewQueue: listLearningReviewQueue(learningQueueQuery(req.params.agentId, req.query.limit)),
    }));
    app.get("/api/learning/review-queue", { preHandler: authMiddleware }, async (req) => ({
        ok: true,
        generatedAt: Date.now(),
        items: listLearningReviewQueue(learningQueueQuery(undefined, req.query.limit)),
    }));
    app.post("/api/agents/:agentId/restore", { preHandler: authMiddleware }, async (req, reply) => {
        const body = requestEnvelope(req.body);
        const restoredHistoryVersionId = asString(body.restoredHistoryVersionId) ?? asString(body.historyVersionId);
        if (!restoredHistoryVersionId) {
            return reply.status(400).send({
                ok: false,
                error: "history_version_id_required",
                reasonCode: "history_version_id_required",
            });
        }
        const auditCorrelationId = asString(body.auditId);
        const idempotencyKey = asString(body.idempotencyKey);
        const result = restoreHistoryVersion({
            targetEntityType: "agent",
            targetEntityId: req.params.agentId,
            restoredHistoryVersionId,
            owner: { ownerType: "system", ownerId: "api" },
            dryRun: body.dryRun ?? body.apply !== true,
            apply: body.apply === true,
            ...(auditCorrelationId ? { auditCorrelationId } : {}),
            ...(idempotencyKey ? { idempotencyKey } : {}),
        });
        return reply.status(result.ok ? 200 : 404).send({ ok: result.ok, result });
    });
    app.get("/api/teams", { preHandler: authMiddleware }, async () => ({
        ok: true,
        generatedAt: Date.now(),
        teams: createTeamRegistryService()
            .list()
            .map((team) => ({
            ...team,
            diagnostics: buildTeamDiagnostics(team),
        })),
    }));
    app.post("/api/teams", { preHandler: authMiddleware }, async (req, reply) => {
        const stored = validateAndStoreTeam(reply, teamPayload(req.body), req.body);
        if (isFastifyReply(stored))
            return stored;
        return { ok: true, team: stored, ...teamMembersResponse(stored) };
    });
    app.get("/api/teams/:teamId", { preHandler: authMiddleware }, async (req, reply) => {
        const team = createTeamRegistryService().get(req.params.teamId);
        if (!team)
            return reply
                .status(404)
                .send({ ok: false, error: "team_not_found", reasonCode: "team_not_found" });
        return { ok: true, team, ...teamMembersResponse(team) };
    });
    app.patch("/api/teams/:teamId", { preHandler: authMiddleware }, async (req, reply) => {
        const current = createTeamRegistryService().get(req.params.teamId);
        if (!current)
            return reply
                .status(404)
                .send({ ok: false, error: "team_not_found", reasonCode: "team_not_found" });
        const stored = validateAndStoreTeam(reply, mergeTeamPatch(current, teamPayload(req.body), req.params.teamId), req.body);
        if (isFastifyReply(stored))
            return stored;
        return { ok: true, team: stored, ...teamMembersResponse(stored) };
    });
    app.post("/api/teams/:teamId/disable", { preHandler: authMiddleware }, async (req, reply) => {
        if (!createTeamRegistryService().disable(req.params.teamId)) {
            return reply
                .status(404)
                .send({ ok: false, error: "team_not_found", reasonCode: "team_not_found" });
        }
        const team = createTeamRegistryService().get(req.params.teamId);
        return { ok: true, team, ...(team ? teamMembersResponse(team) : {}) };
    });
    app.post("/api/teams/:teamId/archive", { preHandler: authMiddleware }, async (req, reply) => {
        if (!createTeamRegistryService().archive(req.params.teamId)) {
            return reply
                .status(404)
                .send({ ok: false, error: "team_not_found", reasonCode: "team_not_found" });
        }
        const team = createTeamRegistryService().get(req.params.teamId);
        return { ok: true, team, ...(team ? teamMembersResponse(team) : {}) };
    });
    app.delete("/api/teams/:teamId", { preHandler: authMiddleware }, async (req, reply) => {
        if (!createTeamRegistryService().delete(req.params.teamId)) {
            return reply
                .status(404)
                .send({ ok: false, error: "team_not_found", reasonCode: "team_not_found" });
        }
        return { ok: true, teamId: req.params.teamId, deleted: true };
    });
    app.get("/api/teams/:teamId/members", { preHandler: authMiddleware }, async (req, reply) => {
        const team = createTeamRegistryService().get(req.params.teamId);
        if (!team)
            return reply
                .status(404)
                .send({ ok: false, error: "team_not_found", reasonCode: "team_not_found" });
        return { ok: true, ...teamMembersResponse(team) };
    });
    app.put("/api/teams/:teamId/members", { preHandler: authMiddleware }, async (req, reply) => {
        const current = createTeamRegistryService().get(req.params.teamId);
        if (!current)
            return reply
                .status(404)
                .send({ ok: false, error: "team_not_found", reasonCode: "team_not_found" });
        const body = requestEnvelope(req.body);
        const nextMemberAgentIds = asStringArray(body.memberAgentIds);
        const nextRoleHints = asStringArray(body.roleHints);
        if ("memberAgentIds" in body && !nextMemberAgentIds) {
            return sendValidationError(reply, "invalid_membership", [
                {
                    path: "$.memberAgentIds",
                    code: "contract_validation_failed",
                    message: "memberAgentIds must be an array of non-empty strings.",
                },
            ]);
        }
        if ("roleHints" in body && !nextRoleHints) {
            return sendValidationError(reply, "invalid_membership", [
                {
                    path: "$.roleHints",
                    code: "contract_validation_failed",
                    message: "roleHints must be an array of non-empty strings.",
                },
            ]);
        }
        if ("memberships" in body && !Array.isArray(body.memberships)) {
            return sendValidationError(reply, "invalid_membership", [
                {
                    path: "$.memberships",
                    code: "contract_validation_failed",
                    message: "memberships must be an array when present.",
                },
            ]);
        }
        const next = mergeTeamPatch(current, {
            memberAgentIds: nextMemberAgentIds ?? current.memberAgentIds,
            roleHints: nextRoleHints ?? current.roleHints,
            ...(Array.isArray(body.memberships) ? { memberships: body.memberships } : {}),
        }, req.params.teamId);
        const topologyValidation = createAgentTopologyService().validateActiveTeamMembers(next);
        if (!topologyValidation.valid) {
            return reply.status(400).send({
                ok: false,
                error: topologyValidation.diagnostics[0]?.reasonCode ?? "invalid_team_membership",
                reasonCode: topologyValidation.diagnostics[0]?.reasonCode ?? "invalid_team_membership",
                diagnostics: topologyValidation.diagnostics,
            });
        }
        const stored = validateAndStoreTeam(reply, next, req.body);
        if (isFastifyReply(stored))
            return stored;
        return { ok: true, team: stored, ...teamMembersResponse(stored) };
    });
    app.post("/api/teams/:teamId/validate", { preHandler: authMiddleware }, async (req, reply) => {
        const result = createTeamCompositionService().evaluate(teamCompositionInput(req.params.teamId, req.body));
        if (!result.ok)
            return sendTeamCompositionFailure(reply, result.diagnostics);
        return {
            ok: true,
            valid: result.valid,
            team: result.team,
            coverage: result.coverage,
            health: result.health,
            diagnostics: result.diagnostics,
        };
    });
    app.get("/api/teams/:teamId/coverage", { preHandler: authMiddleware }, async (req, reply) => {
        const result = createTeamCompositionService().evaluate(req.params.teamId);
        if (!result.ok)
            return sendTeamCompositionFailure(reply, result.diagnostics);
        return {
            ok: true,
            teamId: req.params.teamId,
            coverage: result.coverage,
            diagnostics: result.diagnostics,
        };
    });
    app.get("/api/teams/:teamId/health", { preHandler: authMiddleware }, async (req, reply) => {
        const result = createTeamCompositionService().evaluate(req.params.teamId);
        if (!result.ok)
            return sendTeamCompositionFailure(reply, result.diagnostics);
        return {
            ok: true,
            teamId: req.params.teamId,
            health: result.health,
            diagnostics: result.diagnostics,
        };
    });
    app.post("/api/teams/:teamId/plan", { preHandler: authMiddleware }, async (req, reply) => {
        const body = requestEnvelope(req.body);
        const teamExecutionPlanId = asString(body.teamExecutionPlanId);
        const parentRunId = asString(body.parentRunId);
        const parentRequestId = asString(body.parentRequestId);
        const userRequest = asString(body.userRequest);
        const result = createTeamExecutionPlanService().build({
            teamId: req.params.teamId,
            ...(teamExecutionPlanId ? { teamExecutionPlanId } : {}),
            ...(parentRunId ? { parentRunId } : {}),
            ...(parentRequestId ? { parentRequestId } : {}),
            ...(userRequest ? { userRequest } : {}),
            ...(body.persist === false ? { persist: false } : {}),
            auditId: asString(body.auditId) ?? null,
        });
        if (!result.ok) {
            const reasonCode = result.diagnostics[0]?.reasonCode ?? "team_execution_plan_failed";
            return reply.status(reasonCode === "team_not_found" ? 404 : 400).send({
                ok: false,
                error: reasonCode,
                reasonCode,
                diagnostics: result.diagnostics,
                validationIssues: result.validationIssues,
            });
        }
        return {
            ok: true,
            plan: result.plan,
            persisted: result.persisted,
            diagnostics: result.diagnostics,
        };
    });
    app.post("/api/agent-relationships", { preHandler: authMiddleware }, async (req, reply) => {
        const body = requestEnvelope(req.body);
        const result = hierarchyService(req.body).create(relationshipPayload(req.body), {
            auditId: asString(body.auditId) ?? null,
        });
        if (!result.ok) {
            return reply.status(400).send({
                ok: false,
                reasonCode: result.diagnostics[0]?.reasonCode ?? "invalid_agent_relationship",
                diagnostics: result.diagnostics,
                relationship: result.relationship,
            });
        }
        return { ok: true, relationship: result.relationship, diagnostics: result.diagnostics };
    });
    app.delete("/api/agent-relationships/:edgeId", { preHandler: authMiddleware }, async (req, reply) => {
        const disabled = hierarchyService(req.body).disable(req.params.edgeId, {
            auditId: asString(requestEnvelope(req.body).auditId) ?? null,
        });
        if (!disabled) {
            return reply.status(404).send({
                ok: false,
                error: "agent_relationship_not_found",
                reasonCode: "agent_relationship_not_found",
            });
        }
        return { ok: true, relationship: disabled };
    });
    app.post("/api/agent-relationships/validate", { preHandler: authMiddleware }, async (req) => {
        const result = hierarchyService(req.body).validate(relationshipPayload(req.body));
        return {
            ok: true,
            valid: result.ok,
            relationship: result.relationship,
            diagnostics: result.diagnostics,
        };
    });
    app.get("/api/agent-topology", { preHandler: authMiddleware }, async () => ({
        ok: true,
        ...createAgentTopologyService().buildProjection(),
    }));
    app.post("/api/agent-topology/edges/validate", { preHandler: authMiddleware }, async (req) => {
        const result = createAgentTopologyService().validateEdge(topologyEdgePayload(req.body));
        return {
            ok: result.ok,
            valid: result.valid,
            kind: result.kind,
            relationship: result.relationship,
            diagnostics: result.diagnostics,
        };
    });
    app.get("/api/agent-tree", { preHandler: authMiddleware }, async () => ({
        ok: true,
        ...hierarchyService().buildProjection(),
    }));
    app.get("/api/agents/:agentId/children", { preHandler: authMiddleware }, async (req) => {
        const service = hierarchyService();
        const children = service.directChildren(req.params.agentId);
        return {
            ok: true,
            parentAgentId: req.params.agentId,
            childAgentIds: children.map((child) => child.relationship.childAgentId),
            executionCandidateAgentIds: children
                .filter((child) => child.isExecutionCandidate)
                .map((child) => child.relationship.childAgentId),
            children,
            ancestors: service.ancestors(req.params.agentId),
            descendants: service.descendants(req.params.agentId),
        };
    });
    app.get("/api/agent-tree/layout", { preHandler: authMiddleware }, async () => ({
        ok: true,
        layout: hierarchyService().readLayout(),
    }));
    app.put("/api/agent-tree/layout", { preHandler: authMiddleware }, async (req, reply) => {
        const body = requestEnvelope(req.body);
        const payload = body.layout ?? req.body;
        if (!isRecord(payload)) {
            return reply.status(400).send({
                ok: false,
                error: "invalid_agent_tree_layout",
                reasonCode: "invalid_agent_tree_layout",
            });
        }
        return { ok: true, layout: hierarchyService().writeLayout(payload) };
    });
    // POST /api/agent/run — start agent run (streams via WebSocket)
    app.post("/api/agent/run", { preHandler: authMiddleware }, async (req, reply) => {
        const { message, sessionId, model } = req.body;
        if (!message?.trim()) {
            return reply.status(400).send({ error: "message is required" });
        }
        return startLocalRun({
            message,
            sessionId,
            model,
            source: "webui",
        });
    });
    // GET /api/agent/sessions
    app.get("/api/agent/sessions", { preHandler: authMiddleware }, async () => {
        const rows = getDb()
            .prepare("SELECT id, source, created_at, updated_at, summary FROM sessions ORDER BY updated_at DESC LIMIT 50")
            .all();
        return { sessions: rows };
    });
    // GET /api/agent/sessions/:id/messages
    app.get("/api/agent/sessions/:id/messages", { preHandler: authMiddleware }, async (req, reply) => {
        const { id } = req.params;
        const session = getDb().prepare("SELECT id FROM sessions WHERE id = ?").get(id);
        if (!session)
            return reply.status(404).send({ error: "Session not found" });
        const messages = getDb()
            .prepare("SELECT role, content, created_at FROM messages WHERE session_id = ? AND tool_calls IS NULL ORDER BY created_at ASC")
            .all(id);
        return { sessionId: id, messages };
    });
}
//# sourceMappingURL=agent.js.map