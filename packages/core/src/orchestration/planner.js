import { CONTRACT_SCHEMA_VERSION } from "../contracts/index.js";
import { buildOrchestrationRegistrySnapshot, } from "./registry.js";
export const ORCHESTRATION_PLANNER_VERSION = "structured-v1";
export const FAST_PATH_CLASSIFIER_TARGET_P95_MS = 100;
export const ORCHESTRATION_PLANNER_TARGET_P95_MS = 700;
const RISK_ORDER = {
    safe: 0,
    moderate: 1,
    external: 2,
    sensitive: 3,
    dangerous: 4,
};
function hasRoutingIntent(intent) {
    return Boolean(intent?.explicitAgentId ||
        intent?.explicitTeamId ||
        intent?.requiredRoles?.length ||
        intent?.specialtyTags?.length ||
        intent?.requiredCapabilities?.length ||
        intent?.requiredSkillIds?.length ||
        intent?.requiredMcpServerIds?.length ||
        intent?.requiredToolNames?.length ||
        intent?.requiredRisk);
}
export function classifyFastPath(input) {
    const clock = input.now ?? (() => Date.now());
    const startedAt = clock();
    const classification = "delegation_candidate";
    const reasonCodes = [
        hasRoutingIntent(input.intent)
            ? "fast_path_structured_intent_candidate"
            : "fast_path_delegation_candidate",
    ];
    const explanation = "요청 텍스트를 규칙으로 해석하지 않고 구조화된 실행자 후보 평가로 넘깁니다.";
    return {
        classification,
        reasonCodes,
        targetP95Ms: FAST_PATH_CLASSIFIER_TARGET_P95_MS,
        latencyMs: Math.max(0, clock() - startedAt),
        explanation,
    };
}
function uniqueStrings(values) {
    return [...new Set((values ?? []).map((value) => value?.trim() ?? "").filter(Boolean))].sort();
}
function hasAll(haystack, needles) {
    const set = new Set(haystack);
    return needles.every((needle) => set.has(needle));
}
function countMatches(haystack, needles) {
    const set = new Set(haystack);
    return needles.filter((needle) => set.has(needle)).length;
}
function defaultExpectedOutput() {
    return {
        outputId: "answer",
        kind: "text",
        description: "User-facing answer or direct execution result.",
        required: true,
        acceptance: {
            requiredEvidenceKinds: [],
            artifactRequired: false,
            reasonCodes: ["user_request_satisfied"],
        },
    };
}
export function buildDefaultStructuredTaskScope(userRequest) {
    return {
        goal: userRequest.trim() || "Process the user request.",
        intentType: "user_request",
        actionType: "general",
        constraints: [],
        expectedOutputs: [defaultExpectedOutput()],
        reasonCodes: ["default_structured_scope"],
    };
}
function inferredRequiredCapabilitiesForScope(_scope) {
    return [];
}
function riskAllows(agent, requiredRisk) {
    return RISK_ORDER[requiredRisk] <= RISK_ORDER[agent.permissionProfile.riskCeiling];
}
function riskNeedsApproval(agent, requiredRisk) {
    return RISK_ORDER[requiredRisk] >= RISK_ORDER[agent.permissionProfile.approvalRequiredFrom];
}
function effectiveTeamIds(agent, registry) {
    const fromMembership = registry.membershipEdges
        .filter((edge) => edge.status === "active" && edge.agentId === agent.agentId)
        .map((edge) => edge.teamId);
    const fromOwnership = registry.teams
        .filter((team) => team.config.ownerAgentId === agent.agentId || team.config.leadAgentId === agent.agentId)
        .map((team) => team.teamId);
    return uniqueStrings([...agent.teamIds, ...fromMembership, ...fromOwnership]);
}
function plannerParentAgentId(input, registry) {
    return input.parentAgentId ?? registry.hierarchy?.rootAgentId ?? "agent:nobie";
}
function plannerCurrentExecutorId(input) {
    return input.parentAgentId ?? "agent:nobie";
}
function isRootNobieExecutor(executorId) {
    return executorId === "agent:nobie";
}
function directChildAgentIdsFor(registry, parentAgentId) {
    const directChildIds = registry.capabilityIndex?.directChildAgentIdsByParent[parentAgentId];
    if (directChildIds)
        return new Set(directChildIds);
    const hierarchyDirectChildIds = registry.hierarchy?.directChildrenByParent[parentAgentId];
    if (hierarchyDirectChildIds)
        return new Set(hierarchyDirectChildIds);
    if (registry.hierarchy && parentAgentId !== registry.hierarchy.rootAgentId)
        return new Set();
    return undefined;
}
function capabilityIndexExcludedReasons(registry, parentAgentId, agentId) {
    return (registry.capabilityIndex?.excludedCandidatesByParent[parentAgentId]?.find((candidate) => candidate.agentId === agentId)?.reasonCodes ?? []);
}
function learningHintDiagnostics(input) {
    return (input.hints ?? []).map((hint, index) => {
        const evidenceRefs = hint.evidenceRefs?.filter((ref) => ref.trim().length > 0) ?? [];
        const confidence = typeof hint.confidence === "number" && Number.isFinite(hint.confidence) ? hint.confidence : 0;
        const suggestedAgent = hint.suggestedAgentId
            ? input.registry.agents.find((agent) => agent.agentId === hint.suggestedAgentId)
            : undefined;
        const suggestedTeam = hint.suggestedTeamId
            ? input.registry.teams.find((team) => team.teamId === hint.suggestedTeamId)
            : undefined;
        const issueCodes = [
            confidence < 0.85 ? "learning_hint_confidence_below_auto_threshold" : undefined,
            evidenceRefs.length === 0 ? "learning_hint_missing_evidence" : undefined,
            hint.suggestedAgentId && !suggestedAgent ? "learning_hint_agent_not_found" : undefined,
            hint.suggestedTeamId && !suggestedTeam ? "learning_hint_team_not_found" : undefined,
            hint.suggestedAgentId &&
                input.directChildAgentIds &&
                !input.directChildAgentIds.has(hint.suggestedAgentId)
                ? "learning_hint_agent_not_direct_child"
                : undefined,
        ].filter((issue) => Boolean(issue));
        return {
            code: "learning_hint_ignored",
            severity: issueCodes.length > 0 ? "invalid" : "info",
            message: `Learning hint ${hint.hintId ?? index} was advisory only and did not bypass structured planner validation.${issueCodes.length > 0 ? ` Issues: ${issueCodes.join(",")}.` : ""}`,
            ...(hint.suggestedAgentId ? { agentId: hint.suggestedAgentId } : {}),
            ...(hint.suggestedTeamId ? { teamId: hint.suggestedTeamId } : {}),
        };
    });
}
function explanationForCandidate(input) {
    if (input.excludedReasonCodes.length > 0) {
        return `${input.agent.nickname ?? input.agent.displayName}은 ${input.excludedReasonCodes[0]} 때문에 후보에서 제외되었습니다.`;
    }
    if (input.reasonCodes.includes("explicit_agent_target")) {
        return `${input.agent.nickname ?? input.agent.displayName}은 사용자가 명시한 직접 대상입니다.`;
    }
    if (input.reasonCodes.includes("explicit_team_member")) {
        return `${input.agent.nickname ?? input.agent.displayName}은 명시된 팀의 실행 가능 멤버입니다.`;
    }
    if (input.reasonCodes.includes("specialty_tag_match")) {
        return `${input.agent.nickname ?? input.agent.displayName}은 요청한 전문 태그와 일치합니다.`;
    }
    return `${input.agent.nickname ?? input.agent.displayName}은 현재 권한, 부하, capability 기준을 통과했습니다.`;
}
function candidateAllowedByExplicitTarget(agent, teamIds, intent) {
    if (intent.explicitAgentId)
        return agent.agentId === intent.explicitAgentId;
    if (intent.explicitTeamId)
        return teamIds.includes(intent.explicitTeamId);
    return true;
}
function scoreCandidate(agent, registry, intent, options = {}) {
    const teamIds = effectiveTeamIds(agent, registry);
    const reasonCodes = [];
    const excludedReasonCodes = [];
    const requiredRoles = uniqueStrings(intent.requiredRoles);
    const requiredSkillIds = uniqueStrings(intent.requiredSkillIds);
    const requiredMcpServerIds = uniqueStrings(intent.requiredMcpServerIds);
    const requiredToolNames = uniqueStrings(intent.requiredToolNames);
    const requiredCapabilities = uniqueStrings(intent.requiredCapabilities);
    const specialtyTags = uniqueStrings(intent.specialtyTags);
    const requiredRisk = intent.requiredRisk ?? "safe";
    if (options.directChildAgentIds &&
        !options.directChildAgentIds.has(agent.agentId) &&
        intent.explicitAgentId !== agent.agentId) {
        excludedReasonCodes.push("not_direct_child_candidate");
    }
    if (!candidateAllowedByExplicitTarget(agent, teamIds, intent))
        excludedReasonCodes.push("not_explicit_target");
    if (agent.status !== "enabled") {
        excludedReasonCodes.push("agent_not_enabled");
        excludedReasonCodes.push(`agent_${agent.status}`);
    }
    if (!agent.delegationEnabled)
        excludedReasonCodes.push("delegation_disabled");
    if (agent.currentLoad.activeSubSessions >= agent.currentLoad.maxParallelSessions)
        excludedReasonCodes.push("concurrency_limit_reached");
    if (!hasAll([agent.role], requiredRoles))
        excludedReasonCodes.push("missing_required_role");
    if (!hasAll(agent.skillMcpSummary.enabledSkillIds, requiredSkillIds))
        excludedReasonCodes.push("missing_required_skill");
    if (!hasAll(agent.skillMcpSummary.enabledMcpServerIds, requiredMcpServerIds))
        excludedReasonCodes.push("missing_required_mcp_server");
    if (!hasAll(agent.skillMcpSummary.enabledToolNames, requiredToolNames))
        excludedReasonCodes.push("missing_required_tool");
    if (!riskAllows(agent, requiredRisk))
        excludedReasonCodes.push("risk_above_agent_ceiling");
    if (!agent.permissionProfile.profileId)
        excludedReasonCodes.push("permission_missing");
    if (agent.capabilitySummary.availability === "unavailable")
        excludedReasonCodes.push("capability_unavailable");
    if (agent.modelSummary.availability === "unavailable")
        excludedReasonCodes.push("model_unavailable");
    if (options.parentAgentId) {
        excludedReasonCodes.push(...capabilityIndexExcludedReasons(registry, options.parentAgentId, agent.agentId));
    }
    const capabilityPool = [
        agent.role,
        ...agent.skillMcpSummary.enabledSkillIds,
        ...agent.skillMcpSummary.enabledMcpServerIds,
        ...agent.skillMcpSummary.enabledToolNames,
        agent.permissionProfile.profileId,
        agent.permissionProfile.riskCeiling,
    ];
    if (!hasAll(capabilityPool, requiredCapabilities))
        excludedReasonCodes.push("missing_required_capability");
    let score = 100;
    if (intent.explicitAgentId === agent.agentId) {
        score += 1_000;
        reasonCodes.push("explicit_agent_target");
    }
    if (intent.explicitTeamId && teamIds.includes(intent.explicitTeamId)) {
        score += 700;
        reasonCodes.push("explicit_team_member");
    }
    const specialtyMatches = countMatches(agent.specialtyTags, specialtyTags);
    const roleMatches = countMatches([agent.role], requiredRoles);
    if (roleMatches > 0) {
        score += roleMatches * 35;
        reasonCodes.push("required_role_match");
    }
    if (specialtyMatches > 0) {
        score += specialtyMatches * 30;
        reasonCodes.push("specialty_tag_match");
    }
    const skillMatches = countMatches(agent.skillMcpSummary.enabledSkillIds, requiredSkillIds);
    const mcpMatches = countMatches(agent.skillMcpSummary.enabledMcpServerIds, requiredMcpServerIds);
    const toolMatches = countMatches(agent.skillMcpSummary.enabledToolNames, requiredToolNames);
    score += skillMatches * 25 + mcpMatches * 20 + toolMatches * 15;
    if (skillMatches > 0)
        reasonCodes.push("required_skill_match");
    if (mcpMatches > 0)
        reasonCodes.push("required_mcp_match");
    if (toolMatches > 0)
        reasonCodes.push("required_tool_match");
    if (agent.source === "topology") {
        score += 15;
        reasonCodes.push("topology_executor_candidate");
    }
    if (riskNeedsApproval(agent, requiredRisk) && riskAllows(agent, requiredRisk)) {
        reasonCodes.push("approval_required_for_risk");
    }
    score -= Math.round(agent.currentLoad.utilization * 60);
    score -= Math.round(agent.failureRate.value * 100);
    if (agent.currentLoad.utilization > 0)
        reasonCodes.push("load_penalty_applied");
    if (agent.failureRate.value > 0)
        reasonCodes.push("failure_rate_penalty_applied");
    if (reasonCodes.length === 0)
        reasonCodes.push("structured_candidate_available");
    const normalizedReasonCodes = uniqueStrings(reasonCodes);
    const normalizedExcludedReasonCodes = uniqueStrings(excludedReasonCodes);
    return {
        agentId: agent.agentId,
        teamIds,
        score,
        selected: false,
        reasonCodes: normalizedReasonCodes,
        excludedReasonCodes: normalizedExcludedReasonCodes,
        explanation: explanationForCandidate({
            agent,
            reasonCodes: normalizedReasonCodes,
            excludedReasonCodes: normalizedExcludedReasonCodes,
        }),
        approvalRequired: riskNeedsApproval(agent, requiredRisk) && riskAllows(agent, requiredRisk),
        ...(riskNeedsApproval(agent, requiredRisk) && riskAllows(agent, requiredRisk)
            ? { approvalRisk: requiredRisk }
            : {}),
    };
}
function sortedEligibleCandidates(candidates) {
    return candidates
        .filter((candidate) => candidate.excludedReasonCodes.length === 0)
        .sort((a, b) => b.score - a.score || a.agentId.localeCompare(b.agentId));
}
function hasExclusiveLockConflict(a, b) {
    return a.some((left) => left.mode === "exclusive" &&
        b.some((right) => right.mode === "exclusive" && right.kind === left.kind && right.target === left.target));
}
function buildIdentity(planId, parentRunId, parentRequestId) {
    return {
        schemaVersion: CONTRACT_SCHEMA_VERSION,
        entityType: "session",
        entityId: planId,
        owner: { ownerType: "nobie", ownerId: "agent:nobie" },
        idempotencyKey: `orchestration-plan:${parentRunId}:${parentRequestId}`,
        auditCorrelationId: `orchestration-plan:${planId}`,
        parent: { parentRunId, parentRequestId },
    };
}
function planTask(input) {
    return {
        taskId: input.taskId,
        executionKind: input.executionKind,
        scope: input.scope,
        ...(input.candidate ? { assignedAgentId: input.candidate.agentId } : {}),
        ...(input.assignedTeamId ? { assignedTeamId: input.assignedTeamId } : {}),
        requiredCapabilities: input.requiredCapabilities,
        resourceLockIds: input.resourceLockIds,
        planningTrace: {
            ...(input.candidate ? { score: input.candidate.score } : {}),
            ...(input.selectedSource ? { selectedSource: input.selectedSource } : {}),
            ...(input.candidate ? { selectedExecutorId: input.candidate.agentId } : {}),
            ...(input.rejectedExecutorId ? { rejectedExecutorId: input.rejectedExecutorId } : {}),
            reasonCodes: input.reasonCodes,
            ...(input.candidate?.excludedReasonCodes.length
                ? { excludedReasonCodes: input.candidate.excludedReasonCodes }
                : {}),
            ...(input.rejectedReasonCodes?.length
                ? { rejectedReasonCodes: input.rejectedReasonCodes }
                : {}),
            ...(input.explanation ? { explanation: input.explanation } : {}),
        },
    };
}
function directFallbackPlan(input) {
    const planId = input.idProvider();
    const scope = buildDefaultStructuredTaskScope(input.userRequest);
    const task = planTask({
        taskId: `${planId}:direct:0`,
        scope,
        executionKind: "direct_nobie",
        requiredCapabilities: [],
        resourceLockIds: [],
        reasonCodes: input.reasonCodes,
        explanation: input.userMessage ?? "노비가 직접 후속 처리를 맡는 계획입니다.",
    });
    const plan = {
        identity: buildIdentity(planId, input.parentRunId, input.parentRequestId),
        planId,
        parentRunId: input.parentRunId,
        parentRequestId: input.parentRequestId,
        directNobieTasks: [task],
        delegatedTasks: [],
        dependencyEdges: [],
        resourceLocks: [],
        parallelGroups: [],
        approvalRequirements: [],
        fallbackStrategy: {
            mode: input.fallbackMode ??
                (input.fallbackReasonCode.startsWith("explicit_") ? "ask_user" : "direct_current_agent"),
            reasonCode: input.fallbackReasonCode,
            ...(input.currentExecutorId ? { currentExecutorId: input.currentExecutorId } : {}),
            ...(input.parentExecutorId ? { parentExecutorId: input.parentExecutorId } : {}),
            ...(input.requesterId ? { requesterId: input.requesterId } : {}),
            ...(input.unresolvedReasonCode ? { unresolvedReasonCode: input.unresolvedReasonCode } : {}),
            ...(input.unresolvedReason ? { unresolvedReason: input.unresolvedReason } : {}),
            ...(input.userMessage ? { userMessage: input.userMessage } : {}),
        },
        plannerMetadata: {
            status: input.status ?? "planned",
            plannerVersion: ORCHESTRATION_PLANNER_VERSION,
            timedOut: input.timedOut,
            latencyMs: Math.max(0, input.now - input.now),
            targetP95Ms: ORCHESTRATION_PLANNER_TARGET_P95_MS,
            semanticComparisonUsed: false,
            fastPath: input.fastPathClassification,
            reasonCodes: input.reasonCodes,
            candidateScores: (input.candidateScores ?? []).map((candidate) => ({
                agentId: candidate.agentId,
                teamIds: candidate.teamIds,
                score: candidate.score,
                selected: candidate.selected,
                reasonCodes: candidate.reasonCodes,
                excludedReasonCodes: candidate.excludedReasonCodes,
                explanation: candidate.explanation,
            })),
            ...(input.rejectedExecutorId ? { rejectedExecutorId: input.rejectedExecutorId } : {}),
            ...(input.rejectedReasonCodes?.length
                ? { rejectedReasonCodes: input.rejectedReasonCodes }
                : {}),
            fallbackMode: input.fallbackMode ??
                (input.fallbackReasonCode.startsWith("explicit_") ? "ask_user" : "direct_current_agent"),
            directReasonCodes: input.reasonCodes,
            fallbackReasonCodes: [input.fallbackReasonCode],
        },
        createdAt: input.now,
    };
    return {
        plan,
        candidateScores: input.candidateScores ?? [],
        diagnostics: input.diagnostics ?? [],
        fastPathClassification: input.fastPathClassification,
        timedOut: input.timedOut,
        reasonCodes: input.reasonCodes,
    };
}
function nonExecutionPlan(input) {
    const planId = input.idProvider();
    const plan = {
        identity: buildIdentity(planId, input.parentRunId, input.parentRequestId),
        planId,
        parentRunId: input.parentRunId,
        parentRequestId: input.parentRequestId,
        directNobieTasks: [],
        delegatedTasks: [],
        dependencyEdges: [],
        resourceLocks: [],
        parallelGroups: [],
        approvalRequirements: [],
        fallbackStrategy: {
            mode: "fail_with_reason",
            reasonCode: input.fallbackReasonCode,
            userMessage: input.userMessage,
        },
        plannerMetadata: {
            status: input.status,
            plannerVersion: ORCHESTRATION_PLANNER_VERSION,
            timedOut: false,
            latencyMs: 0,
            targetP95Ms: ORCHESTRATION_PLANNER_TARGET_P95_MS,
            semanticComparisonUsed: false,
            fastPath: input.fastPathClassification,
            reasonCodes: input.reasonCodes,
            candidateScores: (input.candidateScores ?? []).map((candidate) => ({
                agentId: candidate.agentId,
                teamIds: candidate.teamIds,
                score: candidate.score,
                selected: candidate.selected,
                reasonCodes: candidate.reasonCodes,
                excludedReasonCodes: candidate.excludedReasonCodes,
                explanation: candidate.explanation,
            })),
            directReasonCodes: [],
            fallbackReasonCodes: [input.fallbackReasonCode],
        },
        createdAt: input.now,
    };
    return {
        plan,
        candidateScores: input.candidateScores ?? [],
        diagnostics: input.diagnostics ?? [],
        fastPathClassification: input.fastPathClassification,
        timedOut: false,
        reasonCodes: input.reasonCodes,
    };
}
function selectedExecutorFromDelegatingDecision(decision) {
    if (!decision?.selected_executor_id?.trim())
        return undefined;
    if (decision.execution_route === "delegate_to_child" ||
        decision.execution_route === "sub_agent" ||
        decision.execution_route === "yeonjang") {
        return decision.selected_executor_id;
    }
    return undefined;
}
function directFallbackModeForExecutionDecision(decision) {
    if (decision.execution_route === "ask_user")
        return "ask_user";
    if (decision.execution_route === "ask_parent")
        return "ask_parent";
    if (decision.execution_route === "return_to_parent")
        return "return_to_parent";
    if (decision.execution_route === "root_nobie_direct")
        return "root_nobie_direct";
    if (decision.execution_route === "explicit_provider")
        return "ask_user";
    if (decision.execution_route === "self_solve")
        return "self_solve";
    return "direct_current_agent";
}
export function buildOrchestrationPlan(input) {
    const startedAt = input.now?.() ?? Date.now();
    const now = input.now ?? (() => Date.now());
    const idProvider = input.idProvider ?? (() => crypto.randomUUID());
    const timeoutMs = Math.max(1, input.timeoutMs ?? 120);
    const decisionSelectedExecutorId = selectedExecutorFromDelegatingDecision(input.agentExecutionDecision);
    let intent = {
        ...(input.intent ?? {}),
        ...(decisionSelectedExecutorId ? { explicitAgentId: decisionSelectedExecutorId } : {}),
    };
    const fastPathClassification = classifyFastPath({
        userRequest: input.userRequest,
        intent,
        now,
    });
    if (input.modeSnapshot.mode !== "orchestration") {
        return directFallbackPlan({
            parentRunId: input.parentRunId,
            parentRequestId: input.parentRequestId,
            userRequest: input.userRequest,
            modeSnapshot: input.modeSnapshot,
            reasonCodes: [`mode_${input.modeSnapshot.mode}`, input.modeSnapshot.reasonCode],
            fallbackReasonCode: input.modeSnapshot.reasonCode,
            now: startedAt,
            idProvider,
            timedOut: false,
            fastPathClassification,
            currentExecutorId: plannerCurrentExecutorId(input),
        });
    }
    if (fastPathClassification.classification === "direct_nobie") {
        return directFallbackPlan({
            parentRunId: input.parentRunId,
            parentRequestId: input.parentRequestId,
            userRequest: input.userRequest,
            modeSnapshot: input.modeSnapshot,
            reasonCodes: fastPathClassification.reasonCodes,
            fallbackReasonCode: "direct_nobie_fast_path",
            now: startedAt,
            idProvider,
            timedOut: false,
            fastPathClassification,
            userMessage: fastPathClassification.explanation,
            currentExecutorId: plannerCurrentExecutorId(input),
        });
    }
    if (fastPathClassification.classification === "workflow_candidate") {
        return nonExecutionPlan({
            parentRunId: input.parentRunId,
            parentRequestId: input.parentRequestId,
            modeSnapshot: input.modeSnapshot,
            reasonCodes: [...fastPathClassification.reasonCodes, "requires_workflow_recommendation"],
            fallbackReasonCode: "requires_workflow_recommendation",
            now: startedAt,
            idProvider,
            fastPathClassification,
            status: "requires_workflow_recommendation",
            userMessage: "반복성 요청은 deterministic workflow 후보로 표시했고, 실제 workflow 생성은 후속 단계에서 처리해야 합니다.",
        });
    }
    const registry = input.registrySnapshot ??
        input.loadRegistrySnapshot?.() ??
        buildOrchestrationRegistrySnapshot({ now });
    const parentAgentId = plannerParentAgentId(input, registry);
    if (now() - startedAt > timeoutMs) {
        return directFallbackPlan({
            parentRunId: input.parentRunId,
            parentRequestId: input.parentRequestId,
            userRequest: input.userRequest,
            modeSnapshot: input.modeSnapshot,
            reasonCodes: ["planning_timeout"],
            fallbackReasonCode: "planning_timeout_direct_current_agent",
            now: startedAt,
            idProvider,
            timedOut: true,
            status: "degraded",
            fastPathClassification,
            currentExecutorId: parentAgentId,
        });
    }
    const scopes = input.taskScopes?.length
        ? input.taskScopes
        : [buildDefaultStructuredTaskScope(input.userRequest)];
    const directChildAgentIds = directChildAgentIdsFor(registry, parentAgentId);
    const candidateScores = registry.agents.map((agent) => scoreCandidate(agent, registry, intent, {
        parentAgentId,
        ...(directChildAgentIds ? { directChildAgentIds } : {}),
    }));
    const diagnostics = [
        ...candidateScores.flatMap((candidate) => candidate.excludedReasonCodes.map((reasonCode) => ({
            code: reasonCode,
            severity: "warning",
            message: `${candidate.agentId} was excluded from planning by ${reasonCode}.`,
            agentId: candidate.agentId,
        }))),
        ...learningHintDiagnostics({
            registry,
            ...(input.learningHints ? { hints: input.learningHints } : {}),
            ...(directChildAgentIds ? { directChildAgentIds } : {}),
        }),
    ];
    const explicitTargetRequested = Boolean(decisionSelectedExecutorId);
    if (input.agentExecutionDecision && !decisionSelectedExecutorId) {
        return directFallbackPlan({
            parentRunId: input.parentRunId,
            parentRequestId: input.parentRequestId,
            userRequest: input.userRequest,
            modeSnapshot: input.modeSnapshot,
            reasonCodes: [
                "execution_decision_present",
                `execution_decision_route_${input.agentExecutionDecision.execution_route}`,
            ],
            fallbackReasonCode: `execution_decision_${input.agentExecutionDecision.execution_route}`,
            fallbackMode: input.agentExecutionDecision.execution_route === "root_nobie_direct" &&
                !isRootNobieExecutor(input.agentExecutionDecision.current_executor_id)
                ? input.agentExecutionDecision.parent_executor_id
                    ? "return_to_parent"
                    : "ask_user"
                : directFallbackModeForExecutionDecision(input.agentExecutionDecision),
            now: startedAt,
            idProvider,
            timedOut: false,
            candidateScores,
            diagnostics,
            fastPathClassification,
            currentExecutorId: input.agentExecutionDecision.current_executor_id,
            ...(input.agentExecutionDecision.parent_executor_id
                ? { parentExecutorId: input.agentExecutionDecision.parent_executor_id }
                : {}),
            unresolvedReasonCode: input.agentExecutionDecision.execution_route === "root_nobie_direct" &&
                !isRootNobieExecutor(input.agentExecutionDecision.current_executor_id)
                ? "root_nobie_direct_rejected_for_non_root_executor"
                : `execution_decision_${input.agentExecutionDecision.execution_route}`,
            ...(input.agentExecutionDecision.unresolved_reason
                ? { unresolvedReason: input.agentExecutionDecision.unresolved_reason }
                : {}),
            userMessage: input.agentExecutionDecision.reason,
        });
    }
    if (!explicitTargetRequested) {
        return directFallbackPlan({
            parentRunId: input.parentRunId,
            parentRequestId: input.parentRequestId,
            userRequest: input.userRequest,
            modeSnapshot: input.modeSnapshot,
            reasonCodes: [
                "execution_decision_required",
                "implicit_agent_selection_disabled",
            ],
            fallbackReasonCode: "execution_decision_required",
            fallbackMode: "direct_current_agent",
            now: startedAt,
            idProvider,
            timedOut: false,
            candidateScores,
            diagnostics,
            fastPathClassification,
            currentExecutorId: parentAgentId,
            ...(intent.explicitAgentId || intent.explicitTeamId
                ? {
                    rejectedExecutorId: intent.explicitAgentId ?? intent.explicitTeamId,
                    rejectedReasonCodes: ["explicit_target_requires_execution_decision"],
                }
                : {}),
            unresolvedReasonCode: "execution_decision_missing",
            userMessage: "검증된 실행 결정이 없어 임의 실행자 선택 없이 현재 에이전트가 직접 처리합니다.",
        });
    }
    if (intent.explicitTeamId) {
        const explicitTeamId = intent.explicitTeamId;
        const team = registry.teams.find((candidate) => candidate.teamId === explicitTeamId);
        const teamHealthStatus = team?.health?.status;
        const activeMemberAgentIds = team?.coverage?.activeMemberAgentIds ?? team?.activeMemberAgentIds ?? [];
        if (!team || teamHealthStatus === "invalid" || activeMemberAgentIds.length === 0) {
            const reasonCodes = [
                "explicit_team_target",
                "explicit_team_target_unavailable",
                team ? `team_health_${teamHealthStatus ?? "unknown"}` : "team_not_found",
                ...(activeMemberAgentIds.length === 0 ? ["no_active_team_members"] : []),
            ];
            return directFallbackPlan({
                parentRunId: input.parentRunId,
                parentRequestId: input.parentRequestId,
                userRequest: input.userRequest,
                modeSnapshot: input.modeSnapshot,
                reasonCodes,
                fallbackReasonCode: "explicit_team_target_unavailable",
                now: startedAt,
                idProvider,
                timedOut: false,
                candidateScores,
                diagnostics,
                fastPathClassification,
                currentExecutorId: parentAgentId,
                rejectedExecutorId: explicitTeamId,
                rejectedReasonCodes: reasonCodes,
                unresolvedReasonCode: "selected_team_rejected",
                userMessage: "명시된 팀을 실행 후보로 사용할 수 없어 임의 대체 없이 사용자 확인이 필요합니다.",
            });
        }
        const planId = idProvider();
        const delegatedTasks = scopes.map((scope, index) => planTask({
            taskId: `${planId}:team:${index}`,
            scope,
            executionKind: "delegated_sub_agent",
            requiredCapabilities: uniqueStrings([
                ...(intent.requiredCapabilities ?? []),
                ...inferredRequiredCapabilitiesForScope(scope),
            ]),
            resourceLockIds: [],
            assignedTeamId: explicitTeamId,
            selectedSource: "execution_decision",
            reasonCodes: [
                "explicit_team_target",
                "execution_decision_selected_executor",
                "team_execution_plan_planned",
                ...(teamHealthStatus ? [`team_health_${teamHealthStatus}`] : []),
            ],
            explanation: `${team.displayName} 팀 실행 계획으로 확장할 작업입니다.`,
        }));
        for (const candidate of candidateScores) {
            if (candidate.teamIds.includes(explicitTeamId))
                candidate.selected = true;
        }
        const plannerReasonCodes = [
            "structured_scoring",
            "explicit_team_target",
            "team_execution_plan_planned",
        ];
        const plan = {
            identity: buildIdentity(planId, input.parentRunId, input.parentRequestId),
            planId,
            parentRunId: input.parentRunId,
            parentRequestId: input.parentRequestId,
            directNobieTasks: [],
            delegatedTasks,
            dependencyEdges: [...(input.dependencyEdges ?? [])],
            resourceLocks: input.resourceLocks ?? [],
            parallelGroups: [],
            approvalRequirements: [],
            fallbackStrategy: {
                mode: "direct_current_agent",
                reasonCode: "delegated_team_runtime_failure_direct_current_agent",
                currentExecutorId: parentAgentId,
            },
            plannerMetadata: {
                status: "planned",
                plannerVersion: ORCHESTRATION_PLANNER_VERSION,
                timedOut: false,
                latencyMs: Math.max(0, now() - startedAt),
                targetP95Ms: ORCHESTRATION_PLANNER_TARGET_P95_MS,
                semanticComparisonUsed: false,
                fastPath: fastPathClassification,
                reasonCodes: plannerReasonCodes,
                candidateScores: candidateScores.map((candidate) => ({
                    agentId: candidate.agentId,
                    teamIds: candidate.teamIds,
                    score: candidate.score,
                    selected: candidate.selected,
                    reasonCodes: candidate.reasonCodes,
                    excludedReasonCodes: candidate.excludedReasonCodes,
                    explanation: candidate.explanation,
                })),
                selectedExecutorSource: "execution_decision",
                ...(decisionSelectedExecutorId ? { selectedExecutorId: decisionSelectedExecutorId } : {}),
                fallbackMode: "direct_current_agent",
                directReasonCodes: [],
                fallbackReasonCodes: ["delegated_team_runtime_failure_direct_current_agent"],
            },
            createdAt: startedAt,
        };
        return {
            plan,
            registrySnapshot: registry,
            candidateScores,
            diagnostics,
            fastPathClassification,
            timedOut: false,
            reasonCodes: plannerReasonCodes,
        };
    }
    if (intent.explicitAgentId) {
        const target = registry.agents.find((agent) => agent.agentId === intent.explicitAgentId);
        const targetScore = candidateScores.find((candidate) => candidate.agentId === intent.explicitAgentId);
        const visible = !directChildAgentIds || directChildAgentIds.has(intent.explicitAgentId);
        if (!target || !visible || !targetScore || targetScore.excludedReasonCodes.length > 0) {
            const reasonCodes = [
                "explicit_agent_target",
                "explicit_agent_target_unavailable",
                !target ? "agent_not_found" : undefined,
                target && !visible ? "explicit_agent_not_direct_child" : undefined,
                ...(targetScore?.excludedReasonCodes ?? []),
            ].filter((reason) => Boolean(reason));
            return directFallbackPlan({
                parentRunId: input.parentRunId,
                parentRequestId: input.parentRequestId,
                userRequest: input.userRequest,
                modeSnapshot: input.modeSnapshot,
                reasonCodes,
                fallbackReasonCode: targetScore?.excludedReasonCodes.includes("risk_above_agent_ceiling")
                    ? "explicit_agent_permission_denied"
                    : "explicit_agent_target_unavailable",
                now: startedAt,
                idProvider,
                timedOut: false,
                candidateScores,
                diagnostics,
                fastPathClassification,
                currentExecutorId: parentAgentId,
                rejectedExecutorId: intent.explicitAgentId,
                rejectedReasonCodes: reasonCodes,
                unresolvedReasonCode: "selected_executor_rejected",
                userMessage: "명시된 에이전트가 직접 하위 후보 또는 권한 조건을 만족하지 않아 임의 대체하지 않았습니다.",
            });
        }
    }
    const eligible = sortedEligibleCandidates(candidateScores);
    if (eligible.length === 0) {
        return directFallbackPlan({
            parentRunId: input.parentRunId,
            parentRequestId: input.parentRequestId,
            userRequest: input.userRequest,
            modeSnapshot: input.modeSnapshot,
            reasonCodes: explicitTargetRequested
                ? ["explicit_target_unavailable"]
                : ["no_eligible_agent_candidate"],
            fallbackReasonCode: explicitTargetRequested
                ? "explicit_target_unavailable"
                : "no_eligible_agent_candidate",
            now: startedAt,
            idProvider,
            timedOut: false,
            candidateScores,
            diagnostics,
            fastPathClassification,
            currentExecutorId: parentAgentId,
            unresolvedReasonCode: "selected_executor_unavailable",
        });
    }
    const planId = idProvider();
    const resourceLocks = input.resourceLocks ?? [];
    const delegatedTasks = [];
    const approvalRequirements = [];
    const dependencyEdges = [...(input.dependencyEdges ?? [])];
    const selectedCandidates = new Map();
    for (const [index, scope] of scopes.entries()) {
        const candidate = eligible[index % eligible.length] ?? eligible[0];
        if (!candidate)
            continue;
        candidate.selected = true;
        selectedCandidates.set(candidate.agentId, candidate);
        const taskId = `${planId}:delegated:${index}`;
        const locksForTask = input.resourceLocksByTaskId?.[taskId] ?? resourceLocks;
        delegatedTasks.push(planTask({
            taskId,
            scope,
            executionKind: "delegated_sub_agent",
            requiredCapabilities: uniqueStrings([
                ...(intent.requiredCapabilities ?? []),
                ...inferredRequiredCapabilitiesForScope(scope),
            ]),
            resourceLockIds: locksForTask.map((lock) => lock.lockId),
            candidate,
            selectedSource: "execution_decision",
            ...(intent.explicitTeamId ? { assignedTeamId: intent.explicitTeamId } : {}),
            reasonCodes: [
                "execution_decision_selected_executor",
                "planner_converted_validated_decision",
                ...candidate.reasonCodes,
            ],
            explanation: candidate.explanation,
        }));
        if (candidate.approvalRequired && candidate.approvalRisk) {
            approvalRequirements.push({
                approvalId: `${taskId}:approval:${candidate.approvalRisk}`,
                taskId,
                agentId: candidate.agentId,
                capability: candidate.approvalRisk,
                risk: candidate.approvalRisk,
                reasonCode: "agent_permission_profile_requires_approval",
            });
        }
    }
    for (let i = 0; i < delegatedTasks.length; i += 1) {
        const current = delegatedTasks[i];
        if (!current)
            continue;
        const currentLocks = input.resourceLocksByTaskId?.[current.taskId] ?? resourceLocks;
        for (let j = i + 1; j < delegatedTasks.length; j += 1) {
            const next = delegatedTasks[j];
            if (!next)
                continue;
            const nextLocks = input.resourceLocksByTaskId?.[next.taskId] ?? resourceLocks;
            if (hasExclusiveLockConflict(currentLocks, nextLocks)) {
                dependencyEdges.push({
                    fromTaskId: current.taskId,
                    toTaskId: next.taskId,
                    reasonCode: "exclusive_resource_lock_conflict",
                });
            }
        }
    }
    const parallelGroups = dependencyEdges.length === 0 && delegatedTasks.length > 1
        ? [
            {
                groupId: `${planId}:parallel:0`,
                parentRunId: input.parentRunId,
                subSessionIds: [],
                dependencyEdges: [],
                resourceLocks,
                concurrencyLimit: Math.max(1, Math.min(delegatedTasks.length, ...[...selectedCandidates.values()].map((candidate) => {
                    const agent = registry.agents.find((entry) => entry.agentId === candidate.agentId);
                    return agent?.currentLoad.maxParallelSessions ?? 1;
                }))),
                status: "planned",
            },
        ]
        : [];
    const plannerMetadata = {
        status: "planned",
        plannerVersion: ORCHESTRATION_PLANNER_VERSION,
        timedOut: false,
        latencyMs: Math.max(0, now() - startedAt),
        targetP95Ms: ORCHESTRATION_PLANNER_TARGET_P95_MS,
        semanticComparisonUsed: false,
        fastPath: fastPathClassification,
        reasonCodes: [
            "structured_scoring",
            "execution_decision_selected_executor",
            delegatedTasks.length > 1
                ? parallelGroups.length > 0
                    ? "parallel_group_planned"
                    : "parallel_candidate_serialized"
                : "single_delegated_task",
        ],
        candidateScores: candidateScores.map((candidate) => ({
            agentId: candidate.agentId,
            teamIds: candidate.teamIds,
            score: candidate.score,
            selected: candidate.selected,
            reasonCodes: candidate.reasonCodes,
            excludedReasonCodes: candidate.excludedReasonCodes,
            explanation: candidate.explanation,
        })),
        selectedExecutorSource: "execution_decision",
        ...(decisionSelectedExecutorId ? { selectedExecutorId: decisionSelectedExecutorId } : {}),
        fallbackMode: "direct_current_agent",
        directReasonCodes: [],
        fallbackReasonCodes: ["delegated_executor_runtime_failure_direct_current_agent"],
    };
    const plan = {
        identity: buildIdentity(planId, input.parentRunId, input.parentRequestId),
        planId,
        parentRunId: input.parentRunId,
        parentRequestId: input.parentRequestId,
        directNobieTasks: [],
        delegatedTasks,
        dependencyEdges,
        resourceLocks,
        parallelGroups,
        approvalRequirements,
        fallbackStrategy: {
            mode: "direct_current_agent",
            reasonCode: "delegated_executor_runtime_failure_direct_current_agent",
            currentExecutorId: parentAgentId,
        },
        plannerMetadata,
        createdAt: startedAt,
    };
    return {
        plan,
        registrySnapshot: registry,
        candidateScores,
        diagnostics,
        fastPathClassification,
        timedOut: false,
        reasonCodes: plannerMetadata.reasonCodes,
    };
}
export function createOrchestrationPlanner() {
    return { buildPlan: buildOrchestrationPlan };
}
//# sourceMappingURL=planner.js.map
