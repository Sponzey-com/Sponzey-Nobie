# 스폰지 노비 · Sponzey Nobie

[English](./README.md) | [한국어](./README.ko.md)

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
- `예정`: Slack 채널 안정화, Windows/Linux 설치/운영 경험 보강, 더 넓은 환경 검증, 설정 UX 추가 단순화

중요:

- Nobie가 자연어 해석, 요청 구조화, completion review에 사용하는 것은 `설정 창에서 연결한 AI`입니다.
- 별도의 숨은 외부 LLM 행위자를 두지 않습니다.
- 내부 `packages/core/src/ai`는 설정된 AI backend를 호출하는 adapter 계층입니다.
- 현재 공식 지원 운영체제는 `macOS`입니다. `Yeonjang`의 Windows/Linux 경로는 부분 구현되어 있지만, 아직 환경별 검증과 운영 보강이 필요합니다.
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
- 현재 이 경로는 `macOS` 기준으로 가장 많이 검증되어 있습니다. Windows/Linux는 기능별로 구현이 들어가 있으며, 설치된 OS 도구와 권한 상태에 따라 capability가 달라집니다.

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
- run detail에서 prompt source, memory/vector trace, recovery key, tool receipt, delivery receipt를 운영 진단으로 확인

### 8. 스케줄 `(구현됨)`

예약 등록과 예약 실행은 분리된 태스크와 run으로 관리됩니다.

- one-time schedule
- recurring schedule
- schedule lifecycle event
- `scheduleId`, `scheduleRunId`, `originRunId`, `originRequestGroupId` lineage 유지
- WebUI의 예약 작업 화면에서 schedule list, scheduler 상태, 최근 schedule run 이력을 일반 실행 현황과 분리해 표시

운영 원칙:

- 예약의 최종 동일성, 중복 여부, 실행 payload는 문자열 또는 시멘틱 문자열 비교로 확정하지 않습니다.
- `ScheduleContract`, `identity_key`, `payload_hash`, `delivery_key` 같은 구조화된 key를 우선 사용합니다.
- Vector DB와 메모리 검색은 후보를 찾는 보조 provider일 뿐, 최종 판단자는 아닙니다.
- 오래된 legacy schedule은 자동 변환하지 않고 WebUI에서 `dry-run -> 명시 변환` 순서로 처리합니다.
- migration 실패는 schedule을 삭제하거나 daemon을 중단하지 않고, legacy 상태와 audit 기록으로 남깁니다.
- schedule contract migration, delivery receipt, rollback 판단은 운영자가 API/WebUI에서 확인 가능한 기록을 남겨야 합니다.
- 빠른 응답 원칙에 따라 migration UI와 dry-run은 일반 사용자 요청 처리 경로를 무겁게 만들지 않아야 합니다.
- 장애나 provider 실패는 raw stack trace, HTML 오류, 토큰, 내부 payload를 그대로 사용자에게 보여주지 않고 normalized failure로 안내합니다.

### 9. 프롬프트와 메모리 진단 `(구현됨)`

Nobie는 단일 시스템 프롬프트에 모든 규칙을 누적하지 않고, `prompts/` 아래의 역할별 prompt source를 조립합니다.

- `identity`, `user`, `definitions`, `soul`, `planner`
- `channel`, `tool_policy`, `memory_policy`, `recovery_policy`, `completion_policy`, `output_policy`
- run마다 prompt source id, version, checksum snapshot을 남김

메모리는 목적별 scope로 분리합니다.

- `short-term`, `long-term`, `task`, `schedule`, `flash-feedback`, `artifact`, `diagnostic`
- 벡터 검색은 선택 기능이며, embedding provider가 없거나 실패하면 FTS 검색으로 폴백
- Settings의 고급 화면에서 memory search mode, vector backend, scheduler 상태를 확인

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

### 릴리즈 패키지와 롤백 기준

배포 전에는 개발 서버 실행 여부만 확인하지 않고, git tag 기반 버전, Gateway/CLI bundle, WebUI static build, DB migration, prompt seed, Yeonjang protocol, channel smoke를 함께 확인합니다.

```bash
pnpm run release:dry-run
pnpm run release:package
```

- 표시 버전은 기본적으로 `git describe --tags --always --dirty` 기준입니다.
- release 산출물은 `manifest.json`과 `SHA256SUMS`를 생성합니다.
- update 전에는 DB/prompt backup snapshot과 restore rehearsal을 먼저 통과해야 합니다.
- rollback은 binary, DB, prompt registry, config, Yeonjang protocol을 함께 되돌리는 절차로 처리합니다.
- 상세 절차는 `docs/release-runbook.md`를 기준으로 합니다.

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

## Telegram / Slack 연결 상세 가이드

이 섹션은 `Bot Token`, `App Token`, `사용자 ID`, `채팅방/채널 ID` 같은 연결 정보를 실제로 어떻게 구하는지 단계별로 설명합니다.

중요:

- 텔레그램과 슬랙 토큰은 비밀번호처럼 취급해야 합니다.
- 토큰과 사용자 ID, 채널 ID는 `README` 예시처럼 직접 입력해도 되지만, 실사용 값은 Git에 커밋하면 안 됩니다.
- Nobie가 이미 실행 중인 상태에서 같은 Telegram Bot Token으로 `getUpdates`를 직접 호출하면 `409 Conflict`가 날 수 있습니다. 이 경우에는 Nobie를 잠시 멈추고 확인하는 것이 안전합니다.

### Telegram 연결 절차

#### 1. Telegram Bot 생성

1. Telegram에서 `@BotFather`를 엽니다.
2. `/newbot`을 보냅니다.
3. 봇 이름과 봇 사용자명(username)을 입력합니다.
4. BotFather가 발급한 `Bot Token`을 복사합니다.

예시:

- `1234567890:AA...`

이 값이 Nobie 설정 화면의 `Telegram Bot Token`입니다.

#### 2. 봇과 1:1 대화 시작

1. 방금 만든 봇을 Telegram에서 검색합니다.
2. 봇과의 대화창을 엽니다.
3. `/start`를 한 번 보냅니다.

이 단계가 필요한 이유:

- Telegram은 사용자가 먼저 말을 걸지 않은 봇에게는 메시지를 보내기 어렵습니다.
- `getUpdates`로 사용자 ID를 확인하려면 먼저 봇과 실제 대화가 한 번 생겨야 합니다.

#### 3. Telegram 사용자 ID 얻기

가장 직접적인 방법은 `getUpdates`입니다.

1. Nobie가 같은 Bot Token으로 실행 중이면 잠시 중지합니다.
2. 브라우저나 터미널에서 아래 주소를 호출합니다.

```bash
curl -s "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates"
```

3. 응답 JSON에서 다음 위치를 찾습니다.

- `result[].message.from.id`

이 값이 `allowedUserIds`에 넣을 Telegram 사용자 ID입니다.

예시:

```json
{
  "message": {
    "from": {
      "id": 42120565
    }
  }
}
```

위 예시에서 사용자 ID는 `42120565`입니다.

#### 4. Telegram 그룹 / 채팅방 ID 얻기

1. 봇을 대상 그룹에 초대합니다.
2. 그룹에서 아무 메시지나 하나 보냅니다.
3. 다시 아래를 호출합니다.

```bash
curl -s "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates"
```

4. 응답 JSON에서 다음 위치를 찾습니다.

- `result[].message.chat.id`

이 값이 그룹 또는 채팅방 ID입니다.

예시:

```json
{
  "message": {
    "chat": {
      "id": -1001234567890,
      "title": "팀 운영방"
    }
  }
}
```

위 예시에서 채팅방 ID는 `-1001234567890`입니다.

참고:

- 개인 대화는 보통 양수 ID입니다.
- 그룹 / 슈퍼그룹은 보통 음수 ID입니다.
- 슈퍼그룹은 `-100...` 형태인 경우가 많습니다.

#### 5. Telegram 그룹에서 봇이 반응하지 않을 때 확인할 것

1. `@BotFather`에서 `/setprivacy`를 사용해 대상 봇의 privacy mode를 확인합니다.
2. 그룹의 일반 메시지까지 읽어야 하면 privacy mode를 꺼야 할 수 있습니다.
3. Nobie 설정의 `allowedUserIds`, `allowedGroupIds`가 실제 값과 일치하는지 확인합니다.
4. 같은 Bot Token을 쓰는 다른 프로세스가 없는지 확인합니다.

특히 다음 오류가 나오면 거의 항상 중복 실행 문제입니다.

- `409: Conflict: terminated by other getUpdates request`

이 경우:

1. Nobie daemon을 중지합니다.
2. 다른 Telegram bot 프로세스가 있으면 정리합니다.
3. Nobie를 다시 시작합니다.

### Slack 연결 절차

Slack은 Telegram보다 준비 단계가 더 많습니다. Nobie의 Slack 연결은 `Bot Token + App Token + Socket Mode + Event Subscriptions + Interactivity`가 함께 맞아야 합니다.

#### 1. Slack 앱 생성

1. 브라우저에서 `https://api.slack.com/apps`를 엽니다.
2. `Create New App`을 누릅니다.
3. `From scratch`를 선택합니다.
4. 앱 이름과 워크스페이스를 선택합니다.

#### 2. Bot Token 발급

1. Slack 앱 설정에서 `OAuth & Permissions`로 이동합니다.
2. Bot Token Scopes를 추가합니다.

최소 권장 범위:

- `app_mentions:read`
- `chat:write`
- `files:write`
- `channels:history`
- `groups:history`
- `im:history`
- `mpim:history`

3. `Install to Workspace` 또는 `Reinstall to Workspace`를 실행합니다.
4. 설치 후 발급되는 `Bot User OAuth Token`을 복사합니다.

예시:

- `xoxb-...`

이 값이 Nobie 설정 화면의 `Slack Bot Token`입니다.

#### 3. App Token 발급

1. Slack 앱 설정에서 `Basic Information`으로 이동합니다.
2. `App-Level Tokens` 섹션에서 새 토큰을 생성합니다.
3. Scope는 최소 `connections:write`를 포함해야 합니다.
4. 발급된 App Token을 복사합니다.

예시:

- `xapp-...`

이 값이 Nobie 설정 화면의 `Slack App Token`입니다.

#### 4. Socket Mode 활성화

1. Slack 앱 설정에서 `Socket Mode`로 이동합니다.
2. `Enable Socket Mode`를 켭니다.
3. 앞에서 만든 `xapp-...` 토큰이 Socket Mode용인지 확인합니다.

이 단계가 빠지면 Nobie가 Slack 이벤트를 실시간으로 받지 못합니다.

#### 5. Event Subscriptions 활성화

1. Slack 앱 설정에서 `Event Subscriptions`로 이동합니다.
2. `Enable Events`를 켭니다.
3. Bot Events에 아래 항목을 추가합니다.

권장 항목:

- `app_mention`
- `message.im`

필요에 따라:

- `message.channels`
- `message.groups`
- `message.mpim`

설명:

- `app_mention`: 채널에서 `@봇이름`으로 부른 메시지를 받기 위해 필요
- `message.im`: DM(1:1) 메시지를 받기 위해 필요
- `message.channels` / `message.groups`: 공개/비공개 채널 일반 메시지를 직접 읽어야 할 때 필요

채널에서 `@Nobie 안녕`처럼 말하는 방식으로 쓸 예정이면 최소 `app_mention`은 반드시 있어야 합니다.

#### 6. Interactivity 활성화 `(버튼 승인용)`

Slack에서 승인/거부 버튼을 누르게 하려면 `Interactivity`도 켜야 합니다.

1. Slack 앱 설정에서 `Interactivity & Shortcuts`로 이동합니다.
2. `Interactivity`를 켭니다.

주의:

- Socket Mode 기반 앱에서는 버튼 클릭 이벤트도 Slack 앱 설정에서 허용되어야 합니다.
- 이 설정이 빠지면 Nobie가 승인 버튼을 보내더라도 클릭 이벤트를 처리하지 못합니다.

#### 7. 봇을 실제 채널에 초대

1. Slack에서 Nobie를 쓸 채널을 엽니다.
2. 채널 입력창에 아래처럼 입력합니다.

```text
/invite @봇이름
```

3. 봇이 채널에 들어왔는지 확인합니다.

이 단계가 빠지면 채널에 메시지를 보내도 Nobie가 반응하지 않을 수 있습니다.

#### 8. Slack 사용자 ID 얻기

방법 A. 프로필 화면에서 얻기

1. Slack에서 본인 프로필을 엽니다.
2. `More` 또는 `...` 메뉴를 엽니다.
3. `Copy member ID`를 누릅니다.

예시:

- `U0AR31K88Q3`

이 값이 Nobie 설정의 `slackAllowedUserIds`에 들어가는 사용자 ID입니다.

방법 B. 메시지 링크 / 개발자 도구를 통한 확인

- Slack URL이나 개발자 도구에서도 확인할 수 있지만, 가장 쉬운 방법은 `Copy member ID`입니다.

#### 9. Slack 채널 ID 얻기

방법 A. 채널 URL에서 얻기

1. 대상 채널을 엽니다.
2. 브라우저 주소창 또는 Slack 링크를 확인합니다.

대개 이런 형태입니다.

```text
https://app.slack.com/client/TWORKSPACE/C0AR3AS899R
```

여기서 마지막 `C0AR3AS899R`가 채널 ID입니다.

방법 B. DM / 그룹 DM 구분

- 공개/비공개 채널: 보통 `C...` 또는 `G...`
- DM: 보통 `D...`

이 값이 Nobie 설정의 `slackAllowedChannelIds`에 들어가는 채널 ID입니다.

#### 10. Slack에서 Nobie가 반응하지 않을 때 확인할 것

아래 순서대로 확인하면 대부분 원인을 찾을 수 있습니다.

1. `Slack Bot Token (xoxb-...)`이 올바른지 확인
2. `Slack App Token (xapp-...)`이 올바른지 확인
3. `Socket Mode`가 켜져 있는지 확인
4. `Event Subscriptions`에 `app_mention`, `message.im`이 들어 있는지 확인
5. `Interactivity`가 켜져 있는지 확인
6. 봇이 대상 채널에 초대되어 있는지 확인
7. `slackAllowedUserIds`, `slackAllowedChannelIds`가 실제 값과 일치하는지 확인
8. Nobie를 재시작한 뒤 다시 테스트

#### 11. Slack 승인 버튼이 보이지 않거나 동작하지 않을 때

버튼형 승인에는 다음 조건이 모두 맞아야 합니다.

1. Slack 연결이 정상이어야 함
2. 승인 요청이 새로 생성되어야 함
3. `Interactivity`가 켜져 있어야 함
4. Nobie가 최신 코드로 재시작되어 있어야 함

참고:

- 예전 승인 메시지는 새 버튼 UI로 자동 갱신되지 않습니다.
- 코드를 바꾼 뒤에는 `새 승인 요청`을 다시 발생시켜야 합니다.

### Nobie 설정에 입력하는 값 정리

Telegram:

- `botToken`: BotFather가 준 Bot Token
- `allowedUserIds`: `getUpdates`의 `message.from.id`
- `allowedGroupIds`: `getUpdates`의 `message.chat.id`

Slack:

- `slackBotToken`: `xoxb-...`
- `slackAppToken`: `xapp-...`
- `slackAllowedUserIds`: Slack `Copy member ID` 결과
- `slackAllowedChannelIds`: 채널 URL 또는 DM/채널 ID

제한 없이 열고 싶을 때:

- Telegram `allowedUserIds`, `allowedGroupIds`
- Slack `slackAllowedUserIds`, `slackAllowedChannelIds`

를 비워 두면 구현상 전체 허용으로 동작할 수 있습니다. 다만 운영 환경에서는 필요한 ID만 명시하는 쪽이 안전합니다.

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
- Windows/Linux 설치/운영 경험 보강 `(부분 구현, 추가 검증 필요)`
- macOS 이외 환경에서의 UI 자동화 검증 확대 `(부분 구현, 추가 검증 필요)`
- 설정 UX 추가 단순화와 더 강한 온보딩
- 일부 운영 문서와 사용자 도움말 확장

## 한 줄 정의

`Sponzey Nobie`는 사용자의 컴퓨터 위에서 동작하며, 설정된 AI와 연결된 도구를 사용해 요청을 이해하고, 실행 경로를 선택하고, 실제 작업과 전달, 완료 판정까지 이어서 처리하는 오케스트레이션 중심 개인 AI 플랫폼입니다.
