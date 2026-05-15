import { buildWorkOrder } from "../topology-runtime/work-order.js";
import { chooseRecoveryAlternative } from "../runs/recovery-controller.js";
import { createRecoveryStrategyLedger } from "../runs/recovery-strategy-ledger.js";
import { guardTerminalFailure } from "../runs/terminal-failure-guard.js";
export function simulateGraphExecutionPlan(input) {
    const at = input.now ?? new Date(0).toISOString();
    const events = [
        event(input.plan, "graph_plan_created", at, {
            status: "pending",
            payload: { entryExecutorIds: input.plan.entryExecutorIds },
        }),
    ];
    if (input.cancelled) {
        for (const node of input.plan.nodePlans) {
            events.push(event(input.plan, "node_execution_cancelled", at, {
                executorId: node.executorId,
                status: "cancelled",
                cancellationReason: "user_cancelled",
            }));
        }
        const outcome = normalizeGraphExecutionOutcome({
            status: "cancelled",
            cancellationReason: "user_cancelled",
        });
        events.push(event(input.plan, "graph_execution_cancelled", at, {
            status: outcome.status,
            cancellationReason: outcome.cancellationReason,
        }));
        return { status: outcome.status, outcome, activeExecutorIds: [], activeEdgeIds: [], events };
    }
    for (const node of input.plan.nodePlans) {
        events.push(event(input.plan, "node_execution_planning", at, {
            executorId: node.executorId,
            status: "planning",
            activeExecutorIds: [node.executorId],
            payload: {
                taskAnalysisId: node.taskAnalysis.analysisId,
                delegationResolutionId: node.delegationResolution.resolutionId,
            },
        }));
        events.push(event(input.plan, "node_delegation_started", at, {
            executorId: node.executorId,
            status: "delegating",
            activeExecutorIds: [node.executorId],
            payload: {
                selectedRoute: node.delegationResolution.selectedRoute,
                selectedTargetId: node.delegationResolution.selectedTargetId,
            },
        }));
        events.push(event(input.plan, "node_execution_started", at, {
            executorId: node.executorId,
            status: "running",
            activeExecutorIds: [node.executorId],
        }));
        if (input.failure?.executorId === node.executorId) {
            const guarded = guardTerminalFailure({
                reason: input.failure.reason,
                ...(input.failure.explicitUserLimit !== undefined
                    ? { explicitUserLimit: input.failure.explicitUserLimit }
                    : {}),
            });
            if (!guarded.ok) {
                const recovery = chooseRecoveryAlternative({
                    taskAnalysis: node.taskAnalysis,
                    ledger: createRecoveryStrategyLedger(),
                    scopeId: node.executorId,
                    failureReason: input.failure.reason,
                    baseStrategyKey: recoveryStrategyKeyForNodePlan(node),
                    now: Date.parse(at),
                });
                events.push(event(input.plan, "node_recovery_started", at, {
                    executorId: node.executorId,
                    status: "recovering",
                    activeExecutorIds: [node.executorId],
                    recoveryReason: guarded.recoverySignal.reason,
                    payload: {
                        originalReason: guarded.recoverySignal.originalReason,
                        recoveryDecision: recovery.decision,
                    },
                }));
                continue;
            }
            events.push(event(input.plan, "node_execution_failed", at, {
                executorId: node.executorId,
                status: "failed",
                terminalReason: guarded.terminalReason,
            }));
            const outcome = normalizeGraphExecutionOutcome({
                status: "failed",
                terminalReason: guarded.terminalReason,
            });
            return {
                status: outcome.status,
                outcome,
                activeExecutorIds: [],
                activeEdgeIds: [],
                events: [
                    ...events,
                    event(input.plan, "graph_execution_completed", at, {
                        status: outcome.status,
                        ...(outcome.terminalReason ? { terminalReason: outcome.terminalReason } : {}),
                    }),
                ],
            };
        }
        events.push(event(input.plan, "node_execution_completed", at, {
            executorId: node.executorId,
            status: "completed",
        }));
        const outgoing = input.plan.edgePlans.filter((edgePlan) => edgePlan.sourceExecutorId === node.executorId);
        for (const edgePlan of outgoing) {
            const envelope = {
                edgeId: edgePlan.edgeId,
                sourceExecutorId: edgePlan.sourceExecutorId,
                targetExecutorId: edgePlan.targetExecutorId,
                relationKind: edgePlan.relationKind,
                outputBinding: `${edgePlan.sourceExecutorId}:output`,
                inputBinding: `${edgePlan.targetExecutorId}:input`,
            };
            events.push(event(input.plan, "edge_handoff_started", at, {
                edgeId: edgePlan.edgeId,
                status: "running",
                activeExecutorIds: [edgePlan.sourceExecutorId, edgePlan.targetExecutorId],
                activeEdgeIds: [edgePlan.edgeId],
                payload: envelope,
            }));
            events.push(event(input.plan, "edge_handoff_completed", at, {
                edgeId: edgePlan.edgeId,
                status: "completed",
                payload: envelope,
            }));
        }
    }
    const outcome = normalizeGraphExecutionOutcome({ status: "completed" });
    events.push(event(input.plan, "graph_execution_completed", at, { status: outcome.status }));
    return { status: outcome.status, outcome, activeExecutorIds: [], activeEdgeIds: [], events };
}
export function buildWorkOrderFromNodeExecutionPlan(input) {
    const metadata = {
        graphExecutionPlanId: input.plan.graphExecutionPlanId,
        topologyId: input.plan.topologyId,
        workspaceId: input.plan.workspaceId,
        executorId: input.nodePlan.executorId,
        nodeContractId: input.nodePlan.nodeContractId,
        ...(input.edgeId ? { edgeId: input.edgeId } : {}),
        delegationResolutionId: input.nodePlan.delegationResolution.resolutionId,
        taskAnalysisId: input.nodePlan.taskAnalysis.analysisId,
        selectedRoute: input.nodePlan.delegationResolution.selectedRoute,
        selectedTargetId: input.nodePlan.delegationResolution.selectedTargetId,
        systemPreparation: input.systemPreparation === true,
    };
    const taskAnalysis = input.nodePlan.taskAnalysis;
    return buildWorkOrder({
        workOrderId: `work-order:${input.plan.graphExecutionPlanId}:${input.nodePlan.executorId}`,
        topologyRunId: input.topologyRunId ?? `topology-run:${input.plan.graphExecutionPlanId}`,
        parentWorkOrderId: input.parentWorkOrderId ?? null,
        fromNodeId: input.edgeId
            ? input.plan.edgePlans.find((edge) => edge.edgeId === input.edgeId)?.sourceExecutorId ?? input.nodePlan.executorId
            : input.nodePlan.executorId,
        to: {
            type: "node",
            id: input.nodePlan.nodeContractId,
        },
        objective: taskAnalysis.purpose,
        scope: {
            included: taskAnalysis.goals,
            excluded: taskAnalysis.failureBoundaries,
        },
        input: {
            executorGraph: metadataToEnterpriseValue(metadata),
            inputNeeds: taskAnalysis.inputNeeds,
            taskUnits: taskAnalysis.taskUnits.map((taskUnit) => ({
                taskUnitId: taskUnit.taskUnitId,
                title: taskUnit.title,
                description: taskUnit.description,
            })),
        },
        expectedOutputSchema: {
            outputShape: taskAnalysis.outputShape,
            completionCondition: taskAnalysis.completionCondition,
            taskAnalysisId: taskAnalysis.analysisId,
        },
        successCriteria: taskAnalysis.successSignals.map((signal, index) => ({
            criterionId: `success:${input.nodePlan.executorId}:${index + 1}`,
            description: signal,
            required: true,
            validationKind: "evidence",
            metadata: {
                graphExecutionPlanId: input.plan.graphExecutionPlanId,
                executorId: input.nodePlan.executorId,
            },
        })),
        permissionScope: {
            allowedToolIds: taskAnalysis.requiredTools,
            allowedSystemIds: taskAnalysis.requiredTools.filter((toolId) => toolId.startsWith("system:")),
            dataDomainIds: [],
            riskLevel: taskAnalysis.needsUserConfirmation ? "high" : "low",
        },
        authorityScope: {
            requiredAuthorityRuleIds: taskAnalysis.needsUserConfirmation
                ? [`authority:${input.nodePlan.executorId}:user-confirmation`]
                : [],
            approvalRequired: taskAnalysis.needsUserConfirmation ||
                input.nodePlan.delegationResolution.selectedRoute === "manual_approval",
        },
        failureReportRequired: true,
        delegationPath: [
            input.plan.graphExecutionPlanId,
            input.nodePlan.executorId,
            input.nodePlan.delegationResolution.selectedTargetId,
        ],
        createdAt: input.createdAt ?? input.plan.createdAt,
    });
}
export function readGraphWorkOrderMetadata(workOrder) {
    const metadata = workOrder.input.executorGraph;
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata))
        return null;
    const record = metadata;
    if (typeof record.graphExecutionPlanId !== "string")
        return null;
    if (typeof record.executorId !== "string")
        return null;
    if (typeof record.delegationResolutionId !== "string")
        return null;
    if (typeof record.taskAnalysisId !== "string")
        return null;
    return {
        graphExecutionPlanId: record.graphExecutionPlanId,
        topologyId: typeof record.topologyId === "string" ? record.topologyId : "",
        workspaceId: typeof record.workspaceId === "string" ? record.workspaceId : "",
        executorId: record.executorId,
        nodeContractId: typeof record.nodeContractId === "string" ? record.nodeContractId : record.executorId,
        ...(typeof record.edgeId === "string" ? { edgeId: record.edgeId } : {}),
        delegationResolutionId: record.delegationResolutionId,
        taskAnalysisId: record.taskAnalysisId,
        selectedRoute: typeof record.selectedRoute === "string" ? record.selectedRoute : "nobie_direct",
        selectedTargetId: typeof record.selectedTargetId === "string" ? record.selectedTargetId : "nobie_direct",
        systemPreparation: record.systemPreparation === true,
    };
}
export function assertVisibleUserWorkOrder(workOrder) {
    const metadata = readGraphWorkOrderMetadata(workOrder);
    if (!metadata)
        return { ok: false, reasonCode: "missing_graph_metadata" };
    if (!metadata.executorId.trim())
        return { ok: false, reasonCode: "missing_executor_id" };
    if (metadata.systemPreparation && hasUserResultShape(workOrder)) {
        return { ok: false, reasonCode: "system_preparation_user_result_blocked" };
    }
    return { ok: true, metadata };
}
export function normalizeGraphExecutionOutcome(input) {
    if (input.status === "cancelled") {
        return {
            status: "cancelled",
            cancellationReason: input.cancellationReason ?? "user_cancelled",
            recoveryState: "cancelled",
        };
    }
    if (input.status === "completed") {
        return { status: "completed", recoveryState: "not_needed" };
    }
    if (input.status === "waiting_for_user") {
        return { status: "waiting_for_user", recoveryState: "waiting_for_user" };
    }
    const guarded = guardTerminalFailure({
        reason: input.terminalReason ?? "unknown",
        ...(input.explicitUserLimit !== undefined ? { explicitUserLimit: input.explicitUserLimit } : {}),
    });
    if (!guarded.ok) {
        return {
            status: "waiting_for_user",
            recoveryState: "needs_alternative",
            recoverySignal: guarded.recoverySignal.reason,
            diagnosticId: `recovery-signal:${guarded.recoverySignal.originalReason}`,
        };
    }
    return {
        status: "failed",
        terminalReason: guarded.terminalReason,
        recoveryState: guarded.terminalReason === "no_safe_alternative"
            ? "no_safe_alternative"
            : "waiting_for_user",
    };
}
function event(plan, type, at, refs = {}) {
    return {
        eventId: `graph-event:${plan.graphExecutionPlanId}:${type}:${refs.executorId ?? refs.edgeId ?? "graph"}`,
        graphExecutionPlanId: plan.graphExecutionPlanId,
        type,
        ...(refs.executorId ? { executorId: refs.executorId } : {}),
        ...(refs.edgeId ? { edgeId: refs.edgeId } : {}),
        ...(refs.status ? { status: refs.status } : {}),
        activeExecutorIds: refs.activeExecutorIds ?? [],
        activeEdgeIds: refs.activeEdgeIds ?? [],
        ...(refs.terminalReason ? { terminalReason: refs.terminalReason } : {}),
        ...(refs.recoveryReason ? { recoveryReason: refs.recoveryReason } : {}),
        ...(refs.cancellationReason ? { cancellationReason: refs.cancellationReason } : {}),
        ...(refs.payload ? { payload: refs.payload } : {}),
        at,
    };
}
function metadataToEnterpriseValue(metadata) {
    return {
        graphExecutionPlanId: metadata.graphExecutionPlanId,
        topologyId: metadata.topologyId,
        workspaceId: metadata.workspaceId,
        executorId: metadata.executorId,
        nodeContractId: metadata.nodeContractId,
        ...(metadata.edgeId ? { edgeId: metadata.edgeId } : {}),
        delegationResolutionId: metadata.delegationResolutionId,
        taskAnalysisId: metadata.taskAnalysisId,
        selectedRoute: metadata.selectedRoute,
        selectedTargetId: metadata.selectedTargetId,
        systemPreparation: metadata.systemPreparation,
    };
}
function hasUserResultShape(workOrder) {
    return workOrder.successCriteria.length > 0 ||
        typeof workOrder.expectedOutputSchema.outputShape === "string" ||
        typeof workOrder.expectedOutputSchema.completionCondition === "string";
}
function recoveryStrategyKeyForNodePlan(node) {
    const taskUnitTitles = node.taskAnalysis.taskUnits.map((taskUnit) => taskUnit.title);
    const taskUnitIds = node.taskAnalysis.taskUnits.map((taskUnit) => taskUnit.taskUnitId);
    const inputNeedsHash = node.taskAnalysis.inputNeeds.join("|") || "input:none";
    const decompositionHash = taskUnitTitles.join("|") || node.executorId;
    const userConfirmationState = node.taskAnalysis.needsUserConfirmation ? "required" : "not_required";
    return {
        targetRoute: node.delegationResolution.selectedRoute,
        targetAgentId: node.delegationResolution.selectedTargetId,
        executorId: node.delegationResolution.selectedTargetId ?? node.executorId,
        toolIds: node.taskAnalysis.requiredTools,
        sourceIds: node.taskAnalysis.requiredTools,
        inputShapeHash: inputNeedsHash,
        promptContextHash: inputNeedsHash,
        normalizedTaskHash: decompositionHash,
        decompositionHash,
        fileTargets: [],
        permissionProfile: node.taskAnalysis.needsUserConfirmation ? "confirmation_required" : "default",
        userConfirmationState,
        executionOrderHash: taskUnitIds.join(">") || "single",
        verificationMethod: node.taskAnalysis.completionCondition,
    };
}
//# sourceMappingURL=graph-execution-runner.js.map