# source.md

## 역할

- `channels`는 메시징 채널과 외부 대화 입력 수단을 담는 폴더입니다.

## 현재 중심 구현

- 현재는 Telegram, Slack, Discord, Google Chat, iMessage, KakaoTalk 구현을 공통 채널 계약으로 맞춰가는 단계입니다. iMessage/KakaoTalk은 로컬 앱/Yeonjang bridge 의존성이 있는 local bridge 계층으로 취급합니다.
- 채널 시작 처리와 채널별 응답/승인 흐름을 제공합니다.
- 공통 채널 계약은 `contracts.ts`에 정의합니다. 신규 외부 채널은 provider raw payload를 `InboundEnvelope`/`InteractionEnvelope`로 정규화한 뒤 core 실행 계층으로 넘겨야 하며, raw payload 원문은 `RawPayloadRef`의 redacted preview 또는 외부 저장소 ref로만 표현합니다.
- `contracts.ts`는 외부 provider(`ChannelProvider`)와 내부 surface(`ChannelSurface`: WebUI/CLI)를 분리합니다. 실행/전달 호환 값은 `ChannelSource`를 쓰되, 신규 provider별 분기는 registry/capability 단계에서만 추가해야 합니다.
- `connections.ts`는 Telegram/Slack/Discord/Google Chat/iMessage/KakaoTalk 설정을 공통 `channel_connections` 모델로 투영합니다. token은 raw 값이 아니라 `config:<provider>.<key>` secret ref로만 저장하고, allowed user/room은 `provider:kind:id` namespace 식별자로 저장합니다.
- `registry.ts`와 `runtime.ts`는 provider factory, runtime start/stop, health/capability summary, runtime event 기록을 담당합니다. `channel_registry_runtime` feature flag가 `enforced`일 때만 registry runtime으로 시작하고, 기본값/off/rollback/shadow/dual_write는 기존 Telegram/Slack 직접 runtime 경로를 사용합니다.
- 신규 provider를 붙이기 전에는 `tests/fixtures/channel-adapter-contract-runner.ts`의 contract runner와 provider fixture를 먼저 추가해야 합니다. 이 runner는 `capabilities`, `normalizeInbound`, `normalizeInteraction`, `sendMessage`, `handleInteraction`, raw payload redaction, unsupported capability fallback을 네트워크 없이 검증합니다.
- `telegram/adapter.ts`, `slack/adapter.ts`, `discord/adapter.ts`, `google-chat/adapter.ts`, `local-bridge/adapter.ts`는 provider별 `ChannelAdapter` facade입니다. 각 provider payload를 `InboundEnvelope`/`InteractionEnvelope`로 정규화하고, continuation 후보, connection policy, capability/health manifest, sent 중심 delivery receipt 정책을 제공합니다.
- `delivery-fallback.ts`는 채널별 `maxMessageLength`, 파일/버튼/스레드/typing capability, artifact 민감도에 따라 긴 텍스트 split, summarize-and-link, download link/native file fallback, explicit approval 필요 여부, `unsupported_capability` UI/receipt 메시지를 결정하는 순수 helper입니다. provider 차이는 실행 실패가 아니라 fallback receipt와 ledger/detail evidence로 표현해야 합니다.
- `smoke-runner.ts`는 WebUI/Telegram/Slack 자동 또는 반자동 smoke, Discord/Google Chat fixture smoke, iMessage/KakaoTalk manual local bridge gate를 같은 scenario 모델로 관리합니다. release gate는 long text, artifact, approval, continuation, duplicate delivery, unsupported capability fallback 회귀를 함께 확인해야 합니다.
- 채널 런타임 등록은 실제 polling 시작 완료를 기다리지 않고 먼저 활성 채널로 올려, scheduler 같은 내부 기능이 같은 프로세스 안에서 곧바로 채널을 사용할 수 있게 합니다.
- Telegram 쪽 chunk 텍스트/파일/tool status 전달은 `channels/telegram/chunk-delivery.ts`로 분리해, 채널 엔트리와 실제 전달 경계를 나누기 시작했습니다.
- 같은 방향으로 CLI도 별도 chunk 출력 helper를 쓰기 시작했고, 채널별 전달 책임을 entry 파일 밖으로 빼는 패턴을 맞춰가고 있습니다.
- Telegram/Slack/Discord runtime은 활성 채널 여부만 보지 않고 최근 시작 시각, 중지 시각, 마지막 오류, 오류 시각을 함께 보존합니다. 설정 API는 이 snapshot을 그대로 내려 UI가 runtime 상태를 빠르게 표시할 수 있게 합니다.
- Slack/Telegram/Discord stop 경로도 런타임 캐시의 `lastStoppedAt`을 갱신합니다. `runs/preflight.ts`는 이 런타임 스냅샷을 이용해 채널이 죽은 상태에서 새 요청이 execution queue로 들어가지 않도록 빠르게 막습니다.

## 메모

- 채널 코드는 외부 메시지를 core의 session과 run으로 번역하는 역할에 집중해야 합니다.
- 작업 실행 규칙 자체는 `runs`와 `agent`에 남겨두는 것이 맞습니다.
- adapter에서 지원하지 않는 기능은 예외 흐름이 아니라 `unsupported_capability` delivery receipt 또는 capability fallback으로 표현합니다. UI/ledger/detail에는 어떤 capability가 미지원인지와 사용자가 선택할 수 있는 fallback을 짧게 보여줘야 합니다.
