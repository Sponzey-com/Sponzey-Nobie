# source.md

## 역할

- `scheduler`는 cron 기반 반복 실행과 예약 작업의 실제 실행기를 담당합니다.

## 주요 파일

- `index.ts`: 스케줄 tick, 실행 시작, 재시도, 실행 결과 기록, 채널 전달
- `cron.ts`: 5필드 cron 파싱과 다음 실행 시각 계산
- `system-cron.ts`: 지원 환경에서 반복 스케줄을 OS 스케줄러(crontab / schtasks)와 동기화

## 메모

- 현재 반복 스케줄은 내부 성공만 기록하면 안 되고, `target_channel`이 `telegram`이면 실제 Telegram 세션으로 결과를 전달해야 성공으로 봅니다.
- `target_session_id`가 없는 오래된 스케줄은 채널 전달 경로가 없으므로, 채널 전달형 스케줄은 새 구조로 다시 저장되는 것이 맞습니다.
- Telegram 채널 가용성 판정은 bot polling 완료를 기다리면 안 됩니다. scheduler는 활성 Telegram 런타임이 먼저 등록된 상태를 기준으로 같은 프로세스 안에서 전달을 시도해야 합니다.
- 반복 스케줄은 가급적 시스템 스케줄러로 내려서 관리하고, 지원되지 않거나 등록 실패 시에만 내부 scheduler로 폴백합니다.
- Linux/macOS 계열은 crontab, Windows는 Task Scheduler를 사용합니다.
- Telegram 대상으로 단순 전달만 필요한 반복 스케줄은 `runAgent()`를 거치지 않고 세션으로 직접 전송합니다. LLM 빈도 제한 때문에 단순 알림이 막히는 문제를 여기서 우회합니다.
