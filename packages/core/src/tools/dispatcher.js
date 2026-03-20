import { eventBus } from "../events/index.js";
import { insertAuditLog } from "../db/index.js";
import { createLogger } from "../logger/index.js";
import { getConfig } from "../config/index.js";
import { appendRunEvent, cancelRootRun, getRootRun, hasActiveRequestGroupRuns, setRunStepStatus, updateRunStatus } from "../runs/store.js";
const log = createLogger("tools:dispatcher");
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
                    output: `Execution of "${name}" was denied by the user. The current request was cancelled.`,
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
    getInteractionGuidance(kind) {
        if (kind === "screen_confirmation") {
            return "대상 창이 열려 있고, 원하는 위치나 입력창이 준비되었는지 확인해 주세요. 준비가 끝나면 전체 진행 또는 이번 단계만 진행을 선택할 수 있습니다.";
        }
        return undefined;
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
        const guidance = this.getInteractionGuidance(kind);
        log.info(`requesting ${kind} runId=${ctx.runId} tool=${toolName}`);
        this.pendingInteractionKinds.set(ctx.runId, { toolName, kind, stepKey });
        appendRunEvent(ctx.runId, kind === "screen_confirmation" ? `${toolName} 화면 준비 확인 요청` : `${toolName} 승인 요청`);
        setRunStepStatus(ctx.runId, stepKey, "running", summary);
        updateRunStatus(ctx.runId, stepKey, summary, true);
        return new Promise((resolve) => {
            let resolved = false;
            const timeout = kind === "screen_confirmation"
                ? null
                : setTimeout(() => {
                    if (!resolved) {
                        resolved = true;
                        log.warn(`Approval timeout for tool "${toolName}" — denying by default`);
                        this.finishApproval(ctx.runId, toolName, "deny");
                        eventBus.emit("approval.resolved", { runId: ctx.runId, decision: "deny", toolName, kind });
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
                resolve: (decision) => {
                    if (!resolved) {
                        resolved = true;
                        if (timeout)
                            clearTimeout(timeout);
                        this.finishApproval(ctx.runId, toolName, decision);
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
            const guidance = this.getInteractionGuidance(interaction.kind);
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
    finishApproval(runId, toolName, decision) {
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
            return;
        }
        if (decision === "allow_once") {
            appendRunEvent(runId, kind === "screen_confirmation" ? `${toolName} 준비 확인 완료(이번 단계)` : `${toolName} 단계 승인`);
            setRunStepStatus(runId, stepKey, "completed", kind === "screen_confirmation"
                ? `${toolName} 실행 전 준비 확인을 이번 단계에 대해 마쳤습니다.`
                : `${toolName} 실행을 이번 단계에 대해 허용했습니다.`);
            setRunStepStatus(runId, "executing", "running", `${toolName} 실행을 계속합니다.`);
            updateRunStatus(runId, "running", `${toolName} 실행을 계속합니다.`, true);
            return;
        }
        appendRunEvent(runId, kind === "screen_confirmation" ? `${toolName} 준비 확인 거부` : `${toolName} 실행 거부`);
        setRunStepStatus(runId, stepKey, "cancelled", kind === "screen_confirmation"
            ? `${toolName} 실행 전 준비 확인이 완료되지 않아 요청을 취소했습니다.`
            : `${toolName} 실행이 거부되어 요청을 취소했습니다.`);
        cancelRootRun(runId);
    }
    writeAudit(ctx, toolName, params, result, durationMs, approvalRequired, approvedBy) {
        try {
            insertAuditLog({
                timestamp: Date.now(),
                session_id: ctx.sessionId,
                source: "agent",
                tool_name: toolName,
                params: JSON.stringify(params),
                output: result.output.length > 4000 ? result.output.slice(0, 4000) + "\n…(truncated)" : result.output,
                result: result.error === "denied" ? "denied" : result.success ? "success" : "failed",
                duration_ms: durationMs,
                approval_required: approvalRequired ? 1 : 0,
                approved_by: approvedBy ?? null,
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
]);
const SCREEN_INTERACTION_TOOL_NAMES = new Set([
    "window_focus",
    "mouse_move",
    "mouse_click",
    "keyboard_type",
    "keyboard_shortcut",
]);
//# sourceMappingURL=dispatcher.js.map