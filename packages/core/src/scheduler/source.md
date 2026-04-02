# source.md

## 역할

- `scheduler`는 cron 기반 반복 실행과 예약 작업의 실제 실행기를 담당합니다.

## 주요 파일

- `index.ts`: 스케줄 tick, 실행 시작, 재시도, 실행 결과 기록, 채널 전달
- `cron.ts`: 5필드 cron 파싱과 다음 실행 시각 계산
- `system-cron.ts`: 지원 환경에서 반복 스케줄을 OS 스케줄러(crontab / schtasks)와 동기화
- `tick-policy.ts`: scheduler tick의 due/skip 판단과 duplicate firing 방지 규칙 helper
- `queueing.ts`: `scheduleId` 단위 직렬화와 schedule queue 상태 helper
- `delivery-queue.ts`: `targetChannel + targetSessionId` 단위 직렬화와 scheduled delivery queue 상태 helper

## 메모

- 현재 반복 스케줄은 내부 성공만 기록하면 안 되고, `target_channel`이 `telegram`이면 실제 Telegram 세션으로 결과를 전달해야 성공으로 봅니다.
- `target_session_id`가 없는 오래된 스케줄은 채널 전달 경로가 없으므로, 채널 전달형 스케줄은 새 구조로 다시 저장되는 것이 맞습니다.
- Telegram 채널 가용성 판정은 bot polling 완료를 기다리면 안 됩니다. scheduler는 활성 Telegram 런타임이 먼저 등록된 상태를 기준으로 같은 프로세스 안에서 전달을 시도해야 합니다.
- 반복 스케줄은 가급적 시스템 스케줄러로 내려서 관리하고, 지원되지 않거나 등록 실패 시에만 내부 scheduler로 폴백합니다.
- Linux/macOS 계열은 crontab, Windows는 Task Scheduler를 사용합니다.
- Telegram 대상으로 단순 전달만 필요한 반복 스케줄은 `runAgent()`를 거치지 않고 세션으로 직접 전송합니다. LLM 빈도 제한 때문에 단순 알림이 막히는 문제를 여기서 우회합니다.
- one-time delayed run은 `runs/run-queueing.ts`를 통해 새 root task instance로 시작하고, 원 예약 등록 run/request-group은 `originRunId`, `originRequestGroupId`로 lineage를 남깁니다. 이 lineage는 로그뿐 아니라 시작된 run의 초기 이벤트에도 반영됩니다. 반복 스케줄도 이와 같은 독립 lifecycle 방향으로 맞춰 가는 것이 기준입니다.
- 반복 스케줄 등록도 `runs/action-execution.ts` receipt에서 `scheduleId`, `targetSessionId`, `originRunId`, `originRequestGroupId`를 함께 남기기 시작해, 저장된 스케줄 엔티티와 등록 태스크 lineage를 나중에 다시 따라갈 수 있는 방향으로 정리 중입니다.
- 이 registration lineage는 이제 DB `schedules` 엔티티의 `origin_run_id`, `origin_request_group_id`에도 저장됩니다.
- intake bridge는 이제 이 등록/취소 receipt를 `schedule.created`, `schedule.cancelled` typed event로도 내보냅니다. 따라서 schedule registration lifecycle과 firing lifecycle을 서로 다른 레코드로 관찰할 수 있습니다.
- 반복 스케줄 실행도 이제 `scheduler/lifecycle.ts`를 통해 `scheduleRunId`, `scheduleName`, `targetChannel`, `targetSessionId`, `trigger`, `originRunId`, `originRequestGroupId`를 포함한 typed event를 발행합니다. 따라서 WebSocket/모니터링 쪽은 시작/완료/실패를 단순 `runId`가 아니라 schedule lifecycle 정보와 함께 소비할 수 있습니다.
- scheduler는 이제 `queueing.ts`의 explicit schedule queue를 사용해 같은 `scheduleId`의 manual/tick firing을 직렬화합니다. tick은 queue에 이미 같은 스케줄이 있으면 새 firing을 추가하지 않고 건너뛰며, manual trigger는 같은 queue 뒤에 붙습니다.
- 이 tick의 due/skip 판단과 `queue_active` duplicate firing 방지 규칙은 이제 `tick-policy.ts`로 분리되어, `index.ts`는 policy 계산 결과를 실제 실행에 연결하는 쪽에 더 집중합니다.
- 이 구조로 인해 scheduler 내부의 구형 `running` set은 더 이상 주 상태가 아니고, schedule 실행 중 여부의 단일 기준은 `queueing.ts`가 유지하는 explicit schedule queue가 됩니다.
- direct Telegram delivery도 이제 `delivery-queue.ts`의 explicit delivery queue를 사용해 같은 세션 대상 scheduled delivery를 직렬화합니다. 즉 schedule 실행 queue와 채널 delivery queue를 별도 목적 큐로 나누기 시작한 상태입니다.
