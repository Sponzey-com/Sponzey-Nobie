import { checkPromptSourceLocaleParity, dryRunPromptSourceAssembly, loadPromptSourceRegistry, } from "./nobie-md.js";
const EXPECTED_PROMPT_SOURCE_IDS = [
    "definitions",
    "identity",
    "user",
    "soul",
    "planner",
    "memory_policy",
    "tool_policy",
    "recovery_policy",
    "completion_policy",
    "output_policy",
    "channel",
    "bootstrap",
];
const RESPONSIBILITY_RULES = [
    {
        id: "identity_owns_name_and_voice",
        description: "이름, 표시명, 말투, 분위기 정의는 identity prompt에만 있어야 한다.",
        allowedSourceIds: ["identity"],
        markers: [
            {
                code: "name_definition_outside_identity",
                pattern: /(?:기본 이름|영문 이름|로컬 실행 확장 표시 이름|default name|english name|local execution extension display name)\s*:/iu,
                message: "Name/display-name definitions must stay in identity.",
            },
            {
                code: "voice_definition_outside_identity",
                pattern: /(?:기본 말투|분위기|피할 것|default voice|default style|mood|avoid)\s*:/iu,
                message: "Voice/mood definitions must stay in identity.",
            },
        ],
    },
    {
        id: "user_owns_user_profile",
        description: "사용자 이름, 호칭, 시간대, 선호 같은 사용자 최소 정보는 user prompt에만 있어야 한다.",
        allowedSourceIds: ["user"],
        markers: [
            {
                code: "user_profile_definition_outside_user",
                pattern: /(?:실명|계정명\/닉네임|선호 이름|기본 호칭|real name|account name|preferred name|default form of address|default address style)\s*:/iu,
                message: "User profile definitions must stay in user.",
            },
            {
                code: "timezone_definition_outside_user",
                pattern: /(?:기준 시간대|표시 시간대|reference timezone|display timezone)\s*:/iu,
                message: "User timezone defaults must stay in user.",
            },
        ],
    },
    {
        id: "soul_owns_long_term_principles",
        description: "장기 운영 원칙의 제목과 핵심 원칙 선언은 soul prompt에만 있어야 한다.",
        allowedSourceIds: ["soul"],
        markers: [
            {
                code: "soul_heading_outside_soul",
                pattern: /^(?:#\s+(?:소울 프롬프트|Soul Prompt)|##\s+(?:핵심 원칙|Core Principles|Core Priorities|Long-Term Consistency Rules))$/imu,
                message: "Long-term operating principle headings must stay in soul.",
            },
        ],
    },
];
const IMPACT_SCENARIOS = [
    {
        id: "impossible_requests_complete_with_reason",
        description: "물리적/논리적 불가능 요청은 임의 대체 없이 사유를 반환하고 완료해야 한다.",
        markers: [
            { id: "physical_or_logical", patterns: { ko: /물리적.*논리적|논리적.*물리적/u, en: /physically.*logically|logically.*physically/iu } },
            { id: "impossible", patterns: { ko: /불가능/u, en: /impossible/iu } },
            { id: "reason_without_substitution", patterns: { ko: /다른\s+대상으로\s+바꾸지|임의.*바꾸지|사유를\s+반환/u, en: /without changing the target|do not convert|return(?:s|ing)? the reason/iu } },
        ],
    },
    {
        id: "text_answer_does_not_trigger_artifact_recovery",
        description: "텍스트 답변으로 충족되는 요청은 artifact delivery/recovery 실패로 오판하지 않아야 한다.",
        markers: [
            { id: "text_answer", patterns: { ko: /텍스트\s+답변/u, en: /text-only answers?|text replies/iu } },
            { id: "artifact_recovery", patterns: { ko: /artifact\s+(?:delivery|recovery)|결과물\s+복구/u, en: /artifact\s+(?:delivery|recovery)/iu } },
            { id: "not_routed", patterns: { ko: /전환하지\s+않는다|보내지\s+않는다/u, en: /do not need|not route|must not route/iu } },
        ],
    },
    {
        id: "approval_stays_in_channel_thread",
        description: "승인은 원 요청 채널과 thread 경계 안에서 처리해야 한다.",
        markers: [
            { id: "approval", patterns: { ko: /승인/u, en: /approval/iu } },
            { id: "original_channel_thread", patterns: { ko: /원\s+요청\s+채널|원\s+요청\s+thread/u, en: /original request (?:channel|thread)|where the request arrived/iu } },
            { id: "pending_not_aborted", patterns: { ko: /Aborted by user.*단정하지/u, en: /(?:not.*Aborted by user|Aborted by user.*not)/iu } },
        ],
    },
    {
        id: "schedule_uses_contract",
        description: "예약/리마인더 요청은 ScheduleContract 생성 경로로 구조화해야 한다.",
        markers: [
            { id: "schedule_contract", patterns: { ko: /ScheduleContract/u, en: /ScheduleContract/u } },
            { id: "schedule_request", patterns: { ko: /예약|리마인더|반복 실행/u, en: /scheduling|reminder|recurring execution/iu } },
            { id: "literal_destination", patterns: { ko: /literal_text|destination/u, en: /literal_text|destination/u } },
        ],
    },
    {
        id: "raw_errors_are_sanitized",
        description: "provider raw 오류, HTML, stack trace, secret, token은 사용자에게 그대로 노출하면 안 된다.",
        markers: [
            { id: "raw_error", patterns: { ko: /raw\s+오류|HTML\s+오류|stack trace/u, en: /raw errors?|HTML error|stack trace/iu } },
            { id: "secret_token", patterns: { ko: /secret|token/u, en: /secret|token/iu } },
            { id: "do_not_expose", patterns: { ko: /노출하지\s+않는다/u, en: /do not expose/iu } },
        ],
    },
    {
        id: "local_extension_first_for_device_work",
        description: "화면/카메라/로컬 명령 같은 장치 작업은 로컬 실행 확장을 우선해야 한다.",
        markers: [
            { id: "local_extension", patterns: { ko: /로컬\s+실행\s+확장/u, en: /local execution extension/iu } },
            { id: "first_or_prefer", patterns: { ko: /우선|먼저/u, en: /prefer|first/iu } },
            { id: "device_work", patterns: { ko: /화면\s+캡처|카메라|로컬\s+명령/u, en: /screen capture|camera|local commands?/iu } },
        ],
    },
];
function makeIssue(input) {
    return {
        severity: input.severity,
        code: input.code,
        message: input.message,
        ...(input.sourceId ? { sourceId: input.sourceId } : {}),
        ...(input.locale ? { locale: input.locale } : {}),
        ...(input.evidence ? { evidence: input.evidence } : {}),
    };
}
function sourceKey(sourceId, locale) {
    return `${sourceId}:${locale}`;
}
function firstMatchingLine(content, pattern) {
    return content
        .split(/\n/u)
        .find((line) => pattern.test(line))?.trim() ?? "";
}
function validateRegistryCompleteness(sources, locales) {
    const existing = new Set(sources.map((source) => sourceKey(source.sourceId, source.locale)));
    const issues = [];
    for (const sourceId of EXPECTED_PROMPT_SOURCE_IDS) {
        for (const locale of locales) {
            if (existing.has(sourceKey(sourceId, locale)))
                continue;
            issues.push(makeIssue({
                severity: "error",
                code: "prompt_source_missing",
                sourceId,
                locale,
                message: `${sourceId}:${locale} prompt source is missing or unsafe.`,
            }));
        }
    }
    return issues;
}
function validateResponsibilities(sources) {
    return RESPONSIBILITY_RULES.map((rule) => {
        const issues = [];
        for (const source of sources) {
            if (rule.allowedSourceIds.includes(source.sourceId))
                continue;
            for (const marker of rule.markers) {
                if (!marker.pattern.test(source.content))
                    continue;
                issues.push(makeIssue({
                    severity: "error",
                    code: marker.code,
                    sourceId: source.sourceId,
                    locale: source.locale,
                    message: marker.message,
                    evidence: firstMatchingLine(source.content, marker.pattern),
                }));
            }
        }
        return {
            id: rule.id,
            description: rule.description,
            ok: issues.length === 0,
            allowedSourceIds: rule.allowedSourceIds,
            issues,
        };
    });
}
function validateImpactScenarios(workDir, locales) {
    const results = [];
    for (const locale of locales) {
        const assembly = dryRunPromptSourceAssembly(workDir, locale).assembly;
        const text = assembly?.text ?? "";
        for (const scenario of IMPACT_SCENARIOS) {
            const missingMarkers = scenario.markers
                .filter((marker) => !marker.patterns[locale].test(text))
                .map((marker) => marker.id);
            results.push({
                id: scenario.id,
                description: scenario.description,
                locale,
                ok: missingMarkers.length === 0,
                requiredMarkers: scenario.markers.map((marker) => marker.id),
                missingMarkers,
            });
        }
    }
    return results;
}
export function runPromptSourceRegression(workDir = process.cwd(), options = {}) {
    const locales = options.locales?.length ? options.locales : ["en"];
    const sources = loadPromptSourceRegistry(workDir);
    const localeParity = checkPromptSourceLocaleParity(workDir);
    const responsibility = validateResponsibilities(sources);
    const impact = validateImpactScenarios(workDir, locales);
    const issues = [
        ...validateRegistryCompleteness(sources, locales),
        ...localeParity.issues.map((issue) => makeIssue({
            severity: "error",
            code: `locale_${issue.code}`,
            sourceId: issue.sourceId,
            ...(issue.locale ? { locale: issue.locale } : {}),
            message: issue.message,
        })),
        ...responsibility.flatMap((result) => result.issues),
        ...impact.flatMap((scenario) => scenario.missingMarkers.map((marker) => makeIssue({
            severity: "error",
            code: "impact_marker_missing",
            locale: scenario.locale,
            message: `${scenario.id} is missing required marker '${marker}'.`,
            evidence: scenario.id,
        }))),
    ];
    return {
        ok: issues.every((issue) => issue.severity !== "error"),
        workDir,
        generatedAt: Date.now(),
        locales,
        registry: {
            sourceCount: sources.length,
            runtimeSourceCount: sources.filter((source) => source.usageScope === "runtime").length,
            checksums: sources.map((source) => ({
                sourceId: source.sourceId,
                locale: source.locale,
                checksum: source.checksum,
                version: source.version,
                path: source.path,
            })),
        },
        localeParity,
        responsibility,
        impact,
        issues,
    };
}
//# sourceMappingURL=prompt-regression.js.map
