export type UiMode = "beginner" | "advanced" | "admin";
export type PreferredUiMode = "beginner" | "advanced";
export interface UiModeState {
    mode: UiMode;
    preferredUiMode: PreferredUiMode;
    availableModes: UiMode[];
    adminEnabled: boolean;
    canSwitchInUi: boolean;
    schemaVersion: 1;
}
export interface AdminUiActivationInput {
    env?: Record<string, string | undefined>;
    argv?: readonly string[];
    configEnabled?: boolean;
    nodeEnv?: string;
}
export interface AdminUiActivation {
    enabled: boolean;
    configEnabled: boolean;
    runtimeFlagEnabled: boolean;
    envEnabled: boolean;
    cliEnabled: boolean;
    localDevScriptEnabled: boolean;
    productionMode: boolean;
    reason: "disabled" | "enabled_by_runtime_flag" | "enabled_by_local_dev_script" | "enabled_by_config_and_runtime_flag" | "blocked_by_production_config_gate";
}
export interface UiModeRollbackActivationInput {
    env?: Record<string, string | undefined>;
}
export interface UiModeRollbackActivation {
    enabled: boolean;
    envEnabled: boolean;
    legacyAliasEnabled: boolean;
    reason: "disabled" | "enabled_by_ui_mode_rollback" | "enabled_by_legacy_ui_alias";
}
export declare function normalizePreferredUiMode(value: unknown): PreferredUiMode;
export declare function resolveUiModeRollbackActivation(input?: UiModeRollbackActivationInput): UiModeRollbackActivation;
export declare function isUiModeRollbackEnabled(): boolean;
export declare function resolveAdminUiActivation(input?: AdminUiActivationInput): AdminUiActivation;
export declare function isAdminUiEnabled(): boolean;
export declare function resolveUiMode(input?: {
    preferredUiMode?: unknown;
    requestedMode?: unknown;
    adminEnabled?: boolean;
}): UiModeState;
export declare function getUiModeState(): UiModeState;
export declare function savePreferredUiMode(mode: PreferredUiMode): UiModeState;
//# sourceMappingURL=mode.d.ts.map