# source.md

## 역할

- `components/runs`는 사용자가 읽고 제어할 수 있는 형태로 run 실행 상태를 보여줍니다.

## 주요 파일

- `RunStatusCard.tsx`: 큐 카드와 트리 구조 표시. 현재는 root task와 sub-agent 관계를 한 카드 안에서 구분해 보여줌
- `RunSummaryPanel.tsx`: 탑다운 실행 요약과 진단 정보
- `TaskChecklistPanel.tsx`: task projection의 checklist state를 체크박스형 상태 패널로 표시
- `TaskFailurePanel.tsx`: task projection이 계산한 실패 종류, 마지막 실패 요약, detail lines 표시
- `TaskArtifactPanel.tsx`: 전달 완료된 파일/이미지 artifact를 task monitor와 chat detail에서 미리보기 또는 링크로 표시
- `RunStepTimeline.tsx`, `RunEventFeed.tsx`: 이력과 이벤트 표시
- `RunApprovalActions.tsx`, `CancelRunButton.tsx`: 직접 제어 버튼
- `runLabels.ts`: 상태, 프로필, 대상 라벨 매핑

## 메모

- 이 폴더는 백엔드 run 상태를 사람이 읽을 수 있는 작업 모니터 화면으로 번역합니다.
- 라벨이나 배치의 작은 변경도 체감 품질에 큰 영향을 줍니다.
- `RunStatusCard`는 이제 작은 버튼 하나만이 아니라 카드 전체 클릭과 키보드 입력으로 선택할 수 있고, 취소 버튼은 카드 선택 이벤트를 막아 직접 제어와 선택이 서로 충돌하지 않도록 합니다.
- `RunStatusCard`와 `RunSummaryPanel`은 raw run group을 직접 알지 않고, 상위 페이지가 `task-monitor.ts`에서 계산한 task projection과 extra content를 주입받는 쪽으로 유지하는 편이 맞습니다.
