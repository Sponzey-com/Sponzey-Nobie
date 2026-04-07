# source.md

## 역할

- `pages`는 store와 component를 조합해 완전한 사용자 흐름을 만드는 라우트 단위 화면입니다.

## 주요 화면

- `SetupPage`: 최초 설정과 수정 가능한 setup 흐름. 현재는 단일 AI 연결 기준으로 위저드를 단순화하고, 구형 `AI 순서` 단계는 숨김 호환만 유지
- `SettingsPage`: 단일 AI 연결 카드, MQTT 런타임 관리, 고급 설정
- `ChatPage`: 사용자용 task queue와 승인 UI가 붙는 대화 화면
- `RunsPage`: task monitor와 내부 디버그 attempt를 함께 보는 실행 모니터링 화면
- `DashboardPage`, `AuditPage`, `PluginsPage`, `SchedulePage`: 보조 운영 화면

## 메모

- 페이지는 상태 조합과 레이아웃에 집중하고, 저수준 비즈니스 로직은 되도록 직접 가지지 않는 것이 좋습니다.
- `ChatPage`는 run 생성 직후 서버가 돌려준 ingress receipt가 있으면, 실제 실행 결과가 오기 전이라도 즉시 assistant 메시지로 보여줘 접수 체감을 줄입니다.
- WebUI의 run 생성 응답에는 이제 `requestId(runId)`, `sessionId`, `source`, `receipt`가 함께 내려와, 접수 단계 식별 정보와 UI 표시를 ingress 기준으로 맞춥니다.
- `ChatPage`와 `RunsPage`는 더 이상 raw run을 각자 ad-hoc group하지 않고, store가 유지하는 `/api/tasks` projection을 `lib/task-monitor.ts` adapter로 공통 소비합니다.
- 이 adapter는 이제 `TaskModel.runIds`와 `latestAttemptId`를 기준으로 raw run detail을 붙여, 같은 `requestGroupId`라는 이유만으로 unrelated run을 다시 섞지 않도록 정리 중입니다.
- `ChatPage`와 `RunsPage`는 task projection의 `failure`를 그대로 보여주며, 실행 실패와 전달 실패를 구분한 마지막 실패 요약과 detail lines를 별도 블록으로 노출합니다.
- `ChatPage`와 `RunsPage`는 task projection의 checklist state도 그대로 보여주며, 카드에서는 진행 비율을, 상세 패널에서는 `request / execution / delivery / completion` 단계 상태를 체크박스처럼 노출합니다.
- `ChatPage`와 `RunsPage`의 task tree는 이제 `runScope(root / child / analysis)`와 `handoffSummary`를 읽어 root task와 sub-agent 관계를 더 직접적으로 보여줍니다.
- `ChatPage`의 새 run 시작도 이제 `createRun -> /api/runs`만 쓰고, 화면 안에서 과거 `api/agent/run` fallback을 다시 두지 않는 방향으로 정리 중입니다.
- `RunsPage`는 request-group 단위 대표 run만 보여주더라도, 요청 영역에는 내부 보조 run 프롬프트가 아니라 그룹 내 마지막 사용자성 요청을 우선 표시해 취소·정리 상태에서도 원래 요청을 잃지 않도록 유지합니다.
