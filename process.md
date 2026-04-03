# Nobie Process

이 문서는 현재 Nobie의 확정 프로세스 기준 문서다.

## 1. 핵심 원칙

- Nobie가 자연어 해석, completion review, 요약 같은 자연어 기반 판단에 사용하는 것은 `설정에서 연결한 AI`다.
- 프로세스 문서에는 별도 외부 자연어 엔진 행위자를 두지 않는다.
- `packages/core/src/ai`는 설정된 AI backend를 호출하는 내부 adapter 계층이다.
- 명령 실행, 앱 실행, 화면 캡처, 키보드 입력, 마우스 제어 같은 로컬 실행 계열 작업은 Yeonjang 연장을 통해서만 수행한다.
- 위 로컬 실행 계열 작업에 대해 Nobie core 로컬 fallback은 두지 않는다.
- 실행 성공과 완료 성공은 다르다. 완료는 최소한 `해석 / 실행 / 전달 / 복구 종료` 4축이 만족될 때만 선언한다.
- 자동 재시도 한도는 별도 하드코딩 상한을 두지 않고 `orchestration.maxDelegationTurns`를 따른다.
- 메인 루프 밖에서 최종 완료를 선언하지 않는다.

## 2. 계층

1. `Ingress`

   요청 수신, 세션 확인, request group 계산, 즉시 접수 응답
2. `Intake`

   자연어를 구조화된 요청으로 해석
3. `Execution`

   구조화된 요청을 기준으로 도구, worker, 로컬 실행 경로를 선택하고 실행
4. `Recovery`

   실패 원인 분류, 다른 실행 경로 탐색, 재시도 또는 중단 결정
5. `Delivery`

   결과를 필요한 채널로 전달
6. `Completion / Review`

   receipt 기준으로 완료 여부를 판정하고 필요한 follow-up을 결정

## 3. AI 경계

- `agent/intake.ts`

  설정된 AI를 사용해 자연어 요청을 구조화한다.
- `agent/index.ts`

  설정된 AI를 사용해 일반 실행 대화를 진행한다.
- `agent/completion-review.ts`

  설정된 AI를 사용해 completion review를 수행한다.
- `memory/compressor.ts`

  설정된 AI를 사용해 오래된 대화 문맥을 요약한다.

즉 자연어 해석은 계속 AI가 맡지만, 실행 루프는 자연어를 다시 붙들고 있지 않고 구조화 결과와 receipt를 중심으로 움직인다.

## 4. 내부 `ai` 계층의 역할

`packages/core/src/ai`의 책임은 아래로 제한한다.

- backend 선택
- 모델 선택
- 메시지/도구 포맷 변환
- vendor SDK 또는 HTTP 호출
- 인증 정보와 key cooldown 관리
- 공통 chunk 계약 제공

이 계층은 오케스트레이션을 하지 않는다.

- 요청 해석 정책
- 복구 판단
- completion 판단
- queue 관리
- delivery 상태 판단

이런 정책은 `agent`, `runs`, `scheduler` 계층이 맡는다.

## 5. Queue 단위

- Intake Queue: `sessionId`
- Execution Queue: `requestGroupId`
- Recovery Queue: `runId`
- Delivery Queue: `targetChannel + targetSessionId`
- Schedule Queue: `scheduleId`

각 queue는 목적별 직렬화 단위이며, 서로 다른 queue의 병렬도는 독립적으로 본다.

## 6. Schedule 원칙

- 예약 등록 task와 예약 실행 task는 분리한다.
- 예약 실행은 새 task instance와 새 run으로 시작한다.
- 원 등록 task와의 연결은 `originRunId`, `originRequestGroupId`, `scheduleId`, `scheduleRunId`로 남긴다.
- 예약 실행 실패는 원 등록 task를 오염시키지 않는다.

## 7. Completion / Terminal 규칙

- `completed`

  receipt 기준 completion state가 만족될 때만 사용
- `failed`

  abort가 아닌 fatal failure일 때만 사용
- `cancelled`

  explicit stop 또는 abort일 때만 사용
- `awaiting_user`

  추가 입력 또는 승인 대기 상태

review가 `complete`를 반환해도 receipt 기준 상태가 부족하면 완료로 닫지 않는다.

## 8. Recovery / Retry 규칙

- 같은 실패를 같은 경로로 무한 반복하지 않는다.
- 새 recovery key나 구조화된 대안이 있으면 retry를 검토한다.
- 새 대안이 없으면 stop 한다.
- 외부 AI 복구, execution 복구, delivery 복구 모두 동일하게 `orchestration.maxDelegationTurns` 예산 안에서만 돈다.

## 9. Direct Delivery 규칙

- 단순 전달만 필요한 요청은 가능하면 AI 실행 없이 direct delivery를 우선 시도한다.
- direct delivery가 이미 성공했고 completion state가 settled면 불필요한 review는 생략할 수 있다.

## 10. 문서 동기화 규칙

아래가 바뀌면 이 문서를 같은 턴에 같이 갱신한다.

- queue 단위
- schedule lineage
- completion state 정의
- terminal 상태 의미
- AI 호출 경계
- obsolete path 제거 기준

확정 프로세스 문서는 `process.md` 하나를 기준으로 유지한다.
