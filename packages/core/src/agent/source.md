# source.md

## 역할

- `agent`는 실제 시스템 프롬프트를 구성하고 메인 LLM 루프를 실행합니다.

## 주요 파일

- `index.ts`: `runAgent()` 구현, 시스템 프롬프트 로딩, 도구 라운드, 복구 신호 처리
- `intake.ts`: 본 실행 전 요청 분류와 intake 분석
- `intake-prompt.ts`: intake 프롬프트 구조와 정책
- `request-normalizer.ts`: 원문 요청을 intake 전에 영문 중심 실행 문장으로 정규화
- `completion-review.ts`: 작업이 실제로 끝났는지 판정
- `request-group-context.ts`: request-group 범위에 맞는 문맥만 추림
- `profile-context.ts`: 사용자 기본정보를 프롬프트 문맥에 주입

## 메모

- 이 폴더는 프롬프트 정책과 실제 실행을 잇는 경계입니다.
- 너무 빨리 완료되거나, 쓸데없이 묻거나, 잘못 라우팅되는 문제는 여기서 시작되는 경우가 많습니다.
- `runAgent()`의 `tool_end`는 출력 텍스트만이 아니라 구조화된 `details`도 함께 넘겨, 이후 `runs`와 채널 계층이 문자열 재해석 없이 액션 결과를 사용할 수 있어야 합니다.
- ingress 단계의 즉시 접수 응답은 `agent`가 아니라 `runs/ingress.ts`와 각 채널 진입점이 맡고, `agent/intake`는 그 뒤 자연어 해석과 구조화에 집중합니다.
- request-group 재사용 여부나 활성 실행 취소처럼 intake 전에 결정되는 진입 해석은 이제 `runs/entry-semantics.ts`로 옮겨, `agent/intake`는 자연어 해석과 구조화에 더 가깝게 유지합니다.
- intake heuristic은 이제 `/`로 시작하는 명령어에만 적용됩니다.
- 자연어 요청은 영문화/정규화 이후에도 heuristic으로 처리하지 않고, 가능하면 intake LLM으로 보냅니다.
- 예약/알림 관리 문장은 한국어뿐 아니라 `schedule`, `reminder`, `notification`, `alarm` 같은 영어 표현도 같은 경로로 해석합니다.
- intake는 이제 원문 메시지를 바로 분류하지 않고, 먼저 `request-normalizer.ts`에서 영문 중심 실행 문장으로 정규화한 뒤 그 결과를 기준으로 heuristic과 LLM 분석을 진행합니다.
- 영어 상대시간 예약도 slash command 안에 있을 때만 `in 5 seconds`, `5 sec later`, `10 mins later` 같은 축약 표현을 deterministic heuristic으로 처리합니다.
- intake 프롬프트는 이제 `execution.execution_semantics`를 포함해, 파일 변경 여부, 권한 작업 여부, 직접 결과 전달 여부, 승인 대상 도구를 구조화해서 넘기도록 확장되었습니다.
- intake 결과는 이제 `structured_request`를 포함하며, `source_language`, `normalized_english`, `[target]`, `[to]`, `[context]`, `[complete-condition]`에 해당하는 구조를 heuristic 경로와 LLM 경로 모두에서 공통으로 만듭니다.
- 이 구조화 결과는 다시 `intent_envelope`로 고정되어, 후속 실행 쪽은 `intent_type`, `destination`, `schedule_spec`, `execution_semantics`, `delivery_mode`, `requires_approval`, `preferred_target`를 하나의 표준 계약으로 받습니다.
- `intent_envelope` 생성 전에는 `structured_request` 필수 필드를 한 번 더 검증하고, 비어 있으면 fallback 규칙으로 보정합니다. 보정이 일어난 경우 `notes`에 `intent-envelope-repaired:...`가 남고, 정상 검증이 끝나면 `intent-envelope-validated`가 기록됩니다.
- `to`와 delivery 관련 context는 가능하면 `current channel` 같은 모호한 값 대신 실제 채널/세션/Telegram chat/thread/extension id를 사용하도록 보강되었습니다.
- 예약 발화 요청은 메신저 언급이 없어도 `"..."이라고 해줘` 형태를 literal text 전달로 해석해, 구조화 요청문 목표와 목적지가 분리되도록 보강되었습니다.
- 이 literal delivery 분류는 `"안녕이라고 해줘"`처럼 `해줘/해 주세요` 형태까지 포함해야 하며, 이 패턴을 놓치면 지연 예약이 direct completion이 아니라 일반 LLM 실행 경로로 빠집니다.
- 상대시간 예약이 literal delivery로 해석되면 `followup_run_payload`에 `literal_text`와 `destination`도 같이 넣어, 후속 실행이 task 문자열 재해석 없이 정확한 문구와 전달 대상을 그대로 사용할 수 있게 했습니다.
- LLM 오류 사유 분류는 `403`, `forbidden`, `Cloudflare challenge` 같은 접근 차단 신호를 `context size`보다 먼저 잡아, 인증/접근 차단 오류를 컨텍스트 초과로 잘못 요약하지 않도록 보정했습니다.
