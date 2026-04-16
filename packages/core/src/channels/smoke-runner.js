import { insertChannelSmokeRun, insertChannelSmokeStep, updateChannelSmokeRun, } from "../db/index.js";
const LOCAL_PATH_MARKDOWN_PATTERN = /!?\[[^\]]*\]\((?:\/Users\/|\/tmp\/|[A-Za-z]:\\)[^)]+\)|(?:\/Users\/|\/tmp\/|[A-Za-z]:\\)[^\s)]+/u;
const SENSITIVE_KEY_PATTERN = /token|secret|authorization|cookie|api[_-]?key|password|credential|chat[_-]?id|channel[_-]?id|group[_-]?id|user[_-]?id|target[_-]?id|allowed.*ids/i;
const SENSITIVE_TEXT_PATTERNS = [
    [/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer ***"],
    [/xox[abpr]-[A-Za-z0-9-]+/gi, "xox*-***"],
    [/\b\d{7,}\b/g, "***"],
    [/([A-Za-z0-9_-]{12,})\.([A-Za-z0-9_-]{12,})\.([A-Za-z0-9_-]{12,})/g, "***.***.***"],
];
export function getDefaultChannelSmokeScenarios() {
    return [
        buildScenario("webui", "basic_query", "기본 Web UI 질의", "오늘 상태를 한 줄로 알려줘"),
        buildScenario("webui", "approval_required_tool", "Web UI 승인 도구", "메인 화면 캡쳐해서 보여줘", {
            expectedTool: "screen_capture",
            expectsApproval: true,
            expectsArtifact: true,
        }),
        buildScenario("webui", "artifact_delivery", "Web UI artifact 전달", "메인 화면 캡쳐해서 다운로드 링크로 보여줘", {
            expectedTool: "screen_capture",
            expectsArtifact: true,
        }),
        buildScenario("webui", "failure_tool", "Web UI 실패 안내", "지원하지 않는 연장 기능을 실행해줘", {
            expectsFailure: true,
        }),
        buildScenario("telegram", "basic_query", "Telegram 기본 질의", "오늘 상태를 한 줄로 알려줘"),
        buildScenario("telegram", "approval_required_tool", "Telegram 승인 도구", "메인 화면 캡쳐해서 보여줘", {
            expectedTool: "screen_capture",
            expectsApproval: true,
            expectsArtifact: true,
        }),
        buildScenario("telegram", "artifact_delivery", "Telegram artifact 전달", "메인 화면 캡쳐해서 파일로 보내줘", {
            expectedTool: "screen_capture",
            expectsArtifact: true,
        }),
        buildScenario("telegram", "failure_tool", "Telegram 실패 안내", "지원하지 않는 연장 기능을 실행해줘", {
            expectsFailure: true,
        }),
        buildScenario("slack", "basic_query", "Slack 기본 질의", "오늘 상태를 한 줄로 알려줘"),
        buildScenario("slack", "approval_required_tool", "Slack 승인 도구", "메인 화면 캡쳐해서 보여줘", {
            expectedTool: "screen_capture",
            expectsApproval: true,
            expectsArtifact: true,
        }),
        buildScenario("slack", "artifact_delivery", "Slack artifact 전달", "메인 화면 캡쳐해서 파일로 보내줘", {
            expectedTool: "screen_capture",
            expectsArtifact: true,
        }),
        buildScenario("slack", "failure_tool", "Slack 실패 안내", "지원하지 않는 연장 기능을 실행해줘", {
            expectsFailure: true,
        }),
    ];
}
function buildScenario(channel, kind, title, request, overrides = {}) {
    return {
        id: `${channel}.${kind}`,
        channel,
        kind,
        title,
        request,
        expectedTarget: channel,
        correlationKey: defaultCorrelationKey(channel),
        requiresExternalCredential: channel !== "webui",
        ...overrides,
    };
}
function defaultCorrelationKey(channel) {
    switch (channel) {
        case "telegram":
            return "telegram_chat_thread";
        case "slack":
            return "slack_thread";
        case "webui":
        default:
            return "webui_run_id";
    }
}
export function resolveChannelSmokeReadiness(config, scenario) {
    switch (scenario.channel) {
        case "webui":
            return config.webui.enabled
                ? { ready: true }
                : { ready: false, skipReason: "webui_disabled" };
        case "telegram": {
            const telegram = config.telegram;
            if (!telegram?.enabled)
                return { ready: false, skipReason: "telegram_disabled" };
            if (!telegram.botToken.trim())
                return { ready: false, skipReason: "telegram_bot_token_missing" };
            if (telegram.allowedUserIds.length === 0 && telegram.allowedGroupIds.length === 0) {
                return { ready: false, skipReason: "telegram_target_id_missing" };
            }
            return { ready: true };
        }
        case "slack": {
            const slack = config.slack;
            if (!slack?.enabled)
                return { ready: false, skipReason: "slack_disabled" };
            if (!slack.botToken.trim())
                return { ready: false, skipReason: "slack_bot_token_missing" };
            if (!slack.appToken.trim())
                return { ready: false, skipReason: "slack_app_token_missing" };
            if (slack.allowedChannelIds.length === 0)
                return { ready: false, skipReason: "slack_channel_id_missing" };
            return { ready: true };
        }
    }
}
export function validateChannelSmokeTrace(scenario, trace) {
    if (trace.skipped) {
        return { status: "skipped", reason: trace.skipReason ?? "skipped", failures: [] };
    }
    const failures = [];
    if (trace.sourceChannel !== scenario.channel) {
        failures.push(`source_channel_mismatch:${trace.sourceChannel}`);
    }
    if (trace.responseChannel && trace.responseChannel !== scenario.expectedTarget) {
        failures.push(`response_channel_mismatch:${trace.responseChannel}`);
    }
    if (trace.correlationKey && trace.correlationKey !== scenario.correlationKey) {
        failures.push(`correlation_key_mismatch:${trace.correlationKey}`);
    }
    for (const toolCall of trace.toolCalls ?? []) {
        if (toolCall.sourceChannel !== scenario.channel) {
            failures.push(`tool_source_mismatch:${toolCall.toolName}:${toolCall.sourceChannel}`);
        }
        if (toolCall.deliveryChannel && toolCall.deliveryChannel !== scenario.expectedTarget) {
            failures.push(`tool_delivery_channel_mismatch:${toolCall.toolName}:${toolCall.deliveryChannel}`);
        }
        if (scenario.channel !== "telegram" && toolCall.toolName === "telegram_send_file") {
            failures.push("telegram_delivery_tool_used_outside_telegram");
        }
        if (scenario.channel !== "slack" && /^slack(?:_|\.)/i.test(toolCall.toolName)) {
            failures.push("slack_delivery_tool_used_outside_slack");
        }
        if (scenario.channel !== "webui" && /^webui(?:_|\.)/i.test(toolCall.toolName)) {
            failures.push("webui_delivery_tool_used_outside_webui");
        }
    }
    if (scenario.expectedTool && !(trace.toolCalls ?? []).some((toolCall) => toolCall.toolName === scenario.expectedTool)) {
        failures.push(`expected_tool_missing:${scenario.expectedTool}`);
    }
    if (scenario.expectsApproval) {
        if (!trace.approval?.requested) {
            failures.push("approval_request_missing");
        }
        else if (trace.approval.resolved === "timeout") {
            failures.push("approval_timeout");
        }
        else if (trace.approval.uiVisible === false || trace.approval.uiKind === "none") {
            failures.push("approval_ui_missing");
        }
        else if ((scenario.channel === "slack" || scenario.channel === "telegram") && trace.approval.uiKind && trace.approval.uiKind !== "button") {
            failures.push("approval_button_missing");
        }
        else if (trace.approval.targetChannel && trace.approval.targetChannel !== scenario.expectedTarget) {
            failures.push(`approval_target_mismatch:${trace.approval.targetChannel}`);
        }
        else if (trace.approval.correlationKey && trace.approval.correlationKey !== scenario.correlationKey) {
            failures.push(`approval_correlation_mismatch:${trace.approval.correlationKey}`);
        }
    }
    if (scenario.expectsArtifact)
        validateArtifactTrace(scenario, trace, failures);
    if (trace.finalText && LOCAL_PATH_MARKDOWN_PATTERN.test(trace.finalText)) {
        failures.push("local_path_exposed_in_final_text");
    }
    if (!trace.auditLogId)
        failures.push("audit_log_missing");
    if (failures.length > 0) {
        return { status: "failed", reason: failures[0] ?? "smoke_validation_failed", failures };
    }
    return { status: "passed", failures };
}
function validateArtifactTrace(scenario, trace, failures) {
    const artifacts = trace.artifacts ?? [];
    if (artifacts.length === 0) {
        failures.push("artifact_missing");
        return;
    }
    for (const artifact of artifacts) {
        if (artifact.channel !== scenario.expectedTarget) {
            failures.push(`artifact_channel_mismatch:${artifact.channel}`);
        }
        if (artifact.mode === "local_path_markdown") {
            failures.push("artifact_local_path_markdown");
        }
        if (scenario.channel === "webui" && artifact.mode !== "inline_preview" && artifact.mode !== "download_link") {
            failures.push(`webui_artifact_mode_invalid:${artifact.mode}`);
        }
        if ((scenario.channel === "telegram" || scenario.channel === "slack")
            && artifact.mode !== "native_file"
            && artifact.mode !== "download_link") {
            failures.push(`${scenario.channel}_artifact_mode_invalid:${artifact.mode}`);
        }
    }
}
export async function runChannelSmokeScenarios(options) {
    const scenarios = options.scenarios ?? getDefaultChannelSmokeScenarios();
    const results = [];
    for (const scenario of scenarios) {
        const startedAt = Date.now();
        const readiness = resolveChannelSmokeReadiness(options.config, scenario);
        if (!readiness.ready) {
            results.push({
                scenario,
                status: "skipped",
                failures: [],
                ...(readiness.skipReason ? { reason: readiness.skipReason } : {}),
                startedAt,
                finishedAt: Date.now(),
            });
            continue;
        }
        try {
            const trace = await options.executeScenario(scenario);
            const validation = validateChannelSmokeTrace(scenario, trace);
            results.push({
                scenario,
                status: validation.status,
                failures: validation.failures,
                ...(validation.reason ? { reason: validation.reason } : {}),
                ...(trace.auditLogId ? { auditLogId: trace.auditLogId } : {}),
                trace,
                startedAt,
                finishedAt: Date.now(),
            });
        }
        catch (error) {
            results.push({
                scenario,
                status: "failed",
                reason: error instanceof Error ? error.message : String(error),
                failures: ["scenario_execution_failed"],
                startedAt,
                finishedAt: Date.now(),
            });
        }
    }
    return results;
}
export function createDryRunChannelSmokeExecutor(input = {}) {
    return async (scenario) => {
        const baseTrace = {
            sourceChannel: scenario.channel,
            responseChannel: scenario.expectedTarget,
            correlationKey: scenario.correlationKey,
            auditLogId: `dry-audit-${scenario.id}`,
            toolCalls: scenario.expectedTool
                ? [{ toolName: scenario.expectedTool, sourceChannel: scenario.channel, deliveryChannel: scenario.expectedTarget }]
                : [],
            ...(scenario.expectsApproval
                ? {
                    approval: {
                        requested: true,
                        resolved: "approve_once",
                        targetChannel: scenario.expectedTarget,
                        correlationKey: scenario.correlationKey,
                        uiVisible: true,
                        uiKind: scenario.channel === "webui" ? "inline" : "button",
                    },
                }
                : {}),
            artifacts: scenario.expectsArtifact
                ? [scenario.channel === "webui"
                        ? {
                            channel: scenario.expectedTarget,
                            mode: "download_link",
                            url: "/api/artifacts/smoke/dry-run.png",
                        }
                        : {
                            channel: scenario.expectedTarget,
                            mode: "native_file",
                            filePath: "/tmp/nobie-smoke-dry-run.png",
                        }]
                : [],
            finalText: scenario.expectsFailure
                ? "지원하지 않는 기능이라 실행하지 않았습니다."
                : "dry-run smoke completed",
        };
        const override = input.traceOverrides?.[scenario.id] ?? {};
        return { ...baseTrace, ...override };
    };
}
export function sanitizeChannelSmokeValue(value) {
    if (Array.isArray(value))
        return value.map((item) => sanitizeChannelSmokeValue(item));
    if (value && typeof value === "object") {
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [
            key,
            SENSITIVE_KEY_PATTERN.test(key) ? "***" : sanitizeChannelSmokeValue(item),
        ]));
    }
    if (typeof value !== "string")
        return value;
    return SENSITIVE_TEXT_PATTERNS.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), value);
}
export function sanitizeChannelSmokeTrace(trace) {
    if (!trace)
        return undefined;
    return sanitizeChannelSmokeValue(trace);
}
function summarizeSmokeRun(results) {
    const counts = {
        total: results.length,
        passed: results.filter((result) => result.status === "passed").length,
        failed: results.filter((result) => result.status === "failed").length,
        skipped: results.filter((result) => result.status === "skipped").length,
    };
    const status = counts.failed > 0
        ? "failed"
        : counts.passed > 0
            ? "passed"
            : "skipped";
    return {
        status,
        summary: `channel smoke ${status}: passed=${counts.passed}, failed=${counts.failed}, skipped=${counts.skipped}`,
        counts,
    };
}
export async function runPersistedChannelSmokeScenarios(options) {
    const mode = options.mode ?? "dry-run";
    const scenarios = options.scenarios ?? getDefaultChannelSmokeScenarios();
    const startedAt = Date.now();
    const runId = insertChannelSmokeRun({
        mode,
        status: "running",
        startedAt,
        scenarioCount: scenarios.length,
        initiatedBy: options.initiatedBy ?? null,
        metadata: sanitizeChannelSmokeValue(options.metadata ?? {}),
    });
    const executeScenario = options.executeScenario ?? createDryRunChannelSmokeExecutor();
    const results = await runChannelSmokeScenarios({
        config: options.config,
        scenarios,
        executeScenario,
    });
    for (const result of results) {
        const sanitizedTrace = sanitizeChannelSmokeTrace(result.trace);
        insertChannelSmokeStep({
            runId,
            scenarioId: result.scenario.id,
            channel: result.scenario.channel,
            scenarioKind: result.scenario.kind,
            status: result.status,
            reason: result.reason ?? null,
            failures: result.failures,
            trace: sanitizedTrace ? sanitizedTrace : null,
            auditLogId: result.auditLogId ?? null,
            startedAt: result.startedAt ?? startedAt,
            finishedAt: result.finishedAt ?? Date.now(),
        });
    }
    const finishedAt = Date.now();
    const { status, summary, counts } = summarizeSmokeRun(results);
    updateChannelSmokeRun(runId, {
        status: status,
        finishedAt,
        scenarioCount: counts.total,
        passedCount: counts.passed,
        failedCount: counts.failed,
        skippedCount: counts.skipped,
        summary,
    });
    const sanitizedResults = results.map((result) => {
        const sanitizedTrace = sanitizeChannelSmokeTrace(result.trace);
        if (!sanitizedTrace) {
            const { trace: _trace, ...rest } = result;
            return rest;
        }
        return { ...result, trace: sanitizedTrace };
    });
    return { runId, mode, status, startedAt, finishedAt, summary, counts, results: sanitizedResults };
}
//# sourceMappingURL=smoke-runner.js.map