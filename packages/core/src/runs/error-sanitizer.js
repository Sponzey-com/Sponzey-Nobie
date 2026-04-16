function normalizeRawError(message) {
    return (message ?? "").replace(/\r\n?/g, "\n").trim();
}
function firstSafeLine(message) {
    const firstLine = message.split(/\n+/)[0]?.trim() ?? message;
    const withoutStackLocation = firstLine.replace(/\s+at\s+\S+\([^)]*\).*$/i, "").trim();
    return withoutStackLocation.length > 220 ? `${withoutStackLocation.slice(0, 217)}...` : withoutStackLocation;
}
function hasStackTrace(message) {
    return /(^|\n)\s*at\s+[\w.$<>]+(?:\s|\()/i.test(message)
        || /(^|\n)\s*File "[^"]+", line \d+/i.test(message)
        || /traceback \(most recent call last\)/i.test(message)
        || /(^|\n)\s*(?:typeerror|referenceerror|syntaxerror|rangeerror|error):[^\n]+\n\s*at\s+/i.test(message)
        || /(^|\n)\s*(?:panic:|goroutine \d+ \[|thread '[^']+' panicked)/i.test(message);
}
function hasEncodingDamage(message) {
    return /�{1,}|����|���|\uFFFD/i.test(message);
}
function isDeliveryFailure(message) {
    return /(chunk delivery failed|telegram_send_file|telegram.*send|slack file|slack.*upload|slack.*interactive|sendfile|send file|sendfinalresponse|delivery failed|file delivery failed|file upload|응답 전달.*실패|파일 전달.*실패|메신저.*실패|전달 경로.*실패)/i.test(message);
}
function isToolFailure(message) {
    return /(screen_capture|shell_exec|keyboard_|mouse_|yeonjang_|tool[_ -]?failure|tool failed|failed:\s*[\w.-]+|os error|exited with code|exit code|command failed|command not found|not a directory|operation not permitted|permission denied)/i.test(message);
}
export function actionHintForSanitizedErrorKind(kind) {
    switch (kind) {
        case "auth":
            return "인증 정보와 사용 가능한 API 키 또는 OAuth 세션을 확인하세요.";
        case "access_blocked":
            return "권한, 차단 상태, 토큰 유효성, 대상 서비스 접근 권한을 확인하세요.";
        case "html_error":
            return "API endpoint와 인증 상태를 확인하고, 서버가 API JSON 대신 HTML을 반환한 원인을 확인하세요.";
        case "not_found":
            return "모델 이름, API 경로, 연결 주소가 현재 설정과 맞는지 확인하세요.";
        case "rate_limit":
            return "잠시 후 다시 시도하거나 호출 빈도와 provider 제한 상태를 확인하세요.";
        case "timeout":
            return "네트워크, 외부 도구, 대상 확장 연결 상태를 확인한 뒤 더 짧은 작업으로 재시도하세요.";
        case "context_limit":
            return "입력 크기를 줄이거나 작업을 더 작은 단계로 나누세요.";
        case "schema":
            return "도구 파라미터와 요청 형식이 현재 대상에서 지원되는지 확인하세요.";
        case "parse":
            return "도구 또는 모델 응답 형식이 예상 스키마와 맞는지 확인하세요.";
        case "network":
            return "네트워크 연결, DNS, endpoint, proxy 상태를 확인하세요.";
        case "encoding":
            return "사용자에게 깨진 원문을 노출하지 말고 audit 로그와 실행 환경 인코딩을 확인하세요.";
        case "tool_failure":
            return "도구 권한, 실행 경로, 대상 장치 또는 Yeonjang capability 상태를 확인하세요.";
        case "delivery_failure":
            return "요청이 들어온 채널의 파일/메시지 전송 권한과 전송 제한을 확인하세요.";
        case "channel_conflict":
            return "같은 봇이나 채널 polling 인스턴스가 둘 이상 실행 중인지 확인하고 하나만 유지하세요.";
        case "unknown":
            return "audit 로그의 원문 오류를 확인하고, 같은 경로를 반복하기 전에 다른 실행 경로를 검토하세요.";
    }
}
function withActionHint(summary) {
    return {
        ...summary,
        actionHint: summary.actionHint ?? actionHintForSanitizedErrorKind(summary.kind),
    };
}
function sanitizeUserFacingErrorCore(message) {
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
    if (/(telegram|getupdates|long polling|polling).*(\b409\b|conflict)|(\b409\b|conflict).*(telegram|getupdates|long polling|polling)/i.test(normalized)) {
        return {
            kind: "channel_conflict",
            userMessage: "텔레그램 봇 polling 충돌로 채널 수신이 중단되었습니다.",
            reason: "같은 텔레그램 봇을 사용하는 getUpdates 요청이 둘 이상 실행 중입니다.",
        };
    }
    if (/no available openai api keys/i.test(normalized)) {
        return {
            kind: "auth",
            userMessage: "현재 사용할 수 있는 API 키 또는 인증 자격이 없습니다.",
            reason: "인증 또는 접근 차단 문제 때문에 모델 호출이 실패했습니다.",
        };
    }
    if (/(chatgpt|codex|oauth).*(auth\.json|인증 파일|access token|refresh token|토큰 갱신|codex login|login)|(auth\.json|access token|refresh token|토큰 갱신|codex login|login).*(chatgpt|codex|oauth)/i.test(normalized)) {
        return {
            kind: "auth",
            userMessage: "ChatGPT OAuth 인증 정보가 없거나 갱신이 필요합니다.",
            reason: "ChatGPT OAuth 인증 파일 또는 토큰 상태 때문에 모델 호출이 실패했습니다.",
        };
    }
    if (/(\b429\b|rate limit|too many requests)/i.test(normalized)) {
        return {
            kind: "rate_limit",
            userMessage: "요청 한도 또는 호출 빈도 제한 때문에 잠시 후 다시 시도해야 합니다.",
            reason: "모델 호출 빈도 제한 때문에 응답 생성이 중단되었습니다.",
        };
    }
    if (/(unsupported|invalid|unknown|not found|does not exist).{0,40}\bmodel\b|\bmodel\b.{0,40}(unsupported|invalid|unknown|not found|does not exist)/i.test(normalized)) {
        return {
            kind: "not_found",
            userMessage: "현재 설정된 모델을 provider가 지원하지 않거나 찾을 수 없습니다.",
            reason: "설정된 모델 이름과 provider 실행 경로가 맞지 않아 모델 호출이 실패했습니다.",
        };
    }
    if (/(\b403\b|forbidden|unauthorized|access denied|cloudflare|challenge|auth|api key|credential|\b401\b)/i.test(normalized)) {
        return {
            kind: "access_blocked",
            userMessage: "인증 또는 접근 차단 문제로 요청이 실패했습니다.",
            reason: "인증 또는 접근 차단 문제 때문에 모델 호출이 실패했습니다.",
        };
    }
    if (hasEncodingDamage(normalized)) {
        return {
            kind: "encoding",
            userMessage: "오류 출력이 깨진 인코딩으로 반환되어 원문을 표시하지 않습니다.",
            reason: "도구 또는 실행 환경의 오류 출력이 깨진 인코딩으로 반환되었습니다.",
        };
    }
    if (/(selenium|web[_ -]?search|external search|browser search).*(timeout|timed out|deadline exceeded)|(timeout|timed out|deadline exceeded).*(selenium|web[_ -]?search|external search|browser search)/i.test(normalized)) {
        return {
            kind: "timeout",
            userMessage: "웹 검색 실행 시간이 초과되었습니다.",
            reason: "웹 검색 또는 브라우저 기반 검색 도구가 제한 시간 안에 응답하지 않았습니다.",
        };
    }
    if (/(screen[_ ]capture|camera capture|yeonjang_\w+|yeonjang|연장).*(timeout|timed out|시간 초과)|(timeout|timed out|시간 초과).*(screen[_ ]capture|camera capture|yeonjang_\w+|yeonjang|연장)/i.test(normalized)) {
        return {
            kind: "timeout",
            userMessage: "연장 도구 응답 시간이 초과되었습니다.",
            reason: "Yeonjang 또는 OS 도구가 제한 시간 안에 작업을 완료하지 못했습니다.",
        };
    }
    if (/(yeonjang|연장|extension).*(capability|unsupported|not available|missing|offline|not connected|mqtt|disconnect)|(mqtt|capability|unsupported|not available|missing|offline|not connected|disconnect).*(yeonjang|연장|extension)/i.test(normalized)) {
        return {
            kind: "tool_failure",
            userMessage: "연장 기능 또는 연결 상태 때문에 도구 실행이 실패했습니다.",
            reason: "Yeonjang capability 또는 연결 상태가 현재 요청을 처리할 수 없습니다.",
        };
    }
    if (isDeliveryFailure(normalized)) {
        return {
            kind: "delivery_failure",
            userMessage: "결과 전달 경로에서 오류가 발생했습니다.",
            reason: "요청 결과를 사용자 채널로 전달하는 과정에서 오류가 발생했습니다.",
        };
    }
    if (isToolFailure(normalized) && !/(\b404\b|page not found)/i.test(normalized)) {
        return {
            kind: "tool_failure",
            userMessage: "도구 또는 실행 경로에서 오류가 발생했습니다.",
            reason: "도구 또는 실행 경로 오류 때문에 작업이 실패했습니다.",
        };
    }
    if (/(\b404\b|page not found|not found)/i.test(normalized)) {
        return {
            kind: "not_found",
            userMessage: "요청한 모델 또는 API 경로를 찾지 못했습니다.",
            reason: "요청한 모델 또는 API 경로를 찾지 못했습니다.",
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
    if (hasEncodingDamage(normalized)) {
        return {
            kind: "encoding",
            userMessage: "오류 출력이 깨진 인코딩으로 반환되어 원문을 표시하지 않습니다.",
            reason: "도구 또는 실행 환경의 오류 출력이 깨진 인코딩으로 반환되었습니다.",
        };
    }
    if (hasStackTrace(normalized)) {
        return {
            kind: "tool_failure",
            userMessage: "도구 또는 실행 경로에서 오류가 발생했습니다.",
            reason: "도구 또는 실행 런타임 오류 때문에 작업이 실패했습니다.",
        };
    }
    if (/(json parse|parse error|unexpected token|invalid json|convertto-json|json\.parse)/i.test(normalized)) {
        return {
            kind: "parse",
            userMessage: "응답 형식 파싱 중 오류가 발생했습니다.",
            reason: "도구 또는 모델 응답 형식이 예상과 달라 파싱에 실패했습니다.",
        };
    }
    if (isToolFailure(normalized)) {
        return {
            kind: "tool_failure",
            userMessage: "도구 또는 실행 경로에서 오류가 발생했습니다.",
            reason: "도구 또는 실행 경로 오류 때문에 작업이 실패했습니다.",
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
export function sanitizeUserFacingError(message) {
    return withActionHint(sanitizeUserFacingErrorCore(message));
}
//# sourceMappingURL=error-sanitizer.js.map