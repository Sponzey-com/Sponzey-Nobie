import { aggregateNodeRuntimeResults, } from "./aggregation.js";
import { checkNodeRuntimeAuthority, } from "./authority-checker.js";
import { dispatchChildWorkOrders, } from "./child-dispatcher.js";
import { planChildDelegation, } from "./delegation-planner.js";
import { checkFinalFailureExhaustion, } from "./exhaustion-checker.js";
import { generateFailureReport, } from "./failure-report.js";
import { checkNodeRuntimePermission, } from "./permission-checker.js";
import { buildNodeRecoveryReview, } from "./recovery-controller.js";
import { createLegacyResultReportFromNodeResult, createNodeResultReportFromRuntime, } from "./reporter.js";
import { createNodeRuntimeProfileSnapshot, } from "./runtime-profile.js";
import { createNodeRuntimeTraceEvent, } from "./trace.js";
import { validateAggregatedNodeResult, } from "./validation.js";
import { dispatchPlannedNodeTools, } from "./tool-dispatcher.js";
import { planNodeToolExecution, } from "./tool-planner.js";
export async function runNodeRuntime(input) {
    const now = input.now ?? Date.now;
    const envelope = input.envelope;
    const workOrder = envelope.workOrder;
    const nodeContractSnapshot = envelope.nodeContractSnapshot;
    const nodeRunId = input.nodeRunId ?? `node-run:${workOrder.workOrderId}`;
    const component = input.component ?? "node-runtime";
    const stateTransitions = [];
    const traceEvents = [];
    let childDelegation;
    let toolExecution;
    let aggregation;
    let validation;
    let recovery;
    let exhaustion;
    let failureReport;
    let traceSequence = 0;
    const recordState = (state, reasonCode, payload) => {
        const at = now();
        stateTransitions.push({ state, at, reasonCode });
        traceEvents.push(createNodeRuntimeTraceEvent({
            workOrder,
            nodeRunId,
            state,
            sequence: ++traceSequence,
            at,
            component,
            reasonCode,
            ...(payload !== undefined ? { payload } : {}),
        }));
    };
    const recordTrace = (inputTrace) => {
        traceEvents.push(createNodeRuntimeTraceEvent({
            workOrder,
            nodeRunId,
            state: inputTrace.state,
            sequence: ++traceSequence,
            at: now(),
            component,
            phase: inputTrace.phase,
            reasonCode: inputTrace.reasonCode,
            ...(inputTrace.payload !== undefined ? { payload: inputTrace.payload } : {}),
        }));
    };
    recordState("created", "node_runtime_created");
    recordState("work_order_received", "work_order_received");
    const permissionDecision = checkNodeRuntimePermission({
        workOrder,
        nodeContractSnapshot,
        compiledTopologySnapshot: input.compiledTopologySnapshot,
    });
    const authorityDecision = checkNodeRuntimeAuthority({
        workOrder,
        authorityDecision: envelope.authorityDecision,
        ...(input.authorityPreflight !== undefined ? { authorityPreflight: input.authorityPreflight } : {}),
    });
    const profileSnapshot = createNodeRuntimeProfileSnapshot({
        workOrder,
        nodeContractSnapshot,
        compiledTopologySnapshot: input.compiledTopologySnapshot,
        effectivePermissionScope: permissionDecision.effectivePermissionScope,
        ...(input.profileSnapshotId !== undefined ? { profileSnapshotId: input.profileSnapshotId } : {}),
        createdAt: now(),
    });
    const inputValidation = validateNodeRuntimeInputSchema(nodeContractSnapshot, workOrder);
    recordState("analyzing", "node_contract_analyzing", {
        nodeId: nodeContractSnapshot.id,
        workOrderId: workOrder.workOrderId,
    });
    recordState("planning", "node_runtime_planning", {
        expectedOutputIds: envelope.expectedOutputs.map((expectedOutput) => expectedOutput.outputId),
    });
    const workOrderTraceContext = () => buildWorkOrderTraceContext({
        workOrder,
        expectedOutputIds: envelope.expectedOutputs.map((expectedOutput) => expectedOutput.outputId),
    });
    const completeWithReport = (inputReport) => {
        let reportStatus = inputReport.status;
        let reportReasonCode = inputReport.reasonCode;
        let reportRisksOrGaps = [...inputReport.risksOrGaps];
        let failureReportId;
        recordState("reporting", inputReport.reasonCode, {
            nodeResultStatus: inputReport.status,
        });
        let finalState = finalStateForNodeResultStatus(reportStatus);
        if (finalState === "failed_candidate") {
            recordState("exhaustion_checking", "failed_candidate_requires_exhaustion_review", {
                nodeResultStatus: reportStatus,
            });
            if (reportStatus === "failed_candidate" && input.recovery?.enabled === true) {
                recovery = buildNodeRecoveryReview({
                    workOrder,
                    nodeContractSnapshot,
                    candidateStatus: reportStatus,
                    stateTransitions,
                    ...(childDelegation !== undefined ? { childDelegation } : {}),
                    ...(toolExecution !== undefined ? { toolExecution } : {}),
                    ...(aggregation !== undefined ? { aggregation } : {}),
                    ...(validation !== undefined ? { validation } : {}),
                    options: input.recovery,
                    now,
                });
                exhaustion = checkFinalFailureExhaustion({
                    workOrder,
                    outputs: inputReport.outputs,
                    recoveryReview: recovery,
                });
                recordTrace({
                    state: "exhaustion_checking",
                    phase: "exhaustion",
                    reasonCode: exhaustion.canFinalizeFailure ? "final_failure_guard_passed" : "final_failure_guard_blocked",
                    payload: {
                        complete: exhaustion.complete,
                        successCriteriaStillNotMet: exhaustion.successCriteriaStillNotMet,
                        untriedOptions: exhaustion.untriedOptions,
                        blockingUntriedOptions: exhaustion.blockingUntriedOptions,
                    },
                });
                reportRisksOrGaps = [
                    ...reportRisksOrGaps,
                    ...exhaustion.reasonCodes,
                    ...exhaustion.blockingUntriedOptions.map((option) => `untried_option:${option}`),
                ];
                if (exhaustion.canFinalizeFailure) {
                    failureReport = generateFailureReport({
                        workOrder,
                        nodeContractSnapshot,
                        nodeRunId,
                        outputs: inputReport.outputs,
                        risksOrGaps: reportRisksOrGaps,
                        recoveryReview: recovery,
                        exhaustion,
                        ...(inputReport.partialResult !== undefined ? { partialResult: inputReport.partialResult } : {}),
                        ...(input.recovery.recommendedAction !== undefined ? { recommendedAction: input.recovery.recommendedAction } : {}),
                        createdAt: now(),
                    });
                    reportStatus = "failed";
                    reportReasonCode = "final_failure_after_exhaustion";
                    finalState = "failed";
                    failureReportId = failureReport.failureReportId;
                }
            }
        }
        recordState(finalState, `node_runtime_${finalState}`, {
            nodeResultStatus: reportStatus,
            reasonCode: reportReasonCode,
        });
        const nodeResultReport = createNodeResultReportFromRuntime({
            profileSnapshot,
            workOrder,
            nodeRunId,
            status: reportStatus,
            outputs: inputReport.outputs,
            unmetSuccessCriteriaIds: unmetSuccessCriteriaIdsForOutputs(workOrder, inputReport.outputs),
            risksOrGaps: reportRisksOrGaps,
            ...(inputReport.partialResult !== undefined ? { partialResult: inputReport.partialResult } : {}),
            ...(failureReportId !== undefined ? { failureReportId } : {}),
            createdAt: now(),
        });
        const legacyResultReport = createLegacyResultReportFromNodeResult({
            nodeResultReport,
            envelope,
        });
        return {
            status: nodeResultReport.status,
            finalState,
            profileSnapshot,
            nodeResultReport,
            legacyResultReport,
            traceEvents,
            stateTransitions,
            permissionDecision,
            authorityDecision,
            inputValidation,
            envelope,
            ...(childDelegation !== undefined ? { childDelegation } : {}),
            ...(toolExecution !== undefined ? { toolExecution } : {}),
            ...(aggregation !== undefined ? { aggregation } : {}),
            ...(validation !== undefined ? { validation } : {}),
            ...(recovery !== undefined ? { recovery } : {}),
            ...(exhaustion !== undefined ? { exhaustion } : {}),
            ...(failureReport !== undefined ? { failureReport } : {}),
        };
    };
    if (!inputValidation.ok) {
        return completeWithReport({
            status: "failed_candidate",
            reasonCode: "input_schema_validation_failed",
            outputs: missingOutputsForExpected(envelope.expectedOutputs),
            risksOrGaps: inputValidation.issues.map((issue) => `${issue.reasonCode}:${issue.path}`),
        });
    }
    recordState("permission_checking", permissionDecision.reasonCode, {
        allowedToolIds: permissionDecision.effectivePermissionScope.allowedToolIds,
        allowedSystemIds: permissionDecision.effectivePermissionScope.allowedSystemIds,
        dataDomainIds: permissionDecision.effectivePermissionScope.dataDomainIds,
        missingToolIds: permissionDecision.missingToolIds,
        missingSystemIds: permissionDecision.missingSystemIds,
        missingDataDomainIds: permissionDecision.missingDataDomainIds,
    });
    if (!permissionDecision.allowed) {
        return completeWithReport({
            status: "permission_limited",
            reasonCode: "permission_denied",
            outputs: missingOutputsForExpected(envelope.expectedOutputs),
            risksOrGaps: [
                "permission_denied",
                ...permissionDecision.missingToolIds.map((toolId) => `missing_tool:${toolId}`),
                ...permissionDecision.missingSystemIds.map((systemId) => `missing_system:${systemId}`),
                ...permissionDecision.missingDataDomainIds.map((domainId) => `missing_data_domain:${domainId}`),
            ],
        });
    }
    recordTrace({
        state: "permission_checking",
        phase: "authority",
        reasonCode: authorityDecision.reasonCode,
        payload: {
            status: authorityDecision.status,
            requiredAuthorityRuleIds: authorityDecision.requiredAuthorityRuleIds,
            grantedAuthorityRuleIds: authorityDecision.grantedAuthorityRuleIds,
            deniedAuthorityRuleIds: authorityDecision.deniedAuthorityRuleIds,
            missingAuthorityRuleIds: authorityDecision.missingAuthorityRuleIds,
        },
    });
    if (!authorityDecision.allowed) {
        return completeWithReport({
            status: "permission_limited",
            reasonCode: "authority_denied",
            outputs: missingOutputsForExpected(envelope.expectedOutputs),
            risksOrGaps: [
                "authority_denied",
                authorityDecision.reasonCode,
                ...authorityDecision.missingAuthorityRuleIds.map((ruleId) => `missing_authority:${ruleId}`),
                ...authorityDecision.deniedAuthorityRuleIds.map((ruleId) => `denied_authority:${ruleId}`),
            ],
        });
    }
    recordState("self_executing", "self_execution_started");
    const selfExecution = await (input.selfExecute ?? defaultNodeRuntimeSelfExecute)({
        envelope,
        profileSnapshot,
        compiledTopologySnapshot: input.compiledTopologySnapshot,
        nodeRunId,
    });
    if (input.childDelegation?.enabled === true) {
        const plan = planChildDelegation({
            compiledTopologySnapshot: input.compiledTopologySnapshot,
            parentWorkOrder: workOrder,
            parentNodeId: nodeContractSnapshot.id,
            ...(input.childDelegation.targetChildNodeIds !== undefined ? { targetChildNodeIds: input.childDelegation.targetChildNodeIds } : {}),
            ...(input.childDelegation.maxDelegationDepth !== undefined ? { maxDelegationDepth: input.childDelegation.maxDelegationDepth } : {}),
            ...(input.childDelegation.childObjectiveByNodeId !== undefined ? { childObjectiveByNodeId: input.childDelegation.childObjectiveByNodeId } : {}),
            ...(input.childDelegation.childInputByNodeId !== undefined ? { childInputByNodeId: input.childDelegation.childInputByNodeId } : {}),
            ...(input.childDelegation.childWorkOrderIdByNodeId !== undefined ? { childWorkOrderIdByNodeId: input.childDelegation.childWorkOrderIdByNodeId } : {}),
            now,
        });
        if (plan.childWorkOrders.length > 0 || plan.status === "blocked" || plan.status === "partial") {
            recordState("child_delegating", "child_delegation_started", {
                ...workOrderTraceContext(),
                childNodeIds: plan.childWorkOrders.map((item) => item.childNodeId),
                target_executor_ids: plan.childWorkOrders.map((item) => item.childNodeId),
                skippedReasonCodes: plan.skipped.map((issue) => issue.reasonCode),
                maxDelegationDepth: plan.maxDelegationDepth,
                childDelegationDepth: plan.childDelegationDepth,
            });
        }
        childDelegation = await dispatchChildWorkOrders({
            plan,
            compiledTopologySnapshot: input.compiledTopologySnapshot,
            childNodeContractsById: input.childDelegation.childNodeContractsById,
            childRunner: input.childDelegation.childRunner ?? buildDefaultChildRuntimeRunner({
                now,
                component,
                parentChildDelegation: input.childDelegation,
            }),
            ...(input.childDelegation.authorityPreflightByNodeId !== undefined
                ? { authorityPreflightByNodeId: input.childDelegation.authorityPreflightByNodeId }
                : {}),
            now,
        });
        traceEvents.push(...childDelegation.traceEvents);
    }
    if (input.toolExecution?.enabled === true) {
        const plan = planNodeToolExecution({
            compiledTopologySnapshot: input.compiledTopologySnapshot,
            nodeContractSnapshot,
            workOrder,
            ...(input.toolExecution.toolRequests !== undefined ? { toolRequests: input.toolExecution.toolRequests } : {}),
            ...(input.toolExecution.defaultTimeoutMs !== undefined ? { defaultTimeoutMs: input.toolExecution.defaultTimeoutMs } : {}),
            ...(input.toolExecution.dispatcherToolNameByToolId !== undefined
                ? { dispatcherToolNameByToolId: input.toolExecution.dispatcherToolNameByToolId }
                : {}),
            ...(input.toolExecution.approvalDecisionsByToolId !== undefined
                ? { approvalDecisionsByToolId: input.toolExecution.approvalDecisionsByToolId }
                : {}),
        });
        if (plan.toolCalls.length > 0 || plan.status === "blocked" || plan.status === "partial") {
            recordState("tool_executing", "tool_execution_started", {
                toolIds: plan.toolCalls.map((call) => call.toolId),
                blockedReasonCodes: plan.blocked.map((issue) => issue.reasonCode),
            });
        }
        toolExecution = await dispatchPlannedNodeTools({
            plan,
            dispatcher: input.toolExecution.dispatcher,
            workOrder,
            nodeRunId,
            baseToolContext: input.toolExecution.baseToolContext,
            now,
            traceSequenceStart: traceSequence,
        });
        traceSequence += toolExecution.traceEvents.length;
        traceEvents.push(...toolExecution.traceEvents);
    }
    recordState("validating", "self_execution_validating");
    const normalizedSelfExecution = normalizeSelfExecutionResult(selfExecution, envelope.expectedOutputs);
    const decision = decideSelfExecutionReport({
        workOrder,
        expectedOutputs: envelope.expectedOutputs,
        selfExecution,
        outputs: normalizedSelfExecution.outputs,
    });
    if (input.aggregation?.enabled === true) {
        recordTrace({
            state: "validating",
            phase: "aggregation",
            reasonCode: "aggregation_started",
            payload: {
                ...workOrderTraceContext(),
                source_executor_ids: [
                    workOrder.to.id,
                    ...(childDelegation?.results.map((result) => result.childNodeId) ?? []),
                    ...(toolExecution?.results.map((result) => result.toolId) ?? []),
                ],
            },
        });
        aggregation = aggregateNodeRuntimeResults({
            workOrder,
            strategy: input.aggregation.strategy ?? "merge_and_validate",
            selfOutputs: normalizedSelfExecution.outputs,
            selfStatus: decision.status,
            selfRisksOrGaps: [
                ...decision.risksOrGaps,
                ...(selfExecution.risksOrGaps ?? []),
            ],
            ...(childDelegation !== undefined ? { childDelegation } : {}),
            ...(toolExecution !== undefined ? { toolExecution } : {}),
            ...(input.aggregation.expectedChildNodeIds !== undefined ? { expectedChildNodeIds: input.aggregation.expectedChildNodeIds } : {}),
            ...(input.aggregation.requireAllChildResults !== undefined ? { requireAllChildResults: input.aggregation.requireAllChildResults } : {}),
            ...(input.aggregation.quorum !== undefined ? { quorum: input.aggregation.quorum } : {}),
        });
        const allowPartialSuccess = input.aggregation.allowPartialSuccess
            ?? nodeContractSnapshot.recoveryPolicy?.partialSuccessAllowed
            ?? nodeContractSnapshot.failurePolicy?.allowPartialSuccess;
        validation = validateAggregatedNodeResult({
            workOrder,
            aggregation,
            ...(allowPartialSuccess !== undefined ? { allowPartialSuccess } : {}),
        });
        recordTrace({
            state: "validating",
            phase: "validation",
            reasonCode: `aggregation_${validation.status}`,
            payload: {
                ...workOrderTraceContext(),
                aggregation_result: {
                    strategy: aggregation.strategy,
                    source_executor_ids: aggregation.sources.map((source) => source.sourceId),
                    issue_codes: aggregation.issues.map((issue) => issue.reasonCode),
                    output_count: aggregation.outputs.length,
                    missing_child_node_ids: aggregation.missingChildNodeIds,
                },
                validation_result: {
                    status: validation.status,
                    node_result_status: validation.nodeResultStatus,
                    risk_or_gap_count: validation.risksOrGaps.length,
                },
                self_solve_attempt: {
                    executor_id: workOrder.to.id,
                    status: selfExecution.status ?? decision.status,
                    reason_code: selfExecution.reasonCode ?? decision.reasonCode,
                },
            },
        });
        return completeWithReport({
            status: validation.nodeResultStatus,
            reasonCode: `aggregation_${validation.status}`,
            outputs: validation.outputs,
            risksOrGaps: validation.risksOrGaps,
        });
    }
    const delegationRisks = childDelegationRiskCodes(childDelegation);
    const toolRisks = toolExecutionRiskCodes(toolExecution);
    const finalDecision = delegationRisks.length > 0
        ? {
            status: "failed_candidate",
            reasonCode: "child_delegation_failed_candidate",
            risksOrGaps: [
                "child_failure_held_for_parent_exhaustion",
                ...delegationRisks,
            ],
        }
        : toolRisks.length > 0
            ? {
                status: "failed_candidate",
                reasonCode: "tool_execution_failed_candidate",
                risksOrGaps: [
                    "tool_failure_held_for_retry_or_fallback",
                    ...toolRisks,
                ],
            }
            : decision;
    return completeWithReport({
        status: finalDecision.status,
        reasonCode: finalDecision.reasonCode,
        outputs: normalizedSelfExecution.outputs,
        risksOrGaps: [
            ...finalDecision.risksOrGaps,
            ...(selfExecution.risksOrGaps ?? []),
        ],
        ...(selfExecution.partialResult !== undefined ? { partialResult: selfExecution.partialResult } : {}),
    });
}
export function validateNodeRuntimeInputSchema(nodeContractSnapshot, workOrder) {
    const schema = getNodeRuntimeInputSchema(nodeContractSnapshot);
    if (schema === undefined)
        return { ok: true, issues: [] };
    const issues = [];
    if (schema.type !== undefined && schema.type !== "object") {
        issues.push({
            path: "$.metadata.inputSchema.type",
            reasonCode: "input_schema_unsupported_type",
            message: "Node runtime input schema must describe an object input.",
        });
    }
    const required = Array.isArray(schema.required)
        ? schema.required.filter((item) => typeof item === "string" && item.trim().length > 0)
        : [];
    for (const key of required) {
        if (!Object.prototype.hasOwnProperty.call(workOrder.input, key) || workOrder.input[key] === undefined) {
            issues.push({
                path: `$.input.${key}`,
                reasonCode: "input_required_field_missing",
                message: `Required input field ${key} is missing.`,
            });
        }
    }
    const properties = isRecord(schema.properties) ? schema.properties : {};
    for (const [key, propertySchema] of Object.entries(properties)) {
        if (!isRecord(propertySchema))
            continue;
        if (!Object.prototype.hasOwnProperty.call(workOrder.input, key) || workOrder.input[key] === undefined)
            continue;
        const expectedType = typeof propertySchema.type === "string" ? propertySchema.type : undefined;
        if (expectedType === undefined)
            continue;
        if (!enterpriseValueMatchesSchemaType(workOrder.input[key], expectedType)) {
            issues.push({
                path: `$.input.${key}`,
                reasonCode: "input_field_type_mismatch",
                message: `Input field ${key} must be ${expectedType}.`,
            });
        }
    }
    return issues.length === 0 ? { ok: true, issues: [] } : { ok: false, issues };
}
function defaultNodeRuntimeSelfExecute(context) {
    return {
        status: "completed",
        outputs: context.envelope.expectedOutputs.map((expectedOutput) => ({
            outputId: expectedOutput.outputId,
            status: "satisfied",
            value: defaultOutputValueForExpectedOutput(context.envelope.workOrder, expectedOutput),
        })),
        reasonCode: "self_execution_completed",
    };
}
function defaultOutputValueForExpectedOutput(workOrder, expectedOutput) {
    if (expectedOutput.outputId === `${workOrder.workOrderId}:expected-output-schema`) {
        const required = Array.isArray(workOrder.expectedOutputSchema.required)
            ? workOrder.expectedOutputSchema.required.filter((item) => typeof item === "string" && item.trim().length > 0)
            : [];
        return {
            generatedBy: "node-runtime-mvp",
            workOrderId: workOrder.workOrderId,
            expectedOutputKind: expectedOutput.kind,
            ...Object.fromEntries(required.map((key) => [key, `placeholder:${key}`])),
        };
    }
    return {
        generatedBy: "node-runtime-mvp",
        workOrderId: workOrder.workOrderId,
        expectedOutputKind: expectedOutput.kind,
    };
}
function buildDefaultChildRuntimeRunner(input) {
    return async (childInput) => {
        const childDelegation = input.parentChildDelegation.recursive === false
            ? undefined
            : childDelegationOptionsForRecursiveChild(input.parentChildDelegation);
        const result = await runNodeRuntime({
            envelope: childInput.childEnvelope,
            compiledTopologySnapshot: childInput.compiledTopologySnapshot,
            nodeRunId: `node-run:${childInput.planItem.workOrder.workOrderId}`,
            now: input.now,
            component: input.component,
            ...(childDelegation !== undefined ? { childDelegation } : {}),
            ...(childDelegation !== undefined
                ? {
                    aggregation: {
                        enabled: true,
                        strategy: "parent_decides",
                        expectedChildNodeIds: childInput.compiledTopologySnapshot.parentChildTree.edges[childInput.planItem.childNodeId] ?? [],
                        requireAllChildResults: false,
                        allowPartialSuccess: true,
                    },
                }
                : {}),
        });
        return {
            status: result.status,
            finalState: result.finalState,
            nodeResultReport: result.nodeResultReport,
            traceEvents: result.traceEvents,
            risksOrGaps: result.nodeResultReport.risksOrGaps,
        };
    };
}
function childDelegationOptionsForRecursiveChild(options) {
    return {
        enabled: true,
        childNodeContractsById: options.childNodeContractsById,
        ...(options.maxDelegationDepth !== undefined ? { maxDelegationDepth: options.maxDelegationDepth } : {}),
        ...(options.recursive !== undefined ? { recursive: options.recursive } : {}),
        ...(options.childObjectiveByNodeId !== undefined ? { childObjectiveByNodeId: options.childObjectiveByNodeId } : {}),
        ...(options.childInputByNodeId !== undefined ? { childInputByNodeId: options.childInputByNodeId } : {}),
        ...(options.childWorkOrderIdByNodeId !== undefined ? { childWorkOrderIdByNodeId: options.childWorkOrderIdByNodeId } : {}),
        ...(options.authorityPreflightByNodeId !== undefined ? { authorityPreflightByNodeId: options.authorityPreflightByNodeId } : {}),
    };
}
function buildWorkOrderTraceContext(input) {
    const rootRunId = metadataString(input.workOrder.input.rootRunId);
    const fallbackReason = metadataString(input.workOrder.input.fallbackReason)
        ?? metadataString(input.workOrder.input.routingReasonCode);
    return {
        ...(rootRunId !== undefined ? { parent_run_id: rootRunId } : {}),
        delegating_executor_id: input.workOrder.fromNodeId,
        target_executor_id: input.workOrder.to.id,
        work_order_id: input.workOrder.workOrderId,
        work_order_goal: input.workOrder.objective,
        expected_output: input.expectedOutputIds,
        ...(fallbackReason !== undefined ? { fallback_reason: fallbackReason } : {}),
    };
}
function metadataString(value) {
    return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}
function childDelegationRiskCodes(summary) {
    if (summary === undefined)
        return [];
    const risks = [
        ...summary.failureCandidateResults.flatMap((result) => [
            `child_result_${result.status}:${result.childNodeId}`,
            ...result.risksOrGaps,
        ]),
        ...(summary.status === "blocked" && summary.plan.status !== "skipped"
            ? summary.plan.skipped.map((issue) => `${issue.reasonCode}:${issue.childNodeId ?? issue.parentNodeId}`)
            : []),
        ...(summary.plan.status === "partial"
            ? summary.plan.skipped.map((issue) => `${issue.reasonCode}:${issue.childNodeId ?? issue.parentNodeId}`)
            : []),
    ];
    return [...new Set(risks.filter((risk) => risk.trim().length > 0))];
}
function toolExecutionRiskCodes(summary) {
    if (summary === undefined)
        return [];
    const risks = summary.failureCandidateResults.flatMap((result) => [
        `tool_result_${result.status}:${result.toolId}`,
        result.reasonCode,
        ...(result.retryPossible ? ["tool_retry_possible"] : []),
        ...(result.fallbackPossible ? ["tool_fallback_possible"] : []),
        ...(result.error !== undefined ? [`tool_error:${result.error}`] : []),
    ]);
    return [...new Set(risks.filter((risk) => risk.trim().length > 0))];
}
function normalizeSelfExecutionResult(selfExecution, expectedOutputs) {
    const outputs = (selfExecution.outputs ?? []).map((output) => cloneOutput(output));
    const outputsById = new Map(outputs.map((output) => [output.outputId, output]));
    for (const expectedOutput of expectedOutputs) {
        if (outputsById.has(expectedOutput.outputId))
            continue;
        outputs.push({
            outputId: expectedOutput.outputId,
            status: "missing",
        });
    }
    return { outputs };
}
function decideSelfExecutionReport(input) {
    const requestedStatus = input.selfExecution.status ?? "completed";
    const outputsById = new Map(input.outputs.map((output) => [output.outputId, output]));
    const unmetRequiredOutputIds = input.expectedOutputs
        .filter((expectedOutput) => expectedOutput.required)
        .filter((expectedOutput) => outputsById.get(expectedOutput.outputId)?.status !== "satisfied")
        .map((expectedOutput) => expectedOutput.outputId);
    if (requestedStatus === "failed") {
        return {
            status: "failed_candidate",
            reasonCode: input.selfExecution.reasonCode ?? "self_execution_failed_candidate",
            risksOrGaps: [
                "failed_status_normalized_to_failed_candidate",
                ...unmetRequiredOutputIds.map((outputId) => `unmet_required_output:${outputId}`),
            ],
        };
    }
    if (requestedStatus === "completed" && unmetRequiredOutputIds.length > 0) {
        return {
            status: "failed_candidate",
            reasonCode: "required_outputs_unmet",
            risksOrGaps: unmetRequiredOutputIds.map((outputId) => `unmet_required_output:${outputId}`),
        };
    }
    if (requestedStatus === "needs_revision") {
        return {
            status: "failed_candidate",
            reasonCode: input.selfExecution.reasonCode ?? "needs_revision_normalized_to_failed_candidate",
            risksOrGaps: unmetRequiredOutputIds.map((outputId) => `unmet_required_output:${outputId}`),
        };
    }
    if (requestedStatus === "permission_limited") {
        return {
            status: "permission_limited",
            reasonCode: input.selfExecution.reasonCode ?? "self_execution_permission_limited",
            risksOrGaps: unmetRequiredOutputIds.map((outputId) => `unmet_required_output:${outputId}`),
        };
    }
    if (requestedStatus === "failed_candidate") {
        return {
            status: "failed_candidate",
            reasonCode: input.selfExecution.reasonCode ?? "self_execution_failed_candidate",
            risksOrGaps: unmetRequiredOutputIds.map((outputId) => `unmet_required_output:${outputId}`),
        };
    }
    if (requestedStatus === "partial_success") {
        return {
            status: "partial_success",
            reasonCode: input.selfExecution.reasonCode ?? "self_execution_partial_success",
            risksOrGaps: unmetRequiredOutputIds.map((outputId) => `unmet_required_output:${outputId}`),
        };
    }
    return {
        status: "completed",
        reasonCode: input.selfExecution.reasonCode ?? "self_execution_completed",
        risksOrGaps: [],
    };
}
function finalStateForNodeResultStatus(status) {
    if (status === "completed")
        return "completed";
    if (status === "partial_success")
        return "partial_success";
    if (status === "failed")
        return "failed";
    return "failed_candidate";
}
function missingOutputsForExpected(expectedOutputs) {
    return expectedOutputs.map((expectedOutput) => ({
        outputId: expectedOutput.outputId,
        status: "missing",
    }));
}
function unmetSuccessCriteriaIdsForOutputs(workOrder, outputs) {
    const outputsById = new Map(outputs.map((output) => [output.outputId, output]));
    return workOrder.successCriteria
        .filter((criterion) => criterion.required)
        .filter((criterion) => outputsById.get(criterion.criterionId)?.status !== "satisfied")
        .map((criterion) => criterion.criterionId);
}
function cloneOutput(output) {
    return {
        outputId: output.outputId,
        status: output.status,
        ...(output.value !== undefined ? { value: structuredClone(output.value) } : {}),
    };
}
function getNodeRuntimeInputSchema(nodeContractSnapshot) {
    const metadata = nodeContractSnapshot.metadata;
    if (metadata === undefined)
        return undefined;
    const inputSchema = metadata.inputSchema ?? metadata.runtimeInputSchema;
    return isRecord(inputSchema) ? inputSchema : undefined;
}
function enterpriseValueMatchesSchemaType(value, expectedType) {
    switch (expectedType) {
        case "string":
            return typeof value === "string";
        case "number":
            return typeof value === "number" && Number.isFinite(value);
        case "integer":
            return typeof value === "number" && Number.isInteger(value);
        case "boolean":
            return typeof value === "boolean";
        case "object":
            return isRecord(value);
        case "array":
            return Array.isArray(value);
        case "null":
            return value === null;
        default:
            return true;
    }
}
function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
//# sourceMappingURL=node-runtime.js.map
