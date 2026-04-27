# 스폰지 노비 · Sponzey Nobie

[English](./README.md) | [한국어](./README.ko.md)

<p align="center">
  <img src="./resource/nobie-1-512.png" alt="Nobie" width="220" />
</p>

Sponzey Nobie는 사용자의 컴퓨터 위에서 동작하는 로컬 우선 개인 AI 비서입니다. 제품 안에서 실제 사용자와 대화하고 작업을 맡는 이름은 `Nobie`입니다.

Nobie는 단순히 답변만 하는 채팅 봇이 아니라, 요청을 접수하고, 의도를 해석하고, 실행 경로를 고르고, 로컬 도구와 외부 연결을 사용하고, 진행 상태를 추적하고, 결과를 전달한 뒤, 일이 실제로 끝났는지까지 판단하는 작업 조율 시스템을 목표로 합니다.

## 현재 방향

`.tasks/phase001`부터 `.tasks/phase016`까지의 작업은 Nobie를 태스크 중심 오케스트레이션 제품으로 정리하는 흐름이었습니다.

- WebUI에서 초기 설정과 온보딩을 처리합니다.
- 설정된 단일 AI 연결을 해석과 실행의 중심으로 사용합니다.
- MCP 서버, Skill, Telegram, Slack, Yeonjang을 기능 확장으로 연결합니다.
- 사용자 요청을 run, task card, attempt, delivery, completion review로 추적합니다.
- 프롬프트는 `prompts/` 아래 역할별 source file로 분리합니다.
- 메모리, 검색 근거, 진단 정보, 작업 이력은 목적별로 분리해 저장합니다.
- 예약, 전달 receipt, audit event, rollback evidence는 구조화된 기록으로 다룹니다.
- 설정과 토폴로지 화면은 연결 상태를 시각적으로 확인할 수 있도록 구성합니다.
- 서브 에이전트와 팀은 명시적인 계약, hierarchy, 권한, 메모리 scope, 위임 session으로 표현합니다.

현재 제품은 `Nobie + 로컬 Gateway + WebUI + 선택 채널 + 선택 Yeonjang 연장 + 선택 서브 에이전트/팀 오케스트레이션` 구조로 이해하면 됩니다.

## Nobie가 하는 일

### WebUI와 설정

- 초기 설정 흐름 안내
- 하나의 활성 AI backend 설정
- MCP 서버와 Skill 등록
- 대화 채널 설정
- 런타임 상태, 진단, 고급 설정 확인
- 설정, 기능, 토폴로지 상태 시각화

### AI와 프롬프트 런타임

- OpenAI, Anthropic, Gemini, Ollama, OpenAI-compatible endpoint, 로컬/원격 추론 서버 사용
- 하나의 거대한 프롬프트가 아니라 역할별 프롬프트 source 조립
- run마다 prompt source id, version, checksum 증거 저장
- 기본 응답 언어는 사용자의 언어를 따름

### 태스크 실행

- WebUI와 지원 채널에서 요청 수신
- 구조화된 run과 task card 생성
- intake, execution, recovery, delivery, completion review 분리
- 진행 상태, 실패, 복구 시도, 최종 상태 표시
- message ledger와 delivery receipt로 중복 최종 전달 방지

### Yeonjang을 통한 로컬 제어

Yeonjang은 Nobie가 사용자의 기기, 화면, 키보드, 마우스, 카메라, 로컬 명령 실행 표면에 접근할 수 있게 하는 연장입니다.

현재 아래 기능은 Yeonjang 실행이 필요합니다.

- 셸 명령 실행
- 앱 실행
- 화면/카메라 캡처
- 키보드 입력과 단축키
- 마우스 이동, 클릭, 스크롤, 버튼 동작

가장 많이 검증된 운영체제는 `macOS`입니다. Windows와 Linux 경로도 기능별로 존재하지만, 환경별 검증과 운영 보강이 더 필요합니다.

### 채널

- WebUI 채팅을 사용할 수 있습니다.
- Telegram 연동이 구현되어 있습니다.
- Slack 연동은 구현 작업이 들어가 있으며, 전달, 승인, smoke 검증 쪽 안정화를 계속 진행 중입니다.

### 예약과 웹 검색

- 일회성/반복 예약은 일반 사용자 run과 분리해 관리합니다.
- 예약의 동일성, payload, 전달, migration은 자연어 비교가 아니라 구조화된 key로 판단합니다.
- 웹 검색은 source 후보, 근거, 검증, cache, degraded mode, 엄격한 완료 판정을 사용합니다.
- vector 검색은 후보 제공자일 뿐 최종 판단자가 아닙니다.

### 서브 에이전트와 팀

서브 에이전트는 숨은 별도 봇이 아니라 명시적인 계약과 실행 단위로 다룹니다.

- `Nobie`는 고정된 최상위 조정자입니다.
- 서브 에이전트는 고유 nickname, 역할, 모델/기능 요약, 권한, 메모리 scope를 가집니다.
- hierarchy는 트리 구조이며, 에이전트는 직속 하위 에이전트에게만 위임할 수 있습니다.
- 팀은 독립 실행자가 아니라 특정 상위 에이전트가 소유한 planning group입니다.
- 팀원은 owner의 직속 하위 에이전트에서 구성합니다.
- 위임은 sub-session, data exchange package, result report, review verdict, monitoring event를 만듭니다.
- 사용자가 시작한 요청의 최종 응답은 Nobie가 책임집니다.

## 프로젝트 구성

- `packages/core`
  - gateway, 계약, 오케스트레이션, run, 메모리, 예약, 채널, API, 도구, MCP, release 로직
- `packages/cli`
  - daemon 실행과 로컬 명령 진입점
- `packages/webui`
  - 설정, 실행 현황, 토폴로지, 태스크 카드, 진단 UI
- `prompts`
  - 런타임 프롬프트 조립에 쓰는 prompt source 파일
- `Yeonjang`
  - 로컬 기기 제어용 연장 런타임
- `.tasks`
  - phase별 계획과 구현 기록
- `docs`
  - 운영 runbook과 release 문서

## 빠른 시작

### 요구 사항

- 현재 주 지원 환경은 macOS입니다.
- Node.js `22+`
- `pnpm`
- Yeonjang을 소스에서 실행하려면 Rust / Cargo

### 설치와 빌드

```bash
pnpm install
pnpm build
```

### 로컬 실행

```bash
bash scripts/start-local.sh
```

기본 로컬 주소:

- Gateway: `http://127.0.0.1:18888`
- WebUI: `http://127.0.0.1:5173`

자주 쓰는 로컬 스크립트:

```bash
bash scripts/status-local.sh
bash scripts/restart-local.sh
bash scripts/stop-local.sh
```

### Yeonjang 실행

macOS에서 일반적인 로컬 제어를 사용할 때:

```bash
bash scripts/start-yeonjang-macos.sh
```

소스 기준 개발 실행:

```bash
cargo run --manifest-path Yeonjang/Cargo.toml
```

Yeonjang의 기본 MQTT 연결값:

- Host: `127.0.0.1`
- Port: `1883`
- Node ID: `yeonjang-main`

## 검증

일반 검증:

```bash
pnpm test
pnpm typecheck
pnpm build
```

릴리즈 패키징:

```bash
pnpm run release:dry-run
pnpm run release:package
```

릴리즈와 롤백 운영은 [docs/release-runbook.md](./docs/release-runbook.md)를 기준으로 합니다.

## 설계 원칙

- 첫 설정은 비개발자도 이해할 수 있어야 합니다.
- 기본 UI에서는 하나의 명확한 AI 연결을 우선합니다.
- 고급 진단은 제공하되 기본 흐름을 무겁게 만들지 않습니다.
- 실행 성공과 완료 성공을 구분합니다.
- 중요한 판단은 구조화된 계약, receipt, event로 남깁니다.
- secret, private memory, 내부 ID는 일반 사용자 화면에 불필요하게 노출하지 않습니다.
- 서브 에이전트 위임은 보이게 만들되, 내부 구현 세부사항은 과하게 노출하지 않습니다.
