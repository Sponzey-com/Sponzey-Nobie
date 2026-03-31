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
- 설정과 런타임 모니터링은 부가 관리 화면이 아니라 제품의 핵심 흐름입니다.
