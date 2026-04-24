import { getConfig } from "../config/index.js";
import { insertAuditLog, upsertTaskContinuity } from "../db/index.js";
import { eventBus } from "../events/index.js";
import { createLogger } from "../logger/index.js";
import { consumeApprovalRegistryDecision, createApprovalRegistryRequest, expireApprovalRegistryRequest, resolveApprovalRegistryDecision, } from "../runs/approval-registry.js";
import { buildToolCallIdempotencyKey, findDuplicateToolCall, getAllowRepeatReason, isDedupeTargetTool, recordMessageLedgerEvent, } from "../runs/message-ledger.js";
import { appendRunEvent, cancelRootRun, getRootRun, hasActiveRequestGroupRuns, setRunStepStatus, updateRunStatus, } from "../runs/store.js";
import { buildWebRetrievalPolicyDecision } from "../runs/web-retrieval-policy.js";
import { acquireAgentCapabilityRateLimit, evaluateAgentToolCapabilityPolicy, } from "../security/capability-isolation.js";
import { isToolExtensionSelectable } from "../security/extension-governance.js";
import { evaluateAndRecordToolPolicy, sanitizePolicyDenialForUser, } from "../security/tool-policy.js";
const log = createLogger("tools:dispatcher");
function rememberApprovalContinuity(runId, params) {
    try {
        const run = getRootRun(runId);
        if (!run)
            return;
        const lineageRootRunId = run?.lineageRootRunId ?? run?.requestGroupId ?? runId;
        upsertTaskContinuity({
            lineageRootRunId,
            ...(run?.parentRunId ? { parentRunId: run.parentRunId } : {}),
            ...(run?.handoffSummary ? { handoffSummary: run.handoffSummary } : {}),
            ...(params.pendingApprovals ? { pendingApprovals: params.pendingApprovals } : {}),
            ...(params.status ? { status: params.status } : {}),
            ...(params.lastGoodState ? { lastGoodState: params.lastGoodState } : {}),
        });
    }
    catch (error) {
        log.warn(`approval continuity update failed: ${error instanceof Error ? error.message : String(error)}`);
    }
}
function describeApprovalDenial(toolName, kind, reason) {
    if (reason === "timeout") {
        return kind === "screen_confirmation"
            ? {
                eventLabel: `${toolName} 준비 확인 시간 초과`,
                stepSummary: `${toolName} 실행 전 준비 확인 응답 시간이 지나 시스템이 요청을 중단했습니다.`,
                runSummary: `${toolName} 준비 확인 시간이 지나 시스템이 요청을 중단했습니다.`,
            }
            : {
                eventLabel: `${toolName} 승인 시간 초과`,
                stepSummary: `${toolName} 승인 대기 시간이 지나 시스템이 요청을 중단했습니다.`,
                runSummary: `${toolName} 승인 시간이 지나 시스템이 요청을 중단했습니다.`,
            };
    }
    if (reason === "system" || reason === "abort") {
        return kind === "screen_confirmation"
            ? {
                eventLabel: `${toolName} 준비 확인 중단`,
                stepSummary: `${toolName} 실행 전 준비 확인이 시스템에 의해 중단되었습니다.`,
                runSummary: `${toolName} 준비 확인이 시스템에 의해 중단되었습니다.`,
            }
            : {
                eventLabel: `${toolName} 승인 처리 중단`,
                stepSummary: `${toolName} 승인 처리가 시스템에 의해 중단되었습니다.`,
                runSummary: `${toolName} 승인 처리가 시스템에 의해 중단되었습니다.`,
            };
    }
    return kind === "screen_confirmation"
        ? {
            eventLabel: `${toolName} 준비 확인 거부`,
            stepSummary: `${toolName} 실행 전 준비 확인이 거부되어 요청을 취소했습니다.`,
            runSummary: `${toolName} 준비 확인이 거부되어 요청을 취소했습니다.`,
        }
        : {
            eventLabel: `${toolName} 실행 거부`,
            stepSummary: `${toolName} 실행이 거부되어 요청을 취소했습니다.`,
            runSummary: `${toolName} 실행이 거부되어 요청을 취소했습니다.`,
        };
}
export class ToolDispatcher {
    tools = new Map();
    runApprovalScopes = new Map();
    runSingleApprovalScopes = new Set();
    pendingInteractionKinds = new Map();
    constructor() {
        eventBus.on("run.completed", ({ run }) => {
            this.clearApprovalScopesForCompletedRun(run.id);
        });
        eventBus.on("run.failed", ({ run }) => {
            this.clearApprovalScopesForCompletedRun(run.id);
        });
        eventBus.on("run.cancelled", ({ run }) => {
            this.clearApprovalScopesForCompletedRun(run.id);
        });
    }
    getApprovalOwnerKey(runId) {
        return getRootRun(runId)?.requestGroupId ?? runId;
    }
    clearApprovalScopesForCompletedRun(runId) {
        const ownerKey = this.getApprovalOwnerKey(runId);
        this.pendingInteractionKinds.delete(runId);
        if (hasActiveRequestGroupRuns(ownerKey))
            return;
        this.runApprovalScopes.delete(ownerKey);
        this.runSingleApprovalScopes.delete(ownerKey);
    }
    register(tool) {
        this.tools.set(tool.name, tool);
        log.debug(`Registered tool: ${tool.name} (${tool.riskLevel})`);
    }
    grantRunApprovalScope(runId) {
        const ownerKey = this.getApprovalOwnerKey(runId);
        this.runSingleApprovalScopes.delete(ownerKey);
        this.runApprovalScopes.set(ownerKey, "allow_run");
    }
    grantRunSingleApproval(runId) {
        const ownerKey = this.getApprovalOwnerKey(runId);
        if (this.runApprovalScopes.get(ownerKey) === "allow_run")
            return;
        this.runSingleApprovalScopes.add(ownerKey);
    }
    registerAll(tools) {
        for (const tool of tools)
            this.register(tool);
    }
    unregister(name) {
        this.tools.delete(name);
    }
    getAll(options = {}) {
        const tools = [...this.tools.values()];
        return options.includeIsolated
            ? tools
            : tools.filter((tool) => isToolExtensionSelectable(tool.name));
    }
    get(name) {
        return this.tools.get(name);
    }
    async dispatchAgentScoped(input) {
        const agentId = input.ctx.agentId.trim();
        const bindingId = input.capabilityBindingId.trim();
        const auditId = input.ctx.auditId.trim();
        if (!agentId) {
            return {
                success: false,
                output: "에이전트 id가 없어 agent-scoped tool call을 실행하지 않았습니다.",
                error: "agent_context_required",
            };
        }
        if (!bindingId) {
            return {
                success: false,
                output: "capability binding id가 없어 agent-scoped tool call을 실행하지 않았습니다.",
                error: "capability_binding_id_required",
            };
        }
        if (!auditId) {
            return {
                success: false,
                output: "audit id가 없어 agent-scoped tool call을 실행하지 않았습니다.",
                error: "audit_id_required",
            };
        }
        return this.dispatch(input.toolName, input.params, {
            ...input.ctx,
            agentId,
            auditId,
            capabilityBindingId: bindingId,
            capabilityResultSharing: input.resultSharing,
        });
    }
    isToolAvailableForSource(tool, source) {
        return tool.availableSources == null || tool.availableSources.includes(source);
    }
    async dispatch(name, params, ctx) {
        if ((name === "web_search" || name === "web_fetch") && !ctx.allowWebAccess) {
            return {
                success: false,
                output: "웹 검색은 사용자가 명시적으로 요청했거나 최신/외부 정보 확인이 필요한 경우에만 허용됩니다.",
                error: "WEB_ACCESS_DISABLED_BY_POLICY",
            };
        }
        const tool = this.tools.get(name);
        if (!tool) {
            return {
                success: false,
                output: `Unknown tool: "${name}"`,
                error: `Tool "${name}" is not registered`,
            };
        }
        if (!this.isToolAvailableForSource(tool, ctx.source)) {
            return {
                success: false,
                output: `${name} 도구는 ${ctx.source} 채널에서는 사용할 수 없습니다.`,
                error: "TOOL_SOURCE_NOT_SUPPORTED",
            };
        }
        if (!isToolExtensionSelectable(name)) {
            return {
                success: false,
                output: `${name} 확장 기능은 반복 실패로 격리되어 현재 자동 선택과 실행에서 제외되었습니다. Doctor에서 extension.registry 상태를 확인하세요.`,
                error: "EXTENSION_ISOLATED",
                details: { kind: "extension_isolated", toolName: name },
            };
        }
        const requestGroupId = ctx.requestGroupId ?? getRootRun(ctx.runId)?.requestGroupId ?? ctx.runId;
        const webRetrievalPolicy = buildWebRetrievalPolicyDecision({
            toolName: name,
            params,
            userMessage: ctx.userMessage,
        });
        const idempotencyParams = webRetrievalPolicy?.canonicalParams ?? params;
        const allowRepeatReason = getAllowRepeatReason(params);
        const toolIdempotencyBase = buildToolCallIdempotencyKey({
            runId: ctx.runId,
            requestGroupId,
            toolName: name,
            params: idempotencyParams,
        });
        const executionLedgerKey = allowRepeatReason
            ? `${toolIdempotencyBase}:repeat:${Date.now()}`
            : toolIdempotencyBase;
        if (isDedupeTargetTool(name) && !allowRepeatReason) {
            const duplicate = findDuplicateToolCall({
                runId: ctx.runId,
                requestGroupId,
                toolName: name,
                params: idempotencyParams,
            });
            if (duplicate) {
                const result = {
                    success: true,
                    output: webRetrievalPolicy
                        ? `${name} 중복 호출을 생략했습니다. 같은 요청에서 동일한 웹 검색/수집 근거가 이미 실행됐습니다. dedupeKey=${webRetrievalPolicy.dedupeKey}`
                        : `${name} 중복 호출을 생략했습니다. 같은 요청에서 동일 파라미터로 이미 실행된 도구입니다.`,
                    details: {
                        kind: "duplicate_tool_suppressed",
                        previousEventId: duplicate.id,
                        previousStatus: duplicate.status,
                        ...(webRetrievalPolicy ? { webRetrievalPolicy } : {}),
                    },
                };
                recordMessageLedgerEvent({
                    runId: ctx.runId,
                    requestGroupId,
                    sessionKey: ctx.sessionId,
                    channel: ctx.source,
                    eventKind: "tool_skipped",
                    idempotencyKey: `${toolIdempotencyBase}:skipped:${Date.now()}`,
                    status: "skipped",
                    summary: `${name} duplicate suppressed`,
                    detail: {
                        toolName: name,
                        previousEventId: duplicate.id,
                        previousStatus: duplicate.status,
                        ...(webRetrievalPolicy ? { webRetrievalPolicy } : {}),
                    },
                });
                this.writeAudit(ctx, name, params, result, 0, false, "system:dedupe");
                return result;
            }
        }
        recordMessageLedgerEvent({
            runId: ctx.runId,
            requestGroupId,
            sessionKey: ctx.sessionId,
            channel: ctx.source,
            eventKind: "tool_started",
            idempotencyKey: `${executionLedgerKey}:started`,
            status: "started",
            summary: `${name} started`,
            detail: {
                toolName: name,
                ...(allowRepeatReason ? { allowRepeatReason } : {}),
                ...(webRetrievalPolicy ? { webRetrievalPolicy } : {}),
            },
        });
        eventBus.emit("tool.before", {
            sessionId: ctx.sessionId,
            runId: ctx.runId,
            requestGroupId,
            toolName: name,
            params,
        });
        const startMs = Date.now();
        let result;
        const capabilityDecision = evaluateAgentToolCapabilityPolicy({
            toolName: name,
            riskLevel: tool.riskLevel,
            ctx,
        });
        if (!capabilityDecision.allowed) {
            result = {
                success: false,
                output: capabilityDecision.userMessage ??
                    "에이전트 capability 정책에 따라 도구 실행을 시작하지 않았습니다.",
                error: capabilityDecision.reasonCode,
                details: {
                    kind: "tool_policy_denied",
                    reasonCode: capabilityDecision.reasonCode,
                    capabilityPolicy: capabilityDecision.diagnostic,
                },
            };
            recordMessageLedgerEvent({
                runId: ctx.runId,
                requestGroupId,
                sessionKey: ctx.sessionId,
                channel: ctx.source,
                eventKind: "tool_failed",
                idempotencyKey: `${executionLedgerKey}:capability-denied`,
                status: "failed",
                summary: `${name} capability denied`,
                detail: {
                    toolName: name,
                    reasonCode: capabilityDecision.reasonCode,
                    ...(capabilityDecision.agentId ? { agentId: capabilityDecision.agentId } : {}),
                    ...(capabilityDecision.bindingId ? { bindingId: capabilityDecision.bindingId } : {}),
                },
            });
            this.writeAudit(ctx, name, params, result, Date.now() - startMs, false, "policy:capability");
            return result;
        }
        const approvalRequired = this.shouldRequireApproval(tool, ctx);
        let approvedBy;
        let approvalGrant;
        if (approvalRequired) {
            approvalGrant = await this.requestApproval(name, params, ctx, tool.riskLevel);
            if (approvalGrant.decision === "deny") {
                result = {
                    success: false,
                    output: `Execution of "${name}" was denied. The current request was cancelled.`,
                    error: "denied",
                };
                recordMessageLedgerEvent({
                    runId: ctx.runId,
                    requestGroupId,
                    sessionKey: ctx.sessionId,
                    channel: ctx.source,
                    eventKind: "tool_failed",
                    idempotencyKey: `${executionLedgerKey}:result`,
                    status: "failed",
                    summary: `${name} denied`,
                    detail: { toolName: name, error: "denied" },
                });
                this.writeAudit(ctx, name, params, result, Date.now() - startMs, approvalRequired, "user:deny");
                return result;
            }
            approvedBy = approvalGrant.decision === "allow_run" ? "user:allow_run" : "user:allow_once";
        }
        const policyDecision = evaluateAndRecordToolPolicy({
            toolName: name,
            riskLevel: tool.riskLevel,
            params,
            ctx,
            ...(approvalGrant?.approvalId ? { approvalId: approvalGrant.approvalId } : {}),
            ...(approvalGrant?.decision && approvalGrant.decision !== "deny"
                ? { approvalDecision: approvalGrant.decision }
                : {}),
        });
        if (policyDecision.decision === "deny") {
            result = {
                success: false,
                output: sanitizePolicyDenialForUser(policyDecision),
                error: policyDecision.reasonCode,
                details: {
                    kind: "tool_policy_denied",
                    decisionId: policyDecision.id,
                    reasonCode: policyDecision.reasonCode,
                },
            };
            recordMessageLedgerEvent({
                runId: ctx.runId,
                requestGroupId,
                sessionKey: ctx.sessionId,
                channel: ctx.source,
                eventKind: "tool_failed",
                idempotencyKey: `${executionLedgerKey}:policy-denied`,
                status: "failed",
                summary: `${name} policy denied`,
                detail: {
                    toolName: name,
                    reasonCode: policyDecision.reasonCode,
                    decisionId: policyDecision.id,
                },
            });
            this.writeAudit(ctx, name, params, result, Date.now() - startMs, approvalRequired, approvedBy ?? "policy:deny");
            return result;
        }
        let rateLimitLease;
        try {
            rateLimitLease = acquireAgentCapabilityRateLimit({ decision: capabilityDecision });
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            result = {
                success: false,
                output: "에이전트 capability rate limit 때문에 도구 실행을 시작하지 않았습니다.",
                error: "agent_capability_rate_limited",
                details: {
                    kind: "tool_policy_denied",
                    reasonCode: "agent_capability_rate_limited",
                    message,
                },
            };
            recordMessageLedgerEvent({
                runId: ctx.runId,
                requestGroupId,
                sessionKey: ctx.sessionId,
                channel: ctx.source,
                eventKind: "tool_failed",
                idempotencyKey: `${executionLedgerKey}:rate-limit-denied`,
                status: "failed",
                summary: `${name} capability rate limited`,
                detail: { toolName: name, reasonCode: "agent_capability_rate_limited", message },
            });
            this.writeAudit(ctx, name, params, result, Date.now() - startMs, approvalRequired, approvedBy ?? "policy:rate_limit");
            return result;
        }
        try {
            result = await tool.execute(params, ctx);
            if (webRetrievalPolicy) {
                result = {
                    ...result,
                    details: {
                        ...(result.details &&
                            typeof result.details === "object" &&
                            !Array.isArray(result.details)
                            ? result.details
                            : { rawDetails: result.details ?? null }),
                        webRetrievalPolicy,
                    },
                };
            }
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            log.error(`Tool "${name}" threw an error: ${msg}`);
            result = { success: false, output: `Tool error: ${msg}`, error: msg };
        }
        finally {
            rateLimitLease?.release();
        }
        const durationMs = Date.now() - startMs;
        eventBus.emit("tool.after", {
            sessionId: ctx.sessionId,
            runId: ctx.runId,
            requestGroupId,
            toolName: name,
            success: result.success,
            durationMs,
        });
        this.writeAudit(ctx, name, params, result, durationMs, approvalRequired, approvedBy);
        recordMessageLedgerEvent({
            runId: ctx.runId,
            requestGroupId,
            sessionKey: ctx.sessionId,
            channel: ctx.source,
            eventKind: result.success ? "tool_done" : "tool_failed",
            idempotencyKey: `${executionLedgerKey}:result`,
            status: result.success ? "succeeded" : "failed",
            summary: result.success ? `${name} done` : `${name} failed`,
            detail: {
                toolName: name,
                durationMs,
                ...(result.error ? { error: result.error } : {}),
                ...(webRetrievalPolicy ? { webRetrievalPolicy } : {}),
            },
        });
        return result;
    }
    getInteractionGuidance(kind, toolName, params) {
        const action = describeApprovalAction(toolName, params);
        if (kind === "screen_confirmation") {
            return action
                ? `${action}\n대상 창이 열려 있고, 원하는 위치나 입력창이 준비되었는지 확인해 주세요. 준비가 끝나면 전체 진행 또는 이번 단계만 진행을 선택할 수 있습니다.`
                : "대상 창이 열려 있고, 원하는 위치나 입력창이 준비되었는지 확인해 주세요. 준비가 끝나면 전체 진행 또는 이번 단계만 진행을 선택할 수 있습니다.";
        }
        if (action) {
            return `${action}\n실행 내용을 확인한 뒤 승인하거나 취소해 주세요.`;
        }
        return "실행 내용을 확인한 뒤 승인하거나 취소해 주세요.";
    }
    shouldRequireApproval(tool, ctx) {
        const approvalMode = getConfig().security.approvalMode;
        if (approvalMode === "off")
            return false;
        const capabilityDecision = evaluateAgentToolCapabilityPolicy({
            toolName: tool.name,
            riskLevel: tool.riskLevel,
            ctx,
        });
        return (tool.requiresApproval ||
            APPROVAL_REQUIRED_TOOL_NAMES.has(tool.name) ||
            capabilityDecision.approvalRequired);
    }
    async requestApproval(toolName, params, ctx, riskLevel) {
        const ownerKey = this.getApprovalOwnerKey(ctx.runId);
        if (this.runApprovalScopes.get(ownerKey) === "allow_run") {
            recordMessageLedgerEvent({
                runId: ctx.runId,
                requestGroupId: ctx.requestGroupId ?? ownerKey,
                sessionKey: ctx.sessionId,
                channel: ctx.source,
                eventKind: "approval_received",
                idempotencyKey: `approval:${ctx.runId}:${toolName}:allow_run:scope`,
                status: "succeeded",
                summary: `${toolName} 기존 전체 승인 사용`,
            });
            return Promise.resolve({ decision: "allow_run" });
        }
        if (this.runSingleApprovalScopes.has(ownerKey)) {
            this.runSingleApprovalScopes.delete(ownerKey);
            recordMessageLedgerEvent({
                runId: ctx.runId,
                requestGroupId: ctx.requestGroupId ?? ownerKey,
                sessionKey: ctx.sessionId,
                channel: ctx.source,
                eventKind: "approval_received",
                idempotencyKey: `approval:${ctx.runId}:${toolName}:allow_once:scope`,
                status: "succeeded",
                summary: `${toolName} 기존 1회 승인 사용`,
            });
            return Promise.resolve({ decision: "allow_once" });
        }
        const kind = SCREEN_INTERACTION_TOOL_NAMES.has(toolName)
            ? "screen_confirmation"
            : "approval";
        const stepKey = kind === "screen_confirmation" ? "awaiting_user" : "awaiting_approval";
        const summary = kind === "screen_confirmation"
            ? `${toolName} 실행 전 화면 준비 확인을 기다립니다.`
            : `${toolName} 실행 승인을 기다립니다.`;
        const guidance = this.getInteractionGuidance(kind, toolName, params);
        const timeoutMs = kind === "screen_confirmation" ? null : 60_000;
        const expiresAt = timeoutMs === null ? null : Date.now() + timeoutMs;
        const approval = createApprovalRegistryRequest({
            runId: ctx.runId,
            requestGroupId: ctx.requestGroupId ?? ownerKey,
            channel: ctx.source,
            toolName,
            riskLevel,
            kind,
            params,
            expiresAt,
            metadata: {
                sessionId: ctx.sessionId,
                workDir: ctx.workDir,
                ...(ctx.agentId ? { agentId: ctx.agentId } : {}),
                ...(ctx.capabilityDelegationId
                    ? { capabilityDelegationId: ctx.capabilityDelegationId }
                    : {}),
                ...(ctx.secretScopeId ? { secretScopeId: ctx.secretScopeId } : {}),
                ...(ctx.auditId ? { auditId: ctx.auditId } : {}),
            },
        });
        log.info(`requesting ${kind} approvalId=${approval.id} runId=${ctx.runId} tool=${toolName}`);
        recordMessageLedgerEvent({
            runId: ctx.runId,
            requestGroupId: ctx.requestGroupId ?? ownerKey,
            sessionKey: ctx.sessionId,
            channel: ctx.source,
            eventKind: "approval_requested",
            idempotencyKey: `approval:${approval.id}:requested`,
            status: "pending",
            summary,
            detail: {
                approvalId: approval.id,
                toolName,
                kind,
                riskLevel,
                expiresAt,
                ...(ctx.agentId ? { agentId: ctx.agentId } : {}),
                ...(ctx.capabilityDelegationId
                    ? { capabilityDelegationId: ctx.capabilityDelegationId }
                    : {}),
            },
        });
        this.pendingInteractionKinds.set(ctx.runId, {
            approvalId: approval.id,
            toolName,
            kind,
            stepKey,
        });
        appendRunEvent(ctx.runId, kind === "screen_confirmation" ? `${toolName} 화면 준비 확인 요청` : `${toolName} 승인 요청`);
        setRunStepStatus(ctx.runId, stepKey, "running", summary);
        updateRunStatus(ctx.runId, stepKey, summary, true);
        rememberApprovalContinuity(ctx.runId, {
            pendingApprovals: [`${kind}:${toolName}:${approval.id}`],
            status: kind === "screen_confirmation" ? "awaiting_user" : "awaiting_approval",
            lastGoodState: summary,
        });
        return new Promise((resolve) => {
            let resolved = false;
            const timeout = kind === "screen_confirmation"
                ? null
                : setTimeout(() => {
                    if (!resolved) {
                        resolved = true;
                        log.warn(`Approval timeout for approvalId=${approval.id} tool="${toolName}"`);
                        expireApprovalRegistryRequest(approval.id);
                        this.finishApproval(ctx.runId, toolName, "deny", "timeout");
                        eventBus.emit("approval.resolved", {
                            approvalId: approval.id,
                            runId: ctx.runId,
                            decision: "deny",
                            toolName,
                            kind,
                            reason: "timeout",
                        });
                        resolve({ decision: "deny", approvalId: approval.id });
                    }
                }, timeoutMs ?? 60_000);
            ctx.signal.addEventListener("abort", () => {
                if (resolved)
                    return;
                resolved = true;
                if (timeout)
                    clearTimeout(timeout);
                resolveApprovalRegistryDecision({
                    approvalId: approval.id,
                    decision: "deny",
                    decisionBy: "system",
                    decisionSource: "abort",
                });
                this.pendingInteractionKinds.delete(ctx.runId);
                resolve({ decision: "deny", approvalId: approval.id });
            }, { once: true });
            eventBus.emit("approval.request", {
                approvalId: approval.id,
                runId: ctx.runId,
                ...(ctx.agentId ? { agentId: ctx.agentId } : {}),
                toolName,
                params,
                kind,
                ...(guidance ? { guidance } : {}),
                riskSummary: `${toolName}:${riskLevel}`,
                expiresAt,
                resolve: (decision, reason = "user") => {
                    if (!resolved) {
                        const decisionResult = resolveApprovalRegistryDecision({
                            approvalId: approval.id,
                            decision,
                            decisionBy: reason === "user" ? ctx.source : "system",
                            decisionSource: reason,
                        });
                        if (!decisionResult.accepted) {
                            log.warn(`Ignoring stale approval decision approvalId=${approval.id} status=${decisionResult.status}`);
                            return;
                        }
                        if (decision !== "deny") {
                            const consumed = consumeApprovalRegistryDecision(approval.id);
                            if (!consumed.accepted) {
                                log.warn(`Approved decision was not consumable approvalId=${approval.id} status=${consumed.status}`);
                                return;
                            }
                        }
                        resolved = true;
                        if (timeout)
                            clearTimeout(timeout);
                        this.finishApproval(ctx.runId, toolName, decision, reason);
                        resolve({ decision, approvalId: approval.id });
                    }
                },
            });
        });
    }
    resolvePendingInteraction(runId, decision) {
        const interaction = this.pendingInteractionKinds.get(runId);
        if (!interaction)
            return false;
        if (interaction.approvalId) {
            const decisionResult = resolveApprovalRegistryDecision({
                approvalId: interaction.approvalId,
                decision,
                decisionBy: "webui",
                decisionSource: "user",
            });
            if (!decisionResult.accepted)
                return false;
            if (decision !== "deny") {
                const consumed = consumeApprovalRegistryDecision(interaction.approvalId);
                if (!consumed.accepted)
                    return false;
            }
        }
        this.finishApproval(runId, interaction.toolName, decision);
        return true;
    }
    listPendingInteractions() {
        return [...this.pendingInteractionKinds.entries()].map(([runId, interaction]) => {
            const guidance = this.getInteractionGuidance(interaction.kind, interaction.toolName, {});
            if (guidance) {
                return {
                    runId,
                    ...(interaction.approvalId ? { approvalId: interaction.approvalId } : {}),
                    toolName: interaction.toolName,
                    kind: interaction.kind,
                    guidance,
                };
            }
            return {
                runId,
                ...(interaction.approvalId ? { approvalId: interaction.approvalId } : {}),
                toolName: interaction.toolName,
                kind: interaction.kind,
            };
        });
    }
    finishApproval(runId, toolName, decision, reason = "user") {
        const interaction = this.pendingInteractionKinds.get(runId);
        const kind = interaction?.kind ?? "approval";
        const stepKey = interaction?.stepKey ?? "awaiting_approval";
        const ownerKey = this.getApprovalOwnerKey(runId);
        this.pendingInteractionKinds.delete(runId);
        log.info(`finish approval runId=${runId} tool=${toolName} decision=${decision} kind=${kind}`);
        recordMessageLedgerEvent({
            runId,
            requestGroupId: ownerKey,
            eventKind: "approval_received",
            idempotencyKey: `approval:${runId}:${toolName}:${decision}:${reason}`,
            status: decision === "deny" ? "failed" : "succeeded",
            summary: `${toolName} approval ${decision}`,
            detail: { toolName, kind, decision, reason },
        });
        if (decision === "allow_run") {
            this.runApprovalScopes.set(ownerKey, "allow_run");
            const summary = kind === "screen_confirmation"
                ? `${toolName} 실행 전 준비 확인을 이 요청 전체에 대해 마쳤습니다.`
                : `${toolName} 실행을 이 요청 전체에 대해 허용했습니다.`;
            appendRunEvent(runId, kind === "screen_confirmation"
                ? `${toolName} 준비 확인 완료(전체)`
                : `${toolName} 전체 승인`);
            setRunStepStatus(runId, stepKey, "completed", summary);
            setRunStepStatus(runId, "executing", "running", `${toolName} 실행을 계속합니다.`);
            updateRunStatus(runId, "running", `${toolName} 실행을 계속합니다.`, true);
            rememberApprovalContinuity(runId, {
                pendingApprovals: [],
                status: "running",
                lastGoodState: summary,
            });
            return;
        }
        if (decision === "allow_once") {
            appendRunEvent(runId, kind === "screen_confirmation"
                ? `${toolName} 준비 확인 완료(이번 단계)`
                : `${toolName} 단계 승인`);
            setRunStepStatus(runId, stepKey, "completed", kind === "screen_confirmation"
                ? `${toolName} 실행 전 준비 확인을 이번 단계에 대해 마쳤습니다.`
                : `${toolName} 실행을 이번 단계에 대해 허용했습니다.`);
            setRunStepStatus(runId, "executing", "running", `${toolName} 실행을 계속합니다.`);
            updateRunStatus(runId, "running", `${toolName} 실행을 계속합니다.`, true);
            rememberApprovalContinuity(runId, {
                pendingApprovals: [],
                status: "running",
                lastGoodState: `${toolName} 승인 완료`,
            });
            return;
        }
        const denial = describeApprovalDenial(toolName, kind, reason);
        setRunStepStatus(runId, stepKey, "cancelled", denial.stepSummary);
        rememberApprovalContinuity(runId, {
            pendingApprovals: [],
            status: "cancelled",
            lastGoodState: denial.runSummary,
        });
        cancelRootRun(runId, denial);
    }
    writeAudit(ctx, toolName, params, result, durationMs, approvalRequired, approvedBy) {
        try {
            insertAuditLog({
                timestamp: Date.now(),
                session_id: ctx.sessionId,
                run_id: ctx.runId,
                request_group_id: ctx.requestGroupId ?? getRootRun(ctx.runId)?.requestGroupId ?? ctx.runId,
                channel: ctx.source,
                source: "agent",
                tool_name: toolName,
                params: JSON.stringify(params),
                output: result.output.length > 4000
                    ? `${result.output.slice(0, 4000)}\n…(truncated)`
                    : result.output,
                result: result.error === "denied" ? "denied" : result.success ? "success" : "failed",
                duration_ms: durationMs,
                approval_required: approvalRequired ? 1 : 0,
                approved_by: approvedBy ?? null,
                error_code: result.error ?? null,
                retry_count: 0,
                stop_reason: result.error === "denied" ? "user_denied" : null,
            });
        }
        catch {
            // best-effort
        }
    }
}
export const toolDispatcher = new ToolDispatcher();
export function grantRunApprovalScope(runId) {
    toolDispatcher.grantRunApprovalScope(runId);
}
export function grantRunSingleApproval(runId) {
    toolDispatcher.grantRunSingleApproval(runId);
}
export function resolvePendingInteraction(runId, decision) {
    return toolDispatcher.resolvePendingInteraction(runId, decision);
}
export function listPendingInteractions() {
    return toolDispatcher.listPendingInteractions();
}
function describeApprovalAction(toolName, params) {
    switch (toolName) {
        case "screen_capture":
            return "현재 화면 전체를 캡처하려고 합니다.";
        case "screen_find_text":
            return `현재 화면을 캡처하고 화면 안에서 텍스트를 찾으려고 합니다${typeof params.text === "string" && params.text.trim() ? `: ${params.text.trim()}` : "."}`;
        case "shell_exec":
            return typeof params.command === "string" && params.command.trim()
                ? `다음 명령을 실행하려고 합니다${typeof params.extensionId === "string" && params.extensionId.trim() ? `: ${params.extensionId.trim()}` : ""}: ${params.command.trim()}`
                : `명령을 실행하려고 합니다${typeof params.extensionId === "string" && params.extensionId.trim() ? `: ${params.extensionId.trim()}` : "."}`;
        case "app_launch":
            return typeof params.appName === "string" && params.appName.trim()
                ? `애플리케이션을 실행하려고 합니다${typeof params.extensionId === "string" && params.extensionId.trim() ? `: ${params.extensionId.trim()}` : ""}: ${params.appName.trim()}`
                : `애플리케이션을 실행하려고 합니다${typeof params.extensionId === "string" && params.extensionId.trim() ? `: ${params.extensionId.trim()}` : "."}`;
        case "process_kill":
            return "로컬 프로세스를 종료하려고 합니다.";
        case "yeonjang_camera_capture":
            return `연장을 통해 카메라 사진을 촬영하려고 합니다${typeof params.extensionId === "string" && params.extensionId.trim() ? `: ${params.extensionId.trim()}` : "."}`;
        case "mouse_move":
            return "마우스 포인터를 이동하려고 합니다.";
        case "mouse_click":
            return "마우스 클릭을 실행하려고 합니다.";
        case "mouse_action":
            return "마우스 액션을 자동으로 실행하려고 합니다.";
        case "keyboard_type":
            return "키보드 입력을 자동으로 실행하려고 합니다.";
        case "keyboard_shortcut":
            return "키보드 단축키를 자동으로 실행하려고 합니다.";
        case "keyboard_action":
            return "키보드 액션을 자동으로 실행하려고 합니다.";
        case "window_focus":
            return "특정 창으로 포커스를 이동하려고 합니다.";
        case "file_delete":
            return typeof params.path === "string" && params.path.trim()
                ? `파일을 삭제하려고 합니다: ${params.path.trim()}`
                : "파일을 삭제하려고 합니다.";
        default:
            return undefined;
    }
}
const FILE_APPROVAL_TOOL_NAMES = new Set([
    "file_read",
    "file_write",
    "file_list",
    "file_search",
    "file_patch",
    "file_delete",
]);
const APPROVAL_REQUIRED_TOOL_NAMES = new Set([
    ...FILE_APPROVAL_TOOL_NAMES,
    "app_launch",
    "shell_exec",
    "process_kill",
    "screen_capture",
    "screen_find_text",
    "yeonjang_camera_capture",
]);
const SCREEN_INTERACTION_TOOL_NAMES = new Set([
    "window_focus",
    "mouse_move",
    "mouse_click",
    "mouse_action",
    "keyboard_type",
    "keyboard_shortcut",
    "keyboard_action",
]);
//# sourceMappingURL=dispatcher.js.map