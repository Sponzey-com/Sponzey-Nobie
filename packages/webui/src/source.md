# source.md

## 역할

- `packages/webui/src`는 실제 React 애플리케이션 구현 루트입니다.

## 중요 단위

- `App.tsx`: 라우트 트리, 인증 초기화, WebSocket 시작
- `pages`: 화면 단위 조합
- `components`: UI 조립 블록과 도메인 전용 패널
- `lib/task-monitor.ts`: `/api/tasks` projection을 UI 카드로 바꾸는 adapter
- `stores`: 클라이언트 상태와 수신 run 스트림 처리
- `api`: 백엔드 연동 계층

## 메모

- 대부분의 동작은 일회성 폼 제출보다 실시간 run 상태에 의해 움직입니다.
- 화면이 이상해 보이면 컴포넌트보다 먼저 store 구조를 확인하는 편이 맞습니다.
- 승인 모달 같은 실시간 상호작용은 브라우저가 자체적으로 거부를 확정하지 말고, 서버가 방송한 승인 결과를 기준으로 상태를 정리해야 race를 줄일 수 있습니다.
- `task-monitor.ts`는 사용자용 카드에서는 내부 recovery/verification attempt를 기본 숨기고, Runs 화면에서만 내부 디버그 정보를 추가로 보여주는 기준점을 제공합니다.
- WebUI는 task projection을 raw run에서 다시 계산하지 않고 `/api/tasks` snapshot을 우선 사용합니다.
- `task-monitor.ts`도 이제 `TaskModel.runIds`, `latestAttemptId`, `attempt.prompt`를 따라 raw run을 참조하고, 같은 `requestGroupId`라는 이유만으로 다시 regroup하는 구형 heuristic을 줄이는 방향으로 정리 중입니다.
- `task-monitor.ts`는 이제 backend task projection의 checklist state도 함께 받아 카드 badge와 상세 checklist panel을 같은 기준으로 그립니다.
