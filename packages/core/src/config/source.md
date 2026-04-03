# source.md

## 역할

- `config`는 환경변수, 설정 파일, 인증 토큰, 경로 규칙을 로드합니다.

## 주요 파일

- `index.ts`: 설정 로딩, 캐시, 공개 accessor
- `types.ts`: 타입 기반 설정 구조
- `paths.ts`: 상태 디렉터리, DB, memory DB, 로그, artifact 경로
- `auth.ts`: 인증 토큰 생성과 저장 보조 로직

## 메모

- 패키지 수준 기본값 대부분이 여기서 결정됩니다.
- MQTT, WebUI, Telegram, 오케스트레이션, provider 설정이 모두 여기로 모입니다.
- `ai.defaultProvider`와 `ai.defaultModel`은 연결 선호값이지, 외부 AI backend를 자동 활성화하는 스위치는 아닙니다.
- 실제 backend 사용 가능 여부는 API key, OAuth 토큰, 명시적 backend 설정 같은 연결 정보로 판단합니다.
- 런타임과 문서는 `ai` 설정만 기준으로 사용합니다.
- 런타임은 legacy `llm` 키를 읽지 않고, 현재 `ai.providers/defaultProvider/defaultModel` 설정만 사용합니다.
