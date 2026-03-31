# source.md

## 역할

- `runs`는 사용자 작업 실행 엔진입니다.

## 주요 파일

- `start.ts`: root run 생성, request-group 큐 등록, intake/취소/clarification 분배, 승인, 복구, 완료 처리, 후속 오케스트레이션
- `store.ts`: 메모리/DB 기반 run 상태 업데이트
- `routing.ts`: 대상 선택과 복구 시 재라우팅
- `worker-runtime.ts`: CLI/worker 실행 연동
- `scheduled.ts`: 예약 후속 실행 프롬프트 생성
- `types.ts`: run과 task profile 계약

## 메모

- request-group 동작, 재질의 예산, “멈추지 말고 계속 진행” 정책이 주로 여기 있습니다.
- 현재 메인 원칙은 `분석 -> 처리 분배 -> 검토 -> 재분석` 루프이며, 취소 응답이나 intake 즉답도 가능하면 루프 안의 directive로 처리합니다.
- 최종 완료 의미는 `start.ts` 메인 루프가 결정하고, `store.ts`는 그 상태를 저장하고 방송합니다.
- 권한이 필요한 작업에서 worker나 LLM이 설명문으로만 `허용/승인 필요`를 말하면, 그 문구를 그냥 완료로 닫지 않고 메인 루프에서 synthetic approval 요청으로 승격해 다시 진행합니다.
- completion review가 실패해도 권한 안내 문구만으로는 완료 근거로 보지 않고, 승인 요청이나 다른 복구 경로를 우선 탑니다.
- 승인 거부 사유가 `사용자 거부`인지 `시스템 타임아웃`인지 구분해서 취소 요약을 남기며, 타임아웃을 사용자 취소로 기록하지 않습니다.
- `completed`, `failed`, `cancelled`, `interrupted` 상태의 request-group은 새 요청에서 재사용하지 않고 새 태스크로 시작합니다.
- 참조형 문구라도 재사용 가능한 활성 후보가 없으면 clarification으로 보내지 않고 바로 새 태스크로 시작합니다.
- 파일 검증 보조 run은 최종 완료/실패를 확정하지 않고, 분석 결과만 부모 run에 전달한 뒤 `interrupted`로 정리합니다.
- Telegram에서 만들어진 반복 스케줄은 생성 시점의 `sessionId`를 함께 저장해, 이후 실행 결과를 같은 Telegram 대화로 다시 돌려보낼 수 있도록 합니다.
- 예약/알림 취소 문장은 일반 active run 취소와 섞이지 않도록 분리하고, schedule action 경로에서는 실제 스케줄 비활성화와 system scheduler 엔트리 제거까지 같이 처리합니다.
- 단순한 메신저 전달 예약(`"..." 라고 말해줘`)은 가능하면 LLM 실행 없이 같은 Telegram 세션으로 직접 보내고, 채널이 없을 때만 일반 예약 실행으로 폴백합니다.
- 작업이 멈추거나, 너무 빨리 끝나거나, 재시도가 이상하면 우선 이 폴더부터 보는 것이 맞습니다.
