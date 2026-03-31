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
- 메신저 파일 전달 성공 여부도 `tools`의 구조화된 결과, `channels/telegram`의 실제 전송, `runs`의 완료 판정이 같은 receipt를 기준으로 맞아야 합니다.
- 예약/반복 실행 동작이 바뀌면 `agent/intake`, `runs`, `scheduler`, `channels/telegram`, `db`를 함께 봐야 맞습니다.
- 특히 메신저 예약 알림은 `agent/intake`의 문장 분류, `runs`의 지연 실행, `scheduler`의 반복 실행, `channels/telegram`의 실제 전달이 모두 맞아야 합니다.
- `agent/intake`는 이제 원문을 바로 해석하기보다, `request-normalizer.ts`에서 영문 중심 실행 문장으로 정규화한 뒤 그 결과를 기준으로 분류와 구조화를 진행합니다.
- 다만 deterministic heuristic은 이제 `/`로 시작하는 명령어에만 적용하고, 일반 자연어는 intake LLM 분석으로 넘깁니다.
- 새로 구조화된 요청문(`structured_request`)은 `agent/intake`에서 만들어지고, `runs`는 이를 `[target]`, `[to]`, `[context]`, `[complete-condition]` 중심의 후속 실행 프롬프트로 사용합니다.
- 이 구조화 요청문과 `execution_semantics`는 이제 메인 루프의 승인/완료/전달 판단에도 직접 쓰이며, 같은 판단을 위해 원문 문자열을 다시 해석하는 비중을 줄이는 방향으로 정리되고 있습니다.
- request-group 재사용과 활성 실행 취소 같은 진입 판단도 `agent/intake`로 이동해, `runs`는 진입 문자열 해석보다 구조화된 entry semantics를 받는 방향으로 정리되고 있습니다.
- 일정 action이 전체 실패한 경우에도 이를 즉시 완료로 닫지 않고, `runs` 메인 루프 안에서 intake 재분석 복구와 재질의 예산을 함께 사용합니다.
