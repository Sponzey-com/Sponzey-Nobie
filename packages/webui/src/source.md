# source.md

## 역할

- `packages/webui/src`는 실제 React 애플리케이션 구현 루트입니다.

## 중요 단위

- `App.tsx`: 라우트 트리, 인증 초기화, WebSocket 시작
- `pages`: 화면 단위 조합
- `components`: UI 조립 블록과 도메인 전용 패널
- `stores`: 클라이언트 상태와 수신 run 스트림 처리
- `api`: 백엔드 연동 계층

## 메모

- 대부분의 동작은 일회성 폼 제출보다 실시간 run 상태에 의해 움직입니다.
- 화면이 이상해 보이면 컴포넌트보다 먼저 store 구조를 확인하는 편이 맞습니다.
