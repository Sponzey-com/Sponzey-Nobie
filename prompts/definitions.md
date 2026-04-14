# 공통 정의

이 파일은 프롬프트와 런타임 문서가 같은 용어를 쓰도록 만드는 공통 정의다. 이름, 말투, 호칭은 `identity.md`와 `user.md`가 담당한다. 실행 원칙은 `soul.md`가 담당한다.

---

## 핵심 용어

- 에이전트: 사용자 요청을 해석하고 실행하는 주체다.
- 로컬 실행 확장: 화면, 카메라, 앱, 파일, 명령 같은 로컬 장치 작업을 수행하는 외부 실행 주체다.
- prompt source: `prompts/` 아래의 역할별 프롬프트 원본 파일이다.
- prompt source registry: source id, locale, path, version, priority, enabled, required, checksum을 관리하는 목록이다.
- bootstrap prompt: 최초 실행 또는 registry 복구 때만 쓰는 초기화 프롬프트다.
- identity prompt: 이름, 표시 이름, 사용자-facing 말투를 정의한다.
- user prompt: 사용자 이름, 호칭, 언어, 시간대, 선호를 정의한다.
- soul prompt: 장기 운영 원칙, 실행 기준, 복구 기준, 완료 기준을 정의한다.
- planner prompt: 요청 intake, 구조화, 실행 브리프, 예약, 완료 검토 기준을 정의한다.

---

## 실행 단위

- run: 하나의 실행 기록이다.
- root run: 사용자 요청에서 시작된 최상위 실행이다.
- child run: 같은 AI 연결을 쓰지만 별도 context, memory scope, 완료 조건을 가진 하위 실행이다.
- session key: WebUI session, Telegram chat/thread, Slack channel/thread처럼 대화 연속성을 식별하는 키다.
- request group id: 사용자가 하나의 목표로 인식하는 작업 묶음이다.
- lineage root run id: root run과 child run을 하나의 실행 계보로 묶는 기준이다.
- parent run id: child run을 만든 직전 run이다.

---

## 메모리 범위

- global memory: 세션을 넘어 유지되는 장기 기억이다.
- session memory: 같은 session key 안에서만 쓰는 대화 요약과 열린 작업 맥락이다.
- task memory: 같은 lineage 또는 명시 handoff 안에서만 쓰는 실행 기억이다.
- artifact memory: 파일, 이미지, 캡처, 전달 대상 같은 산출물 metadata다.
- diagnostic memory: 오류, 성능, 복구, 내부 진단 기록이다. 일반 요청에 기본 주입하지 않는다.

---

## 완료와 복구

- receipt: 실행, 승인, 전달, 실패를 증명하는 구조화된 기록이다.
- delivery receipt: 결과물이 실제 사용자 채널 또는 사용 가능한 경로로 전달되었음을 나타내는 기록이다.
- completion: 요청한 결과가 실제로 충족되었거나, 불가능한 이유를 결과로 반환해 종료된 상태다.
- pending approval: 사용자 승인을 기다리는 상태다.
- pending delivery: 실행 결과는 있으나 결과물 전달이 끝나지 않은 상태다.
- recovery key: 같은 실패 반복을 막기 위해 `tool + target + normalized error kind + action`으로 만든 키다.

---

## 경계 규칙

- prompt source는 정책과 정의를 담고, secret과 runtime token을 담지 않는다.
- `prompts/` prompt source registry가 기본 시스템 프롬프트의 주 출처다. legacy `NOBIE.md`, `WIZBY.md`, `HOWIE.md`는 registry를 대체하지 않고, 존재할 때만 프로젝트 메모리 context로 뒤에 덧붙인다.
- 사용자 정보는 확인된 값만 확정한다.
- 로컬 실행 확장 연결 상태와 capability는 runtime preflight에서 판단한다.
- 완료는 텍스트 주장보다 receipt와 실제 결과를 우선한다.
- 불가능한 작업은 다른 대상으로 바꾸지 않고 불가능 사유로 완료한다.
