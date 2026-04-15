import { eventBus } from "../events/index.js";
import { insertAuditLog, upsertTaskContinuity } from "../db/index.js";
import { createLogger } from "../logger/index.js";
import { getConfig } from "../config/index.js";
import { appendRunEvent, cancelRootRun, getRootRun, hasActiveRequestGroupRuns, setRunStepStatus, updateRunStatus } from "../runs/store.js";
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
    getAll() {
        return [...this.tools.values()];
    }
    get(name) {
        return this.tools.get(name);
    }
    isToolAvailableForSource(tool, source) {
        return tool.availableSources == null || tool.availableSources.includes(source);
    }
    async dispatch(name, params, ctx) {
        if ((name === "web_search" || name === "web_fetch") && !ctx.allowWebAccess) {
            return {
                success: false,
                output: '웹 검색은 사용자가 명시적으로 요청했거나 최신/외부 정보 확인이 필요한 경우에만 허용됩니다.',
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
        eventBus.emit("tool.before", {
            sessionId: ctx.sessionId,
            runId: ctx.runId,
            toolName: name,
            params,
        });
        const startMs = Date.now();
        let result;
        const approvalRequired = this.shouldRequireApproval(tool);
        let approvedBy;
        if (approvalRequired) {
            const decision = await this.requestApproval(name, params, ctx);
            if (decision === "deny") {
                result = {
                    success: false,
                    output: `Execution of "${name}" was denied. The current request was cancelled.`,
                    error: "denied",
                };
                this.writeAudit(ctx, name, params, result, Date.now() - startMs, approvalRequired, "user:deny");
                return result;
            }
            approvedBy = decision === "allow_run" ? "user:allow_run" : "user:allow_once";
        }
        try {
            result = await tool.execute(params, ctx);
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            log.error(`Tool "${name}" threw an error: ${msg}`);
            result = { success: false, output: `Tool error: ${msg}`, error: msg };
        }
        const durationMs = Date.now() - startMs;
        eventBus.emit("tool.after", {
            sessionId: ctx.sessionId,
            runId: ctx.runId,
            toolName: name,
            success: result.success,
            durationMs,
        });
        this.writeAudit(ctx, name, params, result, durationMs, approvalRequired, approvedBy);
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
    shouldRequireApproval(tool) {
        const approvalMode = getConfig().security.approvalMode;
        if (approvalMode === "off")
            return false;
        return tool.requiresApproval || APPROVAL_REQUIRED_TOOL_NAMES.has(tool.name);
    }
    async requestApproval(toolName, params, ctx) {
        const ownerKey = this.getApprovalOwnerKey(ctx.runId);
        if (this.runApprovalScopes.get(ownerKey) === "allow_run") {
            return Promise.resolve("allow_run");
        }
        if (this.runSingleApprovalScopes.has(ownerKey)) {
            this.runSingleApprovalScopes.delete(ownerKey);
            return Promise.resolve("allow_once");
        }
        const kind = SCREEN_INTERACTION_TOOL_NAMES.has(toolName) ? "screen_confirmation" : "approval";
        const stepKey = kind === "screen_confirmation" ? "awaiting_user" : "awaiting_approval";
        const summary = kind === "screen_confirmation"
            ? `${toolName} 실행 전 화면 준비 확인을 기다립니다.`
            : `${toolName} 실행 승인을 기다립니다.`;
        const guidance = this.getInteractionGuidance(kind, toolName, params);
        log.info(`requesting ${kind} runId=${ctx.runId} tool=${toolName}`);
        this.pendingInteractionKinds.set(ctx.runId, { toolName, kind, stepKey });
        appendRunEvent(ctx.runId, kind === "screen_confirmation" ? `${toolName} 화면 준비 확인 요청` : `${toolName} 승인 요청`);
        setRunStepStatus(ctx.runId, stepKey, "running", summary);
        updateRunStatus(ctx.runId, stepKey, summary, true);
        rememberApprovalContinuity(ctx.runId, {
            pendingApprovals: [`${kind}:${toolName}`],
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
                        log.warn(`Approval timeout for tool "${toolName}" — denying by default`);
                        this.finishApproval(ctx.runId, toolName, "deny", "timeout");
                        eventBus.emit("approval.resolved", { runId: ctx.runId, decision: "deny", toolName, kind, reason: "timeout" });
                        resolve("deny");
                    }
                }, 60_000);
            ctx.signal.addEventListener("abort", () => {
                if (resolved)
                    return;
                resolved = true;
                if (timeout)
                    clearTimeout(timeout);
                this.pendingInteractionKinds.delete(ctx.runId);
                resolve("deny");
            }, { once: true });
            eventBus.emit("approval.request", {
                runId: ctx.runId,
                toolName,
                params,
                kind,
                ...(guidance ? { guidance } : {}),
                resolve: (decision, reason = "user") => {
                    if (!resolved) {
                        resolved = true;
                        if (timeout)
                            clearTimeout(timeout);
                        this.finishApproval(ctx.runId, toolName, decision, reason);
                        resolve(decision);
                    }
                },
            });
        });
    }
    resolvePendingInteraction(runId, decision) {
        const interaction = this.pendingInteractionKinds.get(runId);
        if (!interaction)
            return false;
        this.finishApproval(runId, interaction.toolName, decision);
        return true;
    }
    listPendingInteractions() {
        return [...this.pendingInteractionKinds.entries()].map(([runId, interaction]) => {
            const guidance = this.getInteractionGuidance(interaction.kind, interaction.toolName, {});
            if (guidance) {
                return {
                    runId,
                    toolName: interaction.toolName,
                    kind: interaction.kind,
                    guidance,
                };
            }
            return {
                runId,
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
        if (decision === "allow_run") {
            this.runApprovalScopes.set(ownerKey, "allow_run");
            const summary = kind === "screen_confirmation"
                ? `${toolName} 실행 전 준비 확인을 이 요청 전체에 대해 마쳤습니다.`
                : `${toolName} 실행을 이 요청 전체에 대해 허용했습니다.`;
            appendRunEvent(runId, kind === "screen_confirmation" ? `${toolName} 준비 확인 완료(전체)` : `${toolName} 전체 승인`);
            setRunStepStatus(runId, stepKey, "completed", summary);
            setRunStepStatus(runId, "executing", "running", `${toolName} 실행을 계속합니다.`);
            updateRunStatus(runId, "running", `${toolName} 실행을 계속합니다.`, true);
            rememberApprovalContinuity(runId, { pendingApprovals: [], status: "running", lastGoodState: summary });
            return;
        }
        if (decision === "allow_once") {
            appendRunEvent(runId, kind === "screen_confirmation" ? `${toolName} 준비 확인 완료(이번 단계)` : `${toolName} 단계 승인`);
            setRunStepStatus(runId, stepKey, "completed", kind === "screen_confirmation"
                ? `${toolName} 실행 전 준비 확인을 이번 단계에 대해 마쳤습니다.`
                : `${toolName} 실행을 이번 단계에 대해 허용했습니다.`);
            setRunStepStatus(runId, "executing", "running", `${toolName} 실행을 계속합니다.`);
            updateRunStatus(runId, "running", `${toolName} 실행을 계속합니다.`, true);
            rememberApprovalContinuity(runId, { pendingApprovals: [], status: "running", lastGoodState: `${toolName} 승인 완료` });
            return;
        }
        const denial = describeApprovalDenial(toolName, kind, reason);
        setRunStepStatus(runId, stepKey, "cancelled", denial.stepSummary);
        rememberApprovalContinuity(runId, { pendingApprovals: [], status: "cancelled", lastGoodState: denial.runSummary });
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
                output: result.output.length > 4000 ? result.output.slice(0, 4000) + "\n…(truncated)" : result.output,
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
