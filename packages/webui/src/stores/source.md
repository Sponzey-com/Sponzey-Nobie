# source.md

## 역할

- `stores`는 Zustand로 구성된 클라이언트 상태를 담습니다.

## 주요 스토어

- `chat.ts`: 메시지 스트림, 대기 중 도구 호출, 승인, 세션 연결 run
- `runs.ts`: 정규화된 run 목록과 선택 상태
- `setup.ts`: 수정 가능한 setup draft와 저장/초기화 생명주기
- `capabilities.ts`, `connection.ts`, `uiLanguage.ts`: 보조 전역 상태

## 메모

- 들어오는 WebSocket 이벤트는 여기서 store 상태로 환원됩니다.
- UI와 백엔드 상태가 어긋나면 가장 먼저 이 폴더를 보는 경우가 많습니다.
