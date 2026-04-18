import type { UiMode, UiModeState } from "./mode.js";
export type UiComponentKey = "setup" | "ai" | "channels" | "yeonjang" | "tasks";
export type UiComponentStatus = "ready" | "needs_setup" | "needs_attention" | "warning" | "idle";
export interface UiShellDomainState {
    generatedAt: number;
    mode: UiModeState;
    setupState: {
        completed: boolean;
    };
    runtimeHealth: {
        ai: {
            configured: boolean;
            provider: string | null;
            modelConfigured: boolean;
        };
        channels: {
            webui: boolean;
            telegramConfigured: boolean;
            telegramEnabled: boolean;
            slackConfigured: boolean;
            slackEnabled: boolean;
        };
        yeonjang: {
            mqttEnabled: boolean;
            connectedExtensions: number;
        };
    };
    activeRuns: {
        total: number;
        pendingApprovals: number;
    };
}
export interface NormalizedUiComponent {
    key: UiComponentKey;
    component: string;
    status: UiComponentStatus;
    statusLabel: string;
    summary: string;
    lastCheckedAt: number;
    configSummary: Record<string, unknown>;
    warnings: string[];
    actions: Array<{
        id: string;
        label: string;
        href: string;
    }>;
    needsAttention: boolean;
    safeDetails: Record<string, unknown>;
    metrics: Record<string, number>;
}
export interface NormalizedUiState {
    generatedAt: number;
    mode: UiModeState;
    components: NormalizedUiComponent[];
    statusCounts: Record<UiComponentStatus, number>;
}
export interface BeginnerUiViewModel {
    kind: "beginner";
    summary: string;
    statusLabel: string;
    primaryAction: {
        id: string;
        label: string;
        href: string;
    } | null;
    needsAttention: boolean;
    safeDetails: Array<{
        component: string;
        statusLabel: string;
        summary: string;
    }>;
}
export interface AdvancedUiViewModel {
    kind: "advanced";
    components: Array<{
        key: UiComponentKey;
        component: string;
        status: UiComponentStatus;
        statusLabel: string;
        lastCheckedAt: number;
        configSummary: Record<string, unknown>;
        warnings: string[];
        actions: Array<{
            id: string;
            label: string;
            href: string;
        }>;
    }>;
}
export interface AdminUiViewModel {
    kind: "admin";
    ids: Record<string, string | number | boolean>;
    timestamps: Record<string, number>;
    events: Array<{
        component: string;
        status: UiComponentStatus;
        needsAttention: boolean;
    }>;
    metrics: Record<string, number>;
    relationships: Array<{
        from: string;
        to: string;
        relation: string;
    }>;
    sanitizedRaw: unknown;
}
export type UiModeViewModel = BeginnerUiViewModel | AdvancedUiViewModel | AdminUiViewModel;
export interface UiShellViewModels {
    currentMode: UiMode;
    current: UiModeViewModel;
    beginner: BeginnerUiViewModel;
    advanced: AdvancedUiViewModel;
    admin?: AdminUiViewModel;
}
export declare function buildNormalizedUiState(input: UiShellDomainState): NormalizedUiState;
export declare function buildBeginnerUiViewModel(normalized: NormalizedUiState): BeginnerUiViewModel;
export declare function buildAdvancedUiViewModel(normalized: NormalizedUiState): AdvancedUiViewModel;
export declare function buildAdminUiViewModel(input: UiShellDomainState, normalized: NormalizedUiState): AdminUiViewModel;
export declare function buildUiViewModels(input: UiShellDomainState): UiShellViewModels;
//# sourceMappingURL=view-model.d.ts.map