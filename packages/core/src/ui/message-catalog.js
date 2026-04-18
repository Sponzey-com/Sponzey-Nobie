import { sanitizeUserFacingError } from "../runs/error-sanitizer.js";
import { redactUiValue } from "./redaction.js";
export const UI_MESSAGE_CATALOG = {
    "status.ready": { ko: "사용 가능", en: "Ready" },
    "status.needs_setup": { ko: "설정 필요", en: "Setup needed" },
    "status.needs_attention": { ko: "확인 필요", en: "Needs attention" },
    "status.warning": { ko: "주의 필요", en: "Warning" },
    "status.idle": { ko: "대기 중", en: "Idle" },
    "component.setup": { ko: "초기 설정", en: "First setup" },
    "component.ai": { ko: "AI 연결", en: "AI connection" },
    "component.channels": { ko: "대화 채널", en: "Conversation channels" },
    "component.yeonjang": { ko: "연장", en: "Extension" },
    "component.tasks": { ko: "작업", en: "Work" },
    "setup.ready.summary": { ko: "기본 설정이 완료되었습니다.", en: "Basic setup is complete." },
    "setup.needs_setup.summary": { ko: "처음 설정을 완료해야 합니다.", en: "First setup must be completed." },
    "setup.needs_setup.warning": { ko: "초기 설정이 아직 끝나지 않았습니다.", en: "First setup is not complete yet." },
    "setup.open.action": { ko: "처음 설정 열기", en: "Open first setup" },
    "ai.ready.summary": { ko: "AI 호출 준비가 완료되었습니다.", en: "AI calls are ready." },
    "ai.needs_setup.summary": { ko: "AI 연결 정보를 설정해야 합니다.", en: "AI connection details must be configured." },
    "ai.needs_setup.warning": { ko: "AI 종류 또는 기본 모델이 비어 있습니다.", en: "The AI type or default model is empty." },
    "ai.open.action": { ko: "AI 연결 설정", en: "Configure AI connection" },
    "channels.ready.summary": { ko: "외부 대화 채널이 활성화되어 있습니다.", en: "External conversation channels are enabled." },
    "channels.idle.summary": { ko: "WebUI 채널만 활성 상태입니다.", en: "Only the WebUI channel is active." },
    "channels.idle.warning": { ko: "Telegram 또는 Slack 채널은 아직 활성화되지 않았습니다.", en: "Telegram or Slack is not enabled yet." },
    "channels.open.action": { ko: "채널 설정", en: "Configure channels" },
    "yeonjang.disabled.summary": { ko: "연장 연결 기능이 비활성화되어 있습니다.", en: "Extension connectivity is disabled." },
    "yeonjang.connected.summary": { ko: "{count}개 연장이 연결되어 있습니다.", en: "{count} extension(s) are connected." },
    "yeonjang.empty.warning": { ko: "연결 기능은 켜져 있지만 연결된 연장이 없습니다.", en: "Connectivity is enabled, but no extension is connected." },
    "yeonjang.open.action": { ko: "연장 상태 보기", en: "View extension status" },
    "tasks.ready.summary": { ko: "진행 중인 작업이 없습니다.", en: "No work is currently running." },
    "tasks.running.summary": { ko: "{count}개 작업이 진행 중입니다.", en: "{count} item(s) are running." },
    "tasks.approval.summary": { ko: "{count}개 승인 대기 작업이 있습니다.", en: "{count} item(s) are waiting for approval." },
    "tasks.approval.warning": { ko: "승인 또는 사용자 입력이 필요한 작업이 있습니다.", en: "Some work needs approval or user input." },
    "tasks.open.action": { ko: "작업 확인", en: "Review work" },
    "beginner.ready.summary": { ko: "Nobie를 사용할 준비가 되어 있습니다.", en: "Nobie is ready to use." },
    "beginner.attention.summary": { ko: "{count}개 항목 확인이 필요합니다.", en: "{count} item(s) need attention." },
    "beginner.ready.status": { ko: "정상", en: "Normal" },
    "beginner.attention.status": { ko: "확인 필요", en: "Needs attention" },
    "error.beginner.title": { ko: "문제가 발생했습니다", en: "Something needs attention" },
    "error.advanced.title": { ko: "진단 가능한 오류", en: "Diagnosable error" },
    "error.admin.title": { ko: "Admin diagnostic error", en: "Admin diagnostic error" },
    "error.repeated.title": { ko: "자세히 확인 필요", en: "Needs deeper inspection" },
    "error.repeated.action": { ko: "같은 문제가 반복되었습니다. 같은 경로를 반복하지 말고 진단 화면에서 원인과 다른 실행 경로를 확인하세요.", en: "The same problem repeated. Do not repeat the same path; inspect diagnostics and choose another execution path." },
};
const BEGINNER_FORBIDDEN_TERMS = [
    /\bphase\b/iu,
    /\btask\b/iu,
    /\bverdict\b/iu,
    /policy\s*version/iu,
    /checksum/iu,
    /requestGroupId/iu,
    /runId/iu,
    /sessionId/iu,
    /\braw\b/iu,
    /stack\s*trace/iu,
    /internal\s*id/iu,
    /내부\s*ID/iu,
];
const ADVANCED_FORBIDDEN_TERMS = [
    /<!doctype\s+html|<html\b|<body\b|<script\b/iu,
    /stack\s*trace/iu,
    /sk-[A-Za-z0-9_-]{12,}/u,
    /xox[baprs]-[A-Za-z0-9-]{12,}/u,
    /Bearer\s+[A-Za-z0-9._~+/=-]{12,}/iu,
];
function interpolate(template, params = {}) {
    return template.replace(/\{(\w+)\}/g, (_match, key) => String(params[key] ?? ""));
}
export function uiMessage(key, locale = "ko", params) {
    const entry = UI_MESSAGE_CATALOG[key];
    return interpolate(entry[locale] ?? entry.ko, params);
}
export function assertUiMessageCatalogCoverage() {
    for (const [key, entry] of Object.entries(UI_MESSAGE_CATALOG)) {
        if (!entry.ko?.trim())
            throw new Error(`missing ko message: ${key}`);
        if (!entry.en?.trim())
            throw new Error(`missing en message: ${key}`);
    }
}
export function findDisallowedUiTerms(mode, text) {
    const patterns = mode === "beginner" ? BEGINNER_FORBIDDEN_TERMS : mode === "advanced" ? ADVANCED_FORBIDDEN_TERMS : [];
    return patterns.filter((pattern) => pattern.test(text)).map((pattern) => pattern.source);
}
export function buildUiErrorPresentation(input) {
    const raw = input.rawError instanceof Error ? input.rawError.message : input.rawError;
    const sanitized = sanitizeUserFacingError(raw);
    const repeated = (input.repeatCount ?? 0) >= 2;
    const locale = input.locale ?? "ko";
    const diagnosticCode = `ERR_${sanitized.kind.toUpperCase()}`;
    const title = repeated
        ? uiMessage("error.repeated.title", locale)
        : input.mode === "admin"
            ? uiMessage("error.admin.title", locale)
            : input.mode === "advanced"
                ? uiMessage("error.advanced.title", locale)
                : uiMessage("error.beginner.title", locale);
    const nextAction = repeated ? uiMessage("error.repeated.action", locale) : sanitized.actionHint ?? "";
    return {
        mode: input.mode,
        title,
        summary: repeated ? sanitized.reason : sanitized.userMessage,
        nextAction,
        diagnosticCode,
        severity: repeated ? "needs_attention" : "error",
        repeated,
        ...(input.mode === "admin"
            ? {
                admin: {
                    kind: sanitized.kind,
                    reason: sanitized.reason,
                    sanitizedRaw: redactUiValue(raw ?? "", { audience: "admin" }).value,
                },
            }
            : {}),
    };
}
//# sourceMappingURL=message-catalog.js.map