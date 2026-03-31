# source.md

## 역할

- `runs`는 사용자 작업 실행 엔진입니다.

## 주요 파일

- `start.ts`: root run 생성, intake, 라우팅, 승인, 복구, 완료 처리, 후속 오케스트레이션
- `store.ts`: 메모리/DB 기반 run 상태 업데이트
- `routing.ts`: 대상 선택과 복구 시 재라우팅
- `worker-runtime.ts`: CLI/worker 실행 연동
- `scheduled.ts`: 예약 후속 실행 프롬프트 생성
- `types.ts`: run과 task profile 계약

## 메모

- request-group 동작, 재질의 예산, “멈추지 말고 계속 진행” 정책이 주로 여기 있습니다.
- 작업이 멈추거나, 너무 빨리 끝나거나, 재시도가 이상하면 우선 이 폴더부터 보는 것이 맞습니다.