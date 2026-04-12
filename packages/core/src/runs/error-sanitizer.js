function normalizeRawError(message) {
    return (message ?? "").replace(/\r\n?/g, "\n").trim();
}
function firstSafeLine(message) {
    const firstLine = message.split(/\n+/)[0]?.trim() ?? message;
    const withoutStackLocation = firstLine.replace(/\s+at\s+\S+\([^)]*\).*$/i, "").trim();
    return withoutStackLocation.length > 220 ? `${withoutStackLocation.slice(0, 217)}...` : withoutStackLocation;
}
export function sanitizeUserFacingError(message) {
    const normalized = normalizeRawError(message);
    const lower = normalized.toLowerCase();
    if (!normalized) {
        return {
            kind: "unknown",
            userMessage: "알 수 없는 오류가 발생했습니다.",
            reason: "오류 세부 정보가 비어 있습니다.",
        };
    }
    if (/(<!doctype\s+html|<html\b|<head\b|<body\b|<meta\b|<title\b|<script\b)/i.test(normalized)) {
        if (/(\b403\b|forbidden|unauthorized|access denied|cloudflare|challenge|auth)/i.test(normalized)) {
            return {
                kind: "access_blocked",
                userMessage: "인증 또는 접근 차단 문제로 서버가 HTML 오류 페이지를 반환했습니다.",
                reason: "인증 또는 접근 차단 문제 때문에 모델 호출이 실패했습니다.",
            };
        }
        if (/(\b404\b|page not found|not found)/i.test(normalized)) {
            return {
                kind: "not_found",
                userMessage: "요청한 경로를 찾지 못해 서버가 HTML 오류 페이지를 반환했습니다.",
                reason: "요청한 모델 또는 API 경로를 찾지 못했습니다.",
            };
        }
        return {
            kind: "html_error",
            userMessage: "서버가 처리 가능한 API 응답 대신 HTML 오류 페이지를 반환했습니다.",
            reason: "서버가 API 응답이 아닌 HTML 오류 페이지를 반환했습니다.",
        };
    }
    if (/no available openai api keys/i.test(normalized)) {
        return {
            kind: "auth",
            userMessage: "현재 사용할 수 있는 API 키 또는 인증 자격이 없습니다.",
            reason: "인증 또는 접근 차단 문제 때문에 모델 호출이 실패했습니다.",
        };
    }
    if (/(\b403\b|forbidden|unauthorized|access denied|cloudflare|challenge|auth|api key|credential|\b401\b)/i.test(normalized)) {
        return {
            kind: "access_blocked",
            userMessage: "인증 또는 접근 차단 문제로 요청이 실패했습니다.",
            reason: "인증 또는 접근 차단 문제 때문에 모델 호출이 실패했습니다.",
        };
    }
    if (/(\b404\b|page not found|not found)/i.test(normalized)) {
        return {
            kind: "not_found",
            userMessage: "요청한 모델 또는 API 경로를 찾지 못했습니다.",
            reason: "요청한 모델 또는 API 경로를 찾지 못했습니다.",
        };
    }
    if (/(\b429\b|rate limit|too many requests)/i.test(normalized)) {
        return {
            kind: "rate_limit",
            userMessage: "요청 한도 또는 호출 빈도 제한 때문에 잠시 후 다시 시도해야 합니다.",
            reason: "모델 호출 빈도 제한 때문에 응답 생성이 중단되었습니다.",
        };
    }
    if (/(timeout|timed out|deadline exceeded|time-out|시간 초과)/i.test(normalized)) {
        return {
            kind: "timeout",
            userMessage: "응답 시간이 초과되었습니다.",
            reason: "모델 응답 생성 중 시간 초과가 발생했습니다.",
        };
    }
    if (/(context|token|maximum context|too long|length)/i.test(normalized)) {
        return {
            kind: "context_limit",
            userMessage: "입력 길이 또는 컨텍스트 크기 때문에 요청이 실패했습니다.",
            reason: "입력 길이 또는 컨텍스트 크기 때문에 모델 호출이 실패했습니다.",
        };
    }
    if (/(invalid|unsupported|schema|parameter|tool)/i.test(normalized)) {
        return {
            kind: "schema",
            userMessage: "요청 형식 또는 파라미터가 현재 실행 대상과 맞지 않습니다.",
            reason: "모델 또는 도구 호출 파라미터가 현재 실행 대상과 맞지 않아 실패했습니다.",
        };
    }
    if (/(network|socket|econn|connection|dns|getaddrinfo|reset|refused|fetch failed)/i.test(lower)) {
        return {
            kind: "network",
            userMessage: "네트워크 또는 연결 문제로 요청이 중단되었습니다.",
            reason: "네트워크 또는 연결 문제 때문에 모델 호출이 끊겼습니다.",
        };
    }
    return {
        kind: "unknown",
        userMessage: firstSafeLine(normalized),
        reason: "모델 호출이 실패해서 다른 방법 또는 다른 진행 경로 검토가 필요합니다.",
    };
}
//# sourceMappingURL=error-sanitizer.js.map