# source.md

## 역할

- `@nobie/webui`는 설정, 채팅, 실행 모니터링, 승인, 런타임 점검을 위한 브라우저 UI입니다.

## 주요 영역

- `src/pages`: 라우트 단위 화면
- `src/components`: 설정, 실행, 채팅, 보조 패널용 재사용 UI
- `src/stores`: 채팅, 실행, 설정, capability, 연결 상태를 담는 Zustand 스토어
- `src/api`: 백엔드와 연결되는 HTTP/WebSocket 어댑터

## 메모

- UI는 상태 의존성이 크고, 백엔드가 WebSocket으로 상태를 계속 밀어준다는 전제를 갖고 있습니다.
- WebUI도 delivery 책임을 직접 store 본문에 두기보다, 채팅용 pending assistant 누적/flush를 `src/stores/chat-delivery.ts`로 분리하기 시작했습니다.
- 상태 모니터는 이제 `src/stores/runs.ts`가 `/api/tasks` projection을 유지하고, `src/lib/task-monitor.ts`는 그 결과를 UI 카드로 바꾸는 adapter 역할을 맡습니다. 채팅은 사용자용 큐만, Runs 화면은 내부 디버그 attempt까지 보여주는 식으로 뷰를 나눕니다.
- 이 adapter는 `TaskModel.runIds`, `latestAttemptId`, `attempt.prompt`를 우선 사용해 raw run detail을 붙이고, 과거처럼 `requestGroupId`만으로 client-side regroup을 다시 하지 않는 방향으로 정리 중입니다.
- 설정과 런타임 모니터링은 부가 관리 화면이 아니라 제품의 핵심 흐름입니다.
