# 스폰지 노비 · Sponzey Nobie

[한국어](./README.md) | [English](./README.en.md)

<p align="center">
  <img src="./resource/nobie-1-512.png" alt="Nobie" width="220" />
</p>

## 이름 이야기

- `Nobie`

  옆에서 같이 일해 주는 작은 작업 메이트라는 느낌으로 붙인 이름입니다. 너무 무겁지도 않고, 너무 차갑지도 않게, 사용자의 일을 한 발 먼저 알아듣고 챙겨 주는 조력자 톤을 의도했습니다.
- `Yeonjang`

  한국어 `연장`에서 온 이름입니다. Nobie가 생각하고 조율한다면, Yeonjang은 실제 기기와 화면, 키보드, 마우스 쪽으로 손을 뻗는 확장 파트입니다. 말하자면 `생각하는 쪽이 Nobie`, `움직이는 손발 쪽이 Yeonjang`입니다.

`Sponzey Nobie`는 사용자의 컴퓨터 위에서 동작하는 오케스트레이션 중심 개인 AI입니다. 제품 안에서 실제로 사용자와 대화하고 작업을 수행하는 이름은 `Nobie`입니다.

Nobie의 목표는 단순히 답변만 하는 채팅 AI가 아니라, 요청을 이해하고, 적절한 실행 경로를 선택하고, 실제 로컬 작업과 외부 연결, 전달, 완료 판정까지 이어서 처리하는 개인 작업 허브를 만드는 것입니다.

## 현재 상태 요약

- `구현됨`: WebUI 설정, AI 연결, MCP/Skill 등록, Telegram 연동, 태스크 상태 모니터, 로컬 실행 도구, 스케줄 실행, 연장 `(Yeonjang)` 연결
- `예정`: Slack 채널, Windows 전용 설치/운영 경험 보강, 더 넓은 환경 검증, 설정 UX 추가 단순화

중요:

- Nobie가 자연어 해석, 요청 구조화, completion review에 사용하는 것은 `설정 창에서 연결한 AI`입니다.
- 별도의 숨은 외부 LLM 행위자를 두지 않습니다.
- 내부 `packages/core/src/ai`는 설정된 AI backend를 호출하는 adapter 계층입니다.
- 현재 공식 지원 운영체제는 `macOS`입니다.
- 현재 Nobie의 명령형 로컬 실행, 앱 실행, 화면 캡처, 키보드/마우스 제어는 `Yeonjang` 연장이 실행 중이어야 합니다.

세부 프로세스 기준 문서는 [process.md](./process.md)입니다.

## 제품 해석

Nobie는 다음과 같이 이해하면 됩니다.

- `개인 비서형 AI`

  사용자의 컴퓨터, 파일, 화면, 앱, 채널, 연결된 연장을 기준으로 동작합니다.
- `오케스트레이션 우선 AI`

  답변만 하는 것이 아니라, 어떤 작업을 어떤 도구와 경로로 실행할지 조율합니다.
- `설치 후 바로 쓰는 도구`

  WebUI에서 순서대로 설정하고 바로 사용할 수 있도록 설계되어 있습니다.
- `확장 가능한 작업 플랫폼`

  AI backend, MCP, Skill, 채널, 연장을 조합해 실행 범위를 넓힐 수 있습니다.

## 누구를 위한 제품인가

Sponzey Nobie의 핵심 타겟은 다음과 같습니다.

- 컴퓨터 사용이 익숙하지 않은 사용자
- AI, MCP, Skill, 채널 연동 같은 용어가 낯선 사용자
- 복잡한 개발자 설정 없이 바로 쓸 수 있는 개인 비서를 원하는 사용자

그래서 UI와 문서는 아래 원칙을 따릅니다.

- 쉬운 표현을 먼저 보여줍니다.
- 원문 용어는 `()` 안에 보조 정보로 붙입니다.
- 필수 설정은 분명하게 표시합니다.
- 저장, 취소, 건너뛰기, 다음 같은 행동은 단순하고 확실해야 합니다.

## 구현됨

### 1. AI 연결 `(구현됨)`

설정 화면에서 연결한 단일 AI 연결을 Nobie가 사용합니다.

- OpenAI
- Anthropic
- Gemini
- Ollama
- OpenAI-compatible endpoint
- 로컬/원격 추론 서버

현재 기준:

- 활성 AI 연결은 항상 1개만 사용합니다.
- 설정된 backend와 model만 사용합니다.
- 자연어 해석, 실행 대화, completion review는 모두 여기서 연결한 AI를 사용합니다.

### 2. 외부 기능 연결 `(MCP, 구현됨)`

Nobie가 외부 도구와 기능을 확장해서 사용할 수 있도록 MCP 서버를 연결할 수 있습니다.

- stdio 기반 MCP 서버 등록
- 도구 목록 조회
- 필수/선택 서버 구분
- 설정 화면에서 연결 상태 확인

### 3. 작업 능력 확장 `(Skill, 구현됨)`

특정 작업을 더 잘 수행하도록 작업 지침이나 능력 묶음을 붙일 수 있습니다.

- 로컬 Skill 등록
- Skill 활성화/비활성화
- 설명과 출처 표시

### 4. 대화 채널 `(일부 구현됨)`

현재 구현된 채널:

- WebUI 채팅
- Telegram

예정:

- Slack

### 5. 연장 `(Yeonjang, 구현됨)`

MQTT로 연결된 연장을 통해 로컬 장치 작업을 위임할 수 있습니다.

- 연결된 연장 상태 조회
- 연장 ID 기준 실행 대상 식별
- 카메라 캡처
- 명령 실행, 앱 실행, 화면 캡처, 키보드/마우스 제어를 연장 경로로 실행

중요:

- 현재 로컬 장치 제어와 명령 실행은 `Yeonjang` 경로를 사용하도록 제한되어 있습니다.
- 즉, 이 기능들을 실제로 쓰려면 `Yeonjang`이 반드시 실행 중이어야 합니다.
- 현재 이 경로는 `macOS` 기준으로 구현되어 있습니다.

### 6. 로컬 작업 실행 `(구현됨)`

Nobie는 다음과 같은 로컬 작업을 수행할 수 있습니다.

- 파일 읽기/쓰기/검색/수정
- 셸 명령 실행
- 앱 실행
- 화면 캡처
- 마우스/키보드 제어
- 프로세스 조회/종료
- 결과 파일 직접 전달

### 7. 태스크 상태 모니터 `(구현됨)`

Nobie는 요청을 단순 메시지가 아니라 태스크 단위로 추적합니다.

현재 구현된 상태 모니터 기준:

- `Task / Attempt / Recovery Attempt / Delivery` projection
- `요청 / 실행 / 전달 / 완료 확인` 체크리스트 상태
- 승인, 취소, 실패, 전달 실패 구분
- 사용자용 카드와 내부 디버그용 시도 분리
- `/api/tasks` 기반 task snapshot과 WebUI 상태 모니터

### 8. 스케줄 `(구현됨)`

예약 등록과 예약 실행은 분리된 태스크와 run으로 관리됩니다.

- one-time schedule
- recurring schedule
- schedule lifecycle event
- `scheduleId`, `scheduleRunId`, `originRunId`, `originRequestGroupId` lineage 유지

## 내부 동작 구조

현재 Nobie의 확정 프로세스는 다음 계층으로 나뉩니다.

1. `Ingress`
2. `Intake`
3. `Execution`
4. `Recovery`
5. `Delivery`
6. `Completion / Review`

핵심 원칙:

- 실행 성공과 완료 성공은 다릅니다.
- 완료는 최소한 `해석 / 실행 / 전달 / 복구 종료` 4축을 만족해야 합니다.
- 현재 완료 판정과 상태 모니터는 체크리스트 기준으로 맞춰져 있습니다.
- 자동 재시도 한도는 설정의 `orchestration.maxDelegationTurns`를 따릅니다.

## 설정 경험

현재 WebUI 설정 흐름은 다음 순서를 기준으로 구성되어 있습니다.

1. 개인 정보 입력
2. AI 연동
3. 외부 기능 연결 `(MCP)`
4. 작업 능력 확장 `(Skill)`
5. 대화 채널 `(Communication)`
6. 검토 및 완료

현재 UX 기준:

- 설정 화면은 `AI 하나 연결`만 이해하면 끝나도록 단순화하는 방향입니다.
- 예전의 provider 우선순위, 다중 AI 비교, AI 순서 조정 화면은 기본 흐름에서 숨기고 있습니다.
- 태스크 모니터는 `AI 여러 개`가 아니라 `AI 하나 + root/sub-task 여러 개` 구조를 보여줍니다.

현재 상태:

- `구현됨`: 설정 화면, 상태 확인, 연결 테스트, MQTT/연장 상태 패널
- `예정`: 더 강한 비개발자 중심 UX 정리, 더 넓은 환경별 도움말과 자동 진단

## 프로젝트 구성

이 저장소는 대체로 세 부분으로 구성됩니다.

- `packages/core`

  에이전트 실행, 라우팅, 작업 큐, 복구, 전달, 설정 로직, 채널 연동, MCP, 도구 시스템
- `packages/cli`

  daemon 실행과 로컬 명령 진입점
- `packages/webui`

  설정 UI, 채팅 UI, 태스크 상태 모니터, 승인/취소/검토 화면

## 빠른 시작

### 요구 사항

- `macOS` `(현재 공식 지원 운영체제)`
- Node.js `22+`
- `pnpm`
- Rust / Cargo `(Yeonjang을 소스에서 실행할 경우 필요)`

### 설치

```bash
pnpm install
```

### 빌드

```bash
pnpm build
```

### 로컬 실행

```bash
bash scripts/start-local.sh
```

실행 후 기본 주소:

- Gateway: `http://127.0.0.1:18888`
- WebUI: `http://127.0.0.1:5173`

중지:

```bash
bash scripts/stop-local.sh
```

### Yeonjang 연장 실행 `(필수)`

Nobie 자체를 켜는 것만으로는 로컬 제어 기능이 완성되지 않습니다. 현재 기준으로 다음 기능은 `Yeonjang`이 반드시 실행 중이어야 합니다.

- 명령 실행
- 앱 실행
- 화면 캡처
- 카메라 캡처
- 키보드 입력 / 단축키 / 키 이벤트
- 마우스 이동 / 클릭 / 스크롤 / 버튼 이벤트

일반적인 실행 순서:

1. Nobie Gateway와 WebUI를 실행합니다.

```bash
bash scripts/start-local.sh
```

2. 다른 터미널에서 Yeonjang GUI를 실행합니다.

```bash
cargo run --manifest-path Yeonjang/Cargo.toml
```

macOS에서 카메라 캡처까지 쓰려면 앱 번들 helper가 함께 필요하므로, 일반 `cargo run`보다 아래 경로를 권장합니다.

```bash
bash scripts/start-yeonjang-macos.sh
```

3. Yeonjang 설정에서 기본 브로커 값을 확인합니다.

- Host: `127.0.0.1`
- Port: `1883`
- Node ID 기본값: `yeonjang-main`

4. Yeonjang GUI에서 MQTT 연결을 활성화합니다.

기본값 기준으로는 자동 연결이 켜져 있으며, 연결이 성공하면 Nobie가 연장을 감지할 수 있습니다.

5. Nobie 설정 화면이나 상태 패널에서 연장 연결 상태를 확인합니다.

정상 연결 전에는 Nobie의 로컬 제어 기능이 성공하지 않습니다. 현재 구조에서는 `Yeonjang`이 꺼져 있으면 해당 작업은 실패로 처리됩니다.

참고:

- `cargo run --manifest-path Yeonjang/Cargo.toml -- --stdio`는 노드 단독 테스트용입니다.
- 일반적인 Nobie 사용에서는 MQTT로 연결된 Yeonjang GUI/runtime를 실행하는 경로를 기준으로 봐야 합니다.
- macOS `camera.capture`는 `Yeonjang.app` 내부의 고정 helper executable을 사용하므로, 카메라 캡처가 필요하면 `scripts/start-yeonjang-macos.sh` 경로가 가장 안전합니다.

## 상태 디렉터리와 설정 파일

기본 상태 디렉터리는 다음 우선순위를 따릅니다.

- `NOBIE_STATE_DIR`
- 기본값 `~/.nobie`

여기에 다음 정보가 저장됩니다.

- 설정 파일
- setup 상태
- 로컬 DB
- 인증 토큰과 실행 상태
- 스크린샷/연장 아티팩트 같은 로컬 결과물 일부

## 예정

아래 항목은 아직 `미구현` 또는 `부분 구현`이며, 예정으로 봐야 합니다.

- Slack 채널 정식 연동
- Windows 전용 설치/운영 경험 보강 `(현재 미지원)`
- macOS 이외 환경에서의 UI 자동화 검증 확대 `(현재 미지원)`
- 설정 UX 추가 단순화와 더 강한 온보딩
- 일부 운영 문서와 사용자 도움말 확장

## 한 줄 정의

`Sponzey Nobie`는 사용자의 컴퓨터 위에서 동작하며, 설정된 AI와 연결된 도구를 사용해 요청을 이해하고, 실행 경로를 선택하고, 실제 작업과 전달, 완료 판정까지 이어서 처리하는 오케스트레이션 중심 개인 AI 플랫폼입니다.
