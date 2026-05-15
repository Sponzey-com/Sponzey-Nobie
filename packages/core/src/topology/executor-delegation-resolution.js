export function resolveNodeDelegation(input) {
    const candidates = normalizeCandidates(input.candidates ?? [], input.taskAnalysis).sort((a, b) => {
        const availabilityRank = availabilityScore(b.availability) - availabilityScore(a.availability);
        if (availabilityRank !== 0)
            return availabilityRank;
        return b.confidence - a.confidence;
    });
    const pathValidation = validateDelegationPath({
        currentExecutorId: input.executorId,
        ...(input.executionDecision !== undefined ? { executionDecision: input.executionDecision } : {}),
        ...(input.executionGraphSnapshot !== undefined ? { executionGraphSnapshot: input.executionGraphSnapshot } : {}),
    });
    const selected = pathValidation.ok ? selectCandidate({
        candidates,
        selectedExecutorId: input.executionDecision?.selected_executor_id,
    }) : undefined;
    const fallbackRoutes = buildFallbackRoutes(input.taskAnalysis.needsUserConfirmation, selected);
    const selectedRoute = routeForCandidate(selected, input.taskAnalysis.needsUserConfirmation);
    return {
        resolutionId: `node-delegation-resolution:${input.executorId}`,
        executorId: input.executorId,
        nodeContractId: input.nodeContractId ?? input.executorId,
        selectedRoute,
        selectedTargetId: selected?.targetId ?? selectedRoute,
        selectedTargetLabel: selected?.targetLabel ?? labelForRoute(selectedRoute),
        candidateTargets: candidates,
        selectionReason: selected && input.executionDecision?.selected_executor_id
            ? `실행 결정 계약이 선택한 ${selected.targetLabel} 실행자를 사용한다.`
            : selected
                ? `명시적으로 제공된 ${selected.targetLabel} 실행자 후보를 사용한다.`
                : !pathValidation.ok
                    ? `실행 결정 계약의 연결 경로를 사용할 수 없어 fallback 경로를 사용한다.`
                    : "사용 가능한 서브 에이전트 후보가 없어 fallback 경로를 사용한다.",
        fallbackRoutes,
        pathValidation,
        visibility: "visible_node",
        requiresUserApproval: input.taskAnalysis.needsUserConfirmation,
        createdAt: input.now ?? new Date(0).toISOString(),
    };
}
export function validateDelegationPath(input) {
    const selectedExecutorId = input.executionDecision?.selected_executor_id?.trim();
    const selectedConnectionPath = [...(input.executionDecision?.selected_connection_path ?? [])];
    const currentExecutorId = input.executionGraphSnapshot?.currentExecutorId ?? input.currentExecutorId;
    if (!selectedExecutorId) {
        return {
            ok: true,
            status: "not_requested",
            currentExecutorId,
            selectedConnectionPath,
            normalizedConnectionPath: [],
            issues: [],
        };
    }
    const graph = input.executionGraphSnapshot;
    if (graph === undefined) {
        return {
            ok: true,
            status: "not_checked",
            currentExecutorId,
            selectedExecutorId,
            selectedConnectionPath,
            normalizedConnectionPath: selectedConnectionPath.length > 0
                ? normalizeConnectionPath(currentExecutorId, selectedConnectionPath)
                : [currentExecutorId, selectedExecutorId],
            issues: [],
        };
    }
    const knownExecutorIds = new Set([
        ...Object.keys(graph.agentsById),
        ...graph.allActiveExecutorIds,
        ...graph.allRegisteredExecutorIds,
    ]);
    if (!knownExecutorIds.has(selectedExecutorId)) {
        return {
            ok: false,
            status: "selected_executor_missing",
            currentExecutorId,
            selectedExecutorId,
            selectedConnectionPath,
            normalizedConnectionPath: selectedConnectionPath,
            issues: [`selected_executor_missing:${selectedExecutorId}`],
        };
    }
    const directChildIds = new Set(graph.directChildAgentIdsByParent[currentExecutorId] ?? []);
    const normalizedConnectionPath = selectedConnectionPath.length > 0
        ? normalizeConnectionPath(currentExecutorId, selectedConnectionPath)
        : [currentExecutorId, selectedExecutorId];
    const firstHop = normalizedConnectionPath[1];
    const lastHop = normalizedConnectionPath[normalizedConnectionPath.length - 1];
    const issues = [];
    if (!firstHop || !directChildIds.has(firstHop)) {
        issues.push(`selected_executor_not_direct_child:${selectedExecutorId}`);
    }
    if (lastHop !== selectedExecutorId) {
        issues.push(`selected_connection_path_must_end_at_executor:${selectedExecutorId}`);
    }
    if (new Set(normalizedConnectionPath).size !== normalizedConnectionPath.length) {
        issues.push(`selected_connection_path_cycle:${normalizedConnectionPath.join("->")}`);
    }
    for (let index = 0; index < normalizedConnectionPath.length - 1; index += 1) {
        const fromExecutorId = normalizedConnectionPath[index];
        const toExecutorId = normalizedConnectionPath[index + 1];
        if (!fromExecutorId || !toExecutorId || graph.edgeIndex[fromExecutorId]?.[toExecutorId] === undefined) {
            issues.push(`missing_graph_edge:${fromExecutorId ?? "unknown"}->${toExecutorId ?? "unknown"}`);
        }
    }
    if (issues.length > 0) {
        const status = issues.some((issue) => issue.startsWith("selected_executor_not_direct_child:"))
            ? "selected_executor_not_direct_child"
            : "selected_connection_path_invalid";
        return {
            ok: false,
            status,
            currentExecutorId,
            selectedExecutorId,
            selectedConnectionPath,
            normalizedConnectionPath,
            issues,
        };
    }
    return {
        ok: true,
        status: "valid",
        currentExecutorId,
        selectedExecutorId,
        selectedConnectionPath,
        normalizedConnectionPath,
        issues: [],
    };
}
function normalizeConnectionPath(currentExecutorId, path) {
    const compactPath = path.map((item) => item.trim()).filter(Boolean);
    return compactPath[0] === currentExecutorId
        ? compactPath
        : [currentExecutorId, ...compactPath];
}
export function delegationCandidatesFromRegistry(input) {
    const candidates = [
        ...input.registry.agents.map((agent) => candidateFromAgent(agent, input.taskAnalysis)),
    ];
    if (input.includeTeams !== false) {
        candidates.push(...input.registry.teams.map((team) => candidateFromTeam(team, input.taskAnalysis)));
    }
    return candidates.sort((a, b) => {
        const availabilityRank = availabilityScore(b.availability) - availabilityScore(a.availability);
        if (availabilityRank !== 0)
            return availabilityRank;
        return b.confidence - a.confidence;
    });
}
function normalizeCandidates(candidates, taskAnalysis) {
    if (candidates.length === 0)
        return [];
    return candidates.map((candidate) => {
        return {
            ...candidate,
            matchedCapabilities: [...new Set(candidate.matchedCapabilities)],
            missingCapabilities: candidate.missingCapabilities.length > 0
                ? [...new Set(candidate.missingCapabilities)]
                : [...new Set([...taskAnalysis.requiredCapabilities, ...taskAnalysis.requiredTools])],
            confidence: Math.max(0, Math.min(1, candidate.confidence)),
        };
    });
}
function selectCandidate(input) {
    if (input.selectedExecutorId) {
        return input.candidates.find((candidate) => candidate.targetId === input.selectedExecutorId);
    }
    return input.candidates.find((candidate) => candidate.availability === "available");
}
function availabilityScore(availability) {
    if (availability === "available")
        return 4;
    if (availability === "busy")
        return 3;
    if (availability === "permission_required")
        return 2;
    return 1;
}
function routeForCandidate(candidate, approval) {
    if (approval)
        return "manual_approval";
    if (!candidate)
        return "nobie_direct";
    if (candidate.targetType === "agent" || candidate.targetType === "team")
        return "sub_agent";
    if (candidate.targetType === "yeonjang")
        return "yeonjang";
    return "nobie_direct";
}
function labelForRoute(route) {
    if (route === "sub_agent")
        return "서브 에이전트";
    if (route === "yeonjang")
        return "연장";
    if (route === "manual_approval")
        return "사용자 확인";
    if (route === "external")
        return "외부 실행자";
    return "노비 직접 처리";
}
function buildFallbackRoutes(approval, selected) {
    if (approval)
        return [{ route: "manual_approval", reason: "위험 경계 또는 권한 확인이 필요함" }];
    if (selected) {
        return [
            { route: "yeonjang", reason: "서브 에이전트 실행이 불가능할 때 로컬 실행 경로를 검토" },
            { route: "nobie_direct", reason: "다른 실행 경로가 없을 때 노비가 직접 처리" },
        ];
    }
    return [
        { route: "yeonjang", reason: "서브 에이전트 후보 없음" },
        { route: "nobie_direct", reason: "연장도 적합하지 않을 때 직접 처리" },
    ];
}
function candidateFromAgent(agent, taskAnalysis) {
    const missingCapabilities = [...new Set([
            ...(taskAnalysis?.requiredCapabilities ?? []),
            ...(taskAnalysis?.requiredTools ?? []),
        ])];
    return {
        targetId: agent.agentId,
        targetLabel: agent.nickname ?? agent.displayName,
        targetType: "agent",
        matchedCapabilities: [],
        missingCapabilities,
        confidence: agent.source === "db" ? 0.58 : agent.source === "topology" ? 0.56 : 0.52,
        availability: agentAvailability(agent),
    };
}
function candidateFromTeam(team, taskAnalysis) {
    return {
        targetId: team.teamId,
        targetLabel: team.nickname ?? team.displayName,
        targetType: "team",
        matchedCapabilities: [],
        missingCapabilities: [...new Set([
                ...(taskAnalysis?.requiredCapabilities ?? []),
                ...(taskAnalysis?.requiredTools ?? []),
            ])],
        confidence: 0.5,
        availability: teamAvailability(team),
    };
}
function agentAvailability(agent) {
    if (agent.status !== "enabled" || !agent.delegationEnabled)
        return "offline";
    if (!agent.capabilitySummary.available || !agent.modelSummary.available)
        return "permission_required";
    if (agent.currentLoad.activeSubSessions >= agent.currentLoad.maxParallelSessions)
        return "busy";
    return "available";
}
function teamAvailability(team) {
    if (team.status !== "enabled")
        return "offline";
    if (team.activeMemberAgentIds.length === 0)
        return "busy";
    if ((team.coverage?.capabilityCoverage.missing.length ?? 0) > 0)
        return "permission_required";
    return "available";
}
//# sourceMappingURL=executor-delegation-resolution.js.map