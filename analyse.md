# analyse.md

## 주제

- 요청 접수 지연 원인
- 예약 실행 중복 원인
- 현재 실행 구조의 병목
- 구조 개선 방향

## 현재 구조 요약

- `core`의 메인 실행 엔진은 [packages/core/src/runs/start.ts](packages/core/src/runs/start.ts)에 있다.
- 요청 실행은 `startRootRun()`에서 시작된다.
- 메인 오케스트레이션은 `Node.js` 단일 이벤트 루프 기반의 비동기 처리이며, `worker_threads` 기반 멀티스레드 구조는 아니다.
- 실제 병렬성은 외부 프로세스 실행, 비동기 I/O, 스트림 처리에 의해 만들어진다.
- 같은 `request_group`은 직렬 큐로 처리된다.
- 같은 세션의 delayed run도 별도 직렬 큐로 처리된다.

## 확인된 사실

### 1. 요청 접수는 즉시 응답 구조가 아니다

- 사용자가 메시지를 보내면 접수 응답이 바로 나가지 않는다.
- 먼저 `intake` 분석이 끝나야 접수/확인 응답이 생성된다.
- `intake`는 [packages/core/src/agent/intake.ts](packages/core/src/agent/intake.ts)에서 수행된다.
- 현재는 slash command가 아니면 대부분 AI intake 분석으로 들어간다.

### 2. 메인 처리 자체는 단일 스레드형 오케스트레이션이다

- 메인 루프는 단일 이벤트 루프에서 돈다.
- 외부 실행은 `child_process`를 사용한다.
- 예:
  - worker runtime: [packages/core/src/runs/worker-runtime.ts](packages/core/src/runs/worker-runtime.ts)
  - shell/app/screen 도구도 외부 프로세스를 실행한다.

### 3. 같은 request group은 순차 실행된다

- [packages/core/src/runs/start.ts](packages/core/src/runs/start.ts)의 `requestGroupExecutionQueues`가 같은 `request_group`의 실행을 직렬화한다.
- 이 때문에 같은 그룹에 후속 run이 붙으면 앞 작업이 끝날 때까지 대기한다.

### 4. delayed run도 세션 단위로 순차 실행된다

- 같은 파일의 `delayedSessionQueues`가 delayed run을 세션 기준으로 직렬화한다.
- 예약 실행도 즉시 독립 병렬 실행이 아니라 세션 큐 영향을 받는다.

## 느린 이유

### 1. intake가 첫 응답 전에 끝나야 한다

- Telegram/WebUI/CLI 요청 모두 사실상 `intake -> 실행` 순서를 먼저 밟는다.
- 사용자는 접수만 원해도, 시스템은 먼저 분석을 하느라 시간을 쓴다.

### 2. 자연어 영문 요청은 heuristic을 거의 타지 않는다

- 현재 heuristic 진입 조건은 `/`로 시작하는 명령어 위주다.
- 따라서 자연어 영문 요청은 곧바로 intake AI으로 간다.
- 자연어를 AI으로 해석하는 방향 자체는 맞다.
- 문제는 자연어를 AI으로 해석하는 것 자체가 아니라, 단순 요청까지 접수 응답 전에 무거운 intake와 재분석 루프를 모두 거친다는 데 있다.
- 결과적으로 단순한 영어 일정 요청도 접수 단계에서 느려진다.

### 3. 일정 생성 실패 후 재분석 루프가 추가 비용을 만든다

- `5 sec later say Hello, World.` 같은 요청은
  - intake AI 분석
  - `create_schedule` 시도
  - 초 단위 예약 불가
  - `retry_intake`
  - 재분석

  순서로 이어질 수 있다.
- 즉 지연의 핵심은 언어 자체가 아니라 `상대시간 예약 실패 -> 재분석` 경로다.

## 중복 실행 원인

### 1. 예약 실행이 원래 request group을 재사용한다

- [packages/core/src/runs/start.ts](packages/core/src/runs/start.ts)에서 delayed run 등록 시 `requestGroupId: params.requestGroupId`를 넘기고 있다.
- 이후 `scheduleDelayedRootRun()`도 그 `requestGroupId`를 유지한 채 `startRootRun()`을 다시 호출한다.
- 결과적으로 예약 실행이 원래 요청과 같은 태스크 그룹에 섞인다.

### 2. 완료된 작업 뒤에 후속 run이 같은 그룹에 줄을 설 수 있다

- 예약 등록 run이 완료되는 동안 delayed run이 이미 같은 그룹으로 큐에 들어갈 수 있다.
- 이 경우 사용자는 한 번 끝난 작업이 또 움직이는 것처럼 보게 된다.

## 현재 병목의 핵심

- 접수 응답이 늦다: `intake`를 먼저 끝내야 해서
- 영문 자연어가 느리다: `/` 명령어가 아니면 intake AI으로 가서
- 일정 요청이 오래 걸린다: 상대시간 예약이 바로 등록되지 못하고 재분석 루프를 타서
- 예약이 중복처럼 보인다: 예약 실행이 독립 태스크가 아니라 원 request group을 재사용해서

## 개선 방향

### 1. 접수와 실행 분리

- 사용자에게는 먼저 `접수됨`을 빠르게 보낸다.
- 이후 분석/실행 상태를 별도로 갱신한다.

### 2. 자연어 해석은 AI 중심으로 유지

- 자연어 요청은 명령어처럼 deterministic parser로 처리하기보다, AI이 의미를 해석하는 것이 더 적절하다.
- 정규화는 `명령 변환`이 아니라 `보조 컨텍스트 생성` 수준으로 제한하는 편이 맞다.
- 즉 `원문 -> 정규화된 참고 정보 -> AI 해석` 구조가 바람직하다.
- 자연어를 바로 명령 체계로 환원하면 에이전트 성격이 리모트 컨트롤러처럼 변질될 수 있다.
- 따라서 개선 방향은 `AI 제거`가 아니라, `AI 해석 이전/이후의 구조를 가볍게 하고 실패 루프를 줄이는 것`이어야 한다.

### 3. 예약 요청을 일반 태스크와 분리

- 예약 등록은 일반 실행 태스크와 다르게 취급해야 한다.
- `언제 / 무엇을 / 어디에`가 정리되면 별도 경로로 등록하는 것이 맞다.

### 4. 예약 실행은 새 태스크로 시작

- 예약 실행은 원 요청과 같은 `request_group`을 재사용하지 않는 것이 바람직하다.
- 그래야 완료된 작업이 다시 이어서 도는 현상을 줄일 수 있다.

### 5. typed intent 중심으로 이동

- 문자열 기반 판정보다
  - `intent_type`
  - `delivery_type`
  - `destination_type`
  - `destination_id`
  - `run_at_type`

  같은 구조화 필드를 중심으로 흐르는 편이 더 안정적이다.
- 다만 이 구조화는 자연어를 강제로 명령문으로 바꾸기 위한 것이 아니라, AI이 해석한 결과를 후속 실행 단계에서 안정적으로 전달하기 위한 표현이어야 한다.

## 결론

- 현재 구조는 멀티스레드가 아니라 단일 이벤트 루프 기반의 비동기 오케스트레이션이다.
- 요청 접수가 느린 직접 원인은 `intake 선행 구조`다.
- 영문 요청이 느린 직접 원인은 `영어` 자체가 아니라 `자연어 -> intake AI -> 일정 실패 -> 재분석` 경로다.
- 자연어 해석은 계속 AI이 맡는 것이 맞고, 개선 포인트는 자연어를 명령화하는 것이 아니라 `접수 응답 분리`, `실패 루프 축소`, `예약 실행 분리`, `구조화 결과 전달 안정화`에 있다.
- 예약 중복의 직접 원인은 `delayed run의 request group 재사용`이다.

## 전환 이후 확인 규칙

- 현재 분석 문서는 “왜 바꾸는가”를 기록한다.
- 실제 구조가 바뀐 뒤의 확정 규칙은 `process.md`와 현재 `.design/task00x.md`에 함께 반영되어야 한다.
- dead path로 보는 대표 징후는 다음과 같다.
  - WebUI가 raw run을 다시 `requestGroupId` heuristic으로 regroup하는 경로
  - 새 `/api/runs`, `/api/tasks` 표면이 있는데 과거 run-start surface fallback을 계속 두는 경로
  - explicit queue helper가 있는데 같은 목적의 직렬화 set/map을 다시 들고 있는 경로