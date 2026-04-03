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
- `routes/runs.ts`는 이제 raw `run` 목록뿐 아니라 `runs/task-model.ts` projection을 이용한 `/api/tasks`도 내보낼 수 있습니다. 즉 상태 모니터는 필요하면 `requestGroup` 묶음 대신 `Task / Attempt / Recovery / Delivery` 모델을 직접 조회할 수 있는 방향입니다.
- `/api/tasks`의 task projection은 이제 free-form recent event label만 넘기지 않고, `activities`의 표준 kind(`attempt.*`, `recovery.*`, `delivery.*`), `monitor` 관측 포인트(`activeAttemptCount`, `duplicateExecutionRisk`, `deliveryStatus` 등), checklist state(`request / execution / delivery / completion`)를 함께 내려 상태 모니터가 더 안정적인 기준으로 읽을 수 있게 정리 중입니다.
- `/api/tasks`는 이제 `runIds`, `latestAttemptId`, `attempt.prompt`까지 함께 내려 WebUI가 raw run을 다시 request-group heuristic으로 묶지 않고 explicit task ownership만 따라가게 정리 중입니다.
- WebUI 상태 모니터도 이제 이 `/api/tasks` projection을 직접 소비하기 시작해, 프런트가 raw run을 다시 request-group heuristic으로 묶는 구형 경로를 줄이는 방향으로 정리 중입니다.
- 다만 WebSocket 승인 경로는 예외적으로 상태 전달의 단일 진실 원천 역할을 해야 하므로, 브라우저 클릭과 서버 타임아웃을 같은 `deny`로 뭉개지 않고 원인을 함께 전달해야 합니다.
