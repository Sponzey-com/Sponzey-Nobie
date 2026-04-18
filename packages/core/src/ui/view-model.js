import { uiMessage } from "./message-catalog.js";
import { redactUiValue } from "./redaction.js";
function statusLabel(status) {
    switch (status) {
        case "ready": return uiMessage("status.ready");
        case "needs_setup": return uiMessage("status.needs_setup");
        case "needs_attention": return uiMessage("status.needs_attention");
        case "warning": return uiMessage("status.warning");
        case "idle": return uiMessage("status.idle");
    }
}
function countStatuses(components) {
    return components.reduce((counts, component) => {
        counts[component.status] += 1;
        return counts;
    }, { ready: 0, needs_setup: 0, needs_attention: 0, warning: 0, idle: 0 });
}
function sanitizeDetails(value) {
    return redactUiValue(value, { audience: "advanced" }).value;
}
export function buildNormalizedUiState(input) {
    const components = [];
    const push = (component) => {
        components.push({
            ...component,
            statusLabel: statusLabel(component.status),
            lastCheckedAt: input.generatedAt,
            safeDetails: sanitizeDetails(component.safeDetails ?? component.configSummary),
            configSummary: sanitizeDetails(component.configSummary),
            warnings: component.warnings.map((warning) => redactUiValue(warning, { audience: "advanced" }).value),
        });
    };
    push({
        key: "setup",
        component: uiMessage("component.setup"),
        status: input.setupState.completed ? "ready" : "needs_setup",
        summary: input.setupState.completed ? uiMessage("setup.ready.summary") : uiMessage("setup.needs_setup.summary"),
        configSummary: { completed: input.setupState.completed },
        warnings: input.setupState.completed ? [] : [uiMessage("setup.needs_setup.warning")],
        actions: input.setupState.completed ? [] : [{ id: "open_setup", label: uiMessage("setup.open.action"), href: "/setup" }],
        needsAttention: !input.setupState.completed,
        metrics: {},
    });
    push({
        key: "ai",
        component: uiMessage("component.ai"),
        status: input.runtimeHealth.ai.configured ? "ready" : "needs_setup",
        summary: input.runtimeHealth.ai.configured ? uiMessage("ai.ready.summary") : uiMessage("ai.needs_setup.summary"),
        configSummary: {
            provider: input.runtimeHealth.ai.provider,
            modelConfigured: input.runtimeHealth.ai.modelConfigured,
        },
        warnings: input.runtimeHealth.ai.configured ? [] : [uiMessage("ai.needs_setup.warning")],
        actions: input.runtimeHealth.ai.configured ? [] : [{ id: "open_ai_settings", label: uiMessage("ai.open.action"), href: "/advanced/ai" }],
        needsAttention: !input.runtimeHealth.ai.configured,
        metrics: {},
    });
    const externalChannelEnabled = input.runtimeHealth.channels.telegramEnabled || input.runtimeHealth.channels.slackEnabled;
    push({
        key: "channels",
        component: uiMessage("component.channels"),
        status: externalChannelEnabled ? "ready" : "idle",
        summary: externalChannelEnabled ? uiMessage("channels.ready.summary") : uiMessage("channels.idle.summary"),
        configSummary: input.runtimeHealth.channels,
        warnings: externalChannelEnabled ? [] : [uiMessage("channels.idle.warning")],
        actions: [{ id: "open_channel_settings", label: uiMessage("channels.open.action"), href: "/advanced/channels" }],
        needsAttention: false,
        metrics: {
            externalEnabled: externalChannelEnabled ? 1 : 0,
        },
    });
    const yeonjangStatus = input.runtimeHealth.yeonjang.mqttEnabled
        ? input.runtimeHealth.yeonjang.connectedExtensions > 0 ? "ready" : "warning"
        : "idle";
    push({
        key: "yeonjang",
        component: uiMessage("component.yeonjang"),
        status: yeonjangStatus,
        summary: input.runtimeHealth.yeonjang.mqttEnabled
            ? uiMessage("yeonjang.connected.summary", "ko", { count: input.runtimeHealth.yeonjang.connectedExtensions })
            : uiMessage("yeonjang.disabled.summary"),
        configSummary: input.runtimeHealth.yeonjang,
        warnings: yeonjangStatus === "warning" ? [uiMessage("yeonjang.empty.warning")] : [],
        actions: [{ id: "open_extension_settings", label: uiMessage("yeonjang.open.action"), href: "/advanced/extensions" }],
        needsAttention: yeonjangStatus === "warning",
        metrics: {
            connectedExtensions: input.runtimeHealth.yeonjang.connectedExtensions,
        },
    });
    push({
        key: "tasks",
        component: uiMessage("component.tasks"),
        status: input.activeRuns.pendingApprovals > 0 ? "needs_attention" : input.activeRuns.total > 0 ? "warning" : "ready",
        summary: input.activeRuns.pendingApprovals > 0
            ? uiMessage("tasks.approval.summary", "ko", { count: input.activeRuns.pendingApprovals })
            : input.activeRuns.total > 0 ? uiMessage("tasks.running.summary", "ko", { count: input.activeRuns.total }) : uiMessage("tasks.ready.summary"),
        configSummary: input.activeRuns,
        warnings: input.activeRuns.pendingApprovals > 0 ? [uiMessage("tasks.approval.warning")] : [],
        actions: [{ id: "open_tasks", label: uiMessage("tasks.open.action"), href: "/tasks" }],
        needsAttention: input.activeRuns.pendingApprovals > 0,
        metrics: {
            activeRuns: input.activeRuns.total,
            pendingApprovals: input.activeRuns.pendingApprovals,
        },
    });
    return {
        generatedAt: input.generatedAt,
        mode: input.mode,
        components,
        statusCounts: countStatuses(components),
    };
}
export function buildBeginnerUiViewModel(normalized) {
    const attention = normalized.components.filter((component) => component.needsAttention);
    const primaryAction = attention.flatMap((component) => component.actions)[0] ?? null;
    return {
        kind: "beginner",
        summary: attention.length > 0 ? uiMessage("beginner.attention.summary", "ko", { count: attention.length }) : uiMessage("beginner.ready.summary"),
        statusLabel: attention.length > 0 ? uiMessage("beginner.attention.status") : uiMessage("beginner.ready.status"),
        primaryAction,
        needsAttention: attention.length > 0,
        safeDetails: normalized.components.map((component) => ({
            component: component.component,
            statusLabel: component.statusLabel,
            summary: component.summary,
        })),
    };
}
export function buildAdvancedUiViewModel(normalized) {
    return {
        kind: "advanced",
        components: normalized.components.map((component) => ({
            key: component.key,
            component: component.component,
            status: component.status,
            statusLabel: component.statusLabel,
            lastCheckedAt: component.lastCheckedAt,
            configSummary: component.configSummary,
            warnings: component.warnings,
            actions: component.actions,
        })),
    };
}
export function buildAdminUiViewModel(input, normalized) {
    return {
        kind: "admin",
        ids: {
            mode: input.mode.mode,
            preferredUiMode: input.mode.preferredUiMode,
            schemaVersion: input.mode.schemaVersion,
            adminEnabled: input.mode.adminEnabled,
        },
        timestamps: {
            generatedAt: input.generatedAt,
        },
        events: normalized.components.map((component) => ({
            component: component.component,
            status: component.status,
            needsAttention: component.needsAttention,
        })),
        metrics: {
            activeRuns: input.activeRuns.total,
            pendingApprovals: input.activeRuns.pendingApprovals,
            connectedExtensions: input.runtimeHealth.yeonjang.connectedExtensions,
        },
        relationships: [
            { from: "shell", to: "ai", relation: "summarizes" },
            { from: "shell", to: "channels", relation: "summarizes" },
            { from: "shell", to: "yeonjang", relation: "summarizes" },
            { from: "shell", to: "tasks", relation: "summarizes" },
        ],
        sanitizedRaw: redactUiValue(input, { audience: "admin" }).value,
    };
}
export function buildUiViewModels(input) {
    const normalized = buildNormalizedUiState(input);
    const beginner = buildBeginnerUiViewModel(normalized);
    const advanced = buildAdvancedUiViewModel(normalized);
    const admin = input.mode.adminEnabled ? buildAdminUiViewModel(input, normalized) : undefined;
    const current = input.mode.mode === "admin" && admin ? admin : input.mode.mode === "advanced" ? advanced : beginner;
    return {
        currentMode: input.mode.mode,
        current,
        beginner,
        advanced,
        ...(admin ? { admin } : {}),
    };
}
//# sourceMappingURL=view-model.js.map