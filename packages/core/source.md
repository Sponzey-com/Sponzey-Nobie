# source.md

## 역할

- `@nobie/core`는 메인 백엔드 패키지입니다.
- 설정, 부트스트랩, 영속 저장, 에이전트 오케스트레이션, 도구 실행, 채널 연동, 스케줄링, MQTT 브로커, WebUI API 제공을 담당합니다.

## 핵심 진입점

- `src/index.ts`: 외부 공개 API와 부트스트랩 헬퍼
- `src/api/server.ts`: Fastify 서버와 라우트 등록
- `src/runs/start.ts`: 루트 실행 생명주기와 오케스트레이션 루프
- `src/agent/index.ts`: LLM 대화 루프와 도구 사용

## 주요 책임

- 요청을 어떤 방식으로 실행할지 결정합니다.
- run, session, request-group 상태를 일관되게 유지합니다.
- 권한 작업이나 장치 작업은 가능하면 Yeonjang으로 라우팅합니다.
- 메시지, 실행, 감사 로그, 스케줄, 메모리 항목을 저장합니다.