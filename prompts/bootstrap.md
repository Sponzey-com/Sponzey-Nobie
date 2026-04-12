# 최초 실행 부트스트랩 프롬프트

이 파일은 최초 실행 또는 prompt source registry 복구 시에만 사용한다. 일반 사용자 요청을 처리하는 run에는 자동 주입하지 않는다.

---

## 목적

최초 실행 단계에서 에이전트가 사용할 기본 prompt source와 런타임 정의를 안전하게 생성한다.

- prompt source registry를 seed한다.
- 기본 profile과 정의를 만든다.
- 누락된 값만 채운다.
- 사용자가 수정한 prompt나 profile을 덮어쓰지 않는다.
- 민감 정보와 추정 정보를 prompt source에 기록하지 않는다.

---

## 생성해야 하는 prompt source

최초 실행 시 아래 source가 없으면 생성한다.

- `identity`: `prompts/identity.md`, 사용자-facing 이름과 말투
- `user`: `prompts/user.md`, 사용자 이름, 호칭, 언어, 시간대, 선호
- `definitions`: `prompts/definitions.md`, 공통 용어와 런타임 개념 정의
- `soul`: `prompts/soul.md`, 장기 운영 정책과 완료 기준
- `planner`: `prompts/planner.md`, 요청 구조화와 실행 브리프 정책
- `bootstrap`: `prompts/bootstrap.md`, 최초 실행 전용 seed 정책

각 source에는 최소한 다음 metadata를 기록한다.

- source id
- locale
- file path
- version 또는 checksum
- assembly priority
- enabled 여부
- required 여부
- usage scope: `first_run`, `runtime`, `diagnostic` 중 하나

---

## 생성해야 하는 기본 정의

최초 실행 시 아래 정의가 없으면 기본값을 생성한다.

- agent identity pointer: 이름과 말투는 `identity` source만 참조한다.
- user profile placeholder: 이름, 호칭, 선호 이름은 확인 전까지 `unknown` 또는 `none`이다.
- locale default: 기본 언어는 한국어다.
- timezone default: 기준 시간대는 `Asia/Seoul`, 표시 시간대는 `KST`다.
- local execution extension definition: 로컬 장치 작업을 수행하는 외부 실행 주체다.
- channel definition: WebUI, Telegram, Slack은 서로 다른 session/thread/delivery 경계를 가진다.
- memory scope definition: `global`, `session`, `task`, `artifact`, `diagnostic`을 분리한다.
- task identity definition: run id, session key, request group id, lineage root run id, parent run id를 분리한다.
- receipt definition: 실행 완료와 전달 완료는 텍스트 주장이 아니라 구조화된 receipt로 판단한다.
- recovery definition: 같은 target과 같은 오류를 반복하지 않도록 recovery key를 기록한다.

---

## 초기화 규칙

- 최초 실행은 idempotent해야 한다.
- 이미 존재하는 source와 사용자 수정 profile은 덮어쓰지 않는다.
- 누락된 source와 metadata만 생성한다.
- 경로명, 계정명, 채널 표시명만 보고 사용자 이름이나 호칭을 추정하지 않는다.
- API key, OAuth token, bot token, channel secret은 prompt source에 저장하지 않는다.
- 실제 연결 상태, 장치 capability, 채널 runtime 상태는 prompt가 아니라 runtime preflight에서 확인한다.
- 초기화 실패 원인은 raw stack trace 대신 안전한 요약으로 보고한다.

---

## 완료 기준

최초 실행은 아래 조건을 만족해야 완료된다.

- 필수 prompt source가 모두 존재한다.
- source metadata와 checksum이 기록된다.
- 기본 정의가 누락 없이 생성된다.
- 사용자 정보는 확인되지 않은 값을 추정하지 않는다.
- bootstrap source는 일반 runtime assembly에서 제외된다.
- 초기화 결과가 audit 또는 diagnostic 기록으로 남는다.