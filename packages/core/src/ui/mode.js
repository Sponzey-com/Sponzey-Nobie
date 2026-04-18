import { existsSync, readFileSync, writeFileSync } from "node:fs";
import JSON5 from "json5";
import { getConfig, reloadConfig } from "../config/index.js";
import { PATHS } from "../config/paths.js";
function normalizeUiMode(value) {
    if (typeof value !== "string")
        return null;
    const normalized = value.trim().toLowerCase();
    if (normalized === "beginner" || normalized === "advanced" || normalized === "admin")
        return normalized;
    return null;
}
export function normalizePreferredUiMode(value) {
    const normalized = normalizeUiMode(value);
    return normalized === "advanced" ? "advanced" : "beginner";
}
function parseBooleanEnv(value) {
    if (value == null)
        return false;
    switch (value.trim().toLowerCase()) {
        case "1":
        case "true":
        case "yes":
        case "on":
            return true;
        default:
            return false;
    }
}
export function resolveUiModeRollbackActivation(input = {}) {
    const env = input.env ?? process.env;
    const envEnabled = parseBooleanEnv(env["NOBIE_UI_MODE_ROLLBACK"]);
    const legacyAliasEnabled = parseBooleanEnv(env["NOBIE_LEGACY_UI"]);
    return {
        enabled: envEnabled || legacyAliasEnabled,
        envEnabled,
        legacyAliasEnabled,
        reason: envEnabled
            ? "enabled_by_ui_mode_rollback"
            : legacyAliasEnabled
                ? "enabled_by_legacy_ui_alias"
                : "disabled",
    };
}
export function isUiModeRollbackEnabled() {
    return resolveUiModeRollbackActivation().enabled;
}
function hasAdminCliFlag(argv) {
    return argv.some((item) => item === "--admin-ui" || item === "--admin");
}
function isProductionMode(value) {
    return value?.trim().toLowerCase() === "production";
}
export function resolveAdminUiActivation(input = {}) {
    const env = input.env ?? process.env;
    const argv = input.argv ?? process.argv;
    const configEnabled = input.configEnabled ?? (getConfig().webui.admin?.enabled ?? false);
    const envEnabled = parseBooleanEnv(env["NOBIE_ADMIN_UI"]);
    const cliEnabled = hasAdminCliFlag(argv);
    const localDevScriptEnabled = parseBooleanEnv(env["NOBIE_LOCAL_DEV_ADMIN_UI"]) || (env["NOBIE_ADMIN_UI_SOURCE"] === "local-script" && envEnabled);
    const runtimeFlagEnabled = envEnabled || cliEnabled || localDevScriptEnabled;
    const productionMode = isProductionMode(input.nodeEnv ?? env["NODE_ENV"]);
    if (productionMode && runtimeFlagEnabled && !configEnabled) {
        return {
            enabled: false,
            configEnabled,
            runtimeFlagEnabled,
            envEnabled,
            cliEnabled,
            localDevScriptEnabled,
            productionMode,
            reason: "blocked_by_production_config_gate",
        };
    }
    const enabled = productionMode ? runtimeFlagEnabled && configEnabled : runtimeFlagEnabled;
    return {
        enabled,
        configEnabled,
        runtimeFlagEnabled,
        envEnabled,
        cliEnabled,
        localDevScriptEnabled,
        productionMode,
        reason: enabled
            ? productionMode
                ? "enabled_by_config_and_runtime_flag"
                : localDevScriptEnabled
                    ? "enabled_by_local_dev_script"
                    : "enabled_by_runtime_flag"
            : "disabled",
    };
}
export function isAdminUiEnabled() {
    return resolveAdminUiActivation().enabled;
}
export function resolveUiMode(input = {}) {
    const adminEnabled = input.adminEnabled ?? isAdminUiEnabled();
    const rollback = resolveUiModeRollbackActivation();
    if (rollback.enabled) {
        return {
            mode: "advanced",
            preferredUiMode: "advanced",
            availableModes: adminEnabled ? ["advanced", "admin"] : ["advanced"],
            adminEnabled,
            canSwitchInUi: false,
            schemaVersion: 1,
        };
    }
    const preferredUiMode = normalizePreferredUiMode(input.preferredUiMode ?? getConfig().webui.preferredUiMode);
    const requestedMode = normalizeUiMode(input.requestedMode);
    const mode = requestedMode === "admin"
        ? (adminEnabled ? "admin" : preferredUiMode)
        : requestedMode ?? preferredUiMode;
    return {
        mode,
        preferredUiMode,
        availableModes: adminEnabled ? ["beginner", "advanced", "admin"] : ["beginner", "advanced"],
        adminEnabled,
        canSwitchInUi: true,
        schemaVersion: 1,
    };
}
export function getUiModeState() {
    return resolveUiMode({ preferredUiMode: getConfig().webui.preferredUiMode });
}
function readRawConfig() {
    if (!existsSync(PATHS.configFile))
        return {};
    try {
        const parsed = JSON5.parse(readFileSync(PATHS.configFile, "utf-8"));
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    }
    catch {
        return {};
    }
}
export function savePreferredUiMode(mode) {
    if (isUiModeRollbackEnabled())
        return getUiModeState();
    const raw = readRawConfig();
    const webui = raw.webui && typeof raw.webui === "object" && !Array.isArray(raw.webui)
        ? raw.webui
        : {};
    raw.webui = {
        ...webui,
        preferredUiMode: mode,
    };
    writeFileSync(PATHS.configFile, JSON5.stringify(raw, null, 2), "utf-8");
    reloadConfig();
    return getUiModeState();
}
//# sourceMappingURL=mode.js.map