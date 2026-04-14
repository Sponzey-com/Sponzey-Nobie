# source.md

## 역할

- `channels`는 메시징 채널과 외부 대화 입력 수단을 담는 폴더입니다.

## 현재 중심 구현

- 현재는 Telegram 구현이 중심입니다.
- 채널 시작 처리와 채널별 응답/승인 흐름을 제공합니다.
- 채널 런타임 등록은 실제 polling 시작 완료를 기다리지 않고 먼저 활성 채널로 올려, scheduler 같은 내부 기능이 같은 프로세스 안에서 곧바로 채널을 사용할 수 있게 합니다.
- Telegram 쪽 chunk 텍스트/파일/tool status 전달은 `channels/telegram/chunk-delivery.ts`로 분리해, 채널 엔트리와 실제 전달 경계를 나누기 시작했습니다.
- 같은 방향으로 CLI도 별도 chunk 출력 helper를 쓰기 시작했고, 채널별 전달 책임을 entry 파일 밖으로 빼는 패턴을 맞춰가고 있습니다.
- Telegram/Slack runtime은 활성 채널 여부만 보지 않고 최근 시작 시각, 중지 시각, 마지막 오류, 오류 시각을 함께 보존합니다. 설정 API는 이 snapshot을 그대로 내려 UI가 runtime 상태를 빠르게 표시할 수 있게 합니다.
- Slack/Telegram stop 경로도 런타임 캐시의 `lastStoppedAt`을 갱신합니다. `runs/preflight.ts`는 이 런타임 스냅샷을 이용해 채널이 죽은 상태에서 새 요청이 execution queue로 들어가지 않도록 빠르게 막습니다.

## 메모

- 채널 코드는 외부 메시지를 core의 session과 run으로 번역하는 역할에 집중해야 합니다.
- 작업 실행 규칙 자체는 `runs`와 `agent`에 남겨두는 것이 맞습니다.
