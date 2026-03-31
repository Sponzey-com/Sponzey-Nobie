# source.md

## 역할

- `api`는 Fastify와 WebSocket을 통해 백엔드를 WebUI와 로컬 클라이언트에 노출합니다.

## 주요 파일

- `server.ts`: 서버 부트스트랩, 정적 WebUI 서빙, 라우트 등록, scheduler/plugin 시작
- `routes/*`: setup, runs, tools, status, scheduler, MQTT 설정, update, plugin 엔드포인트
- `ws/stream.ts`: WebSocket 초기화와 실시간 run 업데이트
- `middleware/*`: 인증과 요청 보조 로직

## 메모

- 이 계층은 최대한 얇게 유지하는 것이 좋습니다.
- 주요 비즈니스 로직은 라우트가 아니라 `runs`, `agent`, `tools`, `mqtt`, `control-plane`에 있어야 합니다.
- 다만 WebSocket 승인 경로는 예외적으로 상태 전달의 단일 진실 원천 역할을 해야 하므로, 브라우저 클릭과 서버 타임아웃을 같은 `deny`로 뭉개지 않고 원인을 함께 전달해야 합니다.
