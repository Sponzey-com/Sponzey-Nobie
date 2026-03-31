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
