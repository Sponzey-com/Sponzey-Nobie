# 스폰지 노비 · Sponzey Nobie

[한국어](./README.md) | [English](./README.en.md)

<p align="center">
  <img src="./resource/nobie-1-512.png" alt="Nobie" width="220" />
</p>

`Sponzey Nobie`는 설치 후 빠르게 설정하고 바로 사용할 수 있도록 설계된 오케스트레이션 중심 개인 AI입니다. 제품 안에서 실제로 사용자와 대화하고 작업을 수행하는 이름은 `Nobie`입니다.

`Sponzey Nobie` is an orchestration-first personal AI designed to be configured quickly after installation and used right away. The actual assistant name used inside the product is `Nobie`.

이 프로젝트의 목표는 단순한 채팅 AI가 아니라, 사용자의 요청을 이해하고, 적절한 실행 경로를 선택하고, 실제 로컬 작업과 외부 연결까지 이어서 처리하는 개인 작업 허브를 만드는 것입니다.

The goal of this project is not just to provide a chat AI, but to build a personal work hub that understands requests, selects the right execution path, and continues through real local work and external integrations.

## 제품 해석 · Product Interpretation

Nobie는 다음과 같이 이해하면 됩니다.

Nobie is best understood in the following way.

- `개인 비서형 AI` / `Personal assistant AI`: 사용자의 컴퓨터와 작업 환경을 기준으로 동작합니다. / It works in the context of the user's computer and working environment.
- `오케스트레이션 우선 AI` / `Orchestration-first AI`: 답변만 하는 것이 아니라, 어떤 작업을 어떤 방식으로 수행할지 판단하고 실행 흐름을 조율합니다. / It does not just answer; it decides how work should be performed and coordinates the execution flow.
- `설치 후 바로 쓰는 도구` / `Ready after install`: 컴퓨터에 익숙하지 않은 사용자도 WebUI에서 순서대로 설정하고 사용할 수 있도록 계속 적용 중입니다. / It is being shaped so even non-technical users can configure it step by step in the WebUI and start using it quickly.
- `확장 가능한 작업 플랫폼` / `Extensible work platform`: AI 연결, 외부 기능 연결 `(MCP)`, 작업 능력 확장 `(Skill)`, 대화 채널 `(Communication)`을 순차적으로 적용 중입니다. / AI backends, external tools `(MCP)`, task capabilities `(Skill)`, and communication channels are being added in stages.

## 누구를 위한 제품인가 · Who It Is For

Sponzey Nobie의 핵심 타겟은 다음과 같습니다.

The core target audience for Sponzey Nobie is:

- 컴퓨터 사용이 익숙하지 않은 사용자 / Users who are not comfortable with computers
- AI, MCP, Skill, 채널 연동 같은 용어가 낯선 사용자 / Users unfamiliar with terms like AI, MCP, Skill, or channel integration
- 복잡한 개발자 설정 없이 바로 쓸 수 있는 개인 비서를 원하는 사용자 / Users who want a personal assistant they can use without complex developer setup

그래서 UI와 문서는 아래 원칙을 따릅니다.

That is why the UI and documentation follow these principles.

- 쉬운 한국어를 먼저 보여줍니다. / Show simple, approachable Korean first.
- 원문 용어는 `()` 안에 보조 정보로 붙입니다. / Keep original terms in `()` as supporting labels.
- 필수 설정은 분명하게 표시합니다. / Clearly mark required settings.
- 저장, 취소, 건너뛰기, 다음 같은 행동은 단순하고 확실해야 합니다. / Actions such as Save, Cancel, Skip, and Next must stay simple and obvious.

## 핵심 기능 · Core Features

### 1. AI 연결 `(AI Backend)` / AI Backends

Nobie가 실제로 응답하고 작업을 수행하도록 AI를 연결합니다.

Connect the AI models that Nobie uses to respond and perform tasks.

- OpenAI
- Claude
- Gemini
- Ollama
- OpenAI-compatible endpoint
- 로컬/원격 추론 서버 / Local or remote inference server

### 2. 외부 기능 연결 `(MCP)` / External Tools `(MCP)`

Nobie가 외부 도구와 기능을 확장해서 사용할 수 있도록 MCP 서버를 연결합니다.

Connect MCP servers so Nobie can extend its capabilities with external tools and services.

- stdio 기반 MCP 서버 등록 / Register stdio-based MCP servers
- 도구 목록 조회 / Inspect available tools
- 필수/선택 서버 구분 / Distinguish required and optional servers
- 설정 화면에서 연결 상태 확인 / Check connection state in Settings

### 3. 작업 능력 확장 `(Skill)` / Skills

특정 작업을 더 잘 수행하도록 작업 지침이나 능력 묶음을 붙입니다.

Attach instruction bundles and capabilities that help Nobie perform specific kinds of work better.

- 로컬 Skill 등록 / Register local skills
- Skill 활성화/비활성화 / Enable or disable skills
- 설명과 출처 표시 / Show description and source

### 4. 대화 채널 `(Communication)` / Communication Channels

Nobie와 대화할 채널을 연결합니다.

Connect the channels used to talk with Nobie.

- WebUI 채팅 / WebUI chat
- Telegram
- Slack 적용 예정 / Slack planned

### 5. 로컬 작업 실행 / Local Work Execution

Nobie는 로컬 컴퓨터에서 다음과 같은 작업을 수행할 수 있습니다.

Nobie can perform the following tasks on the local computer.

- 파일 읽기/쓰기/검색/수정 / Read, write, search, and modify files
- 셸 명령 실행 / Execute shell commands
- 앱 실행 / Launch apps
- 화면 캡처 / Capture the screen
- 마우스/키보드 제어 / Control mouse and keyboard
- 작업 큐, 승인, 취소, 검증 흐름 관리 / Manage work queues, approvals, cancellations, and verification flows

## 설정 경험의 방향 · Setup Experience Direction

Sponzey Nobie의 설정 화면은 `1920 x 1080` 기준으로 계속 정리하고 있는 적용 예정/적용 중 설계입니다.

The Sponzey Nobie setup experience is being organized around a `1920 x 1080` layout and is still being refined and applied.

기본 원칙은 다음과 같습니다.

The main principles are:

- 한 단계는 한 화면 안에서 이해 가능해야 합니다. / Each step should be understandable within one screen.
- 긴 스크롤에 의존하지 않습니다. / It should not depend on long scrolling.
- 고급 옵션은 접기 영역으로 분리합니다. / Advanced options should be separated into collapsible sections.
- 좌측은 단계 목록, 중앙은 현재 입력, 우측 또는 하단은 도움말과 상태를 보여줍니다. / The left side shows steps, the center shows current input, and the right or bottom shows help and status.
- 하단 액션 영역은 항상 명확하게 보이도록 유지합니다. / The bottom action area should remain clearly visible.

설정 순서는 다음과 같습니다.

The setup order is:

1. 개인 정보 입력 / Personal information
2. AI 연동 / AI connection
3. 외부 기능 연결 `(MCP)` / External tools `(MCP)`
4. 작업 능력 확장 `(Skill)` / Skills
5. 대화 채널 `(Communication)` / Communication
6. 검토 및 완료 / Review and finish

## 내부 동작 구조 · Internal Architecture

Sponzey Nobie는 하나의 요청을 단순한 메시지로만 처리하지 않습니다.

Sponzey Nobie does not treat a request as just a single message.

현재 적용 중인 구조의 핵심 방향은 다음과 같습니다.

The current architectural direction is:

- `A = 검토 AI` / `A = Review AI`
- `B-n = 작업 AI 또는 작업 세션` / `B-n = Worker AI or worker session`

역할 분리는 다음과 같습니다.

The role split is:

- `A`는 요청을 읽고, 무엇을 해야 하는지 정리하고, 어떤 실행 대상을 선택할지 판단하도록 적용 중입니다. / `A` is being shaped to review requests, identify what must be done, and decide which execution target should handle the work.
- `B-n`은 실제 파일 생성, 실행, 검증, 도구 사용을 담당하는 방향으로 적용 중입니다. / `B-n` is being shaped to handle actual file creation, execution, verification, and tool use.
- 사용자가 보는 작업 큐는 `요청 하나 = 카드 하나`를 기준으로 유지하고, 그 안에 하위 작업이 트리처럼 붙도록 계속 정리 중입니다. / The user-facing work queue is being organized around `one request = one card`, with child tasks attached as a tree.

이 구조의 목적은 다음과 같습니다.

The purpose of this structure is:

- 같은 채팅창에서 여러 요청이 들어와도 내용이 섞이지 않게 하기 / Prevent multiple requests in the same chat from mixing together
- 승인, 취소, 재질의, 검증 상태를 요청 단위로 추적하기 / Track approval, cancellation, follow-up, and verification by request
- 루트 요청과 하위 작업을 명확히 구분해서 보여주기 / Clearly separate root requests from child tasks

## 프로젝트 구성 · Project Layout

이 저장소는 대체로 세 부분으로 구성됩니다.

This repository is mainly split into three parts.

- `packages/core`
  - 에이전트 실행, 라우팅, 작업 큐, 검증, 설정 로직, 채널 연동, MCP, 도구 시스템
  - Agent execution, routing, work queue, verification, setup logic, channel integration, MCP, and tool system
- `packages/cli`
  - daemon 실행과 로컬 명령 진입점
  - Daemon execution and local command entry points
- `packages/webui`
  - 설정 UI, 채팅 UI, 작업 큐, 승인/취소/검토 화면
  - Setup UI, chat UI, work queue, and approval/cancel/review screens

## 빠른 시작 · Quick Start

### 요구 사항 · Requirements

- Node.js `22+`
- `pnpm`

### 설치 · Install

```bash
pnpm install
```

### 빌드 · Build

```bash
pnpm build
```

### 로컬 실행 · Run Locally

```bash
bash scripts/start-local.sh
```

실행 후 기본 주소 / Default addresses after startup:

- Gateway: `http://127.0.0.1:18888`
- WebUI: `http://127.0.0.1:5173`

중지 / Stop:

```bash
bash scripts/stop-local.sh
```

## 상태 디렉터리와 설정 파일 · State Directory and Config Files

기본 상태 디렉터리는 다음 우선순위를 따릅니다.

The default state directory follows this priority.

- `NOBIE_STATE_DIR`
- 기본값 `~/.nobie` / default `~/.nobie`

여기에 다음 정보가 저장됩니다.

The following information is stored there.

- 설정 파일 / Config files
- setup 상태 / Setup state
- 로컬 DB / Local database
- 인증 토큰과 실행 상태 / Auth tokens and runtime state

## 현재 범위와 주의 사항 · Current Scope and Notes

현재 코드 기준으로 이해해야 할 점은 다음과 같습니다.

The following points describe the current state of the codebase.

- WebUI 기반 설정과 작업 큐 구조가 중심으로 적용되어 있습니다. / The WebUI-based setup flow and work queue structure are the main focus right now.
- MCP client는 stdio 기반 서버 연결까지 적용되어 있고, 운영 경험은 계속 보완 중입니다. / The MCP client currently supports stdio-based servers, and the operational experience is still being improved.
- Telegram 채널은 연동되어 있습니다. / Telegram is integrated.
- Slack은 아직 적용 예정입니다. / Slack is still planned.
- 일부 로컬 UI 자동화와 운영 흐름은 macOS 기준으로 더 많이 검증되어 있고, 다른 환경 지원은 적용 예정이 남아 있습니다. / Some local UI automation and operational flows are more validated on macOS, while support for other environments is still planned.
- Windows는 일부 코드 경로만 있고, 정식 설치 지원은 아직 적용 예정입니다. / Windows has partial code paths, but full installation support is still planned.

즉, Sponzey Nobie는 이미 동작하는 기능이 많지만, `작업 분리 아키텍처`, `검증`, `재시작 복구`, `운영 경험`은 계속 적용 중인 프로젝트입니다.

In short, Sponzey Nobie already has many working features, but the `task separation architecture`, `verification`, `restart recovery`, and overall `operational experience` are still being actively improved.

## 한 줄 정의 · One-line Definition

`Sponzey Nobie`는 사용자의 컴퓨터 위에서 동작하며, 요청을 이해하고, 적절한 실행 대상을 선택하고, 실제 작업과 검증까지 이어서 처리하는 오케스트레이션 중심 개인 AI 플랫폼입니다.

`Sponzey Nobie` is an orchestration-first personal AI platform that runs on the user's computer, understands requests, chooses the right execution target, and continues through real work and verification.
