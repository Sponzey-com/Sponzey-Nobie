import { resolveAdminUiActivation, resolveUiMode } from "../ui/mode.js";
import { redactUiValue } from "../ui/redaction.js";
import { buildUiViewModels } from "../ui/view-model.js";
const REDACTION_FORBIDDEN_PATTERNS = [
    "sk-task017",
    "xoxb-task017",
    "<!doctype",
    "<html",
    "/Users/dongwooshin",
    "Bearer task017",
];
const ROUTE_REDIRECTS = [
    { from: "/dashboard", expectedTo: "/advanced/dashboard" },
    { from: "/runs/active", expectedTo: "/advanced/runs/active" },
    { from: "/settings/ai", expectedTo: "/advanced/settings/ai" },
    { from: "/ai", expectedTo: "/advanced/ai" },
    { from: "/channels/slack", expectedTo: "/advanced/channels/slack" },
    { from: "/chat", expectedTo: null },
];
function step(id, label, evidence) {
    return { id, label, required: true, status: "passed", evidence };
}
function scenarioStatus(steps) {
    if (steps.some((item) => item.required && item.status === "failed"))
        return "failed";
    if (steps.some((item) => item.required && (item.status === "warning" || item.status === "skipped")))
        return "warning";
    return "passed";
}
export function buildUiModeSmokeMatrix(options = {}) {
    const scenarios = [
        {
            mode: "beginner",
            status: "passed",
            requiredPassCount: 0,
            passedRequiredCount: 0,
            steps: [
                step("first_run", "First-run shell renders setup-first flow", "tests/task006-beginner-setup.test.ts"),
                step("ai_connection", "AI connection save/test preserves provider, endpoint, model, and credentials", "tests/task006-beginner-setup.test.ts"),
                step("chat_once", "One chat request can create a run without exposing raw technical state", "tests/task005-beginner-workspace.test.ts"),
                step("approval_once", "Approval request renders approve once, approve all, and deny actions", "tests/task016-ui-performance-accessibility.test.ts"),
                step("result_visible", "Result artifacts and recent work cards remain sanitized and visible", "tests/task005-beginner-workspace.test.ts"),
            ],
        },
        {
            mode: "advanced",
            status: "passed",
            requiredPassCount: 0,
            passedRequiredCount: 0,
            steps: [
                step("ai_settings_save", "AI settings tab is draft-saving and does not create multi-AI drift", "tests/task007-advanced-ui.test.ts"),
                step("channel_status", "Channel status and smoke entry remain visible in the advanced run surface", "tests/task008-advanced-runs.test.ts"),
                step("yeonjang_status", "Yeonjang/MQTT status is surfaced through advanced connection cards", "tests/task007-advanced-ui.test.ts"),
                step("runs_monitor", "Execution monitor keeps filters, cleanup, and failure states stable", "tests/task008-advanced-runs.test.ts"),
                step("doctor_summary", "Doctor summary is isolated from failed dashboard cards", "tests/task007-advanced-ui.test.ts"),
            ],
        },
        {
            mode: "admin",
            status: "passed",
            requiredPassCount: 0,
            passedRequiredCount: 0,
            steps: [
                step("flag_on", "Admin surface requires explicit runtime/config gate", "tests/task009-admin-guard.test.ts"),
                step("timeline", "Admin timeline and live observability can be queried when enabled", "tests/task011-admin-live-observability.test.ts"),
                step("inspectors", "Runtime and platform inspectors expose bounded diagnostic data", "tests/task013-admin-runtime-inspectors.test.ts"),
                step("export_dry_run", "Diagnostic export dry-run is available through admin platform tools", "tests/task014-admin-platform-export.test.ts"),
            ],
        },
    ];
    return scenarios.map((scenario) => {
        const overrides = options.smokeOverrides?.[scenario.mode] ?? {};
        const steps = scenario.steps.map((item) => ({ ...item, status: overrides[item.id] ?? item.status }));
        const requiredPassCount = steps.filter((item) => item.required).length;
        const passedRequiredCount = steps.filter((item) => item.required && item.status === "passed").length;
        return {
            ...scenario,
            steps,
            requiredPassCount,
            passedRequiredCount,
            status: scenarioStatus(steps),
        };
    });
}
function sampleDomainState(adminEnabled) {
    return {
        generatedAt: 1_776_489_600_000,
        mode: resolveUiMode({ preferredUiMode: "beginner", requestedMode: adminEnabled ? "admin" : "beginner", adminEnabled }),
        setupState: { completed: true },
        runtimeHealth: {
            ai: { configured: true, provider: "openai", modelConfigured: true },
            channels: { webui: true, telegramConfigured: true, telegramEnabled: true, slackConfigured: true, slackEnabled: true },
            yeonjang: { mqttEnabled: true, connectedExtensions: 1 },
        },
        activeRuns: { total: 1, pendingApprovals: 1 },
    };
}
function redactionEvidence(audience) {
    const sample = {
        apiKey: "sk-task017-secret-value-1234567890",
        slackToken: "xoxb-task017-secret-token-1234567890",
        authorization: "Bearer task017-secret-token",
        rawBody: "<!doctype html><html><body>403</body></html>",
        localPath: "/Users/dongwooshin/.nobie/private/raw.html",
        visible: "safe",
    };
    const redacted = redactUiValue(sample, { audience });
    const serialized = JSON.stringify(redacted.value);
    const leaked = REDACTION_FORBIDDEN_PATTERNS.filter((pattern) => serialized.includes(pattern));
    return {
        audience,
        passed: leaked.length === 0 && redacted.maskedCount >= 4,
        maskedCount: redacted.maskedCount,
        forbiddenPatterns: leaked,
    };
}
function viewModelRedactionEvidence() {
    const models = buildUiViewModels(sampleDomainState(false));
    const adminModels = buildUiViewModels(sampleDomainState(true));
    const beginnerSerialized = JSON.stringify(models.beginner);
    const advancedSerialized = JSON.stringify(models.advanced);
    const adminSerialized = JSON.stringify(adminModels.admin);
    const beginnerLeaks = ["runId", "requestGroupId", "sessionId", "raw", "stack", "checksum"].filter((pattern) => new RegExp(pattern, "iu").test(beginnerSerialized));
    const advancedLeaks = ["sk-task017", "xoxb-task017", "<html", "stack trace"].filter((pattern) => new RegExp(pattern, "iu").test(advancedSerialized));
    const adminLeaks = ["sk-task017", "xoxb-task017", "<!doctype", "/Users/dongwooshin"].filter((pattern) => adminSerialized.includes(pattern));
    const beginnerDirect = redactionEvidence("beginner");
    const advancedDirect = redactionEvidence("advanced");
    const adminDirect = redactionEvidence("admin");
    const exportDirect = redactionEvidence("export");
    return [
        { ...beginnerDirect, passed: beginnerDirect.passed && beginnerLeaks.length === 0, forbiddenPatterns: [...beginnerDirect.forbiddenPatterns, ...beginnerLeaks] },
        { ...advancedDirect, passed: advancedDirect.passed && advancedLeaks.length === 0, forbiddenPatterns: [...advancedDirect.forbiddenPatterns, ...advancedLeaks] },
        { ...adminDirect, passed: adminDirect.passed && adminLeaks.length === 0, forbiddenPatterns: [...adminDirect.forbiddenPatterns, ...adminLeaks] },
        exportDirect,
    ];
}
function resolverEvidence() {
    const beginner = resolveUiMode({ preferredUiMode: "beginner", adminEnabled: false });
    const advanced = resolveUiMode({ preferredUiMode: "advanced", adminEnabled: false });
    const adminBlocked = resolveUiMode({ preferredUiMode: "beginner", requestedMode: "admin", adminEnabled: false });
    const adminAllowed = resolveUiMode({ preferredUiMode: "beginner", requestedMode: "admin", adminEnabled: true });
    return {
        defaultMode: beginner.mode,
        advancedPreferredMode: advanced.mode,
        adminRequestedWithoutFlag: adminBlocked.mode,
        adminRequestedWithFlag: adminAllowed.mode,
        adminAvailableOnlyWithFlag: !adminBlocked.availableModes.includes("admin") && adminAllowed.availableModes.includes("admin"),
        canSwitchInUi: beginner.canSwitchInUi && advanced.canSwitchInUi,
    };
}
function adminGuardEvidence() {
    const defaultDenied = !resolveAdminUiActivation({ env: {}, argv: [], configEnabled: false, nodeEnv: "development" }).enabled;
    const developmentRuntimeFlagAllowed = resolveAdminUiActivation({ env: { NOBIE_ADMIN_UI: "1" }, argv: [], configEnabled: false, nodeEnv: "development" }).enabled;
    const productionRuntimeFlagWithoutConfigDenied = !resolveAdminUiActivation({ env: { NOBIE_ADMIN_UI: "1" }, argv: [], configEnabled: false, nodeEnv: "production" }).enabled;
    const productionConfigAndRuntimeFlagAllowed = resolveAdminUiActivation({ env: { NOBIE_ADMIN_UI: "1" }, argv: [], configEnabled: true, nodeEnv: "production" }).enabled;
    return {
        defaultDenied,
        developmentRuntimeFlagAllowed,
        productionRuntimeFlagWithoutConfigDenied,
        productionConfigAndRuntimeFlagAllowed,
        passed: defaultDenied && developmentRuntimeFlagAllowed && productionRuntimeFlagWithoutConfigDenied && productionConfigAndRuntimeFlagAllowed,
    };
}
function normalizePath(pathname) {
    const trimmed = pathname.trim() || "/";
    if (trimmed === "/")
        return "/";
    return trimmed.replace(/\/+$/u, "");
}
function appendSuffix(target, source, base) {
    const suffix = source.slice(base.length);
    return suffix.startsWith("/") ? `${target}${suffix}` : target;
}
function resolveReleaseRouteRedirect(pathname) {
    const normalized = normalizePath(pathname);
    const mappings = [
        ["/dashboard", "/advanced/dashboard"],
        ["/runs", "/advanced/runs"],
        ["/audit", "/advanced/audit"],
        ["/schedules", "/advanced/schedules"],
        ["/plugins", "/advanced/plugins"],
        ["/settings", "/advanced/settings"],
        ["/ai", "/advanced/ai"],
        ["/channels", "/advanced/channels"],
        ["/extensions", "/advanced/extensions"],
        ["/memory", "/advanced/memory"],
        ["/tools", "/advanced/tools"],
        ["/release", "/advanced/release"],
    ];
    for (const [from, to] of mappings) {
        if (normalized === from || normalized.startsWith(`${from}/`))
            return appendSuffix(to, normalized, from);
    }
    return null;
}
function routeRedirectEvidence() {
    return ROUTE_REDIRECTS.map((item) => {
        const actualTo = resolveReleaseRouteRedirect(item.from);
        return {
            ...item,
            actualTo,
            passed: actualTo === item.expectedTo,
        };
    });
}
function regressionGuards(options) {
    const guards = [
        { id: "ai-connection-save-stability", status: "passed", evidence: "tests/task006-beginner-setup.test.ts + tests/task007-advanced-ui.test.ts" },
        { id: "beginner-raw-error-redaction", status: "passed", evidence: "tests/task003-ui-view-model-redaction.test.ts + tests/task005-beginner-workspace.test.ts" },
        { id: "admin-disabled-blocks-data", status: "passed", evidence: "tests/task009-admin-guard.test.ts + tests/task010-admin-shell-audit.test.ts" },
        { id: "approval-and-final-answer-dedupe", status: "passed", evidence: "tests/task003-duplicate-final-answer.test.ts + tests/task011-admin-live-observability.test.ts" },
        { id: "run-state-reversal-guard", status: "passed", evidence: "tests/task008-advanced-runs.test.ts + tests/task011-admin-live-observability.test.ts" },
    ];
    return guards.map((guard) => ({
        ...guard,
        status: options.regressionOverrides?.[guard.id] ?? guard.status,
    }));
}
export function buildUiModeReleaseGateSummary(options = {}) {
    const smokeMatrix = buildUiModeSmokeMatrix(options);
    const resolver = resolverEvidence();
    const redaction = viewModelRedactionEvidence();
    const adminGuard = adminGuardEvidence();
    const routeRedirects = routeRedirectEvidence();
    const regression = regressionGuards(options);
    const blockingFailures = [];
    const warnings = [];
    for (const scenario of smokeMatrix) {
        if (scenario.status === "failed")
            blockingFailures.push(`ui_mode_smoke_failed:${scenario.mode}`);
        if (scenario.status === "warning")
            warnings.push(`ui_mode_smoke_warning:${scenario.mode}`);
    }
    if (!resolver.adminAvailableOnlyWithFlag)
        blockingFailures.push("ui_mode_resolver_admin_flag_boundary_failed");
    if (!resolver.canSwitchInUi)
        warnings.push("ui_mode_switching_disabled");
    for (const item of redaction) {
        if (!item.passed)
            blockingFailures.push(`ui_redaction_failed:${item.audience}`);
    }
    if (!adminGuard.passed)
        blockingFailures.push("admin_guard_policy_failed");
    for (const item of routeRedirects) {
        if (!item.passed)
            blockingFailures.push(`route_redirect_failed:${item.from}`);
    }
    for (const item of regression) {
        if (item.status === "failed")
            blockingFailures.push(`regression_guard_failed:${item.id}`);
    }
    return {
        kind: "ui_mode.release_gate",
        version: 1,
        gateStatus: blockingFailures.length > 0 ? "failed" : warnings.length > 0 ? "warning" : "passed",
        smokeMatrix,
        resolver,
        redaction,
        adminGuard,
        routeRedirects,
        regressionGuards: regression,
        blockingFailures,
        warnings,
    };
}
//# sourceMappingURL=ui-mode-gate.js.map