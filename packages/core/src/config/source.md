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
- MQTT, WebUI, Telegram, 오케스트레이션, 단일 AI 연결 설정이 모두 여기로 모입니다.
- 런타임이 읽는 AI 진실 원천은 `ai.connection` 하나입니다.
- 실제 backend 사용 가능 여부는 `ai.connection`의 provider/model/endpoint/auth 정보로 판단합니다.
- 런타임과 문서는 `ai` 설정만 기준으로 사용합니다.
- 런타임은 legacy `llm` 키를 읽지 않고, 구형 `ai.providers/defaultProvider/defaultModel`이 있더라도 로딩 시 `ai.connection` 하나로 정규화합니다.
- 구형 `ai.backends`/복수 backend 설정이 남아 있어도 로딩 시 활성 1개만 `ai.connection`으로 추출합니다. 나머지 backend는 런타임 후보로 복구/라우팅에 사용하지 않습니다.
