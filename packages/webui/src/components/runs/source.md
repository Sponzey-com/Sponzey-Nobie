# source.md

## 역할

- `components/runs`는 사용자가 읽고 제어할 수 있는 형태로 run 실행 상태를 보여줍니다.

## 주요 파일

- `RunStatusCard.tsx`: 큐 카드와 트리 구조 표시
- `RunSummaryPanel.tsx`: 탑다운 실행 요약과 진단 정보
- `RunStepTimeline.tsx`, `RunEventFeed.tsx`: 이력과 이벤트 표시
- `RunApprovalActions.tsx`, `CancelRunButton.tsx`: 직접 제어 버튼
- `runLabels.ts`: 상태, 프로필, 대상 라벨 매핑

## 메모

- 이 폴더는 백엔드 run 상태를 사람이 읽을 수 있는 작업 모니터 화면으로 번역합니다.
- 라벨이나 배치의 작은 변경도 체감 품질에 큰 영향을 줍니다.
