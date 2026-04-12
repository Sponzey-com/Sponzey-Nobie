const DIRECT_DELIVERY_PATTERNS = [
    /^(?:(?:메신저|메시지|텔레그램)(?:로)?\s*)?(?:"([^"\n]+)"|'([^'\n]+)'|“([^”\n]+)”|‘([^’\n]+)’|(.+?))\s*(?:이?라고)\s*(?:(?:메신저|메시지|텔레그램)(?:로)?\s*)?(?:말해줘|말해 줘|알려줘|알려 줘|보내줘|보내 줘|해줘|해 줘|해주세요|해 주세요)$/u,
    /^(?:"([^"\n]+)"|'([^'\n]+)'|“([^”\n]+)”|‘([^’\n]+)’|(.+?))\s*(?:이?라고)\s*(?:말해줘|말해 줘|알려줘|알려 줘|보내줘|보내 줘|해줘|해 줘|해주세요|해 주세요)$/u,
];
const PHRASE_REPLACEMENTS = [
    [/현재\s*활성화된/gu, "current active"],
    [/활성화된/gu, "active"],
    [/현재/gu, "current"],
    [/활성/gu, "active"],
    [/예약\s*알림/gu, "scheduled notification"],
    [/예약\s*실행/gu, "scheduled execution"],
    [/예약/gu, "schedule"],
    [/알림/gu, "notification"],
    [/스케줄/gu, "schedule"],
    [/목록|리스트/gu, "list"],
    [/모두|전부|전체|다/gu, "all"],
    [/취소|중지|멈춰|그만/gu, "cancel"],
    [/보여\s*줘|보여줘/gu, "show"],
    [/알려\s*줘|알려줘/gu, "tell"],
    [/보내\s*줘|보내줘/gu, "send"],
    [/메신저/gu, "messenger"],
    [/메시지/gu, "message"],
    [/텔레그램/gu, "telegram"],
    [/메인\s*화면/gu, "main screen"],
    [/전체\s*화면/gu, "full screen"],
    [/화면\s*캡처|스크린\s*캡처|스크린샷|캡쳐/gu, "screen capture"],
    [/카메라/gu, "camera"],
];
function normalizeWhitespace(text) {
    return text.trim().replace(/\s+/gu, " ");
}
function detectSourceLanguage(text) {
    const hangulCount = (text.match(/[가-힣]/gu) ?? []).length;
    const latinCount = (text.match(/[A-Za-z]/g) ?? []).length;
    if (hangulCount > 0 && latinCount > 0)
        return "mixed";
    if (hangulCount > 0)
        return "ko";
    if (latinCount > 0)
        return "en";
    return "unknown";
}
function translateRelativeDelaySyntax(text) {
    return text
        .replace(/(\d+)\s*초\s*(?:뒤|후)(?:에)?/gu, "in $1 seconds")
        .replace(/(\d+)\s*분\s*(?:뒤|후)(?:에)?/gu, "in $1 minutes")
        .replace(/(\d+)\s*시간\s*(?:뒤|후)(?:에)?/gu, "in $1 hours")
        .replace(/(\d+)\s*일\s*(?:뒤|후)(?:에)?/gu, "in $1 days")
        .replace(/매\s*(\d+)\s*초(?:마다)?/gu, "every $1 seconds")
        .replace(/매\s*(\d+)\s*분(?:마다)?/gu, "every $1 minutes")
        .replace(/매\s*(\d+)\s*시간(?:마다)?/gu, "every $1 hours")
        .replace(/매\s*(\d+)\s*일(?:마다)?/gu, "every $1 days");
}
function translateLiteralDeliveryRequest(text) {
    const normalized = normalizeWhitespace(text);
    if (!normalized)
        return null;
    for (const pattern of DIRECT_DELIVERY_PATTERNS) {
        const match = normalized.match(pattern);
        if (!match)
            continue;
        const literal = match.slice(1).find((value) => typeof value === "string" && value.trim().length > 0);
        if (!literal)
            continue;
        return `say "${literal.trim()}" via messenger`;
    }
    return null;
}
function translateKnownPhrases(text) {
    let normalized = text;
    for (const [pattern, replacement] of PHRASE_REPLACEMENTS) {
        normalized = normalized.replace(pattern, replacement);
    }
    return normalized;
}
// Normalize the latest user message into an English-first execution sentence before intake routing runs.
export function normalizeRequestForIntake(message) {
    const originalMessage = normalizeWhitespace(message);
    const sourceLanguage = detectSourceLanguage(originalMessage);
    if (!originalMessage) {
        return {
            sourceLanguage,
            originalMessage,
            normalizedEnglish: "",
        };
    }
    if (sourceLanguage === "en" || sourceLanguage === "unknown") {
        return {
            sourceLanguage,
            originalMessage,
            normalizedEnglish: originalMessage,
        };
    }
    const directDelivery = translateLiteralDeliveryRequest(originalMessage);
    if (directDelivery) {
        return {
            sourceLanguage,
            originalMessage,
            normalizedEnglish: directDelivery,
        };
    }
    const normalizedEnglish = normalizeWhitespace(translateKnownPhrases(translateRelativeDelaySyntax(originalMessage)));
    return {
        sourceLanguage,
        originalMessage,
        normalizedEnglish: normalizedEnglish || originalMessage,
    };
}
//# sourceMappingURL=request-normalizer.js.map