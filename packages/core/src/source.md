# source.md

## 역할

- `packages/core/src`는 백엔드 런타임의 실제 구현 루트입니다.

## 중요 단위

- `agent`: 프롬프트 구성, intake, 완료 판정, 도구 기반 LLM 루프
- `runs`: request-group 실행 생명주기, 라우팅, 복구, worker 런타임 조정
- `scheduler`: 반복/예약 실행과 채널 전달
- `tools`: 내장 도구와 승인/실행 정책
- `api`: WebUI와 로컬 제어용 HTTP/WebSocket 표면
- `channels`: 외부 메시징 연동, 현재는 Telegram 중심
- `mqtt`, `yeonjang`: 브로커와 확장 통신

## 메모

- 이 폴더는 오케스트레이션 정책과 런타임 연동 구현이 함께 섞여 있습니다.
- 요청 실행 동작이 바뀌면 보통 `agent`, `runs`, `tools`, `mqtt/yeonjang`을 함께 봐야 합니다.
- 승인/거부 흐름은 `tools`, `runs`, `api/ws`, `channels/telegram`이 함께 맞아야 하며, 한쪽에서 타임아웃을 사용자 거부처럼 기록하지 않도록 reason 전달을 유지해야 합니다.
- 예약/반복 실행 동작이 바뀌면 `agent/intake`, `runs`, `scheduler`, `channels/telegram`, `db`를 함께 봐야 맞습니다.
- 특히 메신저 예약 알림은 `agent/intake`의 문장 분류, `runs`의 지연 실행, `scheduler`의 반복 실행, `channels/telegram`의 실제 전달이 모두 맞아야 합니다.
