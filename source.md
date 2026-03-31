# source.md

## 역할

- 이 저장소는 `Sponzey Nobie` 전체 워크스페이스입니다.
- 런타임은 크게 네 영역으로 구성됩니다.
  - `packages/core`: 오케스트레이션 엔진, API 서버, 도구, 채널, 메모리, 스케줄링
  - `packages/webui`: 채팅, 설정, 실행 모니터, MQTT 상태를 보여주는 React WebUI
  - `packages/cli`: 로컬 CLI와 데몬 진입점
  - `Yeonjang`: MQTT를 통해 연결되는 권한 실행용 Rust 확장 런타임

## 주요 흐름

- 사용자 입력은 WebUI, CLI, Telegram, 스케줄 실행을 통해 들어옵니다.
- `core`가 요청을 해석하고, 적절한 도구나 실행 대상을 고른 뒤 실제 작업을 진행합니다.
- 장치 제어와 권한이 필요한 작업은 `Yeonjang`으로 보낼 수 있습니다.
- 결과, 상태, 감사 로그는 SQLite에 저장되고 WebUI에서 확인할 수 있습니다.

## 보조 영역

- `scripts`: 로컬 실행, 패키징, 개발 보조 스크립트
- `tests`: 오케스트레이션과 프롬프트 동작을 검증하는 Vitest 테스트
- 루트 규칙 문서는 `sys_prop.md`, `sys_prop.md.ko`, `AGENT.md`에 있습니다.