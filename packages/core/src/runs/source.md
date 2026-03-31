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
- 메인 루프 안에서는 원문 문자열을 다시 직접 해석하지 않고, intake가 넘긴 `structured_request`와 `execution_semantics`를 우선 사용합니다.
- 후속 실행 프롬프트와 예약 실행 프롬프트는 intake가 만든 `structured_request`를 기준으로 `[target]`, `[to]`, `[context]`, `[complete-condition]`, `[normalized-english]` 블록을 포함해 내려보냅니다.
- 예약 후속 실행 프롬프트의 `[to]`는 가능하면 Telegram chat/thread 같은 실제 전달 대상을 그대로 써서, `current channel` 같은 모호한 목적지 문구를 줄입니다.
- `안녕이라고 해줘`처럼 채널 표기가 없는 예약 발화도 literal text 전달 요청으로 해석해서, `[target]`은 문구 자체, `[to]`는 실제 전달 대상, `[complete-condition]`은 해당 문구의 1회 전달로 구체화합니다.
- 특히 예약 발화 분류는 `말해줘/알려줘/보내줘`뿐 아니라 `해줘/해 주세요`까지 포함해야 합니다. 이 분류가 실패하면 delayed run 등록 시 `directDelivery=false`가 되어 예약 실행이 불필요하게 LLM 경로로 들어갑니다.
- 일정 생성 시 direct delivery 여부와 예약 전달 대상은 `followup_run_payload.literal_text`와 `followup_run_payload.destination`을 우선 사용해서, 등록 시점과 실행 시점 모두 같은 구조화 정보로 direct completion을 판단합니다.
- intake 단계의 일정 action이 전부 실패하면 그 실패 receipt를 바로 `completed`로 닫지 않고, 메인 루프 안에서 `retry_intake` directive로 다시 intake 재분석을 시도합니다.
- 이때 재질의 예산도 함께 사용하며, 한도에 닿으면 `일정 해석 복구 재시도 한도`로 취소 상태에 정리합니다.
- schedule recovery용 intake 재분석은 현재 루프의 `currentMessage`를 사용하되, 후속 실행과 예약 등록에 남는 `originalRequest`는 계속 원래 사용자 요청을 유지합니다.
- 메인 루프의 완료/승인/직접 전달/절단 복구 판단은 이제 `request-semantics.ts`의 원문 해석보다 intake가 넘긴 `execution_semantics`와 `structured_request`를 우선 사용합니다.
- request-group 재연결과 활성 실행 취소 같은 진입 해석도 `runs` 밖에서 하도록 옮겨, `start.ts`는 intake가 넘긴 구조화된 entry semantics를 사용합니다.
- 일부 파일 검증 대상 추론은 아직 원 요청 문자열을 참고하지만, `Task Intake Bridge` 문구를 다시 파싱하는 방식은 제거했습니다.
- 예약된 직접 메신저 전달도 더 이상 지연 타이머에서 채널로 바로 보내지 않고, 예약 run을 만든 뒤 메인 루프 안의 completion directive로 처리합니다.
- 최종 완료 의미는 `start.ts` 메인 루프가 결정하고, `store.ts`는 그 상태를 저장하고 방송합니다.
- 메신저 파일 전달 완료는 `FILE_SEND:` 같은 출력 문자열이 아니라, 채널 계층이 실제 전송을 마친 뒤 넘겨주는 구조화된 receipt를 기준으로 판단합니다.
- 도구가 실제로 실행된 태스크는 가능하면 `preview` 문구보다 구조화된 액션 결과와 delivery receipt를 완료 근거로 우선 사용합니다.
- 권한이 필요한 작업에서 worker나 LLM이 설명문으로만 `허용/승인 필요`를 말하면, 그 문구를 그냥 완료로 닫지 않고 메인 루프에서 synthetic approval 요청으로 승격해 다시 진행합니다.
- completion review가 실패해도 권한 안내 문구만으로는 완료 근거로 보지 않고, 승인 요청이나 다른 복구 경로를 우선 탑니다.
- 승인 거부 사유가 `사용자 거부`인지 `시스템 타임아웃`인지 구분해서 취소 요약을 남기며, 타임아웃을 사용자 취소로 기록하지 않습니다.
- `completed`, `failed`, `cancelled`, `interrupted` 상태의 request-group은 새 요청에서 재사용하지 않고 새 태스크로 시작합니다.
- 다만 Telegram reply-to로 특정 태스크를 명시한 경우는 예외로, 종료된 request-group이어도 같은 태스크에 다시 붙여 이어갑니다.
- 참조형 문구라도 재사용 가능한 활성 후보가 없으면 clarification으로 보내지 않고 바로 새 태스크로 시작합니다.
- 파일 검증 보조 run은 최종 완료/실패를 확정하지 않고, 분석 결과만 부모 run에 전달한 뒤 `interrupted`로 정리합니다.
- Telegram에서 만들어진 반복 스케줄은 생성 시점의 `sessionId`를 함께 저장해, 이후 실행 결과를 같은 Telegram 대화로 다시 돌려보낼 수 있도록 합니다.
- 예약/알림 취소 문장은 일반 active run 취소와 섞이지 않도록 분리하고, schedule action 경로에서는 실제 스케줄 비활성화와 system scheduler 엔트리 제거까지 같이 처리합니다.
- 단순한 메신저 전달 예약(`"..." 라고 말해줘`)은 가능하면 채널 종류와 무관하게 LLM 실행 없이 같은 채널로 직접 완료를 우선 시도하고, 직접 전달 정보를 만들 수 없을 때만 일반 예약 실행으로 폴백합니다.
- LLM/worker/execution 복구 프롬프트는 현재 실패 프롬프트를 다시 감싸지 않고 `originalUserRequest`만 기준으로 재구성해, 복구가 반복될수록 프롬프트가 자기 자신을 누적해서 비대해지는 현상을 줄입니다.
- 작업이 멈추거나, 너무 빨리 끝나거나, 재시도가 이상하면 우선 이 폴더부터 보는 것이 맞습니다.
