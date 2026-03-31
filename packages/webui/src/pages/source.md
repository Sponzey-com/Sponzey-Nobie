# source.md

## 역할

- `pages`는 store와 component를 조합해 완전한 사용자 흐름을 만드는 라우트 단위 화면입니다.

## 주요 화면

- `SetupPage`: 최초 설정과 수정 가능한 setup 흐름
- `SettingsPage`: 고급 설정과 MQTT 런타임 관리
- `ChatPage`: 작업 큐 카드가 붙는 대화 UI
- `RunsPage`: 실행 모니터링 화면
- `DashboardPage`, `AuditPage`, `PluginsPage`, `SchedulePage`: 보조 운영 화면

## 메모

- 페이지는 상태 조합과 레이아웃에 집중하고, 저수준 비즈니스 로직은 되도록 직접 가지지 않는 것이 좋습니다.
- `RunsPage`는 request-group 단위 대표 run만 보여주더라도, 요청 영역에는 내부 보조 run 프롬프트가 아니라 그룹 내 마지막 사용자성 요청을 우선 표시해 취소·정리 상태에서도 원래 요청을 잃지 않도록 유지합니다.
