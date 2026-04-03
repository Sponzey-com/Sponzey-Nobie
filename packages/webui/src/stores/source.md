# source.md

## 역할

- `stores`는 Zustand로 구성된 클라이언트 상태를 담습니다.

## 주요 스토어

- `chat.ts`: 메시지 스트림, 승인, 세션 연결 run
- `chat-delivery.ts`: WebSocket으로 들어오는 assistant text/tool call 누적과 flush helper
- `runs.ts`: raw run 목록, `/api/tasks` task projection, 선택 상태
- `setup.ts`: 수정 가능한 setup draft와 저장/초기화 생명주기
- `capabilities.ts`, `connection.ts`, `uiLanguage.ts`: 보조 전역 상태

## 메모

- 들어오는 WebSocket 이벤트는 여기서 store 상태로 환원됩니다.
- assistant 응답의 pending text/tool call 누적도 `chat-delivery.ts`로 분리해, `chat.ts`가 이벤트 분기와 store 반영에 더 집중하도록 정리하고 있습니다.
- `runs.ts`는 이제 raw run과 `/api/tasks` snapshot을 함께 유지하고, WebSocket run 업데이트 뒤에는 task projection을 짧게 다시 동기화해 상태 모니터가 request-group heuristic보다 stable task model과 checklist state를 우선 보게 합니다.
- UI와 백엔드 상태가 어긋나면 가장 먼저 이 폴더를 보는 경우가 많습니다.
